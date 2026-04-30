// =============================================================================
// Shared request-user helper
//
// All Exchange API routes pull user identity out of headers set by the
// auth middleware. This module factors that pattern so refactors (e.g. when
// the platform identity client lands) only touch one file.
//
// IMPORTANT: this is the same shape used inline in pre-R2 routes. New
// routes (R2 PVS Slice 1+) should import from here. Older routes are left
// alone — they will be migrated piecemeal.
// =============================================================================

import type { NextRequest } from 'next/server';

export interface RequestUser {
  uid: string;
  role: string;
  tenantId: string;
  email: string;
  /** When set, the user is a client user constrained to that single client. */
  clientId: string | null;
  /** For internal users; '*' = all-clients (admin), otherwise explicit list. */
  assignedClients: string[];
  /** Display name (when available) for activity-log etc. */
  name: string;
}

export function getRequestUser(request: NextRequest): RequestUser {
  return {
    uid: request.headers.get('x-user-uid') || '',
    role: request.headers.get('x-user-role') || '',
    tenantId: request.headers.get('x-user-tenant') || 'angsana',
    email: request.headers.get('x-user-email') || '',
    clientId: request.headers.get('x-user-client') || null,
    assignedClients: JSON.parse(request.headers.get('x-assigned-clients') || '[]'),
    name:
      request.headers.get('x-user-display-name') ||
      request.headers.get('x-user-email') ||
      '',
  };
}

export function isInternal(user: RequestUser): boolean {
  return user.role === 'internal-admin' || user.role === 'internal-user';
}

export function isInternalAdmin(user: RequestUser): boolean {
  return user.role === 'internal-admin';
}

export function canWriteWishlist(user: RequestUser): boolean {
  return (
    user.role === 'internal-admin' ||
    user.role === 'internal-user' ||
    user.role === 'client-approver'
  );
}

export function hasClientAccess(user: RequestUser, clientId: string): boolean {
  if (user.clientId) return user.clientId === clientId;
  if (user.assignedClients?.includes('*')) return true;
  return user.assignedClients?.includes(clientId) ?? false;
}

/** Convert a RequestUser to the `{ uid, name }` shape used in audit fields. */
export function toActor(user: RequestUser): { uid: string; name: string } {
  return { uid: user.uid, name: user.name || user.email };
}
