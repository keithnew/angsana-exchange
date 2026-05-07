'use client';

import { useState, useEffect } from 'react';
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
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CAMPAIGN_STATUS_CONFIG, CHECKIN_TYPE_CONFIG, SOWHAT_STATUS_CONFIG, SOWHAT_ORIENTATION_CONFIG } from '@/types';
import type { Campaign, ManagedListItem, StatusHistoryEntry, CheckInType, SoWhat, Proposition } from '@/types';
import { ACTION_LITE_STATE_CONFIG, type ActionLiteState } from '@/lib/workItems/actionLite';
import CampaignDocumentsCard from '@/components/documents/CampaignDocumentsCard';

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
// Proposition Expandable Card — click to expand/collapse ICP details
// =============================================================================

function PropositionExpandableCard({
  prop,
  clientId,
  managedLists,
}: {
  prop: Proposition;
  clientId: string;
  managedLists: Record<string, ManagedListItem[]>;
}) {
  const [expanded, setExpanded] = useState(false);

  const icpStatusColor = prop.icpStatus === 'active' ? '#22c55e' : prop.icpStatus === 'draft' ? '#f59e0b' : '#9ca3af';
  const icpStatusLabel = prop.icpStatus === 'active' ? 'Active ICP' : prop.icpStatus === 'draft' ? 'Draft ICP' : 'No ICP';

  // Build ICP summary chips for collapsed view
  const icpSummaryParts: string[] = [];
  const icp = prop.icp;
  if (icp) {
    const indRefs = icp.industries?.managedListRefs || [];
    if (indRefs.length) {
      const labels = indRefs.slice(0, 2).map((id: string) => lookupLabel(managedLists.sectors || [], id));
      icpSummaryParts.push(labels.join(', ') + (indRefs.length > 2 ? ` +${indRefs.length - 2}` : ''));
    }
    const titleRefs = icp.titles?.managedListRefs || [];
    if (titleRefs.length) {
      const labels = titleRefs.slice(0, 2).map((id: string) => lookupLabel(managedLists.titleBands || [], id));
      icpSummaryParts.push(labels.join(', ') + (titleRefs.length > 2 ? ` +${titleRefs.length - 2}` : ''));
    }
    const geoRefs = icp.geographies?.managedListRefs || [];
    if (geoRefs.length) {
      const labels = geoRefs.slice(0, 2).map((id: string) => lookupLabel(managedLists.geographies || [], id));
      icpSummaryParts.push(labels.join(', ') + (geoRefs.length > 2 ? ` +${geoRefs.length - 2}` : ''));
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Clickable header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: icpStatusColor }}
              title={icpStatusLabel}
            />
            <span className="text-sm font-semibold text-gray-900 truncate">{prop.name}</span>
            {prop.category && (
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
                {prop.category}
              </span>
            )}
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
              style={{
                backgroundColor: prop.status === 'active' ? '#ecfdf5' : '#f3f4f6',
                color: prop.status === 'active' ? '#059669' : '#6b7280',
              }}
            >
              {prop.status === 'active' ? 'Active' : 'Draft'}
            </span>
          </div>
          {prop.description && (
            <p className="mt-0.5 text-xs text-gray-500 truncate">{prop.description}</p>
          )}
          {!expanded && icpSummaryParts.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">{icpSummaryParts.join(' · ')}</p>
          )}
          {!expanded && !icp && (
            <p className="mt-1 text-xs text-gray-400 italic">No ICP defined</p>
          )}
        </div>
        <div className="ml-3 shrink-0 text-gray-400">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expandable ICP details */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3 bg-gray-50/50">
          {icp ? (
            <>
              {/* Industries */}
              {(icp.industries?.managedListRefs?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Industries</p>
                  <div className="flex flex-wrap gap-1">
                    {icp.industries.managedListRefs.map((id: string) => (
                      <span key={id} className="inline-flex items-center rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-700">
                        {lookupLabel(managedLists.sectors || [], id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Target Titles */}
              {(icp.titles?.managedListRefs?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Target Titles</p>
                  <div className="flex flex-wrap gap-1">
                    {icp.titles.managedListRefs.map((id: string) => (
                      <span key={id} className="inline-flex items-center rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-700">
                        {lookupLabel(managedLists.titleBands || [], id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Geographies */}
              {(icp.geographies?.managedListRefs?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Geographies</p>
                  <div className="flex flex-wrap gap-1">
                    {icp.geographies.managedListRefs.map((id: string) => (
                      <span key={id} className="inline-flex items-center rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-700">
                        {lookupLabel(managedLists.geographies || [], id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Company Sizing */}
              {(icp.companySizing?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Company Size</p>
                  <div className="flex flex-wrap gap-1">
                    {icp.companySizing.map((entry, i) => (
                      <span key={i} className="inline-flex items-center rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-700">
                        {entry.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Buying Process */}
              {(icp.buyingProcess?.type || icp.buyingProcess?.notes) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Buying Process</p>
                  <p className="text-xs text-gray-600">
                    {icp.buyingProcess.type && <span className="font-medium">{icp.buyingProcess.type}</span>}
                    {icp.buyingProcess.type && icp.buyingProcess.notes && ' — '}
                    {icp.buyingProcess.notes}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400 italic">No ICP data defined for this proposition</p>
          )}
          {/* Link to Prospecting Profile */}
          <div className="pt-2 border-t border-gray-100">
            <Link
              href={`/clients/${clientId}/prospecting-profile`}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View in Prospecting Profile
            </Link>
          </div>
        </div>
      )}
    </div>
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
  soWhatsData = [],
}: {
  campaign: Campaign;
  clientId: string;
  clientName: string;
  managedLists: Record<string, ManagedListItem[]>;
  isInternal: boolean;
  userEmail: string;
  relatedCheckins?: { id: string; date: string; type: string; keyPoints: string[] }[];
  relatedActions?: { id: string; title: string; status: string; assignedTo: string; dueDate: string }[];
  soWhatsData?: SoWhat[];
}) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [toastMessage, setToastMessage] = useState('');
  const [propositions, setPropositions] = useState<Proposition[]>([]);

  // Fetch propositions for this client
  useEffect(() => {
    async function fetchPropositions() {
      try {
        const res = await fetch(`/api/clients/${clientId}/propositions`);
        if (res.ok) {
          const data = await res.json();
          setPropositions(data.propositions || []);
        }
      } catch (err) {
        console.error('Failed to fetch propositions:', err);
      }
    }
    fetchPropositions();
  }, [clientId]);

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
    <>
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toastMessage}
        </div>
      )}

      {/* Sub-header — sticky, pins flush with header since main has no padding */}
      <div className="sticky top-0 z-30 bg-white px-6 pb-3 pt-4 border-b border-gray-200">
        <Link
          href={`/clients/${clientId}/campaigns`}
          className="mb-1 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {clientName} campaigns
        </Link>

        <div className="flex items-start justify-between max-w-4xl">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">
              {campaign.campaignName}
            </h1>
            <div className="mt-1 flex items-center gap-3">
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

      {/* Content area */}
      <div className="p-6">
    <div className="max-w-4xl">

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

      {/* Linked Propositions Section — expandable ICP details */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Linked Propositions</CardTitle>
        </CardHeader>
        <CardContent>
          {(campaign.propositionRefs || []).length > 0 ? (
            <div className="space-y-3">
              {campaign.propositionRefs!.map((propId) => {
                const prop = propositions.find((p) => p.id === propId);
                if (!prop) return (
                  <div key={propId} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-sm text-[var(--muted)] italic">Proposition not found ({propId})</p>
                  </div>
                );
                return <PropositionExpandableCard key={propId} prop={prop} clientId={clientId} managedLists={managedLists} />;
              })}
            </div>
          ) : (
            <p className="text-sm italic text-[var(--muted)]">
              No propositions linked —{' '}
              {canEdit ? (
                <Link href={`/clients/${clientId}/campaigns/${campaign.id}/edit`} className="text-[var(--primary)] hover:underline">
                  link one via Edit
                </Link>
              ) : (
                <span>link one via the campaign edit form</span>
              )}
            </p>
          )}
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
              <div className="space-y-3">
                {campaign.selectedSoWhats.map((swId) => {
                  const sw = soWhatsData.find((s) => s.id === swId);
                  if (!sw) return null;
                  const isRetired = sw.status === 'retired';
                  const statusCfg = SOWHAT_STATUS_CONFIG[sw.status];
                  return (
                    <Link
                      key={swId}
                      href={`/clients/${clientId}/sowhats/${swId}`}
                      className={`block rounded-lg border p-4 transition-colors hover:border-gray-300 ${
                        isRetired ? 'border-gray-200 bg-gray-50 opacity-75' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900 truncate">{sw.headline}</p>
                            {isRetired && (
                              <span
                                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                                style={{ color: statusCfg.colour, backgroundColor: statusCfg.bgColour }}
                              >
                                {statusCfg.label}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-gray-600 line-clamp-2">{sw.emailVersion}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {sw.audienceTags.map((tag) => (
                              <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                {lookupLabel(managedLists.titleBands || [], tag)}
                              </span>
                            ))}
                            {sw.orientationTags.map((tag) => {
                              const cfg = SOWHAT_ORIENTATION_CONFIG[tag];
                              return (
                                <span key={tag} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: cfg.colour, backgroundColor: cfg.bgColour }}>
                                  {cfg.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm italic text-[var(--muted)]">
                No So Whats selected —{' '}
                <Link href={`/clients/${clientId}/sowhats`} className="text-[var(--primary)] hover:underline">
                  add from client library
                </Link>
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
                    // S3-code-P4: action-lite `state` enum (open|in-progress|done|blocked)
                    // — same shape as legacy `status`. Renderer reads from
                    // `ACTION_LITE_STATE_CONFIG`.
                    const statusConfig = ACTION_LITE_STATE_CONFIG[action.status as ActionLiteState] || ACTION_LITE_STATE_CONFIG.open;
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

      {/* Documents */}
      <div className="mb-6">
        <CampaignDocumentsCard clientId={clientId} campaignId={campaign.id} />
      </div>

      {/* Placeholder Sections */}
      <div className="mb-6 space-y-4">
        <PlaceholderSection title="Email Cadences" />
        <PlaceholderSection title="Research Brief" />
        <PlaceholderSection title="Directives" />
        <PlaceholderSection title="Approvals" />
      </div>

      {/* Status History */}
      <StatusTimeline history={campaign.statusHistory} />
    </div>
    </div>
    </>
  );
}
