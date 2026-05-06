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

// =============================================================================
// POST /api/clients/[clientId]/checkins
// =============================================================================
//
// S3-code-P3 — auto-action generation rewired to action-lite Work Items.
//
// What changed vs P2:
//   - The decisions/next-steps loop no longer writes to
//       tenants/{tenantId}/clients/{clientId}/actions/{actionId}
//     on the angsana-exchange project (that collection is empty post-P2
//     `--delete-old`, and is being retired in P4).
//   - It now calls `createActionLite` (cross-project to angsana-core-prod)
//     for each decision/next-step that has `createAction === true`.
//     Same shape as the new Action UI POST and the S3-P2 reseed.
//   - The check-in document's `generatedActionIds` field is renamed to
//     `generatedWorkItemIds`. Old check-in docs from before P3 still
//     carry `generatedActionIds` pointing to deleted-collection IDs;
//     P3-time decision is to NOT migrate those crumbs because no
//     consumer reads them (P1's forward-reference audit).
//
// Atomicity note:
//   The P2 implementation used a single Firestore batch to commit the
//   check-in doc + all generated Action docs atomically. That's no
//   longer possible because the Action docs (action-lite Work Items)
//   live on a different Firestore project. New shape:
//     1. createActionLite per decision/next-step → collect Work Item IDs.
//     2. Single check-in doc write referencing those IDs.
//   If a Work Item write fails mid-loop, we abort with a 500 BEFORE
//   writing the check-in. Pre-written Work Items become orphans the
//   operator can clean up manually (the migrationSource shape isn't
//   used for these; a future cleanup sweep could query by
//   `source.ref` linking back to the check-in that was never persisted).
//   For seed-data v0.1 traffic this is acceptable. Banked: a tighter
//   atomicity guarantee (e.g. write check-in in `pending` state, flip
//   on completion, sweep on failure) is the right answer if real
//   user traffic hits this. Trigger: first paying client.
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden: only internal users can create check-ins' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();

  // Validate required fields
  if (!body.date) return NextResponse.json({ error: 'Missing required field: date' }, { status: 400 });
  if (!body.type) return NextResponse.json({ error: 'Missing required field: type' }, { status: 400 });
  if (!body.attendees || body.attendees.length === 0) {
    return NextResponse.json({ error: 'At least one attendee is required' }, { status: 400 });
  }
  if (!body.duration) return NextResponse.json({ error: 'Missing required field: duration' }, { status: 400 });
  if (!body.keyPoints || body.keyPoints.length === 0) {
    return NextResponse.json({ error: 'At least one key point is required' }, { status: 400 });
  }

  // Validate constraints
  const validTypes = ['kick-off', 'regular', 'ad-hoc'];
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: `Invalid type. Valid: ${validTypes.join(', ')}` }, { status: 400 });
  }

  const validDurations = [15, 30, 60, 90];
  if (!validDurations.includes(body.duration)) {
    return NextResponse.json({ error: `Invalid duration. Valid: ${validDurations.join(', ')}` }, { status: 400 });
  }

  if (body.keyPoints.length > 5) {
    return NextResponse.json({ error: 'Maximum 5 key points allowed' }, { status: 400 });
  }

  // Validate key point lengths
  for (const kp of body.keyPoints) {
    if (kp.length > 150) {
      return NextResponse.json({ error: 'Each key point must be 150 characters or less' }, { status: 400 });
    }
  }

  // Validate decision/next step text lengths
  for (const d of (body.decisions || [])) {
    if (d.text && d.text.length > 200) {
      return NextResponse.json({ error: 'Each decision must be 200 characters or less' }, { status: 400 });
    }
  }
  for (const ns of (body.nextSteps || [])) {
    if (ns.text && ns.text.length > 200) {
      return NextResponse.json({ error: 'Each next step must be 200 characters or less' }, { status: 400 });
    }
  }

  // Validate nextCheckInDate is in the future if provided
  if (body.nextCheckInDate) {
    const nextDate = new Date(body.nextCheckInDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (nextDate < today) {
      return NextResponse.json({ error: 'Next check-in date must be in the future' }, { status: 400 });
    }
  }

  const clientRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId);

  const checkInsRef = clientRef.collection('checkIns');

  // Mint the check-in doc ref up-front so we can reference its ID on
  // the action-lite source field.
  const checkInDocRef = checkInsRef.doc();
  const checkInId = checkInDocRef.id;
  const checkinDate = body.date;

  const validPriorities: ActionLitePriority[] = ['high', 'medium', 'low'];
  function normalisePriority(p: unknown): ActionLitePriority {
    if (typeof p === 'string' && (validPriorities as string[]).includes(p)) {
      return p as ActionLitePriority;
    }
    return 'medium';
  }

  const decisions = (body.decisions || []).map((d: { text: string; assignee?: string; dueDate?: string; priority?: string; createAction?: boolean }) => ({
    text: d.text,
    assignee: d.assignee || '',
    dueDate: d.dueDate || '',
    priority: normalisePriority(d.priority),
    createAction: d.createAction !== false, // default true
  }));

  const nextSteps = (body.nextSteps || []).map((ns: { text: string; owner?: string; targetDate?: string; priority?: string; createAction?: boolean }) => ({
    text: ns.text,
    owner: ns.owner || '',
    targetDate: ns.targetDate || '',
    priority: normalisePriority(ns.priority),
    createAction: ns.createAction !== false, // default true
  }));

  // Determine related campaign — inherit if exactly 1 (legacy rule).
  const inheritedCampaign =
    (body.relatedCampaigns || []).length === 1
      ? (body.relatedCampaigns as string[])[0]
      : '';

  // Run the auto-generation loop (cross-project to angsana-core-prod via
  // `createActionLite`). Pure helper at `lib/workItems/checkInAutoGen.ts`
  // is unit-tested directly with an injected createWorkItem fake.
  let generatedWorkItemIds: string[] = [];
  let actionCount = 0;
  try {
    const out = await runCheckInAutoGen({
      decisions,
      nextSteps,
      context: {
        tenantId: user.tenantId,
        clientId,
        checkInId,
        checkInDate: checkinDate,
        inheritedCampaign,
        actor: { userId: user.email || user.uid, tenantId: user.tenantId },
      },
      createWorkItem: createActionLite,
    });
    generatedWorkItemIds = out.workItemIds;
    actionCount = out.count;
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to auto-generate Work Items from check-in: ${(err as Error).message}`,
        partialWorkItemIds: generatedWorkItemIds,
      },
      { status: 500 }
    );
  }

  // Build the check-in document (now with `generatedWorkItemIds`).
  const checkInData: Record<string, unknown> = {
    date: new Date(body.date),
    type: body.type,
    attendees: body.attendees,
    duration: body.duration,
    relatedCampaigns: body.relatedCampaigns || [],
    keyPoints: body.keyPoints,
    decisions,
    nextSteps,
    // Audit 2 decision (P3-time, see handover): rename — old field name
    // `generatedActionIds` is dropped on new docs. Old check-in docs
    // still carry the legacy field with stale (deleted-collection) IDs;
    // no migration because no consumer reads them.
    generatedWorkItemIds,
    createdBy: user.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (body.nextCheckInDate) {
    checkInData.nextCheckInDate = new Date(body.nextCheckInDate);
  }

  await checkInDocRef.set(checkInData);

  return NextResponse.json(
    { id: checkInId, actionCount, generatedWorkItemIds, success: true },
    { status: 201 }
  );
}
