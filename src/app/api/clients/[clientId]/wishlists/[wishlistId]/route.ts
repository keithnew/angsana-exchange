import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

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

function canWrite(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user' || role === 'client-approver';
}

/**
 * PUT /api/clients/[clientId]/wishlists/[wishlistId]
 * Updates a wishlist item. Internal users can edit all fields.
 * Client-approver can edit company details but not status or campaignRef.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; wishlistId: string }> }
) {
  const { clientId, wishlistId } = await params;
  const user = getUserFromHeaders(request);

  if (!canWrite(user.role)) {
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
    .collection('wishlists')
    .doc(wishlistId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }

  const body = await request.json();

  if (body.notes && body.notes.length > 280) {
    return NextResponse.json({ error: 'Notes must be 280 characters or less' }, { status: 400 });
  }

  const isInternalUser = isInternal(user.role);

  // Client-approver can only edit these fields
  const clientAllowedFields = ['companyName', 'sector', 'geography', 'priority', 'notes'];
  // Internal users can edit all fields
  const internalAllowedFields = [...clientAllowedFields, 'status', 'campaignRef'];

  const allowedFields = isInternalUser ? internalAllowedFields : clientAllowedFields;

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  updateData.updatedAt = FieldValue.serverTimestamp();

  await docRef.update(updateData);

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/clients/[clientId]/wishlists/[wishlistId]
 * Quick status update — internal users only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; wishlistId: string }> }
) {
  const { clientId, wishlistId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden: only internal users can change status' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();
  const validStatuses = ['new', 'under-review', 'added-to-target-list', 'rejected'];

  const updateData: Record<string, unknown> = {};

  if (body.status) {
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Valid: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    updateData.status = body.status;
  }

  if (body.campaignRef !== undefined) {
    updateData.campaignRef = body.campaignRef;
  }

  updateData.updatedAt = FieldValue.serverTimestamp();

  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('wishlists')
    .doc(wishlistId);

  const doc = await docRef.get();
  if (!doc.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }

  await docRef.update(updateData);

  return NextResponse.json({ success: true });
}
