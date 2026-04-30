// =============================================================================
// Angsana Exchange — Wishlist R2 types
//
// Implements the schema defined in
// docs/architecture/r2-pvs-s1-wishlists-spec.md §3. The R2 Wishlist record
// supersedes the R1 `WishlistItem` shape (still defined in src/types/index.ts
// for legacy compatibility — see also `src/lib/wishlists/readAdapter.ts`).
// =============================================================================

import type { Timestamp } from 'firebase-admin/firestore';

/**
 * Canonical company reference. Two flavours: a resolved Salesforce Account
 * (`salesforce-account`) or a candidate (named but not yet resolved).
 *
 * For this slice (R2 PVS Slice 1), all newly-added companies are written as
 * `candidate` — Salesforce match resolution lands with Refinery integration
 * (future slice). The `companyName` denormalised on the Wishlist entry tracks
 * the SF Account display name when type is `salesforce-account`, or the
 * user-entered string when type is `candidate`.
 */
export interface CompanyRef {
  type: 'salesforce-account' | 'candidate';
  sfAccountId?: string;
  candidateId?: string;
}

/**
 * Targeting hint — controlled-vocabulary classification of a wishlist entry's
 * targeting intent. Drawn from the existing R1 managed lists (therapy areas,
 * sectors, geographies, service types). Display name denormalised for
 * convenience.
 */
export interface TargetingHint {
  type: 'therapy-area' | 'sector' | 'geography' | 'service-type';
  managedListRef: { listId: string; itemId: string };
  displayName: string;
}

/** Provenance of a wishlist entry. */
export type WishlistSource =
  | 'client-request'
  | 'internal-research'
  | 'conference-list'
  | 'industry-event'
  | 'ai-suggestion'
  | 'migration'
  | 'other';

/** Lifecycle status. Same set as R1; re-declared here against the R2 type. */
export type WishlistStatus = 'new' | 'under-review' | 'added-to-target-list' | 'rejected';

export type WishlistPriority = 'high' | 'medium' | 'low';

/**
 * R2 Wishlist record. Persisted at
 * `tenants/{tenantId}/clients/{clientId}/wishlists/{wishlistId}`.
 *
 * `schemaVersion` follows the Migration Pattern v0.1 §3.2 `{pattern}-v{n}`
 * shape. Documents written by the R1 codebase do NOT carry this marker;
 * see `src/lib/wishlists/readAdapter.ts` for the read-time normaliser used
 * on non-Cegid clients pre-migration.
 */
export interface WishlistEntry {
  // Identity
  wishlistId: string;
  companyRef: CompanyRef | null;
  companyName: string | null;

  // Classification
  priority: WishlistPriority;
  status: WishlistStatus;

  // Linkage
  campaignRefs: string[];

  // Targeting
  targetingHints: TargetingHint[];
  targetingHintsRaw: string | null;

  // Provenance
  source: WishlistSource;
  sourceDetail: string | null;

  // Audit (server times when read via Admin; ISO strings when serialised to client).
  addedBy: { uid: string; name: string };
  addedAt: Timestamp | string;
  updatedBy: { uid: string; name: string };
  updatedAt: Timestamp | string;

  // Lifecycle
  archived: boolean;

  // Schema version marker (added by R2 migration; absent on legacy R1 docs).
  schemaVersion?: 'r2-pvs-wishlist-v1';
}

/**
 * Wire-shape variant of WishlistEntry. All Firestore Timestamps are ISO
 * strings. Used for server→client serialisation and API responses.
 */
export interface WishlistEntryWire extends Omit<WishlistEntry, 'addedAt' | 'updatedAt'> {
  addedAt: string;
  updatedAt: string;
  /**
   * Optional augmentation when GET is invoked with `?includeOpenItemCounts=true`.
   * Reflects current count of non-closed, non-archived Work Items whose
   * `subject.entityId` equals this wishlistId. See spec §7.7.
   */
  openItemCount?: number;
  /**
   * Highest priority among open Work Items, used to colour the Open Items
   * pill in the table (spec §11). Null when no open items.
   */
  openItemHighestPriority?: 'high' | 'medium' | 'low' | null;
}

// ─── Display configuration ──────────────────────────────────────────────────

export const WISHLIST_STATUS_R2_CONFIG: Record<
  WishlistStatus,
  { label: string; colour: string; bgColour: string }
> = {
  new: { label: 'New', colour: '#2563EB', bgColour: '#EFF6FF' },
  'under-review': { label: 'Under Review', colour: '#D97706', bgColour: '#FFFBEB' },
  'added-to-target-list': { label: 'Added to Target List', colour: '#059669', bgColour: '#ECFDF5' },
  rejected: { label: 'Rejected', colour: '#DC2626', bgColour: '#FEF2F2' },
};

export const WISHLIST_PRIORITY_R2_CONFIG: Record<
  WishlistPriority,
  { label: string; colour: string; bgColour: string }
> = {
  high: { label: 'High', colour: '#DC2626', bgColour: '#FEF2F2' },
  medium: { label: 'Medium', colour: '#D97706', bgColour: '#FFFBEB' },
  low: { label: 'Low', colour: '#6B7280', bgColour: '#F3F4F6' },
};

export const WISHLIST_SOURCE_CONFIG: Record<WishlistSource, { label: string }> = {
  'client-request': { label: 'Client request' },
  'internal-research': { label: 'Internal research' },
  'conference-list': { label: 'Conference list' },
  'industry-event': { label: 'Industry event' },
  'ai-suggestion': { label: 'AI suggestion' },
  migration: { label: 'Migrated from R1' },
  other: { label: 'Other' },
};

/**
 * The four targeting hint managed-list keys. Display ordering for the form
 * pickers is the array order.
 */
export const TARGETING_HINT_TYPES: TargetingHint['type'][] = [
  'therapy-area',
  'sector',
  'geography',
  'service-type',
];

export const TARGETING_HINT_TYPE_CONFIG: Record<
  TargetingHint['type'],
  { label: string; colour: string; bgColour: string; managedListId: string }
> = {
  'therapy-area': {
    label: 'Therapy area',
    colour: '#7C3AED',
    bgColour: '#EDE9FE',
    managedListId: 'therapyAreas',
  },
  sector: {
    label: 'Sector',
    colour: '#2563EB',
    bgColour: '#EFF6FF',
    managedListId: 'sectors',
  },
  geography: {
    label: 'Geography',
    colour: '#0D9488',
    bgColour: '#CCFBF1',
    managedListId: 'geographies',
  },
  'service-type': {
    label: 'Service type',
    colour: '#D97706',
    bgColour: '#FFFBEB',
    managedListId: 'serviceTypes',
  },
};

/** Sources that require a `sourceDetail` follow-up entry per spec §3.5. */
export const SOURCES_REQUIRING_DETAIL: WishlistSource[] = [
  'conference-list',
  'industry-event',
  'other',
];
