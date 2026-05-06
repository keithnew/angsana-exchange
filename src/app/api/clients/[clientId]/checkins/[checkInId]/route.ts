import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

import { type ActionLitePriority } from '@/lib/workItems/actionLite';
import { createActionLite } from '@/lib/workItems/actionLitePersistence';
import { runCheckInAutoGen } from '@/lib/workItems/checkInAutoGen';

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
 * PUT /api/clients/[clientId]/checkins/[checkInId]
 *
 * Updates a check-in. New decisions / next-steps with createAction can
 * generate new action-lite Work Items. Existing entries that already
 * have linked Work Items are preserved (text NOT updated).
 *
 * S3-code-P3 (mirrors checkins/route.ts header):
 *   - New action-lite Work Items go to angsana-core-prod via
 *     `createActionLite`.
 *   - The check-in doc's `generatedActionIds` field is rewritten to
 *     `generatedWorkItemIds` on every PUT — append new IDs, preserve
 *     existing ones the doc already carries (whether under the new or
 *     the legacy key, see migration block below).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; checkInId: string }> }
) {
  const { clientId, checkInId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const clientRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId);

  const checkInRef = clientRef.collection('checkIns').doc(checkInId);
  const doc = await checkInRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: 'Check-in not found' }, { status: 404 });
  }

  const currentData = doc.data()!;
  const body = await request.json();

  // Validate constraints (same as create)
  if (body.keyPoints) {
    if (body.keyPoints.length === 0) {
      return NextResponse.json({ error: 'At least one key point is required' }, { status: 400 });
    }
    if (body.keyPoints.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 key points allowed' }, { status: 400 });
    }
    for (const kp of body.keyPoints) {
      if (kp.length > 150) {
        return NextResponse.json({ error: 'Each key point must be 150 characters or less' }, { status: 400 });
      }
    }
  }

  // Pre-existing IDs — read from BOTH keys for the cutover transition.
  // After P3 deploys we write `generatedWorkItemIds`; pre-P3 docs
  // carry `generatedActionIds` with stale (deleted-collection) IDs.
  // We forward both into the new field on save so a post-P3 PUT to a
  // pre-P3 doc cleans the legacy key in passing.
  const existingWorkItemIds: string[] = [
    ...((currentData.generatedWorkItemIds as string[]) ?? []),
    ...((currentData.generatedActionIds as string[]) ?? []),
  ];
  let newWorkItemIds: string[] = [];
  let newActionCount = 0;

  function inheritedCampaign(): string {
    const merged = body.relatedCampaigns ?? currentData.relatedCampaigns ?? [];
    return Array.isArray(merged) && merged.length === 1 ? (merged[0] as string) : '';
  }

  function checkinDateString(): string {
    if (body.date) return body.date as string;
    const ts = currentData.date as { toDate?: () => Date } | undefined;
    if (ts && typeof ts.toDate === 'function') return ts.toDate().toISOString();
    return new Date().toISOString();
  }

  // Run the auto-generation loop in `newOnly` mode — only entries past
  // the existing-count baseline get Work Items minted (preserves the
  // P2 invariant that re-editing an existing decision/next-step doesn't
  // duplicate its linked Work Item).
  try {
    const out = await runCheckInAutoGen({
      decisions: body.decisions ?? [],
      nextSteps: body.nextSteps ?? [],
      context: {
        tenantId: user.tenantId,
        clientId,
        checkInId,
        checkInDate: checkinDateString(),
        inheritedCampaign: inheritedCampaign(),
        actor: { userId: user.email || user.uid, tenantId: user.tenantId },
      },
      createWorkItem: createActionLite,
      newOnly: true,
      existingDecisionCount: (currentData.decisions || []).length,
      existingNextStepCount: (currentData.nextSteps || []).length,
    });
    newWorkItemIds = out.workItemIds;
    newActionCount = out.count;
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to auto-generate Work Items from check-in: ${(err as Error).message}`,
        partialWorkItemIds: newWorkItemIds,
      },
      { status: 500 }
    );
  }

  // Build update.
  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'date',
    'type',
    'attendees',
    'duration',
    'relatedCampaigns',
    'keyPoints',
    'decisions',
    'nextSteps',
    'nextCheckInDate',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'date' || field === 'nextCheckInDate') {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  updateData.generatedWorkItemIds = [...existingWorkItemIds, ...newWorkItemIds];
  // Drop the legacy key explicitly when rewriting — Firestore `update`
  // doesn't remove fields by omission. FieldValue.delete() is the right
  // primitive.
  if (currentData.generatedActionIds !== undefined) {
    updateData.generatedActionIds = FieldValue.delete();
  }
  updateData.updatedAt = FieldValue.serverTimestamp();

  await checkInRef.update(updateData);

  return NextResponse.json({ success: true, newActionCount, newWorkItemIds });
}
