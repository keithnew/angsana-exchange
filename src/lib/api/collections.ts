// =============================================================================
// Angsana Exchange — Collection Mapping
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Static lookup from URL slug to Firestore path, scope, and permitted
// operations per role. Decouples the API surface from Firestore naming.
// All Firestore paths are relative to tenants/{tenantId}/.
// =============================================================================

import type { CollectionConfig } from './types';
import type { UserRole } from '@/types';

// ─── Full CRUD for internal roles ───────────────────────────────────────────
const INTERNAL_FULL: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const INTERNAL_READ: readonly string[] = ['GET'] as const;
const CLIENT_APPROVER_RW: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH'] as const;
const CLIENT_READ: readonly string[] = ['GET'] as const;
const NONE: readonly string[] = [] as const;

// ─── Collection Registry ────────────────────────────────────────────────────

export const COLLECTIONS: Record<string, CollectionConfig> = {
  campaigns: {
    slug: 'campaigns',
    firestorePath: 'clients/{clientId}/campaigns',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_READ,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Campaign entity with targeting, messaging, lifecycle',
  },

  checkins: {
    slug: 'checkins',
    firestorePath: 'clients/{clientId}/checkIns',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_READ,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Structured check-in records',
  },

  actions: {
    slug: 'actions',
    firestorePath: 'clients/{clientId}/actions',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_APPROVER_RW,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Task/action tracker',
  },

  wishlists: {
    slug: 'wishlists',
    firestorePath: 'clients/{clientId}/wishlists',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_APPROVER_RW,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Target company wishlists',
  },

  sowhats: {
    slug: 'sowhats',
    firestorePath: 'clients/{clientId}/soWhats',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_APPROVER_RW,
      'client-viewer': CLIENT_READ,
    },
    notes: 'So What message library',
  },

  dnc: {
    slug: 'dnc',
    firestorePath: 'clients/{clientId}/dnc',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_READ,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Do-not-contact list (future data)',
  },

  msapsl: {
    slug: 'msapsl',
    firestorePath: 'clients/{clientId}/msaPsl',
    scope: 'client',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_FULL,
      'client-approver': CLIENT_READ,
      'client-viewer': CLIENT_READ,
    },
    notes: 'MSA/PSL records (future data)',
  },

  users: {
    slug: 'users',
    firestorePath: 'users',
    scope: 'tenant',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_READ,
      'client-approver': NONE,
      'client-viewer': NONE,
    },
    notes: 'User records synced from Firebase Auth',
  },

  clients: {
    slug: 'clients',
    firestorePath: 'clients',
    scope: 'tenant',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_READ,
      'client-approver': NONE,
      'client-viewer': NONE,
    },
    notes: 'Client config documents',
  },

  apikeys: {
    slug: 'apikeys',
    firestorePath: 'apiKeys',
    scope: 'tenant',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': NONE,
      'client-approver': NONE,
      'client-viewer': NONE,
    },
    notes: 'API key metadata — internal-admin only',
  },

  managedlists: {
    slug: 'managedlists',
    firestorePath: 'managedLists/{listType}',
    scope: 'tenant',
    allowedOperations: {
      'internal-admin': INTERNAL_FULL,
      'internal-user': INTERNAL_READ,
      'client-approver': CLIENT_READ,
      'client-viewer': CLIENT_READ,
    },
    notes: 'Requires listType query parameter',
  },
};

/**
 * Look up a collection config by URL slug.
 * Returns undefined for unknown slugs (results in 400 INVALID_COLLECTION).
 */
export function getCollectionConfig(slug: string): CollectionConfig | undefined {
  return COLLECTIONS[slug];
}

/**
 * Check whether a given HTTP method is allowed for a role on a collection.
 */
export function isOperationAllowed(
  config: CollectionConfig,
  role: UserRole,
  method: string
): boolean {
  const allowed = config.allowedOperations[role];
  return allowed.includes(method);
}

/**
 * Build the full Firestore path for a collection, resolving {clientId} and
 * {listType} placeholders.
 */
export function resolveFirestorePath(
  config: CollectionConfig,
  tenantId: string,
  clientId?: string,
  listType?: string
): string {
  let path = `tenants/${tenantId}/${config.firestorePath}`;

  if (clientId) {
    path = path.replace('{clientId}', clientId);
  }
  if (listType) {
    path = path.replace('{listType}', listType);
  }

  return path;
}

/**
 * Get all valid collection slugs (for error messages).
 */
export function getValidSlugs(): string[] {
  return Object.keys(COLLECTIONS);
}
