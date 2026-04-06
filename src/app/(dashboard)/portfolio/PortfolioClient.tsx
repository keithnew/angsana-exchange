'use client';

import { useState } from 'react';
import Link from 'next/link';

/** Inline link style for table cells — subtle hover, no decoration by default */
const cellLinkClass = 'hover:underline transition-colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioClient {
  id: string;
  name: string;
  tier: string;
  totalCampaigns: number;
  activeCampaigns: number;
  openActions: number;
  overdueActions: number;
  lastCheckIn: string;
  newWishlistItems: number;
}

type CardFilter =
  | null
  | 'all'
  | 'active-campaigns'
  | 'open-actions'
  | 'overdue-actions'
  | 'pending-wishlist';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(isoDate: string): number {
  if (!isoDate) return Infinity;
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatShortDate(iso: string): string {
  if (!iso) return 'None';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PortfolioClientComponent({
  clients: allClients,
}: {
  clients: PortfolioClient[];
}) {
  const [activeFilter, setActiveFilter] = useState<CardFilter>(null);

  // Summary totals
  const totalActive = allClients.reduce((sum, c) => sum + c.activeCampaigns, 0);
  const totalOpenActions = allClients.reduce((sum, c) => sum + c.openActions, 0);
  const totalOverdueActions = allClients.reduce((sum, c) => sum + c.overdueActions, 0);
  const totalPendingWishlist = allClients.reduce((sum, c) => sum + c.newWishlistItems, 0);

  // Filter + sort based on active card filter
  let filteredClients = [...allClients];
  let filterLabel = '';

  switch (activeFilter) {
    case 'active-campaigns':
      filteredClients = filteredClients
        .filter((c) => c.activeCampaigns > 0)
        .sort((a, b) => b.activeCampaigns - a.activeCampaigns);
      filterLabel = 'Showing clients with active campaigns';
      break;
    case 'open-actions':
      filteredClients = filteredClients
        .filter((c) => c.openActions > 0)
        .sort((a, b) => b.openActions - a.openActions);
      filterLabel = 'Showing clients with open actions';
      break;
    case 'overdue-actions':
      filteredClients = filteredClients
        .filter((c) => c.overdueActions > 0)
        .sort((a, b) => b.overdueActions - a.overdueActions);
      filterLabel = 'Showing clients with overdue actions';
      break;
    case 'pending-wishlist':
      filteredClients = filteredClients
        .filter((c) => c.newWishlistItems > 0)
        .sort((a, b) => b.newWishlistItems - a.newWishlistItems);
      filterLabel = 'Showing clients with pending wishlist items';
      break;
    default:
      // No filter — show all
      break;
  }

  const handleCardClick = (filter: CardFilter) => {
    // Toggle: clicking the active card clears the filter
    setActiveFilter((current) => (current === filter ? null : filter));
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">Portfolio</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Cross-client overview — {allClients.length} clients
        </p>
      </div>

      {/* Summary cards — clickable filters */}
      <div className="mb-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* Total Clients */}
        <button
          onClick={() => handleCardClick('all')}
          className={`rounded-lg border bg-white p-6 text-left transition-all ${
            activeFilter === 'all'
              ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/20'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-sm text-[var(--muted)]">Total Clients</p>
          <p className="mt-1 text-3xl font-bold text-[var(--primary)]">
            {allClients.length}
          </p>
        </button>

        {/* Active Campaigns */}
        <button
          onClick={() => handleCardClick('active-campaigns')}
          className={`rounded-lg border bg-white p-6 text-left transition-all ${
            activeFilter === 'active-campaigns'
              ? 'border-[var(--accent-green)] ring-2 ring-green-200'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-sm text-[var(--muted)]">Active Campaigns</p>
          <p className="mt-1 text-3xl font-bold text-[var(--accent-green)]">
            {totalActive}
          </p>
        </button>

        {/* Open Actions */}
        <button
          onClick={() => handleCardClick('open-actions')}
          className={`rounded-lg border bg-white p-6 text-left transition-all ${
            activeFilter === 'open-actions'
              ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/20'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-sm text-[var(--muted)]">Open Actions</p>
          <p className="mt-1 text-3xl font-bold text-[var(--primary)]">
            {totalOpenActions}
          </p>
        </button>

        {/* Overdue Actions */}
        <button
          onClick={() => handleCardClick('overdue-actions')}
          className={`rounded-lg border bg-white p-6 text-left transition-all ${
            activeFilter === 'overdue-actions'
              ? 'border-red-500 ring-2 ring-red-200'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-sm text-[var(--muted)]">Overdue Actions</p>
          <p className={`mt-1 text-3xl font-bold ${totalOverdueActions > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {totalOverdueActions}
          </p>
        </button>

        {/* Pending Wishlist */}
        <button
          onClick={() => handleCardClick('pending-wishlist')}
          className={`rounded-lg border bg-white p-6 text-left transition-all ${
            activeFilter === 'pending-wishlist'
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-sm text-[var(--muted)]">Pending Wishlist</p>
          <p className={`mt-1 text-3xl font-bold ${totalPendingWishlist > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
            {totalPendingWishlist}
          </p>
        </button>
      </div>

      {/* Active filter indicator */}
      {activeFilter && activeFilter !== 'all' && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-[var(--muted)]">{filterLabel}</span>
          <span className="text-sm text-[var(--muted)]">
            ({filteredClients.length} of {allClients.length})
          </span>
          <button
            onClick={() => setActiveFilter(null)}
            className="ml-2 text-xs text-[var(--primary)] hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Client list — enhanced table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Client
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Tier
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Active
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Open Actions
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Overdue
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Last Check-in
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                New Wishlist
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredClients.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-400">
                  No clients match this filter.
                </td>
              </tr>
            ) : (
              filteredClients.map((client) => {
                const checkInDays = daysSince(client.lastCheckIn);
                const checkInColour =
                  checkInDays === Infinity
                    ? 'text-red-600'
                    : checkInDays > 30
                    ? 'text-red-600'
                    : checkInDays > 14
                    ? 'text-amber-600'
                    : 'text-gray-600';

                return (
                  <tr
                    key={client.id}
                    className="transition-colors hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}/campaigns`}
                        className="text-sm font-medium text-[var(--primary)] hover:underline"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-[var(--muted)]">
                        {client.tier}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-[var(--accent-green)]">
                      {client.activeCampaigns}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}/actions`}
                        className={`text-sm font-medium ${cellLinkClass} ${
                          client.overdueActions > 0 ? 'text-red-600' : 'text-gray-900'
                        }`}
                      >
                        {client.openActions}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {client.overdueActions > 0 ? (
                        <Link
                          href={`/clients/${client.id}/actions`}
                          className={`text-sm font-medium text-red-600 ${cellLinkClass}`}
                        >
                          {client.overdueActions}
                        </Link>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}/checkins`}
                        className={`text-sm ${cellLinkClass} ${checkInColour}`}
                      >
                        {client.lastCheckIn
                          ? formatShortDate(client.lastCheckIn)
                          : 'None'}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {client.newWishlistItems > 0 ? (
                        <Link
                          href={`/clients/${client.id}/wishlists?status=new`}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-blue-700 bg-blue-100 ${cellLinkClass}`}
                        >
                          {client.newWishlistItems}
                        </Link>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--foreground)]">
                      {client.totalCampaigns}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
