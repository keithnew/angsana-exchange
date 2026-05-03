# Angsana Exchange — Wishlists v0.2 Slice Spec

| Field        | Value |
| ------------ | ----- |
| Version      | v0.1 — Draft for Cline review |
| Status       | Draft for review |
| Audience     | Cline (immediate implementation reference); Exchange product owner |
| Date         | May 2026 |
| Supersedes   | Nothing — additive slice on top of the live Wishlists surface |
| Related      | Exchange R2 Prospecting Validation Surfaces v0.1 §6.1 (Wishlists structured record); Capabilities and API Surface Note v0.2 §1.4 (supersession discipline); Reseed Pattern v0.1 (Exchange is in seed-data era; Wishlists slice has already adopted); HANDOVER_Wishlists_Feedback_and_Learnings.md (source of the senior team session feedback) |

> This is the in-tree mirror of the v0.2 slice spec, committed alongside the
> implementation. The authoritative copy lives at LGaaS level. Acceptance
> criteria below govern the implementation.

---

## 1. What this slice is

A short Cline-sized slice on the live Exchange Wishlists surface. Four concrete changes; one schema bump; one reseed under the Reseed Pattern. Designed to be specifiable in this document, executed in a single Cline pass, and shipped before any of the larger architectural threads (the Targeting Hints picker, Dimension Packs, the Task primitive, the audience/assignment taxonomy) need to land.

It exists because the senior team session on Wishlists surfaced a mix of inputs at different levels of architectural weight. Some are slice-level and immediately actionable; some are architectural and need their own design treatment. This slice ships the slice-level items without entangling them with the architectural threads.

## 2. What changes

Four user-facing changes plus the schema and reseed work to support them.

### 2.1 Source field removed from UI

The Source dropdown is removed from the wishlist creation form. The Source line is removed from the wishlist detail view. The database column is retained per supersession discipline (§1.4 of the Capabilities and API Surface Note); existing values stay where they are; new entries default to a new sentinel value `'unspecified'`.

The reasoning is in the upstream handover. In short: clients own their wishlists, so requiring them to justify their own wishes via a Source dropdown is the wrong friction. Provenance is already captured by `addedBy` / `addedAt`. Intent belongs in Discussion. Internal classifications like 'migration' or 'AI-suggestion' are structural and can be set by system rather than by user. None of those needs a user-facing field.

### 2.2 Website field added

An optional **Website** field is added to the wishlist creation form, placed near the company-identifying fields. Free-text URL string. No validation beyond well-formedness. Displayed on the detail view when populated, with an edit affordance.

The value of this field is real: it makes Salesforce Account binding dramatically easier for both Refinery's identity binding pipeline and any future match-on-add typeahead. It also gives the AM or client a place to record the company they actually mean when names are ambiguous (multiple unrelated companies share a name; an entry says 'Acme' but means 'Acme UK Ltd').

### 2.3 Research Assistant context field reserved

An optional `researchAssistantContext` field is added to the wishlist data model, exposed in the detail view to internal users only. Free-form text. Empty by default. Not surfaced to client-tenant users. Not consumed by Research Assistant in this slice — the field is reserved for the future integration.

This is a deliberately small step. The architectural question (can clients use Research Assistant on wishlist entries?) has a straightforward answer — yes, with care. The productisation question (pricing, rate-limiting, auto-add behaviour) is unsettled. Reserving the field now means when the productisation answer lands, the data substrate is already there; no schema migration is needed at that point.

### 2.4 Discussion-presence indicator on the list view

The wishlist list view today does not surface whether a given row has substantive Discussion attached (open Work Items, recently-closed Work Items with notable activity). A user scanning the list cannot tell which rows have ongoing conversation without opening each one. This is the buried-discussion problem named in the upstream handover as a candidate platform-level observation.

This slice fixes it for Wishlists specifically. Each list row carries a small discussion indicator — an icon, a count, or both — when there is at least one open Work Item attached, or at least one Work Item that has been updated within a recency window (default seven days, internal config). The indicator is glanceable; hover or tap reveals the count and most-recent-update timestamp.

The pattern is general — Conflicts, Exclusions, Relationships will want it too — but this slice only implements it for Wishlists. The pattern can be lifted into a shared component when the second surface adopts it; not now.

## 3. Schema deltas

All deltas to the wishlist entry document type. No changes to Work Item types or related collections.

| Field                      | Type                  | Change                                  | Notes |
| -------------------------- | --------------------- | --------------------------------------- | ----- |
| `website`                  | string (URL)          | Add — optional                          | Free-form URL string. No URL validation beyond basic well-formedness check (i.e. parseable as URL). Empty is valid. |
| `researchAssistantContext` | string (free text)    | Add — optional, internal-only           | Reserved field. Not surfaced to client-facing UI in this slice. Internal users can populate via the detail view; field persists; no other surfaces consume it yet. |
| `source`                   | enum                  | Retain in schema — remove from UI       | Database column kept for supersession discipline. Existing values on existing entries are preserved verbatim by the reseed (see §4). New entries created via the UI post-deploy are written with `source = 'unspecified'` (a new enum value added in this slice). System processes (the reseed itself, future RA integration, etc.) may still write any enum value. Form does not collect it; detail view does not display it. |
| `sourceDetail`             | string                | Retain in schema — remove from UI       | Companion to `source` on the R1 surface. Existing values preserved verbatim by the reseed; no UI surface collects or displays it post-deploy. Same supersession trail as `source`. |
| `schemaVersion`            | string                | Bump                                    | Per Reseed Pattern §2: bump `schemaVersion` on the wishlist entry document type to mark the new shape. Existing entries reseed to the new version with `website` empty, `researchAssistantContext` empty, `source` preserved. Target value: `r2-pvs-wishlist-v2`. |

On `source` values across the lifecycle: existing entries keep their existing `source` values verbatim (preserved by the reseed in §4 — entries written before this slice carry whatever was set: `'client-request'`, `'migration'`, `'ai-suggestion'`, and so on). Brand-new entries created via the UI post-deploy are written with `source = 'unspecified'`. System processes — the reseed itself, future Research Assistant integration, future bulk import — may still write any enum value. The discipline is: `source` is no longer a user-facing field; the column and its enum live on; new UI-driven creation defaults to `'unspecified'` to make 'no one chose this' legible from 'no one had to'.

## 4. Migration approach

Exchange remains in the seed-data era per the Migration Pattern v0.1 Amendment (Threat Model and Era), §0.5 component era table. This slice's data shape change adopts the **Reseed Pattern v0.1**, not the full Migration Pattern.

Three-part reseed script per Reseed Pattern §2:

1. **Read** all existing wishlist entries from the Cegid Spain test client tenant.
2. **Reseed**: write new-shape documents in the same collection (in-place, same Firestore document IDs — preserving downstream `subject.entityId` references on Work Items), distinguishable by `schemaVersion` (per §3.3). Existing fields preserved verbatim including `source` and `sourceDetail`; `website` set to empty string; `researchAssistantContext` set to empty string.
3. **Delete-old**: separate, deliberate operator step under the `--delete-old` flag (per §2.1's two-step execution model). For this ID-stable reseed the step degrades to a verification sweep (per Reseed Pattern §2.1) — there are no separate old-shape documents to delete. The script logs this clearly and reports any v1 stragglers it would otherwise have deleted.

Per Reseed Pattern §3.1, the script emits a single `reseed.completed` event through the standard event publisher when the reseed step finishes, with the payload Reseed Pattern §3.1 specifies (pattern, collection, count reseeded, count errored, schemaVersion source and target, operator identity). No started event, no per-document event.

Per Reseed Pattern §3.2, the script writes a structured log to stdout and to `reseeds/r2-pvs-wishlist-v2-{timestamp}.json` with read/written/errored/deleted counts.

Per Reseed Pattern §3.3, each reseeded document carries the bumped `schemaVersion` (`r2-pvs-wishlist-v2`). Re-running the reseed against already-bumped documents is a no-op.

There is no pre-snapshot and no rollback procedure (per Reseed Pattern §5). If the new shape is wrong, the corrective action is to run another reseed against the current shape, not to restore from a prior state. The two-step execution model is what makes this safe — old documents remain in the collection until the operator explicitly invokes the delete step (or, for ID-stable reseeds, until the operator confirms the verification sweep is clean).

## 5. Supersession trail

Per Capabilities and API Surface Note v0.2 §1.4, deprecations are recorded as a documented trail rather than silent edits. This slice creates the following supersession entries (recorded in `r2-pvs-s1-wishlists-changelog.md`):

- **Source field on Wishlist UI** — superseded by removal in this slice. Database column retained. Future readers tracing why the field is in the schema but not in the UI find this spec as the deprecation record.
- **Source enum default value** — the `'unspecified'` value is added to the source enum in this slice. It is the post-deploy default for new entries.
- **Schema version bump** — `r2-pvs-wishlist-v1` → `r2-pvs-wishlist-v2` to mark the new shape (per Reseed Pattern §3.3).

No supersession entry is needed for the Website or `researchAssistantContext` fields — they are net-new, not replacements.

## 6. What is deliberately out of scope

Each of these has been considered for inclusion in this slice and deliberately left out. The trigger condition for revisiting each is named, so deferral is recorded rather than implicit.

| Item                                                       | Why deferred                                                                                                | Trigger to revisit |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| Targeting Hints picker                                     | Needs the Dimension Packs design first (Packs determine which dimensions appear). Specified in its own design document; Wishlists adopts the picker in a follow-on slice. | Picker + Packs design document v0.1 ships. |
| Person-of-interest sub-entries                             | Substantively new data shape; cascades to Conflicts and Relationships. Deserves its own design conversation, not a passenger on this slice. | Relationships per-surface spec begins. |
| Match-on-add Salesforce Account typeahead                  | Depends on Platform API v1 exposing typeahead-friendly Account search. Not standalone work.                 | Platform API v1 Phase 1 ships. |
| Client-facing Research Assistant integration               | Productisation decision (pricing, rate-limiting, auto-add vs suggestions). Architectural answer is straightforward; product answer is not. This slice reserves the field; integration is later. | Senior team productisation conversation concludes. |
| Audience/assignment taxonomy in Discussion                 | Pending Angela's input on how the research team allocates work today.                                       | Angela's input received; Work Item Allocation Pattern document drafted. |
| Task primitive surfacing on Wishlists                      | The platform Task primitive is itself undecided (placement: Hub vs cross-component). Not a Wishlists question. | Task primitive placement decided. |

The discipline: this slice ships the small, additive, decision-already-made items. The architectural threads have their own design tracks. Bundling them creates the over-stuffed-slice failure mode the original Outreach Briefing replacement work suffered from.

## 7. Acceptance criteria

The slice is complete when the following are all true.

| #  | Criterion |
| -- | --------- |
| 1  | Wishlist creation form does not display Source. Wishlist detail view does not display Source. Source is not editable from any surface. |
| 2  | Wishlist creation form has a Website field — optional, free-text URL, placed naturally near company-identifying fields. Wishlist detail view displays the website if populated; offers an edit affordance. |
| 3  | Wishlist detail view exposes a `researchAssistantContext` field for internal users — visible only to internal-tenant users, not to client-tenant users. Editable in the same way other internal-only fields are. Empty by default. |
| 4  | The wishlist list view shows a discussion indicator on each row when the row has at least one open Work Item attached, or at least one Work Item updated within the last seven days (default; internal config). The indicator is glanceable — visible without opening the row — and reveals count and most-recent-update timestamp on hover or tap. Specific rendering (icon, badge, count placement) is for Cline to propose at plan-pass; Keith decides. The implementation must not bake in Wishlist-specific knowledge in the rendering logic — see §8 watchpoint. |
| 5  | Reseed script under Reseed Pattern v0.1 has bumped `schemaVersion` across existing Cegid wishlist entries (per §3.3); the script emits the single `reseed.completed` event specified in Reseed Pattern §3.1 on completion of the reseed step; existing `source` and `sourceDetail` values are preserved verbatim; `website` and `researchAssistantContext` are written empty. The two-step execution model (per §2.1) is honoured — `--delete-old` runs only as a separate operator-invoked step after verification (or, for the ID-stable reseed here, as a verification sweep). |
| 6  | New wishlist entries created post-deploy carry `source = 'unspecified'` as the default written value. No UI element offers a different value. |
| 7  | Per §1.4 supersession discipline, this slice is recorded in the Wishlists slice changelog (`r2-pvs-s1-wishlists-changelog.md`) as the deprecation trail for the Source UI surface. Future readers can trace the removal back to this spec and the upstream handover. |

## 8. Risks and watchpoints

Three things worth flagging — none should block the slice, but all are worth Cline holding in mind during execution.

- **Source removal is the only deletion in the slice.** All other items are additive. The deletion is the highest-risk item in a small slice. The mitigation is the supersession trail and the database-column retention — the data is not lost, the surface is removed. If a downstream consumer (Refinery, a reporting query) was reading the source field, it continues to read the existing values; new entries return `'unspecified'` which the consumer needs to handle gracefully. Worth a quick consumer scan before the deploy.
- **The discussion-presence indicator is general but implemented locally.** Implementing it as a Wishlists-specific component is correct for this slice — second-surface generalisation is premature. But the implementation should not bake in Wishlist-specific knowledge that would block a later lift-into-shared-component. Treat the rendering logic as 'given a record reference, fetch its open and recently-updated Work Items, render the indicator'; not 'given a wishlist entry, do these specific lookups'.
- **The `'unspecified'` default value is a small breaking change** for any existing consumer that assumed `source` was always one of the existing enum values. Most consumers will tolerate it (it's just a string). The watchpoint is anywhere `source` is used as a discriminator for behaviour — those code paths need an `'unspecified'` branch, even if that branch is a no-op.

## 9. Document control

- **Author:** drafted in conversation with Keith. Triggered by `HANDOVER_Wishlists_Feedback_and_Learnings.md`, which consolidates the senior team session feedback on Wishlists with the original LGaaS-level Learnings memo from R2 PVS Slice 1.
- **Review:** Cline (immediate consumer of this spec); Exchange product owner.
- **Trigger for v0.2 of this spec:** any of (a) the Targeting Hints picker design lands and Wishlists is ready to consume it; (b) a downstream consumer of the source field surfaces an issue with the `'unspecified'` default; (c) the discussion-presence indicator pattern is generalised into a shared component and Wishlists adopts the shared version. None blocks v0.1 shipping.
- **Companion in-flight tracks:** Targeting Hints Picker and Dimension Packs Design Document v0.1 (next on Keith's drafting queue); Prospecting Rules per-surface specs (Conflicts, Exclusions, Relationships) sequenced after the picker design.

---

*Draft v0.1 · May 2026 · Internal — Confidential*
