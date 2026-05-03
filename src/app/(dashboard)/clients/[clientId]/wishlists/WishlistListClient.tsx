'use client';

// =============================================================================
// WishlistListClient — R2 PVS Slice 1.
//
// Full rewrite from the R1 surface. The R1 client coupled the table model
// to the `WishlistItem` shape and used a centred modal for create/edit;
// the R2 surface is a different mental model (TargetingHint chips replace
// sector/geography columns; the row click opens a side drawer with a
// Discussion tab) and a patched-in shape would have left dead R1 code
// paths everywhere. The 7a handover called for the rewrite — this file
// is that rewrite.
//
// Concerns kept local to this file:
//   • Table layout, sort, filter chip rail.
//   • Open-item subtitle wiring (already resolved server-side).
//   • Drawer open/close + selected-row state.
//   • Role-gated UI (Add / Edit / Status column / Campaigns column).
//
// Concerns delegated:
//   • Form    — components/wishlists/WishlistForm
//   • Drawer  — ./WishlistDrawer (sibling)
//   • Stream  — components/workItems/WorkItemStream (mounted by drawer)
// =============================================================================

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Inbox, MessageSquare } from 'lucide-react';
import { WishlistForm } from '@/components/wishlists/WishlistForm';
import WishlistDrawer from './WishlistDrawer';
import {
  WISHLIST_PRIORITY_R2_CONFIG,
  WISHLIST_STATUS_R2_CONFIG,
  TARGETING_HINT_TYPE_CONFIG,
  type TargetingHint,
  type WishlistEntryWire,
  type WishlistPriority,
  type WishlistStatus,
} from '@/types/wishlist';
import type { Campaign, UserRole } from '@/types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  wishlists: WishlistEntryWire[];
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  /** Combined therapy-areas + sectors + geographies + service-types. */
  targetingHints: TargetingHint[];
  userRole: UserRole;
  userEmail: string;
  /** Page-level open-items badge subtitle ("3 open items"). */
  totalOpenItems: number;
}

type StatusFilter = 'all' | 'all-except-rejected' | WishlistStatus;
type PriorityFilter = 'all' | WishlistPriority;
type CampaignFilter = 'all' | 'unallocated' | string;

function isInternal(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

function canWrite(role: UserRole): boolean {
  return role !== 'client-viewer';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WishlistListClient({
  clientId,
  wishlists,
  campaigns,
  targetingHints,
  userRole,
  totalOpenItems,
}: Props) {
  const router = useRouter();
  const internal = isInternal(userRole);
  const writeAccess = canWrite(userRole);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all-except-rejected');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>('all');
  const [search, setSearch] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  /** Drawer state: open with this wishlistId, in this initial tab. */
  const [drawerEntry, setDrawerEntry] = useState<WishlistEntryWire | null>(null);
  const [drawerTab, setDrawerTab] = useState<'details' | 'discussion'>('details');

  const campaignNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of campaigns) m.set(c.id, c.campaignName);
    return m;
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wishlists.filter((w) => {
      if (statusFilter === 'all-except-rejected') {
        if (w.status === 'rejected') return false;
      } else if (statusFilter !== 'all') {
        if (w.status !== statusFilter) return false;
      }
      if (priorityFilter !== 'all' && w.priority !== priorityFilter) return false;
      if (campaignFilter === 'unallocated') {
        if ((w.campaignRefs ?? []).length > 0) return false;
      } else if (campaignFilter !== 'all') {
        if (!(w.campaignRefs ?? []).includes(campaignFilter)) return false;
      }
      if (q) {
        const hay = [
          w.companyName ?? '',
          w.targetingHints.map((h) => h.displayName).join(' '),
          w.targetingHintsRaw ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [wishlists, statusFilter, priorityFilter, campaignFilter, search]);

  function refreshPage() {
    // Re-runs the server component → page-level open-item counts repopulate.
    router.refresh();
  }

  function openDrawer(entry: WishlistEntryWire, tab: 'details' | 'discussion' = 'details') {
    setDrawerEntry(entry);
    setDrawerTab(tab);
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Wishlists</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {wishlists.length} {wishlists.length === 1 ? 'entry' : 'entries'}
            {totalOpenItems > 0 && (
              <>
                <span className="text-gray-300 mx-1.5">·</span>
                <span className="text-amber-700 font-medium">
                  {totalOpenItems} open item{totalOpenItems === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
        </div>
        {writeAccess && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add to wishlist
          </button>
        )}
      </div>

      {/* Filter chip rail */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or hint…"
          className="border rounded px-3 py-1.5 text-sm w-56"
        />

        <ChipGroup
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: 'all-except-rejected', label: 'Active' },
            { value: 'all', label: 'All' },
            { value: 'new', label: 'New' },
            { value: 'under-review', label: 'Under review' },
            { value: 'added-to-target-list', label: 'On target list' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />

        <ChipGroup
          label="Priority"
          value={priorityFilter}
          onChange={(v) => setPriorityFilter(v as PriorityFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />

        {internal && campaigns.length > 0 && (
          <label className="inline-flex items-center gap-1">
            <span className="text-gray-500">Campaign:</span>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value as CampaignFilter)}
              className="border rounded px-2 py-1 text-xs"
            >
              <option value="all">All</option>
              <option value="unallocated">Unallocated</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.campaignName}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="ml-auto text-gray-500">
          {filtered.length} of {wishlists.length} shown
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border rounded bg-gray-50/50">
          <Inbox className="w-8 h-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">
            {wishlists.length === 0
              ? 'No wishlists yet.'
              : 'No entries match the current filters.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Targeting</th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                {/*
                  Status column is visible to ALL roles per spec §6.6 ("the
                  list shows status as a coloured pill"). It's read-only for
                  client roles — they can see lifecycle progress but not
                  transition. Campaigns remains internal-only because
                  campaign membership is internal taxonomy.
                */}
                <th className="text-left px-3 py-2 font-medium">Status</th>
                {internal && (
                  <th className="text-left px-3 py-2 font-medium">Campaigns</th>
                )}
                <th className="text-left px-3 py-2 font-medium">Open items</th>
                <th className="text-left px-3 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((w) => (
                <WishlistRow
                  key={w.wishlistId}
                  entry={w}
                  internal={internal}
                  campaignNameMap={campaignNameMap}
                  onOpenDetails={() => openDrawer(w, 'details')}
                  onOpenDiscussion={() => openDrawer(w, 'discussion')}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal — kept simple; the drawer is for view/edit/discuss. */}
      {showCreateForm && writeAccess && (
        <div
          className="fixed inset-0 bg-black/30 z-40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateForm(false);
          }}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add to wishlist</h2>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            <WishlistForm
              mode="create"
              clientId={clientId}
              currentUserRole={userRole}
              availableTargetingHints={targetingHints}
              availableCampaigns={campaigns.map((c) => ({ id: c.id, name: c.campaignName }))}
              onSaved={() => {
                setShowCreateForm(false);
                refreshPage();
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}

      {/* Drawer — view / edit / discussion tabs. */}
      {drawerEntry && (
        <WishlistDrawer
          clientId={clientId}
          entry={drawerEntry}
          initialTab={drawerTab}
          currentUserRole={userRole}
          availableTargetingHints={targetingHints}
          availableCampaigns={campaigns.map((c) => ({ id: c.id, name: c.campaignName }))}
          campaignNameMap={campaignNameMap}
          onClose={() => setDrawerEntry(null)}
          onSaved={() => {
            setDrawerEntry(null);
            refreshPage();
          }}
          onMutated={() => refreshPage()}
        />
      )}
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function WishlistRow({
  entry,
  internal,
  campaignNameMap,
  onOpenDetails,
  onOpenDiscussion,
}: {
  entry: WishlistEntryWire;
  internal: boolean;
  campaignNameMap: Map<string, string>;
  onOpenDetails: () => void;
  onOpenDiscussion: () => void;
}) {
  const statusCfg = WISHLIST_STATUS_R2_CONFIG[entry.status];
  const priorityCfg = WISHLIST_PRIORITY_R2_CONFIG[entry.priority];
  const openCount = entry.openItemCount ?? 0;
  const openHi = entry.openItemHighestPriority ?? null;

  // Discussion-presence indicator (v0.2 spec §2.4 / acceptance #4).
  // Shown when there is *any* substantive discussion attached: an open
  // Work Item, OR a Work Item updated within the recency window. The
  // existing Open Items pill in its own column is a stricter signal —
  // open-only — so the two can both light up on the same row without
  // being redundant. The icon-only design is the glanceable form;
  // hover reveals the count and last-update timestamp.
  const hasOpenDiscussion = entry.hasOpenDiscussion ?? false;
  const recentCount = entry.recentlyUpdatedDiscussionCount ?? 0;
  const showDiscussionIndicator = hasOpenDiscussion || recentCount > 0;

  return (
    <tr
      className="hover:bg-blue-50/30 cursor-pointer"
      onClick={onOpenDetails}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="font-medium text-gray-900">
            {entry.companyName ?? <span className="text-gray-400 italic">No company</span>}
          </div>
          {showDiscussionIndicator && (
            <DiscussionPresenceIndicator
              hasOpen={hasOpenDiscussion}
              recentCount={recentCount}
              mostRecentAt={entry.mostRecentDiscussionUpdateAt ?? null}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDiscussion();
              }}
            />
          )}
        </div>
        {entry.companyRef?.type === 'candidate' && (
          <div className="text-xs text-gray-400">candidate · unresolved</div>
        )}
      </td>
      <td className="px-3 py-2">
        {entry.targetingHints.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.targetingHints.slice(0, 4).map((h) => {
              const cfg = TARGETING_HINT_TYPE_CONFIG[h.type];
              return (
                <span
                  key={`${h.type}:${h.managedListRef.itemId}`}
                  className="px-2 py-0.5 rounded text-xs"
                  style={{
                    backgroundColor: cfg.bgColour,
                    color: cfg.colour,
                  }}
                  title={cfg.label}
                >
                  {h.displayName}
                </span>
              );
            })}
            {entry.targetingHints.length > 4 && (
              <span className="text-xs text-gray-400">
                +{entry.targetingHints.length - 4}
              </span>
            )}
          </div>
        ) : entry.targetingHintsRaw ? (
          <span className="text-xs text-gray-500 italic" title="Legacy notes (R1)">
            {entry.targetingHintsRaw.length > 60
              ? entry.targetingHintsRaw.slice(0, 60) + '…'
              : entry.targetingHintsRaw}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className="px-2 py-0.5 rounded text-xs font-medium border"
          style={{
            color: priorityCfg.colour,
            backgroundColor: priorityCfg.bgColour,
            borderColor: priorityCfg.colour,
          }}
        >
          {priorityCfg.label}
        </span>
      </td>
      <td className="px-3 py-2">
        <span
          className="px-2 py-0.5 rounded text-xs font-medium"
          style={{
            color: statusCfg.colour,
            backgroundColor: statusCfg.bgColour,
          }}
        >
          {statusCfg.label}
        </span>
      </td>
      {internal && (
        <td className="px-3 py-2 text-xs text-gray-600">
          {entry.campaignRefs.length === 0 ? (
            <span className="text-gray-300">—</span>
          ) : (
            entry.campaignRefs
              .map((id) => campaignNameMap.get(id) ?? id)
              .join(', ')
          )}
        </td>
      )}
      <td className="px-3 py-2">
        {openCount === 0 ? (
          <span className="text-xs text-gray-300">—</span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDiscussion();
            }}
            className="px-2 py-0.5 rounded text-xs font-medium border"
            style={openItemPillStyle(openHi)}
            title="View discussion"
          >
            {openCount} open
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {/*
          Pin a stable locale so SSR (server's default Intl) and CSR
          (browser locale) produce the same string — otherwise Next.js
          flags a hydration mismatch and React falls back to the SSR
          string, which under some clock skew rendered as 01/01/1970.
          en-GB == DD/MM/YYYY, matching how this product is typically
          rendered in the EU/UK market.
        */}
        {entry.addedAt
          ? new Date(entry.addedAt).toLocaleDateString('en-GB')
          : '—'}
      </td>
    </tr>
  );
}

// ─── Discussion-presence indicator ──────────────────────────────────────────

/**
 * The visible part of the v0.2 §2.4 acceptance criterion. Glanceable —
 * an icon with a small count badge — that opens the Discussion tab on
 * click. Hover reveals the human-readable summary including the last
 * update timestamp.
 *
 * Colouring rule:
 *   • Has at least one open Work Item   → amber (active conversation)
 *   • Closed, but recently updated only → grey-blue (recently noted,
 *     nothing pending)
 *
 * The icon is `MessageSquare` rather than a generic dot because the
 * surface uses "Discussion" as the verbatim tab label and we want the
 * glance and the destination to share a visual identity.
 */
function DiscussionPresenceIndicator({
  hasOpen,
  recentCount,
  mostRecentAt,
  onClick,
}: {
  hasOpen: boolean;
  recentCount: number;
  mostRecentAt: string | null;
  onClick: (e: React.MouseEvent) => void;
}) {
  const colour = hasOpen ? '#D97706' : '#6B7280';
  const bgColour = hasOpen ? '#FFFBEB' : '#F3F4F6';
  const borderColour = hasOpen ? '#FED7AA' : '#E5E7EB';

  const tooltip = buildDiscussionTooltip(hasOpen, recentCount, mostRecentAt);

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs"
      style={{ color: colour, backgroundColor: bgColour, borderColor: borderColour }}
    >
      <MessageSquare className="w-3 h-3" />
      {recentCount > 0 && <span className="leading-none">{recentCount}</span>}
    </button>
  );
}

/**
 * Build the hover/aria string for the indicator. Phrased so a screen
 * reader and a hover both communicate the same thing in one line.
 */
function buildDiscussionTooltip(
  hasOpen: boolean,
  recentCount: number,
  mostRecentAt: string | null
): string {
  const parts: string[] = [];
  if (hasOpen) parts.push('Open discussion');
  if (recentCount > 0) {
    parts.push(
      `${recentCount} recent update${recentCount === 1 ? '' : 's'}`
    );
  }
  if (parts.length === 0) parts.push('Discussion');
  if (mostRecentAt) {
    parts.push(`last update ${formatRelativeTime(mostRecentAt)}`);
  }
  return parts.join(' · ');
}

/**
 * Compact relative-time formatter, intentionally local to this surface
 * so we don't pull in a date-fns dependency for one tooltip. Mirrors
 * the precision we already commit to elsewhere in the table (en-GB
 * dates, no minute-precision in row text).
 */
function formatRelativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleDateString('en-GB');
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB');
}

function openItemPillStyle(p: 'high' | 'medium' | 'low' | null): React.CSSProperties {
  if (p === 'high')
    return { color: '#DC2626', backgroundColor: '#FEF2F2', borderColor: '#FECACA' };
  if (p === 'medium')
    return { color: '#D97706', backgroundColor: '#FFFBEB', borderColor: '#FED7AA' };
  return { color: '#2563EB', backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' };
}

// ─── Chip group helper ──────────────────────────────────────────────────────

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="text-gray-500">{label}:</span>
      <div className="inline-flex rounded border overflow-hidden">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1 text-xs ${i > 0 ? 'border-l' : ''} ${
              value === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
