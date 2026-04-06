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
 * POST /api/clients/[clientId]/actions
 * Creates a new action.
 * Internal users can create actions manually.
 * Client-approver can create auto-generated actions (e.g. from wishlist).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // Internal users + client-approver can create actions
  const canCreate = isInternal(user.role) || user.role === 'client-approver';
  if (!canCreate) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();

  // Determine source — allow wishlist auto-actions to pass source through
  const source = body.source || { type: 'manual' };
  const isAutoAction = source.type === 'wishlist' || source.type === 'checkin';

  // Validate required fields — auto-actions have relaxed requirements
  if (!body.title) {
    return NextResponse.json({ error: 'Missing required field: title' }, { status: 400 });
  }
  if (!body.dueDate) {
    return NextResponse.json({ error: 'Missing required field: dueDate' }, { status: 400 });
  }
  if (!isAutoAction && !body.assignedTo) {
    return NextResponse.json({ error: 'Missing required field: assignedTo' }, { status: 400 });
  }

  // Validate lengths
  if (body.title.length > 150) {
    return NextResponse.json({ error: 'Title must be 150 characters or less' }, { status: 400 });
  }
  if (body.description && body.description.length > 280) {
    return NextResponse.json({ error: 'Description must be 280 characters or less' }, { status: 400 });
  }

  const actionData = {
    title: body.title,
    description: body.description || '',
    assignedTo: body.assignedTo || '',
    dueDate: new Date(body.dueDate),
    status: body.status || 'open',
    priority: body.priority || 'medium',
    source,
    relatedCampaign: body.relatedCampaign || '',
    createdBy: user.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const docRef = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('actions')
    .add(actionData);

  return NextResponse.json({ id: docRef.id, success: true }, { status: 201 });
}
