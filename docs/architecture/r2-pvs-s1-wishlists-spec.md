# Angsana Exchange — R2 Prospecting Validation Surfaces

## Slice 1: Wishlists — Implementation Specification

| Field                   | Value                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Prepared by             | Keith / Claude                                                                                                       |
| Date                    | April 2026                                                                                                           |
| Status                  | Ready for implementation                                                                                             |
| Depends on              | R1 Slice 4 (Wishlists, current state); R1 Slice 5 (So Whats — referenced, not modified); R1 Slice 8 (Propositions, Campaigns) |
| Architectural reference | `EXCHANGE_R2_PROSPECTING_VALIDATION_SURFACES_v0_1.md` (the architectural spec this slice implements §6.1 of)         |
| Repo                    | `keithnew/angsana-exchange`                                                                                          |

> This is the v0.2 spec of the slice (April 2026). It is committed in-tree
> alongside the architectural spec it implements, so the slice's authoritative
> "why" doc is grounded in the repo.
>
> See `r2-pvs-s1-wishlists-build-notes.md` for the implementation pass build
> log and decisions taken during construction.
>
> **Partially superseded by `r2-pvs-s1-wishlists-v0_2-spec.md` (May 2026).**
> The v0.2 slice is additive on the live surface and overrides this v0.1
> spec on the following points: (a) the Source field is removed from the
> create form and detail view (§5 here); (b) `website` and
> `researchAssistantContext` fields are added to the schema (§3 here);
> (c) the schemaVersion marker is bumped to `r2-pvs-wishlist-v2`; (d) the
> list view now carries a discussion-presence indicator. All other
> sections of this v0.1 spec remain authoritative. The supersession
> trail is recorded in `r2-pvs-s1-wishlists-changelog.md`.

---

# 1. What this slice delivers

The first of four R2 surfaces that refine R1's prospecting validation
surfaces (Wishlists, Exclusions, Conflicts, Relationships) onto a common
architectural pattern: a tight structured record plus an attached Work Item
stream for clarification and change-request dialogue. This slice covers
Wishlists end-to-end.

Specifically:

- An upgraded Wishlist structured-record schema with new fields for
  canonical company reference, multi-campaign linkage, structured targeting
  hints, structured source, and richer status semantics
- A migration of existing Cegid Spain wishlist entries to the new schema,
  with free-text Notes content routed to its proper home: case-study-shaped
  content drafted as So Whats, conversational content captured as closed
  Work Items
- A local-to-Exchange Work Item collection (Work Item lite) implementing
  the platform Work Item primitive's data model and behaviour at a level
  sufficient to validate the surface end-to-end. The local implementation
  is designed to be replaced cleanly by the platform Work Item primitive
  when it lands (BSP-01-08 in the LGaaS Build Sequence)
- One Work Item type registered against the local Work Item collection:
  `wishlist-clarification`
- UI changes to the Wishlist page: new field surfacing, the "Add Wishlist
  Item" form upgraded to capture the new structured fields, an inline Work
  Item stream visible per row, and a "Raise Question" affordance per row
- Events emitted on wishlist mutations and Work Item state changes as
  Exchange-internal events (using a local event publisher), shaped to
  migrate cleanly to platform events later

The slice does not modify the So Whats module's schema or approval flow —
migration writes draft So Whats through the existing module's API. It also
does not touch Exclusions, Conflicts or Relationships; those are
subsequent slices in this sequence.

This is one Cline-sized unit: design through to deployment, testable
end-to-end on Cegid Spain.

# 2. Architectural context (read first)

This slice implements §6.1 of
`EXCHANGE_R2_PROSPECTING_VALIDATION_SURFACES_v0_1.md`. The architectural
spec is the authoritative reference for the *why*; this implementation
spec is the *what and how*. Where this spec disagrees with the
architectural spec, the architectural spec wins; flag the divergence
rather than implementing it.

Three architectural commitments are particularly relevant to
implementation choices:

**Local Work Item lite, designed for platform replacement.** The platform
Work Item primitive (Spec v0.1 in the project files) lives at the platform
level and will be built in Phase 1 of the LGaaS Build Sequence (BSP-01-07
through BSP-01-12). It is not yet shipped. Exchange implements a minimal
local equivalent at `tenants/{tenantId}/clients/{clientId}/workItems/`
(path scoped under the client because we don't yet have the cross-client
`tenants/{tenantId}/workItems/` shape that the platform primitive will
use; this is a deliberate scoping choice for the lite version and a
documented divergence). The schema mirrors the platform primitive's §2.1
data model exactly — same field names, same types, same semantics — with
two simplifications: (a) only one Work Item type is needed for this slice
(`wishlist-clarification`), so the type registry can be a hard-coded enum
at this point rather than a Firestore-backed registry; (b) auto-actions
are not implemented (no `onTransition` dispatch). When the platform
primitive lands, the migration to it is: (i) move the workItems
collection from per-client path to tenant-scoped path, (ii) replace the
hard-coded type with a registry-backed type document, (iii) wire the
platform's Platform API endpoint instead of Exchange-local endpoints.
None of these is a schema change; all are path and access-pattern
changes.

**Refinery consumption is the future-state target.** The
structured-record schema is designed against the eventual Refinery
consumption shape. The `companyRef` field is canonical (resolvable to a
Salesforce Account ID where one exists; otherwise candidate-stage per the
Refinery Identity v0.1 binding model in the project). The
`targetingHints` field draws from controlled vocabulary that Refinery
will use for matching. Don't be tempted to take shortcuts here that would
make the schema convenient now but mismatched against Refinery's needs
later.

**Free-text Notes is reduced.** R1 has a free-text `notes` field on
wishlist entries that absorbs everything. R2 routes that content to its
proper home and removes the field. The migration in §6 handles the
existing free-text content. Do not preserve the field "for safety" or "in
case" — its removal is a deliberate architectural choice. If users push
back during testing that they need a freeform place, that is a finding
for the architectural spec to absorb in v0.3, not a reason to re-add the
field.

# 3. Schema — Wishlist structured record

## 3.1 Firestore path

`tenants/{tenantId}/clients/{clientId}/wishlists/{wishlistId}`

Same path as R1. The migration upgrades the schema in place; document IDs
are stable.

## 3.2 Schema

```typescript
interface WishlistEntry {
  // Identity
  wishlistId: string;
  companyRef: CompanyRef | null;
  companyName: string | null;

  // Classification
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'under-review' | 'added-to-target-list' | 'rejected';

  // Linkage
  campaignRefs: string[];

  // Targeting
  targetingHints: TargetingHint[];
  targetingHintsRaw: string | null;

  // Provenance
  source: WishlistSource;
  sourceDetail: string | null;

  // Audit
  addedBy: { uid: string; name: string };
  addedAt: Timestamp;
  updatedBy: { uid: string; name: string };
  updatedAt: Timestamp;

  // Lifecycle
  archived: boolean;

  // Schema version marker (added by R2 migration; absent on legacy R1 docs).
  // Value follows Migration Pattern v0.1 §3.2 — `{pattern}-v{n}`.
  schemaVersion?: 'r2-pvs-wishlist-v1';
}

interface CompanyRef {
  type: 'salesforce-account' | 'candidate';
  sfAccountId?: string;
  candidateId?: string;
}

interface TargetingHint {
  type: 'therapy-area' | 'sector' | 'geography' | 'service-type';
  managedListRef: { listId: string; itemId: string };
  displayName: string;
}

type WishlistSource =
  | 'client-request'
  | 'internal-research'
  | 'conference-list'
  | 'industry-event'
  | 'ai-suggestion'
  | 'migration'
  | 'other';
```

## 3.3 CompanyRef — canonical reference

R1 stored company name as a free string. R2 introduces a structured
reference. Two cases:

- The company already exists in the tenant's Salesforce as an Account:
  `{ type: 'salesforce-account', sfAccountId: '<id>' }`. The wishlist's
  `companyName` is denormalised from the SF Account display name.
- The company has been named but no Salesforce match has been made:
  `{ type: 'candidate', candidateId: '<exchange-local-uuid>' }`. The
  `companyName` holds the user-entered string. When the candidate is
  later matched (manually or by Refinery, in a future slice), the
  `companyRef` is upgraded in place from candidate to salesforce-account;
  `companyName` is updated from SF.

For this slice, we are not building the SF lookup UX — that comes with
Refinery integration later. The "Add Wishlist Item" form lets the user
type a company name, and the entry is stored as a candidate. A
`companyRef` may also be null for entries that name only a targeting
intent (the "Therapy area focus: Rare Diseases, EHA List" pattern from
the This Is Us example) — in this case `companyName` is also null and
`targetingHints` carries the substantive content.

## 3.4 TargetingHint — controlled vocabulary

Targeting hints draw from the existing R1 managed lists:

- `therapy-area` → `tenants/{tenantId}/managedLists/therapyAreas`
- `sector` → `tenants/{tenantId}/managedLists/sectors`
- `geography` → `tenants/{tenantId}/managedLists/geographies`
- `service-type` → `tenants/{tenantId}/managedLists/serviceTypes`

Each hint references a managed list entry by ID (not by display name).
Display name is denormalised on write for convenience.

The "Add Wishlist Item" form provides four pickers (one per hint type).
Multiple hints of the same type are allowed (e.g. two therapy areas). The
full list of selected hints is rendered as chips, removable individually.

`targetingHintsRaw` is migration-only. New entries do not write to it. It
exists so that R1 free-text content that didn't map cleanly to controlled
vocabulary is preserved during migration without being lost. The UI
surfaces it as a small italic note below the chips on entries that have
it ("Migrated note: '<raw text>'") with an Edit affordance to re-enter it
as structured hints.

## 3.5 Source enum

Seven values; the `sourceDetail` field carries the specific instance
(e.g. source `conference-list`, sourceDetail `EHA-2025-attendees`).

The "Add Wishlist Item" form provides the source as a required picker.
`sourceDetail` is a short text input that appears when the source is one
of `conference-list`, `industry-event`, or `other`. Migration sets all
existing entries to source `migration`, sourceDetail null.

# 4. Schema — Local Work Item

## 4.1 Firestore path

`tenants/{tenantId}/clients/{clientId}/workItems/{workItemId}`

Note this is per-client for the local lite version. The platform
primitive uses tenant-scoped paths
(`tenants/{tenantId}/workItems/`); the lite version's per-client scoping
is documented as a deliberate divergence that simplifies security rules
at this point.

**Migration path, named for the future agent.** When the platform Work
Item primitive lands at BSP-01-08, Work Items move from
`tenants/{tenantId}/clients/{clientId}/workItems/{workItemId}` to
`tenants/{tenantId}/workItems/{workItemId}`, with the client identity
carried as a structured field on the Work Item's subject
(`subject.scopeRef = tenantId`, plus a `clientId` field on the subject
for client-scoped subjects like `wishlist`, `exclusion`, etc.). The path
change is mechanical; the semantic shift is more interesting: in the
platform model, a Work Item belongs to the tenant and has a subject that
points at whatever the work is about, whereas in the lite model the Work
Item is *under* the client. When the migration runs, queries shift from
"list Work Items under this client path" to "list Work Items where
`subject.clientId` equals this client".

## 4.2 Schema

The schema mirrors the platform Work Item Primitive Spec v0.1 §2.1
exactly:

```typescript
interface WorkItem {
  workItemId: string;
  workItemType: 'wishlist-clarification';

  subject: WorkItemSubject;

  state: WishlistClarificationState;
  audience: 'internal' | 'shared' | 'client';
  visibility: 'normal' | 'system-only';
  archived: boolean;

  owner: { uid: string; tenantId: string } | null;
  priority: 'high' | 'medium' | 'low';
  deadline: Timestamp | null;

  title: string;       // Max 200 chars
  body: string;        // Max 2000 chars

  source: { type: string; ref: string } | null;

  relations: Array<{
    relationType: 'parent' | 'child' | 'blocks' | 'blocked-by'
                | 'supersedes' | 'superseded-by' | 'derives-from';
    otherWorkItemRef: string;
  }>;

  activityLog: ActivityLogEntry[];

  createdAt: Timestamp;
  createdBy: { uid: string; tenantId: string };
  updatedAt: Timestamp;

  tenantId: string;
  scope: 'tenant';
}

interface WorkItemSubject {
  scope: 'tenant';
  scopeRef: string;            // tenantId
  entityType: 'wishlist';
  entityId: string;            // The wishlistId
}

type WishlistClarificationState = 'raised' | 'clarified' | 'closed';
```

> **Audience note for this slice.** The enum includes `'client'` for
> forward-compat with the platform spec, but this slice never produces a
> Work Item with `audience: 'client'`. It is reserved. The Raise Question
> form offers Shared/Internal only. Role gates treat `'client'` and
> `'shared'` identically (both visible to client users). When the platform
> primitive arrives, the distinction will become meaningful.

## 4.3 State machine — `wishlist-clarification`

Three states, two transitions:

- `raised` → `clarified` (no comment required, but encouraged)
- `clarified` → `closed` (no comment required)
- `raised` → `closed` (shortcut close — comment required)

`closed` is terminal. There is no re-open transition; if the matter
resurfaces, raise a new Work Item with a `supersedes` relation to the
closed one.

**The supersession affordance.** A closed Work Item card carries a
"Re-open as new question" button. Clicking it opens the Raise Question
form pre-populated with the closed item's title (with "(Re-opened)"
prefix) and an empty body, audience defaulting to the closed item's
audience. On save, the new Work Item is created in `raised` state with a
`supersedes` relation to the closed Work Item; the closed Work Item gains
a corresponding `superseded-by` relation. The closed Work Item's activity
log gains a `relation-added` entry; the new Work Item's activity log
opens with a `state-changed` entry to `raised`.

The Work Item itself does not transition the wishlist entry's status. The
decision to add a wishlist entry to a target list is a separate user
action on the wishlist record.

## 4.4 Activity log

Same shape as Work Item Primitive Spec §2.4. Entry types used:

- `state-changed` — `{ from, to, by, at, comment? }`
- `commented` — `{ by, at, body, audience }`
- `assigned` — `{ from, to, by, at }`
- `audience-changed` — `{ from, to, by, at, comment? }`
- `relation-added` — `{ relationType, otherWorkItemRef, by, at }` (for supersession only)

Other entry types from the platform spec (`relation-removed`,
`subject-event-referenced`, `archived-changed`) are not actively used by
this slice but the field is present for forward compatibility.

## 4.5 Relations

Relations field is present in the schema and actively written for the
supersession affordance (§4.3). Future slices may add other relation
types.

## 4.6 Audience defaults

`wishlist-clarification` defaults to `audience: 'shared'`. The "Raise
Question" UI presents audience as a toggle defaulted to shared, with an
explicit "Internal only" option.

The audience can be changed during the Work Item's lifecycle. Changing
audience to shared exposes prior comments on the timeline retroactively;
changing to internal does not retroactively hide them.

# 5. Events

A local event publisher (publisher-lite) is added to Exchange in this
slice at `src/lib/events/publish.ts`. **Implements the Angsana Event
Publisher Pattern v0.1** (in-tree mirror at
`docs/architecture/Angsana_Event_Publisher_Pattern_v0_1.md`). The
publisher writes the canonical envelope as structured JSON to Cloud
Logging under the top-level key `angsanaEvent`. No Firestore event
collection in this slice (`mirrorToFirestore` option exists on the
function signature but defaults to `false` and stays off for this
slice). When the platform event bus ships, the publisher's body
re-points; call sites do not change.

The function signature is the contract per Event Publisher Pattern §2.1:

```ts
publishEvent(
  { eventType, payload, tenantId, clientId, actorUid, occurredAt },
  options?: { mirrorToFirestore?: boolean }
): Promise<void>
```

The publisher generates `eventId` (UUID v4) at emit time, sets
`eventVersion` to `"1.0"` initially, and stamps `source: { component:
"exchange-app", environment: <env> }`. Severity is `INFO` for normal
events and `ERROR` for migration failures (per pattern §4.1).

## 5.1 Wishlist events

Verb vocabulary applied per Event Publisher Pattern §5. `priorityChanged`
and `campaignRefsChanged` are kept as specific verbs (the pattern
explicitly permits "specific verbs where they apply" rather than
collapsing to `modified`); `companyRefChanged` replaces the looser
`companyRefUpdated` to align with the past-tense state-change verb
preference.

- `wishlist.added` — payload: `{ wishlistId, clientId, addedBy, source }`
- `wishlist.statusChanged` — `{ wishlistId, clientId, fromStatus, toStatus, changedBy }`
- `wishlist.priorityChanged` — `{ wishlistId, clientId, fromPriority, toPriority, changedBy }`
- `wishlist.campaignRefsChanged` — `{ wishlistId, clientId, addedRefs[], removedRefs[], changedBy }`
- `wishlist.archived` — `{ wishlistId, clientId, archivedBy }`
- `wishlist.companyRefChanged` — `{ wishlistId, clientId, fromRef, toRef, changedBy }`

## 5.2 Work Item events

Per Event Publisher Pattern §5, `created` is reserved for the platform's
own creation events; `added` is the canonical "new entity instance"
verb. The earlier `workitem.created` wording is corrected to
`workitem.added` here.

- `workitem.added` — payload: `{ workItemId, type, subject, audience, addedBy }`
- `workitem.stateChanged` — `{ workItemId, fromState, toState, changedBy, comment? }`
- `workitem.commented` — `{ workItemId, by, at, audience }`
- `workitem.assigned` — `{ workItemId, fromOwner, toOwner, changedBy }`
- `workitem.audienceChanged` — `{ workItemId, fromAudience, toAudience, changedBy }`
- `workitem.archivedChanged` — `{ workItemId, archived, changedBy }`

# 6. Migration — Cegid Spain wishlist entries

The migration is part of this slice. It runs once, at deployment time,
against the production Cegid Spain wishlist data.

## 6.1 Inventory

Existing wishlist entries on Cegid Spain (from the seed): El Corte
Inglés, Mango, Decathlon Spain, Tendam, Desigual. Plus the three seed
entries (Inditex, Carrefour Spain, Mercadona) added in dev only to
exercise the routing logic (§6.6).

## 6.2 Mapping

For each existing entry:

- `companyName` → preserved as denormalised name; `companyRef` set to
  `{ type: 'candidate', candidateId: <generated-uuid> }`
- `priority` → preserved
- `status` → preserved
- `campaignRef` (single, nullable) → `campaignRefs[]`
- `notes` (free-text) → see §6.3 below
- `source` → set to `'migration'`
- `sourceDetail` → null
- `targetingHints[]` → empty initially; see §6.4 below
- `targetingHintsRaw` → null
- `archived` → false
- `addedBy` (R1 was email string) → `{ uid, name }` looked up by email
- audit fields preserved (`addedDate` → `addedAt`)
- `schemaVersion: 'r2-pvs-wishlist-v1'` set as idempotency marker (per
  Migration Pattern §3.2)

## 6.3 Notes content routing

For each entry's free-text notes:

- If empty/whitespace, no action.
- If short (< 50 chars) and looks like a structured hint, attempt to map
  to `targetingHints[]`. If unsure, write to `targetingHintsRaw`.
- If conversational (a question, an observation, a clarification), create
  a closed `wishlist-clarification` Work Item with the notes content as
  the raising comment, audience `internal`, state `closed`.
- If case-study-shaped, draft a So What via the existing So What
  module's API. Status `draft`.

## 6.4 Targeting hints — manual cleanup

Migration cannot infer targeting hints from a company name alone.
Targeting hints are populated by the user post-migration via the Edit
affordance.

## 6.5 Migration script

**Implements the Angsana Migration Pattern v0.1** (in-tree mirror at
`docs/architecture/Angsana_Migration_Pattern_v0_1.md`). The script lands
at `scripts/migrate-wishlists-r2.ts` and follows the six-part structure
per Migration Pattern §2: pre-snapshot, idempotency check,
transformation, side-effect creation, migration log, rollback procedure.

The script is run from the developer's local machine against production
Firestore using the Firebase Admin SDK and a Firebase admin SA key.

**Idempotency marker.** Each upgraded wishlist document carries
`schemaVersion: 'r2-pvs-wishlist-v1'` per Migration Pattern §3.2. (This
supersedes the earlier draft marker `'r2-v1'`; the pattern's
`{pattern}-v{n}` shape is canonical.) Re-running the script skips
already-versioned documents.

**Pre-snapshot (hard precondition).** Snapshot path:
`migrations/snapshots/r2-pvs-wishlist-{timestamp}-{tenantId}-pre.json`
per Migration Pattern §3.1. Gitignored. The script refuses to run if the
snapshot fails — there is no override.

**Migration log.** Path:
`migrations/r2-pvs-wishlist-{timestamp}-{tenantId}.json`. Content per
Migration Pattern §4.1: pattern ID, schema version target, tenant,
operator UID/email, start/end timestamps, run summary
(upgraded/skipped/errored counts), per-document outcomes, side-effect
manifest. The side-effect manifest is exhaustive: every Work Item raised
by the migration appears, every So What drafted appears.

**Per-document error handling.** Per Migration Pattern §3.4: log and
continue, do not abort on first error. Exit summary names upgraded /
skipped / errored counts.

**Rollback.** `--rollback` flag implementation per Migration Pattern
§3.3. Reads the migration log and snapshot; restores documents to
pre-migration state; deletes side-effect entities by ID from the
manifest. The dev-environment forward-then-rollback test is part of this
slice's acceptance.

**Migration events.** Per Migration Pattern §5, the script emits four
event types through the publisher-lite (§5):

- `migration.started` on script invocation
- `migration.documentUpgraded` per upgraded document
- `migration.completed` on success
- `migration.failed` on failure (Cloud Logging severity `ERROR`)

For this slice's volume (six entries plus three dev seeds = nine
events), per-document emission is the default per pattern §5.

**Audit collection: not built.** Per Migration Pattern §6 none of the
four trigger conditions is currently active (single tenant, single
operator, low volume, one-shot). Dev-machine + log file + events stream
is sufficient. The pattern names the trigger; the trigger is not active.

**Operational runbook.** Lives at
`docs/operations/wishlists-r2-migration.md`. Includes pre-flight check,
snapshot verification, dry-run-on-dev procedure, production run
procedure, post-run verification per AC, rollback procedure and tested
invocation. The runbook cites the Migration Pattern document as the
authoritative source for each step.

## 6.6 Seed entries — exercising the routing logic (DEV ONLY)

Three seed entries are added in dev only to exercise the routing
logic. These do **not** land in production.

- **Seed A — Inditex** (Work-Item-from-notes path)
- **Seed B — Carrefour Spain** (campaignRefs-from-notes path)
- **Seed C — Mercadona** (source+sourceDetail-from-notes path)

The So-What-from-notes path is exercised in a unit test of the classifier;
no Cegid seed entry exercises it end-to-end (case-study content does not
typically appear on Wishlists).

# 7. UI — Wishlist page

## 7.1 Overall structure

The page is at `/clients/{clientId}/wishlists`. Existing R1 layout
preserved as the base, with the changes below.

## 7.2 Page header

Unchanged from R1.

## 7.3 Table — columns and behaviour

Columns (in order): Company, Targeting (replaces Sector + Geography),
Priority, Status, Campaigns (replaces single Campaign), Open Items
(NEW), Added.

Sortable on Priority, Status, Added (date), Open Items. Default sort:
Added desc.

## 7.4 Add / Edit Wishlist Item form

Modal/side-panel. Removes free-text notes. Adds:

- Source picker (required)
- Source detail (conditional)
- Targeting hint pickers (4 types, multi-select each)
- Validation: at least one of {company name, targeting hints}

For entries with `targetingHintsRaw` populated, the edit form shows a
banner with the raw text and an Edit affordance.

## 7.5 Work Item stream — per-row drawer

Row click opens a drawer with two tabs: **Details** (fields read-only
plus "Edit" button that swaps to the existing edit form) and
**Discussion** (the Work Item stream).

## 7.6 Raise Question form

Modal. Title (required, ≤200), Body (required, ≤2000), Audience toggle
(Shared/Internal, default Shared), Priority (default Medium).

## 7.7 Inline counts and badges

Open Items column reflects current count of non-closed, non-archived Work
Items. Implementation: simple per-row count query at this scale. Do not
pre-optimise — see scale-up path note in spec.

## 7.8 Empty states

- No entries: existing R1 empty state preserved.
- Entry with no open Work Items: Discussion tab shows "No discussion
  yet" with "Raise Question" button.
- Entry with no targeting hints + no company name: prevented by form
  validation.

# 8. UI — Client portal

- Visible to client users: structured fields, shared/client Work Items
  in Open Items + Discussion tab.
- Client-approver only: Raise Question, comment, add wishlist entries.
- Client-viewer only: read-only views.
- Hidden from client users: Source field, internal-only Work Items, the
  Internal-only audience toggle.

Role-based filtering at the API/data-fetch layer, mirroring R1 Exclusions
list-view pattern.

# 9. API endpoints

## 9.1 Wishlist endpoints (upgraded)

- `POST /api/clients/{clientId}/wishlists` — create with new schema.
- `PATCH /api/clients/{clientId}/wishlists/{wishlistId}` — partial update.
- `DELETE /api/clients/{clientId}/wishlists/{wishlistId}` — soft-delete (archived = true).
- `GET /api/clients/{clientId}/wishlists` — list, supports `?includeOpenItemCounts=true`.

## 9.2 Work Item endpoints (new)

- `POST /api/clients/{clientId}/workItems`
- `GET /api/clients/{clientId}/workItems`
- `GET /api/clients/{clientId}/workItems/{workItemId}`
- `POST /api/clients/{clientId}/workItems/{workItemId}/transitions`
- `POST /api/clients/{clientId}/workItems/{workItemId}/comments`
- `PATCH /api/clients/{clientId}/workItems/{workItemId}` (limited fields)

All endpoints respect role-based access control.

## 9.3 Events

Wishlist mutations emit events through the local event publisher
(§5).

# 10. File structure (actual repo paths)

| File                                                                                  | Purpose                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/types/wishlist.ts`                                                               | Wishlist R2 types + read-adapter result type       |
| `src/types/workItem.ts`                                                               | Work Item types + state machine types              |
| `src/lib/wishlists/readAdapter.ts`                                                    | R1→R2 read-time normaliser for non-Cegid clients   |
| `src/lib/workItems/stateMachine.ts`                                                   | Transition validation, extensible for future types |
| `src/lib/events/publish.ts`                                                           | Cloud-Logging-only event publisher (shim)          |
| `src/app/api/clients/[clientId]/wishlists/route.ts`                                   | List + create (existing, upgraded)                 |
| `src/app/api/clients/[clientId]/wishlists/[wishlistId]/route.ts`                      | Read + patch + delete (existing, upgraded)         |
| `src/app/api/clients/[clientId]/workItems/route.ts`                                   | List + create (new)                                |
| `src/app/api/clients/[clientId]/workItems/[workItemId]/route.ts`                      | Read + patch (new)                                 |
| `src/app/api/clients/[clientId]/workItems/[workItemId]/transitions/route.ts`          | Transition (new)                                   |
| `src/app/api/clients/[clientId]/workItems/[workItemId]/comments/route.ts`             | Comment (new)                                      |
| `src/app/(dashboard)/clients/[clientId]/wishlists/page.tsx`                           | Page (existing, upgraded)                          |
| `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistListClient.tsx`             | Existing — kept as orchestrator                    |
| `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistTable.tsx`                  | Split out, upgraded                                |
| `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistForm.tsx`                   | Split out, upgraded                                |
| `src/app/(dashboard)/clients/[clientId]/wishlists/WishlistDrawer.tsx`                 | Details/Discussion drawer                          |
| `src/components/workItems/WorkItemStream.tsx`                                         | Discussion tab — list of cards                     |
| `src/components/workItems/WorkItemCard.tsx`                                           | Single card with activity log                      |
| `src/components/workItems/RaiseQuestionForm.tsx`                                      | Modal                                              |
| `src/components/workItems/CommentBox.tsx`                                             | Comment box with audience override                 |
| `scripts/migrate-wishlists-r2.ts`                                                     | One-shot migration                                 |
| `tests/wishlists/notesClassifier.test.ts`                                             | Vitest — routing logic                             |
| `tests/workItems/stateMachine.test.ts`                                                | Vitest — state transitions                         |

**The subject-agnostic discipline.** Components in
`src/components/workItems/` MUST be subject-agnostic. They take a
`subject` reference as a prop and render the Work Item stream for that
subject without knowing or caring what a Wishlist is. The surface-specific
UI (Wishlist row badge etc.) knows about Wishlists; the drawer, stream,
card, comment box, and Raise Question form do not. **No conditionals like
`if (subject.entityType === 'wishlist')` inside any component under
`src/components/workItems/`.**

# 11. Styling guidance

See spec body. Key tokens:

- CompanyRef status dot: 8px, green (#30BAA0) for SF, grey (#9CA3AF) for candidate.
- Targeting hint chips: type-coloured.
- Open Items pill: colour by highest-priority open item.
- Audience indicator icons: Lock / Users / User (Lucide).
- Discussion drawer: slides in from right, ~520px wide.

# 12. Implementation checklist

1. Schema + types + Firestore rules update (workItems collection rules
   with audience gating).
2. Read adapter for R1 wishlists (non-Cegid forward compat).
3. Local event publisher (Cloud Logging shim — implements Event
   Publisher Pattern v0.1).
4. Wishlist API endpoints upgraded.
5. Work Item lite API endpoints + state machine.
6. Migration script (six-part structure per Migration Pattern v0.1:
   pre-snapshot, idempotency check, transformation, side-effect creation,
   migration log, `--rollback` flag).
7. WishlistForm refactor + upgrade.
8. WishlistTable refactor + upgrade.
9. Subject-agnostic Work Item components.
10. Discussion drawer + Edit-in-Details integration.
11. Role-based filtering, page-level counts, empty states.
12. Vitest setup + classifier + state-machine tests.
13. Dev migration dry-run (with seeds A/B/C).
14. Production migration runbook.
15. AC1–AC12 smoke test.

# 13. Definition of done — AC1–AC12

Tested per role on Cegid Spain post-migration. The four roles are
internal-admin, internal-user, client-approver (alessandro@cegid.com),
client-viewer (monica@cegid.com).

- **AC1:** Internal-admin and internal-user can see all six migrated
  Cegid wishlist entries with the new structured fields. Each entry
  shows companyName, status dot (grey for candidate — all six should be
  candidate post-migration), priority, status, campaigns (where set),
  Added date and addedBy.
- **AC2:** Adding a new wishlist entry through the upgraded form
  succeeds for internal users and client-approver. Form validation
  blocks save when both company name and targeting hints are empty.
  Source picker is required. Source detail appears conditionally for
  conference-list, industry-event, other.
- **AC3:** Editing an existing entry preserves all fields. The
  "Migrated note" banner appears for any entry with `targetingHintsRaw`
  populated (likely zero for Cegid). Setting `targetingHints` clears
  `targetingHintsRaw` on save.
- **AC4:** Clicking a wishlist row opens the side drawer with Details
  and Discussion tabs. Details tab shows the row's structured fields
  read-only.
- **AC5:** "Raise Question" creates a `wishlist-clarification` Work Item
  with state `raised`. Audience defaults to shared; toggling to
  internal-only works. Title and body required; priority defaults to
  medium.
- **AC6:** Adding a comment on a Work Item appends to the activity log
  with correct timestamp and author. Audience override on a comment
  works (an internal-only comment on a shared Work Item is invisible
  to the client user).
- **AC7:** State transitions work per §4.3: `raised → clarified`,
  `clarified → closed`, `raised → closed` (with comment requirement on
  shortcut close). Illegal transitions are blocked.
- **AC8:** Open Items column on the main table reflects the count of
  non-closed, non-archived Work Items per entry. Clicking the count
  opens the row drawer to the Discussion tab. Page header subtitle
  reflects the total across visible entries. (Implementation: simple
  count query at this scale; see §7.7 for scale-up path. Do not
  pre-optimise.)
- **AC9:** Client-approver (alessandro@cegid.com) sees: all six
  wishlist entries; can edit and add entries; can raise shared Work
  Items; cannot see Source field; cannot see internal-only Work Items
  or comments. Client-viewer (monica@cegid.com) sees the same as
  client-approver but read-only — no add, no edit, no raise.
- **AC10:** Events are emitted for wishlist mutations and Work Item
  activity, observable in the existing Exchange event log / Cloud
  Logging output.
- **AC11:** Migration script: idempotent (running twice produces the
  same result). Migration log lists every entry processed, every Work
  Item created, every So What drafted (likely zero for Cegid), every
  `targetingHintsRaw` preserved.
- **AC12:** No R1 free-text notes content is lost. Either it is mapped
  to structured fields, captured in a closed Work Item, drafted as a
  So What, or preserved in `targetingHintsRaw` with a UI prompt to
  clean up.

# 14. What this slice does NOT include

- Exclusions, Conflicts, Relationships (subsequent slices).
- Salesforce Account ID resolution for candidate companyRefs (Refinery
  integration, future slice).
- Auto-actions on Work Item state transitions.
- Bulk import / export.
- Real-time Work Item updates (no WebSocket / SSE).
- Notifications.
- Migration of clients other than Cegid Spain.
- Modifying the So Whats module.
- Modifying R2 entity model work (Proposition, Campaign, TLM, Campaign Directive).
- Migration to the platform Work Item primitive (separate future slice).

---

*Spec v0.2 · April 2026 · Internal — Confidential*

*Angsana Exchange — R2 Prospecting Validation Surfaces — Slice 1: Wishlists*

*v0.2 amendments: explicit migration-path-and-semantics note (§4.1);
supersession affordance named (§4.3); subject-agnostic UI discipline named
(§10); strengthened §7.7 scale-up note + AC8 parenthetical; specific seed
entries exercising routing paths (§6.6); pre-empted Cline questions on
role-based filtering location (§8) and audit collection deferral (§6.5).*

*v0.2 in-tree adjustments (Cline build pass): §5 publisher shape and §6
migration runbook subject to v0.3 amendment when platform-level note
settles. §10 file paths use actual `(dashboard)` route group.
`schemaVersion: 'r2-v1'` marker added to schema for migration idempotency.
`'client'` audience reserved but not produced in this slice.*

*v0.2 platform-pattern alignment pass (Cline, post Pattern docs landing):
§5 now implements Angsana Event Publisher Pattern v0.1 (canonical
envelope, verb vocabulary, `mirrorToFirestore` option). Verb correction:
`workitem.created` → `workitem.added`; `wishlist.companyRefUpdated` →
`wishlist.companyRefChanged`. §6 now implements Angsana Migration
Pattern v0.1 (six-part structure, snapshot/idempotency/rollback
discipline, migration events). Schema marker upgraded from `'r2-v1'` to
`'r2-pvs-wishlist-v1'` to match the pattern's `{pattern}-v{n}` shape.*
