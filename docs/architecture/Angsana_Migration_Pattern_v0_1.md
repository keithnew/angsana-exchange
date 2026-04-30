# Angsana Migration Pattern

**v0.1 — Platform pattern document**

| Field        | Value                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Status       | Draft for review                                                                            |
| Audience     | Cline (immediate implementation reference for Exchange R2 PVS migrations); future agents implementing migrations anywhere on the platform; LGaaS architecture review |
| Date         | April 2026                                                                                  |
| Supersedes   | Nothing — first formal migration pattern document                                            |
| Related      | Angsana Event Publisher Pattern v0.1; Build Sequence v0.2 (BSP unit framing); Capabilities and API Surface Note v0.2 §1.4 (supersession discipline); Exchange R2 Prospecting Validation Surfaces v0.1; Refinery Lead Record and Identity Binding Architecture v0.1 |

> This is the in-tree mirror of the platform pattern document. It is committed
> alongside the slice spec it governs so that the implementation reference is
> grounded in the repo. The authoritative copy lives at LGaaS level.

---

## 1. What this document is

A pattern document for data migrations across the Angsana platform. It specifies the structure every migration script follows, the safety mechanisms each script implements, the migration log shape, and the trigger for moving from dev-machine-and-logs operation to a central audit collection.

It exists because five-plus migrations are imminent in the next two months: the four R2 Prospecting Validation Surfaces (Wishlists, Conflicts, Exclusions, Relationships), then Refinery cut-over migrations from the Retool-era pipeline, then platform reference data population migrations. Improvising each one means small judgement variations that future agents must reconcile; settling the pattern means each migration script fits a known shape and review effort goes to the migration's content rather than its scaffolding.

### 1.1 Why the pattern is settled now

Cline's review of the Wishlists slice surfaced the migration safety gap: the original spec deferred an audit collection but did not specify pre-snapshot, idempotency markers, or rollback procedures. Cline's instincts on each were correct; the same instincts will apply to the next four migrations and beyond. Settling the pattern at platform level once means the next four scripts inherit the discipline rather than re-deriving it.

## 2. The structure of a migration script

Every migration script — regardless of scale, regardless of which collection is being migrated — has six parts. The parts are sequential during forward migration; rollback uses parts in reverse order.

| Part                    | Responsibility |
| ----------------------- | -------------- |
| Pre-snapshot            | Captures the affected collection state to a JSON file before any mutation. Hard precondition: the script refuses to run if the snapshot fails. The snapshot is the rollback substrate. |
| Idempotency check       | Reads each target document and skips those already at the target schema version. The `schemaVersion` field on each upgraded document is the marker. Re-running is safe; partial-run resumption works without manual intervention. |
| Transformation          | The actual migration logic. Per-document errors are caught, logged, counted, and the script continues. Aborting on first error is not the default; producing a clear errored-document list at the end is. |
| Side-effect creation    | Creation of related entities (Work Items, So Whats, etc.) is captured in the migration log as a manifest of created IDs. Side effects are themselves idempotent: a `sourceMigrationRun` marker on each created entity allows re-runs to skip rather than duplicate. |
| Migration log           | A structured JSON artefact at a known path: `migrations/{pattern}-{timestamp}-{tenant}.json`. Records the run summary, per-document outcomes, and the side-effect manifest. Becomes the durable record for that migration run. |
| Rollback procedure      | Documented in the script's readme and supported by a `--rollback` flag. Restores from snapshot and deletes side-effects by ID from the manifest. Rollback is as testable as forward migration. |

### 2.1 The script as one-shot

A migration script is conceptually a one-shot operation: it runs once per target tenant per target schema version. The idempotency check supports re-running for partial-failure recovery, but the intended pattern is single-run-to-completion. Scripts that need to run periodically are not migrations in this sense; they are pipelines, and they belong in the pipeline machinery (Refinery jobs, scheduled Cloud Run tasks) with their own operational shape.

### 2.2 The script as locally-runnable by default

A migration script is runnable from a developer machine using the firebase-admin SDK with the appropriate service account credentials. This is the default operating mode for current and near-term migrations: the operator has the credential, the script is in the repository, the operator runs the script, the migration log lands on the operator's machine. This is sufficient for migrations of the scale currently anticipated (single-tenant, low-volume, infrequent).

When migration scale demands it (per section 6, the audit-collection trigger), the same script becomes deployable as a Cloud Run job with no structural change. The script's code is environment-aware: it picks up credentials from the environment, writes the migration log to the configured destination (local filesystem in dev mode, Cloud Storage in deployed mode), and otherwise behaves identically.

## 3. Safety mechanisms

### 3.1 Pre-snapshot

Before any document mutation, the script reads the entire affected collection (or the bounded subset being migrated) and writes a snapshot JSON file to `migrations/snapshots/{pattern}-{timestamp}-{tenant}-pre.json`. The snapshot is the source of truth for rollback. It is gitignored — these files contain tenant data and must not enter version control — but lives in a known directory the script and the operator both know.

The snapshot is a hard precondition. If the script cannot write the snapshot, it refuses to proceed. There is no override; the discipline is not optional. A migration without a snapshot is not safe to roll back, and a migration that cannot be safely rolled back should not be run.

Snapshot lifetime is tied to the operator's confidence in the migration outcome. The operator deletes the snapshot manually when the migration is verified successful and the rollback option is no longer needed; the script does not auto-clean snapshots. This puts the rollback decision firmly with the operator rather than the tooling.

### 3.2 Idempotency marker

Each upgraded document carries a `schemaVersion` field with a value matching the migration pattern (e.g. `r2-pvs-wishlist-v1`, `refinery-canonical-v1`). The script's idempotency check reads this field on each target document and skips documents already at the target version.

The marker enables three things: re-running the script after partial completion, detecting documents that were missed by an earlier run, and querying the collection for "documents not yet at version X" during cut-over windows. The cost is one small string field per document; the value is operational confidence.

### 3.3 Rollback procedure

Every migration script ships with a `--rollback` flag. When invoked with this flag, the script reads the migration log and the snapshot, restores documents to their pre-migration state, and deletes side-effect entities by their IDs from the side-effect manifest.

Rollback is testable. In a dev environment, an operator can run the migration forward, verify the outcome, run rollback, and verify the collection has returned to its pre-migration state. This testing is the practical validation that the migration is reversible; it should happen as part of every migration's development, not just in production runs.

### 3.4 Per-document error handling

A document that fails to migrate (e.g. an unexpected field shape, a transformation error) is logged with the error detail and the script continues. The migration log's per-document outcomes record which documents errored. The script's exit summary names the count of upgraded, skipped-already-versioned, and errored documents.

Aborting on first error is not the default. The reasoning: a single malformed document should not block the migration of the remaining well-formed ones, but the operator must know which documents need attention. The errored-documents list is the operator's next-step input; it informs whether the migration can be considered complete or whether a follow-up pass is needed.

## 4. The migration log

Every migration run produces a structured JSON log file at `migrations/{pattern}-{timestamp}-{tenant}.json`. The log is the durable record of that run.

### 4.1 Log content

The log is a single JSON object containing: the migration pattern identifier, the schema version target, the tenant ID, the operator UID and email, the start and end timestamps, the run summary (counts of upgraded / skipped / errored), the per-document outcomes (document ID plus outcome plus error detail where applicable), and the side-effect manifest (list of entities created during this run, each with its collection path and document ID).

The side-effect manifest is the rollback input for created entities. It must be exhaustive: any entity created by the migration script must appear in the manifest. This includes Work Items raised, So Whats drafted, audit entries written, events emitted that have persistent representation. The discipline is: if the migration created it, the manifest knows about it.

### 4.2 Log location and retention

In dev-machine mode, the log lives at the configured local path (default: `migrations/` relative to the repository root, gitignored). In deployed mode, the log lives in Cloud Storage at a known bucket path with appropriate retention. The script's configuration determines which mode it operates in; the log's consumer (the operator, or a future audit dashboard) reads from whichever location is configured.

Logs are retained indefinitely by default. They are small, they are infrequent, and their value as historical record outweighs their storage cost.

## 5. Migration events

Migrations are first-class participants in the platform event model (per the Angsana Event Publisher Pattern v0.1). A migration script emits events at four points:

- `migration.started` on script invocation, with the migration pattern, schema version target, tenant, and operator identity in the payload.
- `migration.documentUpgraded` per successfully-upgraded document, with the document ID, the source schema version, and the target schema version. (For very large migrations, this can be configured to emit per-batch rather than per-document; the default is per-document.)
- `migration.completed` on successful completion, with the run summary in the payload.
- `migration.failed` if the script fails before completion, with the error context.

Migration events flow through the standard event publisher (Cloud Logging by default) and are queryable alongside other platform events. This is what makes a migration's effects visible to the platform's observability surfaces without a separate operational mechanism.

## 6. The audit-collection trigger

For dev-machine, single-operator, low-volume migration runs, the migration log files plus the events stream are sufficient durability. The dev-machine log is the operator's record; the events stream is the platform's observability.

When migration scale exceeds the dev-machine envelope, a central audit collection becomes necessary. The collection lives at `platform/migrations/{migrationId}` (cross-tenant; migrations are platform operations, not tenant operations) and stores the full migration log content plus references to the snapshot and side-effect manifest.

### 6.1 The triggers

The audit collection is introduced when any one of the following holds:

| Condition                                          | Implication |
| -------------------------------------------------- | ----------- |
| More than three migrations within a calendar week  | Volume threshold reached. Migration log files start to multiply on developer machines; durability across machines becomes a concern. |
| More than one operator running migrations          | Multiple developer machines become migration log hosts. Reconciliation and shared visibility require a central record. |
| Recurring scheduled migration                      | Migrations move from one-shot to ongoing. The audit collection becomes the operational record; logs alone are insufficient for trend analysis. |
| Cross-tenant migration sweep                       | A single migration touching multiple tenants in one run. The per-tenant scoping of dev-machine artefacts breaks down; central audit is necessary. |

None of these triggers is currently active. The four R2 PVS migrations are dev-machine, single-operator, low-volume, single-tenant operations; they fit the default mode cleanly. The trigger is named here so the upgrade decision is automatic when the time comes, rather than rediscovered.

### 6.2 What the audit collection adds

When the audit collection is introduced, the migration script gains a small additional behaviour: at run completion, it writes the full migration log (or a summary plus log location reference) to `platform/migrations/{migrationId}`. This complements the file-based log; it does not replace it. File-based logs remain the operational record; the audit collection is the cross-machine durable index.

Introducing the audit collection is a one-time pattern change, not a per-script effort. The publisher-lite analogue is appropriate: a single migration-audit module that the script calls, with its body initially writing to file and later writing to file plus collection, with no call-site change.

## 7. What is deliberately deferred

- **Migration UI.** No user interface for triggering, monitoring, or managing migrations exists in this version. Operators run scripts from the command line; the migration log is the user interface. A platform UI for migration management is a future possibility when migration volume justifies it.
- **Cross-tenant orchestration.** Migrating multiple tenants in a single sweep is not in scope. Each tenant's migration is its own script invocation, with its own snapshot, log, and side-effect manifest.
- **Schema diff tooling.** A tool that compares actual document shapes against expected schemas (and identifies migration candidates automatically) is not in scope. Migration triggers come from spec changes, not from automated detection.
- **Migration test harness.** A reusable test framework for verifying migration correctness against representative document samples is plausible but not in scope for this version. The current pattern relies on operator-driven dev-mode runs against representative data and per-script verification steps.
- **Rollback automation across components.** A migration that has emitted events consumed by a downstream component creates a question of whether rollback should also reverse the consumer's state. This is out of scope; rollback today reverses only the migration's direct effects (documents and side-effect entities). Cross-component reversal is a future concern when consumer count grows.

## 8. Adoption and review

### 8.1 First adopters

The Wishlists slice migration is the first adopter of this pattern. Its script implements the six-part structure, emits the four migration events, writes the migration log to the local `migrations/` directory, and ships with a `--rollback` flag tested in dev mode.

Subsequent adopters: the Conflicts, Exclusions, and Relationships slice migrations (R2 PVS sequence). Then Refinery cut-over migrations from Retool-era data. Then any platform reference data population migration that lands during the same period.

### 8.2 Review triggers for v0.2

A v0.2 of this document is triggered by any of: an audit-collection trigger condition becoming active (which puts the central audit pattern in operational scope); a migration that genuinely cannot be made idempotent or reversible under this pattern (in which case the pattern is amended to accommodate); a third-party operator running migrations (introducing a permissioning concern not addressed here); or the platform event bus shipping (at which point migration events flow through the bus rather than Cloud Logging, with implications for the events section above).

None of these is expected before the four R2 PVS migrations complete. v0.1 is the working frame for that span.

## 9. Document control

- **Author:** Drafted in conversation with Keith. Reviewed against Cline's safety-mechanism recommendations on the Wishlists slice and the migration shapes implicit in the upcoming R2 PVS sequence and Refinery cut-over.
- **Review:** Internal Angsana team. Particular value in: Cline's eye on the pattern as the four R2 PVS migrations land in sequence; operational review when the third or fourth migration in the sequence happens, when the dev-machine assumptions are most exposed.
- **Sign-off:** Keith — pattern sign-off ahead of Wishlists slice migration step (Cline checklist step 7) and as a precondition for the Conflicts slice migration design.
