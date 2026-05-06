// =============================================================================
// Action → action-lite Work Item field mapper (pure).
//
// Implements the field-by-field mapping table in
// `exchange-actions-retirement-handover-S3-pre-code.md` §"What S3 will
// deliver per phase → P2", with sign-off from Decisions #1 + #9.
//
// The mapping is a pure function — no Firestore, no time, no IO. Tests
// drive it directly with fixture documents. The reseed script wraps it
// with the Firestore read/write loop and the migrationSource provenance
// shape.
//
// Decision #1: auto-mint workItemId via uuid; old actionId carried on
//              `migrationSource.sourceId` for spotcheck + idempotency.
// Decision #9: `Action.createdBy` → `raisedBy.userId`, with `'system'`
//              fallback when createdBy is missing/empty.
//
// raisedBy.role:
//   action-lite registers `raisedByRoles: ['am','ad','researcher','client','system']`.
//   The raisedBy validator (lib/workItems/raisedBy.ts) requires the role
//   string be present in the registry whenever the registry is non-empty.
//   The reseed itself is a system-driven operation; the caller of the
//   underlying createWorkItem is the operator running the script, not the
//   author of the original Action. We therefore set `role: 'system'` for
//   every reseeded item, with `userId` carrying the legacy-era createdBy
//   value as forensic attribution. Spec §7.1 supports this directly:
//   "the role 'system' when auto-generated from check-in flows" — and the
//   reseed is the analogous system-driven creation path.
//
// subject mapping (Decision-table row 11/12):
//   Non-empty `relatedCampaign` → `subject = {entityType: 'campaign', entityId}`
//   Empty/absent `relatedCampaign` → `subject = {entityType: 'client', entityId: clientId}`
//
// Timestamp conversion:
//   Source `dueDate`/`createdAt`/`updatedAt` are Firestore Timestamps.
//   Target shape carries `deadline` as a Firestore Timestamp (the Work
//   Item primitive stores deadlines as Timestamp; ISO 8601 is the
//   wire/spotcheck representation only). The mapper returns the deadline
//   as the source Timestamp passthrough; the script wraps to admin SDK.
// =============================================================================

import type { Timestamp } from 'firebase-admin/firestore';

// ─── Source shape (mirrors src/types/index.ts:708 Action) ──────────────────

/**
 * Source document as read from
 * `tenants/{tenantId}/clients/{clientId}/actions/{actionId}`.
 *
 * Fields are typed permissively because real Firestore docs can drift
 * (the live probe confirmed 0 drift, but the mapper handles
 * absence/null/empty defensively).
 */
export interface SourceAction {
  /** Document ID (the legacy actionId). */
  id: string;
  title?: string;
  description?: string;
  assignedTo?: string;
  dueDate?: Timestamp | null;
  status?: 'open' | 'in-progress' | 'done' | 'blocked' | string;
  priority?: 'high' | 'medium' | 'low' | string;
  source?: { type?: string; ref?: string };
  relatedCampaign?: string;
  createdBy?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

// ─── Target shape (mirrors angsana-core-prod-project lib/workItems/types.ts) ─

export type WorkItemAudience = 'internal' | 'shared' | 'client';
export type WorkItemVisibility = 'normal' | 'system-only';
export type WorkItemPriority = 'high' | 'medium' | 'low';
export type WorkItemScope = 'tenant' | 'core-platform';

export interface Subject {
  scope: 'tenant' | 'platform';
  scopeRef: string | null;
  entityType: string;
  entityId: string;
}

export interface Owner {
  userId: string;
  tenantId: string;
}

export interface RaisedBy {
  userId: string;
  tenantId: string;
  role?: string;
}

export interface CreatedBy {
  userId: string;
  tenantId: string;
}

/**
 * Provenance crumb per Reseed Pattern v0.1 + S3-pre-code Decision #1.
 *
 *   sourceCollection : 'actions'
 *   sourceClientId   : the legacy clientId
 *   sourceId         : the old Firestore docId — the spotcheck pivot
 *   reseedRun        : the run identifier (timestamp slug)
 *   notes            : forensic — original `source.type` + `source.ref`
 */
export interface MigrationSource {
  sourceCollection: 'actions';
  sourceClientId: string;
  sourceId: string;
  reseedRun: string;
  notes?: {
    sourceType?: string;
    sourceRef?: string;
  };
}

/**
 * Subset of the Work Item document produced by the mapper. The reseed
 * script adds workItemId, createdAt/updatedAt (server timestamps), and
 * an empty activityLog before persisting. Mirrors the WorkItem shape at
 * `angsana-core-prod-project/functions/src/lib/workItems/types.ts`.
 */
export interface MappedWorkItem {
  workItemType: 'action-lite';
  subject: Subject;
  state: 'open' | 'in-progress' | 'done' | 'blocked';
  audience: WorkItemAudience;
  visibility: WorkItemVisibility;
  archived: false;
  owner: Owner | null;
  raisedBy: RaisedBy;
  priority: WorkItemPriority;
  /** Firestore Timestamp passthrough; null if absent on source. */
  deadline: Timestamp | null;
  title: string;
  body: string;
  source: { type: string; ref: string } | null;
  relations: never[];
  tenantId: string;
  scope: 'tenant';
  /** Decision #1 provenance shape. Carried on every reseeded doc. */
  migrationSource: MigrationSource;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const TARGET_TYPE_ID = 'action-lite';
export const SCHEMA_VERSION_SOURCE = 'r2-action-v1';
export const SCHEMA_VERSION_TARGET = 'r3-action-lite-v1';

const VALID_STATES = new Set(['open', 'in-progress', 'done', 'blocked']);
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

// ─── Mapper ─────────────────────────────────────────────────────────────────

export interface MapInput {
  /** The legacy Action doc, with `id` carrying the Firestore docId. */
  action: SourceAction;
  /** Tenant the reseed is operating within (e.g. 'angsana'). */
  tenantId: string;
  /** Source client (e.g. 'cegid-spain'); used for client-subject fallback. */
  clientId: string;
  /** Run identifier; carried on `migrationSource.reseedRun`. */
  reseedRun: string;
}

/**
 * Map a single Action document to the mapped Work Item shape. Pure;
 * deterministic given input. Throws on invalid status/priority because
 * those would silently corrupt downstream state — the live probe
 * confirms only the four declared values are present, so a throw is
 * how the reseed surfaces unexpected drift.
 */
export function mapActionToWorkItem(input: MapInput): MappedWorkItem {
  const { action, tenantId, clientId, reseedRun } = input;

  // Validate enums up front. The probe confirmed only declared values
  // are present; a throw here would only fire on unexpected drift, and
  // it's the right surface for that signal.
  const status = action.status ?? 'open';
  if (!VALID_STATES.has(status)) {
    throw new Error(
      `mapActionToWorkItem: unexpected status "${status}" on actionId ${action.id}; ` +
        `expected one of ${[...VALID_STATES].join(',')}`
    );
  }
  const priority = action.priority ?? 'medium';
  if (!VALID_PRIORITIES.has(priority)) {
    throw new Error(
      `mapActionToWorkItem: unexpected priority "${priority}" on actionId ${action.id}; ` +
        `expected one of ${[...VALID_PRIORITIES].join(',')}`
    );
  }

  // Subject resolution — the conditional from Decision #1 / pre-code §"P2".
  // Non-empty `relatedCampaign` → campaign subject; else client subject.
  // Empty-string `relatedCampaign` and absent `relatedCampaign` collapse
  // to the same client-subject branch (live probe shows both cases).
  const relatedCampaign = (action.relatedCampaign ?? '').trim();
  const subject: Subject =
    relatedCampaign.length > 0
      ? {
          scope: 'tenant',
          scopeRef: tenantId,
          entityType: 'campaign',
          entityId: relatedCampaign,
        }
      : {
          scope: 'tenant',
          scopeRef: tenantId,
          entityType: 'client',
          entityId: clientId,
        };

  // owner: action.assignedTo → owner.userId. Missing → null (action-lite
  // supports unassigned per S1 type body).
  const assignedTo = (action.assignedTo ?? '').trim();
  const owner: Owner | null =
    assignedTo.length > 0
      ? { userId: assignedTo, tenantId }
      : null;

  // raisedBy: createdBy → userId, fallback 'system' (Decision #9). Role
  // is always 'system' (see module header rationale).
  const createdBy = (action.createdBy ?? '').trim();
  const raisedBy: RaisedBy = {
    userId: createdBy.length > 0 ? createdBy : 'system',
    tenantId,
    role: 'system',
  };

  // source provenance crumbs preserved on migrationSource.notes (forensic
  // only; the Action's `source.type`/`source.ref` would otherwise be lost
  // when the action-lite type's `source` field uses a different
  // convention — Spec §2.1 `source` carries `{type: 'check-in', ref:
  // 'tenants/.../checkIns/abc'}` while the legacy Action.source carries
  // `{type: 'checkin', ref: '<checkInId>'}`). We keep them on the
  // migration crumb rather than guessing the new shape.
  const sourceNotes: MigrationSource['notes'] = {};
  if (action.source?.type) sourceNotes.sourceType = action.source.type;
  if (action.source?.ref) sourceNotes.sourceRef = action.source.ref;

  return {
    workItemType: TARGET_TYPE_ID,
    subject,
    state: status as MappedWorkItem['state'],
    audience: 'internal',  // action-lite default per §7.1
    visibility: 'normal',  // action-lite default per §7.1
    archived: false,
    owner,
    raisedBy,
    priority: priority as WorkItemPriority,
    deadline: action.dueDate ?? null,
    title: action.title ?? '',
    body: action.description ?? '',
    source: null, // legacy Action.source preserved on migrationSource.notes; see above
    relations: [],
    tenantId,
    scope: 'tenant',
    migrationSource: {
      sourceCollection: 'actions',
      sourceClientId: clientId,
      sourceId: action.id,
      reseedRun,
      notes: Object.keys(sourceNotes).length > 0 ? sourceNotes : undefined,
    },
  };
}
