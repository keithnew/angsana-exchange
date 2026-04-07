// =============================================================================
// Angsana Exchange — Client Provisioning Endpoint
// Slice 6B: POST /api/v1/exchange/{env}/api/clients/provision
// Creates client config + first user in a single idempotent call.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest } from '@/lib/api/middleware/auth';
import { errorResponse } from '@/lib/api/response';
import { DEFAULT_TENANT_ID } from '@/lib/api/config';
import { sendPasswordResetEmail } from '@/lib/firebase/send-password-reset';
import type { UserRole } from '@/types';

export const runtime = 'nodejs';

const URL_SAFE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLIENT_ROLES: UserRole[] = ['client-approver', 'client-viewer'];
const DEFAULT_CLIENT_MODULES = ['campaigns', 'checkins', 'actions', 'sowhats', 'wishlists', 'documents', 'dashboard'];

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }

    if (authResult.role !== 'internal-admin') {
      return errorResponse('FORBIDDEN', 'Only internal-admin can provision clients.');
    }

    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('BAD_REQUEST', 'Request body required.');

    const { clientId, clientName, sfAccountId, tier, capabilities, firstUser } = body;

    // Validate clientId
    if (!clientId || !URL_SAFE_REGEX.test(clientId)) {
      return errorResponse('BAD_REQUEST', 'clientId must be URL-safe (lowercase alphanumeric + hyphens).');
    }
    if (!clientName) return errorResponse('BAD_REQUEST', 'clientName required.');
    if (!firstUser?.email || !firstUser.email.includes('@')) {
      return errorResponse('BAD_REQUEST', 'firstUser.email required and must be valid.');
    }
    if (!firstUser?.displayName) return errorResponse('BAD_REQUEST', 'firstUser.displayName required.');

    const firstUserRole: UserRole = firstUser.role && CLIENT_ROLES.includes(firstUser.role)
      ? firstUser.role : 'client-approver';

    const tenantId = authResult.tenantId || DEFAULT_TENANT_ID;
    const clientRef = adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId);
    const clientDoc = await clientRef.get();

    // Create client config if it doesn't exist (idempotent)
    if (!clientDoc.exists) {
      await clientRef.set({
        name: clientName,
        slug: clientId,
        sfAccountId: sfAccountId || null,
        tier: tier || 'standard',
        capabilities: capabilities || [],
        status: 'active',
        therapyAreas: [],
        conflictedTherapyAreas: [],
        competitors: [],
        logoPath: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Create first user — check if already exists
    let uid: string;
    let userCreated = false;
    try {
      const existing = await adminAuth.getUserByEmail(firstUser.email);
      uid = existing.uid;
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string };
      if (firebaseErr.code !== 'auth/user-not-found') throw err;

      const tempPassword = randomBytes(24).toString('base64url');
      const authUser = await adminAuth.createUser({
        email: firstUser.email,
        displayName: firstUser.displayName,
        password: tempPassword,
        emailVerified: false,
      });
      uid = authUser.uid;
      userCreated = true;
    }

    const permittedModules = firstUserRole === 'client-approver'
      ? [...DEFAULT_CLIENT_MODULES, 'approvals'] : DEFAULT_CLIENT_MODULES;

    // Set claims
    await adminAuth.setCustomUserClaims(uid, {
      tenantId,
      role: firstUserRole,
      clientId,
      assignedClients: null,
      permittedModules,
    });

    // Create Firestore user doc
    const usersRef = adminDb.collection('tenants').doc(tenantId).collection('users');
    await usersRef.doc(uid).set({
      uid,
      email: firstUser.email,
      displayName: firstUser.displayName,
      role: firstUserRole,
      tenantId,
      clientId,
      assignedClients: null,
      status: 'invited',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: authResult.userId || authResult.keyId || null,
      lastLoginAt: null,
      disabledAt: null,
      disabledBy: null,
    }, { merge: true });

    // Send password reset email via Firebase Auth REST API
    // (Admin SDK's generatePasswordResetLink only returns a URL — it does NOT send an email)
    let passwordResetSent = false;
    try {
      await sendPasswordResetEmail(firstUser.email);
      passwordResetSent = true;
    } catch { /* non-fatal */ }

    return NextResponse.json({
      success: true,
      clientId,
      userId: uid,
      userCreated,
      passwordResetSent,
    }, { status: 201 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Client provisioning error:', message);
    return errorResponse('INTERNAL_ERROR', message);
  }
}
