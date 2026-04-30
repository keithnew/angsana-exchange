// =============================================================================
// Shared open-items count helper
//
// One implementation of "scan a client's workItems collection and bucket
// open (non-archived, non-closed) items by subject.entityId, returning a
// count and the highest priority among the bucket".
//
// Used by:
//   - GET /api/clients/[clientId]/wishlists?includeOpenItemCounts=true
//   - The wishlists page server-fetch (page.tsx) for the page-level
//     "{N} open items" subtitle and per-row Open Items pill.
//
// Subject-agnostic: the function buckets by `subject.entityId` regardless
// of `subject.entityType`. Callers filter by entityType if they want
// (the wishlist surfaces pass entityType: 'wishlist').
//
// Audience-gated: when the caller is a non-internal user, items with
// `audience: 'internal'` are excluded — defence-in-depth alongside
// firestore.rules.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import type {
  WishlistClarificationState,
  WorkItemSubject,
} from '@/types/workItem';

export type OpenItemPriority = 'high' | 'medium' | 'low';

export interface OpenItemBucket {
  count: number;
  highestPriority: OpenItemPriority | null;
}

const PRIORITY_RANK: Record<OpenItemPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const OPEN_STATES: ReadonlySet<WishlistClarificationState> = new Set([
  'raised',
  'clarified',
]);

export interface OpenItemCountsParams {
  tenantId: string;
  clientId: string;
  /** When set, only bucket items whose subject.entityType matches. */
  subjectEntityType?: string;
  /** When true, exclude items with `audience: 'internal'`. */
  hideInternal: boolean;
}

/**
 * Scan workItems and return a Map keyed by `subject.entityId` of
 * open-item counts and highest priority.
 *
 * The scan is a single Firestore read with an in-memory predicate. At
 * Cegid-Spain-volume this is fine; the architectural spec §7.7 has the
 * scale-up note for when this becomes a hot path.
 */
export async function computeOpenItemCounts(
  params: OpenItemCountsParams
): Promise<Map<string, OpenItemBucket>> {
  const { tenantId, clientId, subjectEntityType, hideInternal } = params;

  const workItemsRef = adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems');

  // Try the indexed shape first; fall back to a full scan if the composite
  // index isn't built yet (dev convenience).
  let snap;
  try {
    snap = await workItemsRef
      .where('archived', '==', false)
      .where('state', 'in', ['raised', 'clarified'])
      .get();
  } catch {
    snap = await workItemsRef.get();
  }

  const buckets = new Map<string, OpenItemBucket>();

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;

    if (data.archived) continue;
    const state = data.state as WishlistClarificationState | undefined;
    if (!state || !OPEN_STATES.has(state)) continue;

    const audience = (data.audience as string | undefined) ?? 'shared';
    if (hideInternal && audience === 'internal') continue;

    const subject = data.subject as WorkItemSubject | undefined;
    if (!subject || !subject.entityId) continue;

    if (subjectEntityType && subject.entityType !== subjectEntityType) continue;

    const entityId = subject.entityId;
    const priority = (data.priority as OpenItemPriority | undefined) ?? 'medium';

    const cur = buckets.get(entityId) ?? { count: 0, highestPriority: null };
    cur.count += 1;
    if (
      !cur.highestPriority ||
      PRIORITY_RANK[priority] > PRIORITY_RANK[cur.highestPriority]
    ) {
      cur.highestPriority = priority;
    }
    buckets.set(entityId, cur);
  }

  return buckets;
}
