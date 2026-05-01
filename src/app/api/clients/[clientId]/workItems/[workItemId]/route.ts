// =============================================================================
// /api/clients/[clientId]/workItems/[workItemId]
//
// GET    — fetch one Work Item (audience-gated for client users).
// PATCH  — state transition / audience change / archive toggle.
//          Body shape (one of):
//            { state: 'clarified' | 'closed', comment?: string }
//            { audience: 'shared' | 'internal', comment?: string }
//            { archived: true | false }
//          Each form appends an activity-log entry and emits a single event.
//
// Per spec §4.3 the state machine is: raised → clarified, clarified → closed,
// raised → closed (shortcut close — comment REQUIRED). All transitions
// validated via lib/workItems/stateMachine.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getRequestUser,
  hasClientAccess,
  isInternal,
  isInternalAdmin,
  toActor,
} from '@/lib/auth/requestUser';
import { publishEvent } from '@/lib/events/publish';
import { validateTransition } from '@/lib/workItems/stateMachine';
import {
  type ActivityLogEntry,
  type WishlistClarificationState,
  type WorkItemAudience,
  type WorkItemSubject,
  type WorkItemType,
  type WorkItemWire,
} from '@/types/workItem';

const VALID_AUDIENCES: WorkItemAudience[] = ['internal', 'shared', 'client'];

interface Ctx {
  params: Promise<{ clientId: string; workItemId: string }>;
}

function workItemRef(tenantId: string, clientId: string, workItemId: string) {
  return adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems')
    .doc(workItemId);
}

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

export async function GET(request: NextRequest, { params }: Ctx) {
  const { clientId, workItemId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const snap = await workItemRef(user.tenantId, clientId, workItemId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }
  const data = snap.data() as Record<string, unknown>;

  if (!isInternal(user) && data.audience === 'internal') {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }

  return NextResponse.json({ item: toWire(snap.id, data, isInternal(user)) });
}

// ─── PATCH ──────────────────────────────────────────────────────────────────

interface PatchBody {
  state?: WishlistClarificationState;
  audience?: WorkItemAudience;
  archived?: boolean;
  comment?: string;
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { clientId, workItemId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  // Mutually-exclusive ops: exactly one of state/audience/archived.
  const ops = [body.state, body.audience, body.archived].filter((x) => x !== undefined);
  if (ops.length !== 1) {
    return NextResponse.json(
      { error: 'PATCH must contain exactly one of: state, audience, archived.' },
      { status: 400 }
    );
  }

  const ref = workItemRef(user.tenantId, clientId, workItemId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }
  const before = snap.data() as Record<string, unknown>;

  // Audience gate: client users cannot read or modify internal items.
  if (!isInternal(user) && before.audience === 'internal') {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }

  const actor = toActor(user);
  const now = Timestamp.now();

  // ─── State transition ──────────────────────────────────────────────
  if (body.state !== undefined) {
    const fromState = (before.state as WishlistClarificationState) ?? 'raised';
    const toState = body.state;
    const workItemType = (before.workItemType as WorkItemType) ?? 'wishlist-clarification';
    const hasComment = !!(body.comment && body.comment.trim());

    const v = validateTransition(workItemType, fromState, toState, hasComment);
    if (!v.ok) {
      // Map state-machine reason to a clearer HTTP status:
      //   no-such-transition / no-such-type → 400
      //   already-in-target-state           → 409
      //   comment-required                  → 400 (with explicit message)
      const status =
        v.reason === 'already-in-target-state' ? 409 : 400;
      const message =
        v.reason === 'comment-required'
          ? 'A comment is required when closing directly from raised (shortcut close).'
          : `Illegal transition: ${fromState} → ${toState} (${v.reason}).`;
      return NextResponse.json({ error: message }, { status });
    }

    const activity: ActivityLogEntry = {
      type: 'state-changed',
      from: fromState,
      to: toState,
      by: actor,
      at: now,
      ...(body.comment && body.comment.trim() ? { comment: body.comment.trim() } : {}),
    };

    await ref.update({
      state: toState,
      updatedAt: FieldValue.serverTimestamp(),
      activityLog: FieldValue.arrayUnion(activity),
    });

    await publishEvent({
      eventType: 'workItem.stateChanged',
      payload: {
        workItemId,
        from: fromState,
        to: toState,
        ...(body.comment && body.comment.trim() ? { comment: body.comment.trim() } : {}),
      },
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  }

  // ─── Audience change ───────────────────────────────────────────────
  if (body.audience !== undefined) {
    if (!VALID_AUDIENCES.includes(body.audience)) {
      return NextResponse.json(
        { error: `Invalid audience. Valid: ${VALID_AUDIENCES.join(', ')}.` },
        { status: 400 }
      );
    }
    // Only internal users may change audience (clients cannot promote
    // shared→internal nor demote internal→shared).
    if (!isInternal(user)) {
      return NextResponse.json({ error: 'Forbidden: only internal users may change audience.' }, { status: 403 });
    }
    const fromAudience = (before.audience as WorkItemAudience) ?? 'shared';
    if (fromAudience === body.audience) {
      return NextResponse.json({ success: true, noop: true });
    }

    const activity: ActivityLogEntry = {
      type: 'audience-changed',
      from: fromAudience,
      to: body.audience,
      by: actor,
      at: now,
      ...(body.comment && body.comment.trim() ? { comment: body.comment.trim() } : {}),
    };

    await ref.update({
      audience: body.audience,
      updatedAt: FieldValue.serverTimestamp(),
      activityLog: FieldValue.arrayUnion(activity),
    });

    await publishEvent({
      eventType: 'workItem.audienceChanged',
      payload: { workItemId, from: fromAudience, to: body.audience },
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  }

  // ─── Archive toggle ────────────────────────────────────────────────
  if (body.archived !== undefined) {
    if (!isInternalAdmin(user)) {
      return NextResponse.json(
        { error: 'Forbidden: only internal-admin can archive a Work Item.' },
        { status: 403 }
      );
    }

    const wasArchived = (before.archived as boolean | undefined) ?? false;
    if (wasArchived === body.archived) {
      return NextResponse.json({ success: true, noop: true });
    }

    const activity: ActivityLogEntry = {
      type: 'archived-changed',
      to: body.archived,
      by: actor,
      at: now,
    };

    await ref.update({
      archived: body.archived,
      updatedAt: FieldValue.serverTimestamp(),
      activityLog: FieldValue.arrayUnion(activity),
    });

    await publishEvent({
      eventType: 'workItem.archivedChanged',
      payload: { workItemId, archived: body.archived },
      tenantId: user.tenantId,
      clientId,
      actorUid: user.uid,
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'No-op.' }, { status: 400 });
}
