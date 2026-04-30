// =============================================================================
// Angsana Exchange — Local Work Item types (Work Item lite)
//
// Implements the schema defined in r2-pvs-s1-wishlists-spec.md §4. Mirrors
// the platform Work Item Primitive Spec v0.1 §2.1 exactly so that when the
// platform primitive lands (BSP-01-08), migration is a path/access change,
// not a schema change.
//
// Subject-agnostic discipline (spec §10): the Work Item *type* is generic
// over the subject. The four R2 PVS surfaces (Wishlists, Exclusions,
// Conflicts, Relationships) all wire Work Item streams against the same
// component set, distinguished only by the `subject` payload.
// =============================================================================

import type { Timestamp } from 'firebase-admin/firestore';

// ─── Subject ────────────────────────────────────────────────────────────────

/**
 * What a Work Item is *about*. Subject-agnostic by construction: the entity
 * type is a discriminator that the local Work Item collection can hold side
 * by side. Components in src/components/workItems/ MUST NOT branch on
 * `entityType` (spec §10).
 *
 * For Wishlists (this slice): `entityType: 'wishlist'`, `entityId` is the
 * wishlistId. The future Exclusions/Conflicts/Relationships slices add
 * their own entity types without changing the components.
 */
export interface WorkItemSubject {
  scope: 'tenant';
  scopeRef: string; // tenantId
  entityType: 'wishlist'; // R2 PVS Slice 2/3/4 will widen this union
  entityId: string;
}

// ─── Type registry (hard-coded for the lite version) ────────────────────────

/**
 * Per spec §4.2, this slice ships with one type. The type registry will be
 * Firestore-backed when the platform primitive arrives; for now it's a
 * compile-time enum.
 */
export type WorkItemType = 'wishlist-clarification';

/**
 * State machine for `wishlist-clarification` per spec §4.3.
 *
 * - raised → clarified (no comment required, encouraged)
 * - clarified → closed (no comment required)
 * - raised → closed (shortcut close — comment REQUIRED)
 *
 * `closed` is terminal. Re-opens are modelled via supersession (a new Work
 * Item with a `supersedes` relation), not by transitioning back.
 */
export type WishlistClarificationState = 'raised' | 'clarified' | 'closed';

// ─── Activity log ───────────────────────────────────────────────────────────

interface ActivityLogActor {
  uid: string;
  name?: string;
}

/**
 * Activity log entry types used in this slice (spec §4.4). Forward-compatible
 * types from the platform spec (`relation-removed`, `subject-event-referenced`,
 * `archived-changed`) are present in the union for shape-stability but not
 * actively written this slice.
 */
export type ActivityLogEntry =
  | {
      type: 'state-changed';
      from: WishlistClarificationState | null;
      to: WishlistClarificationState;
      by: ActivityLogActor;
      at: Timestamp | string;
      comment?: string;
    }
  | {
      type: 'commented';
      by: ActivityLogActor;
      at: Timestamp | string;
      body: string;
      audience: WorkItemAudience;
    }
  | {
      type: 'assigned';
      from: { uid: string; name?: string } | null;
      to: { uid: string; name?: string } | null;
      by: ActivityLogActor;
      at: Timestamp | string;
    }
  | {
      type: 'audience-changed';
      from: WorkItemAudience;
      to: WorkItemAudience;
      by: ActivityLogActor;
      at: Timestamp | string;
      comment?: string;
    }
  | {
      type: 'relation-added';
      relationType: WorkItemRelationType;
      otherWorkItemRef: string;
      by: ActivityLogActor;
      at: Timestamp | string;
    }
  | {
      type: 'relation-removed';
      relationType: WorkItemRelationType;
      otherWorkItemRef: string;
      by: ActivityLogActor;
      at: Timestamp | string;
    }
  | {
      type: 'archived-changed';
      to: boolean;
      by: ActivityLogActor;
      at: Timestamp | string;
    };

// ─── Audience / visibility ──────────────────────────────────────────────────

/**
 * Audience scope. The `'client'` value is reserved per spec §4.2 for
 * forward-compat with the platform primitive but not produced in this slice
 * (the Raise Question form offers Shared/Internal only). Role gates treat
 * 'client' and 'shared' identically — both visible to client users.
 */
export type WorkItemAudience = 'internal' | 'shared' | 'client';

export type WorkItemVisibility = 'normal' | 'system-only';

export type WorkItemRelationType =
  | 'parent'
  | 'child'
  | 'blocks'
  | 'blocked-by'
  | 'supersedes'
  | 'superseded-by'
  | 'derives-from';

export interface WorkItemRelation {
  relationType: WorkItemRelationType;
  otherWorkItemRef: string;
}

// ─── Work Item ──────────────────────────────────────────────────────────────

/**
 * A Work Item record. Persisted at
 * `tenants/{tenantId}/clients/{clientId}/workItems/{workItemId}` for the
 * lite version (spec §4.1; tenant-scoped path is the platform-primitive
 * future-state).
 */
export interface WorkItem {
  workItemId: string;
  workItemType: WorkItemType;

  subject: WorkItemSubject;

  state: WishlistClarificationState; // narrows by workItemType in this slice
  audience: WorkItemAudience;
  visibility: WorkItemVisibility;
  archived: boolean;

  owner: { uid: string; tenantId: string } | null;
  priority: 'high' | 'medium' | 'low';
  deadline: Timestamp | string | null;

  title: string; // ≤200
  body: string; // ≤2000

  source: { type: string; ref: string } | null;

  relations: WorkItemRelation[];

  activityLog: ActivityLogEntry[];

  createdAt: Timestamp | string;
  createdBy: { uid: string; tenantId: string };
  updatedAt: Timestamp | string;

  tenantId: string;
  scope: 'tenant';

  /**
   * Side-effect provenance marker, used by the migration pattern (§2 row 4)
   * to identify entities created by a specific migration run. Optional.
   */
  sourceMigrationRun?: string;
}

/**
 * Wire-shape activity log entry: same discriminated union as
 * `ActivityLogEntry` but with `at` as ISO string. Distributive conditional
 * type so the union is preserved (TS's `Omit<Union, K>` collapses the
 * discriminator otherwise).
 */
export type ActivityLogEntryWire = ActivityLogEntry extends infer T
  ? T extends { at: Timestamp | string }
    ? Omit<T, 'at'> & { at: string }
    : never
  : never;

/**
 * Wire-shape: timestamps as ISO strings. Used for client serialisation.
 */
export interface WorkItemWire extends Omit<WorkItem, 'createdAt' | 'updatedAt' | 'deadline' | 'activityLog'> {
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  activityLog: ActivityLogEntryWire[];
}

// ─── Display config ─────────────────────────────────────────────────────────

export const WORK_ITEM_STATE_CONFIG: Record<
  WishlistClarificationState,
  { label: string; colour: string; bgColour: string }
> = {
  raised: { label: 'Raised', colour: '#D97706', bgColour: '#FFFBEB' },
  clarified: { label: 'Clarified', colour: '#2563EB', bgColour: '#EFF6FF' },
  closed: { label: 'Closed', colour: '#6B7280', bgColour: '#F3F4F6' },
};

export const WORK_ITEM_AUDIENCE_CONFIG: Record<
  WorkItemAudience,
  { label: string; icon: 'lock' | 'users' | 'user' }
> = {
  internal: { label: 'Internal only', icon: 'lock' },
  shared: { label: 'Shared', icon: 'users' },
  client: { label: 'Client', icon: 'user' },
};

/**
 * Defaults for a wishlist-clarification per spec §4.6.
 */
export const WISHLIST_CLARIFICATION_DEFAULTS = {
  state: 'raised' as WishlistClarificationState,
  audience: 'shared' as WorkItemAudience,
  visibility: 'normal' as WorkItemVisibility,
  priority: 'medium' as const,
};
