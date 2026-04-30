// =============================================================================
// /api/clients/[clientId]/wishlists
//
// R2 schema (per docs/architecture/r2-pvs-s1-wishlists-spec.md §3, §5).
//
// GET   — list wishlists for the client. Supports
//           ?includeOpenItemCounts=true (page-level Open Items badge per §7.7)
// POST  — create a wishlist entry (single or batched via { items: [...] })
//
// Event emission per spec §5.1 — all mutation paths emit through
// `publishEvent` (the publisher-lite). Verbs from the v0.2 platform-pattern
// alignment footer:
//   wishlist.added, .statusChanged, .priorityChanged,
//   .campaignRefsChanged, .companyRefChanged, .archived
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  getRequestUser,
  hasClientAccess,
  canWriteWishlist,
  isInternal,
  toActor,
} from '@/lib/auth/requestUser';
import { publishEvent } from '@/lib/events/publish';
import { readWishlistEntry, type RawWishlistDoc } from '@/lib/wishlists/readAdapter';
import {
  SOURCES_REQUIRING_DETAIL,
  type CompanyRef,
  type TargetingHint,
  type WishlistEntryWire,
  type WishlistPriority,
  type WishlistSource,
  type WishlistStatus,
} from '@/types/wishlist';
import { randomUUID } from 'node:crypto';

const VALID_PRIORITIES: WishlistPriority[] = ['high', 'medium', 'low'];
const VALID_STATUSES: WishlistStatus[] = [
  'new',
  'under-review',
  'added-to-target-list',
  'rejected',
];
const VALID_SOURCES: WishlistSource[] = [
  'client-request',
  'internal-research',
  'conference-list',
  'industry-event',
  'ai-suggestion',
  'migration',
  'other',
];

// ─── GET ────────────────────────────────────────────────────────────────────

/**
 * GET /api/clients/[clientId]/wishlists
 *
 * Returns all (non-archived) wishlists for the client, normalised to R2
 * shape via the read adapter so pre-migration R1 docs come through cleanly.
 *
 * Query params:
 *   - includeOpenItemCounts=true — augment each entry with `openItemCount`
 *     and `openItemHighestPriority`. Single page-level scan over workItems
 *     rather than N queries.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const includeCounts =
    request.nextUrl.searchParams.get('includeOpenItemCounts') === 'true';

  const wishlistsRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('wishlists');

  const snap = await wishlistsRef.get();

  const entries: WishlistEntryWire[] = snap.docs
    .map((d) => readWishlistEntry(d.id, d.data() as RawWishlistDoc))
    .filter((e) => !e.archived);

  if (includeCounts) {
    // Single scan over Work Items, bucketed by subject.entityId. Page-level
    // efficient (spec §7.7).
    const workItemsRef = adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('workItems');

    let openSnap;
    try {
      openSnap = await workItemsRef
        .where('archived', '==', false)
        .where('state', 'in', ['raised', 'clarified'])
        .get();
    } catch {
      // The composite index may not yet exist — fall back to full scan.
      openSnap = await workItemsRef.get();
    }

    const buckets = new Map<string, { count: number; highest: 'high' | 'medium' | 'low' | null }>();
    const priorityRank: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };

    for (const wi of openSnap.docs) {
      const data = wi.data() as Record<string, unknown>;
      if (data.archived) continue;
      const state = data.state as string;
      if (state !== 'raised' && state !== 'clarified') continue;

      const audience = (data.audience as string) ?? 'shared';
      // Audience gate at read-time (defence in depth — rules also block).
      if (!isInternal(user) && audience === 'internal') continue;

      const subject = data.subject as { entityType?: string; entityId?: string } | undefined;
      if (!subject || subject.entityType !== 'wishlist' || !subject.entityId) continue;

      const wishlistId = subject.entityId;
      const priority = (data.priority as 'high' | 'medium' | 'low') ?? 'medium';

      const cur = buckets.get(wishlistId) ?? { count: 0, highest: null };
      cur.count += 1;
      if (!cur.highest || priorityRank[priority] > priorityRank[cur.highest]) {
        cur.highest = priority;
      }
      buckets.set(wishlistId, cur);
    }

    for (const e of entries) {
      const b = buckets.get(e.wishlistId);
      e.openItemCount = b?.count ?? 0;
      e.openItemHighestPriority = b?.highest ?? null;
    }
  }

  return NextResponse.json({ entries });
}

// ─── POST ───────────────────────────────────────────────────────────────────

interface CreateWishlistInput {
  companyName?: string;
  companyRef?: CompanyRef;
  priority?: WishlistPriority;
  status?: WishlistStatus;
  campaignRefs?: string[];
  targetingHints?: TargetingHint[];
  source?: WishlistSource;
  sourceDetail?: string;
}

function validateCreateInput(input: CreateWishlistInput): string | null {
  // At least one of {companyName, targetingHints} must be present.
  const hasName = !!(input.companyName && input.companyName.trim());
  const hasHints = Array.isArray(input.targetingHints) && input.targetingHints.length > 0;
  if (!hasName && !hasHints) {
    return 'Either companyName or at least one targetingHint is required.';
  }
  if (input.companyName && input.companyName.length > 200) {
    return 'companyName must be ≤200 chars.';
  }
  if (input.priority && !VALID_PRIORITIES.includes(input.priority)) {
    return `Invalid priority. Valid: ${VALID_PRIORITIES.join(', ')}.`;
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    return `Invalid status. Valid: ${VALID_STATUSES.join(', ')}.`;
  }
  if (input.source && !VALID_SOURCES.includes(input.source)) {
    return `Invalid source. Valid: ${VALID_SOURCES.join(', ')}.`;
  }
  if (input.source && SOURCES_REQUIRING_DETAIL.includes(input.source)) {
    if (!input.sourceDetail || !input.sourceDetail.trim()) {
      return `sourceDetail is required when source is ${input.source}.`;
    }
  }
  if (input.targetingHints && input.targetingHints.length > 12) {
    return 'targetingHints must be ≤12.';
  }
  return null;
}

/**
 * POST /api/clients/[clientId]/wishlists
 *
 * Body: a single CreateWishlistInput, OR { items: CreateWishlistInput[] }.
 *
 * Per spec §3:
 *   - Client users may not set status (forced to 'new') or campaignRefs ([]).
 *   - All users must supply source (no migration sentinel from the UI).
 *   - companyName is no longer the only required field — at least one of
 *     {companyName, targetingHints} suffices.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  if (!canWriteWishlist(user)) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let body: { items?: CreateWishlistInput[] } & CreateWishlistInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  const items: CreateWishlistInput[] =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [body as CreateWishlistInput];

  // Validate up front — fail the whole batch on the first invalid entry to
  // avoid partial creates the operator didn't ask for.
  for (const item of items) {
    const err = validateCreateInput(item);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const internal = isInternal(user);
  const actor = toActor(user);

  const createdIds: string[] = [];

  for (const item of items) {
    const trimmedName = item.companyName?.trim() || null;
    const companyRef: CompanyRef | null = item.companyRef
      ? item.companyRef
      : trimmedName
        ? { type: 'candidate', candidateId: randomUUID() }
        : null;

    const status: WishlistStatus = internal ? (item.status ?? 'new') : 'new';
    const campaignRefs = internal ? (item.campaignRefs ?? []) : [];

    const newDoc = {
      companyRef,
      companyName: trimmedName,
      priority: item.priority ?? 'medium',
      status,
      campaignRefs,
      targetingHints: item.targetingHints ?? [],
      targetingHintsRaw: null, // form-mediated entries don't carry raw blob
      source: item.source ?? 'internal-research',
      sourceDetail: item.sourceDetail?.trim() || null,
      addedBy: actor,
      addedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      archived: false,
      schemaVersion: 'r2-pvs-wishlist-v1' as const,
    };

    const docRef = await adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('wishlists')
      .add(newDoc);

    createdIds.push(docRef.id);

    await publishEvent({
      eventType: 'wishlist.added',
      payload: {
        wishlistId: docRef.id,
        companyName: trimmedName,
        companyRef,
        priority: newDoc.priority,
        status: newDoc.status,
        source: newDoc.source,
        targetingHintCount: newDoc.targetingHints.length,
        campaignRefsCount: campaignRefs.length,
      },
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(
    { ids: createdIds, count: createdIds.length, success: true },
    { status: 201 }
  );
}
