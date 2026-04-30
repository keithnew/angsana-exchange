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

function isInternalOrApprover(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user' || role === 'client-approver';
}

function isInternal(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

/**
 * PATCH /api/clients/[clientId]/prospecting-profile/market-messaging
 * Update the market messaging library (full array replace).
 * Client-approver cannot set notes field.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternalOrApprover(user.role)) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  try {
    const body = await request.json();

    if (!Array.isArray(body.marketMessaging)) {
      return NextResponse.json({ error: 'marketMessaging must be an array' }, { status: 400 });
    }

    // If client-approver, strip notes from entries
    let entries = body.marketMessaging;
    if (!isInternal(user.role)) {
      entries = entries.map((entry: Record<string, unknown>) => {
        const { notes: _notes, ...rest } = entry;
        return rest;
      });
    }

    const docRef = adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('config')
      .doc('prospectingProfile');

    await docRef.set(
      {
        marketMessaging: entries,
        lastUpdatedBy: user.uid,
        lastUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Market messaging PATCH error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
