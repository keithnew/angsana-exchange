// =============================================================================
// Check-in auto-generation loop — pure helper.
//
// Factored out of the check-in route handlers
// (`api/clients/[clientId]/checkins/route.ts` POST and
//  `api/clients/[clientId]/checkins/[checkInId]/route.ts` PUT) so the
// loop can be tested directly with an injectable `createWorkItem` fake.
//
// What the route does:
//   - Iterates the structured decisions and next-steps on the check-in body.
//   - For each entry where `createAction === true` and `text` is non-empty,
//     builds an action-lite payload (via `actionLite.buildCreatePayload`)
//     and calls the injected creator.
//   - Collects the resulting Work Item IDs in order.
// =============================================================================

import {
  buildCreatePayload,
  defaultCheckInDeadline,
  type ActionLitePriority,
  type ActionLiteRaisedBy,
  type ActionLiteCreatePayload,
} from './actionLite';

const VALID_PRIORITIES: ReadonlySet<string> = new Set([
  'high',
  'medium',
  'low',
]);

function normalisePriority(p: unknown): ActionLitePriority {
  if (typeof p === 'string' && VALID_PRIORITIES.has(p)) {
    return p as ActionLitePriority;
  }
  return 'medium';
}

export interface CheckInDecisionInput {
  text: string;
  assignee?: string;
  dueDate?: string;
  priority?: string;
  createAction?: boolean;
}

export interface CheckInNextStepInput {
  text: string;
  owner?: string;
  targetDate?: string;
  priority?: string;
  createAction?: boolean;
}

export interface AutoGenContext {
  tenantId: string;
  clientId: string;
  checkInId: string;
  /** ISO-string check-in date — drives the +7d deadline default. */
  checkInDate: string;
  /** Empty when the check-in has 0 or ≥2 related campaigns. */
  inheritedCampaign: string;
  /** Actor identity for `raisedBy.userId` and `createdBy`. */
  actor: { userId: string; tenantId: string };
}

export type CreateWorkItemFn = (
  payload: ActionLiteCreatePayload,
  options: {
    source: { type: string; ref: string };
    createdBy: { userId: string; tenantId: string };
  }
) => Promise<{ workItemId: string }>;

export interface AutoGenResult {
  workItemIds: string[];
  count: number;
}

const SYSTEM_RAISED_BY: ActionLiteRaisedBy['role'] = 'system';

/**
 * Run the auto-generation loop for a check-in's decisions + next-steps.
 *
 * Pure-but-async — the only IO seam is the injected `createWorkItem`
 * function. The route handler passes `createActionLite` from
 * `actionLitePersistence.ts`; tests pass a stub.
 *
 * Throws on the FIRST createWorkItem rejection — the route handler
 * catches and converts to HTTP 500 (with `partialWorkItemIds` echoed
 * back so the operator can spot orphans). This matches the
 * `checkins/route.ts` behaviour that's described in the route handler
 * header.
 */
export async function runCheckInAutoGen(input: {
  decisions: CheckInDecisionInput[];
  nextSteps: CheckInNextStepInput[];
  context: AutoGenContext;
  createWorkItem: CreateWorkItemFn;
  /**
   * When true, only entries past the existing-count baseline are
   * considered (PUT case — preserves entries that already had Work
   * Items generated). When false (POST case), every `createAction:true`
   * entry generates a Work Item.
   */
  newOnly?: boolean;
  existingDecisionCount?: number;
  existingNextStepCount?: number;
}): Promise<AutoGenResult> {
  const {
    decisions,
    nextSteps,
    context,
    createWorkItem,
    newOnly = false,
    existingDecisionCount = 0,
    existingNextStepCount = 0,
  } = input;

  const sourceCrumb = {
    type: 'check-in',
    ref: `tenants/${context.tenantId}/clients/${context.clientId}/checkIns/${context.checkInId}`,
  };

  const raisedBy: ActionLiteRaisedBy = {
    userId: context.actor.userId,
    tenantId: context.actor.tenantId,
    role: SYSTEM_RAISED_BY,
  };

  const workItemIds: string[] = [];

  for (let i = 0; i < decisions.length; i++) {
    if (newOnly && i < existingDecisionCount) continue;
    const d = decisions[i];
    if (!d.createAction || !d.text) continue;
    const payload = buildCreatePayload({
      tenantId: context.tenantId,
      clientId: context.clientId,
      title: d.text,
      body: '',
      assignedTo: d.assignee || context.actor.userId,
      deadline: defaultCheckInDeadline(context.checkInDate, d.dueDate),
      priority: normalisePriority(d.priority),
      relatedCampaign: context.inheritedCampaign,
      raisedBy,
    });
    const { workItemId } = await createWorkItem(payload, {
      source: sourceCrumb,
      createdBy: context.actor,
    });
    workItemIds.push(workItemId);
  }

  for (let i = 0; i < nextSteps.length; i++) {
    if (newOnly && i < existingNextStepCount) continue;
    const s = nextSteps[i];
    if (!s.createAction || !s.text) continue;
    const payload = buildCreatePayload({
      tenantId: context.tenantId,
      clientId: context.clientId,
      title: s.text,
      body: '',
      assignedTo: s.owner || context.actor.userId,
      deadline: defaultCheckInDeadline(context.checkInDate, s.targetDate),
      priority: normalisePriority(s.priority),
      relatedCampaign: context.inheritedCampaign,
      raisedBy,
    });
    const { workItemId } = await createWorkItem(payload, {
      source: sourceCrumb,
      createdBy: context.actor,
    });
    workItemIds.push(workItemId);
  }

  return { workItemIds, count: workItemIds.length };
}
