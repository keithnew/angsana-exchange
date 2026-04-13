'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Campaign, ManagedListItem, SoWhat, Proposition } from '@/types';
import { SOWHAT_ORIENTATION_CONFIG } from '@/types';
import { AlertTriangle } from 'lucide-react';

// =============================================================================
// Multi-select chips component
// =============================================================================

function MultiSelectChips({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: ManagedListItem[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const activeOptions = options.filter((o) => o.active);
  const available = activeOptions.filter((o) => !selected.includes(o.id));

  function addItem(id: string) {
    onChange([...selected, id]);
    setShowDropdown(false);
  }

  function removeItem(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  function getLabel(id: string) {
    return options.find((o) => o.id === id)?.label || id;
  }

  function getOrientation(id: string) {
    return options.find((o) => o.id === id)?.orientation;
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
        {label}
      </label>

      {/* Selected chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selected.map((id) => {
          const orientation = getOrientation(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700"
            >
              {getLabel(id)}
              {orientation && (
                <span className="text-[10px] opacity-60">({orientation})</span>
              )}
              <button
                type="button"
                onClick={() => removeItem(id)}
                className="ml-0.5 hover:text-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>

      {/* Add button/dropdown */}
      <div className="relative">
        {showDropdown ? (
          <div className="rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
            {available.length > 0 ? (
              available.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => addItem(option.id)}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                >
                  {option.label}
                  {option.orientation && (
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      ({option.orientation})
                    </span>
                  )}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-[var(--muted)]">All items selected</p>
            )}
            <div className="border-t border-gray-100 p-1">
              <button
                type="button"
                onClick={() => setShowDropdown(false)}
                className="w-full px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDropdown(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-[var(--muted)] hover:border-gray-400 hover:text-[var(--foreground)]"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Proposition Pill — expandable to show ICP details inline
// =============================================================================

function PropositionPill({
  proposition,
  onRemove,
  clientId,
}: {
  proposition: Proposition;
  onRemove: () => void;
  clientId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const icp = proposition.icp;
  const hasIcp = icp && (
    (icp.industries?.managedListRefs?.length || 0) > 0 ||
    (icp.titles?.managedListRefs?.length || 0) > 0 ||
    (icp.geographies?.managedListRefs?.length || 0) > 0 ||
    icp.buyingProcess
  );
  const icpStatus = proposition.icpStatus || 'draft';

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" />}
          <span className="text-sm font-medium text-[var(--foreground)] truncate">{proposition.name}</span>
          {proposition.category && (
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide shrink-0">{proposition.category}</span>
          )}
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${
            icpStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}>
            ICP: {icpStatus}
          </span>
        </button>
        <Link
          href={`/clients/${clientId}/prospecting-profile`}
          className="text-[var(--muted)] hover:text-[var(--accent-cyan)] shrink-0"
          title="View in Prospecting Profile"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={onRemove}
          className="text-[var(--muted)] hover:text-red-600 shrink-0"
          title="Remove proposition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded ICP detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
          {proposition.description && (
            <p className="text-xs text-[var(--muted)]">{proposition.description}</p>
          )}
          {hasIcp ? (
            <>
              {(icp.industries?.managedListRefs?.length || 0) > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Industries</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(((icp.industries as unknown as Record<string, string[]>)?.labels) || icp.industries!.managedListRefs!).map((l: string) => (
                      <span key={l} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700">{l}</span>
                    ))}
                  </div>
                </div>
              )}
              {(icp.titles?.managedListRefs?.length || 0) > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Target Titles</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(((icp.titles as unknown as Record<string, string[]>)?.labels) || icp.titles!.managedListRefs!).map((l: string) => (
                      <span key={l} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700">{l}</span>
                    ))}
                  </div>
                </div>
              )}
              {(icp.geographies?.managedListRefs?.length || 0) > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Geographies</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(((icp.geographies as unknown as Record<string, string[]>)?.labels) || icp.geographies!.managedListRefs!).map((l: string) => (
                      <span key={l} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700">{l}</span>
                    ))}
                  </div>
                </div>
              )}
              {icp.buyingProcess?.type && (
                <div>
                  <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wide">Buying Process</span>
                  <p className="text-xs text-gray-700 mt-0.5">{String(icp.buyingProcess.type)}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-[var(--muted)] italic">No ICP details defined yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Pain Points Editor
// =============================================================================

function PainPointsEditor({
  painPoints,
  onChange,
}: {
  painPoints: string[];
  onChange: (points: string[]) => void;
}) {
  function addPoint() {
    if (painPoints.length >= 8) return;
    onChange([...painPoints, '']);
  }

  function updatePoint(index: number, value: string) {
    const updated = [...painPoints];
    updated[index] = value;
    onChange(updated);
  }

  function removePoint(index: number) {
    onChange(painPoints.filter((_, i) => i !== index));
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
        Pain Points <span className="text-[var(--muted)] font-normal">(optional, max 8)</span>
      </label>
      <div className="space-y-2">
        {painPoints.map((point, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={point}
              onChange={(e) => updatePoint(i, e.target.value)}
              maxLength={150}
              placeholder={`Pain point ${i + 1}...`}
              className="h-8 text-sm"
            />
            <span className="text-xs text-[var(--muted)] whitespace-nowrap">
              {150 - point.length}
            </span>
            <button
              type="button"
              onClick={() => removePoint(i)}
              className="text-[var(--muted)] hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      {painPoints.length < 8 && (
        <button
          type="button"
          onClick={addPoint}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <Plus className="h-3 w-3" />
          Add pain point
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Main Form Component
// =============================================================================

interface TherapyAreaConfig {
  enabled: boolean;
  activeAreas: ManagedListItem[];
  conflictedAreas: string[];
}

interface CampaignFormProps {
  mode: 'create' | 'edit';
  clientId: string;
  clientName: string;
  managedLists: Record<string, ManagedListItem[]>;
  initialData?: Campaign;
  therapyAreaConfig?: TherapyAreaConfig;
  availableSoWhats?: SoWhat[];
  /** Pre-populate proposition from URL query param (e.g. ?proposition=xyz) */
  initialPropositionId?: string;
}

export function CampaignForm({
  mode,
  clientId,
  clientName,
  managedLists,
  initialData,
  therapyAreaConfig,
  availableSoWhats = [],
  initialPropositionId,
}: CampaignFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [campaignName, setCampaignName] = useState(initialData?.campaignName || '');
  const [campaignSummary, setCampaignSummary] = useState(initialData?.campaignSummary || '');
  const [serviceTypeId, setServiceTypeId] = useState(initialData?.serviceTypeId || '');
  const [propositionRefs, setPropositionRefs] = useState<string[]>(
    initialData?.propositionRefs || (initialPropositionId ? [initialPropositionId] : [])
  );
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [propositionsLoading, setPropositionsLoading] = useState(true);
  const [owner, setOwner] = useState(initialData?.owner || '');
  const [startDate, setStartDate] = useState(
    initialData?.startDate
      ? new Date(initialData.startDate).toISOString().split('T')[0]
      : ''
  );
  const [targetGeographies, setTargetGeographies] = useState<string[]>(
    initialData?.targetGeographies || []
  );
  const [targetSectors, setTargetSectors] = useState<string[]>(
    initialData?.targetSectors || []
  );
  const [targetTitles, setTargetTitles] = useState<string[]>(
    initialData?.targetTitles || []
  );
  const [companySize, setCompanySize] = useState(initialData?.companySize || '');
  const [targetTherapyAreas, setTargetTherapyAreas] = useState<string[]>(
    initialData?.targetTherapyAreas || []
  );
  const [valueProposition, setValueProposition] = useState(
    initialData?.valueProposition || ''
  );
  const [painPoints, setPainPoints] = useState<string[]>(
    initialData?.painPoints || []
  );
  const [selectedSoWhats, setSelectedSoWhats] = useState<string[]>(
    initialData?.selectedSoWhats || []
  );
  const [soWhatSearch, setSoWhatSearch] = useState('');

  // Fetch propositions for this client
  useEffect(() => {
    async function fetchPropositions() {
      setPropositionsLoading(true);
      try {
        const res = await fetch(`/api/clients/${clientId}/propositions`);
        if (res.ok) {
          const data = await res.json();
          setPropositions(data.propositions || []);
        }
      } catch (err) {
        console.error('Failed to fetch propositions:', err);
      } finally {
        setPropositionsLoading(false);
      }
    }
    fetchPropositions();
  }, [clientId]);

  // Get service type label from id
  function getServiceTypeLabel(id: string): string {
    const item = (managedLists.serviceTypes || []).find((i) => i.id === id);
    return item ? item.label : '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const serviceType = getServiceTypeLabel(serviceTypeId);

      const payload = {
        campaignName,
        campaignSummary,
        serviceType,
        serviceTypeId,
        propositionRefs,
        owner,
        startDate,
        targetGeographies,
        targetSectors,
        targetTitles,
        companySize,
        ...(therapyAreaConfig?.enabled ? { targetTherapyAreas } : {}),
        valueProposition,
        painPoints: painPoints.filter((p) => p.trim() !== ''),
        selectedSoWhats,
      };

      if (mode === 'create') {
        const res = await fetch(`/api/clients/${clientId}/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create campaign');
        }

        const result = await res.json();
        router.push(`/clients/${clientId}/campaigns/${result.id}`);
      } else {
        const res = await fetch(
          `/api/clients/${clientId}/campaigns/${initialData!.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update campaign');
        }

        router.push(`/clients/${clientId}/campaigns/${initialData!.id}`);
        router.refresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      setSaving(false);
    }
  }

  const activeServiceTypes = (managedLists.serviceTypes || []).filter((i) => i.active);
  const activeCompanySizes = (managedLists.companySizes || []).filter((i) => i.active);

  const cancelHref = mode === 'edit'
    ? `/clients/${clientId}/campaigns/${initialData!.id}`
    : `/clients/${clientId}/campaigns`;

  // Shared button bar component
  const ActionButtons = () => (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={saving}>
        {saving
          ? mode === 'create'
            ? 'Creating...'
            : 'Saving...'
          : mode === 'create'
            ? 'Create Campaign'
            : 'Save Changes'}
      </Button>
      <Link href={cancelHref}>
        <Button type="button" variant="outline">
          Cancel
        </Button>
      </Link>
    </div>
  );

  return (
    <>
      {/* Sub-header — full width, outside max-w constraint */}
      <div className="sticky top-0 z-30 bg-white -mx-6 px-6 pb-3 pt-4 border-b border-gray-200 mb-6">
        <Link
          href={cancelHref}
          className="mb-1 inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {mode === 'edit' ? 'Back to campaign' : `Back to ${clientName} campaigns`}
        </Link>

        <h1 className="text-xl font-bold text-[var(--foreground)]">
          {mode === 'create' ? 'New Campaign' : `Edit: ${initialData!.campaignName}`}
        </h1>
      </div>

      <div className="max-w-3xl">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Top button bar — Fix 5 */}
          <div className="mb-6 flex justify-end">
            <ActionButtons />
          </div>

          {/* ── Card 1: Campaign Details ──────────────────────────────────── */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Campaign Name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Campaign Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  maxLength={100}
                  required
                  placeholder="Enter campaign name..."
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {campaignName.length}/100 characters
                </p>
              </div>

              {/* Campaign Summary */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Campaign Summary <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={campaignSummary}
                  onChange={(e) => setCampaignSummary(e.target.value)}
                  maxLength={280}
                  required
                  placeholder="Brief campaign summary..."
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {280 - campaignSummary.length} characters remaining
                </p>
              </div>

              {/* Service Type */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Service Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={serviceTypeId}
                  onChange={(e) => setServiceTypeId(e.target.value)}
                  required
                  className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
                >
                  <option value="">Select service type...</option>
                  {activeServiceTypes.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Owner */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Owner <span className="text-red-500">*</span>
                </label>
                <Input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  required
                  placeholder="Campaign owner name..."
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Start Date <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
                {startDate && new Date(startDate) < new Date(new Date().toDateString()) && (
                  <p className="mt-1 text-xs text-amber-600">
                    ⚠ This date is in the past
                  </p>
                )}
              </div>

              {/* Company Size — moved from Targeting to match detail page */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Target Company Size
                </label>
                <select
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
                >
                  <option value="">Select company size...</option>
                  {activeCompanySizes.map((cs) => (
                    <option key={cs.id} value={cs.id}>
                      {cs.label}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* ── Card 2: Propositions (own card — Fix 4) ──────────────────── */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Linked Propositions</CardTitle>
            </CardHeader>
            <CardContent>
              {propositionsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="h-8 rounded bg-gray-200 animate-pulse flex-1" />
                    </div>
                  ))}
                  <p className="text-xs text-[var(--muted)]">Loading propositions…</p>
                </div>
              ) : propositions.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
                  <p className="text-sm text-[var(--muted)]">
                    No propositions defined for this client.{' '}
                    <Link href={`/clients/${clientId}/prospecting-profile`} className="text-[var(--accent-cyan)] hover:underline">
                      Set up Prospecting Profile →
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  {/* Selected proposition pills with expandable ICP detail */}
                  {propositionRefs.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {propositionRefs.map((propId) => {
                        const prop = propositions.find((p) => p.id === propId);
                        if (!prop) return (
                          <div key={propId} className="rounded-lg border border-gray-200 bg-gray-50 p-2 flex items-center justify-between">
                            <span className="text-sm text-[var(--muted)] italic">Unknown proposition ({propId})</span>
                            <button type="button" onClick={() => setPropositionRefs(propositionRefs.filter((id) => id !== propId))} className="text-[var(--muted)] hover:text-red-600">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                        return (
                          <PropositionPill
                            key={propId}
                            proposition={prop}
                            onRemove={() => setPropositionRefs(propositionRefs.filter((id) => id !== propId))}
                            clientId={clientId}
                          />
                        );
                      })}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !propositionRefs.includes(e.target.value)) {
                        setPropositionRefs([...propositionRefs, e.target.value]);
                      }
                      e.target.value = '';
                    }}
                    className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-cyan)]"
                  >
                    <option value="">Add a proposition...</option>
                    {Array.from(new Set(propositions.map((p) => p.category))).map((cat) => (
                      <optgroup key={cat} label={cat || 'Uncategorised'}>
                        {propositions
                          .filter((p) => p.category === cat && !propositionRefs.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </>
              )}
              <p className="mt-1 text-xs text-[var(--muted)]">
                Select from this client&apos;s Prospecting Profile propositions. Click a selected proposition to see its ICP details.
              </p>
              {propositionRefs.length >= 4 && (
                <p className="mt-1 text-xs text-amber-600">
                  ⚠ Campaigns typically focus on 1–2 propositions. A campaign targeting many propositions may need to be split.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Card 3: Targeting ─────────────────────────────────────────── */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Targeting</CardTitle>
              {propositionRefs.length > 0 && (() => {
                const linkedProps = propositions.filter((p) => propositionRefs.includes(p.id));
                const hasDraft = linkedProps.some((p) => p.icpStatus === 'draft' || !p.icpStatus);
                const hasIcp = linkedProps.some((p) => p.icp && (
                  (p.icp.industries?.managedListRefs?.length || 0) > 0 ||
                  (p.icp.titles?.managedListRefs?.length || 0) > 0 ||
                  (p.icp.geographies?.managedListRefs?.length || 0) > 0
                ));
                return hasIcp ? (
                  <p className="text-xs text-[var(--muted)] mt-1">
                    🎯 Targeting options are constrained by the linked proposition{linkedProps.length > 1 ? 's' : ''}&apos; ICP{hasDraft ? '. Some ICPs are in draft — targeting may be incomplete.' : '.'}
                  </p>
                ) : null;
              })()}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Compute merged ICP from linked propositions */}
              {(() => {
                const linkedProps = propositions.filter((p) => propositionRefs.includes(p.id));
                // Merge ICP values across all linked propositions (union)
                const mergedIcp = {
                  geographies: [...new Set(linkedProps.flatMap((p) => (p.icp?.geographies?.managedListRefs || [])))],
                  industries: [...new Set(linkedProps.flatMap((p) => (p.icp?.industries?.managedListRefs || [])))],
                  titles: [...new Set(linkedProps.flatMap((p) => (p.icp?.titles?.managedListRefs || [])))],
                };
                // Filter options: if ICP has values for dimension, constrain; else full list
                const geoOptions = mergedIcp.geographies.length > 0
                  ? (managedLists.geographies || []).filter((o) => mergedIcp.geographies.includes(o.id))
                  : (managedLists.geographies || []);
                const sectorOptions = mergedIcp.industries.length > 0
                  ? (managedLists.sectors || []).filter((o) => mergedIcp.industries.includes(o.id))
                  : (managedLists.sectors || []);
                const titleOptions = mergedIcp.titles.length > 0
                  ? (managedLists.titleBands || []).filter((o) => mergedIcp.titles.includes(o.id))
                  : (managedLists.titleBands || []);
                const isConstrained = propositionRefs.length > 0;
                const propNames = linkedProps.map((p) => p.name).join(', ');
                // Check for out-of-scope values
                const outOfScopeGeo = isConstrained && mergedIcp.geographies.length > 0
                  ? targetGeographies.filter((v) => !mergedIcp.geographies.includes(v))
                  : [];
                const outOfScopeSector = isConstrained && mergedIcp.industries.length > 0
                  ? targetSectors.filter((v) => !mergedIcp.industries.includes(v))
                  : [];
                const outOfScopeTitle = isConstrained && mergedIcp.titles.length > 0
                  ? targetTitles.filter((v) => !mergedIcp.titles.includes(v))
                  : [];

                return (
                  <>
                    <MultiSelectChips
                      label={isConstrained && mergedIcp.geographies.length > 0 ? `Target Geographies (from ${propNames} ICP)` : 'Target Geographies'}
                      options={geoOptions}
                      selected={targetGeographies}
                      onChange={setTargetGeographies}
                    />
                    {outOfScopeGeo.length > 0 && (
                      <p className="text-xs text-amber-600">⚠ {outOfScopeGeo.length} value(s) not in the selected proposition&apos;s ICP</p>
                    )}
                    <MultiSelectChips
                      label={isConstrained && mergedIcp.industries.length > 0 ? `Target Sectors (from ${propNames} ICP)` : 'Target Sectors'}
                      options={sectorOptions}
                      selected={targetSectors}
                      onChange={setTargetSectors}
                    />
                    {outOfScopeSector.length > 0 && (
                      <p className="text-xs text-amber-600">⚠ {outOfScopeSector.length} value(s) not in the selected proposition&apos;s ICP</p>
                    )}
                    <MultiSelectChips
                      label={isConstrained && mergedIcp.titles.length > 0 ? `Target Titles (from ${propNames} ICP)` : 'Target Titles'}
                      options={titleOptions}
                      selected={targetTitles}
                      onChange={setTargetTitles}
                    />
                    {outOfScopeTitle.length > 0 && (
                      <p className="text-xs text-amber-600">⚠ {outOfScopeTitle.length} value(s) not in the selected proposition&apos;s ICP</p>
                    )}
                  </>
                );
              })()}

              {/* Therapy Areas — only when client has therapyAreas capability */}
              {therapyAreaConfig?.enabled && (
                <div>
                  <MultiSelectChips
                    label="Target Therapy Areas"
                    options={therapyAreaConfig.activeAreas}
                    selected={targetTherapyAreas}
                    onChange={setTargetTherapyAreas}
                  />
                  {therapyAreaConfig.conflictedAreas.length > 0 && (
                    <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-red-700">Conflicted therapy areas</p>
                        <p className="text-xs text-red-600">
                          {therapyAreaConfig.conflictedAreas.join(', ')} — avoid targeting these areas for this client.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Card 4: Messaging ─────────────────────────────────────────── */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Messaging</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  Elevator Pitch <span className="text-[var(--muted)] font-normal">(optional)</span>
                </label>
                <Input
                  value={valueProposition}
                  onChange={(e) => setValueProposition(e.target.value)}
                  maxLength={200}
                  placeholder="One-line pitch for this campaign..."
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {200 - valueProposition.length} characters remaining
                </p>
              </div>

              <PainPointsEditor painPoints={painPoints} onChange={setPainPoints} />

              {/* So What Picker */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
                  So Whats <span className="text-[var(--muted)] font-normal">(select from approved library)</span>
                </label>

                {/* Selected So Whats */}
                {selectedSoWhats.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {selectedSoWhats.map((swId) => {
                      const sw = availableSoWhats.find((s) => s.id === swId);
                      if (!sw) return null;
                      return (
                        <div
                          key={swId}
                          className="flex items-start justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{sw.headline}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {sw.audienceTags.map((tag) => {
                                const label = (managedLists.titleBands || []).find((t) => t.id === tag)?.label || tag;
                                return (
                                  <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                    {label}
                                  </span>
                                );
                              })}
                              {sw.orientationTags.map((tag) => {
                                const cfg = SOWHAT_ORIENTATION_CONFIG[tag];
                                return (
                                  <span key={tag} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: cfg.colour, backgroundColor: cfg.bgColour }}>
                                    {cfg.label}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedSoWhats((prev) => prev.filter((id) => id !== swId))}
                            className="shrink-0 text-gray-400 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Picker */}
                {(() => {
                  const unselected = availableSoWhats.filter((sw) => !selectedSoWhats.includes(sw.id));
                  const filtered = soWhatSearch
                    ? unselected.filter((sw) => sw.headline.toLowerCase().includes(soWhatSearch.toLowerCase()))
                    : unselected;

                  if (availableSoWhats.length === 0) {
                    return (
                      <div className="rounded-lg border-2 border-dashed border-gray-200 p-4">
                        <p className="text-sm text-[var(--muted)]">
                          No approved So Whats yet.{' '}
                          <Link href={`/clients/${clientId}/sowhats`} className="text-[var(--primary)] hover:underline">
                            Create and approve So Whats
                          </Link>{' '}
                          in the So What library to select them for campaigns.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div>
                      <Input
                        type="text"
                        value={soWhatSearch}
                        onChange={(e) => setSoWhatSearch(e.target.value)}
                        placeholder="Search So Whats by headline..."
                        className="mb-2 h-8 text-sm"
                      />
                      {filtered.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white">
                          {filtered.map((sw) => (
                            <button
                              key={sw.id}
                              type="button"
                              onClick={() => {
                                setSelectedSoWhats((prev) => [...prev, sw.id]);
                                setSoWhatSearch('');
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                            >
                              <p className="text-sm font-medium text-gray-900 truncate">{sw.headline}</p>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {sw.audienceTags.map((tag) => {
                                  const label = (managedLists.titleBands || []).find((t) => t.id === tag)?.label || tag;
                                  return (
                                    <span key={tag} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                      {label}
                                    </span>
                                  );
                                })}
                                {sw.orientationTags.map((tag) => {
                                  const cfg = SOWHAT_ORIENTATION_CONFIG[tag];
                                  return (
                                    <span key={tag} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ color: cfg.colour, backgroundColor: cfg.bgColour }}>
                                      {cfg.label}
                                    </span>
                                  );
                                })}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--muted)] py-2">
                          {soWhatSearch ? 'No matching So Whats found.' : 'All approved So Whats have been selected.'}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          {/* Bottom button bar */}
          <ActionButtons />
        </form>
      </div>
    </>
  );
}
