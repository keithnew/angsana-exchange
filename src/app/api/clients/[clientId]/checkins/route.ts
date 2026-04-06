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
 * POST /api/clients/[clientId]/checkins
 * Creates a new check-in with auto-action generation.
 * Only internal-user and internal-admin can create.
 * Uses Firestore batch write for atomicity.
 */
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
  const actionsRef = clientRef.collection('actions');

  const batch = adminDb.batch();

  // Create the check-in document reference
  const checkInDocRef = checkInsRef.doc();
  const checkInId = checkInDocRef.id;
  const checkinDate = body.date;

  // Collect action IDs to be generated
  const generatedActionIds: string[] = [];
  let actionCount = 0;

  // Process decisions that should create actions
  const validPriorities = ['high', 'medium', 'low'];

  const decisions = (body.decisions || []).map((d: { text: string; assignee?: string; dueDate?: string; priority?: string; createAction?: boolean }) => ({
    text: d.text,
    assignee: d.assignee || '',
    dueDate: d.dueDate || '',
    priority: validPriorities.includes(d.priority || '') ? d.priority : 'medium',
    createAction: d.createAction !== false, // default true
  }));

  for (const decision of decisions) {
    if (decision.createAction && decision.text) {
      const actionDocRef = actionsRef.doc();
      generatedActionIds.push(actionDocRef.id);
      actionCount++;

      // Determine related campaign — inherit if exactly 1
      const relatedCampaign = (body.relatedCampaigns || []).length === 1
        ? body.relatedCampaigns[0]
        : '';

      // Default due date: 7 days from check-in date
      const dueDate = decision.dueDate
        ? new Date(decision.dueDate)
        : new Date(new Date(checkinDate).getTime() + 7 * 24 * 60 * 60 * 1000);

      batch.set(actionDocRef, {
        title: decision.text,
        description: '',
        assignedTo: decision.assignee || user.email,
        dueDate,
        status: 'open',
        priority: decision.priority || 'medium',
        source: { type: 'checkin', ref: checkInId },
        relatedCampaign,
        createdBy: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // Process next steps that should create actions
  const nextSteps = (body.nextSteps || []).map((ns: { text: string; owner?: string; targetDate?: string; priority?: string; createAction?: boolean }) => ({
    text: ns.text,
    owner: ns.owner || '',
    targetDate: ns.targetDate || '',
    priority: validPriorities.includes(ns.priority || '') ? ns.priority : 'medium',
    createAction: ns.createAction !== false, // default true
  }));

  for (const step of nextSteps) {
    if (step.createAction && step.text) {
      const actionDocRef = actionsRef.doc();
      generatedActionIds.push(actionDocRef.id);
      actionCount++;

      const relatedCampaign = (body.relatedCampaigns || []).length === 1
        ? body.relatedCampaigns[0]
        : '';

      const dueDate = step.targetDate
        ? new Date(step.targetDate)
        : new Date(new Date(checkinDate).getTime() + 7 * 24 * 60 * 60 * 1000);

      batch.set(actionDocRef, {
        title: step.text,
        description: '',
        assignedTo: step.owner || user.email,
        dueDate,
        status: 'open',
        priority: step.priority || 'medium',
        source: { type: 'checkin', ref: checkInId },
        relatedCampaign,
        createdBy: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // Build the check-in document
  const checkInData: Record<string, unknown> = {
    date: new Date(body.date),
    type: body.type,
    attendees: body.attendees,
    duration: body.duration,
    relatedCampaigns: body.relatedCampaigns || [],
    keyPoints: body.keyPoints,
    decisions,
    nextSteps,
    generatedActionIds,
    createdBy: user.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (body.nextCheckInDate) {
    checkInData.nextCheckInDate = new Date(body.nextCheckInDate);
  }

  batch.set(checkInDocRef, checkInData);

  // Commit the batch — atomically creates check-in + all actions
  await batch.commit();

  return NextResponse.json(
    { id: checkInId, actionCount, success: true },
    { status: 201 }
  );
}
