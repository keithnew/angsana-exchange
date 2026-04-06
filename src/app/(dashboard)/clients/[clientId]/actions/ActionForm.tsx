'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ActionFormProps {
  clientId: string;
  clientName: string;
  campaigns: { id: string; campaignName: string }[];
}

export function ActionForm({ clientId, clientName, campaigns }: ActionFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [relatedCampaign, setRelatedCampaign] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = {
        title,
        description,
        assignedTo,
        dueDate,
        priority,
        relatedCampaign,
      };

      const res = await fetch(`/api/clients/${clientId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create action');
      }

      router.push(`/clients/${clientId}/actions`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href={`/clients/${clientId}/actions`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {clientName} actions
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-[var(--foreground)]">New Action</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Action Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Title <span className="text-red-500">*</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={150}
                required
                placeholder="What needs to be done? Be specific."
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {150 - title.length} characters remaining
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Description <span className="text-[var(--muted)] font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={280}
                placeholder="Additional context..."
                rows={2}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {280 - description.length} characters remaining
              </p>
            </div>

            {/* Assigned To */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Assigned To <span className="text-red-500">*</span>
              </label>
              <Input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                required
                placeholder="Who is responsible?"
              />
            </div>

            {/* Due Date */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Due Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>

            {/* Priority */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'high' | 'medium' | 'low')}
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Related Campaign */}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                Related Campaign <span className="text-[var(--muted)] font-normal">(optional)</span>
              </label>
              <select
                value={relatedCampaign}
                onChange={(e) => setRelatedCampaign(e.target.value)}
                className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
              >
                <option value="">None — client-level action</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.campaignName}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create Action'}
          </Button>
          <Link href={`/clients/${clientId}/actions`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
