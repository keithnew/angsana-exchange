# Wishlists slice — supersession changelog

The supersession trail for the Wishlists surface, recording deprecations
and replacements so future readers can reconstruct the surface's history
without spelunking through git. Maintained per Capabilities and API
Surface Note v0.2 §1.4.

Each entry names: what is being deprecated/replaced, what supersedes it,
the slice/spec where the change landed, and any data implications. New
entries are appended at the bottom; older entries stay in place.

---

## v0.2 (May 2026) — additive slice + Source UI removal

Spec: `r2-pvs-s1-wishlists-v0_2-spec.md`
Build: this commit (`scripts/reseed-wishlists-v0_2.ts` + the UI changes
listed below).

### Source field — UI surface removed; column retained

- **Deprecated:** Source dropdown on the Wishlist creation form; Source
  line on the Wishlist detail view.
- **Superseded by:** No replacement field. Provenance is captured by
  `addedBy` / `addedAt`; intent belongs in Discussion; internal
  classifications are structural and set by system rather than by user.
- **Why:** v0.2 spec §2.1. Clients own their wishlists; requiring them
  to justify their own wishes via a Source dropdown is the wrong
  friction.
- **Schema impact:** The `source` and `sourceDetail` columns are
  retained on the document type per supersession discipline. Existing
  values on existing entries are preserved verbatim by the reseed.
- **New default for UI-driven creates:** `source = 'unspecified'` (a
  new enum value added in this slice). System processes — the reseed
  itself, future Research Assistant integration, future bulk import —
  may still write any enum value.
- **Consumer impact watchpoint:** any downstream code that uses
  `source` as a discriminator for behaviour now needs an `'unspecified'`
  branch, even if that branch is a no-op. v0.2 spec §8 third bullet
  flags this. No active downstream consumer was identified at deploy
  time; if one surfaces, raise an issue and the v0.2 spec gets a v0.3
  amendment.

### Website field — added

- **Net new field; no supersession.**
- **Where:** `website: string | null` on the wishlist entry document.
- **Why:** v0.2 spec §2.2. Salesforce Account binding gets dramatically
  easier when the website is captured at the point of entry; also gives
  the AM or client a place to disambiguate when the same name covers
  multiple unrelated companies.
- **UI:** Optional input on the create form, near the company-identifying
  fields. Displayed on the detail view when populated, with an edit
  affordance.
- **Validation:** parseable-as-URL only; empty is valid.

### researchAssistantContext field — added (internal-only, reserved)

- **Net new field; no supersession.**
- **Where:** `researchAssistantContext: string | null` on the wishlist
  entry document.
- **Why:** v0.2 spec §2.3. Reserved for the future Research Assistant
  integration so when productisation lands the data substrate is already
  there; no schema migration needed at integration time.
- **UI:** Free-form text on the detail view, gated to internal-tenant
  users only. Not surfaced to client-tenant users.
- **Consumed by:** nothing in this slice. RA does not read this field
  yet.

### Discussion-presence indicator — added

- **Net new UI; no supersession.**
- **Where:** Wishlist list view, on each row.
- **Why:** v0.2 spec §2.4. The "buried-discussion problem" — a row with
  ongoing or recently-completed conversation was indistinguishable on
  the list view from a row with none.
- **Logic:** Indicator shows when there is at least one open Work Item
  attached, OR at least one Work Item updated within the recency window
  (default 7 days; configurable via `DEFAULT_RECENCY_WINDOW_DAYS` in
  `lib/workItems/discussionPresence.ts`).
- **Implementation discipline:** The renderer is local to Wishlists for
  this slice (the v0.2 spec §2.4 is explicit that the second-surface
  generalisation is premature). The helper that computes the data
  (`computeDiscussionPresence`) is subject-agnostic and ready to be
  reused by Conflicts / Exclusions / Relationships when those surfaces
  adopt the indicator.
- **Lift trigger:** the second adopting surface. At that point, the
  rendering component lifts into `src/components/workItems/` and this
  changelog gets a follow-on entry.

### Schema version bump

- **From:** `r2-pvs-wishlist-v1` (v0.1 slice marker)
- **To:** `r2-pvs-wishlist-v2` (v0.2 slice marker)
- **Migration approach:** Reseed Pattern v0.1 (NOT the full Migration
  Pattern). Exchange remains in the seed-data era per Migration Pattern
  v0.1 Amendment §0.5; this slice is the first Reseed Pattern adopter
  on Exchange.
- **Reseed script:** `scripts/reseed-wishlists-v0_2.ts`
- **Documents touched:** Cegid Spain wishlist entries. ID-stable in-place
  reshape; no deletion of old documents (the delete-old step is a
  verification sweep — see Reseed Pattern §2.1).

---

## v0.1 (April 2026) — R2 PVS Slice 1 ship

Spec: `r2-pvs-s1-wishlists-spec.md`
Build: April 2026.

The original R2 Wishlists ship. Notable supersessions from this slice:

### R1 free-text `notes` field — removed

- **Deprecated:** `notes` (free-text) field on R1 wishlist entries.
- **Superseded by:** structured fields (`targetingHints`, `companyRef`,
  `source`, `sourceDetail`) plus, for conversational content, attached
  Work Items in the Discussion stream.
- **Why:** v0.1 spec §2 and §6.3. The free-text field was absorbing
  everything; routing each kind of content to its proper home is the
  point of the R2 redesign.
- **Migration:** v0.1 spec §6.3 routes existing notes content to one of:
  structured field (mapped), `targetingHintsRaw` (preserved if
  unmappable), closed Work Item (conversational), drafted So What
  (case-study-shaped).

### R1 single `campaignRef` field — removed

- **Deprecated:** `campaignRef: string | null` (single) on R1 wishlist
  entries.
- **Superseded by:** `campaignRefs: string[]` — multi-campaign linkage.
- **Why:** v0.1 spec §3.2. Wishlist entries can belong to more than one
  campaign in practice.
- **Migration:** preserved as the first element of the new array.

### Schema version marker introduced

- **From:** absent (R1 documents)
- **To:** `r2-pvs-wishlist-v1`
- **Migration approach:** full Migration Pattern v0.1 (six-part
  structure: pre-snapshot, idempotency check, transformation,
  side-effect creation, migration log, rollback).

---

## How to use this document

When a future reader is debugging a wishlist field that's in the schema
but not in the UI (or vice versa), the answer should be findable here:
either as a "deprecated and the column is retained because…" entry, or
as a "net new and not yet surfaced because…" entry. If neither, the
behaviour is undocumented and needs a changelog entry to land alongside
the fix.

When a future slice deprecates or replaces a wishlist field, append an
entry under a new `## v0.X` heading. Do not edit prior entries except
to correct factual errors; the trail is read in order.

---

*Changelog · maintained per Capabilities and API Surface Note v0.2 §1.4*
