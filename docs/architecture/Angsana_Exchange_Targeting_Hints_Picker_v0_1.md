# Angsana Exchange — Targeting Hints Picker v0.1

> **In-tree mirror.** This file is a verbatim mirror of the canonical
> Targeting Hints Picker v0.1 spec drafted in conversation with Keith.
> The source-of-truth Word document is in Keith's drive
> (`Angsana_Exchange_Targeting_Hints_Picker_v0_1.docx`); this mirror
> lives in the Exchange repo so Cline and reviewers reading the codebase
> can find the spec at a stable path. If the canonical spec is amended,
> replace this file in lockstep.
>
> **Companion:** Angsana Platform — Dimension Packs v0.1
> (`Angsana_Platform_Dimension_Packs_v0_1.md` in this directory).
> Drafts in tandem; not complete without each other.

A single parameterised React component reused across six Exchange
surfaces — Wishlists, Propositions/ICP, Conflicts, Exclusions,
Relationships, Campaigns — for picking targeting dimensions and values.
Three call modes (catalogue, narrowing, single-target) and two polarity
modes (dual, positive) cover the surfaces' shapes. Selection-at-depth
with empty-means-all semantics; except-list narrowing within clusters;
constraint envelopes for Campaigns. Consumes Dimension Packs through the
dimension-resolution helper. Composes with the Cluster Layer's
optionality commitments without coupling. Designed to be lifted into
platform-shared code if and only if a non-Exchange app surfaces a real
use case for it.

---

## 1. What this document is

The Targeting Hints Picker is the single React component in
`angsana-exchange` that lets a user pick targeting dimensions and values
for a record. It is reused across six surfaces. Each surface configures
the component by passing two parameters — call mode and polarity mode —
and supplying the available-dimensions list, plus (for narrowing mode)
the constraint envelope. Everything else about the component's
behaviour is the same everywhere.

This document specifies the three call modes, the two polarity modes,
the selection-at-depth model, the except-list narrowing semantics, the
constraint-envelope handling, the storage shape, the props interface,
and the per-surface configuration. It also names the component's
relationship to Dimension Packs (the upstream dimension-applicability
concept) and to the Cluster Layer Amendment (which determines whether a
dimension's values are presented hierarchically when the user picks
within them). It defers cross-app reuse — the component lives in
Exchange in v0.1; promotion to `@angsana/ui-baseline` is a deliberate
non-goal until a real non-Exchange use case surfaces.

It is the companion document to Angsana Platform Dimension Packs v0.1.
Neither document is complete without the other in the consumer's hands;
they are deliberately separated to let each remain focused and amendable
independently.

## 2. Why a single component

The picker is the connective tissue between several Exchange surfaces.
Wishlists, Propositions, Campaigns, Conflicts, Exclusions, and
Relationships all need a structurally similar UI — pick from a set of
dimensions, pick values within each dimension, see what's been picked,
narrow or remove. Building each surface's picker independently would
create six similar-but-divergent components that drift apart as surfaces
evolve. Building one parameterised component and reusing it makes the
surfaces consistent by construction.

The architectural payoff is also legible at acquisition due diligence. A
single picker component, six callers, parameters that map cleanly to
each surface's intent — that is the kind of structural sharing that
demonstrates platform-thinking rather than feature-stacking. The
discipline of resisting per-surface special cases keeps the
abstraction's value intact; that discipline is recorded in §13 below as
a containment commitment.

## 3. The three call modes

Each surface invokes the picker in one of three call modes. The modes
differ in what's offered and what constrains the offering; they do not
differ in the picker's internal behaviour beyond what's described here.

| Call mode | What it is | Surfaces that use it (v0.1) |
|-----------|------------|------------------------------|
| `catalogue` | The picker offers the full set of dimensions that apply to the Client (universal core plus Pack-resolved). The user picks freely from the entire available set. No constraint envelope. | Wishlists; Propositions/ICP. |
| `narrowing` | The picker offers a subset of the catalogue, constrained by a parent selection (typically one or more Propositions). The user can narrow further within the envelope but cannot select anything outside it. | Campaigns (where the parent envelope is the union of the Campaign's Propositions' resolved selections). |
| `single-target` | The picker offers the dimension catalogue for the surface's typed concern (e.g. the conflict-type vocabulary for Conflicts, the exclusion-reason vocabulary for Exclusions). The selection is values for a single record, not part of a hierarchy. | Conflicts; Exclusions; Relationships. |

The picker resolves its available-dimensions list differently per mode.
In `catalogue` mode, the resolution is a direct call to
`resolveDimensionsForClient(client)` (per the Dimension Packs spec). In
`narrowing` mode, the resolution is the union of the parent-record
selections, intersected with the Client's resolved dimensions — the
parent selection is the constraint envelope, evaluated at read time. In
`single-target` mode, the resolution is the surface's typed vocabulary
(a fixed list specific to the surface).

Resolution happens once per picker invocation. The picker does not
re-resolve mid-session; configuration changes (a new pack toggled on the
Client, a new dimension added by curatorial work) take effect for the
next picker invocation.

## 4. The two polarity modes

Polarity is a property of the surface, not of the individual pick. Two
surfaces hold both polarities in one mental model — Propositions and
Campaigns, where 'include these, exclude those' is the natural way the
user thinks. The other four surfaces carry polarity at the surface
level: a Wishlist pick is positive intent by definition; an Exclusion
record's picks are excluded by definition; a Conflict record's picks are
conflicts by definition; a Relationship record's picks define the
relationship by definition.

| Polarity mode | What it is | Surfaces that use it (v0.1) |
|---------------|------------|------------------------------|
| `dual` | Each picked item carries an Include or Exclude polarity. The user holds 'include these, exclude those' in one mental act. Picker shows an Include/Exclude toggle alongside picks; selected-tray shows two visually distinct chip styles. | Propositions/ICP; Campaigns. |
| `positive` | All picks carry the same polarity, defined by the surface itself. The picker presents no toggle. Wishlists picks are wishes (positive intent); Exclusion records' picks are by definition excluded; Conflict records' picks are by definition restricted. | Wishlists; Conflicts; Exclusions; Relationships. |

The picker takes a `polarityMode` prop. In `dual` mode, each picked item
carries an explicit `intent` (`include` or `exclude`) chosen by the user
via a toggle. In `positive` mode, the picker stores selections without
an `intent` field; the surface itself defines what the selection means.

## 5. Surface configuration

Six Exchange surfaces consume the picker in v0.1. Each surface picks one
call mode and one polarity mode; the combinations used today are listed
below.

| Surface | Call mode | Polarity | Notes |
|---------|-----------|----------|-------|
| Wishlists | `catalogue` | `positive` | Picks are aspirational. The user expresses 'we wish you'd prospect these things.' The full catalogue is available; nothing constrains selection. |
| Propositions / ICP | `catalogue` | `dual` | The Proposition defines the master targeting set. Include/Exclude is the natural mental model — 'include these, but specifically exclude these.' |
| Campaigns | `narrowing` | `dual` | The Campaign narrows within the union of its Propositions' selections. Include/Exclude carry through; the constraint envelope is the parent selection resolved at read time. |
| Conflicts | `single-target` | `positive` | A Conflict record's picked values are the conflict's scope. The dimension vocabulary is the typed conflict-type vocabulary (`productCategory`, `industrySegment`, `therapyArea`), not the targeting-dimensions catalogue. |
| Exclusions | `single-target` | `positive` | An Exclusion record's picked values are by definition excluded — the surface itself carries the polarity, the picker stays positive. Available dimensions are the targeting-dimensions catalogue. |
| Relationships | `single-target` | `positive` | A Relationship record's picked values define the relationship's scope. Same shape as Exclusions but the surface meaning differs. |

> **Adoption sequencing.** Per §12 below and the slice handover, none
> of the six surfaces is rewired to consume the picker in this slice.
> The picker is shipped first as a self-contained component with its
> own helper and tests; surface adopters land in dedicated slices —
> Wishlists v0.2-picker, Propositions, etc. — each of which inherits
> the matrix above unchanged.

New Exchange surfaces that need the picker inherit this matrix — they
declare a call mode and a polarity mode at integration time, and the
rest of the component's behaviour follows. Adding a new combination of
call mode and polarity mode that isn't in the matrix today is an
unblocked extension; the component's logic is orthogonal to the matrix.

## 6. Selection-at-depth

A picked item is a sparse tree. The user can stop picking at any depth;
everything below an unstated level is implicitly included. This is the
model that lets a single component serve every sophistication tier with
the same behaviours.

### 6.1 The rule

**Empty at any level means all at that level. Picked at a level means
just those.** The same rule applies at every level of the selection
tree.

- Empty cluster selection within a dimension means all clusters in the
  dimension.
- One or more clusters selected means those clusters and everything in
  them.
- Empty value selection within a cluster means all values in the
  cluster.
- One or more values selected means those exact values.

This applies whether or not the dimension has clusters populated today.
A dimension without clusters skips the cluster level — a selection is
just dimension and values; empty values means all values in the
dimension. Clusters appear in the picker UI when they exist in data;
selections from before clusters were populated remain valid (empty
cluster selection = all clusters = all values, which is the same meaning
the selection had before).

### 6.2 Future-additions semantics

A whole-set selection automatically includes future curatorial
additions. A user who picked "Technology" today benefits from a new
cluster added next month — the cluster joins the resolved set the next
time the selection is read. Same for new values added to a cluster the
user picked. This is a property of resolving the selection against the
catalogue at read time rather than pinning it to a snapshot at selection
time. It is the right behaviour: the user wanted "this part of the
world," the curatorial team improved the map, the user gets the better
map.

Users who want to lock to a specific value set narrow explicitly —
picking the values they want rather than the cluster they belong to. The
picker supports both choices; the choice is the user's.

### 6.3 Except-list narrowing within a cluster

A user who picks a cluster and then deselects specific values within it
produces an except-list. The stored selection is "this cluster, except
these values." Future-additions semantics still apply for the cluster —
a new value added to the cluster joins the resolved set unless it is on
the except-list.

This is consistent with the Cluster Layer Amendment §5.3 commitment,
which already specifies that picking a cluster is equivalent to picking
all its current member categories with deselection allowed for
subsetting. The except-list is the natural storage shape for that
commitment, extended to the value level.

A user who instead wants a fixed enumerated set picks the values
directly without going through the cluster commitment. The two paths are
distinguishable by how the user narrows; the storage reflects which path
was taken.

### 6.4 Examples

| User intent | Stored selection |
|-------------|------------------|
| All of Technology (unsophisticated user) | `{ dimensionId: 'sector-technology' }` |
| Just LLM and AI clusters within Technology (medium-sophistication user) | `{ dimensionId: 'sector-technology', clusterIds: ['llm', 'ai'] }` |
| LLM cluster but specifically not GPT-4 (sophisticated, except-list) | `{ dimensionId: 'sector-technology', clusterIds: ['llm'], excludeValueIds: ['gpt-4'] }` |
| Exactly Claude, Gemini, Llama (sophisticated, enumerated) | `{ dimensionId: 'sector-technology', valueIds: ['claude', 'gemini', 'llama'] }` |
| Proposition: include all Technology, exclude Sales Operations specifically (dual polarity) | `[{ dimensionId: 'sector-technology', intent: 'include' }, { dimensionId: 'sector-functions', valueIds: ['sales-operations'], intent: 'exclude' }]` |

## 7. The constraint envelope

In `narrowing` mode, the picker offers a subset of the catalogue
determined by a parent selection. Campaigns are the canonical case — a
Campaign's available dimensions and values are constrained by the union
of its Propositions' resolved selections. The picker presents only
what's in the envelope; the user can narrow further or accept the
envelope as-is, but cannot select anything outside it.

### 7.1 Resolving the envelope

The envelope is computed at picker-invocation time as the union of the
parent-record selections, resolved against the catalogue. For Campaigns,
the parent records are the Campaign's Propositions; for each
Proposition, its selections are resolved (whole dimensions, whole
clusters, specific values, except-lists, all per the §6 rule) against
the current catalogue, then the resolved sets are unioned.

Polarity carries through. If a Proposition includes Technology and
excludes Sales Operations, the envelope offers Technology in include
polarity and excludes Sales Operations in exclude polarity. The Campaign
cannot relax the exclusion — the parent's exclude is part of the
guardrail. The Campaign can narrow the include further (select specific
Technology clusters) or accept the include whole. The Campaign can add
its own exclusions on top of the parent's.

If multiple Propositions are joined, their resolved sets union. A
dimension picked broadly in one Proposition and narrowly in another
resolves to the broader set in the envelope — the union takes the most
permissive form. This is the easy-path consequence of the empty-means-all
rule (broader selection wins by virtue of including everything narrower)
and is the right behaviour.

### 7.2 What the user sees

The picker in `narrowing` mode visually presents only what is in the
envelope. Dimensions excluded by the envelope do not appear; values
excluded by the envelope do not appear. The user is not shown forbidden
options with affordances to select them; the catalogue the picker
presents is already the envelope.

Where the envelope's polarity matters — an exclusion the user must
respect — the picker shows the exclusion as a non-removable item in the
selected-tray, marked clearly as inherited from the parent. The user
cannot deselect it; they can see it and understand why their available
set is what it is.

## 8. The cluster layer

The Cluster Layer Amendment §5 specifies that some dimensions have an
optional middle layer of clusters between the dimension and its values.
The picker honours all four of the Amendment's commitments without
modification.

§5.1 (empty-layer suppression) — when a dimension has no clusters
populated, the picker presents values directly under the dimension; no
"Uncategorised" bucket appears. §5.2 (data drives UX) — the picker
becomes hierarchical the next time it is invoked after clusters are
populated for a dimension; no flag is needed in the picker. §5.3
(picking semantics) — picking a cluster is equivalent to picking all its
current member values, with deselection producing an except-list per
§6.3. §5.4 (membership changes) — cluster membership changes propagate
through the future-additions semantics in §6.2.

The picker's UI treatment is straightforward. For a dimension without
clusters, values are presented as a flat selectable list. For a
dimension with clusters, clusters appear as collapsible sections within
the dimension; each cluster section contains its values. The user can
pick a cluster checkbox (whole-cluster commitment) or expand a cluster
and pick individual values. The exact rendering — collapsed-by-default,
selected-clusters-pre-expanded, etc. — is for Cline to propose at build
time; the model is settled here.

## 9. The component interface

The picker is implemented as a single React component. The interface is
small enough to specify exhaustively here.

### 9.1 Props

```ts
interface TargetingHintsPickerProps {
  callMode: 'catalogue' | 'narrowing' | 'single-target';
  polarityMode: 'dual' | 'positive';

  // Resolves to the dimensions available for this picker invocation.
  // For catalogue mode: typically a wrapper around resolveDimensionsForClient.
  // For narrowing mode: the envelope-resolution function.
  // For single-target mode: the surface's typed vocabulary.
  availableDimensions: Dimension[];

  // The current selection. Sparse tree per §6.
  // For dual polarity, items carry intent: 'include' | 'exclude'.
  selections: Selection[];

  // Called when the user changes selections.
  onSelectionsChange: (selections: Selection[]) => void;

  // Narrowing mode only — the parent envelope's mandatory exclusions.
  // Shown as non-removable items in the selected-tray.
  inheritedExclusions?: Selection[];

  // Optional rendering hints. Cline may extend at build time.
  density?: 'compact' | 'comfortable';
}
```

### 9.2 The Selection type

```ts
interface Selection {
  dimensionId: string;
  clusterIds?: string[];
  valueIds?: string[];
  excludeValueIds?: string[];  // populated when except-list narrowing
  intent?: 'include' | 'exclude';  // dual polarity only
}
```

The Selection type is the entire storage shape. The component does not
store derived information; resolution to concrete dimensions, clusters,
and values is done at read time by callers consuming the selections
(e.g. when a Campaign sends a Refinery query).

### 9.3 What the component does not own

The component does not own the dimension catalogue — that is the
upstream data, supplied as `availableDimensions`. It does not own the
constraint envelope — that is computed by the caller and supplied via
`availableDimensions` and `inheritedExclusions`. It does not own the
persistence of selections — `onSelectionsChange` hands changes back to
the caller, which decides where they go.

Keeping the component free of these concerns is what lets it be reused
without per-surface special cases.

## 10. Storage and resolution

### 10.1 Where selections live

Selections are stored as part of the consuming record. A Wishlist's
selections live on the wishlist entry document; a Proposition's
selections live on the Proposition document; a Campaign's selections
live on the Campaign document; a Conflict's selections live on the
Conflict record. The picker does not impose a storage location; the
caller decides.

The `Selection[]` shape is the canonical storage shape. Records that
need to persist selections store the array; records that need to
evaluate them resolve the array against the current catalogue at read
time.

### 10.2 Resolution at read time

Resolving a `Selection[]` to concrete dimensions, clusters, and values
is the consumer's responsibility. The platform provides a single helper:

```
resolveSelections(selections, catalogue) → ResolvedSelection
```

The helper takes the stored selections and the current catalogue (read
through the §4.6 snapshot interface), applies the empty-means-all rule
recursively, applies any except-lists, and returns the concrete
dimensions/clusters/values currently included. For dual-polarity
selections, the resolved output carries Include and Exclude sets
separately; the caller decides how to combine them (a Refinery query
would subtract exclude from include; a UI showing the selection would
show both).

Resolution is read-time idempotent. The same selections resolved against
the same catalogue snapshot always produce the same resolved output.
Caching of resolution results, where needed, is a caller concern.

> **Implementation in this slice.** Lives in
> `src/components/targetingHints/resolveSelections.ts`. Unit tests in
> `tests/targetingHints/resolveSelections.test.ts` pin every example
> from §6.4 plus the polarity-split contract above.

## 11. Relationship to upstream concepts

### 11.1 Dimension Packs

The picker consumes dimensions through `resolveDimensionsForClient` (per
Dimension Packs v0.1 §5.4) when invoked in `catalogue` mode. The picker
does not know which dimensions are universal core and which are
Pack-resolved — the helper hides the distinction. New Pack-bound
dimensions appear in the picker automatically the next time it is
invoked for a Client whose pack toggles include the relevant pack.

### 11.2 Cluster Layer

The picker honours the Cluster Layer Amendment §5 commitments without
modification (per §8 above). Clusters are a presentation property of
dimensions; they do not couple to call mode or polarity mode. A
dimension with clusters and a dimension without compose identically into
the picker's selection tree (the cluster level is simply absent for
unclustered dimensions).

### 11.3 Reference data caching

All catalogue reads — dimensions, clusters, values — go through the
platform reference data caching pattern (Capabilities Note §4.6). The
picker reads the snapshot once per invocation; the snapshot's
bounded-lifetime invalidation contract takes care of when configuration
changes take effect. The picker does not implement caching itself.

### 11.4 Model/values split

The picker is part of the model — Capabilities Note §10. Its code, props
interface, and behaviour are versioned in code. The dimensions and
values it presents are data, versioned through the Reference Data Spec's
curatorial workflow. The `Selection[]` storage shape is part of the
model; the specific values stored within a Selection are data. This
composition matches the existing platform discipline.

## 12. Surface adoption sequencing

The picker ships in Exchange and is adopted surface-by-surface. The
sequencing reflects which surfaces are ready and which downstream specs
are settled.

**Wishlists** is the first adopter. The Wishlists v0.2 Slice Spec ships
first (it is independent of the picker); the picker ships next (this
slice); Wishlists then gains a slice that replaces its existing
flat-list dimension picker with the new component in `catalogue` +
`positive` mode. This is the easiest adoption — full catalogue, no
envelope, single polarity.

> **Wishlists adoption deferred to a later slice.** This slice ships
> the helper (`resolveDimensionsForClient`) and the picker component;
> Wishlists is *not* rewired in this slice. The Wishlists rewrite is
> sliced separately so the picker can be reviewed on its own
> behavioural merits without entangling the Wishlists migration.

**Propositions/ICP** is the second adopter, when the Propositions
surface itself is built. `catalogue` + `dual` mode — the picker carries
the Include/Exclude framing the existing briefing template uses.

**Conflicts, Exclusions, Relationships** are the next group, adopted as
their per-surface specs are written under the Prospecting Validation
Surfaces R2 sequencing. All three use `single-target` + `positive` mode;
their differences are in record shape and surface meaning, not picker
configuration.

**Campaigns** are the last v0.1 adopter, when Campaigns are built.
`narrowing` + `dual` mode — the most complex configuration, picking up
all the constraint-envelope work specified in §7.

Adopting surfaces inherit the picker without per-surface forking.
Surface-specific UX (placement, labels, callbacks) lives in the surface;
the picker itself is the same component every time.

## 13. Containment commitments

The picker's value comes from being a single reused component. Resisting
per-surface special cases is the discipline that keeps the value intact.
Three commitments hold the line.

### 13.1 No surface-aware logic in the component

The component does not know whether it is being called from Wishlists or
from Conflicts. It receives call mode, polarity mode, and the
available-dimensions list; everything else is the same. A surface that
wants something materially different from what call mode and polarity
mode express is a sign that a separate component is needed, not that
the picker should grow a new flag.

### 13.2 No accumulating call modes

Three call modes cover six v0.1 surfaces and are expected to cover
future Exchange surfaces. A new call mode is added when a real surface
needs behaviour that cannot be expressed by an existing call mode plus a
different available-dimensions list. "It would be cleaner if there were
a fourth mode for this case" is not enough.

### 13.3 In Exchange in v0.1; promotion deferred

The picker lives in `angsana-exchange`. Promotion to
`@angsana/ui-baseline` for cross-app reuse (Refinery, Research Hub) is a
deliberate non-goal until a real non-Exchange use case surfaces. The
component is written cleanly so promotion is a straightforward
extract-and-publish when the time comes; no Exchange-specific knowledge
is baked into the picker. But until a use case justifies the cross-app
versioning overhead, the picker stays put.

## 14. What this spec does not cover

Several things are deliberately left to other specs or to build-time
decisions.

- This spec does not specify the per-surface placement of the picker.
  Each surface decides where on its form the picker appears; that is
  part of the surface's own UI design.
- This spec does not specify visual styling beyond density. Cline
  applies the Exchange UI baseline at build time; this spec is concerned
  with the component's structure and behaviour, not its appearance.
- This spec does not specify migration of existing flat-list selections
  (e.g. on existing Wishlist entries). The Wishlists v0.2 Slice Spec
  retained the existing flat-list as a starting point; the slice that
  adopts the new picker will specify the migration as part of its own
  scope.
- This spec does not specify the substantive content of any dimension.
  Dimensions, clusters, and values are reference data, curated through
  the workflow specified in the Reference Data Spec.
- This spec does not specify the Conflicts typed vocabulary. That
  vocabulary is part of the Conflicts surface spec when it is written;
  this picker spec accepts it as the available-dimensions input for the
  `single-target` mode call from Conflicts.

## 15. Document control

- **Author:** drafted in conversation with Keith. Triggered by
  `HANDOVER_Wishlists_Feedback_and_Learnings.md` and the design
  conversation that followed. The picker concept emerged from the
  senior team session feedback on Wishlists; this spec formalises it
  for use across the Exchange surfaces.
- **Review:** Cline (component implementation reference); Exchange
  product owner; future readers of Conflicts, Exclusions, Relationships,
  Propositions, and Campaigns specs that consume this component.
- **Trigger for v0.2 of this spec:** any of (a) a fourth call mode is
  genuinely needed; (b) a real non-Exchange use case justifies promotion
  to `@angsana/ui-baseline`; (c) a surface needs picker behaviour that
  cannot be expressed by call mode + polarity mode + available-dimensions
  and the component must be extended; (d) the Cluster Layer Amendment is
  itself amended in a way that affects picker UX.
- **Companion document:** Angsana Platform Dimension Packs v0.1,
  drafted in tandem. The picker consumes Packs through
  `resolveDimensionsForClient`; the Packs spec carries the data-side
  architecture.

---

*Draft v0.1 · May 2026 · Internal — Confidential*
*Angsana Exchange — Targeting Hints Picker v0.1*
