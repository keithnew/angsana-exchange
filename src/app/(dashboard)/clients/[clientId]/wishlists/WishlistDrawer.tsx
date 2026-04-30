'use client';

// =============================================================================
// WishlistDrawer — side panel for view / edit / discussion.
//
// Per spec §7.4, clicking a row opens a side drawer (not a modal). The
// drawer has two tabs:
//   • Details   — summary view; "Edit" button swaps in the WishlistForm in
//                 place (Edit-in-Details). On save → onSaved → page refresh.
//   • Discussion — mounts the subject-agnostic WorkItemStream against
//                  subject = { entityType: 'wishlist', entityId: wishlistId }.
//
// Archive (= delete soft) is exposed for internal-admin only via the
// kebab; per spec §7.5 + DELETE route this is an audited soft-delete.
//
// `onMutated` is invoked when *something* changed inside the drawer (a
// Work Item state-changed, a comment was posted, the wishlist was edited)
// so the parent page can refresh its open-item counts. `onSaved` fires
// only on a successful Wishlist edit save and additionally closes the
// drawer.
// =============================================================================

import { useState } from 'react';
import { X, Edit, Trash2, ExternalLink } from 'lucide-react';
import { WishlistForm, type WishlistFormCampaign } from '@/components/wishlists/WishlistForm';
import { WorkItemStream } from '@/components/workItems/WorkItemStream';
import {
  WISHLIST_PRIORITY_R2_CONFIG,
  WISHLIST_SOURCE_CONFIG,
  WISHLIST_STATUS_R2_CONFIG,
  TARGETING_HINT_TYPE_CONFIG,
  type TargetingHint,
  type WishlistEntryWire,
} from '@/types/wishlist';
import type { UserRole } from '@/types';

interface Props {
  clientId: string;
  entry: WishlistEntryWire;
  initialTab: 'details' | 'discussion';
  currentUserRole: UserRole;
  availableTargetingHints: TargetingHint[];
  availableCampaigns: WishlistFormCampaign[];
  campaignNameMap: Map<string, string>;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Reserved for future per-mutation page refreshes (e.g. after a Work
   * Item state-change while the drawer is open). The current
   * implementation lets the in-drawer Work Item stream silently re-fetch
   * itself on each mutation, and lets the page-level open-item counts
   * update on drawer close (`onSaved` / unmount + router.refresh()), so
   * we don't flicker the table on every comment.
   */
  onMutated: () => void;
}

function isInternal(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

function canWrite(role: UserRole): boolean {
  return role !== 'client-viewer';
}

export default function WishlistDrawer({
  clientId,
  entry,
  initialTab,
  currentUserRole,
  availableTargetingHints,
  availableCampaigns,
  campaignNameMap,
  onClose,
  onSaved,
  onMutated: _onMutated,
}: Props) {
  const [tab, setTab] = useState<'details' | 'discussion'>(initialTab);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const internal = isInternal(currentUserRole);
  const writeAccess = canWrite(currentUserRole);
  const archiveAccess = currentUserRole === 'internal-admin';

  const statusCfg = WISHLIST_STATUS_R2_CONFIG[entry.status];
  const priorityCfg = WISHLIST_PRIORITY_R2_CONFIG[entry.priority];

  async function archive() {
    if (!confirm('Archive this wishlist entry? It will be hidden from default views.')) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/wishlists/${entry.wishlistId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setArchiveError(errBody.error ?? 'Archive failed.');
        return;
      }
      onSaved();
    } catch (err) {
      setArchiveError((err as Error).message ?? 'Network error.');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside className="relative bg-white w-full max-w-2xl h-full shadow-xl flex flex-col">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {entry.companyName ?? <span className="text-gray-400 italic">No company</span>}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span
                className="px-2 py-0.5 rounded font-medium"
                style={{ color: statusCfg.colour, backgroundColor: statusCfg.bgColour }}
              >
                {statusCfg.label}
              </span>
              <span
                className="px-2 py-0.5 rounded font-medium border"
                style={{
                  color: priorityCfg.colour,
                  backgroundColor: priorityCfg.bgColour,
                  borderColor: priorityCfg.colour,
                }}
              >
                {priorityCfg.label}
              </span>
              {entry.source && (
                <span className="text-gray-500">
                  Source: {WISHLIST_SOURCE_CONFIG[entry.source].label}
                  {entry.sourceDetail ? ` · ${entry.sourceDetail}` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {archiveAccess && !editing && (
              <button
                type="button"
                onClick={archive}
                disabled={archiving}
                className="p-2 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                title="Archive"
                aria-label="Archive wishlist entry"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              title="Close"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex border-b text-sm">
          <TabButton
            active={tab === 'details'}
            onClick={() => setTab('details')}
            label="Details"
          />
          <TabButton
            active={tab === 'discussion'}
            onClick={() => setTab('discussion')}
            label="Discussion"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {archiveError && (
            <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {archiveError}
            </div>
          )}

          {tab === 'details' && !editing && (
            <DetailsView
              entry={entry}
              campaignNameMap={campaignNameMap}
              internal={internal}
              writeAccess={writeAccess}
              onEdit={() => setEditing(true)}
            />
          )}

          {tab === 'details' && editing && (
            <WishlistForm
              mode="edit"
              clientId={clientId}
              initialEntry={entry}
              currentUserRole={currentUserRole}
              availableTargetingHints={availableTargetingHints}
              availableCampaigns={availableCampaigns}
              onSaved={() => {
                setEditing(false);
                onSaved();
              }}
              onCancel={() => setEditing(false)}
            />
          )}

          {tab === 'discussion' && (
            <WorkItemStream
              clientId={clientId}
              subject={{
                scope: 'tenant',
                scopeRef: '', // server-side derives from claims
                entityType: 'wishlist',
                entityId: entry.wishlistId,
              }}
              workItemType="wishlist-clarification"
              currentUserRole={currentUserRole}
              emptyStateLabel="No questions or notes raised yet for this wishlist entry."
            />
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function DetailsView({
  entry,
  campaignNameMap,
  internal,
  writeAccess,
  onEdit,
}: {
  entry: WishlistEntryWire;
  campaignNameMap: Map<string, string>;
  internal: boolean;
  writeAccess: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Edit button */}
      {writeAccess && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm text-gray-700 hover:bg-gray-50"
          >
            <Edit className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
      )}

      {/* Targeting hints */}
      <Section label="Targeting">
        {entry.targetingHints.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.targetingHints.map((h) => {
              const cfg = TARGETING_HINT_TYPE_CONFIG[h.type];
              return (
                <span
                  key={`${h.type}:${h.managedListRef.itemId}`}
                  className="px-2 py-0.5 rounded text-xs"
                  style={{ backgroundColor: cfg.bgColour, color: cfg.colour }}
                  title={cfg.label}
                >
                  {h.displayName}
                </span>
              );
            })}
          </div>
        ) : entry.targetingHintsRaw ? (
          <div className="text-sm text-gray-700 whitespace-pre-wrap italic border-l-2 border-amber-300 pl-3">
            <span className="block text-xs text-amber-700 mb-1 not-italic">
              Legacy notes (R1) — not yet classified into hints
            </span>
            {entry.targetingHintsRaw}
          </div>
        ) : (
          <span className="text-xs text-gray-400">No targeting hints set.</span>
        )}
      </Section>

      {/* Company ref */}
      <Section label="Company">
        <div className="text-sm text-gray-800">
          {entry.companyName ?? <span className="text-gray-400 italic">unset</span>}
        </div>
        {entry.companyRef?.type === 'salesforce-account' && entry.companyRef.sfAccountId && (
          <div className="text-xs text-gray-500 inline-flex items-center gap-1 mt-1">
            <ExternalLink className="w-3 h-3" />
            Salesforce: {entry.companyRef.sfAccountId}
          </div>
        )}
        {entry.companyRef?.type === 'candidate' && (
          <div className="text-xs text-gray-400 mt-1">
            Candidate (not yet resolved to a Salesforce Account)
          </div>
        )}
      </Section>

      {/* Campaigns — internal only */}
      {internal && (
        <Section label="Campaigns">
          {entry.campaignRefs.length === 0 ? (
            <span className="text-xs text-gray-400">Unallocated</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {entry.campaignRefs.map((id) => (
                <span
                  key={id}
                  className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200"
                >
                  {campaignNameMap.get(id) ?? id}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Audit */}
      <Section label="Audit">
        <div className="text-xs text-gray-500 space-y-0.5">
          <div>
            Added by{' '}
            <span className="text-gray-700">
              {entry.addedBy?.name || entry.addedBy?.uid || 'unknown'}
            </span>{' '}
            · {entry.addedAt ? new Date(entry.addedAt).toLocaleString() : '—'}
          </div>
          <div>
            Last updated{' '}
            {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '—'}{' '}
            by{' '}
            <span className="text-gray-700">
              {entry.updatedBy?.name || entry.updatedBy?.uid || 'unknown'}
            </span>
          </div>
          {!entry.schemaVersion && (
            <div className="text-amber-700 mt-1">
              Legacy R1 doc (read-time normalised; not yet migrated)
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
