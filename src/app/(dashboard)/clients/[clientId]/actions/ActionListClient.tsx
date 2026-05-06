'use client';

// =============================================================================
// ActionListClient — list view, S3-code-P3 rewrite onto action-lite.
//
// Consumes ActionLiteWire[] (from
// `lib/workItems/actionLite.ts`) instead of the legacy `Action[]`.
// Status changes hit
//   PATCH /api/clients/{clientId}/action-items/{workItemId}  body: {state}
// instead of the legacy
//   PATCH /api/clients/{clientId}/actions/{actionId}         body: {status}
// =============================================================================

import { useState } from 'react';
import Link from 'next/link';
import {
  ACTION_LITE_STATE_CONFIG,
  ACTION_LITE_PRIORITY_CONFIG,
  type ActionLiteState,
  type ActionLitePriority,
  type ActionLiteWire,
} from '@/lib/workItems/actionLite';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function isOverdue(deadline: string | null, state: ActionLiteState): boolean {
  if (state === 'done') return false;
  if (!deadline) return false;
  const due = new Date(deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StateBadge({
  state,
  workItemId,
  clientId,
  isInternal,
  onStateChange,
}: {
  state: ActionLiteState;
  workItemId: string;
  clientId: string;
  isInternal: boolean;
  onStateChange: (workItemId: string, newState: ActionLiteState) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [updating, setUpdating] = useState(false);
  const config = ACTION_LITE_STATE_CONFIG[state];

  async function handleStateChange(newState: ActionLiteState) {
    setUpdating(true);
    setShowDropdown(false);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/action-items/${workItemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: newState }),
        }
      );
      if (res.ok) {
        onStateChange(workItemId, newState);
      }
    } catch {
      // Silently fail — operator can retry.
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => isInternal && setShowDropdown(!showDropdown)}
        disabled={updating}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${isInternal ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        style={{ color: config.colour, backgroundColor: config.bgColour }}
        title={isInternal ? 'Click to change state' : undefined}
      >
        {updating ? '...' : config.label}
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white shadow-lg">
            {(Object.keys(ACTION_LITE_STATE_CONFIG) as ActionLiteState[]).map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStateChange(s)}
                  className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${s === state ? 'font-bold' : ''}`}
                  style={{ color: ACTION_LITE_STATE_CONFIG[s].colour }}
                >
                  {ACTION_LITE_STATE_CONFIG[s].label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: ActionLitePriority }) {
  const config = ACTION_LITE_PRIORITY_CONFIG[priority];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: config.colour, backgroundColor: config.bgColour }}
    >
      {config.label}
    </span>
  );
}

// ─── Filters ────────────────────────────────────────────────────────────────

type StateFilter = 'active' | 'all' | ActionLiteState;
type PriorityFilter = 'all' | ActionLitePriority;

// ─── Main ───────────────────────────────────────────────────────────────────

export function ActionListClient({
  items: initialItems,
  clientId,
  campaigns,
  isInternal,
}: {
  items: ActionLiteWire[];
  clientId: string;
  campaigns: { id: string; campaignName: string }[];
  isInternal: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [stateFilter, setStateFilter] = useState<StateFilter>('active');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  function handleStateChange(workItemId: string, newState: ActionLiteState) {
    setItems((prev) =>
      prev.map((a) =>
        a.workItemId === workItemId ? { ...a, state: newState } : a
      )
    );
  }

  function getCampaignName(campaignId: string): string {
    if (!campaignId) return '—';
    const campaign = campaigns.find((c) => c.id === campaignId);
    return campaign ? campaign.campaignName : campaignId;
  }

  // Apply filters.
  let filtered = items;
  if (stateFilter === 'active') {
    filtered = filtered.filter((a) => a.state !== 'done');
  } else if (stateFilter !== 'all') {
    filtered = filtered.filter((a) => a.state === stateFilter);
  }
  if (priorityFilter !== 'all') {
    filtered = filtered.filter((a) => a.priority === priorityFilter);
  }

  // Sort: priority (high first), then deadline (soonest first).
  const priorityOrder: Record<ActionLitePriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  filtered.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    const aDue = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bDue = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return aDue - bDue;
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--muted)]">State:</span>
          {(
            ['active', 'all', 'open', 'in-progress', 'blocked', 'done'] as StateFilter[]
          ).map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                stateFilter === s
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-gray-100 text-[var(--muted)] hover:bg-gray-200'
              }`}
            >
              {s === 'active'
                ? 'Active'
                : s === 'all'
                  ? 'All'
                  : ACTION_LITE_STATE_CONFIG[s as ActionLiteState]?.label || s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--muted)]">Priority:</span>
          {(['all', 'high', 'medium', 'low'] as PriorityFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                priorityFilter === p
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-gray-100 text-[var(--muted)] hover:bg-gray-200'
              }`}
            >
              {p === 'all'
                ? 'All'
                : ACTION_LITE_PRIORITY_CONFIG[p as ActionLitePriority]?.label || p}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Owner
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Deadline
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Subject
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((item) => {
              const overdue = isOverdue(item.deadline, item.state);
              const subjectIsCampaign = item.subject?.entityType === 'campaign';
              return (
                <tr
                  key={item.workItemId}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {item.title}
                    </span>
                    {item.body && (
                      <p className="mt-0.5 text-xs text-[var(--muted)] truncate max-w-xs">
                        {item.body}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <StateBadge
                      state={item.state}
                      workItemId={item.workItemId}
                      clientId={clientId}
                      isInternal={isInternal}
                      onStateChange={handleStateChange}
                    />
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--foreground)]">
                    {item.owner?.userId ?? '—'}
                  </td>
                  <td
                    className={`px-4 py-4 text-sm ${overdue ? 'text-red-600 font-medium' : 'text-[var(--muted)]'}`}
                  >
                    {formatDate(item.deadline)}
                    {overdue && <span className="ml-1 text-xs">⚠</span>}
                  </td>
                  <td className="px-4 py-4">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--muted)]">
                    {subjectIsCampaign ? (
                      <Link
                        href={`/clients/${clientId}/campaigns/${item.subject.entityId}`}
                        className="text-[var(--primary)] hover:underline truncate block max-w-[150px]"
                        title={getCampaignName(item.subject.entityId)}
                      >
                        {getCampaignName(item.subject.entityId)}
                      </Link>
                    ) : (
                      'Client-level'
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-sm text-[var(--muted)]"
                >
                  No actions match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
