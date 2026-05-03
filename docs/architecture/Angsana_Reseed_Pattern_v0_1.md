# Angsana Reseed Pattern

**v0.1 — Platform pattern document**

| Field        | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Status       | Draft for review                                                                            |
| Audience     | Cline (immediate implementation reference for Exchange R2 PVS migrations); future agents implementing migrations against seed-data-only environments; LGaaS architecture review |
| Date         | April 2026                                                                                  |
| Supersedes   | Nothing — first formal reseed pattern document                                               |
| Related      | Angsana Migration Pattern v0.1 (companion pattern; full machinery for the post-seed era); Angsana Event Publisher Pattern v0.1; Capabilities and API Surface Note v0.2 §1.4 (supersession discipline); Exchange R2 Prospecting Validation Surfaces v0.1 |

> This is the in-tree mirror of the platform pattern document. It is committed
> alongside the slice spec it governs so that the implementation reference is
> grounded in the repo. The authoritative copy lives at LGaaS level.

---

## 1. What this document is

A pattern document for data shape changes against environments that hold only seed or test data. It specifies a deliberately lightweight structure — read, reseed in the new shape, delete the old — with a small amount of structural ceremony for traceability and an explicit per-component trigger condition for switching to the heavier Migration Pattern v0.1 once the environment graduates from seed data to real client data.

It exists because the Migration Pattern v0.1 is calibrated against a protect-real-production-data threat model. That calibration is correct for the long run but disproportionate during the seed-data era, when the environment holds only test fixtures and the snapshot-and-rollback machinery exercises correctness rather than protecting irreplaceable data. Wishlists slice deployment surfaced the gap: machinery cost was material, machinery benefit was theoretical.

This pattern is the lightweight companion. The Migration Pattern v0.1 is not retired; it remains the right pattern for the post-seed era. The two patterns are siblings under a per-component era trigger, governed by the rule in section 4 below.

### 1.1 Scope: per-component, not platform-wide

The choice between Reseed Pattern and full Migration Pattern is made per component, not platform-wide. Each component (Exchange, Refinery, Research Hub, Core, and so on) carries its own data home with its own threat model, and each component graduates from the seed-data era independently. A real client onboarded to Exchange does not change the threat model of a Refinery batch run that touches only test data.

The discipline question — which pattern do I reach for — is solved by making each component's era legible at the component level. A component's spec or build sequence states its current era, and a developer or agent reaching for a migration script reads the era from the component's documentation. There is no platform-wide flag day; there is a per-component trigger that fires when that component first holds real client data.

## 2. The structure of a reseed script

Every reseed script has three parts. The parts are sequential during execution. There is no rollback procedure; reseed is forward-only by design — if the new shape is wrong, the operator runs another reseed against the current shape, not a rollback to a prior state.

| Part | Responsibility |
| ---- | -------------- |
| Read | Reads the affected collection (or the bounded subset being reseeded) into memory. The read is the substrate for the transformation; it is not a snapshot, and is not retained beyond the script's execution. |
| Reseed | Writes new documents in the target shape. The new documents carry a `schemaVersion` field at the target value. Per-document errors are caught, logged, and counted; the script continues. The new documents land in the same collection as the old, distinguishable by `schemaVersion`. |
| Delete | Deletes the old-shape documents. Performed only after the reseed has completed and the operator has verified the new-shape documents are correct. The delete step is its own invocation — the script supports a `--delete-old` flag that is run as a separate, deliberate step. |

### 2.1 The two-step execution model

Reseed is intentionally split into two operator-driven steps: reseed-then-verify, then delete-old. The reasoning: even in the seed-data era, the operator wants to confirm the new shape before discarding the old. The split puts a verification window between write and destroy without introducing snapshot machinery; the old documents are themselves the verification baseline until they are deleted.

Once the operator has confirmed the new-shape documents are correct, the delete step is a separate command. There is no automatic delete-on-success and no time-window auto-cleanup. The discipline is operator-explicit because the cost of getting it wrong (deleting old documents that the new shape is missing data from) is high enough to warrant the deliberateness, even against seed data.

For ID-stable reseeds — where the new-shape document is written to the same Firestore document ID as the old (because downstream references like `subject.entityId` would otherwise break) — the "delete-old" step degrades to a verification-only sweep: there are no separate old-shape documents to delete, only stragglers (documents the reseed missed) to surface. The two-step ceremony is preserved for discipline; the delete itself becomes a no-op in the typical case. The script should log this clearly so the operator is not left wondering why the delete count is zero.

### 2.2 The script as locally-runnable by default

A reseed script runs from a developer machine using firebase-admin SDK with the appropriate service account credentials, exactly as a Migration Pattern script does. The two patterns share the same execution environment; what they differ in is the safety machinery, not the runtime model.

## 3. Minimal traceability ceremony

Reseed scripts carry a small amount of ceremony so the operation is legible after the fact. The ceremony is deliberately less than the Migration Pattern's, but it is not absent.

### 3.1 One reseed event

Each reseed run emits a single `reseed.completed` event through the standard event publisher (per Event Publisher Pattern v0.1) with a payload naming the pattern, the collection affected, the count of documents reseeded, the count of errored documents, the `schemaVersion` source and target, and the operator identity. The event flows through Cloud Logging by default, alongside other platform events.

This is the only event the reseed pattern emits. There is no per-document event, no started event, no failed event — the single completed event with its summary payload is sufficient for the seed-data era. (The Migration Pattern's four-event shape applies in the post-seed era; reseed is deliberately lighter.)

### 3.2 Pre/post diff in logs

The script writes a structured log to stdout and to a local file at `reseeds/{pattern}-{timestamp}.json`. The log records: count of documents read, count of documents written in the new shape, count of errored documents during reseed, count of old documents deleted (if the delete step has run). Per-document detail is included for errored documents only; successfully-reseeded documents are recorded by count, not individually.

The log is the operator's verification surface for the reseed-then-verify step. It is not a durable audit record — the pre-seed era does not warrant that — but it is sufficient for the operator to confirm the run did what was expected before triggering the delete step.

### 3.3 schemaVersion bump on reseeded records

Each reseeded document carries a `schemaVersion` field with the target value (e.g. `r2-pvs-wishlist-v2`, `refinery-canonical-v1`). The marker enables the same three things it does in the Migration Pattern: re-running the script after partial completion (already-reseeded documents are skipped), detecting documents missed by an earlier run, and querying the collection for shape state during the verification window.

## 4. The per-component trigger to switch patterns

Reseed Pattern applies while a component's data home holds only seed or test data. The Migration Pattern applies once that component's data home holds real client data — even one client. The trigger is per component:

- **Exchange** operates under Reseed Pattern until the first real client onboards to Exchange. Cegid Spain in pilot status is currently a seed/test client (not a real client whose data must be protected against loss); the trigger has not yet fired. When the first real client onboards, Exchange's era flips and subsequent migrations against Exchange data use the full Migration Pattern.

- **Refinery** operates under Reseed Pattern until the first real refinery batch with real client output lands in production. Phase 1 hardening migrations against test data fit the Reseed Pattern; cut-over migrations from Retool-era data may or may not, depending on whether the Retool data is treated as real or as test fixture during cut-over.

- **Research Hub** operates under Reseed Pattern until it holds real research output that operations rely on for client work. The curatorial sub-module read surface (BSP-02-02a) currently reads from seed data; the trigger fires when the write surface ships and real curatorial work lands.

- **Core** is the data home for the platform once R2 PVS surfaces and Refinery records relocate there. Core's era is governed by the same rule: until real client data lives in Core, Reseed Pattern applies. The eventual relocation of R2 PVS surfaces from Exchange's Firestore into Core's Firestore is itself a future Reseed against seed-data-only state at the time it lands.

The trigger does not require a flag day. A component's build sequence or component spec records the era; the developer or agent reaching for a migration script consults the component's documentation and reaches for the right pattern. When the trigger fires for a component, that component's era marker is updated in the relevant document and subsequent migrations land under the Migration Pattern.

### 4.1 What a real client is

For the avoidance of doubt: a real client is one whose data, if lost, would represent a meaningful operational or commercial setback. A pilot client whose data is itself seed data (loaded for demonstration, not generated by real operational use) does not flip the trigger. A pilot client whose data represents real operational use (real wishlists, real conflicts, real client conversations) does flip the trigger — even if commercial pilot status is in name only.

The judgement is operational, not contractual. Cegid Spain in current pilot status, with the wishlists captured being seed-derived test data, is below the trigger. Cegid Spain at the point where Account Managers are using Exchange in their daily workflow with their actual client conversations is above the trigger, regardless of whether the pilot has formally graduated.

## 5. What is deliberately deferred

- **Snapshot.** There is no pre-snapshot in the Reseed Pattern. The old-shape documents are themselves the snapshot until the delete step runs; the verification window between reseed and delete is the operator's safety margin.

- **Rollback runbook.** There is no `--rollback` flag and no documented rollback procedure. If the new shape is wrong, the corrective action is another reseed against the current shape, not a rollback to a prior state. The delete step's deliberateness is what makes this safe: the operator does not delete old documents until they have confirmed the new shape is correct.

- **Per-document idempotency markers (beyond schemaVersion).** `schemaVersion` is the only marker. There is no `sourceMigrationRun` marker on side-effect entities, because reseed scripts are not in the business of creating side-effect entities — they reshape the documents in place. If a reseed needs to create related entities (Work Items, So Whats, etc.), the operation has crossed the threshold of reseed and is properly a migration; the Migration Pattern applies.

- **Audit collection.** There is no central audit record of reseed runs. The local log file plus the single `reseed.completed` event are sufficient for the seed-data era. Once a component's era flips and migrations begin under the Migration Pattern, the Migration Pattern's audit-collection trigger conditions take over.

## 6. Adoption and review

### 6.1 First adopters

The R2 PVS slice migrations — Wishlists (in flight at time of writing), Conflicts, Exclusions, Relationships — are the first adopters of this pattern. The Wishlists slice was originally written against the full Migration Pattern; subsequent slices adopt Reseed Pattern. The Wishlists deployment is not retroactively redone; the lesson is captured forward and the next three slices land under the lighter pattern.

The Wishlists v0.2 slice (additive: website, internal RA-context field, Source UI removal, discussion-presence indicator) is the first Reseed Pattern adopter on Exchange — a shape change against seed-era Cegid data, with no side-effect entities being created.

Subsequent adopters: Refinery Phase 1 hardening migrations against test data; the eventual Core relocation of the R2 PVS surfaces; any other reshape of seed-data-only collections that lands during the seed-data era.

### 6.2 Review triggers for v0.2

A v0.2 of this document is triggered by any of: the first per-component trigger firing (at which point the operational discipline of switching patterns at the component level is exercised for real, and the wording in section 4 may need refinement based on practice); a reseed that genuinely cannot be made forward-only under this pattern (in which case the pattern is amended or the operation is moved to the Migration Pattern); a reseed surface needing to create side-effect entities (which signals the operation has crossed the threshold and the pattern boundary needs sharpening); or a third-party operator running reseeds (introducing a permissioning concern not addressed here).

None of these is expected before the four R2 PVS slice migrations complete. v0.1 is the working frame for that span.

## 7. Document control

Author: Drafted in conversation with Keith. Triggered by the LGaaS-level Learnings memo from R2 PVS Slice 1 (Wishlists), specifically learning 1 (migration machinery is over-shaped for the seed-data era).

Review: Internal Angsana team. Particular value in: Cline's eye on the pattern as the Conflicts slice migration lands as the first adopter under Reseed; operational review at the point of the first per-component trigger firing.

Sign-off: Keith — pattern sign-off ahead of the Conflicts slice migration design.
