// =============================================================================
// Wishlist read adapter
//
// Normalises both R1 and R2-shaped Firestore wishlist documents into the
// canonical R2 in-memory shape (WishlistEntry). Used by the page loader and
// API GET handlers so that:
//   - Cegid Spain (post-migration) — pure R2 read
//   - Other tenants/clients (pre-migration) — R1 docs lifted on the fly
//
// Per spec §3.7, the on-the-fly normaliser preserves R1 data without writing
// it back; the only durable upgrade path is the migration script. Read-time
// normalisation has no side-effects on the document.
// =============================================================================

import type { Timestamp } from 'firebase-admin/firestore';
import type {
  CompanyRef,
  TargetingHint,
  WishlistEntry,
  WishlistEntryWire,
  WishlistPriority,
  WishlistStatus,
  WishlistSource,
} from '@/types/wishlist';

/** R1 (legacy) wishlist document shape, kept here for clarity. */
interface LegacyWishlistDoc {
  companyName?: string;
  sector?: string;
  geography?: string;
  priority?: string;
  notes?: string;
  status?: string;
  campaignRef?: string;
  addedBy?: string;
  addedDate?: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
}

/** Either an R1 or R2 raw doc body. */
export type RawWishlistDoc = Partial<WishlistEntry> & LegacyWishlistDoc;

const VALID_PRIORITIES: ReadonlySet<WishlistPriority> = new Set([
  'high',
  'medium',
  'low',
]);

const VALID_STATUSES: ReadonlySet<WishlistStatus> = new Set([
  'new',
  'under-review',
  'added-to-target-list',
  'rejected',
]);

function isR2(raw: RawWishlistDoc): boolean {
  return raw.schemaVersion === 'r2-pvs-wishlist-v1';
}

function normalisePriority(value: unknown): WishlistPriority {
  if (typeof value === 'string' && VALID_PRIORITIES.has(value as WishlistPriority)) {
    return value as WishlistPriority;
  }
  return 'medium';
}

function normaliseStatus(value: unknown): WishlistStatus {
  if (typeof value === 'string' && VALID_STATUSES.has(value as WishlistStatus)) {
    return value as WishlistStatus;
  }
  return 'new';
}

function tsToISO(value: Timestamp | Date | string | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  // Firestore Timestamp
  if (typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate().toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Read-time normaliser. Produces a wire-shape WishlistEntry regardless of
 * whether the input is R1 or R2.
 *
 * Lossless for R2; the R1 → R2 lift is documented in spec §3.7:
 *   - sector/geography → empty targetingHints[] (NOT mapped automatically;
 *     migration script does the lift, see scripts/migrate-wishlists-r2.ts)
 *   - notes → null on the document; preserved at read-time only via the
 *     classifier output during migration. Non-Cegid clients pre-migration
 *     keep their notes visible read-only as targetingHintsRaw, allowing
 *     clients to see context until they migrate.
 *   - campaignRef (single) → campaignRefs[] (single-element array, or [])
 *   - addedBy (email string) → { uid: '', name: <email> }
 *   - source → 'migration' (sentinel; the migration script writes the real
 *     value when it lifts the doc — read-time normalisation just notes
 *     that this is a legacy doc).
 */
export function readWishlistEntry(
  wishlistId: string,
  raw: RawWishlistDoc
): WishlistEntryWire {
  if (isR2(raw)) {
    return {
      wishlistId,
      companyRef: raw.companyRef ?? null,
      companyName: raw.companyName ?? null,
      priority: raw.priority ?? 'medium',
      status: raw.status ?? 'new',
      campaignRefs: raw.campaignRefs ?? [],
      targetingHints: raw.targetingHints ?? [],
      targetingHintsRaw: raw.targetingHintsRaw ?? null,
      source: raw.source ?? 'migration',
      sourceDetail: raw.sourceDetail ?? null,
      addedBy: raw.addedBy ?? { uid: '', name: '' },
      addedAt: tsToISO(raw.addedAt as Timestamp | Date | string | undefined),
      updatedBy: raw.updatedBy ?? raw.addedBy ?? { uid: '', name: '' },
      updatedAt: tsToISO(raw.updatedAt as Timestamp | Date | string | undefined),
      archived: raw.archived ?? false,
      schemaVersion: 'r2-pvs-wishlist-v1',
    };
  }

  // R1 lift
  const companyName = raw.companyName?.trim() || null;
  const companyRef: CompanyRef | null = companyName
    ? { type: 'candidate' }
    : null;

  const targetingHints: TargetingHint[] = []; // not auto-mapped, see header

  // R1 notes are surfaced as targetingHintsRaw read-only (banner in edit form)
  // for non-migrated clients. Empty string → null.
  const targetingHintsRaw = raw.notes?.trim() || null;

  const campaignRefs = raw.campaignRef ? [raw.campaignRef] : [];

  const addedByName = raw.addedBy ?? '';
  const addedBy = { uid: '', name: addedByName };

  const source: WishlistSource = 'migration';

  return {
    wishlistId,
    companyRef,
    companyName,
    priority: normalisePriority(raw.priority),
    status: normaliseStatus(raw.status),
    campaignRefs,
    targetingHints,
    targetingHintsRaw,
    source,
    sourceDetail: null,
    addedBy,
    addedAt: tsToISO(raw.addedDate ?? raw.addedAt),
    updatedBy: addedBy,
    updatedAt: tsToISO(raw.updatedAt ?? raw.addedDate ?? raw.addedAt),
    archived: false,
    // No schemaVersion — flagging that this is an R1 doc to anything that
    // cares (display, mostly). Migration writes the real marker.
  };
}

/**
 * Heuristic: does this raw doc look like it was upgraded by the migration
 * script (i.e. has the R2 marker)? Used by GET handlers and migration
 * idempotency checks.
 */
export function isUpgraded(raw: RawWishlistDoc): boolean {
  return raw.schemaVersion === 'r2-pvs-wishlist-v1';
}
