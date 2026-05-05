/**
 * Angsana Exchange — Targeting Hints Picker v0.1: resolveSelections helper
 *
 * Picker spec §10.2:
 *
 *   resolveSelections(selections, catalogue) → ResolvedSelection
 *
 * Takes the stored sparse-tree selections and the current catalogue
 * snapshot, applies the empty-means-all rule recursively (§6.1), applies
 * any except-lists (§6.3), and returns the concrete dimensions / values
 * currently included.
 *
 * For dual-polarity selections the resolved output carries Include and
 * Exclude sets separately; the caller decides how to combine them
 * (a Refinery query would subtract exclude from include; a UI showing
 * the selection would show both — Picker §10.2).
 *
 * Resolution is read-time idempotent: the same selections resolved against
 * the same catalogue snapshot always produce the same resolved output.
 * Caching of resolution results, where needed, is a caller concern.
 *
 * Future-additions semantics (Picker §6.2): a whole-set selection
 * automatically includes future curatorial additions because resolution
 * happens at read time against the latest catalogue snapshot, not pinned
 * to the selection's creation time.
 */

import type {
  ResolvedSelection,
  ResolvedSelectionByDimension,
  Selection,
} from './types';

/**
 * The minimum catalogue shape this helper needs to resolve a selection
 * into concrete value IDs. Mirrors the cluster-aware structure described
 * by Cluster Layer Amendment §5: a dimension has values, and may
 * optionally have clusters that group those values.
 *
 * Surfaces wishing to pass richer shapes can extend; the helper only
 * reads the fields named here.
 */
export interface CatalogueDimension {
  /** Dimension document id. */
  id: string;
  /**
   * Optional cluster layer (Cluster Layer Amendment §5). Empty/absent →
   * dimension has no clusters and the picker presents values directly.
   */
  clusters?: CatalogueCluster[];
  /**
   * The dimension's values. Always present (even when clusters exist —
   * the values are also enumerated here so resolution can produce the
   * "all values in the dimension" answer without a further reverse
   * lookup).
   */
  values: CatalogueValue[];
}

export interface CatalogueCluster {
  /** Cluster document id. */
  id: string;
  /**
   * Member value IDs that currently belong to this cluster. Cluster
   * membership is data, not code — Cluster Layer §5.4 commits that
   * membership changes propagate through the future-additions
   * semantics in Picker §6.2.
   */
  valueIds: string[];
}

export interface CatalogueValue {
  /** Value document id. */
  id: string;
}

/**
 * Resolve sparse-tree selections to concrete value IDs.
 *
 * @param selections  Stored selections (sparse-tree shape per §6).
 * @param catalogue   Pre-fetched catalogue snapshot keyed by dimension
 *                    id. Caller is responsible for fetching once per
 *                    unit of work (Capabilities Note §4.6).
 * @returns           Include and Exclude resolved sets. For positive-
 *                    polarity callers, only `include` is populated.
 */
export function resolveSelections(
  selections: readonly Selection[],
  catalogue: Readonly<Record<string, CatalogueDimension>>,
): ResolvedSelection {
  const include: ResolvedSelectionByDimension = {};
  const exclude: ResolvedSelectionByDimension = {};

  for (const sel of selections) {
    const dim = catalogue[sel.dimensionId];
    // Defensive: a selection referring to a dimension no longer in the
    // catalogue resolves to an empty set rather than throwing. This
    // mirrors the Picker's Reference Data caching contract (§4.6) —
    // bounded-lifetime invalidation means callers may briefly see
    // selections whose dimension has been retired between snapshots.
    if (!dim) continue;

    const resolved = resolveOne(sel, dim);
    const target = sel.intent === 'exclude' ? exclude : include;
    // Multiple selections may target the same dimension (e.g. a dual-
    // polarity surface picking both include and exclude in the same
    // dimension). Union their resolved sets.
    const existing = target[sel.dimensionId] ?? [];
    const merged = unionPreservingOrder(existing, resolved);
    target[sel.dimensionId] = merged;
  }

  return { include, exclude };
}

/**
 * Resolve a single Selection into the concrete list of value IDs it
 * picks out within its dimension. Applies, in order:
 *
 *   1. Pick the relevant value pool: if `clusterIds` is non-empty,
 *      union the named clusters' member values. Otherwise the pool is
 *      every value in the dimension (empty-means-all per §6.1).
 *   2. If `valueIds` is non-empty, intersect the pool with that set
 *      (enumerated subset — the §6.4 "exactly Claude/Gemini/Llama"
 *      example).
 *   3. If `excludeValueIds` is non-empty, subtract those from the pool
 *      (except-list narrowing — §6.3).
 */
function resolveOne(sel: Selection, dim: CatalogueDimension): string[] {
  // ── Step 1: pool ────────────────────────────────────────────────────
  let pool: string[];
  if (sel.clusterIds && sel.clusterIds.length > 0 && dim.clusters) {
    const wantedClusters = new Set(sel.clusterIds);
    pool = [];
    const seen = new Set<string>();
    for (const cluster of dim.clusters) {
      if (!wantedClusters.has(cluster.id)) continue;
      for (const valueId of cluster.valueIds) {
        if (seen.has(valueId)) continue;
        seen.add(valueId);
        pool.push(valueId);
      }
    }
  } else {
    // Empty/absent cluster selection → all values in the dimension.
    // (For unclustered dimensions, the §6.1 rule skips the cluster
    // level — same result via the same code path.)
    pool = dim.values.map((v) => v.id);
  }

  // ── Step 2: enumerated subset ──────────────────────────────────────
  if (sel.valueIds && sel.valueIds.length > 0) {
    const wanted = new Set(sel.valueIds);
    pool = pool.filter((id) => wanted.has(id));
  }

  // ── Step 3: except-list narrowing (Picker §6.3) ────────────────────
  if (sel.excludeValueIds && sel.excludeValueIds.length > 0) {
    const excluded = new Set(sel.excludeValueIds);
    pool = pool.filter((id) => !excluded.has(id));
  }

  return pool;
}

/**
 * Union two arrays preserving the order of first appearance. Used when
 * multiple selections target the same dimension under the same polarity
 * — the resolved set is the union, but we keep order so snapshot tests
 * are deterministic.
 */
function unionPreservingOrder(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of a) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of b) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
