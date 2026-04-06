'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { WishlistItem, WishlistStatus, WishlistPriority, UserRole, Campaign } from '@/types';
import { WISHLIST_STATUS_CONFIG, WISHLIST_PRIORITY_CONFIG } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagedListItem {
  id: string;
  label: string;
  active: boolean;
}

interface Props {
  clientId: string;
  wishlists: WishlistItem[];
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  sectors: ManagedListItem[];
  geographies: ManagedListItem[];
  userRole: UserRole;
  userEmail: string;
}

type StatusFilter = 'all' | 'all-except-rejected' | WishlistStatus;
type PriorityFilter = 'all' | WishlistPriority;
type CampaignFilter = 'all' | 'unallocated' | string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInternal(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

function canWrite(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user' || role === 'client-approver';
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getLabelForId(items: ManagedListItem[], id: string): string {
  return items.find((i) => i.id === id)?.label || id || '—';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WishlistListClient({
  clientId,
  wishlists: initialWishlists,
  campaigns,
  sectors,
  geographies,
  userRole,
  userEmail,
}: Props) {
  const router = useRouter();

  // State
  const [wishlists, setWishlists] = useState<WishlistItem[]>(initialWishlists);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all-except-rejected');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>('all');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null);
  const [sessionAddedCount, setSessionAddedCount] = useState(0);
  const [sessionAddedNames, setSessionAddedNames] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const filtered = wishlists.filter((w) => {
    // Status filter
    if (statusFilter === 'all-except-rejected' && w.status === 'rejected') return false;
    if (statusFilter !== 'all' && statusFilter !== 'all-except-rejected' && w.status !== statusFilter) return false;
    // Priority filter
    if (priorityFilter !== 'all' && w.priority !== priorityFilter) return false;
    // Campaign filter
    if (campaignFilter === 'unallocated' && w.campaignRef) return false;
    if (campaignFilter !== 'all' && campaignFilter !== 'unallocated' && w.campaignRef !== campaignFilter) return false;
    return true;
  });

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Create a wishlist item
  const handleCreate = async (data: {
    companyName: string;
    sector: string;
    geography: string;
    priority: WishlistPriority;
    notes: string;
    status?: WishlistStatus;
    campaignRef?: string;
  }) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/wishlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
        return;
      }

      const result = await res.json();
      // Add to local state
      const newItem: WishlistItem = {
        id: result.ids[0],
        companyName: data.companyName,
        sector: data.sector,
        geography: data.geography,
        priority: data.priority,
        notes: data.notes,
        status: isInternal(userRole) ? (data.status || 'new') : 'new',
        campaignRef: isInternal(userRole) ? (data.campaignRef || '') : '',
        addedBy: userEmail,
        addedDate: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setWishlists((prev) => [newItem, ...prev]);
      setSessionAddedCount((c) => c + 1);
      setSessionAddedNames((names) => [...names, data.companyName]);
    } catch {
      showToast('Failed to add company');
    } finally {
      setSaving(false);
    }
  };

  // Done adding — close panel and create auto-action if client-approver
  const handleDoneAdding = async () => {
    const count = sessionAddedCount;
    const names = sessionAddedNames;
    setShowCreatePanel(false);
    setSessionAddedCount(0);
    setSessionAddedNames([]);

    if (count > 0) {
      showToast(`${count} ${count === 1 ? 'company' : 'companies'} added.`);
    }

    // Auto-action: only when client-approver adds items
    if (count > 0 && userRole === 'client-approver') {
      const title =
        count === 1
          ? `Client added ${names[0]} to wishlist — review and allocate`
          : `Client added ${count} companies to wishlist — review and allocate`;

      // Calculate due date: 3 business days from now
      const dueDate = new Date();
      let added = 0;
      while (added < 3) {
        dueDate.setDate(dueDate.getDate() + 1);
        const day = dueDate.getDay();
        if (day !== 0 && day !== 6) added++;
      }

      try {
        await fetch(`/api/clients/${clientId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description: '',
            assignedTo: '',
            dueDate: dueDate.toISOString(),
            priority: 'medium',
            source: { type: 'wishlist', count },
            relatedCampaign: '',
          }),
        });
      } catch {
        // Silent fail for auto-action — don't block the user
      }
    }

    router.refresh();
  };

  // Edit a wishlist item
  const handleEdit = async (
    wishlistId: string,
    data: Record<string, unknown>
  ) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/wishlists/${wishlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
        return;
      }

      // Update local state
      setWishlists((prev) =>
        prev.map((w) =>
          w.id === wishlistId
            ? { ...w, ...(data as Partial<WishlistItem>), updatedAt: new Date().toISOString() }
            : w
        )
      );
      setEditingItem(null);
      showToast('Updated.');
      router.refresh();
    } catch {
      showToast('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Wishlists</h1>
          <p className="text-sm text-gray-500 mt-1">
            Target companies to pursue • {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
          </p>
        </div>
        {canWrite(userRole) && (
          <button
            onClick={() => {
              setShowCreatePanel(true);
              setSessionAddedCount(0);
              setSessionAddedNames([]);
            }}
            className="px-4 py-2 text-sm font-medium text-white rounded-md"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            + Add Company
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white"
        >
          <option value="all-except-rejected">Hide Rejected</option>
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="under-review">Under Review</option>
          <option value="added-to-target-list">Added to Target List</option>
          <option value="rejected">Rejected</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white"
        >
          <option value="all">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value as CampaignFilter)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white"
        >
          <option value="all">All Campaigns</option>
          <option value="unallocated">Unallocated</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.campaignName}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Sector</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Geography</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Campaign</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Added</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  No wishlist items match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((w) => {
                const statusCfg = WISHLIST_STATUS_CONFIG[w.status];
                const prioCfg = WISHLIST_PRIORITY_CONFIG[w.priority];
                const campaignName = campaigns.find((c) => c.id === w.campaignRef)?.campaignName;

                return (
                  <tr
                    key={w.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => canWrite(userRole) ? setEditingItem(w) : undefined}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{w.companyName}</td>
                    <td className="px-4 py-3 text-gray-600">{getLabelForId(sectors, w.sector)}</td>
                    <td className="px-4 py-3 text-gray-600">{getLabelForId(geographies, w.geography)}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ color: prioCfg.colour, backgroundColor: prioCfg.bgColour }}
                      >
                        {prioCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ color: statusCfg.colour, backgroundColor: statusCfg.bgColour }}
                      >
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{campaignName || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      <div>{formatDate(w.addedDate)}</div>
                      <div className="text-gray-400">{w.addedBy}</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Slide-out Panel */}
      {showCreatePanel && (
        <SlideOutPanel
          title="Add Company to Wishlist"
          onClose={handleDoneAdding}
        >
          <CreateForm
            sectors={sectors}
            geographies={geographies}
            campaigns={campaigns}
            userRole={userRole}
            saving={saving}
            sessionCount={sessionAddedCount}
            onCreate={handleCreate}
            onDone={handleDoneAdding}
          />
        </SlideOutPanel>
      )}

      {/* Edit Slide-out Panel */}
      {editingItem && (
        <SlideOutPanel
          title="Edit Wishlist Item"
          onClose={() => setEditingItem(null)}
        >
          <EditForm
            item={editingItem}
            sectors={sectors}
            geographies={geographies}
            campaigns={campaigns}
            userRole={userRole}
            saving={saving}
            onSave={(data) => handleEdit(editingItem.id, data)}
            onCancel={() => setEditingItem(null)}
          />
        </SlideOutPanel>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide-out Panel
// ---------------------------------------------------------------------------

function SlideOutPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Create Form (supports quick successive additions)
// ---------------------------------------------------------------------------

function CreateForm({
  sectors,
  geographies,
  campaigns,
  userRole,
  saving,
  sessionCount,
  onCreate,
  onDone,
}: {
  sectors: ManagedListItem[];
  geographies: ManagedListItem[];
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  userRole: UserRole;
  saving: boolean;
  sessionCount: number;
  onCreate: (data: {
    companyName: string;
    sector: string;
    geography: string;
    priority: WishlistPriority;
    notes: string;
    status?: WishlistStatus;
    campaignRef?: string;
  }) => Promise<void>;
  onDone: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState('');
  const [geography, setGeography] = useState('');
  const [priority, setPriority] = useState<WishlistPriority>('medium');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<WishlistStatus>('new');
  const [campaignRef, setCampaignRef] = useState('');

  const internal = isInternal(userRole);

  const buildData = () => {
    const data: {
      companyName: string;
      sector: string;
      geography: string;
      priority: WishlistPriority;
      notes: string;
      status?: WishlistStatus;
      campaignRef?: string;
    } = { companyName: companyName.trim(), sector, geography, priority, notes };
    if (internal) {
      data.status = status;
      data.campaignRef = campaignRef;
    }
    return data;
  };

  const handleSubmit = async () => {
    if (!companyName.trim()) return;
    await onCreate(buildData());
    // Clear form for next entry
    setCompanyName('');
    setNotes('');
    // Keep sector, geography, priority as they likely stay the same for batches
  };

  const handleSaveAndDone = async () => {
    // If there's unsaved data in the form, save it first then close
    if (companyName.trim()) {
      await onCreate(buildData());
    }
    onDone();
  };

  return (
    <div className="space-y-4">
      {sessionCount > 0 && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">
          {sessionCount} {sessionCount === 1 ? 'company' : 'companies'} added this session
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Company Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          placeholder="e.g. Acme Corp"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">Select...</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Geography</label>
          <select
            value={geography}
            onChange={(e) => setGeography(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">Select...</option>
            {geographies.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as WishlistPriority)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes <span className="text-gray-400 font-normal">(max 280 chars)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={280}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          placeholder="Why this company, specific contacts, context..."
        />
        <p className="text-xs text-gray-400 mt-1">{notes.length}/280</p>
      </div>

      {/* Internal-only fields */}
      {internal && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as WishlistStatus)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="new">New</option>
              <option value="under-review">Under Review</option>
              <option value="added-to-target-list">Added to Target List</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
            <select
              value={campaignRef}
              onChange={(e) => setCampaignRef(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">Unallocated</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.campaignName}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !companyName.trim()}
          className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {saving ? 'Adding...' : 'Add & Continue'}
        </button>
        <button
          type="button"
          onClick={handleSaveAndDone}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Done Adding'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Form
// ---------------------------------------------------------------------------

function EditForm({
  item,
  sectors,
  geographies,
  campaigns,
  userRole,
  saving,
  onSave,
  onCancel,
}: {
  item: WishlistItem;
  sectors: ManagedListItem[];
  geographies: ManagedListItem[];
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  userRole: UserRole;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState(item.companyName);
  const [sector, setSector] = useState(item.sector);
  const [geography, setGeography] = useState(item.geography);
  const [priority, setPriority] = useState<WishlistPriority>(item.priority);
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<WishlistStatus>(item.status);
  const [campaignRef, setCampaignRef] = useState(item.campaignRef);

  const internal = isInternal(userRole);

  const handleSubmit = async () => {
    if (!companyName.trim()) return;
    const data: Record<string, unknown> = {
      companyName: companyName.trim(),
      sector,
      geography,
      priority,
      notes,
    };
    if (internal) {
      data.status = status;
      data.campaignRef = campaignRef;
    }
    await onSave(data);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
        Added by {item.addedBy} on {formatDate(item.addedDate)}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Company Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          readOnly={userRole === 'client-viewer'}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            disabled={userRole === 'client-viewer'}
          >
            <option value="">Select...</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Geography</label>
          <select
            value={geography}
            onChange={(e) => setGeography(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            disabled={userRole === 'client-viewer'}
          >
            <option value="">Select...</option>
            {geographies.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as WishlistPriority)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
          disabled={userRole === 'client-viewer'}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes <span className="text-gray-400 font-normal">(max 280 chars)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={280}
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)]"
          readOnly={userRole === 'client-viewer'}
        />
        <p className="text-xs text-gray-400 mt-1">{notes.length}/280</p>
      </div>

      {/* Internal-only fields */}
      {internal && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as WishlistStatus)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="new">New</option>
              <option value="under-review">Under Review</option>
              <option value="added-to-target-list">Added to Target List</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
            <select
              value={campaignRef}
              onChange={(e) => setCampaignRef(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">Unallocated</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.campaignName}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Read-only status display for client users */}
      {!internal && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
            style={{
              color: WISHLIST_STATUS_CONFIG[item.status].colour,
              backgroundColor: WISHLIST_STATUS_CONFIG[item.status].bgColour,
            }}
          >
            {WISHLIST_STATUS_CONFIG[item.status].label}
          </span>
        </div>
      )}

      {canWrite(userRole) && (
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving || !companyName.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}

      {userRole === 'client-viewer' && (
        <div className="pt-2">
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 rounded-md border border-gray-300 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
