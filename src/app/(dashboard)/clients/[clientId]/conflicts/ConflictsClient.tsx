'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, ShieldAlert, MoreHorizontal, Plus, Info } from 'lucide-react';
import type { ConflictEntry, ConflictDomainType, ConflictScope } from '@/types';
import { CONFLICT_DOMAIN_TYPE_CONFIG, CONFLICT_SCOPE_CONFIG } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────
function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────

export function ConflictsClient({ clientId }: { clientId: string }) {
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [domainTypeFilter, setDomainTypeFilter] = useState<ConflictDomainType | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<ConflictScope | 'all'>('all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Build API URL from filters
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('status', showRemoved ? 'all' : 'active');
    if (domainTypeFilter !== 'all') params.set('domainType', domainTypeFilter);
    if (scopeFilter !== 'all') params.set('scope', scopeFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    return `/api/clients/${clientId}/conflicts?${params.toString()}`;
  }, [clientId, domainTypeFilter, scopeFilter, showRemoved, debouncedSearch]);

  // Fetch conflicts
  useEffect(() => {
    setLoading(true);
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => {
        setConflicts(data?.data ?? []);
      })
      .catch(() => setConflicts([]))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  // Summary counts — count active entries from current result set
  const summary = useMemo(() => {
    const active = conflicts.filter((c) => c.status === 'active');
    return {
      total: active.length,
      therapyArea: active.filter((c) => c.domainType === 'therapy-area').length,
      productCategory: active.filter((c) => c.domainType === 'product-category').length,
      industrySegment: active.filter((c) => c.domainType === 'industry-segment').length,
    };
  }, [conflicts]);

  const clearFilters = useCallback(() => {
    setDomainTypeFilter('all');
    setScopeFilter('all');
    setShowRemoved(false);
    setSearchQuery('');
  }, []);

  // ── Empty state (no conflicts at all) ──
  if (!loading && conflicts.length === 0 && domainTypeFilter === 'all' && scopeFilter === 'all' && !debouncedSearch && !showRemoved) {
    return (
      <div className="flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)]">Conflicts</h1>
              <p className="text-sm text-[var(--muted)]">{clientId}</p>
            </div>
            <button
              disabled
              title="Coming in next update"
              className="flex items-center gap-2 rounded-full bg-[#3B7584] px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              <Plus className="h-4 w-4" />
              Add Conflict
            </button>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex flex-1 flex-col items-center justify-center py-24">
          <ShieldAlert className="h-12 w-12 text-gray-300" />
          <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">No conflicts declared</h2>
          <p className="mt-2 max-w-md text-center text-sm text-[var(--muted)]">
            Conflicts define therapy areas, product categories, or industry segments where prospecting is restricted.
          </p>
          <button
            disabled
            title="Coming in next update"
            className="mt-4 flex items-center gap-2 rounded-full bg-[#3B7584] px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Add Conflict
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b bg-white">
        {/* Page header */}
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Conflicts</h1>
            <p className="text-sm text-[var(--muted)]">{clientId}</p>
          </div>
          <button
            disabled
            title="Coming in next update"
            className="flex items-center gap-2 rounded-full bg-[#3B7584] px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Add Conflict
          </button>
        </div>

        {/* Contextual banner */}
        <div className="mx-6 mb-3 rounded-lg border-l-[3px] border-[#3B7584] bg-[#F0F7F4] px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#3B7584]" />
            <p className="text-sm text-[var(--foreground)]">
              Therapy areas, product categories, or industry segments where prospecting is restricted. These constraints apply across all campaigns.
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 px-6 pb-3">
          {/* Domain type filter */}
          <select
            value={domainTypeFilter}
            onChange={(e) => setDomainTypeFilter(e.target.value as ConflictDomainType | 'all')}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-[var(--foreground)] focus:border-[#3B7584] focus:outline-none focus:ring-1 focus:ring-[#3B7584]"
          >
            <option value="all">All types</option>
            <option value="therapy-area">Therapy area</option>
            <option value="product-category">Product category</option>
            <option value="industry-segment">Industry segment</option>
          </select>

          {/* Scope filter */}
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ConflictScope | 'all')}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-[var(--foreground)] focus:border-[#3B7584] focus:outline-none focus:ring-1 focus:ring-[#3B7584]"
          >
            <option value="all">All scopes</option>
            <option value="industry-wide">Industry-wide</option>
            <option value="company-specific">Company-specific</option>
          </select>

          {/* Show removed toggle */}
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)] cursor-pointer">
            <div
              className={`relative h-5 w-9 rounded-full transition-colors ${showRemoved ? 'bg-[#3B7584]' : 'bg-gray-300'}`}
              onClick={() => setShowRemoved(!showRemoved)}
            >
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${showRemoved ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </div>
            Show removed
          </label>

          {/* Search */}
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search conflicts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-full border border-gray-300 bg-white py-1.5 pl-9 pr-4 text-sm text-[var(--foreground)] placeholder:text-gray-400 focus:border-[#3B7584] focus:outline-none focus:ring-1 focus:ring-[#3B7584] w-64"
            />
          </div>
        </div>

        {/* Summary bar */}
        <div className="px-6 pb-3">
          <p className="text-xs text-[var(--muted)]">
            {summary.total} active conflict{summary.total !== 1 ? 's' : ''}
            {summary.therapyArea > 0 && ` • ${summary.therapyArea} therapy-area`}
            {summary.productCategory > 0 && ` • ${summary.productCategory} product-category`}
            {summary.industrySegment > 0 && ` • ${summary.industrySegment} industry-segment`}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--muted)]">Loading conflicts…</p>
          </div>
        ) : conflicts.length === 0 ? (
          /* No results state */
          <div className="flex flex-col items-center py-12">
            <p className="text-sm text-[var(--muted)]">No conflicts match your filters</p>
            <button
              onClick={clearFilters}
              className="mt-2 text-sm font-medium text-[#3B7584] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                <th className="pb-2 pr-4">Conflict Domain</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Scope</th>
                <th className="pb-2 pr-4">Scope Detail</th>
                <th className="pb-2 pr-4">Added</th>
                {showRemoved && <th className="pb-2 pr-4">Status</th>}
                <th className="pb-2 w-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-b last:border-0 ${entry.status === 'removed' ? 'opacity-50' : ''}`}
                >
                  {/* Conflict Domain */}
                  <td className="py-3 pr-4">
                    <div className="font-medium text-[var(--foreground)]">{entry.conflictDomain}</div>
                    {entry.scope === 'company-specific' && entry.companyName && (
                      <div className="text-xs text-[var(--muted)]">{entry.companyName}</div>
                    )}
                  </td>

                  {/* Type badge */}
                  <td className="py-3 pr-4">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        color: CONFLICT_DOMAIN_TYPE_CONFIG[entry.domainType].colour,
                        backgroundColor: CONFLICT_DOMAIN_TYPE_CONFIG[entry.domainType].bgColour,
                      }}
                    >
                      {CONFLICT_DOMAIN_TYPE_CONFIG[entry.domainType].label}
                    </span>
                  </td>

                  {/* Scope badge */}
                  <td className="py-3 pr-4">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        color: CONFLICT_SCOPE_CONFIG[entry.scope].colour,
                        backgroundColor: CONFLICT_SCOPE_CONFIG[entry.scope].bgColour,
                      }}
                    >
                      {CONFLICT_SCOPE_CONFIG[entry.scope].label}
                    </span>
                  </td>

                  {/* Scope Detail */}
                  <td className="py-3 pr-4 text-[var(--muted)]">
                    {entry.scopeDetail ? (
                      <span>{entry.scopeDetail}</span>
                    ) : entry.scope === 'company-specific' && entry.companyName ? (
                      <span>{entry.companyName}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Added */}
                  <td className="py-3 pr-4">
                    <div className="text-[var(--foreground)]">{formatShortDate(entry.addedAt)}</div>
                    <div className="text-xs text-[var(--muted)]">by {entry.addedByName}</div>
                  </td>

                  {/* Status (only when show removed) */}
                  {showRemoved && (
                    <td className="py-3 pr-4 text-xs">
                      {entry.status === 'active' ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                          Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                          <span>Removed</span>
                          {entry.removedAt && (
                            <span className="ml-1 text-[var(--muted)]">{formatShortDate(entry.removedAt)}</span>
                          )}
                        </span>
                      )}
                    </td>
                  )}

                  {/* Actions */}
                  <td className="py-3 text-center">
                    <button
                      disabled
                      className="rounded p-1 text-gray-400 cursor-not-allowed"
                      title="Actions coming in next update"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
