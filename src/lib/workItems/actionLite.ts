// =============================================================================
// action-lite Work Item — Exchange-side types + pure helpers.
//
// S3-code-P3:
//   The new Action UI and the rewired check-in auto-generation path both
//   produce and consume action-lite Work Items. action-lite is registered
//   in the platform Work Item Type registry (Spec §7.1) at
//   `platform/root/workItemTypes/action-lite`, with `scope: 'tenant'`,
//   so its instances live at
//     tenants/{tenantId}/workItems/{workItemId}
//   on the **angsana-core-prod** project (see `lib/firebase/coreAdmin.ts`).
//
//   This module is pure — no Firestore, no Cloud Run runtime, no time —
//   so the test suite can drive payload construction, deadline parsing,
//   subject resolution, etc. directly.
//
// Mirrors precedent:
//   The reseed mapper at `lib/migrations/actionToWorkItem.ts` already
//   produces the same shape; it stayed migration-scoped (with
//   `migrationSource` provenance, fixed `raisedBy.role: 'system'`, etc.).
//   This module is the runtime equivalent — used by the new Action UI
//   when an internal user creates an Action manually, and by the
//   check-in auto-gen path when a check-in spawns Actions from
//   decisions / next-steps.
// =============================================================================

import type { Timestamp } from 'firebase-admin/firestore';

// ─── Constants ──────────────────────────────────────────────────────────────

export const ACTION_LITE_TYPE_ID = 'action-lite';

/**
 * action-lite states — copied verbatim from S1 type body (Spec §7.1).
 * Must stay in sync with the registry. The order is the operator-facing
 * progression (open → in-progress → done), with `blocked` as a hold
 * branch outside the linear path.
 */
export const ACTION_LITE_STATES = [
  'open',
  'in-progress',
  'done',
  'blocked',
] as const;
export type ActionLiteState = (typeof ACTION_LITE_STATES)[number];

/**
 * Terminal states — `done` is the only operator-facing terminal value
 * (no notifications fan out, deadline-band cadence stops). `blocked` is
 * NOT terminal: a blocked Work Item still escalates per the cadence in
 * Core's `dedup.ts` (see Decision #3 / Alt A escalating cadence,
 * scheduled for S3-P4).
 */
export const ACTION_LITE_TERMINAL_STATES: ReadonlySet<ActionLiteState> =
  new Set(['done']);

export const ACTION_LITE_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ActionLitePriority = (typeof ACTION_LITE_PRIORITIES)[number];

/**
 * Subject for an action-lite Work Item. Per the reseed mapper + Decision
 * #1, an Action with a `relatedCampaign` resolves to a campaign-subject
 * Work Item; otherwise the subject is the parent client (the historical
 * Action default — Actions are client-level by default).
 */
export interface ActionLiteSubject {
  scope: 'tenant';
  scopeRef: string; // tenantId
  entityType: 'campaign' | 'client';
  entityId: string;
}

export interface ActionLiteOwner {
  userId: string;
  tenantId: string;
}

export interface ActionLiteRaisedBy {
  userId: string;
  tenantId: string;
  /**
   * action-lite registers
   *   raisedByRoles: ['am','ad','researcher','client','system']
   * (Spec §7.1). UI-driven creates pass the actor's mapped role; check-in
   * auto-gen passes `'system'` (the auto-gen path is system-driven —
   * same precedent as the reseed mapper module header at
   * `lib/migrations/actionToWorkItem.ts`).
   */
  role: 'am' | 'ad' | 'researcher' | 'client' | 'system';
}

/**
 * Wire-shape Work Item used by Exchange UI components after read.
 * Server-side route handlers convert the Firestore document to this
 * shape; client components consume it. ISO 8601 strings for timestamps
 * (matches the existing `WorkItemWire` precedent in
 * `src/types/workItem.ts`).
 */
export interface ActionLiteWire {
  workItemId: string;
  typeId: 'action-lite';
  state: ActionLiteState;
  priority: ActionLitePriority;
  title: string;
  body: string;
  subject: ActionLiteSubject;
  owner: ActionLiteOwner | null;
  raisedBy: ActionLiteRaisedBy;
  /** ISO 8601 string; null when no deadline set. */
  deadline: string | null;
  /** ISO 8601 string. */
  createdAt: string;
  /** ISO 8601 string. */
  updatedAt: string;
  archived: boolean;
  audience: 'internal' | 'shared' | 'client';
  visibility: 'normal' | 'system-only';
  /**
   * Forensic crumb when the doc came from the S3-P2 reseed; absent on
   * UI-created records. Carried through so the legacy actionId remains
   * spotcheck-pivotable post-cutover.
   */
  migrationSource?: {
    sourceCollection: 'actions';
    sourceId: string;
    sourceClientId: string;
    reseedRun: string;
  };
}

// ─── Subject resolution ─────────────────────────────────────────────────────

export interface ResolveSubjectInput {
  tenantId: string;
  clientId: string;
  /** Empty string / null / undefined → client subject. */
  relatedCampaign?: string | null;
}

/**
 * The Decision #1 conditional, lifted out of `actionToWorkItem.ts`. Used
 * by both the new Action UI (POST handler resolves the subject from the
 * form's `relatedCampaign` field) and the check-in auto-gen path
 * (`relatedCampaign` derived from the parent check-in's
 * `relatedCampaigns` exactly-1 inheritance rule).
 */
export function resolveSubject(input: ResolveSubjectInput): ActionLiteSubject {
  const related = (input.relatedCampaign ?? '').trim();
  if (related.length > 0) {
    return {
      scope: 'tenant',
      scopeRef: input.tenantId,
      entityType: 'campaign',
      entityId: related,
    };
  }
  return {
    scope: 'tenant',
    scopeRef: input.tenantId,
    entityType: 'client',
    entityId: input.clientId,
  };
}

// ─── Deadline parsing ───────────────────────────────────────────────────────

/**
 * Parse an ISO date / form-date / null into a JS Date suitable for
 * Firestore Timestamp conversion at the call site, or null. Throws on
 * an unparseable string (the form already validates `<input type=date>`
 * shapes; this is defence-in-depth so a malformed body is the right
 * surface for an error rather than a silent NaN).
 */
export function parseDeadline(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid deadline value: ${raw}`);
  }
  return d;
}

// ─── Wire conversion ────────────────────────────────────────────────────────

interface RawWorkItemDoc {
  workItemType?: string;
  typeId?: string;
  state?: string;
  priority?: string;
  title?: string;
  body?: string;
  subject?: ActionLiteSubject;
  owner?: ActionLiteOwner | null;
  raisedBy?: ActionLiteRaisedBy;
  deadline?: Timestamp | string | Date | null;
  createdAt?: Timestamp | string | Date;
  updatedAt?: Timestamp | string | Date;
  archived?: boolean;
  audience?: 'internal' | 'shared' | 'client';
  visibility?: 'normal' | 'system-only';
  migrationSource?: ActionLiteWire['migrationSource'];
}

function toIso(v: Timestamp | string | Date | null | undefined): string {
  if (!v) return new Date(0).toISOString();
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof (v as Timestamp).toDate === 'function') {
    return (v as Timestamp).toDate().toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(
  v: Timestamp | string | Date | null | undefined
): string | null {
  if (!v) return null;
  return toIso(v);
}

/**
 * Convert a raw Firestore doc + its document id to the wire shape the
 * UI consumes. Defensive about missing fields because the reseed mapper
 * and the runtime payload construction below produce slightly different
 * baselines (e.g. the reseed sets `audience: 'internal'`,
 * `visibility: 'normal'` defaults; this function reflects whatever's
 * actually persisted).
 *
 * **Filter, do not throw**, on workItemType/typeId mismatch — the caller
 * should already be querying for action-lite, and a stray non-action-lite
 * doc landing in the result set is best dropped at read time. The
 * function returns `null` to mark such docs.
 */
export function toActionLiteWire(
  workItemId: string,
  raw: RawWorkItemDoc
): ActionLiteWire | null {
  // The reseed mapper writes `workItemType: 'action-lite'`; some fixture
  // data and forward-compat callers may write `typeId: 'action-lite'`.
  // Accept either; use the value that's present.
  const detectedType = raw.typeId ?? raw.workItemType;
  if (detectedType !== ACTION_LITE_TYPE_ID) return null;

  const state = (raw.state ?? 'open') as ActionLiteState;
  if (!ACTION_LITE_STATES.includes(state)) return null;

  const priority = (raw.priority ?? 'medium') as ActionLitePriority;
  if (!ACTION_LITE_PRIORITIES.includes(priority)) return null;

  return {
    workItemId,
    typeId: ACTION_LITE_TYPE_ID,
    state,
    priority,
    title: raw.title ?? '',
    body: raw.body ?? '',
    subject: raw.subject ?? {
      scope: 'tenant',
      scopeRef: '',
      entityType: 'client',
      entityId: '',
    },
    owner: raw.owner ?? null,
    raisedBy: raw.raisedBy ?? {
      userId: 'system',
      tenantId: raw.subject?.scopeRef ?? '',
      role: 'system',
    },
    deadline: toIsoOrNull(raw.deadline),
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
    archived: raw.archived ?? false,
    audience: raw.audience ?? 'internal',
    visibility: raw.visibility ?? 'normal',
    migrationSource: raw.migrationSource,
  };
}

// ─── Create payload construction ───────────────────────────────────────────

export interface BuildCreatePayloadInput {
  tenantId: string;
  clientId: string;
  /** Form / decision text (≤200 chars per Spec §7.1 title rule). */
  title: string;
  /** Form description / next-step body (optional). */
  body?: string;
  /** assignedTo from the form / check-in decision (free text, may be empty). */
  assignedTo?: string | null;
  /** ISO date string from the form (`<input type="date">`) or null. */
  deadline?: string | null;
  priority?: ActionLitePriority;
  /** Empty string / null / undefined → client subject; non-empty → campaign. */
  relatedCampaign?: string | null;
  /** Actor identity — required for both raisedBy and createdBy. */
  raisedBy: ActionLiteRaisedBy;
}

/**
 * Output of `buildCreatePayload` — the document body the route handler
 * writes to Firestore. Intentionally NOT including `workItemId` (auto-mint
 * at the persistence boundary), `createdAt`, `updatedAt` (server
 * timestamps), or `activityLog` (the persistence boundary stamps the
 * initial 'state-changed: null → open' entry just like the existing
 * Work Item POST in `app/api/clients/[clientId]/workItems/route.ts`).
 */
export interface ActionLiteCreatePayload {
  typeId: 'action-lite';
  state: 'open';
  priority: ActionLitePriority;
  title: string;
  body: string;
  subject: ActionLiteSubject;
  owner: ActionLiteOwner | null;
  raisedBy: ActionLiteRaisedBy;
  /**
   * Carried as a Date (the persistence boundary converts to Timestamp
   * via Timestamp.fromDate). Pure helper avoids importing the SDK.
   */
  deadline: Date | null;
  archived: false;
  audience: 'internal';
  visibility: 'normal';
  scope: 'tenant';
  tenantId: string;
}

/**
 * Build a create payload from a UI form or a check-in decision/next-step.
 * Pure — no time, no Firestore. Throws on title overflow / invalid
 * priority / unparseable deadline (defensive — the route handler
 * validates ahead of this, but the throw makes test signal sharper).
 */
export function buildCreatePayload(
  input: BuildCreatePayloadInput
): ActionLiteCreatePayload {
  const title = (input.title ?? '').trim();
  if (!title) {
    throw new Error('buildCreatePayload: title is required');
  }
  if (title.length > 200) {
    throw new Error('buildCreatePayload: title must be ≤200 chars');
  }
  const body = (input.body ?? '').trim();
  if (body.length > 2000) {
    throw new Error('buildCreatePayload: body must be ≤2000 chars');
  }
  const priority: ActionLitePriority = input.priority ?? 'medium';
  if (!ACTION_LITE_PRIORITIES.includes(priority)) {
    throw new Error(
      `buildCreatePayload: invalid priority "${priority}"; ` +
        `expected one of ${ACTION_LITE_PRIORITIES.join(',')}`
    );
  }

  const assignedTo = (input.assignedTo ?? '').trim();
  const owner: ActionLiteOwner | null =
    assignedTo.length > 0
      ? { userId: assignedTo, tenantId: input.tenantId }
      : null;

  const subject = resolveSubject({
    tenantId: input.tenantId,
    clientId: input.clientId,
    relatedCampaign: input.relatedCampaign,
  });

  const deadline = parseDeadline(input.deadline ?? null);

  return {
    typeId: ACTION_LITE_TYPE_ID,
    state: 'open',
    priority,
    title,
    body,
    subject,
    owner,
    raisedBy: input.raisedBy,
    deadline,
    archived: false,
    audience: 'internal',
    visibility: 'normal',
    scope: 'tenant',
    tenantId: input.tenantId,
  };
}

// ─── Default deadline (check-in auto-gen) ──────────────────────────────────

/**
 * Per the legacy check-in auto-gen path (today: `actionsRef.doc()` write
 * with default `dueDate = checkinDate + 7d`), preserve the same default
 * when migrating to action-lite. Pure: takes a check-in date and an
 * explicit override, returns the deadline as an ISO string (or null when
 * intentionally cleared by the caller — the route handler doesn't pass
 * null for defaults; null only happens if a caller wants no deadline at
 * all).
 *
 * Returning ISO string here means the caller passes it straight into
 * `buildCreatePayload({ deadline })`.
 */
export function defaultCheckInDeadline(
  checkInDate: string,
  override?: string | null
): string | null {
  if (override !== undefined && override !== null && override !== '') {
    return override;
  }
  if (!checkInDate) return null;
  const base = new Date(checkInDate);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + 7);
  return base.toISOString();
}

// ─── Display config ─────────────────────────────────────────────────────────

export const ACTION_LITE_STATE_CONFIG: Record<
  ActionLiteState,
  { label: string; colour: string; bgColour: string }
> = {
  open: { label: 'Open', colour: '#2563EB', bgColour: '#EFF6FF' },
  'in-progress': {
    label: 'In Progress',
    colour: '#D97706',
    bgColour: '#FFFBEB',
  },
  done: { label: 'Done', colour: '#059669', bgColour: '#ECFDF5' },
  blocked: { label: 'Blocked', colour: '#DC2626', bgColour: '#FEF2F2' },
};

export const ACTION_LITE_PRIORITY_CONFIG: Record<
  ActionLitePriority,
  { label: string; colour: string; bgColour: string }
> = {
  high: { label: 'High', colour: '#DC2626', bgColour: '#FEF2F2' },
  medium: { label: 'Medium', colour: '#D97706', bgColour: '#FFFBEB' },
  low: { label: 'Low', colour: '#6B7280', bgColour: '#F3F4F6' },
};
