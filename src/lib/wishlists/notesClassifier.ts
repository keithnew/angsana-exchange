// =============================================================================
// Wishlist R1 free-text notes classifier
//
// Implements the four-route classification described in
// docs/architecture/r2-pvs-s1-wishlists-spec.md §6.3. Used by:
//   - scripts/migrate-wishlists-r2.ts (forward run, R1 → R2 lift)
//   - tests/wishlists/notesClassifier.test.ts (regression coverage)
//
// Conservative by design: when in doubt, route to a closed internal Work
// Item, which preserves the content with provenance but keeps it out of
// structured fields and out of the So Whats module.
//
// The four routes:
//   1. empty           — notes blank/whitespace; nothing to migrate.
//   2. targeting-raw   — short, hint-shaped; preserved as targetingHintsRaw
//                        for re-entry as TargetingHint pickers.
//   3. work-item       — anything else; default. Lifted into a closed
//                        internal Work Item, audience: 'internal'.
//   4. so-what-draft   — long + case-study-shaped vocabulary; routed to a
//                        So-What draft (queued for the future So Whats
//                        slice; not realised in this slice — see §6.6).
// =============================================================================

export type NotesRoute =
  | { route: 'empty' }
  | { route: 'targeting-raw'; raw: string }
  | { route: 'work-item'; body: string }
  | { route: 'so-what-draft'; body: string };

/**
 * Classify a single legacy R1 `notes` string.
 *
 * Rules (in order, first match wins):
 *
 * 1. Trimmed empty → `empty`.
 * 2. Length < 50, only alphanumerics/spaces/`- / & ,`, no terminating
 *    `?`/`.`/`!` → `targeting-raw`. The intent is to catch fragments like
 *    "Madrid hospitals" or "ENT, oncology" without catching sentences.
 * 3. Length > 200 AND contains a case-study cue word
 *    (case study, deployed, implementation, results, outcome) →
 *    `so-what-draft`. Longer descriptive text with implementation
 *    vocabulary almost certainly belongs in So Whats.
 * 4. Otherwise → `work-item` (default).
 *
 * Heuristic; the operator reviews migration log post-run and can re-route
 * any miscalls per spec §6.3.
 */
export function classifyNotes(notes: string | undefined | null): NotesRoute {
  const trimmed = (notes ?? '').trim();
  if (!trimmed) return { route: 'empty' };

  const isShort = trimmed.length < 50;
  const looksLikeHint =
    isShort && /^[A-Za-z0-9 \-/&,]+$/.test(trimmed) && !/[?.!]$/.test(trimmed);

  if (looksLikeHint) {
    return { route: 'targeting-raw', raw: trimmed };
  }

  const isCaseStudyShaped =
    trimmed.length > 200 &&
    /\b(case study|deployed|implementation|results|outcome)\b/i.test(trimmed);

  if (isCaseStudyShaped) {
    return { route: 'so-what-draft', body: trimmed };
  }

  return { route: 'work-item', body: trimmed };
}
