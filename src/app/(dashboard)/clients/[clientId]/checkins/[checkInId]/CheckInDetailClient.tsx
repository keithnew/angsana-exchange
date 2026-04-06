'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CheckIn, Action } from '@/types';
import { CHECKIN_TYPE_CONFIG, ACTION_STATUS_CONFIG } from '@/types';

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

function TypeBadge({ type }: { type: CheckIn['type'] }) {
  const config = CHECKIN_TYPE_CONFIG[type] || CHECKIN_TYPE_CONFIG.regular;
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
      style={{ color: config.colour, backgroundColor: config.bgColour }}
    >
      {config.label}
    </span>
  );
}

function ActionStatusBadge({ status }: { status: Action['status'] }) {
  const config = ACTION_STATUS_CONFIG[status];
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
// Main Component
// =============================================================================

export function CheckInDetailClient({
  checkin,
  linkedActions,
  clientId,
  clientName,
  campaignMap,
  isInternal,
}: {
  checkin: CheckIn;
  linkedActions: Action[];
  clientId: string;
  clientName: string;
  campaignMap: Record<string, string>;
  isInternal: boolean;
}) {
  const searchParams = useSearchParams();
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    if (searchParams.get('created') === 'true') {
      const actionCount = searchParams.get('actions') || '0';
      setToastMessage(`Check-in recorded. ${actionCount} action${actionCount === '1' ? '' : 's'} created.`);
      setTimeout(() => setToastMessage(''), 4000);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  // Build action lookup by title for linking decisions/next steps to actions
  const actionsByTitle = new Map<string, Action>();
  linkedActions.forEach((a) => actionsByTitle.set(a.title, a));

  const isNextCheckInOverdue = checkin.nextCheckInDate && new Date(checkin.nextCheckInDate) < new Date();

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
        <div className="mb-3 flex items-center gap-1 text-sm text-[var(--muted)]">
          <Link
            href={`/clients/${clientId}/checkins`}
            className="hover:text-[var(--foreground)]"
          >
            Check-ins
          </Link>
          <span>›</span>
          <span className="text-[var(--foreground)]">{formatDate(checkin.date)}</span>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">
              {formatDate(checkin.date)} — {CHECKIN_TYPE_CONFIG[checkin.type]?.label || 'Check-in'}
            </h1>
            <div className="mt-2">
              <TypeBadge type={checkin.type} />
            </div>
            <div className="mt-2 flex items-center gap-4 text-sm text-[var(--muted)]">
              <span>{checkin.duration} minutes</span>
              <span>·</span>
              <span>{checkin.attendees.join(', ')}</span>
            </div>
          </div>

          {isInternal && (
            <Link href={`/clients/${clientId}/checkins/${checkin.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
          )}
        </div>

        {/* Related Campaigns */}
        {checkin.relatedCampaigns.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {checkin.relatedCampaigns.map((cId) => (
              <Link
                key={cId}
                href={`/clients/${clientId}/campaigns/${cId}`}
                className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-[var(--primary)] hover:bg-gray-100"
              >
                {campaignMap[cId] || cId}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Key Points */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Key Points</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal pl-5 space-y-2">
            {checkin.keyPoints.map((point, i) => (
              <li key={i} className="text-sm text-[var(--foreground)]">{point}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Decisions */}
      {checkin.decisions.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {checkin.decisions.map((decision, i) => {
                const linkedAction = actionsByTitle.get(decision.text);
                return (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-sm text-[var(--foreground)]">{decision.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                      {decision.assignee && <span>Assignee: <strong>{decision.assignee}</strong></span>}
                      {decision.dueDate && <span>Due: {formatDate(decision.dueDate)}</span>}
                      {linkedAction && (
                        <Link
                          href={`/clients/${clientId}/actions`}
                          className="inline-flex items-center gap-1"
                        >
                          <ActionStatusBadge status={linkedAction.status} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Steps */}
      {checkin.nextSteps.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Next Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {checkin.nextSteps.map((step, i) => {
                const linkedAction = actionsByTitle.get(step.text);
                return (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <p className="text-sm text-[var(--foreground)]">{step.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                      {step.owner && <span>Owner: <strong>{step.owner}</strong></span>}
                      {step.targetDate && <span>Target: {formatDate(step.targetDate)}</span>}
                      {linkedAction && (
                        <Link
                          href={`/clients/${clientId}/actions`}
                          className="inline-flex items-center gap-1"
                        >
                          <ActionStatusBadge status={linkedAction.status} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Check-in Date */}
      {checkin.nextCheckInDate && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Next Check-in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-sm ${isNextCheckInOverdue ? 'text-red-600 font-medium' : 'text-[var(--foreground)]'}`}>
              {formatDate(checkin.nextCheckInDate)}
              {isNextCheckInOverdue && (
                <span className="ml-2 text-xs text-red-500">
                  ⚠ Next check-in was scheduled for {formatDate(checkin.nextCheckInDate)} — overdue
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <div className="mt-8 text-xs text-[var(--muted)]">
        Recorded by {checkin.createdBy} on {formatDate(checkin.createdAt)}
      </div>
    </div>
  );
}
