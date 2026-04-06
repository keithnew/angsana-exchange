// =============================================================================
// Angsana Exchange — Update Claims Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/users/{uid}/update-claims
// Updates Firebase Auth custom claims to match updated role/clientId/assignedClients.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/api/middleware/auth';
import { errorResponse } from '@/lib/api/response';
import { DEFAULT_TENANT_ID } from '@/lib/api/config';
import type { UserRole } from '@/types';

export const runtime = 'nodejs';

const VALID_ROLES: UserRole[] = ['internal-admin', 'internal-user', 'client-approver', 'client-viewer'];
const CLIENT_ROLES: UserRole[] = ['client-approver', 'client-viewer'];
const DEFAULT_CLIENT_MODULES = ['campaigns', 'checkins', 'actions', 'sowhats', 'wishlists', 'documents', 'dashboard'];
const DEFAULT_INTERNAL_MODULES = ['campaigns', 'checkins', 'actions', 'sowhats', 'wishlists', 'dnc', 'msa-psl', 'documents', 'dashboard'];
const ADMIN_MODULES = [...DEFAULT_INTERNAL_MODULES, 'admin'];

function getPermittedModules(role: UserRole): string[] {
  switch (role) {
    case 'internal-admin': return ADMIN_MODULES;
    case 'internal-user': return DEFAULT_INTERNAL_MODULES;
    case 'client-approver': return [...DEFAULT_CLIENT_MODULES, 'approvals'];
    case 'client-viewer': return DEFAULT_CLIENT_MODULES;
    default: return DEFAULT_CLIENT_MODULES;
  }
}

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
      return errorResponse('FORBIDDEN', 'Only internal-admin can update user claims.');
    }

    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('BAD_REQUEST', 'Request body required.');

    const { role, clientId, assignedClients } = body;
    if (!role || !VALID_ROLES.includes(role)) {
      return errorResponse('BAD_REQUEST', `role must be one of: ${VALID_ROLES.join(', ')}`);
    }

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const userDocRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return errorResponse('NOT_FOUND', `User '${uid}' not found.`);
    }

    const effectiveClientId = CLIENT_ROLES.includes(role) ? clientId : null;
    const effectiveAssignedClients = role === 'internal-admin' ? ['*']
      : role === 'internal-user' ? (assignedClients || [])
      : null;
    const permittedModules = getPermittedModules(role);

    await adminAuth.setCustomUserClaims(uid, {
      tenantId,
      role,
      clientId: effectiveClientId,
      assignedClients: effectiveAssignedClients,
      permittedModules,
    });

    await userDocRef.update({
      role,
      clientId: effectiveClientId,
      assignedClients: effectiveAssignedClients,
      claimsUpdatedAt: FieldValue.serverTimestamp(),
      claimsUpdatedBy: authResult.userId || null,
    });

    return NextResponse.json({ success: true, userId: uid, role, claimsUpdated: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Update claims error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
