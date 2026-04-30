'use client';

// =============================================================================
// CommentBox — subject-agnostic.
//
// Posts a comment on an existing Work Item. Per spec §10 this component
// MUST NOT branch on subject.entityType — and it doesn't even take a
// subject prop. It only knows the Work Item ID and the parent's audience.
//
// Internal users may override audience (e.g. post a 'shared' comment on
// an 'internal' Work Item, or vice versa). Client users always inherit
// the parent's audience and cannot post 'internal'.
//
// API: POST /api/clients/{clientId}/workItems/{workItemId}/comments
// =============================================================================

import { useState } from 'react';
import {
  WORK_ITEM_AUDIENCE_CONFIG,
  type WorkItemAudience,
} from '@/types/workItem';

export interface CommentBoxProps {
  clientId: string;
  workItemId: string;
  /** Parent Work Item's audience — used as the default for new comments. */
  defaultAudience: WorkItemAudience;
  /** Whether the current user is an internal user (may override audience). */
  isInternal: boolean;
  onCommented: () => void;
  /** Optional placeholder for the textarea. */
  placeholder?: string;
}

const COMMENT_MAX = 2000;

export function CommentBox({
  clientId,
  workItemId,
  defaultAudience,
  isInternal,
  onCommented,
  placeholder = 'Add a comment…',
}: CommentBoxProps) {
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<WorkItemAudience>(defaultAudience);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    if (body.length > COMMENT_MAX) {
      setError(`Comment must be ≤${COMMENT_MAX} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/workItems/${workItemId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: body.trim(), audience }),
          credentials: 'include',
        }
      );
      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setError(errBody.error ?? 'Failed to post comment.');
        return;
      }
      setBody('');
      setAudience(defaultAudience);
      onCommented();
    } catch (err) {
      setError((err as Error).message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={COMMENT_MAX}
        rows={3}
        className="w-full border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">{body.length}/{COMMENT_MAX}</span>
          {isInternal && (
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as WorkItemAudience)}
              className="border rounded px-2 py-1 text-xs"
              aria-label="Comment audience"
            >
              <option value="shared">{WORK_ITEM_AUDIENCE_CONFIG.shared.label}</option>
              <option value="internal">{WORK_ITEM_AUDIENCE_CONFIG.internal.label}</option>
            </select>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting || !body.trim()}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </div>
      )}
    </form>
  );
}
