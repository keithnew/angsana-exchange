'use client';

// =============================================================================
// MentionPicker — composer overlay (S3-code-P3).
//
// Implements the §"The picker contract" inline contract from
// `exchange-actions-retirement-handover-S3-pre-code.md`:
//
//   - Reads `tenants/{tenantId}/users` via the tenant users API
//     (`/api/tenant/users`).
//   - Derives `audienceClass` per user via compute-on-read from `role`
//     (Decision #11, see `lib/mentions/audienceClass.ts`).
//   - Filters by audience compatibility with the comment's audience
//     (Decision #11 table — see `isCandidateVisible`).
//   - Hand-typed `@<email>` bypass: rendering layer responsibility,
//     handled by the patched CommentBox (`classifyHandTypedMention`).
//
// Component contract:
//   - Renders nothing unless `open === true`.
//   - When open, renders a popover with the filtered candidate list.
//   - Calls `onPick(user)` when the operator clicks or Enter-confirms a
//     candidate; the parent inserts the chip token into the textarea.
//   - Calls `onClose()` when the operator clicks outside or hits Escape.
//   - Self-fetches the directory once on mount, keeps in component
//     state. Light: ~10–20 users; the v0.1 default (Decision #11 banked
//     refinement: materialise stored audienceClass if S5 bell-pane
//     scaling needs precomputed values).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveAudienceClass,
  isCandidateVisible,
  type AudienceClass,
  type CommentAudience,
} from '@/lib/mentions/audienceClass';

export interface MentionCandidate {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  audienceClass: AudienceClass;
}

export interface MentionPickerProps {
  /** Controlled open state. Parent sets to true on `@` keystroke. */
  open: boolean;
  /** Free-text query the user has typed after `@`. */
  query: string;
  /** Audience the parent comment will be posted under. */
  commentAudience: CommentAudience;
  /** Position the popover anchors to (relative to its containing block). */
  anchor?: { top: number; left: number };
  onPick: (candidate: MentionCandidate) => void;
  onClose: () => void;
}

interface DirectoryUserApi {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  clientId: string | null;
}

/**
 * Cache the directory at module scope so reopening the picker on the
 * same page is instant. Tiny by construction (~10–20 users); fine to
 * hold forever for the lifetime of the page.
 */
let _directoryCache: MentionCandidate[] | null = null;
let _directoryFetchInflight: Promise<MentionCandidate[]> | null = null;

async function fetchDirectory(): Promise<MentionCandidate[]> {
  if (_directoryCache) return _directoryCache;
  if (_directoryFetchInflight) return _directoryFetchInflight;
  _directoryFetchInflight = (async () => {
    const res = await fetch('/api/tenant/users', { credentials: 'include' });
    if (!res.ok) {
      _directoryFetchInflight = null;
      throw new Error(`/api/tenant/users → ${res.status}`);
    }
    const body = (await res.json()) as { users: DirectoryUserApi[] };
    const candidates: MentionCandidate[] = body.users.map((u) => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      audienceClass: deriveAudienceClass(u.role),
    }));
    _directoryCache = candidates;
    _directoryFetchInflight = null;
    return candidates;
  })();
  return _directoryFetchInflight;
}

/**
 * Test-only — reset the in-module directory cache. Test imports go
 * through this so a previous test's fetch result doesn't leak. Not
 * exported from a barrel; only the test file imports it directly.
 */
export function __resetDirectoryCacheForTests(): void {
  _directoryCache = null;
  _directoryFetchInflight = null;
}

export function MentionPicker(props: MentionPickerProps) {
  const { open, query, commentAudience, anchor, onPick, onClose } = props;

  const [allCandidates, setAllCandidates] = useState<MentionCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Directory load — fire once on first open.
  useEffect(() => {
    if (!open) return;
    if (allCandidates.length > 0) return;
    let cancelled = false;
    fetchDirectory()
      .then((users) => {
        if (cancelled) return;
        setAllCandidates(users);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, allCandidates.length]);

  // Filter: audience-class compatibility + free-text query match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCandidates
      .filter((c) => isCandidateVisible(c.audienceClass, commentAudience))
      .filter((c) => {
        if (!q) return true;
        return (
          c.displayName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        );
      })
      .slice(0, 8); // cap at 8 visible candidates
  }, [allCandidates, query, commentAudience]);

  // Reset highlight when filter changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, commentAudience]);

  // Keyboard handlers — Esc closes; ArrowUp/Down nav; Enter picks.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        const pick = filtered[activeIndex] ?? filtered[0];
        if (pick) onPick(pick);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIndex, onPick, onClose]);

  // Click-outside.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="absolute z-50 max-h-64 w-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
      style={
        anchor
          ? { top: anchor.top, left: anchor.left }
          : { top: 'auto', left: 0 }
      }
      role="listbox"
      aria-label="Mention candidates"
    >
      {loadError && (
        <div className="px-3 py-2 text-xs text-red-600">
          Failed to load directory: {loadError}
        </div>
      )}
      {!loadError && filtered.length === 0 && (
        <div className="px-3 py-2 text-xs text-gray-500">
          {allCandidates.length === 0
            ? 'Loading…'
            : 'No matching users.'}
        </div>
      )}
      {filtered.map((c, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            type="button"
            key={c.uid}
            onClick={(e) => {
              e.preventDefault();
              onPick(c);
            }}
            onMouseEnter={() => setActiveIndex(i)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${
              isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
            }`}
            role="option"
            aria-selected={isActive}
          >
            <div className="flex flex-col">
              <span className="font-medium text-gray-900 truncate">
                {c.displayName}
              </span>
              <span className="text-[11px] text-gray-500 truncate">
                {c.email}
              </span>
            </div>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                c.audienceClass === 'internal'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
              title={`audienceClass: ${c.audienceClass}`}
            >
              {c.audienceClass}
            </span>
          </button>
        );
      })}
    </div>
  );
}
