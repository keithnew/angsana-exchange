'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CheckInType, CheckInDuration } from '@/types';
import { CHECKIN_TYPE_CONFIG, CHECKIN_DURATION_OPTIONS } from '@/types';
import type { ActionLitePriority } from '@/lib/workItems/actionLite';
import { ACTION_LITE_PRIORITY_CONFIG } from '@/lib/workItems/actionLite';
import { AssigneePickerInput } from '@/components/workItems/AssigneePickerInput';

// S3-code-P4: legacy `ActionPriority` / `ACTION_PRIORITY_CONFIG` removed
// from `@/types`. Action surfaces now consume the action-lite Work Item
// primitives. The form-level "priority" picker still applies to
// action-lite (same enum: high|medium|low — Spec §7.1).
type ActionPriority = ActionLitePriority;
const ACTION_PRIORITY_CONFIG = ACTION_LITE_PRIORITY_CONFIG;

// =============================================================================
// Tag Input Component
// =============================================================================

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState('');

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      onChange([...tags, inputValue.trim()]);
      setInputValue('');
    }
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700"
          >
            {tag}
            <button type="button" onClick={() => removeTag(i)} className="ml-0.5 hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
      <p className="mt-1 text-xs text-[var(--muted)]">Press Enter to add</p>
    </div>
  );
}

// =============================================================================
// Key Points Editor
// =============================================================================

function KeyPointsEditor({
  keyPoints,
  onChange,
}: {
  keyPoints: string[];
  onChange: (points: string[]) => void;
}) {
  function addPoint() {
    if (keyPoints.length >= 5) return;
    onChange([...keyPoints, '']);
  }

  function updatePoint(index: number, value: string) {
    if (value.length > 150) return; // hard limit
    const updated = [...keyPoints];
    updated[index] = value;
    onChange(updated);
  }

  function removePoint(index: number) {
    if (keyPoints.length <= 1) return; // cannot remove the last one
    onChange(keyPoints.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
        Key Points <span className="text-red-500">*</span>
        <span className="text-[var(--muted)] font-normal ml-1">(1–5 items, max 150 chars each)</span>
      </label>
      <div className="space-y-2">
        {keyPoints.map((point, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)] w-4">{i + 1}.</span>
            <Input
              value={point}
              onChange={(e) => updatePoint(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              maxLength={150}
              placeholder="What was discussed? Keep it specific and concise."
              className="h-8 text-sm"
            />
            <span className={`text-xs whitespace-nowrap ${point.length >= 140 ? 'text-amber-600' : 'text-[var(--muted)]'}`}>
              {150 - point.length}
            </span>
            {keyPoints.length > 1 && (
              <button
                type="button"
                onClick={() => removePoint(i)}
                className="text-[var(--muted)] hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {keyPoints.length < 5 && (
        <button
          type="button"
          onClick={addPoint}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <Plus className="h-3 w-3" />
          Add key point
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Decision/NextStep Editor
// =============================================================================

interface DecisionItem {
  text: string;
  assignee: string;
  dueDate: string;
  priority: ActionPriority;
  createAction: boolean;
}

function DecisionsEditor({
  items,
  onChange,
  label,
  assigneeLabel,
  datePlaceholder,
}: {
  items: DecisionItem[];
  onChange: (items: DecisionItem[]) => void;
  label: string;
  assigneeLabel: string;
  datePlaceholder: string;
}) {
  function addItem() {
    onChange([...items, { text: '', assignee: '', dueDate: '', priority: 'medium' as ActionPriority, createAction: true }]);
  }

  function updateItem(index: number, field: keyof DecisionItem, value: string | boolean) {
    const updated = [...items];
    if (field === 'text' && typeof value === 'string' && value.length > 200) return;
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-[var(--foreground)]">
        {label}
        <span className="text-[var(--muted)] font-normal ml-1">(optional, max 200 chars each)</span>
      </label>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start gap-2 mb-2">
              <textarea
                value={item.text}
                onChange={(e) => updateItem(i, 'text', e.target.value)}
                maxLength={200}
                placeholder="What was decided? Who needs to do what?"
                rows={2}
                className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="text-[var(--muted)] hover:text-red-600 mt-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-1">
              {200 - item.text.length} chars remaining
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                {/* S3-code-P4 §4: AssigneePickerInput replaces the bare
                    Input. Free-text fallback preserved (whitespace in
                    value → no picker opens). Audience: 'shared' — see
                    sign-off question 4 in the P4 plan; check-in
                    decisions/next-steps land on either internal or
                    client side. */}
                <AssigneePickerInput
                  value={item.assignee}
                  onChange={(next) => updateItem(i, 'assignee', next)}
                  placeholder={assigneeLabel}
                  audience="shared"
                  className="h-7 text-xs"
                />
              </div>
              <div className="w-36">
                <Input
                  type="date"
                  value={item.dueDate}
                  onChange={(e) => updateItem(i, 'dueDate', e.target.value)}
                  className="h-7 text-xs"
                  title={datePlaceholder}
                />
              </div>
              <div className="w-24">
                <select
                  value={item.priority}
                  onChange={(e) => updateItem(i, 'priority', e.target.value)}
                  className="h-7 w-full rounded-md border border-gray-300 bg-white px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
                  title="Priority"
                >
                  {(Object.keys(ACTION_PRIORITY_CONFIG) as ActionPriority[]).map((p) => (
                    <option key={p} value={p}>{ACTION_PRIORITY_CONFIG[p].label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={item.createAction}
                  onChange={(e) => updateItem(i, 'createAction', e.target.checked)}
                  className="rounded border-gray-300"
                />
                Create action
              </label>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addItem}
        className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <Plus className="h-3 w-3" />
        Add {label.toLowerCase().replace(/s$/, '')}
      </button>
    </div>
  );
}

// =============================================================================
// Main Form
// =============================================================================

interface CheckInFormProps {
  clientId: string;
  clientName: string;
  campaigns: { id: string; campaignName: string }[];
}

export function CheckInForm({ clientId, clientName, campaigns }: CheckInFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [type, setType] = useState<CheckInType>('regular');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [duration, setDuration] = useState<CheckInDuration>(30);
  const [relatedCampaigns, setRelatedCampaigns] = useState<string[]>([]);
  const [nextCheckInDate, setNextCheckInDate] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>(['']);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [nextSteps, setNextSteps] = useState<DecisionItem[]>([]);

  function toggleCampaign(campaignId: string) {
    setRelatedCampaigns((prev) =>
      prev.includes(campaignId)
        ? prev.filter((id) => id !== campaignId)
        : [...prev, campaignId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Client-side validation
    const validKeyPoints = keyPoints.filter((kp) => kp.trim() !== '');
    if (validKeyPoints.length === 0) {
      setError('At least one key point is required');
      return;
    }
    if (attendees.length === 0) {
      setError('At least one attendee is required');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        date,
        type,
        attendees,
        duration,
        relatedCampaigns,
        keyPoints: validKeyPoints,
        decisions: decisions.filter((d) => d.text.trim() !== '').map((d) => ({
          text: d.text,
          assignee: d.assignee || undefined,
          dueDate: d.dueDate || undefined,
          priority: d.priority,
          createAction: d.createAction,
        })),
        nextSteps: nextSteps.filter((ns) => ns.text.trim() !== '').map((ns) => ({
          text: ns.text,
          owner: ns.assignee || undefined,
          targetDate: ns.dueDate || undefined,
          priority: ns.priority,
          createAction: ns.createAction,
        })),
        ...(nextCheckInDate ? { nextCheckInDate } : {}),
      };

      const res = await fetch(`/api/clients/${clientId}/checkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create check-in');
      }

      const result = await res.json();

      // Show success toast via URL param (picked up by detail page)
      router.push(`/clients/${clientId}/checkins/${result.id}?created=true&actions=${result.actionCount}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link
        href={`/clients/${clientId}/checkins`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {clientName} check-ins
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-[var(--foreground)]">New Check-in</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Meeting Details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Meeting Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Date */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {/* Type */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Type <span className="text-red-500">*</span>
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CheckInType)}
                required
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              >
                {(Object.keys(CHECKIN_TYPE_CONFIG) as CheckInType[]).map((t) => (
                  <option key={t} value={t}>{CHECKIN_TYPE_CONFIG[t].label}</option>
                ))}
              </select>
            </div>

            {/* Attendees */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Attendees <span className="text-red-500">*</span>
              </label>
              <TagInput
                tags={attendees}
                onChange={setAttendees}
                placeholder="Type a name and press Enter..."
              />
            </div>

            {/* Duration */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Duration <span className="text-red-500">*</span>
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as CheckInDuration)}
                required
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              >
                {CHECKIN_DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Related Campaigns */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Related Campaigns <span className="text-[var(--muted)] font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCampaign(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      relatedCampaigns.includes(c.id)
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {c.campaignName}
                  </button>
                ))}
                {campaigns.length === 0 && (
                  <p className="text-xs text-[var(--muted)]">No campaigns available</p>
                )}
              </div>
            </div>

            {/* Next Check-in Date */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Next Check-in Date <span className="text-[var(--muted)] font-normal">(optional)</span>
              </label>
              <Input
                type="date"
                value={nextCheckInDate}
                onChange={(e) => setNextCheckInDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </CardContent>
        </Card>

        {/* Key Points */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Key Points</CardTitle>
          </CardHeader>
          <CardContent>
            <KeyPointsEditor keyPoints={keyPoints} onChange={setKeyPoints} />
          </CardContent>
        </Card>

        {/* Decisions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionsEditor
              items={decisions}
              onChange={setDecisions}
              label="Decisions"
              assigneeLabel="Assignee..."
              datePlaceholder="Due date"
            />
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Next Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionsEditor
              items={nextSteps}
              onChange={setNextSteps}
              label="Next Steps"
              assigneeLabel="Owner..."
              datePlaceholder="Target date"
            />
          </CardContent>
        </Card>

        {/* Submit */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Recording...' : 'Record Check-in'}
          </Button>
          <Link href={`/clients/${clientId}/checkins`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
