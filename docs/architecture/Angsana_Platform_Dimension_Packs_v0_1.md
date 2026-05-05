# Angsana Platform — Dimension Packs v0.1

> **In-tree mirror.** This file is a verbatim mirror of the canonical
> Dimension Packs v0.1 spec drafted in conversation with Keith. The
> source-of-truth Word document is in Keith's drive
> (`Angsana_Platform_Dimension_Packs_v0_1.docx`); this mirror lives in
> the Exchange repo so Cline and reviewers reading the codebase can find
> the spec at a stable path. If the canonical spec is amended, replace
> this file in lockstep.
>
> **Companion:** Angsana Exchange — Targeting Hints Picker v0.1
> (`Angsana_Exchange_Targeting_Hints_Picker_v0_1.md` in this directory).
> Drafts in tandem; not complete without each other.
>
> **Patterns referenced:** Reseed Pattern v0.1
> (`Angsana_Reseed_Pattern_v0_1.md`), Migration Pattern v0.2 amendment
> (`Angsana_Migration_Pattern_v0_1_Amendment_Threat_Model_and_Era.md`),
> Capabilities Note §4.6 (in Keith's drive; not yet in-tree).

A small, deliberately bounded architectural concept that determines
which targeting dimensions apply to which Clients. The universal core
dimensions apply to every Client; optional packs add further dimensions
for specific work shapes (healthcare comms, tech B2B). Sits one level
above the existing Targeting Dimensions Primer pattern; does not
restructure dimensions themselves; does not influence anything beyond
dimension applicability. The abstraction's value comes from how narrow
it is.

---

## 1. What this document is

Dimension Packs is the architectural concept that lets the Angsana
platform offer different targeting dimensions to different Clients
without forking the platform's code, without typing Clients into rigid
categories, and without imposing neatness on adaptive operational
reality. A Client carries a flat list of pack IDs; the universal core
dimensions apply to every Client regardless; optional packs add further
dimensions whose applicability the platform can resolve consistently
from data.

This document specifies the data model, the pack catalogue for v0.1, the
dimension-applicability resolution rule, the migration approach for
existing Clients, the relationship to the Targeting Dimensions Reference
Data Spec and its Cluster Layer Amendment, the integration point for
surfaces that consume targeting dimensions, and the explicit non-goals
that keep the abstraction narrow.

It does not specify the Targeting Hints Picker UI itself — that is the
companion document, drafted in tandem. It does not specify the content
of the Healthcare or Tech-B2B packs in detail beyond the initial
dimension list — that is a content-design exercise that follows this
spec. It does not specify any behavioural variation between Clients
beyond which dimensions appear in their pickers — that is, by intent,
the entire scope of what Packs do.

A note on terminology. "Client" in this spec is the platform's existing
grain — a Salesforce Account whose Record Type is "Angsana,"
representing an active engagement (as distinct from a Prospect). Pack
toggles live as metadata on the Client record, alongside its other
Client-level fields.

## 2. Why this concept exists

Three things forced the concept; together they make the case for it.

### 2.1 Targeting dimensions are not universally applicable

Therapy Area is meaningless on a Client that does no healthcare work.
SAP Module is meaningless on a Client that does no tech-B2B work. The
Targeting Dimensions Reference Data Spec describes dimensions as if they
were universal because it is the spec for the dimensional model, not for
which dimensions apply where. A separate concept is needed to determine
the latter.

### 2.2 Client typology is the wrong shape for this

The instinct is to type Clients (Healthcare, Tech, Marketing Services)
and let the type drive applicability. This was tried in three rounds of
de-escalation in the conversation that produced this concept. It does
not work because the work itself is finer than any sensible Client
typology can capture. A single Client can carry healthcare-comms work
and tech-B2B work simultaneously; a single Type field forces an
artificial choice.

Packs sidestep typology entirely. A Client carries zero, one, or
multiple pack toggles. The unit of typing is the dimension-applicability
decision itself, not a meta-classification above it.

### 2.3 The platform must not centre on today's commercial composition

Angsana's commercial mix has shifted historically — Marketing Services
dominant, Healthcare ascendant, Tech structurally short-term, an
anticipated pivot back toward Marketing Services. A platform whose
architecture privileges any one of these as the default would force a
re-architecture every time the centre of gravity moves. Packs solve this
by making the universal core the default and treating every shaped
vertical as a pack — including Marketing Services itself, which appears
in v0.1 as an explicitly-empty pack reserved for future content-design
work.

The base experience for any Client is 'fill in the universals.' Packs
add. The platform doesn't know or care which pack is dominant at any
point in time; it adapts to whatever the Client actually does.

## 3. The architectural shape

### 3.1 Universal core plus optional packs

Dimensions are partitioned into two sets:

- **Universal core** — dimensions that apply to every Client regardless
  of the work being done. The initial universal core is Geography,
  Service Type, and Sector. These are the stable spine of targeting;
  every Client has work in some geographies, of some service type, and
  serving some sector.

- **Pack-bound dimensions** — dimensions that apply only when a specific
  pack is on for the Client. Therapy Area applies when the Healthcare
  pack is on; Product/Module applies when the Tech-B2B pack is on. A
  pack-bound dimension is invisible to a Client whose pack toggles do
  not include that pack.

The dimension-resolution rule is a single sentence: **the dimensions
that apply to a Client are the universal core plus the union of
dimensions bound to the Client's active packs.** This is the rule every
consuming surface uses; there are no other variations.

### 3.2 Where Packs sit relative to existing concepts

Packs sit one level above the Targeting Dimensions Primer's
handle-over-keyword-layers pattern. They group dimensions; they do not
restructure dimensions themselves. The Primer's substantive content is
undisturbed; the Reference Data Spec's seven (now eight, after Amendment
1) entity types are unchanged; the Cluster Layer's three optionality
commitments and picker UX commitments are unchanged.

This means Packs and Clusters are orthogonal. Packs determine whether a
dimension is present at all for a Client; Cluster (when populated for a
dimension) determines whether that dimension's values are presented
hierarchically when the user picks within it. Neither concept interacts
with the other; both compose into the Targeting Hints Picker without
coupling.

### 3.3 Where Packs sit relative to tenants

Packs are a Client-level concept inside a Tenant. The same Tenant may
operate Clients with different pack sets. Packs do not interact with
tenancy; they interact with which Client is being looked at. This is the
architectural shape that makes Packs cheap — they slot into the existing
Client record without touching the multi-tenancy machinery.

The relationship to Capabilities Note §11 (tenant variants) is
straightforward. Variant 1 tenants (platform plus managed data) consume
the platform's pack catalogue as-is; their Clients toggle from the
platform-curated set. Variant 2 tenants (their own data, their own
dimensions) will eventually need tenant-defined packs — that is the
productisation horizon, named in §10 below as a deliberate non-goal for
v0.1 and a clean future extension.

## 4. Pack catalogue v0.1

The catalogue in v0.1 has three entries. Two are specified; one is
reserved-but-empty. The catalogue is platform-curated; tenant-defined
packs are deferred (see §10).

| Pack ID              | Status in v0.1 | Dimensions in pack (initial; subject to content-design pass) |
|----------------------|----------------|---------------------------------------------------------------|
| `healthcare`         | Specified      | Therapy Area (existing dimension); Drug Development Phase (new); Healthcare-Comms Work Type (new — internal comms / medical education / KOL / patient advocacy as values). |
| `tech-b2b`           | Specified      | Product/Module (new — values like SAP HR vs ERP, Kaleyra CCaaS vs CPaaS); Vertical-Sold-Into (new — the buyer's industry from a B2B vendor's perspective). |
| `marketing-services` | Reserved (empty) | Deliberately empty in v0.1. The pack ID exists; no dimensions are bound to it yet. Content-design pass is deferred until real operational practice surfaces what belongs in it. Clients can carry the pack toggle from day one with no effect. |

The dimensions named within Healthcare and Tech-B2B include both
existing Reference-Data-Spec dimensions (Therapy Area is already
specified) and net-new dimensions that this work introduces (Drug
Development Phase, Product/Module, etc.). The new dimensions follow the
Reference Data Spec's existing entity-schema patterns and are added
through the Reference Data Spec's existing curatorial mechanism
(category-edit-proposal Work Items). Pack content is stable in spec but
flexible in reference data — adding a new value to a Therapy Area is
curatorial work, not a Packs-spec amendment.

The decision to include Marketing Services as an empty reserved pack is
deliberate. It signals that Marketing Services is a recognised work
shape; it leaves the door open for content-design work without that work
blocking v0.1 shipping; and it makes the migration story trivially
correct for Clients that today do Marketing Services work — they get
the marketing-services pack toggled on, with no behavioural change
because the pack is empty. When real operational practice surfaces what
belongs in the pack, the dimensions get added; existing Clients with the
toggle on inherit them automatically.

> **Implementation note for v0.1.** Per §10.1, the actual content of
> each dimension is a content-design exercise that follows this spec.
> Cline ships Packs v0.1 with the catalogue stood up and the reference
> data structurally in place; the Healthcare and Tech-B2B *values* are
> stubs / empty reference-data documents that the curatorial workflow
> fills in afterwards. The platform code, helper, reseed and picker do
> not depend on any specific values existing.

## 5. The data model

### 5.1 Client record extension

The Client record gains one new field:

```
packs: string[]
```

A flat array of pack IDs from the catalogue. The order is not
significant. Empty array means no optional packs are active; the Client
operates on universal core dimensions only. The field is required (not
nullable) to make 'no packs' explicit rather than a default-by-omission
state.

No other fields on the Client record are affected. The field is
additive.

### 5.2 Pack catalogue location

The pack catalogue lives in the canonical reference store at:

```
platform/reference/packs/items/{packId}
```

The path follows the convention established by Reference Data Spec
Amendment 2 (the `items` sub-collection segment). Each pack document
carries:

> **Implementation note (Cline, May 2026).** The path as written above
> is structurally invalid in Firestore: `platform/reference/packs/items/
> {packId}` is 5 segments and so terminates in a collection name, not
> a document path. The implementation flattens to the 4-segment doc
> path `/platform/reference/packs/{packId}` — Packs is a single flat
> collection with no sub-types, so the `items/` segment is
> unnecessary, and the same Reference Data Spec Amendment 2 reasoning
> applies. The Hub reader (`PACKS_BASE_PATH`), the Core standup script
> (`standup-pack-catalogue.ts`), and the slice handover note are
> aligned on the flattened path. A future Packs-spec v0.2 amendment
> should carry the path correction; until then, this in-tree mirror
> records the deviation.

- `id` — the pack ID string (e.g. `healthcare`, `tech-b2b`,
  `marketing-services`).
- `displayName` — human-readable name used in admin UIs and logging.
- `description` — short description of when this pack applies.
- `status` — `active` or `reserved`. A `reserved` pack
  (e.g. `marketing-services` in v0.1) is in the catalogue and can be
  toggled on a Client, but currently binds to no dimensions.

The pack catalogue does not list its bound dimensions. Pack-to-dimension
membership is held on the dimension side, not the pack side, because
dimensions are versioned and curated through the Reference Data Spec's
existing machinery; replicating membership on packs would create a
synchronisation problem with no upside.

### 5.3 Dimension-to-pack membership

Each dimension definition in the targeting dimensions reference store
gains an optional field:

```
packs: string[]
```

If empty or absent, the dimension is universal core (applies to every
Client). If populated, the dimension applies only when one of the listed
packs is active on the Client. The field lives on the dimension's own
document, alongside its existing schema. It is read alongside the
dimension's other metadata at picker-resolution time.

The field is set by the Reference Data Spec's existing curatorial
workflow — a curator proposing a new dimension specifies its pack
membership; a category-edit-proposal Work Item can amend it. No new
curatorial Work Item type is needed.

### 5.4 The dimension-resolution helper

Every consuming surface needs the same answer to the same question:
"given this Client, which dimensions apply?" The platform provides a
single helper that answers it:

```
resolveDimensionsForClient(client) → Dimension[]
```

The helper resolves the universal core (dimensions whose `packs` field
is empty) plus dimensions whose `packs` field intersects the Client's
`packs` array. The result is the ordered list of dimensions the
Targeting Hints Picker should offer when called from a surface bound to
that Client.

The helper reads through the snapshot interface specified in
Capabilities Note §4.6 — dimensions are reference data, the snapshot is
held for the unit-of-work duration, and the helper consumes the snapshot
rather than fetching per-call. This composes Packs cleanly into the
platform's standard read pattern; high-volume callers (which are not yet
present, since the picker is interactive UI) inherit the cache contract
automatically if they ever appear.

> **Implementation in this slice.** Lives in
> `src/lib/packs/resolveDimensionsForClient.ts`. The Exchange copy
> accepts a pre-fetched dimension catalogue rather than performing the
> snapshot fetch itself, so surfaces compose with the read pattern they
> already use (Server Component, API route, etc.). Unit tests in
> `tests/packs/resolveDimensionsForClient.test.ts`.

## 6. Migration

Two migration questions: how do existing Clients acquire their initial
pack toggles, and how does the canonical reference store gain the packs
collection.

### 6.1 Initial pack toggles for existing Clients

Existing Clients in Salesforce carry an industry tag and various
internal classifications that approximate the work shape. The migration
uses these as a heuristic to set initial pack toggles. The heuristic is
deliberately simple:

- Clients with Salesforce industry indicating healthcare-adjacent work
  (pharmaceuticals, biotech, medical devices, healthcare services) get
  the `healthcare` pack.
- Clients with Salesforce industry indicating tech-B2B work (software,
  IT services, telecommunications-as-vendor) get the `tech-b2b` pack.
- All Clients get the `marketing-services` pack (it is empty in v0.1; no
  behavioural effect; recorded for forward-compatibility).

The heuristic produces wrong answers for some Clients. This is expected
and is fine. After migration, an operator scans the heuristic-applied
toggles and overrides where the heuristic is incorrect. Override is a
single edit on the Client record. The migration is not a one-shot
decision; it is a starting point that operators correct.

The migration runs under Reseed Pattern v0.1, since Exchange remains in
the seed-data era per the Migration Pattern Amendment §0.5. The reseed
structure is the standard three-part shape — read existing Clients,
write the new shape with packs populated by heuristic, delete-old as a
separate operator step. The single `reseed.completed` event is emitted
on completion per Reseed Pattern §3.1.

> **Implementation in this slice.** Heuristic in
> `src/lib/packs/heuristic.ts`; reseed script at
> `scripts/reseed-clients-packs-v0_1.ts`. The reseed is ID-stable: each
> existing Client document is updated in place, with `schemaVersion`
> bumped to `packs-v1`. Re-runs are no-ops because already-bumped
> documents are skipped — important because operators correct the
> heuristic afterwards, and a re-run must not undo their work.

### 6.2 Canonical reference store population

The packs collection at `/platform/reference/packs/items/` is created
and seeded with the three v0.1 entries (`healthcare`, `tech-b2b`,
`marketing-services`). Seeding follows the standup pattern established
for the targeting dimensions canonical store in BSP-02-01. The
`marketing-services` pack is created with `status: 'reserved'`; the
other two with `status: 'active'`.

Existing dimension documents in `/platform/reference/targetingDimensions/`
are amended to gain the optional `packs` field. Universal-core
dimensions (Geography, Service Type, Sector) leave the field empty.
Therapy Area gains `packs: ['healthcare']`. New pack-bound dimensions
added by this work (Drug Development Phase, Product/Module, etc.) are
created with the appropriate `packs` field populated. The amendment is
mechanical and runs as part of the same reseed pass.

> **Implementation in this slice.** Catalogue standup in
> `angsana-core-prod-project/functions/scripts/standup-pack-catalogue.ts`.
> The actual *values* inside each pack-bound dimension (Therapy Area
> values, Drug Development Phase values, etc.) are content-design work
> per §10.1 and land via the curatorial workflow afterwards.

## 7. Surface integration

Every surface that lets a user pick targeting dimensions calls
`resolveDimensionsForClient` once and uses the result. The surface does
not need to know which dimensions are universal and which are
pack-bound; the helper hides the distinction. New surfaces inherit the
contract by calling the helper.

| Wave | Surfaces affected (consume the dimension-resolution helper) | Surfaces not affected |
|------|--------------------------------------------------------------|------------------------|
| First wave (with this spec) | Wishlists; Propositions/ICP; Conflicts; Exclusions; Relationships; Campaigns. All are Exchange surfaces that will consume the Targeting Hints Picker. | Refinery (ingests targeting dimensions but does not present a picker UI); Research Hub Curatorial Sub-Module (curates dimensions themselves; not Pack-aware); Dialer Lab (out of scope of multi-tenant platform). |
| Future waves | Any new Exchange surface that lets the user pick targeting dimensions. The dimension-resolution helper is the integration point; new surfaces inherit the contract. | Security rules, event types, AI catalogue, API endpoint URLs (the Client returns its `packs` field, but no other API surface changes shape). |

The integration point is intentionally minimal. A surface that wants to
render a targeting hints picker calls
`resolveDimensionsForClient(client)` and passes the result to the picker
as its `availableDimensions` prop (per the companion Targeting Hints
Picker spec). The surface does not need its own pack-awareness; the
helper is the only Pack-aware code in the consuming application.

> **Wishlists adoption deferred.** Per the slice handover, the actual
> Wishlists picker adoption is sliced separately (after the
> Wishlists v0.2 work has settled). This slice ships the helper and the
> picker component; the Wishlists rewrite to consume them is its own
> later slice.

## 8. Relationship to existing specs

### 8.1 Targeting Dimensions Reference Data Spec

This spec adds one optional field (`packs`) to the dimension entity
schema. The seven existing entity types and their schemas are otherwise
unchanged. The Cluster Layer Amendment (Amendment 1) is unaffected —
clusters operate within a dimension's value space; packs operate at the
level of which dimensions exist for which Clients. The two concepts
compose without interaction.

The Path Correction Amendment (Amendment 2) is observed by this spec —
the packs collection lives at `/platform/reference/packs/items/{packId}`,
with the `items` segment per the corrected convention. The dimension
documents already use the corrected paths.

### 8.2 Capabilities and API Surface Note v0.2

The model/values split (§10) classifies this work cleanly. Packs are
part of the model — the architectural shape — and live in code and
schemas. Pack content (which dimensions are bound to which packs, which
values are in those dimensions) is data and lives in the canonical
reference store. The split is preserved without strain.

The platform reference data caching pattern (§4.6) covers Packs reads
automatically. The dimension-resolution helper consumes the snapshot
interface; new pack toggles take effect for a Client at the start of the
next unit of work that fetches a fresh snapshot. Mid-session pack
changes are not invalidated; this is consistent with the
bounded-lifetime contract and is the correct behaviour for a
low-frequency configuration change.

The supersession discipline (§1.4) applies to v0.1 of this spec. The
`marketing-services` pack as empty-reserved is the explicit supersession
trail for the future moment when content lands in it; the Client field
migration is a single named transition rather than a silent edit.

### 8.3 Platform Vision and Component Architecture v0.2

The data-home principle (§3.7) is honoured. Packs reference data lives
in Core's Firestore; consuming applications read through the Platform
API. Clients already live under the tenant subtree; the `packs` field
addition is a Client-record extension that respects the existing data
home.

The white-label productisation framing (§7.7) is materially advanced by
Packs. A future Variant 2 tenant whose work mix differs from Angsana's
adopts the universal core plus the packs that fit their work; the
platform code does not branch by tenant. This is the architectural shape
that makes white-labelling tractable rather than a fork. §10.2 below
names the future extension to tenant-defined packs as a clean
continuation of this trajectory.

## 9. Containment commitments

The architectural value of Packs is in how narrow the abstraction is.
The five commitments below are the discipline that keeps it narrow. They
are recorded explicitly so that future questions of the form 'but what
if packs also did X' can be answered against a stated boundary rather
than re-litigated each time.

| Commitment | What it means in practice |
|------------|---------------------------|
| Packs determine which dimensions apply, and nothing else. | Packs do not influence Research Assistant prompt variations, Refinery cleaning pipelines, AI catalogue applicability, security rule shape, event types, or any other behavioural variation. Behavioural differences between client shapes, if they emerge, are designed and named separately. |
| Packs do not carry their own logic or lifecycle events. | There is no pack lifecycle to subscribe to, no pack state machine, no pack composition rules. A pack is a tag with a static dimension membership. Adding or removing a dimension from a pack is curatorial work (a Reference Data Spec edit), not a Packs-feature operation. |
| Packs do not compose dynamically. | A Client carries a flat list of pack IDs. There is no inheritance between packs, no pack-of-packs, no rules about which packs imply which other packs. The flat-list model is what keeps the abstraction cheap. |
| The pack catalogue is platform-curated and closed-set in v0.1. | The three pack IDs in §4 are the catalogue. Tenant-defined packs are a future productisation question (likely tied to Variant 2 onboarding under Capabilities Note §11.2), explicitly out of scope for v0.1. |
| If anyone asks 'but what if packs also did X' — push back, do not extend. | The architectural value of Packs comes from how narrow the abstraction is. Each extension dilutes that value. Future genuinely-Packs-shaped concerns (a new pack, a new dimension joining an existing pack) land cleanly without changing the model. Anything beyond that gets its own concept, named separately. |

The fifth commitment is the most important and the one most likely to be
tested. The temptation to extend Packs will recur. Each extension
dilutes the value of the abstraction. The containment is what makes
Packs cheap to build, cheap to maintain, and easy for a future reader
(including acquisition technical due diligence) to understand. A future
genuinely-Packs-shaped concern lands cleanly without changing the model;
anything beyond Packs gets its own concept.

## 10. Deliberate non-goals and future extensions

Three specific futures are named here as out-of-scope for v0.1 and as
clean extensions when their time comes.

### 10.1 Pack content design

This spec names the dimensions in Healthcare and Tech-B2B at v0.1 grain.
The actual content of each dimension — the Therapy Area values, the Drug
Development Phase values, the Product/Module values — is a
content-design exercise that follows this spec. Senior team
conversations and real-data review surface what belongs in each
dimension; the curatorial workflow specified in the Reference Data Spec
is the mechanism for adding it.

Marketing Services as an empty pack is the headline case. The pack ID
exists from v0.1; content lands when operational practice tells us what
should be in it. Until then, Clients toggling `marketing-services` on
get the same experience as those that don't.

### 10.2 Tenant-defined packs

In v0.1, the pack catalogue is platform-curated. A Variant 2 tenant
(per Capabilities Note §11.2) bringing their own dimensions will
eventually need to define their own packs. The extension is
straightforward when the time comes — a tenant-overlay mechanism
analogous to Reference Data Spec §11's Posture 3 model — but is
deliberately deferred. Building it speculatively without a real Variant
2 tenant to shape it would produce the wrong abstraction.

When the first real Variant 2 tenant onboards, this spec amends to add
tenant-defined packs as a non-breaking extension. Existing Variant 1
tenants and the platform-curated catalogue are unaffected by that
amendment.

### 10.3 Behavioural variation by pack

Packs determine which dimensions appear; nothing else. If the platform
later needs behavioural variation by client shape — a different Research
Assistant prompt for healthcare-comms work, a different Refinery
cleaning rule for tech-B2B — that variation is its own concept, designed
against its own use cases. It is not a Pack feature.

This is a hard boundary. Behavioural variation looks superficially
similar to dimensional variation but is operationally and
architecturally different: it touches different services, different
data, different lifecycle events. Conflating the two would dilute Packs
into a general configuration-by-client-shape mechanism, which is the
failure mode the typology de-escalations of the origin conversation
specifically rejected.

## 11. Acquisition due diligence framing

The Packs concept is the kind of architectural backbone that an
acquiring company's technical due diligence rewards. Three properties
make it so.

First, it solves a real productisation problem cleanly. A platform that
can serve different work shapes without forking its codebase is the
shape that scales across customers; a platform that cannot is one that
re-architects every customer. Packs is the mechanism for the former.
Naming this commitment explicitly in the spec — and showing the
commitment held by the containment commitments — is what makes the
architecture legible to a reviewer without operational context.

Second, the abstraction's narrowness is a feature, not a limitation. A
reviewer reading this spec can grasp the entire concept in five minutes
and predict its behaviour against any new question. The discipline of
the containment commitments — the explicit non-goals, the rejected
typology, the deferred futures — is what makes the abstraction this
readable. Resisting extensions is the architectural work.

Third, the white-label trajectory is named and unblocked. The Variant 2
tenant story (Capabilities Note §11.2) and the tenant-defined packs
extension (§10.2 above) form a concrete path to white-label
productisation that does not require re-architecture. A reviewer can see
how the platform reaches that future from where it is today, with each
step a clean amendment rather than a rewrite.

## 12. What this spec does not do

Several things are deliberately out of scope. Listing them explicitly
avoids ambiguity.

- This spec does not design the Targeting Hints Picker UI. The picker
  spec is the companion document, drafted in tandem; this spec specifies
  what feeds the picker (the dimension-resolution helper), not how the
  picker itself works.
- This spec does not specify the substantive content of any pack. The
  Healthcare and Tech-B2B pack contents are named at dimension grain;
  the values inside each dimension are the curatorial workflow's
  concern.
- This spec does not change the Targeting Dimensions Reference Data
  Spec's substantive architecture. It adds one optional field (`packs`
  on dimension definitions) and one new collection (packs catalogue).
  Everything else is unchanged.
- This spec does not specify any behavioural variation between Clients
  beyond which dimensions appear. Per §10.3, behavioural variation is
  its own concept and is not a Packs concern.
- This spec does not specify the migration timing for individual Clients
  beyond the heuristic-based initial population. Operators correct the
  heuristic over time; that work is operational, not architectural.

## 13. Document control and review

- **Author:** drafted in conversation with Keith. Triggered by
  `HANDOVER_Dimension_Packs_Concept.md`, which is the design intent and
  origin story; this spec is its formalisation.
- **Review:** Cline (data-side implementation reference); Exchange
  product owner; Refinery and Research Hub teams as future read
  consumers; LGaaS architecture review.
- **Trigger for v0.2 of this spec:** any of (a) the first
  content-design pass on Healthcare or Tech-B2B reveals a structural
  gap in the model; (b) a Variant 2 tenant onboards and tenant-defined
  packs are needed; (c) a behavioural-variation-by-client-shape concern
  arises and needs to be cleanly distinguished from Packs (forcing the
  §10.3 boundary to be more sharply written).
- **Companion document:** Angsana Targeting Hints Picker v0.1, drafted
  in tandem with this document. The picker consumes Packs through the
  dimension-resolution helper; the picker spec carries the polarity
  model (Include/Exclude on Propositions and Campaigns; positive-only
  on Wishlists and Prospecting Rules), the call modes (catalogue /
  narrowing / single-target), and the selection-at-depth model with
  empty-means-all semantics. Neither document is complete without the
  other in the consumer's hands; they are deliberately separated to
  let each remain focused and amendable independently.

---

*Draft v0.1 · May 2026 · Internal — Confidential*
*Angsana Platform — Dimension Packs v0.1*
