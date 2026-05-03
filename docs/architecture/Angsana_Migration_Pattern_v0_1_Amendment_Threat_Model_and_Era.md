# Angsana Migration Pattern v0.1

## Amendment — Threat Model and Era

**v0.1 amendment — Platform pattern document**

| Field        | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Status       | Draft for review                                                                            |
| Audience     | Cline; future agents implementing migrations across the platform; LGaaS architecture review |
| Date         | April 2026                                                                                  |
| Amends       | Angsana Migration Pattern v0.1                                                              |
| Companion    | Angsana Reseed Pattern v0.1 (lightweight pattern for the seed-data era; cited from this amendment) |
| Discipline   | One amendment per document. This is the first and only amendment to the Migration Pattern; subsequent changes are made via consolidation into Migration Pattern v0.2 (a clean successor document). |

> This is the in-tree mirror of the platform pattern amendment. It is committed
> alongside the slice spec it governs so that the implementation reference is
> grounded in the repo. The authoritative copy lives at LGaaS level.

---

## 1. Purpose of this amendment

Migration Pattern v0.1 was drafted under an implicit assumption: the machinery it specifies (pre-snapshot, idempotency markers, rollback procedure, per-document outcome logging, four migration events) earns its weight from the moment of first adoption. The Wishlists slice deployment surfaced that this assumption holds only once a component's data home contains real client data; against seed-data-only environments, the machinery exercises correctness rather than protecting irreplaceable data.

This amendment introduces a section to the Migration Pattern that names the era in which the full pattern applies, names the lighter companion pattern (Reseed Pattern v0.1) that applies during the seed-data era, and names the per-component trigger condition for switching from the lighter pattern to the full Migration Pattern.

The amendment does not change the Migration Pattern's machinery. The six-part script structure, the safety mechanisms, the migration log shape, the four migration events, and the audit-collection trigger conditions all remain as specified in v0.1. What changes is the framing at the front of the document: when does the full pattern apply, and what applies before then.

## 2. New §0 to be inserted at the front of Migration Pattern v0.1

The following new section §0 is to be inserted at the front of Migration Pattern v0.1, immediately after the metadata block and before the existing §1 ("What this document is"). The remaining sections of v0.1 are untouched by this amendment.

### §0 Threat model and era

#### §0.1 Two patterns under one era trigger

The platform recognises two patterns for data shape changes:

- **Reseed Pattern v0.1** applies during a component's seed-data era, when the component's data home holds only seed or test data. It is forward-only, three-step (read → reseed → delete-old as a separate operator step), with minimal ceremony (one `reseed.completed` event, a local log, `schemaVersion` bump on reseeded records).

- **Migration Pattern v0.1** (this document) applies in the post-seed era, when the component's data home holds real client data. It carries the full machinery — pre-snapshot, idempotency markers, rollback procedure, four migration events, audit-collection trigger conditions — calibrated against a protect-real-production-data threat model.

The two patterns are siblings, not predecessor and successor. The Migration Pattern is not a later version of the Reseed Pattern; they live alongside each other under a per-component era trigger.

#### §0.2 The trigger is per component

The choice between the two patterns is made per component. Each component (Exchange, Refinery, Research Hub, Core, and so on) carries its own data home with its own threat model, and each component graduates from the seed-data era independently. A real client onboarded to Exchange does not flip the trigger for Refinery; a Refinery batch run against test data continues to use Reseed Pattern even after Exchange has moved to Migration Pattern.

This per-component framing is deliberate. A platform-wide trigger sounds tidier on paper but conflates two different things: operational discipline (which pattern do I reach for) and threat model (what am I protecting against). The threat model is genuinely per-component; forcing all components into the heavier pattern because one of them holds real data would be ceremony in service of false symmetry.

#### §0.3 The trigger condition

For a given component, the trigger to switch from Reseed Pattern to Migration Pattern fires when the component's data home first holds real client data. A real client is one whose data, if lost, would represent a meaningful operational or commercial setback. A pilot client whose data is itself seed-derived (loaded for demonstration, not generated by real operational use) does not flip the trigger. A pilot client whose data represents real operational use — real client conversations, real wishlists, real conflicts — does flip the trigger, regardless of whether the pilot has formally graduated.

The judgement is operational, not contractual. The component's spec or build sequence records the era and the trigger fires when that record is updated.

#### §0.4 What this means for adopting agents

A developer or agent reaching for a migration script consults the component's documentation to determine the era. If the component is in the seed-data era, the operation goes under Reseed Pattern v0.1. If the component is in the post-seed era, the operation goes under this Migration Pattern.

If the operation needs to create side-effect entities (Work Items, So Whats, related records of any kind), the threshold of reseed is crossed and the Migration Pattern applies regardless of era. Reseed Pattern is for shape changes to existing documents; once side effects are in scope, the heavier machinery is needed even against seed data, because the cost of unwound side effects is real even when the underlying data is not.

#### §0.5 Current era of each component

At time of this amendment (April 2026), the era of each component is:

| Component       | Era            | Reasoning                                                                                                                  |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Exchange        | Seed-data era  | Cegid Spain pilot status is seed/test data; trigger has not yet fired. Reseed Pattern applies.                              |
| Refinery        | Seed-data era  | Phase 1 hardening operates against test data. Reseed Pattern applies for shape changes; Migration Pattern applies for any operation creating side-effect entities. |
| Research Hub    | Seed-data era  | Curatorial sub-module read surface (BSP-02-02a) reads from seed data. Trigger fires when the write surface ships and real curatorial work lands. |
| Core            | Seed-data era  | No real client data yet resident. The R2 PVS relocation from Exchange will itself be a Reseed (per the relocation living wholly within the seed-data era). |

Dialer Lab is excluded from this table. It is in pilot with real users and real client data, but is also outside the multi-tenant platform substrate by historical decision (per Platform Vision v0.2). Its data shape changes, when they happen, sit outside this pattern set; they are governed by Dialer Lab's own operational discipline.

This table is the canonical record of component eras at the time of this amendment. When a trigger fires for a component, the component's era marker is updated in its own spec or build sequence document, and this table is updated in a future consolidation pass (Migration Pattern v0.2 or a successor amendment).

## 3. Effect on the existing sections of v0.1

None of the existing sections of Migration Pattern v0.1 are amended by this document. The six-part script structure (§2), the safety mechanisms (§3), the migration log (§4), the migration events (§5), the audit-collection trigger (§6), the deliberately-deferred items (§7), and the adoption-and-review framing (§8) all stand as written.

Two small clarifications, surfaced by the framing this amendment introduces, are worth flagging without amending the existing sections themselves:

- **§8.1 First adopters.** v0.1 names the Wishlists slice migration as the first adopter. Under the era framing introduced here, the Wishlists migration was correctly built under the Migration Pattern at the time — the Reseed Pattern did not yet exist. Subsequent R2 PVS slice migrations (Conflicts, Exclusions, Relationships) are properly Reseed Pattern adopters under the era framing, because Exchange remains in the seed-data era. This is a re-categorisation only; nothing about the Wishlists migration as built is affected.

- **§6 audit-collection trigger.** The audit-collection trigger conditions in v0.1 §6.1 remain valid. They become operationally relevant once a component's era flips and migrations under the full Migration Pattern begin to accumulate. Until then, the trigger conditions are dormant by virtue of the era — there are no migrations under this pattern to count.

## 4. Effect on related documents

The era framing introduced here implies small clarifications in two related documents, to be made when those documents are next opened:

- **Exchange R2 Prospecting Validation Surfaces v0.1** (architectural settling document). The §6 migration sections for Conflicts, Exclusions, and Relationships should cite Reseed Pattern v0.1 rather than Migration Pattern v0.1 for their seed-data-era execution. The language around "Cegid Spain test client" and "production migration" should be recalibrated to reflect that Cegid Spain's current pilot status is seed-data-era operation.

- **Each component's build sequence or spec.** When the relevant component's build sequence is next amended (notably the LGaaS Build Sequence v0.2), an era marker line is added to indicate the component's current era and the trigger condition for switching. This is light-touch — a single sentence per component — and does not require a wholesale revision of the build sequence.

These are noted-and-deferred. They do not block this amendment; they fall out naturally as those documents are next opened for other reasons.

## 5. Document control

Author: Drafted in conversation with Keith. Triggered by the LGaaS-level Learnings memo from R2 PVS Slice 1 (Wishlists), specifically learning 1 (migration machinery is over-shaped for the seed-data era).

Companion document: Angsana Reseed Pattern v0.1 — the lightweight pattern this amendment refers to. The Reseed Pattern is itself a new document drafted alongside this amendment. The two together close learning 1 of the Wishlists Learnings memo.

Sign-off: Keith — amendment sign-off ahead of the Conflicts slice migration design (which becomes the first adopter under Reseed Pattern).

Consolidation note: Per the established documentation discipline (one amendment per document, then consolidate), this is the first and only amendment to Migration Pattern v0.1. Any subsequent changes to the Migration Pattern are made via consolidation into a clean Migration Pattern v0.2 successor document, which incorporates this amendment as part of the new §0.
