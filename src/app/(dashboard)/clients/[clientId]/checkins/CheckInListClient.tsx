'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CheckIn, CheckInType } from '@/types';
import { CHECKIN_TYPE_CONFIG } from '@/types';

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

function TypeBadge({ type }: { type: CheckInType }) {
  const config = CHECKIN_TYPE_CONFIG[type] || CHECKIN_TYPE_CONFIG.regular;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: config.colour, backgroundColor: config.bgColour }}
    >
      {config.label}
    </span>
  );
}

function formatAttendees(attendees: string[]): string {
  if (!attendees || attendees.length === 0) return '—';
  if (attendees.length <= 3) return attendees.join(', ');
  return `${attendees.slice(0, 3).join(', ')} +${attendees.length - 3}`;
}

// =============================================================================
// Main Component
// =============================================================================

type TypeFilter = 'all' | CheckInType;

export function CheckInListClient({
  checkins,
  clientId,
  campaigns,
}: {
  checkins: CheckIn[];
  clientId: string;
  campaigns: { id: string; campaignName: string }[];
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const filtered =
    typeFilter === 'all'
      ? checkins
      : checkins.filter((c) => c.type === typeFilter);

  function getCampaignName(campaignId: string): string {
    const campaign = campaigns.find((c) => c.id === campaignId);
    return campaign ? campaign.campaignName : campaignId;
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-[var(--muted)]">Type:</span>
        {(['all', 'kick-off', 'regular', 'ad-hoc'] as TypeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              typeFilter === t
                ? 'bg-[var(--primary)] text-white'
                : 'bg-gray-100 text-[var(--muted)] hover:bg-gray-200'
            }`}
          >
            {t === 'all' ? 'All' : CHECKIN_TYPE_CONFIG[t as CheckInType]?.label || t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Attendees
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Key Point
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Campaigns
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((checkin) => (
              <tr
                key={checkin.id}
                className="transition-colors hover:bg-gray-50"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/clients/${clientId}/checkins/${checkin.id}`}
                    className="text-sm font-medium text-[var(--primary)] hover:underline"
                  >
                    {formatDate(checkin.date)}
                  </Link>
                </td>
                <td className="px-4 py-4">
                  <TypeBadge type={checkin.type} />
                </td>
                <td className="px-4 py-4 text-sm text-[var(--foreground)]">
                  {checkin.duration} min
                </td>
                <td className="px-4 py-4 text-sm text-[var(--foreground)]" title={checkin.attendees.join(', ')}>
                  {formatAttendees(checkin.attendees)}
                </td>
                <td className="max-w-xs px-4 py-4">
                  <p className="truncate text-sm text-[var(--muted)]" title={checkin.keyPoints[0]}>
                    {checkin.keyPoints[0] || '—'}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-1">
                    {checkin.relatedCampaigns.length > 0 ? (
                      checkin.relatedCampaigns.map((cId) => (
                        <span
                          key={cId}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 truncate max-w-[120px]"
                          title={getCampaignName(cId)}
                        >
                          {getCampaignName(cId)}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-[var(--muted)]">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4">
                  {checkin.generatedActionIds.length > 0 ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {checkin.generatedActionIds.length}
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-[var(--muted)]">
                  No check-ins match the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
