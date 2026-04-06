import { headers } from 'next/headers';
import type { UserContext, AuthClaims, UserRole } from '@/types';

/**
 * Read the authenticated user's context from request headers.
 *
 * The middleware verifies the Firebase ID token and forwards the claims
 * as request headers. This function reads them in server components
 * and API routes — no re-verification needed.
 *
 * Must only be called from server components or API routes
 * (not from 'use client' components).
 */
export async function getUserContext(): Promise<UserContext> {
  const headersList = await headers();

  const uid = headersList.get('x-user-uid') || '';
  const email = headersList.get('x-user-email') || '';
  const displayName = headersList.get('x-user-display-name') || '';
  const role = (headersList.get('x-user-role') || 'client-viewer') as UserRole;
  const tenantId = headersList.get('x-user-tenant') || 'angsana';
  const clientId = headersList.get('x-user-client') || null;

  let assignedClients: string[] | null = null;
  try {
    const raw = headersList.get('x-assigned-clients');
    if (raw) assignedClients = JSON.parse(raw);
  } catch {
    assignedClients = null;
  }

  let permittedModules: string[] = [];
  try {
    const raw = headersList.get('x-permitted-modules');
    if (raw) permittedModules = JSON.parse(raw);
  } catch {
    permittedModules = [];
  }

  const claims: AuthClaims = {
    tenantId,
    role,
    clientId: clientId || null,
    assignedClients,
    permittedModules,
  };

  return { uid, email, displayName, claims };
}

/**
 * Check if a user role is an internal role (internal-admin or internal-user).
 */
export function isInternalRole(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

/**
 * Check if a user has access to a specific client.
 */
export function hasClientAccess(
  claims: AuthClaims,
  clientId: string
): boolean {
  // Client users can only access their own client
  if (claims.clientId) {
    return claims.clientId === clientId;
  }

  // Internal admin has unrestricted access (by role, not just assignedClients)
  if (claims.role === 'internal-admin') {
    return true;
  }

  // Internal admin with wildcard access (legacy check)
  if (claims.assignedClients?.includes('*')) {
    return true;
  }

  // Internal user with explicit assignment
  return claims.assignedClients?.includes(clientId) ?? false;
}
