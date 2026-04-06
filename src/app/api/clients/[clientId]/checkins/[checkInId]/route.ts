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
 * PUT /api/clients/[clientId]/checkins/[checkInId]
 * Updates a check-in. New decisions with createAction can generate new actions.
 * Existing decisions that already generated actions are preserved (action text NOT updated).
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

  const batch = adminDb.batch();
  const actionsRef = clientRef.collection('actions');
  const existingActionIds: string[] = currentData.generatedActionIds || [];
  const newActionIds: string[] = [];
  let newActionCount = 0;

  // Process new decisions that should create actions
  // Only create actions for decisions that don't already have linked actions
  if (body.decisions) {
    const existingDecisionCount = (currentData.decisions || []).length;
    for (let i = 0; i < body.decisions.length; i++) {
      const decision = body.decisions[i];
      // New decisions are those beyond the original count
      if (i >= existingDecisionCount && decision.createAction && decision.text) {
        const actionDocRef = actionsRef.doc();
        newActionIds.push(actionDocRef.id);
        newActionCount++;

        const relatedCampaign = (body.relatedCampaigns || currentData.relatedCampaigns || []).length === 1
          ? (body.relatedCampaigns || currentData.relatedCampaigns)[0]
          : '';

        const checkinDate = body.date || currentData.date?.toDate?.()?.toISOString() || new Date().toISOString();
        const dueDate = decision.dueDate
          ? new Date(decision.dueDate)
          : new Date(new Date(checkinDate).getTime() + 7 * 24 * 60 * 60 * 1000);

        const validPriorities = ['high', 'medium', 'low'];

        batch.set(actionDocRef, {
          title: decision.text,
          description: '',
          assignedTo: decision.assignee || user.email,
          dueDate,
          status: 'open',
          priority: validPriorities.includes(decision.priority) ? decision.priority : 'medium',
          source: { type: 'checkin', ref: checkInId },
          relatedCampaign,
          createdBy: user.email,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  // Process new next steps similarly
  if (body.nextSteps) {
    const existingStepCount = (currentData.nextSteps || []).length;
    for (let i = 0; i < body.nextSteps.length; i++) {
      const step = body.nextSteps[i];
      if (i >= existingStepCount && step.createAction && step.text) {
        const actionDocRef = actionsRef.doc();
        newActionIds.push(actionDocRef.id);
        newActionCount++;

        const relatedCampaign = (body.relatedCampaigns || currentData.relatedCampaigns || []).length === 1
          ? (body.relatedCampaigns || currentData.relatedCampaigns)[0]
          : '';

        const checkinDate = body.date || currentData.date?.toDate?.()?.toISOString() || new Date().toISOString();
        const dueDate = step.targetDate
          ? new Date(step.targetDate)
          : new Date(new Date(checkinDate).getTime() + 7 * 24 * 60 * 60 * 1000);

        const validPriorities = ['high', 'medium', 'low'];

        batch.set(actionDocRef, {
          title: step.text,
          description: '',
          assignedTo: step.owner || user.email,
          dueDate,
          status: 'open',
          priority: validPriorities.includes(step.priority) ? step.priority : 'medium',
          source: { type: 'checkin', ref: checkInId },
          relatedCampaign,
          createdBy: user.email,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  // Build update
  const updateData: Record<string, unknown> = {};
  const allowedFields = ['date', 'type', 'attendees', 'duration', 'relatedCampaigns', 'keyPoints', 'decisions', 'nextSteps', 'nextCheckInDate'];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'date' || field === 'nextCheckInDate') {
        updateData[field] = new Date(body[field]);
      } else {
        updateData[field] = body[field];
      }
    }
  }

  updateData.generatedActionIds = [...existingActionIds, ...newActionIds];
  updateData.updatedAt = FieldValue.serverTimestamp();

  batch.update(checkInRef, updateData);
  await batch.commit();

  return NextResponse.json({ success: true, newActionCount });
}
