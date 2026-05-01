// =============================================================================
// /api/clients/[clientId]/workItems
//
// Work Item lite API (per spec §4 + §5.2).
//
// GET   — list Work Items for the client. Supports filters:
//           ?subjectEntityType=wishlist   — filter by subject.entityType
//           ?subjectEntityId=<id>          — filter by subject.entityId
//           ?state=raised|clarified|closed (repeatable)
//           ?audience=internal|shared|client
//           ?archived=true|false (default: false)
//           ?openOnly=true                 — shorthand for state in raised|clarified
// POST  — create a Work Item.
//
// Audience gating: client users cannot read or write `audience: 'internal'`
// items (defence-in-depth: rules + this layer).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getRequestUser,
  hasClientAccess,
  isInternal,
  toActor,
} from '@/lib/auth/requestUser';
import { publishEvent } from '@/lib/events/publish';
import {
  WISHLIST_CLARIFICATION_DEFAULTS,
  type ActivityLogEntry,
  type WishlistClarificationState,
  type WorkItemAudience,
  type WorkItemSubject,
  type WorkItemType,
  type WorkItemWire,
} from '@/types/workItem';

const VALID_TYPES: WorkItemType[] = ['wishlist-clarification'];
const VALID_AUDIENCES: WorkItemAudience[] = ['internal', 'shared', 'client'];

// ─── Wire conversion ────────────────────────────────────────────────────────

function tsToISO(v: Timestamp | Date | string | undefined | null): string {
  if (!v) return new Date(0).toISOString();
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof (v as Timestamp).toDate === 'function') return (v as Timestamp).toDate().toISOString();
  return new Date(0).toISOString();
}

function toWire(
  id: string,
  raw: Record<string, unknown>,
  viewerIsInternal: boolean
): WorkItemWire {
  // Per spec §4.4 / §5.2: comment audience can be 'internal' independently
  // of the parent Work Item's audience. Non-internal viewers must never
  // see internal-audience commented entries — that's a confidentiality
  // breach. Other entry types (state-changed, audience-changed, archived-
  // changed) carry no audience flag and are always shown to anyone who
  // can see the parent Work Item.
  const activityLog = ((raw.activityLog as ActivityLogEntry[] | undefined) ?? [])
    .filter((e) => {
      if (viewerIsInternal) return true;
      if (e.type === 'commented' && e.audience === 'internal') return false;
      return true;
    })
    .map((e) => ({
      ...e,
      at: tsToISO(e.at as Timestamp | string),
    }));
  return {
    workItemId: id,
    workItemType: (raw.workItemType as WorkItemType) ?? 'wishlist-clarification',
    subject: raw.subject as WorkItemSubject,
    state: (raw.state as WishlistClarificationState) ?? 'raised',
    audience: (raw.audience as WorkItemAudience) ?? 'shared',
    visibility: (raw.visibility as 'normal' | 'system-only') ?? 'normal',
    archived: (raw.archived as boolean) ?? false,
    owner: (raw.owner as { uid: string; tenantId: string } | null) ?? null,
    priority: (raw.priority as 'high' | 'medium' | 'low') ?? 'medium',
    deadline: raw.deadline ? tsToISO(raw.deadline as Timestamp) : null,
    title: (raw.title as string) ?? '',
    body: (raw.body as string) ?? '',
    source: (raw.source as { type: string; ref: string } | null) ?? null,
    relations: (raw.relations as WorkItemWire['relations']) ?? [],
    activityLog: activityLog as WorkItemWire['activityLog'],
    createdAt: tsToISO(raw.createdAt as Timestamp),
    createdBy: raw.createdBy as { uid: string; tenantId: string },
    updatedAt: tsToISO(raw.updatedAt as Timestamp),
    tenantId: (raw.tenantId as string) ?? '',
    scope: 'tenant',
    sourceMigrationRun: raw.sourceMigrationRun as string | undefined,
  };
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const subjectEntityType = sp.get('subjectEntityType');
  const subjectEntityId = sp.get('subjectEntityId');
  const states = sp.getAll('state');
  const audienceParam = sp.get('audience');
  const archivedParam = sp.get('archived');
  const openOnly = sp.get('openOnly') === 'true';

  // Build a Firestore query — but keep most of the predicate work in
  // memory because the dev environment may not have all composite indexes.
  let q: FirebaseFirestore.Query = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems');

  if (subjectEntityId) {
    q = q.where('subject.entityId', '==', subjectEntityId);
  }

  let snap;
  try {
    snap = await q.get();
  } catch (err) {
    return NextResponse.json(
      { error: `Work Items query failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  const archivedFilter = archivedParam === null ? false : archivedParam === 'true';
  const stateFilter = openOnly
    ? new Set<WishlistClarificationState>(['raised', 'clarified'])
    : states.length > 0
      ? new Set<WishlistClarificationState>(states as WishlistClarificationState[])
      : null;

  const internal = isInternal(user);

  const items: WorkItemWire[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;

    if ((data.archived ?? false) !== archivedFilter) continue;
    if (subjectEntityType && (data.subject as WorkItemSubject)?.entityType !== subjectEntityType) continue;
    if (stateFilter && !stateFilter.has(data.state as WishlistClarificationState)) continue;
    if (audienceParam && data.audience !== audienceParam) continue;
    // Audience gate: client users do not see internal items.
    if (!internal && data.audience === 'internal') continue;

    items.push(toWire(d.id, data, internal));
  }

  // Order: most-recently-updated first (newest activity).
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return NextResponse.json({ items });
}

// ─── POST ───────────────────────────────────────────────────────────────────

interface CreateWorkItemInput {
  workItemType: WorkItemType;
  subject: WorkItemSubject;
  title: string;
  body?: string;
  audience?: WorkItemAudience;
  priority?: 'high' | 'medium' | 'low';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let body: CreateWorkItemInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  // Validation
  if (!body.workItemType || !VALID_TYPES.includes(body.workItemType)) {
    return NextResponse.json(
      { error: `Invalid workItemType. Valid: ${VALID_TYPES.join(', ')}.` },
      { status: 400 }
    );
  }
  if (!body.subject || !body.subject.entityType || !body.subject.entityId) {
    return NextResponse.json({ error: 'subject.entityType and subject.entityId are required.' }, { status: 400 });
  }
  if (!body.title || !body.title.trim()) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400 });
  }
  if (body.title.length > 200) {
    return NextResponse.json({ error: 'title must be ≤200 chars.' }, { status: 400 });
  }
  if (body.body && body.body.length > 2000) {
    return NextResponse.json({ error: 'body must be ≤2000 chars.' }, { status: 400 });
  }

  const audience: WorkItemAudience = body.audience ?? WISHLIST_CLARIFICATION_DEFAULTS.audience;
  if (!VALID_AUDIENCES.includes(audience)) {
    return NextResponse.json({ error: `Invalid audience. Valid: ${VALID_AUDIENCES.join(', ')}.` }, { status: 400 });
  }
  // Per spec §4.2: client users may only create shared items, never internal.
  if (!isInternal(user) && audience === 'internal') {
    return NextResponse.json(
      { error: 'Forbidden: client users may not create internal-audience items.' },
      { status: 403 }
    );
  }

  const priority = body.priority ?? WISHLIST_CLARIFICATION_DEFAULTS.priority;

  // Subject must be tenant-scoped to the user's tenant. The wishlist
  // sub-collection is tenant+client scoped, so subject.scopeRef should
  // be the user's tenantId.
  const subject: WorkItemSubject = {
    scope: 'tenant',
    scopeRef: user.tenantId,
    entityType: body.subject.entityType,
    entityId: body.subject.entityId,
  };

  const actor = toActor(user);
  const now = Timestamp.now();

  // Initial activity log entry — a "raised" state-changed at creation.
  const initialActivity: ActivityLogEntry = {
    type: 'state-changed',
    from: null,
    to: WISHLIST_CLARIFICATION_DEFAULTS.state,
    by: actor,
    at: now,
  };

  const workItemDoc = {
    workItemType: body.workItemType,
    subject,
    state: WISHLIST_CLARIFICATION_DEFAULTS.state,
    audience,
    visibility: WISHLIST_CLARIFICATION_DEFAULTS.visibility,
    archived: false,
    owner: null,
    priority,
    deadline: null,
    title: body.title.trim(),
    body: (body.body ?? '').trim(),
    source: null,
    relations: [],
    activityLog: [initialActivity],
    createdAt: FieldValue.serverTimestamp(),
    createdBy: { uid: user.uid, tenantId: user.tenantId },
    updatedAt: FieldValue.serverTimestamp(),
    tenantId: user.tenantId,
    scope: 'tenant' as const,
  };

  const ref = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems')
    .add(workItemDoc);

  const occurredAt = new Date().toISOString();

  // workItem.added — the canonical creation event (spec §5.2 + v0.2 footer).
  await publishEvent({
    eventType: 'workItem.added',
    payload: {
      workItemId: ref.id,
      workItemType: body.workItemType,
      subject,
      audience,
      priority,
      title: workItemDoc.title,
    },
    tenantId: user.tenantId,
    clientId,
    actorUid: user.uid,
    occurredAt,
  });

  // workItem.stateChanged — the implicit "raised" transition. Some
  // consumers care about the explicit transition event even on creation.
  await publishEvent({
    eventType: 'workItem.stateChanged',
    payload: {
      workItemId: ref.id,
      from: null,
      to: WISHLIST_CLARIFICATION_DEFAULTS.state,
    },
    tenantId: user.tenantId,
    clientId,
    actorUid: user.uid,
    occurredAt,
  });

  return NextResponse.json({ workItemId: ref.id, success: true }, { status: 201 });
}
