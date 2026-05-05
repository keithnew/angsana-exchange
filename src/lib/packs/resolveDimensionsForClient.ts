/**
 * Angsana Exchange — Dimension Packs v0.1: dimension-resolution helper
 *
 * Implements the §5.4 dimension-resolution helper:
 *
 *   resolveDimensionsForClient(client) → Dimension[]
 *
 * Resolves the universal core (dimensions whose `packs` field is empty
 * or absent) plus dimensions whose `packs` field intersects the Client's
 * `packs` array. Returns the ordered list of dimensions the Targeting
 * Hints Picker should offer when called from a surface bound to that
 * Client.
 *
 * Per Capabilities Note §4.6, dimension reads go through the snapshot
 * interface — the helper consumes a snapshot rather than fetching
 * per-call. v0.1 callers in Exchange are interactive UI (low-volume),
 * so the snapshot contract is honoured by accepting a pre-fetched
 * dimension catalogue as an argument; surfaces compose with whatever
 * read pattern they already use (Server Component / API route / etc.)
 * to obtain the catalogue once and pass it in.
 *
 * The helper is the only Pack-aware code in the consuming application
 * (Packs §7). Surfaces do not need to know which dimensions are
 * universal and which are pack-bound; the helper hides the distinction.
 */

/**
 * The minimum dimension shape this helper needs. Mirrors the relevant
 * subset of the canonical reference-data Category/TherapyArea/Sector
 * shapes (see angsana-research-hub/src/lib/reference-data/types.ts);
 * declared here so Exchange need not depend on the Hub's reference-data
 * types module directly. Surfaces wishing to pass richer shapes can
 * extend this generically.
 */
export interface DimensionForResolution {
  /** Dimension document id. */
  id: string;
  /**
   * Optional Pack membership (Packs spec §5.3). Empty or absent →
   * universal core; populated → applies only when one of the listed
   * packs is active on the Client.
   */
  packs?: string[];
}

/** The minimum Client shape this helper needs (Packs spec §5.1). */
export interface ClientForResolution {
  /**
   * Flat array of pack IDs from the catalogue. Order is not significant.
   * Empty array means no optional packs; the Client operates on universal
   * core dimensions only.
   */
  packs: string[];
}

/**
 * Resolve which dimensions apply to a Client.
 *
 * The rule (Packs §3.1): the dimensions that apply to a Client are the
 * universal core plus the union of dimensions bound to the Client's
 * active packs.
 *
 * @param client     The Client whose pack toggles drive resolution.
 * @param catalogue  Pre-fetched dimension catalogue (snapshot per §4.6).
 *                   Caller is responsible for fetching this once per unit
 *                   of work.
 * @returns          The filtered dimension list, preserving catalogue
 *                   order. Dimensions are returned by reference.
 */
export function resolveDimensionsForClient<T extends DimensionForResolution>(
  client: ClientForResolution,
  catalogue: readonly T[],
): T[] {
  const activePacks = new Set(client.packs ?? []);

  return catalogue.filter((dim) => {
    const dimPacks = dim.packs;
    // Universal core: empty or absent packs field.
    if (!dimPacks || dimPacks.length === 0) return true;
    // Pack-bound: intersect with the Client's active packs.
    return dimPacks.some((p) => activePacks.has(p));
  });
}
