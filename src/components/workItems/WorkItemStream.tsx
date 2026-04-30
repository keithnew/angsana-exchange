'use client';

// =============================================================================
// WorkItemStream — subject-agnostic.
//
// Renders the discussion stream for a given Work Item subject. The four
// R2 PVS surfaces (Wishlists, Exclusions, Conflicts, Relationships) all
// mount this same component, distinguished only by the `subject` prop.
//
// Subject-agnostic discipline (spec §10):
//   - This component MAY *propagate* `subject.entityType` (it is sent to
//     the API as a filter, and the subject is passed through opaquely to
//     RaiseQuestionForm).
//   - This component MUST NOT *branch behaviour* on `subject.entityType`.
//   - Pre-commit grep target for the discipline: `subject\.entityType\s*===`
//     under src/components/workItems/ should return empty.
//
// API: GET /api/clients/{clientId}/workItems?subjectEntityType=...&subjectEntityId=...
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { WorkItemCard } from './WorkItemCard';
import { RaiseQuestionForm } from './RaiseQuestionForm';
import type {
  WorkItemSubject,
  WorkItemType,
  WorkItemWire,
} from '@/types/workItem';
import type { UserRole } from '@/types';

export interface WorkItemStreamProps {
  clientId: string;
  /** What the stream is *about*. Propagated, not branched on. */
  subject: WorkItemSubject;
  /** Default Work Item type for new items raised from this stream. */
  workItemType: WorkItemType;
  /** The current user's role — drives audience overrides and transition rights. */
  currentUserRole: UserRole;
  /** Override the default empty-state copy. Stays subject-agnostic in default. */
  emptyStateLabel?: string;
}

function isInternalRole(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

export function WorkItemStream({
  clientId,
  subject,
  workItemType,
  currentUserRole,
  emptyStateLabel = 'No questions or notes yet.',
}: WorkItemStreamProps) {
  const [items, setItems] = useState<WorkItemWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [raising, setRaising] = useState(false);

  const internal = isInternalRole(currentUserRole);
  const canTransition = internal; // Per spec §4.3: only internal users transition.

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('subjectEntityType', subject.entityType);
        params.set('subjectEntityId', subject.entityId);
        if (!showClosed) params.set('openOnly', 'true');
        const res = await fetch(
          `/api/clients/${clientId}/workItems?${params.toString()}`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          const errBody = await res
            .json()
            .catch(() => ({ error: `${res.status} ${res.statusText}` }));
          setError(errBody.error ?? 'Failed to load Work Items.');
          return;
        }
        const data = (await res.json()) as { items: WorkItemWire[] };
        setItems(data.items ?? []);
      } catch (err) {
        setError((err as Error).message ?? 'Network error.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [clientId, subject.entityType, subject.entityId, showClosed]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = items.filter((i) => i.state !== 'closed').length;
  const closedCount = items.filter((i) => i.state === 'closed').length;

  return (
    <section className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-600">
          <span className="font-medium text-gray-900">
            {openCount} open
          </span>
          {showClosed && closedCount > 0 && (
            <span className="ml-2 text-gray-500">
              · {closedCount} closed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show closed
          </label>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="p-1 rounded text-gray-500 hover:text-gray-800 disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh stream"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Raise question */}
      {raising ? (
        <RaiseQuestionForm
          clientId={clientId}
          subject={subject}
          workItemType={workItemType}
          isInternal={internal}
          onCreated={() => {
            setRaising(false);
            void load(true);
          }}
          onCancel={() => setRaising(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setRaising(true)}
          className="w-full px-3 py-2 text-sm rounded border border-dashed border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/30"
        >
          + Raise a question
        </button>
      )}

      {/* Errors */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-500">
          {emptyStateLabel}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <WorkItemCard
              key={item.workItemId}
              clientId={clientId}
              item={item}
              isInternal={internal}
              canTransition={canTransition}
              onUpdated={() => void load(true)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
