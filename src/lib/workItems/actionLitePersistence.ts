// =============================================================================
// action-lite Work Item — Firestore persistence boundary.
//
// S3-code-P3: thin admin-SDK adapter sitting between the route handlers
// and the cross-project core-prod Firestore. Pure helpers in
// `actionLite.ts`; this module is the IO seam.
//
// Why factored out:
//   - Route handlers stay thin (validation + auth + this call).
//   - The check-in auto-gen path calls the same `createActionLite`
//     entry point from the check-in route, so the persistence shape
//     stays single-source-of-truth.
//   - Keeps `coreAdmin.ts` import contained — the rest of the codebase
//     uses local Exchange `adminDb` for everything else.
// =============================================================================

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

import { getCoreDb } from '@/lib/firebase/coreAdmin';
import {
  ACTION_LITE_TYPE_ID,
  toActionLiteWire,
  type ActionLiteCreatePayload,
  type ActionLiteState,
  type ActionLiteWire,
} from './actionLite';

// ─── Path helpers ───────────────────────────────────────────────────────────

/**
 * action-lite is tenant-scoped (Spec §7.1). Instances live at
 *   tenants/{tenantId}/workItems/{workItemId}
 * on `angsana-core-prod`. Mirrors
 * `scripts/reseed-actions-to-work-items-v0_1.ts::targetWorkItemsRef`.
 */
function workItemsRef(tenantId: string) {
  return getCoreDb().collection('tenants').doc(tenantId).collection('workItems');
}

// ─── Create ────────────────────────────────────────────────────────────────

/**
 * Persist a payload built by `buildCreatePayload`. The payload is shape-
 * complete; this function adds the persistence-boundary fields:
 *
 *   workItemId       — minted via crypto.randomUUID (matches reseed pattern).
 *   createdAt        — server timestamp.
 *   updatedAt        — server timestamp.
 *   activityLog      — initial 'state-changed: null → open' entry.
 *   schemaVersion    — pinned to 'r3-action-lite-v1' for parity with the
 *                      reseed (Pattern §3.3).
 *
 * Returns the newly-minted workItemId so the caller can echo it on the
 * response (or store it on the source check-in doc for the
 * `generatedWorkItemIds` crumb).
 */
export interface CreateActionLiteOptions {
  /**
   * Optional explicit `source` field in the Spec §2.1 shape (e.g.
   * `{type: 'check-in', ref: 'tenants/.../checkIns/abc'}`). Set by the
   * check-in auto-gen path; left null on UI-driven creates.
   */
  source?: { type: string; ref: string } | null;
  /**
   * Optional createdBy override. Defaults to deriving from the payload's
   * raisedBy (the actor that submitted the form). The reseed wrote
   * `createdBy: { userId: 'script:reseed:<op>', tenantId }`; UI / auto-gen
   * writes the actor's identity.
   */
  createdBy?: { userId: string; tenantId: string };
}

export async function createActionLite(
  payload: ActionLiteCreatePayload,
  options: CreateActionLiteOptions = {}
): Promise<{ workItemId: string }> {
  const workItemId = randomUUID();
  const now = FieldValue.serverTimestamp();

  const docToWrite = {
    workItemId,
    workItemType: ACTION_LITE_TYPE_ID, // legacy reseed field name
    typeId: ACTION_LITE_TYPE_ID, // forward-compat field name
    state: payload.state,
    priority: payload.priority,
    title: payload.title,
    body: payload.body,
    subject: payload.subject,
    owner: payload.owner,
    raisedBy: payload.raisedBy,
    deadline: payload.deadline ? Timestamp.fromDate(payload.deadline) : null,
    archived: false,
    audience: payload.audience,
    visibility: payload.visibility,
    scope: payload.scope,
    tenantId: payload.tenantId,
    source: options.source ?? null,
    relations: [] as never[],
    createdAt: now,
    createdBy: options.createdBy ?? {
      userId: payload.raisedBy.userId,
      tenantId: payload.raisedBy.tenantId,
    },
    updatedAt: now,
    schemaVersion: 'r3-action-lite-v1',
    activityLog: [
      {
        type: 'state-changed',
        from: null,
        to: payload.state,
        by: {
          uid: payload.raisedBy.userId,
          name: payload.raisedBy.userId,
        },
        // server-side timestamp would ideally apply here; nested
        // FieldValue.serverTimestamp() inside arrays is not allowed —
        // use a wall-clock ISO string instead. The activityLog is the
        // operator-readable surface; createdAt at the doc level is the
        // canonical server time.
        at: new Date().toISOString(),
      },
    ],
  };

  await workItemsRef(payload.tenantId).doc(workItemId).set(docToWrite);
  return { workItemId };
}

// ─── List ──────────────────────────────────────────────────────────────────

export interface ListActionLiteOptions {
  /** Tenant — required. */
  tenantId: string;
  /**
   * Restrict to Work Items whose subject is the given client. Two queries
   * fan out under the hood:
   *   1. subject.entityType == 'client' AND subject.entityId == clientId
   *   2. subject.entityType == 'campaign' AND
   *      subject.entityId IN <campaignIds for this client>
   * The route handler resolves <campaignIds> by reading the client's
   * campaigns subcollection (same pattern as the legacy `actions/page.tsx`
   * which fetched campaigns for name lookup).
   *
   * The two result sets are unioned, deduped by workItemId, and the
   * caller gets a single ordered list.
   */
  clientId: string;
  /** Campaign IDs for this client — used for the campaign-subject query. */
  campaignIds: string[];
  /** Default true — include archived only when explicitly requested. */
  includeArchived?: boolean;
}

/**
 * List action-lite Work Items for a client. Two-query fan-out (client
 * subject + campaign subjects), unioned and deduped.
 *
 * Why not a single collection-group query? action-lite is tenant-scoped,
 * so all instances are siblings in `tenants/{t}/workItems`; we don't
 * need a collection-group. But Firestore composite indexes on
 * (subject.entityType, subject.entityId) would otherwise force a single
 * query path; this two-query approach avoids the index and keeps the
 * operational surface flat.
 */
export async function listActionLiteForClient(
  opts: ListActionLiteOptions
): Promise<ActionLiteWire[]> {
  const ref = workItemsRef(opts.tenantId);
  const includeArchived = opts.includeArchived ?? false;

  // Query 1: client subject.
  const clientSubjectSnap = await ref
    .where('subject.entityType', '==', 'client')
    .where('subject.entityId', '==', opts.clientId)
    .get();

  // Query 2: campaign subjects (chunk to avoid 'in' 30-element ceiling).
  const campaignSubjectDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  if (opts.campaignIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < opts.campaignIds.length; i += 30) {
      chunks.push(opts.campaignIds.slice(i, i + 30));
    }
    for (const chunk of chunks) {
      const snap = await ref
        .where('subject.entityType', '==', 'campaign')
        .where('subject.entityId', 'in', chunk)
        .get();
      campaignSubjectDocs.push(...snap.docs);
    }
  }

  const seen = new Set<string>();
  const out: ActionLiteWire[] = [];
  for (const doc of [...clientSubjectSnap.docs, ...campaignSubjectDocs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const data = doc.data() as Record<string, unknown>;
    if (!includeArchived && data.archived === true) continue;
    const wire = toActionLiteWire(doc.id, data);
    if (wire) out.push(wire);
  }

  // Sort: most-recently-updated first.
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

// ─── Transition (status change) ────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ActionLiteState, ReadonlySet<ActionLiteState>> = {
  open: new Set<ActionLiteState>(['in-progress', 'blocked', 'done']),
  'in-progress': new Set<ActionLiteState>(['open', 'blocked', 'done']),
  blocked: new Set<ActionLiteState>(['open', 'in-progress', 'done']),
  // `done` is terminal per ACTION_LITE_TERMINAL_STATES; we still allow
  // the operator to reopen by transitioning back to `open` because
  // historically the legacy Action UI permitted that and there's no
  // spec language against it. If S5 needs a strict-terminal model,
  // tighten this map at that point.
  done: new Set<ActionLiteState>(['open', 'in-progress']),
};

export async function transitionActionLite(input: {
  tenantId: string;
  workItemId: string;
  newState: ActionLiteState;
  actorUid: string;
  actorName?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const docRef = workItemsRef(input.tenantId).doc(input.workItemId);
  const snap = await docRef.get();
  if (!snap.exists) return { ok: false, reason: 'not-found' };
  const data = snap.data() as Record<string, unknown>;
  const currentState = data.state as ActionLiteState;
  if (currentState === input.newState) {
    return { ok: true }; // no-op
  }
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed?.has(input.newState)) {
    return {
      ok: false,
      reason: `invalid-transition: ${currentState} → ${input.newState}`,
    };
  }
  await docRef.update({
    state: input.newState,
    updatedAt: FieldValue.serverTimestamp(),
    activityLog: FieldValue.arrayUnion({
      type: 'state-changed',
      from: currentState,
      to: input.newState,
      by: { uid: input.actorUid, name: input.actorName ?? input.actorUid },
      at: new Date().toISOString(),
    }),
  });
  return { ok: true };
}
