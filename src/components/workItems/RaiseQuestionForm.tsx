'use client';

// =============================================================================
// RaiseQuestionForm — subject-agnostic.
//
// Posts a new Work Item against the supplied `subject`. Per spec §10 this
// component MUST NOT branch on `subject.entityType` — it propagates the
// subject through to the API call as opaque data. The label "Raise a
// question" is generic; if a future surface wants different copy it can
// pass a `titlePrompt` / `bodyPrompt`.
//
// API: POST /api/clients/{clientId}/workItems
// =============================================================================

import { useState } from 'react';
import {
  WISHLIST_CLARIFICATION_DEFAULTS,
  WORK_ITEM_AUDIENCE_CONFIG,
  type WorkItemAudience,
  type WorkItemSubject,
  type WorkItemType,
} from '@/types/workItem';

export interface RaiseQuestionFormProps {
  clientId: string;
  /** What the new Work Item is *about*. Passed through opaquely. */
  subject: WorkItemSubject;
  /** Whether the current user is internal — gates the audience override. */
  isInternal: boolean;
  /** Default work item type for the surface (this slice: 'wishlist-clarification'). */
  workItemType: WorkItemType;
  onCreated: () => void;
  onCancel: () => void;
  /** Optional copy overrides — components remain subject-agnostic. */
  titleLabel?: string;
  titlePlaceholder?: string;
  bodyLabel?: string;
  bodyPlaceholder?: string;
}

const TITLE_MAX = 200;
const BODY_MAX = 2000;

export function RaiseQuestionForm({
  clientId,
  subject,
  isInternal,
  workItemType,
  onCreated,
  onCancel,
  titleLabel = 'Title',
  titlePlaceholder = 'Short summary of the question',
  bodyLabel = 'Details',
  bodyPlaceholder = 'Add context, links, or anything that would help answer this',
}: RaiseQuestionFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<WorkItemAudience>(
    WISHLIST_CLARIFICATION_DEFAULTS.audience
  );
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(
    WISHLIST_CLARIFICATION_DEFAULTS.priority
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/workItems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workItemType,
          subject,
          title: title.trim(),
          body: body.trim(),
          audience,
          priority,
        }),
        credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setError(errBody.error ?? 'Failed to raise question.');
        return;
      }
      setTitle('');
      setBody('');
      onCreated();
    } catch (err) {
      setError((err as Error).message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 border border-blue-200 bg-blue-50/50 rounded-lg p-3"
    >
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {titleLabel} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          maxLength={TITLE_MAX}
          className="w-full border rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="text-xs text-gray-400 text-right mt-0.5">
          {title.length}/{TITLE_MAX}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {bodyLabel}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={bodyPlaceholder}
          maxLength={BODY_MAX}
          rows={4}
          className="w-full border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="text-xs text-gray-400 text-right mt-0.5">
          {body.length}/{BODY_MAX}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {isInternal && (
          <label className="flex items-center gap-1.5">
            <span className="text-gray-700 font-medium">Audience:</span>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as WorkItemAudience)}
              className="border rounded px-2 py-1"
            >
              <option value="shared">{WORK_ITEM_AUDIENCE_CONFIG.shared.label}</option>
              <option value="internal">{WORK_ITEM_AUDIENCE_CONFIG.internal.label}</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <span className="text-gray-700 font-medium">Priority:</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'high' | 'medium' | 'low')}
            className="border rounded px-2 py-1"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded border text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Raise question'}
        </button>
      </div>
    </form>
  );
}
