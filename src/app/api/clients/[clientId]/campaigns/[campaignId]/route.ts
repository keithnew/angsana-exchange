import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

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
    'owner', 'startDate', 'targetGeographies', 'targetSectors',
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

  return NextResponse.json({ success: true });
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
      return NextResponse.json({ success: true, newStatus: 'completed' });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}. Valid: activate, pause, reactivate, complete` },
        { status: 400 }
      );
  }
}
