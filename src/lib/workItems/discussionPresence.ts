// =============================================================================
// Discussion-presence helper
//
// Implements the "discussion-presence indicator" requirement from the
// Wishlists v0.2 slice spec §2.4 / acceptance #4.
//
// What it does:
//   For a given client's workItems collection, return a per-entity bucket
//   describing whether there is "substantive discussion" attached:
//     • at least one OPEN Work Item (state ∈ {raised, clarified}), OR
//     • at least one Work Item (open OR closed) updated within the recency
//       window (default 7 days; v0.2 spec §2.4).
//
// Why a separate helper from `openItemCounts`:
//   The existing helper buckets *only* open items and is the source of
//   the "Open items" pill on the table. Discussion presence is a strictly
//   broader signal — recently-closed items count too. Folding both into
//   a single helper would have made the open-items consumers carry
//   recency state they don't need.
//
// Watchpoint per v0.2 spec §8 (the second bullet):
//   This helper is implemented for the Wishlists slice but holds NO
//   wishlist-specific knowledge. The contract is "given a subject
//   entityType and a recency window, fetch open + recently-updated
//   work items and bucket by subject.entityId". When Conflicts /
//   Exclusions / Relationships need the same indicator, they call this
//   same helper with their own entityType — no fork required.
//
// Audience-gating mirrors `computeOpenItemCounts`: when `hideInternal`
// is true, items with `audience: 'internal'` are excluded.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import type { Timestamp } from 'firebase-admin/firestore';
import type { WorkItemSubject } from '@/types/workItem';

/**
 * Default recency window for "recently updated". The v0.2 spec §2.4 names
 * seven days as the default, with the value held as internal config so
 * it can be tuned without a deploy. This constant is the default; the
 * page-level call may override it from a future settings doc.
 */
export const DEFAULT_RECENCY_WINDOW_DAYS = 7;

export interface DiscussionPresenceBucket {
  /** True when the entity has at least one open (raised or clarified) Work Item. */
  hasOpenItem: boolean;
  /** Total Work Items updated within the recency window (open OR closed). */
  recentlyUpdatedCount: number;
  /**
   * ISO-8601 string of the most recent `updatedAt` across the entity's
   * Work Items. Null when the entity has no Work Items at all (in which
   * case the entity won't appear in the returned map). Useful for the
   * tooltip on hover ("last update: 2 days ago").
   */
  mostRecentUpdateAt: string | null;
}

export interface DiscussionPresenceParams {
  tenantId: string;
  clientId: string;
  /**
   * Filter Work Items to those whose `subject.entityType` matches. When
   * omitted, all Work Items in the client's collection are bucketed.
   * Wishlists callers pass `'wishlist'`; future surfaces pass their own
   * entity type.
   */
  subjectEntityType?: string;
  /** When true, exclude items with `audience: 'internal'`. */
  hideInternal: boolean;
  /** Recency window for "recently updated". Defaults to 7 days. */
  recencyWindowDays?: number;
  /**
   * Reference instant for the recency window. Defaults to `new Date()`.
   * Exposed for testability — the unit tests pin a known instant so
   * the boundary case ("exactly N days ago") is deterministic.
   */
  now?: Date;
}

const OPEN_STATES: ReadonlySet<string> = new Set(['raised', 'clarified']);

/**
 * Coerce a Firestore timestamp / Date / ISO string into a millis-since-epoch
 * number. Returns null when the input is missing or unparseable.
 *
 * Mirrors the tolerant coercion in `lib/wishlists/readAdapter.ts:tsToISO`
 * — the {_seconds, _nanoseconds} plain-object shape can occur when a
 * doc has been hand-written by a script not going through the admin SDK.
 */
function coerceMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (value instanceof Date) return value.getTime();
  const v = value as Partial<Timestamp> & { _seconds?: number; seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const seconds = v._seconds ?? v.seconds;
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  return null;
}

/**
 * Scan a client's Work Items and return discussion-presence buckets keyed
 * by `subject.entityId`.
 *
 * The scan is a single Firestore read with an in-memory predicate. At
 * Cegid-Spain volume this is fine; the same scale-up note from
 * `computeOpenItemCounts` applies (move to a denormalised counter on
 * the subject entity when it becomes a hot path).
 *
 * Entities with NO matching Work Items are absent from the map (a
 * caller iterating its entities should default missing entries to
 * `{ hasOpenItem: false, recentlyUpdatedCount: 0, mostRecentUpdateAt: null }`).
 */
export async function computeDiscussionPresence(
  params: DiscussionPresenceParams
): Promise<Map<string, DiscussionPresenceBucket>> {
  const {
    tenantId,
    clientId,
    subjectEntityType,
    hideInternal,
    recencyWindowDays = DEFAULT_RECENCY_WINDOW_DAYS,
    now = new Date(),
  } = params;

  const recencyCutoff = now.getTime() - recencyWindowDays * 24 * 60 * 60 * 1000;

  const workItemsRef = adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems');

  // Single full-collection read; we filter in memory because the predicate
  // is a disjunction (open OR recently-updated) which Firestore can't
  // express in one query without a composite-OR index. The collection is
  // small at current scale — see header note.
  const snap = await workItemsRef.get();

  const buckets = new Map<string, DiscussionPresenceBucket>();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;

    if (data.archived) continue;

    const audience = (data.audience as string | undefined) ?? 'shared';
    if (hideInternal && audience === 'internal') continue;

    const subject = data.subject as WorkItemSubject | undefined;
    if (!subject?.entityId) continue;
    if (subjectEntityType && subject.entityType !== subjectEntityType) continue;

    const state = data.state as string | undefined;
    const isOpen = !!state && OPEN_STATES.has(state);

    const updatedMs = coerceMillis(data.updatedAt);
    const isRecentlyUpdated = updatedMs !== null && updatedMs >= recencyCutoff;

    // Substantive discussion = open OR recently updated. If neither, this
    // Work Item doesn't contribute to the indicator. We still let it
    // update `mostRecentUpdateAt` if it's the most recent we've seen for
    // this entity (the tooltip wants the absolute most recent, not
    // "most recent within the substantive set").
    const contributes = isOpen || isRecentlyUpdated;
    if (!contributes) continue;

    const entityId = subject.entityId;
    const cur = buckets.get(entityId) ?? {
      hasOpenItem: false,
      recentlyUpdatedCount: 0,
      mostRecentUpdateAt: null as string | null,
    };

    if (isOpen) cur.hasOpenItem = true;
    if (isRecentlyUpdated) cur.recentlyUpdatedCount += 1;

    if (updatedMs !== null) {
      const curMs = cur.mostRecentUpdateAt
        ? Date.parse(cur.mostRecentUpdateAt)
        : -Infinity;
      if (updatedMs > curMs) {
        cur.mostRecentUpdateAt = new Date(updatedMs).toISOString();
      }
    }

    buckets.set(entityId, cur);
  }

  return buckets;
}
