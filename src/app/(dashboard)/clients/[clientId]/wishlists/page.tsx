// =============================================================================
// /clients/[clientId]/wishlists — Wishlists list page (R2 PVS Slice 1).
//
// Server-side fetch:
//   • Wishlists (R1 *or* R2 docs — readAdapter normalises in-flight per
//     spec §3.7; non-Cegid pre-migration clients still render correctly).
//   • Targeting-hint reference data (4 managed lists → TargetingHint[]).
//   • Campaigns (for the campaign chip picker in the form).
//   • Open-item counts (subject-agnostic helper buckets workItems by
//     subject.entityId; see lib/workItems/openItemCounts).
//
// We resolve the open-item counts at the page level (one read per surface
// load) rather than via the client-side ?includeOpenItemCounts API loop,
// so the page renders with the badge already populated and no flash.
// =============================================================================

import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import WishlistListClient from './WishlistListClient';
import { PagePadding } from '@/components/layout/PagePadding';
import { readWishlistEntry, type RawWishlistDoc } from '@/lib/wishlists/readAdapter';
import { computeOpenItemCounts } from '@/lib/workItems/openItemCounts';
import {
  TARGETING_HINT_TYPE_CONFIG,
  TARGETING_HINT_TYPES,
  type TargetingHint,
  type WishlistEntryWire,
} from '@/types/wishlist';
import type { Campaign } from '@/types';

interface Props {
  params: Promise<{ clientId: string }>;
}

interface ManagedListItemRaw {
  id?: string;
  itemId?: string;
  label?: string;
  displayName?: string;
  active?: boolean;
}

/**
 * Lift one managed-list document into TargetingHint[] for a given hint type.
 * Skips inactive items. Coerces both `id`/`label` (R1) and `itemId`/`displayName`
 * (R2 forward-compat) shapes.
 */
function readManagedList(
  hintType: TargetingHint['type'],
  raw: { items?: ManagedListItemRaw[] } | undefined
): TargetingHint[] {
  if (!raw?.items) return [];
  return raw.items
    .filter((it) => it.active !== false)
    .map<TargetingHint>((it) => ({
      type: hintType,
      managedListRef: {
        listId: TARGETING_HINT_TYPE_CONFIG[hintType].managedListId,
        itemId: it.itemId ?? it.id ?? '',
      },
      displayName: it.displayName ?? it.label ?? '',
    }))
    .filter((h) => h.managedListRef.itemId && h.displayName);
}

export default async function WishlistsPage({ params }: Props) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;
  const role = user.claims.role;
  const isInternal = role === 'internal-admin' || role === 'internal-user';

  // ─── Wishlists (R1/R2 normalised) ──────────────────────────────────
  const wishlistSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('wishlists')
    .get();

  const wishlists: WishlistEntryWire[] = wishlistSnap.docs
    .map((doc) => readWishlistEntry(doc.id, doc.data() as RawWishlistDoc))
    .filter((w) => !w.archived)
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));

  // ─── Targeting hints from managed lists ────────────────────────────
  const managedListIds = TARGETING_HINT_TYPES.map(
    (t) => TARGETING_HINT_TYPE_CONFIG[t].managedListId
  );
  const managedListSnaps = await Promise.all(
    managedListIds.map((id) =>
      adminDb
        .collection('tenants')
        .doc(tenantId)
        .collection('managedLists')
        .doc(id)
        .get()
    )
  );
  const targetingHints: TargetingHint[] = TARGETING_HINT_TYPES.flatMap((t, idx) =>
    readManagedList(
      t,
      managedListSnaps[idx].data() as { items?: ManagedListItemRaw[] } | undefined
    )
  );

  // ─── Campaigns ─────────────────────────────────────────────────────
  const campaignSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[] =
    campaignSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        campaignName: d.campaignName || '',
        status: d.status || 'draft',
      };
    });

  // ─── Open-item counts ──────────────────────────────────────────────
  // Resolve at the page so the table renders the Open Items pill on first paint.
  const buckets = await computeOpenItemCounts({
    tenantId,
    clientId,
    subjectEntityType: 'wishlist',
    hideInternal: !isInternal,
  });

  const wishlistsWithCounts: WishlistEntryWire[] = wishlists.map((w) => {
    const b = buckets.get(w.wishlistId);
    return {
      ...w,
      openItemCount: b?.count ?? 0,
      openItemHighestPriority: b?.highestPriority ?? null,
    };
  });

  const totalOpenItems = Array.from(buckets.values()).reduce(
    (acc, b) => acc + b.count,
    0
  );

  return (
    <PagePadding>
      <WishlistListClient
        clientId={clientId}
        wishlists={wishlistsWithCounts}
        campaigns={campaigns}
        targetingHints={targetingHints}
        userRole={role}
        userEmail={user.email}
        totalOpenItems={totalOpenItems}
      />
    </PagePadding>
  );
}
