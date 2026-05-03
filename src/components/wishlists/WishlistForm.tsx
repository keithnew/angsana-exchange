'use client';

// =============================================================================
// WishlistForm — R2 schema (per spec §3, §7), v0.2 slice updates per
// docs/architecture/r2-pvs-s1-wishlists-v0_2-spec.md.
//
// Two modes:
//   - mode="create" — POSTs to /api/clients/{clientId}/wishlists
//   - mode="edit"   — PUTs   to /api/clients/{clientId}/wishlists/{wishlistId}
//
// Field set (post-v0.2):
//   • Company (companyName + companyRef.type='candidate' on create, since
//     SF Account match resolution lands with Refinery integration — spec §3.1)
//   • Website (free-form URL, optional — v0.2 §2.2)
//   • Priority  (high/medium/low)
//   • Status    (visible only to internal users — spec §3.6)
//   • Targeting hints (controlled vocabulary picker — spec §3.4 + §7.2)
//   • Campaigns (pill picker; internal-only — spec §3.6)
//   • Research Assistant context (internal-only free text — v0.2 §2.3,
//     reserved for future RA integration; not consumed yet)
//
// REMOVED in v0.2:
//   • Source dropdown — see v0.2 spec §2.1. Schema column retained per
//     supersession discipline; the API now defaults new entries to
//     'unspecified'. Existing source values on edited entries are
//     preserved untouched (the form simply doesn't send the field).
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
  TARGETING_HINT_TYPE_CONFIG,
  TARGETING_HINT_TYPES,
  WISHLIST_PRIORITY_R2_CONFIG,
  WISHLIST_STATUS_R2_CONFIG,
  type CompanyRef,
  type TargetingHint,
  type WishlistEntryWire,
  type WishlistPriority,
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
  /** v0.2 §2.2 — free-form URL string. Empty means unset. */
  website: string;
  priority: WishlistPriority;
  status: WishlistStatus;
  targetingHints: TargetingHint[];
  campaignRefs: string[];
  /** v0.2 §2.3 — internal-only free-text. Empty means unset. */
  researchAssistantContext: string;
}

const EMPTY_STATE: FormState = {
  companyName: '',
  website: '',
  priority: 'medium',
  status: 'new',
  targetingHints: [],
  campaignRefs: [],
  researchAssistantContext: '',
};

function fromEntry(e: WishlistEntryWire): FormState {
  return {
    companyName: e.companyName ?? '',
    website: e.website ?? '',
    priority: e.priority,
    status: e.status,
    targetingHints: e.targetingHints ?? [],
    campaignRefs: e.campaignRefs ?? [],
    researchAssistantContext: e.researchAssistantContext ?? '',
  };
}

/**
 * Lightweight client-side URL well-formedness check, mirroring the API.
 * Returns true for empty (treated as unset). The server is the source of
 * truth — this is just so we can show inline feedback before submit.
 */
function isWellFormedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    new URL(trimmed);
    return true;
  } catch {
    try {
      new URL(`https://${trimmed}`);
      return true;
    } catch {
      return false;
    }
  }
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
  // v0.2 §2.3: researchAssistantContext is exposed in the form to internal
  // users only. The server enforces the same rule (defence in depth).
  const canEditResearchAssistantContext = isInternal;

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

  // ─── Validation ──────────────────────────────────────────────────────
  function validate(): string | null {
    if (!state.companyName.trim()) return 'Company name is required.';
    if (state.companyName.length > 200) return 'Company name must be ≤200 characters.';
    if (state.website.trim() && !isWellFormedUrl(state.website)) {
      return 'Website must be a parseable URL (or left empty).';
    }
    if (state.website.length > 500) {
      return 'Website must be ≤500 characters.';
    }
    if (state.targetingHints.length > 12) return 'Maximum of 12 targeting hints.';
    if (state.researchAssistantContext.length > 2000) {
      return 'Research Assistant context must be ≤2000 characters.';
    }
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
      //
      // Per v0.2 spec §2.1, the form does NOT send `source`. The server
      // defaults new entries to 'unspecified'; on edits the existing
      // source value is preserved untouched because we omit the field
      // from the PUT body.
      const payload: Record<string, unknown> = {
        companyName: state.companyName.trim(),
        website: state.website.trim() || null,
        priority: state.priority,
        targetingHints: state.targetingHints,
      };
      if (canEditStatus) payload.status = state.status;
      if (canEditCampaignRefs) payload.campaignRefs = state.campaignRefs;
      if (canEditResearchAssistantContext) {
        payload.researchAssistantContext =
          state.researchAssistantContext.trim() || null;
      }

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

      {/* Website — v0.2 §2.2. Placed near the company-identifying fields per
          spec; helps disambiguate companies sharing a name and improves the
          downstream Salesforce match. */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Website{' '}
          <span className="text-xs text-gray-500 font-normal">
            (optional — helps identify the right company)
          </span>
        </label>
        <input
          type="url"
          value={state.website}
          onChange={(e) => setState((s) => ({ ...s, website: e.target.value }))}
          placeholder="e.g. https://acme.com"
          className="w-full border rounded px-3 py-2"
          maxLength={500}
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

      {/* Source field intentionally omitted — see v0.2 spec §2.1.
          Provenance is captured by addedBy/addedAt; intent goes in Discussion;
          internal classifications (migration, ai-suggestion) are set by
          system, not by user. New entries default to source='unspecified'
          server-side. */}

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

      {/* Research Assistant context — v0.2 §2.3. Internal-only. Reserved
          field; not consumed by the RA pipeline yet. Surfaced now so the
          data substrate is in place when the productisation answer lands. */}
      {canEditResearchAssistantContext && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Research Assistant context{' '}
            <span className="text-xs text-gray-500 font-normal">
              (internal only — context for future RA queries)
            </span>
          </label>
          <textarea
            value={state.researchAssistantContext}
            onChange={(e) =>
              setState((s) => ({ ...s, researchAssistantContext: e.target.value }))
            }
            placeholder="e.g. focus on UK subsidiaries; prior interest in their oncology pipeline"
            className="w-full border rounded px-3 py-2 text-sm"
            rows={3}
            maxLength={2000}
          />
          <p className="text-xs text-gray-500 mt-1">
            Reserved for future Research Assistant integration. Not visible to
            client users.
          </p>
        </div>
      )}

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
