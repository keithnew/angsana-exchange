/**
 * Angsana Exchange — Dimension Packs v0.1: migration heuristic
 *
 * Implements the §6.1 "initial pack toggles for existing Clients" rule:
 *
 *   - Healthcare-adjacent SF industry  → ['healthcare']
 *   - Tech-B2B SF industry             → ['tech-b2b']
 *   - All Clients                      → ['marketing-services']  (empty pack;
 *                                                                  forward-compat)
 *
 * The heuristic is deliberately simple. It produces wrong answers for some
 * Clients; that is expected. After the reseed runs, an operator scans the
 * heuristic-applied toggles and overrides where the heuristic is incorrect
 * (Packs §6.1: "the migration is not a one-shot decision; it is a starting
 * point that operators correct").
 *
 * The unit of typing in Packs is the pack-toggle decision itself, not a
 * meta-classification above it (Packs §2.2). This module therefore exposes
 * the heuristic as a small pure function rather than a classifier wrapping
 * a Client typology.
 */

/**
 * Inputs the heuristic looks at. We accept a partial Client shape so that
 * callers from different read paths (Salesforce mirror, Firestore Client
 * doc, hand-curated test fixture) can pass whatever they have.
 *
 * NOTE: Exchange does not yet store a separate `salesforceIndustry` field
 * on the Client doc — Slice 2 introduced sectors as a managed-list
 * reference. The heuristic accepts both shapes:
 *
 *   - sfIndustry: free-text Salesforce industry tag (preferred when
 *                 imported direct from Salesforce mirror).
 *   - sectors:   the Exchange managed-list sector ids on the Client; used
 *                 when no SF mirror is present (early-era Clients).
 *
 * Either may be empty/undefined.
 */
export interface PackHeuristicInput {
  /** Free-text Salesforce industry tag, if known. */
  sfIndustry?: string | null;
  /** Exchange managedLists/sectors ids on the Client, if any. */
  sectors?: string[] | null;
  /**
   * Whether the Client carries any therapyAreas tags. Some Clients pre-date
   * the SF mirror but already record therapyAreas on the Client doc (e.g.
   * the Wavix seed); presence here is a strong healthcare-pack signal.
   */
  therapyAreas?: string[] | null;
}

/**
 * Salesforce industry tags that count as healthcare-adjacent for the §6.1
 * heuristic. Compared case-insensitively against partial substring matches
 * (so "Pharmaceutical Manufacturing" and "Healthcare Services" both match).
 */
const HEALTHCARE_SF_INDUSTRY_TOKENS = [
  'pharmaceutical',
  'pharma',
  'biotech',
  'biotechnology',
  'medical device',
  'healthcare',
  'health care',
  'life sciences',
  'hospital',
  'clinical',
];

/**
 * Salesforce industry tags that count as tech-B2B for the §6.1 heuristic.
 * As above — substring match, case-insensitive.
 *
 * "Telecommunications-as-vendor" per the spec maps to plain
 * 'telecommunications' here; the heuristic cannot distinguish the
 * vendor case from the buyer case from text alone, and operators will
 * correct after the fact.
 */
const TECH_B2B_SF_INDUSTRY_TOKENS = [
  'software',
  'saas',
  'it services',
  'information technology',
  'technology',
  'telecommunications',
  'telecom',
  'cloud',
  'cybersecurity',
];

/**
 * Exchange managed-list sector ids that count as healthcare-adjacent.
 * Matches §6.1's healthcare heuristic for Clients that lack an SF mirror.
 */
const HEALTHCARE_SECTOR_IDS = new Set<string>([
  'healthcare-life-sciences',
]);

/**
 * Exchange managed-list sector ids that count as tech-B2B.
 * Note: "technology" as a sector is the tech-buyer case, not the
 * tech-vendor case. The heuristic still applies — operator overrides
 * after the migration when this mis-classifies.
 */
const TECH_B2B_SECTOR_IDS = new Set<string>([
  'technology',
  'media-telecoms',
]);

/**
 * Lowercases and trims for whitespace-tolerant token matching.
 */
function normalise(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

/**
 * Apply the v0.1 migration heuristic (Packs §6.1).
 *
 * Returns the flat list of pack IDs to toggle on for a Client. Order is not
 * significant per §5.1 but the helper produces a stable order
 * (healthcare → tech-b2b → marketing-services) for snapshot determinism.
 *
 * Clients can carry both healthcare AND tech-b2b — a hospital running a
 * tech-comms vendor relationship is both. The heuristic does not force a
 * choice (Packs §2.2: "a single Client can carry healthcare-comms work
 * and tech-B2B work simultaneously").
 *
 * marketing-services is always added (empty pack in v0.1; recorded for
 * forward-compatibility per §6.1).
 */
export function applyMigrationHeuristic(input: PackHeuristicInput): string[] {
  const sfIndustryNormalised = normalise(input.sfIndustry);
  const sectors = input.sectors ?? [];
  const therapyAreas = input.therapyAreas ?? [];

  const matchesAny = (tokens: string[], target: string): boolean =>
    target.length > 0 && tokens.some((tok) => target.includes(tok));

  const isHealthcare =
    matchesAny(HEALTHCARE_SF_INDUSTRY_TOKENS, sfIndustryNormalised) ||
    sectors.some((s) => HEALTHCARE_SECTOR_IDS.has(s)) ||
    therapyAreas.length > 0;

  const isTechB2B =
    matchesAny(TECH_B2B_SF_INDUSTRY_TOKENS, sfIndustryNormalised) ||
    sectors.some((s) => TECH_B2B_SECTOR_IDS.has(s));

  const packs: string[] = [];
  if (isHealthcare) packs.push('healthcare');
  if (isTechB2B) packs.push('tech-b2b');
  packs.push('marketing-services');
  return packs;
}
