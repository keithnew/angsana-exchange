'use client';

// =============================================================================
// WishlistForm — R2 schema (per spec §3, §7).
//
// Two modes:
//   - mode="create" — POSTs to /api/clients/{clientId}/wishlists
//   - mode="edit"   — PUTs   to /api/clients/{clientId}/wishlists/{wishlistId}
//
// Field set (R2):
//   • Company (companyName + companyRef.type='candidate' on create, since
//     SF Account match resolution lands with Refinery integration — spec §3.1)
//   • Priority  (high/medium/low)
//   • Status    (visible only to internal users — spec §3.6)
//   • Source    (with conditional sourceDetail when source ∈ {conference-list,
//     industry-event, other} — spec §3.5)
//   • Targeting hints (controlled vocabulary picker — spec §3.4 + §7.2)
//   • Campaigns (pill picker; internal-only — spec §3.6)
//
// `availableTargetingHints`, `availableCampaigns`, `currentUserRole` are
// passed in from the parent — this form does not fetch reference data on
// its own. That keeps it testable in isolation and avoids two components
// fighting over the same reference fetch.
//
// On submit success the form calls onSaved() and resets (create mode) or
// closes (edit mode). On submit error the API error is rendered inline.
// =============================================================================

import { useState, useMemo } from 'react';
import {
  SOURCES_REQUIRING_DETAIL,
  TARGETING_HINT_TYPE_CONFIG,
  TARGETING_HINT_TYPES,
  WISHLIST_PRIORITY_R2_CONFIG,
  WISHLIST_SOURCE_CONFIG,
  WISHLIST_STATUS_R2_CONFIG,
  type CompanyRef,
  type TargetingHint,
  type WishlistEntryWire,
  type WishlistPriority,
  type WishlistSource,
  type WishlistStatus,
} from '@/types/wishlist';

// ─── Props ──────────────────────────────────────────────────────────────────

export type WishlistFormMode = 'create' | 'edit';

export type WishlistFormRole = 'internal-admin' | 'internal-user' | 'client-approver' | 'client-viewer';

export interface WishlistFormCampaign {
  id: string;
  name: string;
}

export interface WishlistFormProps {
  mode: WishlistFormMode;
  clientId: string;
  /** Required in edit mode; ignored in create mode. */
  initialEntry?: WishlistEntryWire | null;
  currentUserRole: WishlistFormRole;
  /**
   * Reference data passed in from the parent. The parent is responsible
   * for fetching managed lists / campaigns and constraining what's available
   * (e.g. only showing campaigns the user has access to).
   */
  availableTargetingHints: TargetingHint[];
  availableCampaigns: WishlistFormCampaign[];
  /** Called on successful save. Receives the wishlistId (server-assigned in create mode). */
  onSaved: (wishlistId: string) => void;
  /** Called when user clicks Cancel. */
  onCancel: () => void;
}

// ─── Internal form state ────────────────────────────────────────────────────

interface FormState {
  companyName: string;
  priority: WishlistPriority;
  status: WishlistStatus;
  source: WishlistSource;
  sourceDetail: string;
  targetingHints: TargetingHint[];
  campaignRefs: string[];
}

const EMPTY_STATE: FormState = {
  companyName: '',
  priority: 'medium',
  status: 'new',
  source: 'client-request',
  sourceDetail: '',
  targetingHints: [],
  campaignRefs: [],
};

function fromEntry(e: WishlistEntryWire): FormState {
  return {
    companyName: e.companyName ?? '',
    priority: e.priority,
    status: e.status,
    source: e.source,
    sourceDetail: e.sourceDetail ?? '',
    targetingHints: e.targetingHints ?? [],
    campaignRefs: e.campaignRefs ?? [],
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function WishlistForm({
  mode,
  clientId,
  initialEntry,
  currentUserRole,
  availableTargetingHints,
  availableCampaigns,
  onSaved,
  onCancel,
}: WishlistFormProps) {
  const [state, setState] = useState<FormState>(() =>
    mode === 'edit' && initialEntry ? fromEntry(initialEntry) : EMPTY_STATE
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInternal =
    currentUserRole === 'internal-admin' || currentUserRole === 'internal-user';
  const canEditStatus = isInternal;
  const canEditCampaignRefs = isInternal;

  const hintsByType = useMemo(() => {
    const grouped: Record<TargetingHint['type'], TargetingHint[]> = {
      'therapy-area': [],
      sector: [],
      geography: [],
      'service-type': [],
    };
    for (const h of availableTargetingHints) grouped[h.type].push(h);
    return grouped;
  }, [availableTargetingHints]);

  const sourceRequiresDetail = SOURCES_REQUIRING_DETAIL.includes(state.source);

  // ─── Validation ──────────────────────────────────────────────────────
  function validate(): string | null {
    if (!state.companyName.trim()) return 'Company name is required.';
    if (state.companyName.length > 200) return 'Company name must be ≤200 characters.';
    if (sourceRequiresDetail && !state.sourceDetail.trim()) {
      return `Source detail is required when source is "${WISHLIST_SOURCE_CONFIG[state.source].label}".`;
    }
    if (state.targetingHints.length > 12) return 'Maximum of 12 targeting hints.';
    return null;
  }

  // ─── Submit ──────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationErr = validate();
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setSubmitting(true);
    try {
      // Build wire payload.
      // For create: the API creates a `companyRef: { type: 'candidate' }`
      // because SF resolution is a future slice. The wishlistForm doesn't
      // resolve the ref itself — the API does (spec §3.1).
      const payload: Record<string, unknown> = {
        companyName: state.companyName.trim(),
        priority: state.priority,
        source: state.source,
        sourceDetail: sourceRequiresDetail ? state.sourceDetail.trim() : null,
        targetingHints: state.targetingHints,
      };
      if (canEditStatus) payload.status = state.status;
      if (canEditCampaignRefs) payload.campaignRefs = state.campaignRefs;

      // Preserve existing companyRef on edit; do not overwrite an existing
      // SF-resolved ref. The API uses `candidate` for any net-new company
      // entered through this form (spec §3.1 — resolution is async).
      if (mode === 'edit' && initialEntry?.companyRef) {
        payload.companyRef = initialEntry.companyRef as CompanyRef;
      }

      const url =
        mode === 'create'
          ? `/api/clients/${clientId}/wishlists`
          : `/api/clients/${clientId}/wishlists/${initialEntry!.wishlistId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
        setError(errorBody.error ?? 'Save failed.');
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      const wishlistId =
        mode === 'create' ? data.wishlistId ?? data.entry?.wishlistId : initialEntry!.wishlistId;

      // Reset on create so the form is ready for the next entry; the parent
      // can decide whether to keep it open.
      if (mode === 'create') setState(EMPTY_STATE);
      onSaved(wishlistId);
    } catch (err) {
      setError((err as Error).message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Company name */}
      <div>
        <label className="block text-sm font-medium mb-1">Company name *</label>
        <input
          type="text"
          value={state.companyName}
          onChange={(e) => setState((s) => ({ ...s, companyName: e.target.value }))}
          placeholder="e.g. Acme Pharma"
          className="w-full border rounded px-3 py-2"
          maxLength={200}
          required
        />
      </div>

      {/* Priority */}
      <div>
        <label className="block text-sm font-medium mb-1">Priority *</label>
        <div className="flex gap-2">
          {(Object.keys(WISHLIST_PRIORITY_R2_CONFIG) as WishlistPriority[]).map((p) => {
            const cfg = WISHLIST_PRIORITY_R2_CONFIG[p];
            const selected = state.priority === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setState((s) => ({ ...s, priority: p }))}
                className="px-3 py-1 rounded border text-sm"
                style={{
                  borderColor: selected ? cfg.colour : '#E5E7EB',
                  backgroundColor: selected ? cfg.bgColour : 'transparent',
                  color: selected ? cfg.colour : '#374151',
                  fontWeight: selected ? 600 : 400,
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status — internal-only */}
      {canEditStatus && (
        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select
            value={state.status}
            onChange={(e) => setState((s) => ({ ...s, status: e.target.value as WishlistStatus }))}
            className="w-full border rounded px-3 py-2"
          >
            {(Object.keys(WISHLIST_STATUS_R2_CONFIG) as WishlistStatus[]).map((st) => (
              <option key={st} value={st}>
                {WISHLIST_STATUS_R2_CONFIG[st].label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Source */}
      <div>
        <label className="block text-sm font-medium mb-1">Source *</label>
        <select
          value={state.source}
          onChange={(e) => setState((s) => ({ ...s, source: e.target.value as WishlistSource }))}
          className="w-full border rounded px-3 py-2"
        >
          {(Object.keys(WISHLIST_SOURCE_CONFIG) as WishlistSource[]).map((src) => (
            <option key={src} value={src}>
              {WISHLIST_SOURCE_CONFIG[src].label}
            </option>
          ))}
        </select>
      </div>

      {/* Source detail — conditional */}
      {sourceRequiresDetail && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Source detail *{' '}
            <span className="text-xs text-gray-500">(e.g. conference name, event name)</span>
          </label>
          <input
            type="text"
            value={state.sourceDetail}
            onChange={(e) => setState((s) => ({ ...s, sourceDetail: e.target.value }))}
            className="w-full border rounded px-3 py-2"
            maxLength={200}
            required
          />
        </div>
      )}

      {/* Targeting hints */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Targeting hints{' '}
          <span className="text-xs text-gray-500">
            (max 12; selected: {state.targetingHints.length})
          </span>
        </label>
        <div className="space-y-2">
          {TARGETING_HINT_TYPES.map((t) => {
            const cfg = TARGETING_HINT_TYPE_CONFIG[t];
            const hints = hintsByType[t];
            if (hints.length === 0) return null;
            return (
              <div key={t}>
                <div className="text-xs font-medium mb-1" style={{ color: cfg.colour }}>
                  {cfg.label}
                </div>
                <div className="flex flex-wrap gap-1">
                  {hints.map((h) => {
                    const selected = state.targetingHints.some(
                      (x) =>
                        x.type === h.type && x.managedListRef.itemId === h.managedListRef.itemId
                    );
                    return (
                      <button
                        key={`${h.type}:${h.managedListRef.itemId}`}
                        type="button"
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            targetingHints: selected
                              ? s.targetingHints.filter(
                                  (x) =>
                                    !(
                                      x.type === h.type &&
                                      x.managedListRef.itemId === h.managedListRef.itemId
                                    )
                                )
                              : s.targetingHints.length < 12
                                ? [...s.targetingHints, h]
                                : s.targetingHints,
                          }));
                        }}
                        className="px-2 py-0.5 rounded text-xs border"
                        style={{
                          borderColor: selected ? cfg.colour : '#E5E7EB',
                          backgroundColor: selected ? cfg.bgColour : 'transparent',
                          color: selected ? cfg.colour : '#374151',
                          fontWeight: selected ? 600 : 400,
                        }}
                      >
                        {h.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Campaigns — internal-only */}
      {canEditCampaignRefs && availableCampaigns.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Campaigns</label>
          <div className="flex flex-wrap gap-1">
            {availableCampaigns.map((c) => {
              const selected = state.campaignRefs.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setState((s) => ({
                      ...s,
                      campaignRefs: selected
                        ? s.campaignRefs.filter((x) => x !== c.id)
                        : [...s.campaignRefs, c.id],
                    }));
                  }}
                  className="px-2 py-0.5 rounded text-xs border"
                  style={{
                    borderColor: selected ? '#2563EB' : '#E5E7EB',
                    backgroundColor: selected ? '#EFF6FF' : 'transparent',
                    color: selected ? '#2563EB' : '#374151',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 rounded border text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          {submitting ? 'Saving…' : mode === 'create' ? 'Add to wishlist' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
