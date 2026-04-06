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
 * PUT /api/clients/[clientId]/actions/[actionId]
 * Updates action fields. Only internal-user and internal-admin can edit.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; actionId: string }> }
) {
  const { clientId, actionId } = await params;
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
    .collection('actions')
    .doc(actionId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }

  const body = await request.json();

  // Validate lengths
  if (body.title && body.title.length > 150) {
    return NextResponse.json({ error: 'Title must be 150 characters or less' }, { status: 400 });
  }
  if (body.description && body.description.length > 280) {
    return NextResponse.json({ error: 'Description must be 280 characters or less' }, { status: 400 });
  }

  // Build update object — only include fields that were provided
  const allowedFields = [
    'title', 'description', 'assignedTo', 'dueDate',
    'status', 'priority', 'relatedCampaign',
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'dueDate') {
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
 * PATCH /api/clients/[clientId]/actions/[actionId]
 * Quick status update — designed for inline status change from the list.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; actionId: string }> }
) {
  const { clientId, actionId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();
  const { status } = body;

  const validStatuses = ['open', 'in-progress', 'done', 'blocked'];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Valid: ${validStatuses.join(', ')}` },
      { status: 400 }
    );
  }

  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('actions')
    .doc(actionId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }

  await docRef.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true, newStatus: status });
}
