// =============================================================================
// Angsana Exchange — Resend Invite Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/users/{uid}/resend-invite
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
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

    if (authResult.role !== 'internal-admin' && authResult.role !== 'client-approver') {
      return errorResponse('FORBIDDEN', 'Only internal-admin and client-approver can resend invites.');
    }

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const userDocRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return errorResponse('NOT_FOUND', `User '${uid}' not found.`);
    }

    const userData = userDoc.data()!;

    if (userData.status === 'disabled') {
      return errorResponse('BAD_REQUEST', 'Cannot resend invite to disabled user. Enable the user first.');
    }

    if (authResult.role === 'client-approver' && userData.clientId !== authResult.clientId) {
      return errorResponse('FORBIDDEN', 'Client-approver can only resend invites within their own client.');
    }

    await adminAuth.generatePasswordResetLink(userData.email);

    return NextResponse.json({ success: true, userId: uid, passwordResetSent: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Resend invite error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
