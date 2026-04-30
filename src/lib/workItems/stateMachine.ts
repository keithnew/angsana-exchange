// =============================================================================
// Work Item state machine
//
// Implements §4.3 of docs/architecture/r2-pvs-s1-wishlists-spec.md.
//
// This slice ships only one type — `wishlist-clarification` — but the
// machine is structured so that adding a type (e.g. `exclusion-question`,
// `relationship-question` in later R2 PVS slices) is a one-row change to
// the TYPE_TRANSITIONS table.
//
// Transitions are enforced server-side at the
//   POST /api/clients/[clientId]/workItems/[workItemId]/transitions
// endpoint. The endpoint calls `validateTransition` and rejects with HTTP
// 409 on `ok: false`.
// =============================================================================

import type {
  WishlistClarificationState,
  WorkItemType,
} from '@/types/workItem';

/**
 * A transition rule: the legal `from → to` plus whether closing this way
 * requires a comment.
 */
interface TransitionRule {
  from: WishlistClarificationState;
  to: WishlistClarificationState;
  /**
   * If true, the API requires a non-empty `comment` payload. Per spec §4.3:
   * the only required-comment transition in this slice is the shortcut
   * `raised → closed` (skipping clarified).
   */
  commentRequired: boolean;
}

const WISHLIST_CLARIFICATION_TRANSITIONS: TransitionRule[] = [
  { from: 'raised', to: 'clarified', commentRequired: false },
  { from: 'clarified', to: 'closed', commentRequired: false },
  { from: 'raised', to: 'closed', commentRequired: true },
];

const TYPE_TRANSITIONS: Record<WorkItemType, TransitionRule[]> = {
  'wishlist-clarification': WISHLIST_CLARIFICATION_TRANSITIONS,
};

// ─── Public API ─────────────────────────────────────────────────────────────

export type ValidateTransitionResult =
  | { ok: true; commentRequired: boolean }
  | {
      ok: false;
      reason:
        | 'no-such-type'
        | 'no-such-transition'
        | 'comment-required'
        | 'already-in-target-state';
    };

/**
 * Validate a proposed state transition for a Work Item.
 *
 * @param workItemType  The type of the Work Item (drives the legal-transition table).
 * @param from          Current persisted state.
 * @param to            Proposed target state.
 * @param hasComment    Whether the request payload includes a non-empty comment.
 *                      (The endpoint trims and length-checks before passing.)
 *
 * @returns ok=true if the transition is legal and (when required) the comment
 *          is present; ok=false with a discriminated reason otherwise.
 */
export function validateTransition(
  workItemType: WorkItemType,
  from: WishlistClarificationState,
  to: WishlistClarificationState,
  hasComment: boolean
): ValidateTransitionResult {
  const rules = TYPE_TRANSITIONS[workItemType];
  if (!rules) return { ok: false, reason: 'no-such-type' };

  if (from === to) return { ok: false, reason: 'already-in-target-state' };

  const rule = rules.find((r) => r.from === from && r.to === to);
  if (!rule) return { ok: false, reason: 'no-such-transition' };

  if (rule.commentRequired && !hasComment) {
    return { ok: false, reason: 'comment-required' };
  }

  return { ok: true, commentRequired: rule.commentRequired };
}

/**
 * Returns the set of states reachable from `from` for the given Work Item
 * type. Used by the UI to render the action buttons; the API still validates
 * via `validateTransition` so the UI is advisory only.
 */
export function nextStates(
  workItemType: WorkItemType,
  from: WishlistClarificationState
): Array<{ state: WishlistClarificationState; commentRequired: boolean }> {
  const rules = TYPE_TRANSITIONS[workItemType];
  if (!rules) return [];
  return rules
    .filter((r) => r.from === from)
    .map((r) => ({ state: r.to, commentRequired: r.commentRequired }));
}

/**
 * Predicate: is this a terminal state? (Currently only `closed` is.) Used
 * by the page-level "open items" count query.
 */
export function isTerminalState(state: WishlistClarificationState): boolean {
  return state === 'closed';
}
