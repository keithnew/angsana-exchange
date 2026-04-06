'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Action, ActionStatus, ActionPriority } from '@/types';
import { ACTION_STATUS_CONFIG, ACTION_PRIORITY_CONFIG } from '@/types';

// =============================================================================
// Helpers
// =============================================================================

function formatDate(iso: string): string {
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

function isOverdue(dueDate: string, status: ActionStatus): boolean {
  if (status === 'done') return false;
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusBadge({
  status,
  actionId,
  clientId,
  isInternal,
  onStatusChange,
}: {
  status: ActionStatus;
  actionId: string;
  clientId: string;
  isInternal: boolean;
  onStatusChange: (actionId: string, newStatus: ActionStatus) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [updating, setUpdating] = useState(false);
  const config = ACTION_STATUS_CONFIG[status];

  async function handleStatusChange(newStatus: ActionStatus) {
    setUpdating(true);
    setShowDropdown(false);
    try {
      const res = await fetch(`/api/clients/${clientId}/actions/${actionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(actionId, newStatus);
      }
    } catch {
      // Silently fail — user can retry
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
        title={isInternal ? 'Click to change status' : undefined}
      >
        {updating ? '...' : config.label}
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-gray-200 bg-white shadow-lg">
            {(Object.keys(ACTION_STATUS_CONFIG) as ActionStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusChange(s)}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${s === status ? 'font-bold' : ''}`}
                style={{ color: ACTION_STATUS_CONFIG[s].colour }}
              >
                {ACTION_STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: ActionPriority }) {
  const config = ACTION_PRIORITY_CONFIG[priority];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color: config.colour, backgroundColor: config.bgColour }}
    >
      {config.label}
    </span>
  );
}

// =============================================================================
// Filters
// =============================================================================

type StatusFilter = 'active' | 'all' | ActionStatus;
type PriorityFilter = 'all' | ActionPriority;

// =============================================================================
// Main Component
// =============================================================================

export function ActionListClient({
  actions: initialActions,
  clientId,
  campaigns,
  isInternal,
}: {
  actions: Action[];
  clientId: string;
  campaigns: { id: string; campaignName: string }[];
  isInternal: boolean;
}) {
  const [actions, setActions] = useState(initialActions);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  function handleStatusChange(actionId: string, newStatus: ActionStatus) {
    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, status: newStatus } : a))
    );
  }

  function getCampaignName(campaignId: string): string {
    if (!campaignId) return '—';
    const campaign = campaigns.find((c) => c.id === campaignId);
    return campaign ? campaign.campaignName : campaignId;
  }

  // Apply filters
  let filtered = actions;
  if (statusFilter === 'active') {
    filtered = filtered.filter((a) => a.status !== 'done');
  } else if (statusFilter !== 'all') {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }
  if (priorityFilter !== 'all') {
    filtered = filtered.filter((a) => a.priority === priorityFilter);
  }

  // Sort: priority (high first), then due date (soonest first)
  const priorityOrder: Record<ActionPriority, number> = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--muted)]">Status:</span>
          {(['active', 'all', 'open', 'in-progress', 'blocked', 'done'] as StatusFilter[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-gray-100 text-[var(--muted)] hover:bg-gray-200'
                }`}
              >
                {s === 'active' ? 'Active' : s === 'all' ? 'All' : ACTION_STATUS_CONFIG[s as ActionStatus]?.label || s}
              </button>
            )
          )}
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
              {p === 'all' ? 'All' : ACTION_PRIORITY_CONFIG[p as ActionPriority]?.label || p}
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
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Assigned To
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Due Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Campaign
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((action) => {
              const overdue = isOverdue(action.dueDate, action.status);
              return (
                <tr key={action.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {action.title}
                    </span>
                    {action.description && (
                      <p className="mt-0.5 text-xs text-[var(--muted)] truncate max-w-xs">
                        {action.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge
                      status={action.status}
                      actionId={action.id}
                      clientId={clientId}
                      isInternal={isInternal}
                      onStatusChange={handleStatusChange}
                    />
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--foreground)]">
                    {action.assignedTo}
                  </td>
                  <td className={`px-4 py-4 text-sm ${overdue ? 'text-red-600 font-medium' : 'text-[var(--muted)]'}`}>
                    {formatDate(action.dueDate)}
                    {overdue && <span className="ml-1 text-xs">⚠</span>}
                  </td>
                  <td className="px-4 py-4">
                    <PriorityBadge priority={action.priority} />
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--muted)]">
                    {action.relatedCampaign ? (
                      <Link
                        href={`/clients/${clientId}/campaigns/${action.relatedCampaign}`}
                        className="text-[var(--primary)] hover:underline truncate block max-w-[150px]"
                        title={getCampaignName(action.relatedCampaign)}
                      >
                        {getCampaignName(action.relatedCampaign)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-4 text-sm text-[var(--muted)]">
                    {action.source.type === 'checkin' && action.source.ref ? (
                      <Link
                        href={`/clients/${clientId}/checkins/${action.source.ref}`}
                        className="text-[var(--primary)] hover:underline"
                      >
                        Check-in
                      </Link>
                    ) : (
                      'Manual'
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--muted)]">
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
