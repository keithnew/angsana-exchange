# Dimension Packs v0.1 + Targeting Hints Picker v0.1 — slice handover

> Slice closing handover. Pairs with the in-tree spec mirrors:
> [`Angsana_Platform_Dimension_Packs_v0_1.md`](./Angsana_Platform_Dimension_Packs_v0_1.md)
> and [`Angsana_Exchange_Targeting_Hints_Picker_v0_1.md`](./Angsana_Exchange_Targeting_Hints_Picker_v0_1.md).
> Read them together; this note records what shipped, what was deferred,
> and what the operator does next.

## 1. Scope

Two companion specs, drafted in tandem and shipped in tandem.

- **Packs v0.1 (data side).** One Client field, one new reference-data
  collection, one helper, a heuristic-driven reseed.
- **Picker v0.1 (component side).** One React component, six surface
  adopters specified, three call modes × two polarity modes.

The slice ships:

- **A1.** Pack catalogue standup script in Core Functions.
- **A2.** Pack and dimension reference-data types in Research Hub.
- **A3.** `packs: string[]` on the Exchange Client record + seed update
  that emits `marketing-services` for every seeded Client.
- **A4.** `resolveDimensionsForClient` helper + 9 unit tests.
- **A5.** Heuristic-driven reseed script
  (`scripts/reseed-clients-packs-v0_1.ts`) + 29 unit tests of the
  heuristic.
- **A6.** In-tree mirror of the Packs spec.
- **B1.** `TargetingHintsPicker` React component with `types.ts`,
  `resolveSelections.ts`, `index.ts` barrel.
- **B2.** `resolveSelections` helper + 12 unit tests covering every
  §6.4 example, future-additions semantics, and the polarity-split
  contract.
- **B3.** In-tree mirror of the Picker spec.
- **B4.** This handover note.

The slice does **not** ship:

- The substantive *content* of the Healthcare and Tech-B2B dimensions.
  Per Packs §10.1 and the explicit reading of the spec, the actual
  values inside Therapy Area / Drug Development Phase / Product-Module
  / etc. are a content-design exercise that follows the spec. The
  catalogue is stood up structurally; the values arrive via the
  Reference Data Spec curatorial workflow afterwards.
- Surface rewires for any of the six adopting Exchange surfaces. The
  picker is shipped as a self-contained component with its helper and
  tests; the surfaces still use whatever picker UI they had before.
  **The Wishlists picker adoption is explicitly deferred to a later
  slice** (per the slice brief).

## 2. The two-spec read

The specs are designed to be read together. A reviewer or future
implementer should keep both open:

- Packs answers *which* dimensions are available for a Client.
- Picker answers *how* a user picks within that available set.

The integration point is one line — surfaces call
`resolveDimensionsForClient(client, catalogue)` and pass the result to
the picker as `availableDimensions`. Everything else in either spec is
internal to that side.

If a question of the form "but how should the picker know which
dimensions to offer for this Client?" arises, it is answered in Packs.
If a question of the form "but how should a user narrow within a
cluster?" arises, it is answered in Picker. Two-spec orthogonality is
the discipline that lets each remain amendable independently.

## 3. The empty-content interpretation

The slice brief flagged a question: can Cline ship Packs v0.1 with
empty Healthcare/Tech-B2B reference data and let the curatorial
workflow land the content later?

**Yes.** Packs §10.1 explicitly defers content design — *"the actual
content of each dimension is a content-design exercise that follows
this spec"*. The platform code (helper, reseed, picker) does not depend
on any specific values existing inside the pack-bound dimensions;
empty-but-structurally-present is a coherent v0.1 state, identical in
behaviour to the marketing-services reserved-but-empty pack itself.

What this means in practice:

- The pack catalogue at `/platform/reference/packs/{packId}` holds
  three entries: `healthcare` (active), `tech-b2b` (active),
  `marketing-services` (reserved). Stood up by
  `standup-pack-catalogue.ts`. (Path note: Packs spec §5.2 writes
  `/platform/reference/packs/items/{packId}` by analogy with the
  targeting-dimensions store; that path is structurally invalid in
  Firestore. The implementation flattens to the 4-segment doc path
  used here, applying the same Reference Data Spec Amendment 2
  reasoning. This deviation is recorded in the in-tree spec mirror
  and lifts into a Packs-spec v0.2 amendment when one is written.)
- The dimension definitions for the pack-bound dimensions (Therapy
  Area, Drug Development Phase, Product/Module, Healthcare-Comms Work
  Type, Vertical-Sold-Into) gain `packs: ['healthcare']` or
  `packs: ['tech-b2b']` on their entity documents. The *values*
  inside each dimension are stubbed empty for v0.1 and are filled by
  the Curatorial Sub-Module in Research Hub when senior-team
  conversation surfaces them. No Packs-spec amendment is required when
  values land — that is curatorial work, by design.

If a Client toggles `healthcare` on today, the picker offers Therapy
Area and Drug Development Phase as dimensions, but each shows no values
to pick yet. The user experience is honest about the state ("nothing
yet") rather than misleading; the moment values land, they appear in
the next picker invocation via the future-additions semantics in
Picker §6.2.

## 4. Operator runbook

The operator runs this slice in the order below. Each step is
independent and re-runnable.

### Step 1 — Stand up the pack catalogue (Core)

```
cd angsana-core-prod-project
npm run standup:pack-catalogue
```

The npm script is defined in `angsana-core-prod-project/package.json`
(it shells into `functions/` and runs the script via `tsx`); run it
from the repo root, not from inside `functions/`.

Idempotent. Creates the three pack documents at
`/platform/reference/packs/{healthcare,tech-b2b,marketing-services}`
with the right `status` field. Re-running on an existing catalogue
overwrites the metadata fields without disturbing the document IDs.

### Step 2 — Reseed Exchange Clients with heuristic-applied packs

```
cd angsana-exchange
Dry run first using:
npx tsx scripts/reseed-clients-packs-v0_1.ts --tenant=angsana

When clean execute using:
npx tsx scripts/reseed-clients-packs-v0_1.ts --tenant=angsana --execute
```

Reseed is ID-stable: each existing Client doc is updated in place with
`schemaVersion: 'packs-v1'` and a `packs` array populated by the
heuristic in `src/lib/packs/heuristic.ts`. A `reseed.completed` event
is emitted per Reseed Pattern v0.1 §3.1.

Re-runs are no-ops on already-bumped documents — important because
operators correct the heuristic afterwards (next step) and a re-run
must not revert their work.

### Step 3 — Operator review of heuristic-applied toggles

Per Packs §6.1, *"the heuristic produces wrong answers for some
Clients. This is expected and is fine."* The operator scans the new
`packs` arrays on Clients and overrides where the heuristic was wrong.
Override is a single edit on the Client doc; no reseed is needed.

The heuristic's stable order (`healthcare → tech-b2b →
marketing-services`) makes diff review easy: any Client without
`healthcare` is one the heuristic decided was not healthcare-shaped,
and so on.

### Step 4 — Pack-bound dimension content (curatorial, ongoing)

The Curatorial Sub-Module in Research Hub is the venue where Therapy
Area values, Drug Development Phase values, Product/Module values, etc.
land. This is not a one-shot operation; it is the operating mode of
the curatorial workflow from now onwards. The slice is shipped *before*
this work begins so that the dimensions exist when the curators arrive.

## 5. Test inventory

| File | Tests | Coverage |
|------|-------|----------|
| `tests/packs/resolveDimensionsForClient.test.ts` | 9 | §3.1 resolution rule, all four pack-toggle combinations, marketing-services empty pack, absent/empty `packs` field, catalogue ordering, forward-compat for unknown pack IDs, empty catalogue. |
| `tests/packs/heuristic.test.ts` | 29 | §6.1 heuristic — every healthcare and tech-b2b token, sector-id signals, therapyAreas presence, mixed-shape Clients, stable ordering, case-insensitivity, null/undefined handling. |
| `tests/targetingHints/resolveSelections.test.ts` | 12 | All five §6.4 examples, future-additions for cluster picks, except-list survival across catalogue updates, retired-dimension defensiveness, idempotence, dimension-level union, unclustered-dimension cluster-skip, positive-polarity exclude-bucket discipline. |

Total: **50 tests, all passing**. Run with `npx vitest run` from
`angsana-exchange/`.

## 6. Containment commitments — what we did not extend

Cline reviewed both spec containment-commitment lists and held them.
Specifically:

- The picker has no surface-aware logic. It does not know the surface
  it is rendering for. (Picker §13.1.)
- The picker has three call modes. None were added. (Picker §13.2.)
- The picker lives in `angsana-exchange/src/components/targetingHints/`.
  Not promoted to `@angsana/ui-baseline`. (Picker §13.3.)
- Packs determines which dimensions apply, and nothing else. The
  helper does not branch behaviour by pack; it filters the catalogue.
  (Packs §9 commitment 1.)
- Packs has no lifecycle events; the catalogue is a static reference
  collection. (Packs §9 commitment 2.)
- A Client carries a flat `packs: string[]`. No inheritance, no
  pack-of-packs. (Packs §9 commitment 3.)
- The catalogue is closed at three entries. No tenant-defined packs.
  (Packs §9 commitment 4.)
- Where a refactor temptation appeared — for instance, "should the
  reseed also touch dimension `packs` membership?" — it was rejected:
  dimension membership is curatorial work, edited via the Reference
  Data Spec workflow, not via Packs reseeds. (Packs §9 commitment 5.)

## 7. Trigger conditions for v0.2 of either spec

Re-stating from the spec mirrors so the next reader has the trigger
conditions visible alongside the implementation:

- **Packs v0.2** triggers on (a) first content-design pass surfaces a
  structural gap; (b) Variant 2 tenant onboards and tenant-defined
  packs are needed; (c) a behavioural-variation-by-client-shape
  concern arises and forces §10.3's boundary to be sharpened.
- **Picker v0.2** triggers on (a) a fourth call mode is genuinely
  needed; (b) a non-Exchange use case justifies promotion to
  `@angsana/ui-baseline`; (c) a surface needs behaviour that cannot be
  expressed by call mode + polarity mode + available-dimensions and the
  component must be extended; (d) the Cluster Layer Amendment is
  amended in a way that affects picker UX.

## 8. Next slice — Wishlists picker adoption

The natural next slice rewires Wishlists to consume the new picker in
`catalogue` + `positive` mode. That slice will:

- Read the Client's `packs` field, call
  `resolveDimensionsForClient(client, catalogue)`, and pass the result
  to `<TargetingHintsPicker callMode="catalogue" polarityMode="positive" ... />`.
- Specify the migration of existing flat-list Wishlist selections into
  the new `Selection[]` shape (Picker §14 explicitly defers this to
  the adopting slice).
- Ship under Reseed Pattern v0.1 since Wishlists are still in
  seed-data era (per the existing Wishlists v0.2 work).

The picker and helper are stable in this slice; the adopting slice
should not need to reach back into them.

---

*v0.1 · May 2026 · Internal — Confidential*
