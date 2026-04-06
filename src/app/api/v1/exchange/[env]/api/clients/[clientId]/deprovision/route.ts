// =============================================================================
// Angsana Exchange — Client Deprovisioning Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/clients/{clientId}/deprovision
// Marks client as lapsed, disables all users. Data preserved.
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
  { params }: { params: Promise<{ env: string; clientId: string }> }
) {
  try {
    const { clientId } = await params;
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }

    if (authResult.role !== 'internal-admin') {
      return errorResponse('FORBIDDEN', 'Only internal-admin can deprovision clients.');
    }

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const clientRef = adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId);
    const clientDoc = await clientRef.get();

    if (!clientDoc.exists) {
      return errorResponse('NOT_FOUND', `Client '${clientId}' not found.`);
    }

    // Update client status
    await clientRef.update({
      status: 'lapsed',
      lapsedAt: FieldValue.serverTimestamp(),
      lapsedBy: authResult.userId || authResult.keyId || null,
    });

    // Query all active/invited users for this client
    const usersRef = adminDb.collection('tenants').doc(tenantId).collection('users');
    const usersSnapshot = await usersRef.where('clientId', '==', clientId).get();

    let usersDisabled = 0;
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      if (userData.status === 'disabled') continue;

      try {
        await adminAuth.updateUser(userDoc.id, { disabled: true });
        await userDoc.ref.update({
          status: 'disabled',
          disabledAt: FieldValue.serverTimestamp(),
          disabledBy: authResult.userId || authResult.keyId || null,
        });
        usersDisabled++;
      } catch (err) {
        console.error(`Failed to disable user ${userDoc.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, clientId, usersDisabled });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Client deprovisioning error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
