# Wishlists v0.2 — Slice handover

| Field        | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| Slice        | Wishlists v0.2 (additive on the live R2 surface)                     |
| Spec         | `r2-pvs-s1-wishlists-v0_2-spec.md`                                   |
| Patterns     | Reseed Pattern v0.1 (data); Event Publisher Pattern v0.1 (event)      |
| Era marker   | Exchange remains in seed-data era per Migration Pattern v0.1 Amendment §0.5 |
| Status       | Implementation complete; reseed not yet run against Cegid            |
| Date         | May 2026                                                             |

This handover names what was built in this pass, the decisions taken,
and the open items the operator (Keith) needs to do before declaring
the slice shipped. It is the companion to
`r2-pvs-s1-wishlists-v0_2-spec.md` (the *what*) and
`r2-pvs-s1-wishlists-changelog.md` (the supersession trail).

---

## 1. What was built

Four user-facing changes plus the substrate to support them, exactly per
spec §2:

1. **Source field removed from UI.** Form no longer offers it; detail
   view no longer shows it. Database column retained per supersession
   discipline. New UI-driven creates default to `source = 'unspecified'`
   (a new enum value).
2. **Website field added.** Optional URL input on the create form, near
   the company-identifying fields. Editable on the detail view.
3. **researchAssistantContext field reserved.** Optional free-text
   field on the schema, surfaced in the detail view to internal-tenant
   users only. Empty by default. Not consumed by Research Assistant in
   this slice.
4. **Discussion-presence indicator on the list view.** Glanceable icon
   with a count badge next to the company name, lights up when the row
   has either an open Work Item or a Work Item updated within the last
   seven days. Click jumps to the Discussion tab.

Plus:

- `schemaVersion` bump from `r2-pvs-wishlist-v1` to `r2-pvs-wishlist-v2`.
- A reseed script under the Reseed Pattern (NOT the full Migration
  Pattern — Exchange is in the seed-data era).
- 9 new unit tests for the discussion-presence helper; 47 passing in
  total.

---

## 2. Files changed / created

### Created

- `docs/architecture/r2-pvs-s1-wishlists-v0_2-spec.md` — slice spec
  (ported from the .docx Keith provided).
- `docs/architecture/Angsana_Reseed_Pattern_v0_1.md` — in-tree mirror
  of the platform pattern doc.
- `docs/architecture/Angsana_Migration_Pattern_v0_1_Amendment_Threat_Model_and_Era.md`
  — in-tree mirror.
- `docs/architecture/r2-pvs-s1-wishlists-changelog.md` — supersession
  trail per Capabilities and API Surface Note v0.2 §1.4.
- `src/lib/workItems/discussionPresence.ts` — subject-agnostic helper
  for the discussion-presence indicator (open OR recently-updated).
- `scripts/reseed-wishlists-v0_2.ts` — three-part reseed script per
  Reseed Pattern §2.
- `tests/workItems/discussionPresence.test.ts` — 9 tests covering the
  open/recent/stale combinations, audience gating, archived gating,
  entity-type filtering, and the recency-window boundary.

### Modified

- `src/types/wishlist.ts` — adds `website`, `researchAssistantContext`,
  `unspecified` enum value, `r2-pvs-wishlist-v2` schema marker, and the
  three discussion-presence wire fields.
- `src/lib/wishlists/readAdapter.ts` — coerces the new fields off
  Firestore docs (R1 reads still produce them as empty/null).
- `src/app/api/clients/[clientId]/wishlists/route.ts` — accepts and
  persists the new fields; defaults `source` to `'unspecified'`;
  internal-only gating on `researchAssistantContext`.
- `src/app/api/clients/[clientId]/wishlists/[wishlistId]/route.ts` —
  patch endpoint for the new fields with the same internal-only gating
  on `researchAssistantContext`.
- `src/components/wishlists/WishlistForm.tsx` — Website input added;
  Source field removed; basic URL well-formedness check.
- `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistDrawer.tsx`
  — Website displayed and editable; `researchAssistantContext` rendered
  internal-only with edit affordance.
- `src/app/(dashboard)/clients/[clientId]/wishlists/page.tsx` — server
  component computes both open-item counts and discussion-presence
  buckets in parallel and threads them onto the wire entries.
- `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistListClient.tsx`
  — renders the discussion-presence indicator; click jumps to the
  Discussion tab.
- `docs/architecture/r2-pvs-s1-wishlists-spec.md` — partial-supersession
  header note pointing to the v0.2 spec.

---

## 3. Decisions taken during implementation

### 3.1 Discussion-presence helper is separate from openItemCounts

The two helpers (`computeDiscussionPresence` vs the existing
`computeOpenItemCounts`) walk the same Firestore collection, but they
bucket on different predicates. Open-item counts are open-only;
discussion-presence is open OR recently-updated. Folding both into one
helper would force open-items consumers to carry recency state they
don't need.

The page now reads the collection twice (in parallel via `Promise.all`).
At Cegid-Spain volume each scan is sub-100ms; the redundant read is the
right call against the alternative of bloating the helper API. When the
collection grows, the right move is denormalised counter fields on the
subject entity, not a fused helper.

### 3.2 Indicator render is local to Wishlists

The renderer (`DiscussionPresenceIndicator`, the tooltip builder, the
relative-time formatter) lives inside `WishlistListClient.tsx`. The
data helper (`computeDiscussionPresence`) does NOT live there — it's
in `src/lib/workItems/` and is subject-agnostic.

This is the discipline the spec §8 second bullet calls for: "Treat the
rendering logic as 'given a record reference, fetch its open and
recently-updated Work Items, render the indicator'; not 'given a
wishlist entry, do these specific lookups'." The helper takes
`subjectEntityType` as a parameter; Wishlists passes `'wishlist'`,
Conflicts will pass `'conflict'`, and so on.

The lift trigger is the second adopting surface. At that point the
renderer moves into `src/components/workItems/` and the changelog
gets a follow-on entry.

### 3.3 Reseed is ID-stable; delete-old is a verification sweep

Wishlists are referenced by Work Items via `subject.entityId`. If the
reseed wrote new docs with new IDs, every Work Item's reference would
break. So the reseed writes the v0.2 shape in place on the existing
Firestore document IDs. Per Reseed Pattern §2.1's "ID-stable reseeds"
clause, the delete-old step then degrades to a verification-only sweep
— no separate old-shape documents to delete, just stragglers (docs the
reseed missed) to surface.

The two-step ceremony is preserved for discipline. The script logs the
ID-stable nature clearly so the operator isn't left wondering why the
delete count is zero.

### 3.4 The recency-window boundary is inclusive

A Work Item updated exactly seven days ago counts as "recent". A
strict-less-than boundary would classify a comment left exactly a week
ago as stale, which is surprising given the human framing. Pinned in
a unit test so a future refactor can't silently flip it.

### 3.5 The reseed event fires only for the reseed step

Per Reseed Pattern §3.1 there is exactly one `reseed.completed` event
per run. The delete-old step in the ID-stable case is a verification
sweep with no writes, so a second event would be noise. The local log
file is sufficient verification surface for that step.

---

## 4. Quality gates

| Gate                                | Result                |
| ----------------------------------- | --------------------- |
| `npx vitest run`                    | 47/47 pass (3 files)  |
| `npx tsc --noEmit`                  | clean                 |
| `npx eslint <touched files>`        | clean                 |

The unit tests deliberately mock `firebase-admin` rather than reach
for the emulator; the helper logic is pure-ish bucketing over a
QuerySnapshot shape, which is straightforward to fake.

---

## 5. What the operator needs to do before declaring shipped

The slice is implementation-complete but not deploy-complete. Keith's
remaining steps:

1. **Read the v0.2 spec one more time** against the implementation, in
   particular AC1–AC7 in §7. The acceptance is the gate, not the test
   suite.
2. **Run the reseed dry-run on dev** (Cegid-Spain test client tenant):
   ```bash
   npx tsx scripts/reseed-wishlists-v0_2.ts --tenant=angsana --client=cegid-spain
   ```
   Verify the log file at `reseeds/r2-pvs-wishlist-v0_2-{timestamp}.json`
   shows the expected counts (six Cegid entries → six "would-be"
   reseeds; zero errors).
3. **Run the reseed for real on dev:**
   ```bash
   npx tsx scripts/reseed-wishlists-v0_2.ts --tenant=angsana --client=cegid-spain --execute
   ```
   Spot-check a Cegid entry in the dev console: schemaVersion is
   `r2-pvs-wishlist-v2`, website is `''`, researchAssistantContext is
   `''`, source is preserved verbatim.
4. **Run the verification sweep:**
   ```bash
   npx tsx scripts/reseed-wishlists-v0_2.ts --tenant=angsana --client=cegid-spain --delete-old
   ```
   Expect "0 stragglers" in the log. If anything other than 0,
   re-execute the reseed step and re-verify.
5. **Smoke-test the four UI changes** as alessandro@cegid.com (client
   role) and as an internal user — Source not visible to either; Website
   editable by both; researchAssistantContext visible only to internal;
   discussion indicator appears on rows with open or recent Work Items.
6. **Promote to prod** with the same three-step reseed sequence.
7. **Tick the v0.2 spec §7 acceptance items** in whatever ledger Keith
   tracks them in.
8. **Quick downstream consumer scan** for `source` reads (per spec §8
   first bullet). At time of build no consumer was identified that
   discriminates on `source`; if one is found post-deploy, file an
   issue and let the v0.3 amendment handle it.

---

## 6. What this slice deliberately did NOT do

Spec §6 names the deferrals; this handover surfaces them again so the
operator notices anything missing isn't an oversight:

- Targeting Hints picker (waits on Dimension Packs design).
- Person-of-interest sub-entries (own design conversation).
- Match-on-add Salesforce Account typeahead (waits on Platform API v1).
- Client-facing Research Assistant integration (the field is reserved;
  integration is later).
- Audience/assignment taxonomy in Discussion (waits on Angela's input).
- Task primitive on Wishlists (waits on Task primitive placement).
- Lifting the discussion-presence indicator into a shared component
  (waits on the second adopting surface).

---

## 7. v0.3 trigger conditions

This v0.2 spec gets a v0.3 amendment when any of:

- The Targeting Hints picker design lands and Wishlists adopts it.
- A downstream consumer of the `source` field surfaces an issue with
  the `'unspecified'` default.
- The discussion-presence indicator pattern is generalised into a
  shared component and Wishlists adopts the shared version.
- The Cegid Spain tenant flips from seed-data era to real-client era,
  at which point any further wishlist-shape changes land under the
  full Migration Pattern (per Migration Pattern v0.1 Amendment §0.5).

None of these is expected before the v0.2 ship; v0.2 is the working
frame for the rest of the R2 PVS slice sequence.

---

*Handover · v0.2 · May 2026 · Internal — Confidential*
