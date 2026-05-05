/**
 * Angsana Exchange — Targeting Hints Picker v0.1: types
 *
 * The Selection[] storage shape and surrounding type aliases per Picker
 * spec §9. The Selection type is the entire storage shape: the component
 * does not store derived information, and resolution to concrete
 * dimensions/clusters/values is done at read time by callers
 * (resolveSelections in ./resolveSelections.ts).
 *
 * Types kept in their own module so non-component callers (API routes,
 * persistence adapters, server actions) can import them without dragging
 * in React. The picker spec at §9 names this as a structural concern.
 */

/** Picker spec §3 — three call modes. */
export type CallMode = 'catalogue' | 'narrowing' | 'single-target';

/** Picker spec §4 — two polarity modes. */
export type PolarityMode = 'dual' | 'positive';

/**
 * Per-pick polarity. Only meaningful in `dual` polarity mode (Picker §4):
 * each picked item carries an explicit Include or Exclude intent. In
 * `positive` polarity mode the picker stores selections without an
 * intent field; the surface itself defines what the selection means.
 */
export type SelectionIntent = 'include' | 'exclude';

/**
 * The Selection — sparse-tree storage per Picker §6.1 + §9.2.
 *
 * Empty at any level means all at that level. Picked at a level means
 * just those. Examples (Picker §6.4):
 *
 *   { dimensionId: 'sector-technology' }
 *     → all of Technology.
 *   { dimensionId: 'sector-technology', clusterIds: ['llm', 'ai'] }
 *     → just LLM and AI clusters.
 *   { dimensionId: 'sector-technology', clusterIds: ['llm'],
 *     excludeValueIds: ['gpt-4'] }
 *     → LLM cluster except GPT-4 (except-list narrowing).
 *   { dimensionId: 'sector-technology',
 *     valueIds: ['claude','gemini','llama'] }
 *     → exactly these three values (enumerated).
 *
 * The storage reflects which path the user took (Picker §6.3): a user
 * who picks a cluster and deselects values produces an except-list; a
 * user who picks individual values produces an enumerated set.
 */
export interface Selection {
  /** The dimension this selection scopes to. Required. */
  dimensionId: string;
  /**
   * Selected cluster IDs within the dimension. Empty/absent → all
   * clusters (Picker §6.1). Only meaningful for clustered dimensions
   * (per Cluster Layer Amendment §5).
   */
  clusterIds?: string[];
  /**
   * Selected value IDs. Empty/absent → all values at the chosen
   * cluster scope. Populated → exactly these values (Picker §6.4
   * enumerated example).
   */
  valueIds?: string[];
  /**
   * Except-list narrowing within a cluster (Picker §6.3). When the
   * user picks a cluster and deselects specific values, those value
   * IDs land here. Future-additions semantics still apply: a new
   * value added to the cluster joins the resolved set unless it is
   * on the except-list.
   */
  excludeValueIds?: string[];
  /**
   * Per-pick polarity, populated only in `dual` polarity mode. The
   * picker omits this field entirely in `positive` mode.
   */
  intent?: SelectionIntent;
}

/**
 * The resolved-selection shape returned by resolveSelections. For
 * dual-polarity selections the include and exclude sets are returned
 * separately; the caller decides how to combine them per Picker §10.2
 * ("a Refinery query would subtract exclude from include; a UI
 * showing the selection would show both").
 */
export interface ResolvedSelection {
  /**
   * Concrete value IDs the include-polarity selections resolve to,
   * grouped by dimension. For positive-polarity callers, this is the
   * only populated key.
   */
  include: ResolvedSelectionByDimension;
  /**
   * Concrete value IDs the exclude-polarity selections resolve to,
   * grouped by dimension. Empty/absent in positive-polarity mode.
   */
  exclude: ResolvedSelectionByDimension;
}

export type ResolvedSelectionByDimension = Record<
  /* dimensionId */ string,
  /* concrete value IDs */ string[]
>;
