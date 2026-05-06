import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { publishEvent } from '@/lib/events/publish';

/**
 * Helper: extract user claims from request headers (set by middleware).
 */
function getUserFromHeaders(request: NextRequest) {
  return {
    uid: request.headers.get('x-user-uid') || '',
    role: request.headers.get('x-user-role') || '',
    tenantId: request.headers.get('x-user-tenant') || 'angsana',
    email: request.headers.get('x-user-email') || '',
    clientId: request.headers.get('x-user-client') || null,
    assignedClients: JSON.parse(request.headers.get('x-assigned-clients') || '[]'),
  };
}

function hasClientAccess(user: ReturnType<typeof getUserFromHeaders>, clientId: string): boolean {
  if (user.clientId) return user.clientId === clientId;
  if (user.assignedClients?.includes('*')) return true;
  return user.assignedClients?.includes(clientId) ?? false;
}

function isInternal(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

/**
 * Compare two arrays for set-equality (order irrelevant). Used for
 * targeting-hint diffing to decide whether to emit
 * `campaign.targetingHintsChanged`.
 */
function sameStringSet(a: unknown, b: unknown): boolean {
  const aa = Array.isArray(a) ? (a as unknown[]).map(String) : [];
  const bb = Array.isArray(b) ? (b as unknown[]).map(String) : [];
  if (aa.length !== bb.length) return false;
  const s = new Set(aa);
  return bb.every((x) => s.has(x));
}

/**
 * Targeting-hint fields per the v0.1 §4.2 substantive-edit definition for
 * Campaign. The four fields collectively constitute the campaign's
 * "targeting hints"; any change to any of them surfaces a single
 * `campaign.targetingHintsChanged` event (one event per save, regardless
 * of how many sub-fields moved — this matches the wishlist
 * `targetingHintsChanged` semantic in the parallel route).
 */
const TARGETING_FIELDS = [
  'targetGeographies',
  'targetSectors',
  'targetTitles',
  'companySize',
] as const;

/**
 * PUT /api/clients/[clientId]/campaigns/[campaignId]
 * Updates campaign fields. Only internal-user and internal-admin can edit.
 * Uses Firestore update (not set) to avoid overwriting concurrent edits.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
) {
  const { clientId, campaignId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .doc(campaignId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const currentData = doc.data()!;

  // Cannot edit completed campaigns
  if (currentData.status === 'completed') {
    return NextResponse.json({ error: 'Completed campaigns cannot be edited' }, { status: 400 });
  }

  const body = await request.json();

  // Validate lengths
  if (body.campaignName && body.campaignName.length > 100) {
    return NextResponse.json({ error: 'Campaign name must be 100 characters or less' }, { status: 400 });
  }
  if (body.campaignSummary && body.campaignSummary.length > 280) {
    return NextResponse.json({ error: 'Campaign summary must be 280 characters or less' }, { status: 400 });
  }
  if (body.valueProposition && body.valueProposition.length > 200) {
    return NextResponse.json({ error: 'Value proposition must be 200 characters or less' }, { status: 400 });
  }
  if (body.painPoints && body.painPoints.length > 8) {
    return NextResponse.json({ error: 'Maximum 8 pain points allowed' }, { status: 400 });
  }

  // Build update object — only include fields that were provided
  const allowedFields = [
    'campaignName', 'campaignSummary', 'serviceType', 'serviceTypeId',
    'owner', 'startDate', 'propositionRefs', 'targetGeographies', 'targetSectors',
    'targetTitles', 'companySize', 'valueProposition', 'painPoints', 'selectedSoWhats',
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'startDate') {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  updateData.updatedAt = FieldValue.serverTimestamp();

  await docRef.update(updateData);

  // ── Notification Pattern v0.1 §4.2 emissions ─────────────────────────
  // Per S3-pre-code Decision #7, the v0.1 substantive-edit verb set for
  // Campaign is `nameChanged`, `targetingHintsChanged`, `statusChanged`,
  // and `added`. PUT covers `nameChanged` + `targetingHintsChanged`;
  // `statusChanged` lives in POST below; `added` is in route.ts.
  const occurredAt = new Date().toISOString();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  if (
    updateData.campaignName !== undefined &&
    (updateData.campaignName as string) !== (currentData.campaignName as string | undefined)
  ) {
    events.push({
      eventType: 'campaign.nameChanged',
      payload: {
        campaignId,
        from: currentData.campaignName ?? null,
        to: updateData.campaignName,
      },
    });
  }

  // Detect any change in the four targeting fields → single
  // `campaign.targetingHintsChanged` event.
  let targetingChanged = false;
  for (const f of TARGETING_FIELDS) {
    if (updateData[f] === undefined) continue;
    if (f === 'companySize') {
      if ((updateData[f] as string) !== (currentData[f] as string | undefined)) {
        targetingChanged = true;
        break;
      }
    } else if (!sameStringSet(updateData[f], currentData[f])) {
      targetingChanged = true;
      break;
    }
  }
  if (targetingChanged) {
    events.push({
      eventType: 'campaign.targetingHintsChanged',
      payload: {
        campaignId,
        targeting: {
          targetGeographies: updateData.targetGeographies ?? currentData.targetGeographies ?? [],
          targetSectors: updateData.targetSectors ?? currentData.targetSectors ?? [],
          targetTitles: updateData.targetTitles ?? currentData.targetTitles ?? [],
          companySize: updateData.companySize ?? currentData.companySize ?? '',
        },
      },
    });
  }

  for (const ev of events) {
    await publishEvent({
      eventType: ev.eventType,
      payload: ev.payload,
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt,
    });
  }

  return NextResponse.json({ success: true, eventsEmitted: events.length });
}

/**
 * POST /api/clients/[clientId]/campaigns/[campaignId]
 * Handles status transitions. Body: { action: 'activate' | 'pause' | 'complete' | 'reactivate', reason?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
) {
  const { clientId, campaignId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();
  const { action, reason } = body;

  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .doc(campaignId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const currentData = doc.data()!;
  const currentStatus = currentData.status;
  const now = new Date().toISOString();

  // Helper: emit `campaign.statusChanged` after a successful transition.
  // Per Notification Pattern v0.1 §4.2, status moves are substantive
  // edits — every legal transition surfaces a linked-edit ping.
  async function emitStatusChange(from: string, to: string): Promise<void> {
    await publishEvent({
      eventType: 'campaign.statusChanged',
      payload: {
        campaignId,
        from,
        to,
        ...(reason ? { reason: String(reason) } : {}),
      },
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt: now,
    });
  }

  // Validate transitions
  switch (action) {
    case 'activate': {
      if (currentStatus !== 'draft') {
        return NextResponse.json(
          { error: 'Can only activate a draft campaign' },
          { status: 400 }
        );
      }
      // Check required fields for activation
      const missing: string[] = [];
      if (!currentData.campaignName) missing.push('Campaign Name');
      if (!currentData.campaignSummary) missing.push('Campaign Summary');
      if (!currentData.serviceType) missing.push('Service Type');
      if (!currentData.owner) missing.push('Owner');
      if (!currentData.startDate) missing.push('Start Date');

      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot activate: missing required fields: ${missing.join(', ')}` },
          { status: 400 }
        );
      }

      const historyEntry = { from: 'draft', to: 'active', timestamp: now, changedBy: user.email };
      await docRef.update({
        status: 'active',
        statusHistory: FieldValue.arrayUnion(historyEntry),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await emitStatusChange('draft', 'active');
      return NextResponse.json({ success: true, newStatus: 'active' });
    }

    case 'pause': {
      if (currentStatus !== 'active') {
        return NextResponse.json(
          { error: 'Can only pause an active campaign' },
          { status: 400 }
        );
      }
      if (!reason || reason.trim().length === 0) {
        return NextResponse.json(
          { error: 'Pause reason is required' },
          { status: 400 }
        );
      }
      if (reason.length > 280) {
        return NextResponse.json(
          { error: 'Pause reason must be 280 characters or less' },
          { status: 400 }
        );
      }

      const historyEntry = { from: 'active', to: 'paused', timestamp: now, changedBy: user.email, reason };
      await docRef.update({
        status: 'paused',
        pauseReason: reason,
        statusHistory: FieldValue.arrayUnion(historyEntry),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await emitStatusChange('active', 'paused');
      return NextResponse.json({ success: true, newStatus: 'paused' });
    }

    case 'reactivate': {
      if (currentStatus !== 'paused') {
        return NextResponse.json(
          { error: 'Can only reactivate a paused campaign' },
          { status: 400 }
        );
      }

      const historyEntry = { from: 'paused', to: 'active', timestamp: now, changedBy: user.email };
      await docRef.update({
        status: 'active',
        pauseReason: '',
        statusHistory: FieldValue.arrayUnion(historyEntry),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await emitStatusChange('paused', 'active');
      return NextResponse.json({ success: true, newStatus: 'active' });
    }

    case 'complete': {
      if (currentStatus !== 'active' && currentStatus !== 'paused') {
        return NextResponse.json(
          { error: 'Can only complete an active or paused campaign' },
          { status: 400 }
        );
      }

      const historyEntry = { from: currentStatus, to: 'completed', timestamp: now, changedBy: user.email };
      await docRef.update({
        status: 'completed',
        statusHistory: FieldValue.arrayUnion(historyEntry),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await emitStatusChange(currentStatus as string, 'completed');
      return NextResponse.json({ success: true, newStatus: 'completed' });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}. Valid: activate, pause, reactivate, complete` },
        { status: 400 }
      );
  }
}
