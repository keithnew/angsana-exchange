'use client';

// =============================================================================
// CommentBox — subject-agnostic + S3-P3 audience-picker overlay.
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
//
// S3-code-P3 surgical patch (~150–200 LoC delta):
//   - MentionPicker overlay anchored below the textarea, opens when the
//     user types `@` and tracks the active token via
//     `findActiveMentionToken` (lib/mentions/parseMentions.ts).
//   - Picker scope filters by Decision #11's audience-class table —
//     `internal` audience hides client-class candidates; `shared` /
//     `client` audiences expose both classes.
//   - Picking a candidate replaces the active `@<query>` token with
//     `@<email> ` so the canonical mention shape is `@<email>` (parsed
//     by `extractMentionTokens`).
//   - Below-the-textarea preview line: each `@<email>` token in the
//     pending body renders as a styled chip when the email resolves to
//     a directory user whose audience-class passes the filter, OR as
//     plain text when it doesn't (§4.1 amendment hand-typed bypass).
//     The visual difference between styled chip and plain text is the
//     user-facing signal that the mention did not take.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WORK_ITEM_AUDIENCE_CONFIG,
  type WorkItemAudience,
} from '@/types/workItem';
import {
  classifyHandTypedMention,
  deriveAudienceClass,
  type DirectoryUser,
} from '@/lib/mentions/audienceClass';
import {
  findActiveMentionToken,
  extractMentionTokens,
} from '@/lib/mentions/parseMentions';
import {
  MentionPicker,
  type MentionCandidate,
} from './MentionPicker';

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

/**
 * Bridge type — both `MentionCandidate` (from the picker) and the
 * directory loaded via `/api/tenant/users` satisfy this shape, so we
 * can use either for the styled-chip classifier.
 */
interface ChipDirectoryUser extends DirectoryUser {
  email: string;
  role: string;
}

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

  // S3-P3 picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerAnchor, setPickerAnchor] = useState<
    { top: number; left: number } | undefined
  >(undefined);
  /**
   * Lazy directory cache for the chip-preview classifier. Populated
   * after the picker fetches the directory the first time. The picker
   * holds its own cache too; we keep one here too to avoid a circular
   * `imperative` ref handoff.
   */
  const [directory, setDirectory] = useState<ChipDirectoryUser[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Update the picker token + anchor on every value/caret change.
  function refreshPickerFromCaret(value: string, caret: number) {
    const active = findActiveMentionToken(value, caret);
    if (active) {
      setPickerOpen(true);
      setPickerQuery(active.query);
      // Anchor the popover below the textarea — coarse but adequate
      // for v0.1. The textarea wraps multi-line; pinning to the
      // textarea's bottom-left is operator-readable and avoids the
      // canvas-measuring complexity of inline anchoring.
      const ta = textareaRef.current;
      if (ta) {
        setPickerAnchor({
          top: ta.offsetHeight + 4,
          left: 0,
        });
      }
    } else {
      setPickerOpen(false);
      setPickerQuery('');
    }
  }

  function onChangeBody(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    refreshPickerFromCaret(value, e.target.selectionStart ?? value.length);
  }

  function onClosePicker() {
    setPickerOpen(false);
  }

  function onPickCandidate(candidate: MentionCandidate) {
    // Cache for the chip-preview classifier (separate from the picker's
    // own cache, but populated from the same shape).
    setDirectory((prev) => {
      if (prev.find((u) => u.email === candidate.email)) return prev;
      return [...prev, candidate];
    });

    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? body.length;
    const active = findActiveMentionToken(body, caret);
    if (!active) {
      // Fallback: append `@<email> ` to the body.
      setBody((b) => `${b}@${candidate.email} `);
      setPickerOpen(false);
      return;
    }
    const before = body.slice(0, active.start);
    const after = body.slice(active.end);
    const replacement = `@${candidate.email} `;
    const next = `${before}${replacement}${after}`;
    setBody(next);
    setPickerOpen(false);
    // Restore caret position after the inserted token.
    requestAnimationFrame(() => {
      if (ta) {
        const newCaret = before.length + replacement.length;
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
      }
    });
  }

  // When the body is finalised (or just changes), classify each `@<email>`
  // token for styled-chip vs plain-text rendering. We use the
  // `directory` we've accumulated from the picker; a hand-typed
  // `@unknown@example.com` will not be in `directory`, so the
  // classifier returns 'plain-text' — the visual difference IS the
  // signal (§4.1 amendment).
  const tokens = useMemo(() => extractMentionTokens(body), [body]);
  const tokenRenderKinds = useMemo(() => {
    const map = new Map<string, 'styled-chip' | 'plain-text'>();
    for (const t of tokens) {
      const kind = classifyHandTypedMention(t.identifier, directory, audience);
      map.set(t.raw, kind);
    }
    return map;
  }, [tokens, directory, audience]);

  // Pre-fetch directory in the background on first render so the chip
  // classifier has ground-truth even before the picker is opened. This
  // is essential so a hand-typed `@<email>` for a directory-known user
  // ALSO renders as a styled chip without first opening the picker.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/users', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((body: { users: ChipDirectoryUser[] }) => {
        if (cancelled) return;
        setDirectory((prev) => {
          // Merge — picker may have added entries already.
          const seen = new Set(prev.map((p) => p.email.toLowerCase()));
          const additions = (body.users ?? []).filter(
            (u) => !seen.has((u.email ?? '').toLowerCase())
          );
          return [...prev, ...additions];
        });
      })
      .catch(() => {
        // Silent — chip preview just degrades to plain-text everywhere
        // when the directory fails to load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={onChangeBody}
          onKeyUp={(e) => {
            const t = e.currentTarget;
            refreshPickerFromCaret(t.value, t.selectionStart ?? t.value.length);
          }}
          onClick={(e) => {
            const t = e.currentTarget;
            refreshPickerFromCaret(t.value, t.selectionStart ?? t.value.length);
          }}
          placeholder={placeholder}
          maxLength={COMMENT_MAX}
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <MentionPicker
          open={pickerOpen}
          query={pickerQuery}
          commentAudience={audience}
          anchor={pickerAnchor}
          onPick={onPickCandidate}
          onClose={onClosePicker}
        />
      </div>

      {/* §4.1 mention preview — styled chip vs plain text per token */}
      {tokens.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1 text-xs"
          aria-label="Mentions in this comment"
          data-testid="mention-preview"
        >
          <span className="text-gray-400">Mentions:</span>
          {tokens.map((t, i) => {
            const kind = tokenRenderKinds.get(t.raw) ?? 'plain-text';
            if (kind === 'styled-chip') {
              const known = directory.find(
                (u) =>
                  (u.email ?? '').toLowerCase() ===
                  t.identifier.toLowerCase()
              );
              const cls = known
                ? deriveAudienceClass(known.role)
                : 'internal';
              return (
                <span
                  key={`${t.start}-${i}`}
                  data-mention-render="styled-chip"
                  data-audience-class={cls}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                    cls === 'internal'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                  title={`Mention will fire — audienceClass: ${cls}`}
                >
                  {t.raw}
                </span>
              );
            }
            return (
              <span
                key={`${t.start}-${i}`}
                data-mention-render="plain-text"
                className="text-gray-500 font-mono"
                title="Mention will NOT fire — out of audience or unknown"
              >
                {t.raw}
              </span>
            );
          })}
        </div>
      )}

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
