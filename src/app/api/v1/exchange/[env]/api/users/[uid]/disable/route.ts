// =============================================================================
// Angsana Exchange — User Disable Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/users/{uid}/disable
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/api/middleware/auth';
import { errorResponse } from '@/lib/api/response';
import { DEFAULT_TENANT_ID } from '@/lib/api/config';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ env: string; uid: string }> }
) {
  try {
    const { uid } = await params;
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }

    // Only internal-admin and client-approver can disable users
    if (authResult.role !== 'internal-admin' && authResult.role !== 'client-approver') {
      return errorResponse('FORBIDDEN', 'Only internal-admin and client-approver can disable users.');
    }

    // Cannot disable yourself
    if (authResult.userId === uid) {
      return errorResponse('BAD_REQUEST', 'Cannot disable your own account.');
    }

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const userDocRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return errorResponse('NOT_FOUND', `User '${uid}' not found.`);
    }

    const userData = userDoc.data()!;

    // Client-approver can only disable users within their own client
    if (authResult.role === 'client-approver' && userData.clientId !== authResult.clientId) {
      return errorResponse('FORBIDDEN', 'Client-approver can only disable users within their own client.');
    }

    // Disable in Firebase Auth
    await adminAuth.updateUser(uid, { disabled: true });

    // Update Firestore
    await userDocRef.update({
      status: 'disabled',
      disabledAt: FieldValue.serverTimestamp(),
      disabledBy: authResult.userId || authResult.keyId || null,
    });

    return NextResponse.json({ success: true, userId: uid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('User disable error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
