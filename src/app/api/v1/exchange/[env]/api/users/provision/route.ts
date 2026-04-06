// =============================================================================
// Angsana Exchange — User Provisioning Endpoint
// Slice 6B: User & Client Lifecycle
//
// POST /api/v1/exchange/{env}/api/users/provision
// Creates a single user: Firebase Auth + custom claims + Firestore doc + password reset.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
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

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }

    // 2. Only internal-admin and client-approver can create users
    if (authResult.role !== 'internal-admin' && authResult.role !== 'client-approver') {
      return errorResponse('FORBIDDEN', 'Only internal-admin and client-approver roles can create users.');
    }

    // 3. Parse body
    const body = await request.json().catch(() => null);
    if (!body) {
      return errorResponse('BAD_REQUEST', 'Request body required.');
    }

    const { email, displayName, role, clientId, assignedClients } = body;

    // 4. Validate required fields
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return errorResponse('BAD_REQUEST', 'Valid email address required.');
    }
    if (!displayName || typeof displayName !== 'string') {
      return errorResponse('BAD_REQUEST', 'displayName required.');
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return errorResponse('BAD_REQUEST', `role must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // 5. Role-specific validation
    if (CLIENT_ROLES.includes(role) && !clientId) {
      return errorResponse('BAD_REQUEST', 'clientId required for client roles.');
    }
    if (role === 'internal-user' && (!assignedClients || !Array.isArray(assignedClients) || assignedClients.length === 0)) {
      return errorResponse('BAD_REQUEST', 'assignedClients required for internal-user role.');
    }

    // 6. Enforce role constraints for client-approver callers
    if (authResult.role === 'client-approver') {
      if (!CLIENT_ROLES.includes(role)) {
        return errorResponse('FORBIDDEN', 'Client-approver can only create client-viewer or client-approver roles.');
      }
      if (clientId !== authResult.clientId) {
        return errorResponse('FORBIDDEN', 'Client-approver can only create users within their own client.');
      }
    }

    // 7. Check for existing user
    try {
      await adminAuth.getUserByEmail(email);
      return errorResponse('CONFLICT', `User with email '${email}' already exists.`);
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string };
      if (firebaseErr.code !== 'auth/user-not-found') {
        throw err;
      }
      // User doesn't exist — good, proceed
    }

    // 8. Create Firebase Auth user with random temp password
    const tempPassword = randomBytes(24).toString('base64url');
    const authUser = await adminAuth.createUser({
      email,
      displayName,
      password: tempPassword,
      emailVerified: false,
    });

    const uid = authUser.uid;
    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;

    // 9. Determine claims
    const effectiveAssignedClients = role === 'internal-admin'
      ? ['*']
      : role === 'internal-user'
        ? assignedClients
        : null;

    const effectiveClientId = CLIENT_ROLES.includes(role) ? clientId : null;
    const permittedModules = getPermittedModules(role);

    // 10. Set custom claims
    await adminAuth.setCustomUserClaims(uid, {
      tenantId,
      role,
      clientId: effectiveClientId,
      assignedClients: effectiveAssignedClients,
      permittedModules,
    });

    // 11. Create Firestore user doc
    const usersRef = adminDb.collection('tenants').doc(tenantId).collection('users');
    await usersRef.doc(uid).set({
      uid,
      email,
      displayName,
      role,
      tenantId,
      clientId: effectiveClientId,
      assignedClients: effectiveAssignedClients,
      status: 'invited',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: authResult.userId || authResult.keyId || null,
      lastLoginAt: null,
      disabledAt: null,
      disabledBy: null,
    });

    // 12. Send password reset link
    let passwordResetSent = false;
    try {
      await adminAuth.generatePasswordResetLink(email);
      passwordResetSent = true;
    } catch (resetErr) {
      console.error(`Failed to generate password reset link for ${email}:`, resetErr);
      // Don't fail the whole operation — user is created, admin can resend
    }

    return NextResponse.json({
      success: true,
      userId: uid,
      email,
      role,
      passwordResetSent,
    }, { status: 201 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('User provisioning error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
