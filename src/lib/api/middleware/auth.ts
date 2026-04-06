// =============================================================================
// Angsana Exchange — API Auth Middleware
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Multi-method auth resolution: Firebase ID token → API key → Client JWT (placeholder).
// First valid method wins. All resolve to a normalised ApiAuthContext.
// =============================================================================

import { createHash } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { hasClientAccess } from '@/lib/auth/server';
import { DEFAULT_TENANT_ID } from '../config';
import type { ApiAuthContext } from '../types';
import type { UserRole, AuthClaims } from '@/types';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Authenticate an API request. Checks for credentials in this order:
 * 1. Firebase ID Token (Authorization: Bearer {token})
 * 2. API Key (x-api-key: {key})
 * 3. Client JWT (placeholder — returns explicit error)
 *
 * Returns an ApiAuthContext on success, or an error tuple [code, message].
 */
export async function authenticateRequest(
  request: Request
): Promise<ApiAuthContext | { error: true; code: string; message: string }> {
  const authHeader = request.headers.get('authorization') || '';
  const apiKeyHeader = request.headers.get('x-api-key') || '';

  // ─── Method 1: Firebase ID Token ────────────────────────────────────────
  if (authHeader.startsWith('Bearer ') && authHeader.length > 7) {
    const token = authHeader.slice(7).trim();

    // Check if this looks like a JWT (starts with eyJ) vs a client JWT
    // Client JWTs would have a different issuer — detect and reject
    try {
      // Quick check: try to decode header to see issuer
      const headerPart = token.split('.')[0];
      if (headerPart) {
        const decoded = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
        // If this has a kid from our Firebase project, proceed with Firebase verification
        // If it has a different issuer hint, check for client JWT
        if (decoded.kid === undefined && decoded.alg) {
          // Might be a self-issued JWT — check payload for issuer
          try {
            const payloadPart = token.split('.')[1];
            if (payloadPart) {
              const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
              if (payload.iss === 'exchange.angsana-uk.com') {
                return {
                  error: true,
                  code: 'CLIENT_JWT_NOT_IMPLEMENTED',
                  message: 'Client JWT authentication is not yet available. Use API key or Firebase authentication.',
                };
              }
            }
          } catch {
            // Not parseable — fall through to Firebase verification
          }
        }
      }
    } catch {
      // Not parseable header — fall through to Firebase verification
    }

    try {
      const decodedToken = await adminAuth.verifyIdToken(token);

      const role = (decodedToken.role as UserRole) || 'client-viewer';
      const tenantId = (decodedToken.tenantId as string) || DEFAULT_TENANT_ID;
      const clientId = (decodedToken.clientId as string) || undefined;
      const assignedClients = (decodedToken.assignedClients as string[]) || undefined;
      const permittedModules = (decodedToken.permittedModules as string[]) || undefined;

      return {
        method: 'firebase',
        tenantId,
        role,
        clientId,
        assignedClients,
        userId: decodedToken.uid,
        permittedModules,
        permissions: derivePermissions(role),
      };
    } catch {
      // Token invalid — don't fall through, this was an explicit Bearer token attempt
      return {
        error: true,
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired Firebase ID token.',
      };
    }
  }

  // ─── Method 2: API Key ──────────────────────────────────────────────────
  if (apiKeyHeader) {
    return authenticateApiKey(apiKeyHeader);
  }

  // ─── No credentials ────────────────────────────────────────────────────
  return {
    error: true,
    code: 'UNAUTHORIZED',
    message: 'Authentication required. Provide a Firebase ID token (Authorization: Bearer) or API key (x-api-key).',
  };
}

/**
 * Authenticate via API key. Hash the raw key, look it up in Firestore.
 */
async function authenticateApiKey(
  rawKey: string
): Promise<ApiAuthContext | { error: true; code: string; message: string }> {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // Query apiKeys collection for this hash
  const keysRef = adminDb
    .collection('tenants')
    .doc(DEFAULT_TENANT_ID)
    .collection('apiKeys');

  const snapshot = await keysRef
    .where('keyHash', '==', keyHash)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return {
      error: true,
      code: 'UNAUTHORIZED',
      message: 'Invalid API key.',
    };
  }

  const keyDoc = snapshot.docs[0];
  const keyData = keyDoc.data();

  // Check if revoked
  if (keyData.status === 'revoked') {
    return {
      error: true,
      code: 'API_KEY_REVOKED',
      message: 'This API key has been revoked.',
    };
  }

  // Update lastUsedAt (fire-and-forget, non-blocking)
  keyDoc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {
    // Ignore — failed lastUsedAt update should not affect the request
  });

  return {
    method: 'apiKey',
    tenantId: keyData.tenantId || DEFAULT_TENANT_ID,
    role: keyData.role as UserRole,
    clientId: keyData.clientId || undefined,
    keyId: keyDoc.id,
    permissions: derivePermissions(keyData.role as UserRole),
  };
}

/**
 * Resolve the effective clientId for a request.
 * Auth context clientId takes priority (cannot be overridden).
 * Falls back to query parameter clientId for internal users.
 *
 * Returns the resolved clientId or an error tuple.
 */
export function resolveClientId(
  authContext: ApiAuthContext,
  queryClientId?: string
): string | { error: true; code: string; message: string } {
  // Auth context clientId takes absolute priority
  if (authContext.clientId) {
    return authContext.clientId;
  }

  // Internal users provide clientId as query param
  if (queryClientId) {
    // Check assignedClients access using the existing helper pattern
    const claims: AuthClaims = {
      tenantId: authContext.tenantId,
      role: authContext.role,
      clientId: authContext.clientId || null,
      assignedClients: authContext.assignedClients || null,
      permittedModules: authContext.permittedModules || [],
    };

    if (!hasClientAccess(claims, queryClientId)) {
      return {
        error: true,
        code: 'CLIENT_ACCESS_DENIED',
        message: `You do not have access to client '${queryClientId}'.`,
      };
    }

    return queryClientId;
  }

  // No clientId available
  return {
    error: true,
    code: 'CLIENT_ID_REQUIRED',
    message: 'A clientId is required for this collection. Provide it as a query parameter.',
  };
}

/**
 * Derive basic permissions from role.
 * Future: permissions can come from API key scope.
 */
function derivePermissions(role: UserRole): string[] {
  switch (role) {
    case 'internal-admin':
      return ['read', 'write', 'delete', 'admin'];
    case 'internal-user':
      return ['read', 'write', 'delete'];
    case 'client-approver':
      return ['read', 'write'];
    case 'client-viewer':
      return ['read'];
    default:
      return ['read'];
  }
}
