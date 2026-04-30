// =============================================================================
// /api/clients/[clientId]/wishlists/[wishlistId]
//
// R2 schema (per docs/architecture/r2-pvs-s1-wishlists-spec.md §3, §5).
//
// GET    — fetch a single wishlist entry, normalised to R2 wire shape.
// PUT    — full edit (Edit-in-Details surface). Internal users may edit all
//          fields including status/campaignRefs; client-approver may edit
//          companyName/companyRef/priority/targetingHints/source/sourceDetail
//          but NOT status or campaignRefs.
// PATCH  — quick mutations (status, priority, archived, campaignRefs).
//          Internal users only for status/campaignRefs; archived is for
//          internal-admin only per spec §3.6.
// DELETE — soft-delete (sets archived: true). Hard delete is intentionally
//          NOT exposed; archive is the documented path (spec §3.6).
//
// Event emission per spec §5.1 — all mutations emit through publishEvent
// (publisher-lite). Verbs from the v0.2 platform-pattern alignment footer:
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
  isInternalAdmin,
  toActor,
} from '@/lib/auth/requestUser';
import { publishEvent } from '@/lib/events/publish';
import {
  readWishlistEntry,
  type RawWishlistDoc,
} from '@/lib/wishlists/readAdapter';
import {
  SOURCES_REQUIRING_DETAIL,
  type CompanyRef,
  type TargetingHint,
  type WishlistPriority,
  type WishlistSource,
  type WishlistStatus,
} from '@/types/wishlist';

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

// ─── Helpers ────────────────────────────────────────────────────────────────

interface WishlistRouteCtx {
  params: Promise<{ clientId: string; wishlistId: string }>;
}

function docPath(tenantId: string, clientId: string, wishlistId: string) {
  return adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('wishlists')
    .doc(wishlistId);
}

/**
 * Compares two arrays of strings (campaignRefs) for set-equality (order
 * irrelevant). Used to decide whether to emit campaignRefsChanged.
 */
function sameStringSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  const s = new Set(aa);
  return bb.every((x) => s.has(x));
}

function sameCompanyRef(a: CompanyRef | null | undefined, b: CompanyRef | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.type === b.type &&
    (a.sfAccountId ?? null) === (b.sfAccountId ?? null) &&
    (a.candidateId ?? null) === (b.candidateId ?? null)
  );
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: WishlistRouteCtx) {
  const { clientId, wishlistId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const ref = docPath(user.tenantId, clientId, wishlistId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }

  const entry = readWishlistEntry(wishlistId, snap.data() as RawWishlistDoc);
  return NextResponse.json({ entry });
}

// ─── PUT (full edit) ────────────────────────────────────────────────────────

interface UpdateInput {
  companyName?: string;
  companyRef?: CompanyRef | null;
  priority?: WishlistPriority;
  status?: WishlistStatus;
  campaignRefs?: string[];
  targetingHints?: TargetingHint[];
  source?: WishlistSource;
  sourceDetail?: string | null;
}

function validateUpdate(input: UpdateInput): string | null {
  if (input.companyName !== undefined && input.companyName.length > 200) {
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
  if (
    input.source &&
    SOURCES_REQUIRING_DETAIL.includes(input.source) &&
    (input.sourceDetail === null || input.sourceDetail === undefined || !input.sourceDetail.trim())
  ) {
    return `sourceDetail is required when source is ${input.source}.`;
  }
  if (input.targetingHints && input.targetingHints.length > 12) {
    return 'targetingHints must be ≤12.';
  }
  return null;
}

export async function PUT(request: NextRequest, { params }: WishlistRouteCtx) {
  const { clientId, wishlistId } = await params;
  const user = getRequestUser(request);

  if (!canWriteWishlist(user)) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const ref = docPath(user.tenantId, clientId, wishlistId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }
  const before = snap.data() as RawWishlistDoc;

  let body: UpdateInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  const validationErr = validateUpdate(body);
  if (validationErr) {
    return NextResponse.json({ error: validationErr }, { status: 400 });
  }

  // Field gating: client-approver may not change status or campaignRefs.
  const internal = isInternal(user);
  const clientAllowed: (keyof UpdateInput)[] = [
    'companyName',
    'companyRef',
    'priority',
    'targetingHints',
    'source',
    'sourceDetail',
  ];
  const internalAllowed: (keyof UpdateInput)[] = [
    ...clientAllowed,
    'status',
    'campaignRefs',
  ];
  const allowed: Set<keyof UpdateInput> = new Set(internal ? internalAllowed : clientAllowed);

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(body) as (keyof UpdateInput)[]) {
    if (!allowed.has(key)) continue;
    const v = body[key];
    if (v === undefined) continue;
    update[key as string] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied.' }, { status: 400 });
  }

  // companyName trim + denormalise.
  if (typeof update.companyName === 'string') {
    update.companyName = (update.companyName as string).trim() || null;
  }

  update.updatedBy = toActor(user);
  update.updatedAt = FieldValue.serverTimestamp();

  await ref.update(update);

  // Event emission — one event per discrete state change. Comparing against
  // the document we read above; if any field-set is identical post-write
  // we skip the event. This is the spec §5.1 contract: "each verb maps to
  // a single user-visible state change".
  const occurredAt = new Date().toISOString();

  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  if (
    update.status !== undefined &&
    (update.status as string) !== (before.status as string | undefined)
  ) {
    events.push({
      eventType: 'wishlist.statusChanged',
      payload: {
        wishlistId,
        from: before.status ?? null,
        to: update.status,
      },
    });
  }
  if (
    update.priority !== undefined &&
    (update.priority as string) !== (before.priority as string | undefined)
  ) {
    events.push({
      eventType: 'wishlist.priorityChanged',
      payload: {
        wishlistId,
        from: before.priority ?? null,
        to: update.priority,
      },
    });
  }
  if (
    update.campaignRefs !== undefined &&
    !sameStringSet(update.campaignRefs as string[], before.campaignRefs)
  ) {
    events.push({
      eventType: 'wishlist.campaignRefsChanged',
      payload: {
        wishlistId,
        from: before.campaignRefs ?? [],
        to: update.campaignRefs,
      },
    });
  }
  if (update.companyRef !== undefined && !sameCompanyRef(update.companyRef as CompanyRef | null, before.companyRef)) {
    events.push({
      eventType: 'wishlist.companyRefChanged',
      payload: {
        wishlistId,
        from: before.companyRef ?? null,
        to: update.companyRef,
      },
    });
  }

  for (const ev of events) {
    await publishEvent({
      eventType: ev.eventType,
      payload: ev.payload,
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt,
    });
  }

  return NextResponse.json({ success: true, eventsEmitted: events.length });
}

// ─── PATCH (quick mutations) ────────────────────────────────────────────────

interface PatchInput {
  status?: WishlistStatus;
  priority?: WishlistPriority;
  campaignRefs?: string[];
  archived?: boolean;
}

export async function PATCH(request: NextRequest, { params }: WishlistRouteCtx) {
  const { clientId, wishlistId } = await params;
  const user = getRequestUser(request);

  if (!canWriteWishlist(user)) {
    return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let body: PatchInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  // Per spec §3.6: status, campaignRefs, and archived require internal
  // role. Priority alone is fine for client-approver.
  const internal = isInternal(user);
  if ((body.status !== undefined || body.campaignRefs !== undefined) && !internal) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users can change status or campaignRefs.' },
      { status: 403 }
    );
  }
  if (body.archived !== undefined && !isInternalAdmin(user)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal-admin can archive.' },
      { status: 403 }
    );
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}.` },
      { status: 400 }
    );
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return NextResponse.json(
      { error: `Invalid priority. Valid: ${VALID_PRIORITIES.join(', ')}.` },
      { status: 400 }
    );
  }

  const ref = docPath(user.tenantId, clientId, wishlistId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }
  const before = snap.data() as RawWishlistDoc;

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.campaignRefs !== undefined) update.campaignRefs = body.campaignRefs;
  if (body.archived !== undefined) update.archived = body.archived;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied.' }, { status: 400 });
  }

  update.updatedBy = toActor(user);
  update.updatedAt = FieldValue.serverTimestamp();

  await ref.update(update);

  const occurredAt = new Date().toISOString();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  if (body.status !== undefined && body.status !== before.status) {
    events.push({
      eventType: 'wishlist.statusChanged',
      payload: { wishlistId, from: before.status ?? null, to: body.status },
    });
  }
  if (body.priority !== undefined && body.priority !== before.priority) {
    events.push({
      eventType: 'wishlist.priorityChanged',
      payload: { wishlistId, from: before.priority ?? null, to: body.priority },
    });
  }
  if (body.campaignRefs !== undefined && !sameStringSet(body.campaignRefs, before.campaignRefs)) {
    events.push({
      eventType: 'wishlist.campaignRefsChanged',
      payload: { wishlistId, from: before.campaignRefs ?? [], to: body.campaignRefs },
    });
  }
  if (body.archived !== undefined && body.archived !== (before.archived ?? false)) {
    events.push({
      eventType: 'wishlist.archived',
      payload: { wishlistId, archived: body.archived },
    });
  }

  for (const ev of events) {
    await publishEvent({
      eventType: ev.eventType,
      payload: ev.payload,
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt,
    });
  }

  return NextResponse.json({ success: true, eventsEmitted: events.length });
}

// ─── DELETE (soft-delete = archive) ─────────────────────────────────────────

/**
 * DELETE → archive. Hard delete is intentionally not exposed (spec §3.6).
 * Internal-admin only.
 */
export async function DELETE(request: NextRequest, { params }: WishlistRouteCtx) {
  const { clientId, wishlistId } = await params;
  const user = getRequestUser(request);

  if (!isInternalAdmin(user)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal-admin can archive (DELETE).' },
      { status: 403 }
    );
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const ref = docPath(user.tenantId, clientId, wishlistId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Wishlist item not found' }, { status: 404 });
  }
  const before = snap.data() as RawWishlistDoc;
  if (before.archived) {
    return NextResponse.json({ success: true, alreadyArchived: true });
  }

  await ref.update({
    archived: true,
    updatedBy: toActor(user),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await publishEvent({
    eventType: 'wishlist.archived',
    payload: { wishlistId, archived: true },
    tenantId: user.tenantId,
    clientId,
    actorUid: user.uid,
    occurredAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
