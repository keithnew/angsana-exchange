# R2 PVS Slice 1 (Wishlists) — Task 7a handover

**Branch:** `main` (uncommitted at time of writing).
**Spec:** `docs/architecture/r2-pvs-s1-wishlists-spec.md`.
**Patterns referenced:** `Angsana_Event_Publisher_Pattern_v0_1.md`,
`Angsana_Migration_Pattern_v0_1.md`.

This handover uses the explicit-list format (which file landed, which
didn't) rather than checklist-step ranges, after the previous handover's
"steps 1–6 complete" framing turned out to be steps 3, 6, 14 only. Read
this list, not the §12 checklist numbering, when scoping the next task.

---

## What this task delivered

### Spec & types (steps 1, 2 of §12)

- **`src/types/wishlist.ts`** — R2 type module. `WishlistEntry`,
  `WishlistEntryWire`, `CompanyRef`, `TargetingHint`, the four hint types,
  the four statuses, the seven sources, `SOURCES_REQUIRING_DETAIL`,
  display configs (priority/status/source/hint).
- **`src/types/workItem.ts`** — Work Item lite type module mirroring the
  platform Work Item Primitive Spec v0.1 §2.1 exactly. Includes
  `WorkItemSubject`, `WishlistClarificationState`, `ActivityLogEntry`
  union, `WorkItem`, `WorkItemWire`, defaults, display configs.
- **`src/lib/wishlists/readAdapter.ts`** — read-time R1→R2 normaliser.
  Materialises `companyRef` (candidate by default), splits `notes` into
  `targetingHints` + `targetingHintsRaw`, fills in `source: 'migration'`.
  Used by both API routes for backward-compat reads on pre-migration
  Cegid-Spain data.
- **`src/lib/wishlists/notesClassifier.ts`** — extracted classifier
  shared by the migration script and (forthcoming) Vitest tests. Pure
  function; no Firestore dependency.
- **`src/lib/workItems/stateMachine.ts`** — `validateTransition`,
  `nextStates`, `isTerminalState`. Type-driven so future Work Item types
  add a row to `TYPE_TRANSITIONS` without touching call sites.

### Firestore rules (step 3 of §12)

- **`firestore.rules`** — wishlist & workItem collection rules: tenant +
  client gating, internal-only writes for status/campaignRefs/archived,
  audience gate on workItems read for client users, no hard-delete.
  *(Already deployed by the previous task per the runbook.)*

### API endpoints (step 4 + step 5 of §12)

- **`src/app/api/clients/[clientId]/wishlists/route.ts`** — POST (single
  + batched via `{ items: [...] }`) and GET (with
  `?includeOpenItemCounts=true` for the page-level Open Items badge).
  Emits `wishlist.added` per create.
- **`src/app/api/clients/[clientId]/wishlists/[wishlistId]/route.ts`** —
  GET / PUT (full Edit-in-Details with field gating: client-approver
  cannot touch status/campaignRefs) / PATCH (quick mutations) / DELETE
  (soft = archive; internal-admin only). Emits `wishlist.statusChanged`,
  `.priorityChanged`, `.campaignRefsChanged`, `.companyRefChanged`,
  `.archived` per discrete state change.
- **`src/app/api/clients/[clientId]/workItems/route.ts`** — GET (with
  filters: subjectEntityType, subjectEntityId, state[], audience,
  archived, openOnly) and POST. Emits `workItem.added` and
  `workItem.stateChanged` (for the implicit `null → raised`).
  Audience-gated: client users never see internal items.
- **`src/app/api/clients/[clientId]/workItems/[workItemId]/route.ts`** —
  GET and PATCH for state transitions / audience changes / archive
  toggle. State transitions go through `validateTransition`; shortcut
  close (`raised → closed`) requires a non-empty comment, returned as
  HTTP 400 with the specific error message. Emits
  `workItem.stateChanged`, `.audienceChanged`, `.archivedChanged`.
- **`src/app/api/clients/[clientId]/workItems/[workItemId]/comments/route.ts`**
  — POST a comment. Appends to `activityLog` via `arrayUnion`. Emits
  `workItem.commented`. **Comment body is intentionally not in the event
  payload** (PII risk; consumers fetch from the activity log if needed).

### Auth helper

- **`src/lib/auth/requestUser.ts`** — header-based `RequestUser` parser
  + role predicates (`isInternal`, `isInternalAdmin`,
  `canWriteWishlist`, `hasClientAccess`) + `toActor`. New routes import
  from here. Uses `x-user-display-name` / `x-user-email` from
  middleware (the middleware sets `display-name`, not `name`).

### WishlistForm

- **`src/components/wishlists/WishlistForm.tsx`** — controlled form,
  `mode: 'create' | 'edit'`, posts/puts the R2 wire shape. Reference
  data (`availableTargetingHints`, `availableCampaigns`) is passed in
  by the parent — the form does not fetch on its own. Field gating
  matches the API: client-approver doesn't see Status or Campaigns
  pickers. Conditional sourceDetail when `source ∈ {conference-list,
  industry-event, other}`.

### Migration tooling (step 6 of §12)

- **`scripts/migrate-wishlists-r2.ts`** — landed in the previous task,
  refactored this task to import the shared classifier rather than
  inline it. Behaviour unchanged.
- **`docs/operations/wishlists-r2-migration.md`** — runbook (forward,
  rollback, verification) — landed in the previous task.

### Event publisher (step 14 of §12)

- **`src/lib/events/publish.ts`** — `publishEvent(...)` — landed in the
  previous task. **All event emission in this task goes through it.**
  No call site directly writes to Cloud Logging.

---

## What this task did NOT deliver — picked up in 7b

These are explicit, not "remaining steps":

- **WishlistTable** (R2 columns: company, priority, status, campaign
  pills, targeting-hint pills, Open Items pill, source, source detail
  hover, actions). The 873-line `WishlistListClient.tsx` still renders
  the R1 layout; it is unchanged this task.
- **Subject-agnostic Work Item components** in `src/components/workItems/`:
  `WorkItemStream`, `WorkItemCard`, `RaiseQuestionForm`, `CommentBox`.
  Per spec §10 these take a `subject` prop and **must not** branch on
  `subject.entityType`. None exist yet.
- **Discussion drawer** that hosts `WorkItemStream` for a wishlist row.
- **Edit-in-Details surface** wiring the `WishlistForm` (edit mode)
  into the wishlist detail page.
- **Page-level Open Items badge** (the API supports it via
  `?includeOpenItemCounts=true` — wire-up only).
- **Role-based filtering UI** (the chip rail above the table).
- **Vitest setup + tests** for `notesClassifier`, `stateMachine`,
  `readAdapter`, plus a route smoke test.

These are the entire UI build, and form a cohesive task on their own.

---

## What this task did NOT deliver — picked up in 7c

- **Dev migration dry-run + rollback rehearsal** per the runbook.
- **Smoke test against Cegid Spain post-migration** for AC1–AC12 of
  spec §13. AC1–AC12 cannot be verified until 7b lands the UI.

---

## Notes for 7b

- `WishlistListClient.tsx` is 873 lines of R1 layout. Approach it as a
  **rewrite**, not a patch — the column set is different, the row click
  goes to a drawer not a modal, and the create UX is different
  (inline-form-or-drawer rather than a page-level dialog). Preserve the
  page route (`page.tsx`) but treat `WishlistListClient.tsx` as the
  subject of the rewrite.
- `WishlistForm` is intentionally generic in its reference data inputs
  (`availableTargetingHints`, `availableCampaigns`). The parent — i.e.
  the new `WishlistListClient` — owns those fetches. Patterns for
  fetching managed lists are in
  `src/app/(dashboard)/curation/...` for reference but are
  Hub-resident; in Exchange the closest precedent is the existing
  campaign picker in `WishlistListClient.tsx`.
- Subject-agnostic discipline: when building
  `src/components/workItems/`, *grep* for any `subject.entityType ===`
  before commit. The spec §10 boundary exists so Conflicts/Exclusions/
  Relationships slices reuse the components without modification — if
  this slice puts a wishlist-specific branch in there, the next slice
  will inherit it and the boundary is broken.
- `validateTransition` returns `{ ok: false, reason: 'comment-required' }`
  — UI can preflight by checking `nextStates(...)` and surfacing the
  comment textarea when `commentRequired` is true.
- Event payload shapes in this task's API code are the contract; events
  emitted from UI-only state changes (none yet, but if a future
  optimistic update lands) should use the same shapes. Reference the
  enum in spec §5.1 and the v0.2 alignment footer for the verb list.

---

## Verification done

- `npx tsc --noEmit` — clean across all changed/new files.
- No curl smoke test yet — that comes in 7b once a real authenticated
  session is in play. The R2 routes are reachable in dev and the
  request-user helper is the same pattern used in the already-working
  curation routes in Hub.
