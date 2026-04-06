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

function canWrite(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user' || role === 'client-approver';
}

/**
 * POST /api/clients/[clientId]/wishlists
 * Creates one or more wishlist items.
 * Internal users and client-approver can create.
 * Accepts { items: [...] } for batch creation or a single item object.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  if (!canWrite(user.role)) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  // Support batch: { items: [...] } or single item
  const items = body.items || [body];
  const createdIds: string[] = [];

  for (const item of items) {
    // Validate required fields
    if (!item.companyName || !item.companyName.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }

    if (item.notes && item.notes.length > 280) {
      return NextResponse.json({ error: 'Notes must be 280 characters or less' }, { status: 400 });
    }

    const isInternalUser = isInternal(user.role);

    const wishlistData: Record<string, unknown> = {
      companyName: item.companyName.trim(),
      sector: item.sector || '',
      geography: item.geography || '',
      priority: item.priority || 'medium',
      notes: item.notes || '',
      status: isInternalUser ? (item.status || 'new') : 'new', // Client users always get 'new'
      campaignRef: isInternalUser ? (item.campaignRef || '') : '', // Client users can't set campaign
      addedBy: user.email,
      addedDate: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('wishlists')
      .add(wishlistData);

    createdIds.push(docRef.id);
  }

  return NextResponse.json(
    { ids: createdIds, count: createdIds.length, success: true },
    { status: 201 }
  );
}
