'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientConfig, ManagedListItem } from '@/types';

interface Props {
  clientId: string;
  config: ClientConfig;
  therapyAreaOptions: ManagedListItem[];
  canEdit: boolean;
}

export function ClientSettingsClient({ clientId, config, therapyAreaOptions, canEdit }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Form state
  const [name, setName] = useState(config.name);
  const [tier, setTier] = useState(config.tier);
  const [competitors, setCompetitors] = useState<string[]>(config.competitors);
  const [newCompetitor, setNewCompetitor] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>(config.capabilities);
  const [activeTherapyAreas, setActiveTherapyAreas] = useState<string[]>(config.therapyAreas);
  const [conflictedAreas, setConflictedAreas] = useState<string[]>(config.conflictedTherapyAreas);

  const hasTherapyAreas = capabilities.includes('therapyAreas');

  // --- Capability toggle ---
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  function toggleTherapyAreas() {
    if (hasTherapyAreas) {
      setShowDisableConfirm(true);
    } else {
      setCapabilities([...capabilities, 'therapyAreas']);
    }
  }

  function confirmDisableTherapyAreas() {
    setCapabilities(capabilities.filter((c) => c !== 'therapyAreas'));
    setShowDisableConfirm(false);
  }

  // --- Competitors ---
  function addCompetitor() {
    const trimmed = newCompetitor.trim();
    if (trimmed && !competitors.includes(trimmed)) {
      setCompetitors([...competitors, trimmed]);
      setNewCompetitor('');
    }
  }

  function removeCompetitor(c: string) {
    setCompetitors(competitors.filter((x) => x !== c));
  }

  // --- Therapy area toggles ---
  function toggleActiveArea(id: string) {
    if (activeTherapyAreas.includes(id)) {
      setActiveTherapyAreas(activeTherapyAreas.filter((a) => a !== id));
    } else {
      // Remove from conflicted if adding to active
      setConflictedAreas(conflictedAreas.filter((a) => a !== id));
      setActiveTherapyAreas([...activeTherapyAreas, id]);
    }
  }

  function toggleConflictedArea(id: string) {
    if (conflictedAreas.includes(id)) {
      setConflictedAreas(conflictedAreas.filter((a) => a !== id));
    } else {
      // Remove from active if adding to conflicted
      setActiveTherapyAreas(activeTherapyAreas.filter((a) => a !== id));
      setConflictedAreas([...conflictedAreas, id]);
    }
  }

  // --- Save ---
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tier,
          competitors,
          capabilities,
          therapyAreas: activeTherapyAreas,
          conflictedTherapyAreas: conflictedAreas,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setToast('Settings saved successfully');
      setTimeout(() => setToast(''), 3000);
      router.refresh();
    } catch {
      setToast('Error saving settings');
      setTimeout(() => setToast(''), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">
          {config.name} — Settings
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Client configuration and capabilities
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 rounded-md px-4 py-2 text-sm font-medium ${
          toast.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
        }`}>
          {toast}
        </div>
      )}

      {/* === General Section === */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-[var(--foreground)]">General</h3>

        <div className="space-y-4">
          {/* Client Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Client Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-[var(--muted)]"
            />
          </div>

          {/* Tier */}
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Tier
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as ClientConfig['tier'])}
              disabled={!canEdit}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-[var(--muted)]"
            >
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
              <option value="trial">Trial</option>
            </select>
          </div>

          {/* Competitors */}
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              Competitors
            </label>
            <div className="mb-2 flex flex-wrap gap-2">
              {competitors.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-[var(--foreground)]"
                >
                  {c}
                  {canEdit && (
                    <button
                      onClick={() => removeCompetitor(c)}
                      className="ml-1 text-gray-400 hover:text-red-500"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {competitors.length === 0 && (
                <span className="text-xs text-[var(--muted)]">No competitors set</span>
              )}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCompetitor}
                  onChange={(e) => setNewCompetitor(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCompetitor())}
                  placeholder="Add competitor..."
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={addCompetitor}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === Capabilities Section === */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Capabilities</h3>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Optional capabilities that unlock additional features for this client.
        </p>

        <div className="space-y-3">
          {/* Therapy Areas toggle */}
          <div className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Therapy Areas</p>
              <p className="text-xs text-[var(--muted)]">
                Enables therapy area targeting on campaigns and conflict checking
              </p>
            </div>
            <button
              onClick={toggleTherapyAreas}
              disabled={!canEdit}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                hasTherapyAreas ? 'bg-[var(--primary)]' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  hasTherapyAreas ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* === Therapy Areas Section (conditional) === */}
      {hasTherapyAreas && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Therapy Areas</h3>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Select which therapy areas apply to this client. Conflicted areas will show as warnings on campaigns.
          </p>

          <div className="space-y-4">
            {/* Active areas */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--foreground)]">
                Active Therapy Areas
              </label>
              <div className="flex flex-wrap gap-2">
                {therapyAreaOptions.map((ta) => {
                  const isActive = activeTherapyAreas.includes(ta.id);
                  const isConflicted = conflictedAreas.includes(ta.id);
                  return (
                    <button
                      key={ta.id}
                      onClick={() => canEdit && toggleActiveArea(ta.id)}
                      disabled={!canEdit}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[var(--primary)] text-white'
                          : isConflicted
                            ? 'bg-gray-100 text-gray-400 line-through'
                            : 'bg-gray-100 text-[var(--foreground)] hover:bg-gray-200'
                      } disabled:cursor-default`}
                    >
                      {ta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Conflicted areas */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[var(--foreground)]">
                Conflicted Therapy Areas
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  (blocked — shown as warnings)
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {therapyAreaOptions.map((ta) => {
                  const isActive = activeTherapyAreas.includes(ta.id);
                  const isConflicted = conflictedAreas.includes(ta.id);
                  return (
                    <button
                      key={ta.id}
                      onClick={() => canEdit && toggleConflictedArea(ta.id)}
                      disabled={!canEdit}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isConflicted
                          ? 'bg-red-100 text-red-700'
                          : isActive
                            ? 'bg-gray-100 text-gray-400 line-through'
                            : 'bg-gray-100 text-[var(--foreground)] hover:bg-gray-200'
                      } disabled:cursor-default`}
                    >
                      {ta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === Platform Notes (future) === */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-2 text-lg font-semibold text-[var(--foreground)]">Platform Notes</h3>
        <p className="text-sm text-[var(--muted)]">
          Coming soon — AI processing tier, dashboard configuration, module permissions, notification preferences.
        </p>
      </div>

      {/* === Disable Confirmation Dialog === */}
      {showDisableConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-[var(--foreground)]">
              Disable Therapy Areas?
            </h3>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Disabling therapy areas will remove therapy area targeting from this
              client&apos;s campaigns. Existing therapy area selections on campaigns will
              be preserved but hidden. Continue?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDisableConfirm(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDisableTherapyAreas}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Save Button === */}
      {canEdit && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-6 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}
    </div>
  );
}
