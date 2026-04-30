'use client';

// =============================================================================
// WorkItemCard — subject-agnostic.
//
// Renders one Work Item: title, body, audience badge, state pill, activity
// log, transition action buttons, and an inline comment box.
//
// Per spec §10 this component MUST NOT branch on `subject.entityType`. The
// state-machine drives the action buttons via `nextStates(workItemType,
// state)`, so adding a new Work Item type (Exclusion, Conflict,
// Relationship slices) is a state-machine table change — this component
// stays the same.
//
// API:
//   PATCH /api/clients/{clientId}/workItems/{workItemId}   (state transitions)
// =============================================================================

import { useState } from 'react';
import { Lock, Users, User, Clock, MessageSquare, Archive } from 'lucide-react';
import { CommentBox } from './CommentBox';
import { nextStates } from '@/lib/workItems/stateMachine';
import {
  WORK_ITEM_AUDIENCE_CONFIG,
  WORK_ITEM_STATE_CONFIG,
  type WishlistClarificationState,
  type WorkItemAudience,
  type WorkItemWire,
} from '@/types/workItem';

export interface WorkItemCardProps {
  clientId: string;
  item: WorkItemWire;
  /** Whether the current user is internal — controls audience override + archive button. */
  isInternal: boolean;
  /** Whether the user can transition this item (any internal user; clients are read-only on state). */
  canTransition: boolean;
  /** Called after a transition or comment is posted so the parent can refetch. */
  onUpdated: () => void;
}

const PRIORITY_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
};

function AudienceIcon({ audience }: { audience: WorkItemAudience }) {
  const cfg = WORK_ITEM_AUDIENCE_CONFIG[audience];
  const className = 'w-3.5 h-3.5';
  if (cfg.icon === 'lock') return <Lock className={className} />;
  if (cfg.icon === 'users') return <Users className={className} />;
  return <User className={className} />;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString();
}

function ActivityLog({ entries }: { entries: WorkItemWire['activityLog'] }) {
  if (!entries || entries.length === 0) return null;
  // Show in reverse-chronological order, but skip the very first state-changed
  // (the implicit "raised" at creation) since the title/body already conveys it.
  const displayed = entries
    .filter((e, idx) => !(idx === 0 && e.type === 'state-changed' && e.from === null))
    .slice()
    .reverse();
  if (displayed.length === 0) return null;
  return (
    <ul className="space-y-2 mt-3 text-xs">
      {displayed.map((e, i) => (
        <li key={i} className="flex gap-2 text-gray-600">
          <span className="text-gray-400 shrink-0 w-16">{formatTime(e.at)}</span>
          <span className="flex-1">
            {renderActivity(e)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function renderActivity(e: WorkItemWire['activityLog'][number]): React.ReactNode {
  const who = e.by?.name ?? e.by?.uid ?? 'Someone';
  if (e.type === 'state-changed') {
    return (
      <>
        <span className="font-medium">{who}</span> changed state{' '}
        <span className="text-gray-400">{e.from ?? '—'} → {e.to}</span>
        {e.comment ? <div className="mt-0.5 text-gray-700 italic">&ldquo;{e.comment}&rdquo;</div> : null}
      </>
    );
  }
  if (e.type === 'commented') {
    return (
      <>
        <span className="font-medium">{who}</span> commented
        {e.audience === 'internal' ? <span className="ml-1 text-amber-600">(internal)</span> : null}
        <div className="mt-0.5 text-gray-700">{e.body}</div>
      </>
    );
  }
  if (e.type === 'audience-changed') {
    return (
      <>
        <span className="font-medium">{who}</span> changed audience{' '}
        <span className="text-gray-400">{e.from} → {e.to}</span>
      </>
    );
  }
  if (e.type === 'archived-changed') {
    return (
      <>
        <span className="font-medium">{who}</span> {e.to ? 'archived' : 'unarchived'} this item
      </>
    );
  }
  if (e.type === 'assigned') {
    return (
      <>
        <span className="font-medium">{who}</span> reassigned to{' '}
        {e.to?.name ?? e.to?.uid ?? 'unassigned'}
      </>
    );
  }
  return null;
}

export function WorkItemCard({
  clientId,
  item,
  isInternal,
  canTransition,
  onUpdated,
}: WorkItemCardProps) {
  const [pendingState, setPendingState] = useState<WishlistClarificationState | null>(null);
  const [transitionComment, setTransitionComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);

  const stateCfg = WORK_ITEM_STATE_CONFIG[item.state];
  const audienceCfg = WORK_ITEM_AUDIENCE_CONFIG[item.audience];

  // The state-machine drives available transitions — surface-agnostic.
  const transitions = canTransition ? nextStates(item.workItemType, item.state) : [];

  async function commitTransition(
    target: WishlistClarificationState,
    comment: string,
    commentRequired: boolean
  ) {
    setError(null);
    if (commentRequired && !comment.trim()) {
      setError('A comment is required to close from raised. Add one above.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/workItems/${item.workItemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: target,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          }),
          credentials: 'include',
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setError(errBody.error ?? 'Failed to update state.');
        return;
      }
      setPendingState(null);
      setTransitionComment('');
      onUpdated();
    } catch (err) {
      setError((err as Error).message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function archive() {
    if (!confirm('Archive this Work Item? It will be hidden from default views.')) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/workItems/${item.workItemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: true }),
          credentials: 'include',
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setError(errBody.error ?? 'Failed to archive.');
        return;
      }
      onUpdated();
    } catch (err) {
      setError((err as Error).message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="border rounded-lg bg-white p-4">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 break-words">
            {item.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1" title={audienceCfg.label}>
              <AudienceIcon audience={item.audience} />
              <span>{audienceCfg.label}</span>
            </span>
            <span className="text-gray-300">•</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(item.updatedAt)}
            </span>
            {item.createdBy?.uid && (
              <>
                <span className="text-gray-300">•</span>
                <span>by {item.createdBy.uid}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_STYLE[item.priority]}`}
          >
            {item.priority}
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border"
            style={{
              color: stateCfg.colour,
              backgroundColor: stateCfg.bgColour,
              borderColor: stateCfg.colour,
            }}
          >
            {stateCfg.label}
          </span>
        </div>
      </header>

      {/* Body */}
      {item.body && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{item.body}</p>
      )}

      {/* Activity log */}
      <ActivityLog entries={item.activityLog} />

      {/* Errors */}
      {error && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Transition controls */}
      {transitions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          {pendingState ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-700">
                Transition to{' '}
                <span className="font-semibold">
                  {WORK_ITEM_STATE_CONFIG[pendingState].label}
                </span>
                {transitions.find((t) => t.state === pendingState)?.commentRequired && (
                  <span className="ml-1 text-red-600">— comment required</span>
                )}
              </div>
              <textarea
                value={transitionComment}
                onChange={(e) => setTransitionComment(e.target.value)}
                placeholder={
                  transitions.find((t) => t.state === pendingState)?.commentRequired
                    ? 'Why are you closing without a clarification step? (required)'
                    : 'Optional comment to record with the transition'
                }
                rows={2}
                maxLength={2000}
                className="w-full border rounded px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingState(null);
                    setTransitionComment('');
                    setError(null);
                  }}
                  disabled={submitting}
                  className="px-3 py-1 text-xs rounded border text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = transitions.find((x) => x.state === pendingState);
                    if (!t) return;
                    commitTransition(pendingState, transitionComment, t.commentRequired);
                  }}
                  disabled={submitting}
                  className="px-3 py-1 text-xs rounded bg-blue-600 text-white font-medium disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {transitions.map((t) => (
                <button
                  key={t.state}
                  type="button"
                  onClick={() => {
                    setPendingState(t.state);
                    setError(null);
                  }}
                  className="px-3 py-1 text-xs rounded border border-gray-300 hover:border-blue-500 hover:bg-blue-50 text-gray-700"
                >
                  Mark as {WORK_ITEM_STATE_CONFIG[t.state].label.toLowerCase()}
                  {t.commentRequired ? ' …' : ''}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCommentBox((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-gray-600 hover:text-blue-600"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {showCommentBox ? 'Hide comment' : 'Comment'}
              </button>
              {isInternal && !item.archived && (
                <button
                  type="button"
                  onClick={archive}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-gray-500 hover:text-red-600 disabled:opacity-50"
                  title="Archive (internal-admin only)"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Comment-only path (terminal state, or user just wants to comment) */}
      {showCommentBox && !pendingState && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <CommentBox
            clientId={clientId}
            workItemId={item.workItemId}
            defaultAudience={item.audience}
            isInternal={isInternal}
            onCommented={() => {
              setShowCommentBox(false);
              onUpdated();
            }}
          />
        </div>
      )}

      {/* Terminal state — comment-only is still useful */}
      {transitions.length === 0 && !item.archived && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowCommentBox((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-gray-600 hover:text-blue-600"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {showCommentBox ? 'Hide comment' : 'Add comment'}
          </button>
        </div>
      )}
    </article>
  );
}
