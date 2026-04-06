// =============================================================================
// Angsana Exchange — User Enable Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/users/{uid}/enable
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

    if (authResult.role !== 'internal-admin') {
      return errorResponse('FORBIDDEN', 'Only internal-admin can re-enable users.');
    }

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const userDocRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return errorResponse('NOT_FOUND', `User '${uid}' not found.`);
    }

    await adminAuth.updateUser(uid, { disabled: false });

    await userDocRef.update({
      status: 'active',
      disabledAt: FieldValue.delete(),
      disabledBy: FieldValue.delete(),
    });

    return NextResponse.json({ success: true, userId: uid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('User enable error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
