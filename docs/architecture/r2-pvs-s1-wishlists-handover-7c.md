# R2 PVS Slice 1 (Wishlists) — Task 7c handover

**Branch:** `main`.
**Spec:** `docs/architecture/r2-pvs-s1-wishlists-spec.md`.
**Runbook:** `docs/operations/wishlists-r2-migration.md`.
**Patterns referenced:** `Angsana_Event_Publisher_Pattern_v0_1.md`,
`Angsana_Migration_Pattern_v0_1.md`.

7c is the operational counterpart to 7a's migration script and 7b's UI
surface. The substrate work (lint cleanup, AC paste, 7b commit, §6.6
seeds) was code-side and is committed below. The migration run itself
and the AC1–AC12 smoke are operator-present per the runbook §6 audit
discipline; they appear in §"What was run" once the operator has worked
through them, with the actual log/manifest summaries pasted in.

This handover continues the explicit-list format used in 7a (rather
than the §12 checklist numbering, which has drifted from reality across
multiple passes already).

---

## What 7c delivered code-side

### Pre-flight cleanup — commit `7cf20f4` (`chore(lint)`)

- **`eslint.config.mjs`** — relaxed `no-unused-vars` to honour the
  `_`-prefix convention for intentionally-unused identifiers. This is
  the conventional ES/TS pattern; the repo had been flagging it as a
  warning. Now `WishlistDrawer`'s `onMutated: _onMutated` (kept in the
  prop contract for forward compatibility) lives without a per-line
  silencer.
- **`src/app/api/clients/[clientId]/workItems/route.ts`** — dropped the
  unused `VALID_STATES` const (validation lives in the transitions
  endpoint, not the create endpoint).
- **`src/components/nav/ExpandableNavGroup.tsx`** — dropped unused
  `ChevronDown` import.
- **`src/lib/events/publish.ts`** — dropped two now-unused
  `eslint-disable-next-line no-console` directives. The publisher writes
  structured logs through `console` deliberately; the rule never
  contested it.
- **Knock-on:** three pre-existing files had `eslint-disable` directives
  whose underlying warnings disappeared under the relaxed rule, so the
  directives became `unused-disable-directive` warnings themselves.
  Cleaned in the same commit:
  `(dashboard)/clients/[clientId]/checkins/[checkInId]/CheckInDetailClient.tsx`,
  `(dashboard)/clients/[clientId]/checkins/[checkInId]/edit/CheckInEditForm.tsx`,
  `api/clients/[clientId]/prospecting-profile/market-messaging/route.ts`.
- **`.gitignore`** — added `firebase-debug.log` (transient artifact).

`next lint` is clean for the 7b/7c surface area after this commit. Ten
residual warnings remain in `conflicts`/`exclusions`/`relationships`
routes — pre-existing R1 `any`s, out of scope for 7c.

### AC paste — commit `67da810` (`docs(wishlists)`)

- **`docs/architecture/r2-pvs-s1-wishlists-spec.md` §13** — replaced the
  placeholder ("AC1–AC12 — paste here") with the explicit list. The
  in-tree spec is now self-sufficient for AC verification; no
  cross-reference needed.

### 7b — commit `5630951` (`feat(wishlists)`)

7b was actually-uncommitted-at-the-time-7c-started: the brief asserted
7a and 7b were both in, but `git log` showed only `a8e1e54` (7a). The
7b working tree was sitting locally with the production build only
clean because Next built that working tree, including the uncommitted
7b changes. Caught and committed at the start of 7c:

- **`src/app/(dashboard)/clients/[clientId]/wishlists/WishlistDrawer.tsx`**
  — per-row drawer with Details and Discussion tabs. Edit affordance
  swaps Details into the existing `WishlistForm`. Archive affordance
  for internal-admin only. Discussion tab embeds the subject-agnostic
  `WorkItemStream`.
- **`src/components/workItems/WorkItemStream.tsx`** — lists Work Item
  cards for a given subject, polls the list endpoint with state /
  audience filters per the current role.
- **`src/components/workItems/WorkItemCard.tsx`** — state badge,
  audience indicator, activity log render, shortcut transitions
  (raised → clarified → closed; raised → closed with required comment),
  supersession "Re-open as new question" on closed cards.
- **`src/components/workItems/RaiseQuestionForm.tsx`** — title + body +
  audience toggle + priority. Defaults to shared/medium per §7.6.
- **`src/components/workItems/CommentBox.tsx`** — comment + per-comment
  audience override, internal-only comments hidden from client users.
- **`src/lib/workItems/openItemCounts.ts`** — helper used by the list
  endpoint and the drawer to surface per-row Open Item counts and the
  page-header total. Audience-aware: client users do not see internal
  Work Items reflected in counts.
- **`src/app/(dashboard)/clients/[clientId]/wishlists/page.tsx`,
  `WishlistListClient.tsx`** — Open Items column wired, row click opens
  the drawer, Open Items pill opens to the Discussion tab; subtitle
  reflects total open items per AC8.
- **`src/app/api/clients/[clientId]/wishlists/route.ts`** — list
  endpoint accepts `?includeOpenItemCounts=true`.
- **`src/types/workItem.ts`** — activity-log entry shape tightened.
- **`tests/wishlists/notesClassifier.test.ts`** — 22 cases covering the
  four routing paths in §6.3.
- **`tests/workItems/stateMachine.test.ts`** — 16 cases covering
  allowed and disallowed transitions per §4.3, including the
  shortcut-close comment requirement.
- **`vitest.config.ts`, `package.json`** — vitest set up at the
  workspace root (`npm test`).

Subject-agnostic discipline confirmed: zero
`if (entityType === 'wishlist')` inside `src/components/workItems`.

### §6.6 seeds — commit `825cb8c` (`chore(seed)`)

- **`scripts/seed.ts`** — three new wishlist entries appended to the
  existing five under `cegid-spain`. Each row carries an inline comment
  block naming the route it exercises. Verified directly against
  `src/lib/wishlists/notesClassifier.ts` before commit:

  | Seed                              | Notes shape                                | Length   | Route          |
  | --------------------------------- | ------------------------------------------ | -------- | -------------- |
  | `wishlist-seed-a-inditex`         | conversational, ends `?`                   | 129 ch   | `work-item`    |
  | `wishlist-seed-b-carrefour-spain` | short hint-shaped, no terminator + populated `campaignRef` | 44 ch | `targeting-raw` |
  | `wishlist-seed-c-mercadona`       | observation-shaped, em-dash, no case-study cue | 203 ch | `work-item` |

  The classifier's `so-what-draft` route is **intentionally** not
  exercised by any seed — per spec §6.6, case-study content does not
  typically appear on wishlists; coverage is via classifier unit tests
  only.

---

## Findings to amend in subsequent passes

### F1 — §6.6 seed labels do not match the classifier as built

§6.6 of the slice spec names three seeds with paths labelled:

- Seed A — Inditex (Work-Item-from-notes)
- Seed B — Carrefour Spain (campaignRefs-from-notes)
- Seed C — Mercadona (source+sourceDetail-from-notes)

The classifier (`src/lib/wishlists/notesClassifier.ts` and §6.3) has
four routes: `empty` / `targeting-raw` / `work-item` / `so-what-draft`.
The two non-classifier labels above are **mechanical lifts in §6.2**,
not notes-driven routing:

- `campaignRef` → `campaignRefs[]` is a §6.2 mapping (row 4: rename and
  wrap the single value as a one-element array).
- `source` is hardcoded to `'migration'` in §6.2 (row 7) for every
  migration-time entry; `sourceDetail` is hardcoded to `null` (row 8).
  Neither is derived from notes content.

The labels in §6.6 read as pre-implementation shorthand that didn't
survive the 7a implementation. Recommended amendment: rewrite §6.6's
seed labels to name the actual classifier routes (`work-item`,
`targeting-raw`) and, separately, name the §6.2 lifts that each seed
also exercises in passing (e.g. seed B exercises both
`targeting-raw` *and* the `campaignRef` → `campaignRefs[]` lift, which
is why it carries `iberia-retail-pos-fashion` in its `campaignRef`
field). The seed comment in `scripts/seed.ts` already describes what
each entry actually exercises.

The same drift exists in the canonical architectural settling doc's
§6.1 (per Keith). The architectural settling doc is not in-tree at
`angsana-exchange`; flagged here for amendment in the canonical
version.

### F2 — 7a → 7b commit boundary

For the historical record (no action needed): 7b's working tree
sat uncommitted on disk through to the start of 7c. The April-30
production build that the 7c brief cited as evidence-of-clean was
building the working tree, not the latest committed `main`. Caught
during 7c pre-flight and split into the three commits described above.
Worth noting in case anyone pulls the inter-task `main` and finds it
inconsistent with the slice spec's surface.

### F3 — Spec drift between §6.6 inventory count and post-seed reality

§6.5 references "six entries plus three dev seeds = nine documents"
(referring to the production count when the spec was drafted). With
Cegid Spain reframed as a testbed (not a real client to protect) the
arithmetic changes to **eight documents on `cegid-spain`** post-seed
(the existing five entries + three new seeds) — there is no separate
production phase and no separate dev client. The runbook's pre-flight
table at the top of `wishlists-r2-migration.md` shows
`(this slice; other clients unaffected)` which still holds. Recommended
amendment: §6.5 line on volume to read "eight documents on the
single test client" or similar.

---

## What was run

This section is filled in after the operator has worked through the
runbook. Templates below; the operator pastes the actual values.

### Pre-run state

- Operator UID: `<paste>`
- Operator email: `<paste>`
- Date / time of run: `<paste>`
- `gcloud config get-value project`: `<paste>` (expected `angsana-exchange`)
- `git rev-parse --short HEAD`: `<paste>` (expected `825cb8c` or later)

### Re-seed (`npx tsx scripts/seed.ts`)

- Wishlist count under `cegid-spain` post-seed: `<paste>` (expected 8)
- Notable lines from the seed output: `<paste>`

### Dry-run (no `--execute`)

- Summary line: `upgraded: <n>, skipped: <n>, errored: <n>`
- Snapshot file path: `<paste>`
- Migration log path: `<paste>`
- Side-effect manifest summary (count of Work Items / So Whats /
  targeting-raw writes): `<paste>`
- Anything unexpected on per-document outcomes: `<paste, or "none">`

### Forward run (`--execute`)

- Migration log path: `<paste>` *(this is the input to rollback)*
- Snapshot path: `<paste>`
- Final summary line: `<paste>`
- Cloud Logging confirmation: `migration.completed` event observed
  with `patternId="r2-pvs-wishlist"` and matching `runId`: `<yes/no>`.

### Spot-check (per Keith's guidance)

Pick one work-item-routed seed (Inditex or Mercadona) and the
`targeting-raw` seed (Carrefour Spain). The principle is to cover
distinct routing paths rather than convenient documents.

- **Inditex or Mercadona:** confirms side-effect Work Item is correctly
  attached to the wishlist subject, audience `internal`, state
  `closed`. `notes` field removed from upgraded document.
- **Carrefour Spain:** confirms both `targetingHintsRaw` write and
  `campaignRef` → `campaignRefs[]` lift in one document. `notes` field
  removed.

Spot-check observations: `<paste>`

### Rollback rehearsal (`--rollback --execute`)

- Rollback log path: `<paste>`
- Wishlists restored to R1 shape: `<yes/no, with sample doc>`
- Side-effect Work Items deleted: `<count, expected: matches forward
  run's manifest>`
- Cloud Logging: `migration.completed` for rollback (mode `rollback`
  in payload): `<yes/no>`.

### Forward re-run (final)

- Summary line: `<paste>` (expected `upgraded: 8, skipped: 0, errored: 0`)
- Migration log path: `<paste>` *(this is the live one that stays
  applied to cegid-spain)*

### Idempotency smoke (re-run dry-run after final forward)

- Summary line: `<paste>` (expected `upgraded: 0, skipped: 8, errored: 0`)

---

## AC1–AC12 smoke

Per spec §13, exercised across all four roles seeded by
`scripts/seed.ts`:

- `keith@angsana.com` — internal-admin
- `mike@angsana.com` — internal-user
- `alessandro@cegid.com` — client-approver
- `monica@cegid.com` — client-viewer

Password for all four: `Exchange2026!`.

### AC9 — pre-noted expectation (per Keith)

Alessandro (client-approver) should see all eight wishlist entries
post-migration. The two work-item-routed seeds (Inditex and Mercadona)
will have closed Work Items attached, but those Work Items have
audience `internal` per the migration's classifier output. So
Alessandro's Discussion tab on Inditex and Mercadona will correctly
show "no discussion yet" — the closed internal-audience Work Items
are filtered from his view. That's the expected behaviour, not a
regression.

AC9 passes when:
- (a) Alessandro sees all eight rows with structured fields,
- (b) the `Source` field is hidden in his view,
- (c) his Discussion tabs on Inditex / Mercadona show empty (because
  the only Work Items there are internal-audience).

Mike and Keith will see those Work Items in their views; that's also
expected.

### AC results

| AC  | Description (paraphrased)                                   | internal-admin | internal-user | client-approver | client-viewer | Notes |
| --- | ----------------------------------------------------------- | -------------- | ------------- | --------------- | ------------- | ----- |
| AC1 | <paraphrase per §13>                                        | `<pass/fail>`  | `<pass/fail>` | `<pass/fail>`   | `<pass/fail>` | `<>`  |
| AC2 |                                                             |                |               |                 |               |       |
| AC3 |                                                             |                |               |                 |               |       |
| AC4 |                                                             |                |               |                 |               |       |
| AC5 |                                                             |                |               |                 |               |       |
| AC6 |                                                             |                |               |                 |               |       |
| AC7 |                                                             |                |               |                 |               |       |
| AC8 |                                                             |                |               |                 |               |       |
| AC9 | client-approver visibility (per pre-noted expectation)      |                |               |                 |               |       |
| AC10|                                                             |                |               |                 |               |       |
| AC11|                                                             |                |               |                 |               |       |
| AC12|                                                             |                |               |                 |               |       |

Anomalies, if any: `<paste, with reproduction steps>`

---

## Dev-smoke fix log (post-Pass-4, pre-Cegid-prod)

The four-role smoke against dev surfaced five issues before the Cegid
Spain prod migration was attempted. All five were fixed in-task; the
prod migration was deliberately gated on these clearing because they
are real regressions / leaks, not cosmetic, and three of them would
have failed AC9 (client-approver visibility) outright.

| #   | Bug (smoke pass)                                              | Severity     | Root cause                                                                                                                                                                                                       | Fix                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4  | Internal-only Work Item comments leaked to client roles (3)   | **security** | The Work Item GET routes serialised the full `activityLog` array regardless of viewer role. Audience-gating was applied only at the *parent* level (the Work Item's own `audience` field), not at the entry level. | `src/app/api/clients/[clientId]/workItems/[workItemId]/route.ts` and `…/workItems/route.ts`: `toWire()` now takes a `viewerIsInternal: boolean` and filters `commented`-type entries with `audience === 'internal'` for non-internal viewers. Other entry types (state-changed, etc.) remain visible.       |
| F5  | "Added" column showed 01/01/1970 for migrated rows (1)        | data         | `tsToISO()` in the read adapter handled admin-SDK Timestamps (`.toDate()`) and `Date`/`string`, but not the plain-object Timestamp shape (`{_seconds, _nanoseconds}`) that arrives when a doc is serialised across an RSC boundary or written by a script that doesn't go through the admin SDK. Fall-through path returned `new Date(0).toISOString()` — hence epoch-0. | `src/lib/wishlists/readAdapter.ts`: `tsToISO()` now also recognises `{_seconds}` and `{seconds}` shapes and converts via `seconds * 1000`. Documented in-line so the next maintainer doesn't trim the branch as "redundant".                                                                              |
| F6  | Hydration-mismatch warning on date format (1)                 | UX           | `toLocaleDateString()` with no locale uses the runtime's default Intl locale, which differs between Node SSR and the browser. React fell back to the SSR string on mismatch, occasionally rendering as 01/01/1970 if the parent shape bug masked it. | `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistListClient.tsx`: the row "Added" date now uses `toLocaleDateString('en-GB')` (DD/MM/YYYY) — stable across SSR/CSR and matches EU/UK conventions where this product is operated.                                                                |
| F7  | Open-items count on the row didn't refresh after a state-change inside the drawer (1) | UX           | `WishlistDrawer` accepted an `onMutated` prop, destructured it as `_onMutated` (intentional underscore so 7b lint would pass), and never wired it through to the in-drawer `WorkItemStream`. So state-changes/comments updated only the stream's local list, never the page's row. | `src/components/workItems/WorkItemStream.tsx`: added optional `onMutated` prop, fired in the same callbacks that already trigger `load(true)` (raise / state-change / audience-change / archive / comment via `WorkItemCard.onUpdated`). `WishlistDrawer.tsx` now passes its `onMutated` through. The page-level `router.refresh()` is what repopulates the row's `openItemCount`. |
| F8  | Status column hidden from client-approver / client-viewer (3, 4) | spec-fit     | Original 7b row implementation gated Status on `internal && (...)`. Spec §6.6 calls for status to be visible to all roles (read-only for clients) — clients need to see lifecycle progress; the gate that matters for transition rights is enforced server-side in PATCH. | `WishlistListClient.tsx`: dropped the `internal && (...)` wrapper around the Status column header and cell. Campaigns column remains internal-only because campaign membership is internal taxonomy. Clients now see Status as a coloured pill matching what the drawer header already showed them.    |

`tsc --noEmit` clean, `vitest run` 38/38 green, `next lint` clean for
all touched files (the 10 pre-existing `no-explicit-any` warnings under
`/api/clients/[clientId]/{conflicts,exclusions,relationships}/route.ts`
remain — those routes are 7d/7e/7f scope and were excluded from this
task's lint pre-flight).

### Polish-debt deferred from this task

Surfaced during smoke, not blocking AC1–AC12, queued for a refinement
slice rather than the prod migration:

- Activity-log entries display the actor's UID rather than display
  name. The `actor` shape carries `name` already; the WorkItemCard
  formatter just needs to prefer it. Cosmetic.
- "Raise question" / "Close" buttons accept zero-length comments
  silently. The state-machine validates `comment-required` for
  raised→closed; the form should mirror that constraint client-side
  with a disabled-button + helper text rather than letting the API
  bounce a 400. UX, not spec.
- The "Source" picker on the create form is exposed to clients. Per
  spec §3.5 source is internal taxonomy (manual / migration /
  campaign-feed / sf-account-import), and clients shouldn't be picking
  it. Server-side default already coerces this to `manual` for client
  roles, so this is a UI-tidy, not a security issue.
- A closed Work Item shows no "re-raise" affordance. If a client
  posts a follow-up comment on a closed item, the comment is recorded
  but the item stays closed. Spec §4.3 doesn't define a `closed →
  raised` transition, so this is awaiting a spec decision rather
  than an implementation bug.

---

## What is *not* in 7c (next slices)

Out of scope per the brief; surfaced here so the next-slice scoper
doesn't have to re-derive:

- R2 PVS Slice 2 — Conflicts.
- R2 PVS Slice 3 — Exclusions.
- R2 PVS Slice 4 — Relationships.
- Any further wishlist surface refinement (the AC1–AC12 smoke is the
  acceptance gate; refinements would be a separate task).
- The §6.6 / architectural-spec §6.1 wording fix (F1 above) — small
  doc-only follow-up.
- The §6.5 volume-arithmetic fix (F3 above) — same.

---

*Handover v0.1 — 2026-04-30. To be amended once the operator has run
through the §"What was run" / AC sections.*
