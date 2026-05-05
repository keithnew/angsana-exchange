'use client';

/**
 * Angsana Exchange — Targeting Hints Picker v0.1
 *
 * The single parameterised React component reused across six Exchange
 * surfaces — Wishlists, Propositions/ICP, Conflicts, Exclusions,
 * Relationships, Campaigns. Three call modes (catalogue, narrowing,
 * single-target) and two polarity modes (dual, positive) cover the
 * surfaces' shapes (Picker §3, §4).
 *
 * Picker spec citations:
 *   §3   Three call modes (callMode prop).
 *   §4   Two polarity modes (polarityMode prop).
 *   §5   Surface configuration — the picker is configured by the caller
 *        passing call mode, polarity mode, and an availableDimensions
 *        list. The component does not know which surface it is rendered
 *        in (§13.1 containment commitment).
 *   §6   Selection-at-depth (sparse-tree storage, empty-means-all
 *        semantics, except-list narrowing).
 *   §7   Constraint envelope (narrowing-mode availableDimensions is
 *        already the envelope; inheritedExclusions is the non-removable
 *        carryover).
 *   §8   Cluster Layer Amendment §5 honoured — clustered dimensions get
 *        a hierarchical view; unclustered dimensions get a flat one.
 *   §9   The component interface (props + Selection type).
 *   §13  Containment commitments — no surface-aware logic, no
 *        accumulating call modes, lives in Exchange (no @angsana/ui-
 *        baseline promotion in v0.1).
 *
 * Companion: Angsana Platform Dimension Packs v0.1 — the catalogue-mode
 * caller typically resolves availableDimensions through
 * resolveDimensionsForClient (Packs §5.4). The picker itself is not
 * Pack-aware (§11.1: "the helper hides the distinction").
 *
 * v0.1 visual treatment is intentionally minimal — the spec at §14.2
 * defers visual styling beyond `density` to build-time decisions.
 * Adopting surfaces apply Exchange's UI baseline; this component
 * provides the structure and the behaviour, not the aesthetics.
 */

import { useMemo } from 'react';
import type { CallMode, PolarityMode, Selection, SelectionIntent } from './types';

// ─── Display-side dimension shape ──────────────────────────────────────────

/**
 * The minimum dimension shape this component renders. A superset of
 * resolveSelections's CatalogueDimension because the UI also needs
 * human-readable labels.
 *
 * Surfaces typically pass dimensions sourced from the canonical
 * reference store (Capabilities Note §4.6 snapshot) plus, in catalogue
 * mode, filtered through resolveDimensionsForClient (Packs §5.4).
 */
export interface PickerDimension {
  id: string;
  /** Human-readable dimension name. */
  label: string;
  /**
   * Optional clusters (Cluster Layer Amendment §5). When populated the
   * picker renders a hierarchical view; when absent or empty the picker
   * renders a flat value list (§5.1 empty-layer suppression).
   */
  clusters?: PickerCluster[];
  /** All values in the dimension (also enumerated under clusters when present). */
  values: PickerValue[];
}

export interface PickerCluster {
  id: string;
  label: string;
  /** Member value IDs that currently belong to this cluster. */
  valueIds: string[];
}

export interface PickerValue {
  id: string;
  label: string;
}

// ─── Component props (Picker spec §9.1) ────────────────────────────────────

export interface TargetingHintsPickerProps {
  /** Picker §3. */
  callMode: CallMode;
  /** Picker §4. */
  polarityMode: PolarityMode;

  /**
   * The dimensions this picker invocation offers. Resolved by the caller
   * before render (Picker §3 resolution rules; §11.3 caching contract).
   *
   *   - catalogue mode    : typically resolveDimensionsForClient(client).
   *   - narrowing mode    : the envelope (parent selections, intersected
   *                         with the Client's resolved dimensions).
   *   - single-target mode: the surface's typed vocabulary.
   */
  availableDimensions: PickerDimension[];

  /**
   * The current selection (sparse tree per §6). For dual polarity, items
   * carry intent: 'include' | 'exclude'.
   */
  selections: Selection[];

  /** Called when the user changes selections. */
  onSelectionsChange: (selections: Selection[]) => void;

  /**
   * Narrowing mode only — the parent envelope's mandatory exclusions
   * (Picker §7.2). Shown as non-removable items in the selected-tray;
   * the user cannot deselect them.
   */
  inheritedExclusions?: Selection[];

  /** Optional rendering hints. */
  density?: 'compact' | 'comfortable';
}

// ─── Internal selection-mutation helpers ───────────────────────────────────

/**
 * The selection key under which the picker mutates. In dual polarity
 * mode the same dimension can carry independent include and exclude
 * selections (e.g. include-Technology + exclude-Sales-Operations); we
 * key by (dimensionId, intent) to keep them separate.
 */
function selectionKey(dimensionId: string, intent: SelectionIntent | undefined): string {
  return `${dimensionId}::${intent ?? 'none'}`;
}

function findSelection(
  selections: readonly Selection[],
  dimensionId: string,
  intent: SelectionIntent | undefined,
): Selection | undefined {
  return selections.find((s) => selectionKey(s.dimensionId, s.intent) === selectionKey(dimensionId, intent));
}

function replaceOrAppend(
  selections: readonly Selection[],
  next: Selection,
): Selection[] {
  const key = selectionKey(next.dimensionId, next.intent);
  const idx = selections.findIndex((s) => selectionKey(s.dimensionId, s.intent) === key);
  if (idx === -1) return [...selections, next];
  const out = [...selections];
  out[idx] = next;
  return out;
}

function removeSelection(
  selections: readonly Selection[],
  dimensionId: string,
  intent: SelectionIntent | undefined,
): Selection[] {
  const key = selectionKey(dimensionId, intent);
  return selections.filter((s) => selectionKey(s.dimensionId, s.intent) !== key);
}

// ─── Render ────────────────────────────────────────────────────────────────

export function TargetingHintsPicker(props: TargetingHintsPickerProps) {
  const {
    callMode,
    polarityMode,
    availableDimensions,
    selections,
    onSelectionsChange,
    inheritedExclusions = [],
    density = 'comfortable',
  } = props;

  // The default intent for newly-created selections. Dual polarity
  // surfaces start with "include"; positive surfaces carry no intent.
  const defaultIntent: SelectionIntent | undefined =
    polarityMode === 'dual' ? 'include' : undefined;

  const rowGap = density === 'compact' ? 'gap-1' : 'gap-2';
  const sectionPad = density === 'compact' ? 'p-2' : 'p-3';

  // Lookup helpers shared across handlers.
  const inheritedByDimension = useMemo(() => {
    const map = new Map<string, Selection[]>();
    for (const sel of inheritedExclusions) {
      const arr = map.get(sel.dimensionId) ?? [];
      arr.push(sel);
      map.set(sel.dimensionId, arr);
    }
    return map;
  }, [inheritedExclusions]);

  // Toggle a "whole-dimension" pick (empty-means-all per §6.1).
  function toggleWholeDimension(dimensionId: string, intent: SelectionIntent | undefined) {
    const existing = findSelection(selections, dimensionId, intent);
    if (existing && !existing.clusterIds?.length && !existing.valueIds?.length) {
      // Already whole-dimension → remove.
      onSelectionsChange(removeSelection(selections, dimensionId, intent));
      return;
    }
    onSelectionsChange(
      replaceOrAppend(selections, {
        dimensionId,
        ...(intent ? { intent } : {}),
      }),
    );
  }

  // Toggle a single value within a dimension. Distinguishes the two
  // narrowing paths (§6.3): if a cluster commitment is in place, this
  // toggles into excludeValueIds; otherwise it toggles into valueIds.
  function toggleValue(
    dim: PickerDimension,
    valueId: string,
    intent: SelectionIntent | undefined,
  ) {
    const existing = findSelection(selections, dim.id, intent);
    const clusterCommitted = !!existing?.clusterIds?.length;

    if (!existing) {
      // First pick within this dimension under this polarity → enumerated.
      onSelectionsChange(
        replaceOrAppend(selections, {
          dimensionId: dim.id,
          valueIds: [valueId],
          ...(intent ? { intent } : {}),
        }),
      );
      return;
    }

    if (clusterCommitted) {
      // §6.3 except-list narrowing — toggle membership in excludeValueIds.
      const current = existing.excludeValueIds ?? [];
      const has = current.includes(valueId);
      const next = has ? current.filter((v) => v !== valueId) : [...current, valueId];
      onSelectionsChange(
        replaceOrAppend(selections, {
          ...existing,
          excludeValueIds: next.length > 0 ? next : undefined,
        }),
      );
      return;
    }

    // Enumerated path — toggle membership in valueIds.
    const current = existing.valueIds ?? [];
    const has = current.includes(valueId);
    const next = has ? current.filter((v) => v !== valueId) : [...current, valueId];
    if (next.length === 0) {
      onSelectionsChange(removeSelection(selections, dim.id, intent));
    } else {
      onSelectionsChange(
        replaceOrAppend(selections, {
          ...existing,
          valueIds: next,
        }),
      );
    }
  }

  // Toggle a cluster pick. Clusters commit to their member values plus
  // any future-additions (§6.2); the storage shape is `clusterIds`.
  function toggleCluster(
    dim: PickerDimension,
    clusterId: string,
    intent: SelectionIntent | undefined,
  ) {
    const existing = findSelection(selections, dim.id, intent);
    const current = existing?.clusterIds ?? [];
    const has = current.includes(clusterId);
    const next = has ? current.filter((c) => c !== clusterId) : [...current, clusterId];

    if (!existing) {
      onSelectionsChange(
        replaceOrAppend(selections, {
          dimensionId: dim.id,
          clusterIds: next,
          ...(intent ? { intent } : {}),
        }),
      );
      return;
    }

    // If the user has just emptied the cluster set and there are no
    // valueIds either, drop the selection entirely (§6.1: empty at any
    // level reverts to "all", but that is only meaningful as an
    // explicit whole-dimension pick — leaving behind an empty selection
    // would be ambiguous).
    if (next.length === 0 && !existing.valueIds?.length) {
      onSelectionsChange(removeSelection(selections, dim.id, intent));
      return;
    }

    onSelectionsChange(
      replaceOrAppend(selections, {
        ...existing,
        clusterIds: next.length > 0 ? next : undefined,
      }),
    );
  }

  // Set the intent (Include / Exclude) on a selection. Dual mode only.
  function setIntent(
    dimensionId: string,
    fromIntent: SelectionIntent | undefined,
    toIntent: SelectionIntent,
  ) {
    if (fromIntent === toIntent) return;
    const existing = findSelection(selections, dimensionId, fromIntent);
    if (!existing) return;
    // Re-key the selection under its new intent. If a selection at the
    // target intent already exists, replace it (the user's last action
    // wins).
    let next = removeSelection(selections, dimensionId, fromIntent);
    next = removeSelection(next, dimensionId, toIntent);
    next = [...next, { ...existing, intent: toIntent }];
    onSelectionsChange(next);
  }

  if (availableDimensions.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic" data-testid="targeting-hints-picker-empty">
        No targeting dimensions available for this Client.
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col ${density === 'compact' ? 'gap-2' : 'gap-3'}`}
      data-testid="targeting-hints-picker"
      data-call-mode={callMode}
      data-polarity-mode={polarityMode}
    >
      {availableDimensions.map((dim) => {
        const includeSel = findSelection(selections, dim.id, polarityMode === 'dual' ? 'include' : undefined);
        const excludeSel = polarityMode === 'dual' ? findSelection(selections, dim.id, 'exclude') : undefined;
        const inheritedForDim = inheritedByDimension.get(dim.id) ?? [];

        return (
          <section
            key={dim.id}
            className={`border border-gray-200 rounded-md ${sectionPad}`}
            data-testid={`picker-dimension-${dim.id}`}
          >
            <header className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">{dim.label}</h3>
              {polarityMode === 'dual' && (
                <DualPolarityToggle
                  dimensionId={dim.id}
                  includeActive={!!includeSel}
                  excludeActive={!!excludeSel}
                  onToggleInclude={() =>
                    includeSel
                      ? toggleWholeDimension(dim.id, 'include')
                      : toggleWholeDimension(dim.id, 'include')
                  }
                  onToggleExclude={() =>
                    excludeSel
                      ? toggleWholeDimension(dim.id, 'exclude')
                      : toggleWholeDimension(dim.id, 'exclude')
                  }
                  onPromote={(from, to) => setIntent(dim.id, from, to)}
                />
              )}
            </header>

            {/* Inherited (non-removable) exclusions in narrowing mode (§7.2). */}
            {inheritedForDim.length > 0 && (
              <div className="mb-2 text-xs text-gray-600">
                Inherited from parent (cannot be deselected):
                <ul className="list-disc list-inside">
                  {inheritedForDim.map((sel, i) => (
                    <li key={`${sel.dimensionId}-${i}`} data-testid="inherited-exclusion">
                      {describeInheritedSelection(sel, dim)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DimensionBody
              dim={dim}
              rowGap={rowGap}
              activeSelection={polarityMode === 'dual' ? includeSel ?? excludeSel : includeSel}
              activeIntent={
                polarityMode === 'dual'
                  ? includeSel
                    ? 'include'
                    : excludeSel
                      ? 'exclude'
                      : defaultIntent
                  : undefined
              }
              onToggleWhole={(intent) => toggleWholeDimension(dim.id, intent)}
              onToggleCluster={(clusterId, intent) => toggleCluster(dim, clusterId, intent)}
              onToggleValue={(valueId, intent) => toggleValue(dim, valueId, intent)}
              defaultIntent={defaultIntent}
            />
          </section>
        );
      })}
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

interface DualPolarityToggleProps {
  dimensionId: string;
  includeActive: boolean;
  excludeActive: boolean;
  onToggleInclude: () => void;
  onToggleExclude: () => void;
  /** Move an existing selection from one polarity to another. */
  onPromote: (from: SelectionIntent | undefined, to: SelectionIntent) => void;
}

function DualPolarityToggle({
  dimensionId,
  includeActive,
  excludeActive,
  onToggleInclude,
  onToggleExclude,
  onPromote,
}: DualPolarityToggleProps) {
  return (
    <div className="flex items-center gap-1" data-testid={`polarity-toggle-${dimensionId}`}>
      <button
        type="button"
        className={`text-xs px-2 py-0.5 rounded border ${
          includeActive ? 'bg-emerald-100 border-emerald-400' : 'bg-white border-gray-300'
        }`}
        onClick={() => {
          if (excludeActive && !includeActive) {
            onPromote('exclude', 'include');
          } else {
            onToggleInclude();
          }
        }}
        data-intent="include"
      >
        Include
      </button>
      <button
        type="button"
        className={`text-xs px-2 py-0.5 rounded border ${
          excludeActive ? 'bg-rose-100 border-rose-400' : 'bg-white border-gray-300'
        }`}
        onClick={() => {
          if (includeActive && !excludeActive) {
            onPromote('include', 'exclude');
          } else {
            onToggleExclude();
          }
        }}
        data-intent="exclude"
      >
        Exclude
      </button>
    </div>
  );
}

interface DimensionBodyProps {
  dim: PickerDimension;
  rowGap: string;
  activeSelection: Selection | undefined;
  activeIntent: SelectionIntent | undefined;
  onToggleWhole: (intent: SelectionIntent | undefined) => void;
  onToggleCluster: (clusterId: string, intent: SelectionIntent | undefined) => void;
  onToggleValue: (valueId: string, intent: SelectionIntent | undefined) => void;
  defaultIntent: SelectionIntent | undefined;
}

function DimensionBody({
  dim,
  rowGap,
  activeSelection,
  activeIntent,
  onToggleWhole,
  onToggleCluster,
  onToggleValue,
  defaultIntent,
}: DimensionBodyProps) {
  const intent = activeIntent ?? defaultIntent;
  const wholeChecked =
    !!activeSelection && !activeSelection.clusterIds?.length && !activeSelection.valueIds?.length;

  // Cluster Layer Amendment §5.1: empty-layer suppression. When the
  // dimension has no clusters, render a flat value list.
  const hasClusters = (dim.clusters ?? []).length > 0;

  return (
    <div className={`flex flex-col ${rowGap}`}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wholeChecked}
          onChange={() => onToggleWhole(intent)}
          data-testid={`whole-${dim.id}`}
        />
        <span>All {dim.label}</span>
      </label>

      {hasClusters
        ? (dim.clusters ?? []).map((cluster) => {
            const clusterChecked = !!activeSelection?.clusterIds?.includes(cluster.id);
            return (
              <details
                key={cluster.id}
                className="ml-4"
                open={clusterChecked || (activeSelection?.valueIds ?? []).some((v) => cluster.valueIds.includes(v))}
              >
                <summary className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clusterChecked}
                    onChange={() => onToggleCluster(cluster.id, intent)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`cluster-${dim.id}-${cluster.id}`}
                  />
                  <span>{cluster.label}</span>
                </summary>
                <div className={`flex flex-col ${rowGap} ml-6 mt-1`}>
                  {cluster.valueIds.map((valueId) => {
                    const valueLabel = dim.values.find((v) => v.id === valueId)?.label ?? valueId;
                    return renderValueCheckbox(
                      dim,
                      valueId,
                      valueLabel,
                      activeSelection,
                      intent,
                      clusterChecked,
                      onToggleValue,
                    );
                  })}
                </div>
              </details>
            );
          })
        : (
          <div className={`flex flex-col ${rowGap} ml-4`}>
            {dim.values.map((v) =>
              renderValueCheckbox(dim, v.id, v.label, activeSelection, intent, false, onToggleValue),
            )}
          </div>
        )}
    </div>
  );
}

function renderValueCheckbox(
  dim: PickerDimension,
  valueId: string,
  label: string,
  activeSelection: Selection | undefined,
  intent: SelectionIntent | undefined,
  clusterCommitted: boolean,
  onToggleValue: (valueId: string, intent: SelectionIntent | undefined) => void,
) {
  let checked: boolean;
  if (clusterCommitted) {
    // Cluster commitment: value is included unless it appears on the except-list.
    checked = !(activeSelection?.excludeValueIds ?? []).includes(valueId);
  } else if (activeSelection?.valueIds?.length) {
    checked = activeSelection.valueIds.includes(valueId);
  } else if (activeSelection && !activeSelection.clusterIds?.length) {
    // Whole-dimension pick: every value is implicitly checked (§6.1).
    checked = true;
  } else {
    checked = false;
  }

  return (
    <label key={valueId} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggleValue(valueId, intent)}
        data-testid={`value-${dim.id}-${valueId}`}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Best-effort label for an inherited exclusion shown in the inherited
 * tray (§7.2). Picker spec settles the storage shape but leaves the
 * exact rendering for build-time decisions; this renders a compact
 * description that callers can swap out later if needed.
 */
function describeInheritedSelection(sel: Selection, dim: PickerDimension): string {
  if (sel.valueIds?.length) {
    const labels = sel.valueIds.map((id) => dim.values.find((v) => v.id === id)?.label ?? id);
    return `${dim.label}: ${labels.join(', ')}`;
  }
  if (sel.clusterIds?.length) {
    const labels = sel.clusterIds.map(
      (id) => (dim.clusters ?? []).find((c) => c.id === id)?.label ?? id,
    );
    return `${dim.label}: ${labels.join(', ')}`;
  }
  return `All ${dim.label}`;
}
