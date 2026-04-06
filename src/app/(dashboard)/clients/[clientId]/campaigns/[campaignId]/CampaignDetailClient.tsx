'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Pencil,
  Play,
  Pause,
  CheckCircle2,
  RotateCcw,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CAMPAIGN_STATUS_CONFIG, CHECKIN_TYPE_CONFIG, ACTION_STATUS_CONFIG } from '@/types';
import type { Campaign, ManagedListItem, StatusHistoryEntry, CheckInType, ActionStatus } from '@/types';

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

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Look up a managed list item's label by ID. */
function lookupLabel(items: ManagedListItem[], id: string): string {
  const item = items.find((i) => i.id === id);
  return item ? item.label : id;
}

/** Get orientation for a title band. */
function lookupOrientation(items: ManagedListItem[], id: string): string | undefined {
  const item = items.find((i) => i.id === id);
  return item?.orientation;
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusBadge({ status }: { status: Campaign['status'] }) {
  const config = CAMPAIGN_STATUS_CONFIG[status] || CAMPAIGN_STATUS_CONFIG.draft;
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
      style={{ color: config.colour, backgroundColor: config.bgColour }}
    >
      {config.label}
    </span>
  );
}

function TagChip({ label, variant }: { label: string; variant?: string }) {
  const colors =
    variant === 'external'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : variant === 'internal'
        ? 'bg-purple-50 text-purple-700 border-purple-200'
        : variant === 'mixed'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-gray-100 text-gray-700 border-gray-200';

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors}`}>
      {label}
      {variant && (
        <span className="ml-1 text-[10px] opacity-60">({variant})</span>
      )}
    </span>
  );
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-6">
          <p className="text-sm text-[var(--accent-gold)] font-medium">Coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Status Transition Controls
// =============================================================================

function StatusActions({
  campaign,
  onTransition,
}: {
  campaign: Campaign;
  clientId: string;
  onTransition: (action: string, reason?: string) => Promise<void>;
}) {
  const [showPauseInput, setShowPauseInput] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAction(action: string, reason?: string) {
    setLoading(true);
    setError('');
    try {
      await onTransition(action, reason);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (campaign.status === 'completed') return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Status Actions
      </p>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {campaign.status === 'draft' && (
          <Button
            size="sm"
            onClick={() => handleAction('activate')}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {loading ? 'Activating...' : 'Activate'}
          </Button>
        )}

        {campaign.status === 'active' && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPauseInput(!showPauseInput)}
              disabled={loading}
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <Pause className="mr-1 h-3.5 w-3.5" />
              Pause
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCompleteConfirm(!showCompleteConfirm)}
              disabled={loading}
              className="border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Complete
            </Button>
          </>
        )}

        {campaign.status === 'paused' && (
          <>
            <Button
              size="sm"
              onClick={() => handleAction('reactivate')}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {loading ? 'Reactivating...' : 'Reactivate'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCompleteConfirm(!showCompleteConfirm)}
              disabled={loading}
              className="border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Complete
            </Button>
          </>
        )}
      </div>

      {/* Pause reason input */}
      {showPauseInput && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            placeholder="Reason for pausing..."
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            maxLength={280}
            className="h-8 text-sm"
          />
          <span className="text-xs text-[var(--muted)] whitespace-nowrap">
            {280 - pauseReason.length}
          </span>
          <Button
            size="sm"
            onClick={() => {
              handleAction('pause', pauseReason);
              setShowPauseInput(false);
              setPauseReason('');
            }}
            disabled={loading || !pauseReason.trim()}
          >
            Confirm Pause
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowPauseInput(false);
              setPauseReason('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Complete confirmation */}
      {showCompleteConfirm && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">
            This is permanent. The campaign will be archived and can no longer be edited.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                handleAction('complete');
                setShowCompleteConfirm(false);
              }}
              disabled={loading}
            >
              Yes, Complete Campaign
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowCompleteConfirm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Status History Timeline
// =============================================================================

function StatusTimeline({ history }: { history: StatusHistoryEntry[] }) {
  if (!history || history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6">
          {/* Timeline line */}
          <div className="absolute left-2 top-2 bottom-2 w-px bg-gray-200" />

          <div className="space-y-4">
            {[...history].reverse().map((entry, i) => (
              <div key={i} className="relative flex gap-3">
                {/* Dot */}
                <div className="absolute -left-4 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--primary)]" />

                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    {entry.from ? (
                      <>
                        <StatusBadge status={entry.from as Campaign['status']} />
                        <ArrowRight className="h-3 w-3 text-[var(--muted)]" />
                        <StatusBadge status={entry.to as Campaign['status']} />
                      </>
                    ) : (
                      <>
                        <span className="text-[var(--muted)]">Created as</span>
                        <StatusBadge status={entry.to as Campaign['status']} />
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(entry.timestamp)}</span>
                    <span>·</span>
                    <span>{entry.changedBy}</span>
                  </div>
                  {entry.reason && (
                    <p className="mt-1 text-xs text-amber-700 italic">
                      Reason: {entry.reason}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function CampaignDetailClient({
  campaign: initialCampaign,
  clientId,
  clientName,
  managedLists,
  isInternal,
  userEmail,
  relatedCheckins = [],
  relatedActions = [],
}: {
  campaign: Campaign;
  clientId: string;
  clientName: string;
  managedLists: Record<string, ManagedListItem[]>;
  isInternal: boolean;
  userEmail: string;
  relatedCheckins?: { id: string; date: string; type: string; keyPoints: string[] }[];
  relatedActions?: { id: string; title: string; status: string; assignedTo: string; dueDate: string }[];
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [toastMessage, setToastMessage] = useState('');

  const isCompleted = campaign.status === 'completed';
  const canEdit = isInternal && !isCompleted;

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  }

  async function handleStatusTransition(action: string, reason?: string) {
    const res = await fetch(`/api/clients/${clientId}/campaigns/${campaign.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Status transition failed');
    }

    const result = await res.json();

    // Update local state
    const now = new Date().toISOString();
    const historyEntry: StatusHistoryEntry = {
      from: campaign.status,
      to: result.newStatus,
      timestamp: now,
      changedBy: userEmail,
      ...(reason ? { reason } : {}),
    };

    setCampaign((prev) => ({
      ...prev,
      status: result.newStatus,
      statusHistory: [...prev.statusHistory, historyEntry],
      ...(action === 'pause' ? { pauseReason: reason || '' } : {}),
      ...(action === 'reactivate' ? { pauseReason: '' } : {}),
    }));

    showToast(`Campaign ${action}d successfully`);
  }

  return (
    <div className="max-w-4xl">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <Link
          href={`/clients/${clientId}/campaigns`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {clientName} campaigns
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">
              {campaign.campaignName}
            </h1>
            <div className="mt-2 flex items-center gap-3">
              <StatusBadge status={campaign.status} />
              {campaign.pauseReason && campaign.status === 'paused' && (
                <span className="text-sm text-amber-700 italic">
                  {campaign.pauseReason}
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <Link href={`/clients/${clientId}/campaigns/${campaign.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Status actions — for internal users, non-completed campaigns */}
      {canEdit && (
        <div className="mb-6">
          <StatusActions
            campaign={campaign}
            clientId={clientId}
            onTransition={handleStatusTransition}
          />
        </div>
      )}

      {/* Campaign Summary Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Campaign Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-[var(--foreground)]">
            {campaign.campaignSummary || <span className="italic text-[var(--muted)]">No summary</span>}
          </p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Service Type
              </p>
              <p className="mt-1 text-sm">
                <span className="inline-flex items-center rounded-full bg-[var(--primary)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">
                  {campaign.serviceType}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Owner
              </p>
              <p className="mt-1 text-sm text-[var(--foreground)]">{campaign.owner}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Start Date
              </p>
              <p className="mt-1 text-sm text-[var(--foreground)]">
                {formatDate(campaign.startDate)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Company Size
              </p>
              <p className="mt-1 text-sm text-[var(--foreground)]">
                {campaign.companySize
                  ? lookupLabel(managedLists.companySizes || [], campaign.companySize)
                  : <span className="italic text-[var(--muted)]">Not specified</span>}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Created
              </p>
              <p className="mt-1 text-sm text-[var(--foreground)]">
                {formatDate(campaign.createdAt)}
                {campaign.createdBy && (
                  <span className="text-[var(--muted)]"> by {campaign.createdBy}</span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Targeting Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Geographies */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Target Geographies
            </p>
            {campaign.targetGeographies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {campaign.targetGeographies.map((id) => (
                  <TagChip key={id} label={lookupLabel(managedLists.geographies || [], id)} />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">Not specified</p>
            )}
          </div>

          {/* Sectors */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Target Sectors
            </p>
            {campaign.targetSectors.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {campaign.targetSectors.map((id) => (
                  <TagChip key={id} label={lookupLabel(managedLists.sectors || [], id)} />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">Not specified</p>
            )}
          </div>

          {/* Title Bands */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Target Titles
            </p>
            {campaign.targetTitles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {campaign.targetTitles.map((id) => (
                  <TagChip
                    key={id}
                    label={lookupLabel(managedLists.titleBands || [], id)}
                    variant={lookupOrientation(managedLists.titleBands || [], id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">Not specified</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Messaging Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Messaging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Value Proposition
            </p>
            {campaign.valueProposition ? (
              <p className="text-sm text-[var(--foreground)]">{campaign.valueProposition}</p>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">Not specified</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Pain Points
            </p>
            {campaign.painPoints.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1">
                {campaign.painPoints.map((point, i) => (
                  <li key={i} className="text-sm text-[var(--foreground)]">{point}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">No pain points defined</p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Selected So Whats
            </p>
            {campaign.selectedSoWhats.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {campaign.selectedSoWhats.map((id) => (
                  <TagChip key={id} label={id} />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">
                No So Whats selected — add from client library
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Related Check-ins */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Related Check-ins</CardTitle>
        </CardHeader>
        <CardContent>
          {relatedCheckins.length > 0 ? (
            <div className="space-y-2">
              {relatedCheckins.map((ci) => {
                const typeConfig = CHECKIN_TYPE_CONFIG[ci.type as CheckInType] || CHECKIN_TYPE_CONFIG.regular;
                return (
                  <Link
                    key={ci.id}
                    href={`/clients/${clientId}/checkins/${ci.id}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-[var(--foreground)] whitespace-nowrap">
                      {formatDate(ci.date)}
                    </span>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ color: typeConfig.colour, backgroundColor: typeConfig.bgColour }}
                    >
                      {typeConfig.label}
                    </span>
                    <span className="text-sm text-[var(--muted)] truncate">
                      {ci.keyPoints[0] || '—'}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm italic text-[var(--muted)]">No check-ins linked to this campaign</p>
          )}
        </CardContent>
      </Card>

      {/* Related Actions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Related Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {relatedActions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                    <th className="pb-2 pr-3">Title</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Assigned To</th>
                    <th className="pb-2">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedActions.map((action) => {
                    const statusConfig = ACTION_STATUS_CONFIG[action.status as ActionStatus] || ACTION_STATUS_CONFIG.open;
                    const isOverdue = action.status !== 'done' && action.dueDate && new Date(action.dueDate) < new Date();
                    return (
                      <tr key={action.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3">
                          <Link
                            href={`/clients/${clientId}/actions`}
                            className="text-[var(--foreground)] hover:text-[var(--primary)]"
                          >
                            {action.title}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ color: statusConfig.colour, backgroundColor: statusConfig.bgColour }}
                          >
                            {statusConfig.label}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-[var(--muted)]">{action.assignedTo}</td>
                        <td className={`py-2 ${isOverdue ? 'text-red-600 font-medium' : 'text-[var(--muted)]'}`}>
                          {formatDate(action.dueDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm italic text-[var(--muted)]">No actions linked to this campaign</p>
          )}
        </CardContent>
      </Card>

      {/* Placeholder Sections */}
      <div className="mb-6 space-y-4">
        <PlaceholderSection title="Scripts" />
        <PlaceholderSection title="Email Cadences" />
        <PlaceholderSection title="Research Brief" />
        <PlaceholderSection title="Directives" />
        <PlaceholderSection title="Approvals" />
      </div>

      {/* Status History */}
      <StatusTimeline history={campaign.statusHistory} />
    </div>
  );
}
