# Wishlists R2 Migration — Operational Runbook

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Migration ID    | `r2-pvs-wishlist`                                                            |
| Schema target   | `r2-pvs-wishlist-v1`                                                         |
| Script          | `scripts/migrate-wishlists-r2.ts`                                            |
| Pattern         | [Angsana Migration Pattern v0.1](../architecture/Angsana_Migration_Pattern_v0_1.md) |
| Slice spec      | [R2 PVS Slice 1 — Wishlists](../architecture/r2-pvs-s1-wishlists-spec.md) §6 |
| Operator        | Single dev-machine operator (per Migration Pattern §6 — none of the four audit-collection triggers is currently active) |
| Tenants         | `angsana` only                                                               |
| Clients         | `cegid-spain` only (this slice; other clients unaffected)                    |

This runbook is the operational counterpart to the slice spec's §6 and the
Migration Pattern v0.1. Each step below cites the pattern section that
authorises it; if a step here ever conflicts with the pattern, the pattern
wins and this runbook gets updated.

---

## 0. Before you start — context

This migration upgrades the Cegid Spain wishlist documents from R1's loose
schema to the R2 schema (per slice spec §3). It is a one-shot operation
(per Migration Pattern §2.1): single tenant, single client, low volume
(six entries plus three dev seeds = nine documents). Running it twice is
safe (idempotent per pattern §3.2); rolling it back is supported and
tested in dev (pattern §3.3).

**Read first:** the [Migration Pattern v0.1](../architecture/Angsana_Migration_Pattern_v0_1.md)
end-to-end. This runbook assumes you've internalised the six-part
structure, the snapshot-as-hard-precondition discipline, and the
log-and-continue error handling.

---

## 1. Pre-flight check

| Check                                                                 | How to verify                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `gcloud` ADC is set for project `angsana-exchange`                    | `gcloud auth application-default print-access-token` returns a token             |
| Operator is the only person currently running migrations              | Coordinate via team chat — pattern §6 audit-collection triggers don't fire while volume stays at one operator |
| Repository is on `main` and clean                                     | `git status` shows no pending changes; `git log -1` shows the expected commit     |
| `migrations/` directory exists and is gitignored                      | `cat .gitignore | grep migrations` shows `/migrations/`                          |
| Operator identity environment is set                                  | `MIGRATION_OPERATOR_UID` and `MIGRATION_OPERATOR_EMAIL` exported in the shell    |
| `npx tsc --noEmit` passes                                             | Shipping a broken migration is worse than running yesterday's tested one          |

Set the operator identity for the run:

```bash
export MIGRATION_OPERATOR_UID="$(gcloud config get-value account)"
export MIGRATION_OPERATOR_EMAIL="$(gcloud config get-value account)"
```

---

## 2. Snapshot verification (Migration Pattern §3.1)

The script writes a pre-snapshot to `migrations/snapshots/` as its first
mutation-touching step. The snapshot is the **rollback substrate** and a
**hard precondition**: if the snapshot fails to write, the script aborts.

You don't take the snapshot manually — the script does. The check here is
that the script's first action *is* the snapshot, and that the
`migrations/snapshots/` directory is writeable on this machine. The
dry-run in step 3 verifies both.

> Snapshot files contain tenant data. They are gitignored (per
> `.gitignore` and pattern §3.1). Do not commit them, do not move them
> into shared storage. They live on the operator's machine only, until
> the operator explicitly deletes them after successful verification
> (pattern §3.1: snapshot lifetime is the operator's call).

---

## 3. Dry-run on dev

A dry-run reads the wishlist collection, takes the snapshot, walks every
document through the transformation logic, and writes the migration log
**without** writing any document mutations or side-effect entities. This
gives you the operator-readable preview of what will change.

```bash
cd angsana-exchange
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana \
    --client=cegid-spain
```

Observe:

- The console summary names the count of upgraded, skipped, errored.
- The migration log at `migrations/r2-pvs-wishlist-{timestamp}-angsana.json`
  contains every document's intended outcome and the side-effect manifest
  (with placeholder IDs because nothing was written).
- The four migration events (`migration.started`,
  `migration.documentUpgraded` per doc, `migration.completed`) appear in
  the local console output as Cloud-Logging-shaped JSON under
  `angsanaEvent`. In a deployed dev run, they would appear in Cloud
  Logging under the same key (per Event Publisher Pattern §4.1).

**Forward-then-rollback dev test (acceptance per slice spec §6.5).** In
the dev environment, run the migration with `--execute`, verify the
upgraded shape on a couple of documents in Firestore, then run
`--rollback --log=<the-log-just-written>` (with `--execute` again to
actually delete and restore). Verify the documents are back to their
pre-migration shape and the side-effect entities (Work Items, So Whats)
are gone. This rehearsal is the practical evidence that the rollback
mechanism works for this specific migration.

```bash
# Forward (dev):
npx tsx scripts/migrate-wishlists-r2.ts --tenant=angsana --client=cegid-spain --execute

# Note the log path printed at the end — paste it into the rollback command.

# Rollback (dev):
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana --client=cegid-spain \
    --rollback --execute \
    --log=migrations/r2-pvs-wishlist-2026-04-30T...-angsana.json
```

After rollback, re-query the wishlist documents. Each should be back at
its R1 shape (no `schemaVersion` field, original `notes`, original
`addedBy` string). The Work Items and So Whats raised by the forward run
should no longer exist.

---

## 4. Production run

Only proceed once dev has rehearsed forward-then-rollback cleanly.

```bash
# Final dry-run against production (no writes):
cd angsana-exchange
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana \
    --client=cegid-spain
```

Inspect the dry-run log. If the upgraded count matches expectations (six
entries) and the side-effect manifest looks sane (a handful of Work Items
or So Whats raised from the routed notes content per slice spec §6.3),
proceed.

```bash
# Production execute:
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana \
    --client=cegid-spain \
    --execute
```

Capture and save:

- The migration log path printed on completion. **Save this path.** It
  is the rollback input.
- The snapshot path printed on completion. **Save this path.** It is the
  rollback substrate.
- The summary line: upgraded/skipped/errored counts.

The script emits `migration.completed` (or `migration.failed` with
severity `ERROR` per Event Publisher Pattern §4.1) at the end of the run.
Confirm the event in Cloud Logging by filtering on
`jsonPayload.angsanaEvent.eventType="migration.completed"` and
`jsonPayload.angsanaEvent.payload.patternId="r2-pvs-wishlist"`.

---

## 5. Post-run verification

| Check                                                                       | Per                              |
| --------------------------------------------------------------------------- | -------------------------------- |
| Every Cegid Spain wishlist document has `schemaVersion: "r2-pvs-wishlist-v1"` | Slice spec §6.2; Pattern §3.2     |
| New required fields populate as expected (`source: "migration"`, `targetingHints: []`, etc.) | Slice spec §3.2                  |
| Free-text `notes` field has been removed from upgraded documents             | Slice spec §6 (preserves no-notes invariant) |
| Side-effect Work Items appear under `tenants/angsana/clients/cegid-spain/workItems/` with `sourceMigrationRun` matching the run ID | Pattern §2 row 4 (idempotency on side effects) |
| So What drafts (if any) appear with `status: 'draft'` and the same provenance marker | Slice spec §6.3                  |
| Cloud Logging shows `migration.started`, N × `migration.documentUpgraded`, `migration.completed` for the run | Pattern §5                       |
| Operators with relevant uid/email mapped onto `addedBy` cleanly (placeholder uids `migration:<email>` flagged for follow-up if needed) | Migration script transformation comment |

Re-run the script (without `--execute`, without `--rollback`). The
expected dry-run summary is `upgraded: 0, skipped: 6, errored: 0` — every
document is at the target schema and the idempotency check skips them
all. This is the smoke test that the migration ran clean (pattern §3.2's
real value).

---

## 6. Rollback procedure (Migration Pattern §3.3)

Rollback restores the wishlist documents from the snapshot and deletes
the side-effect entities (Work Items, So Whats) listed in the migration
log's manifest. It is testable in dev (step 3 above) and the same
invocation applies in production.

```bash
# Always dry-run rollback first:
cd angsana-exchange
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana --client=cegid-spain \
    --rollback \
    --log=<path-to-migration-log.json>
```

Inspect the console output. Each side-effect entity to be deleted is
named; each document to be restored is named. If the operator is
satisfied, run with `--execute`:

```bash
npx tsx scripts/migrate-wishlists-r2.ts \
    --tenant=angsana --client=cegid-spain \
    --rollback --execute \
    --log=<path-to-migration-log.json>
```

The script reads the log, reads the snapshot referenced from the log,
performs the deletions and restores, and emits `migration.started` /
`migration.completed` for the rollback run (mode `rollback` in the
payload, per pattern §5).

**When to roll back.** The slice spec's AC1–AC12 are the post-run
acceptance gates. If any gate fails on production data and the failure is
attributable to the migration (not a pre-existing data issue), rollback
is the recovery path. The script does not auto-rollback on errors —
per-document errors during the forward run are logged and the run
continues (pattern §3.4); rollback is an operator decision based on the
post-run verification.

**Rollback's known limit.** Rollback reverses only this migration's
direct effects (documents + side-effect entities). Cross-component
reversal — for example, undoing the consequence of a downstream consumer
that read a `migration.documentUpgraded` event and acted on it — is out
of scope for this version (pattern §7). For the Wishlists slice this is a
non-issue: no consumer reads these events yet.

---

## 7. After successful verification

- Snapshot files in `migrations/snapshots/` may be deleted by the
  operator once confidence is established. The script does not auto-clean
  (pattern §3.1).
- Migration log files in `migrations/` are retained indefinitely
  (pattern §4.2). They are the historical record of this migration run.
- No audit-collection write is performed (pattern §6: none of the four
  triggers is active). The dev-machine log + Cloud Logging events stream
  is the durable record.

---

## 8. If the script fails mid-run

The script logs each per-document outcome and continues on per-document
errors (pattern §3.4). A *script-level* failure (e.g. snapshot write
fails, Firestore permission revoked mid-run) emits `migration.failed`
with severity `ERROR` and exits non-zero.

Recovery:

1. Inspect the partial migration log file — its `documents` array shows
   what got upgraded before the failure.
2. Inspect the partial snapshot — it should be intact (the snapshot is
   written before any document mutation).
3. Decide: re-run forward (the idempotency check skips already-upgraded
   docs and continues from where the failure stopped) or roll back the
   partial run.
4. Document the incident: the migration log itself is the evidence.

---

## 9. Pattern citations summary

| Step in this runbook              | Migration Pattern §                                |
| --------------------------------- | -------------------------------------------------- |
| Pre-flight (operator identity)    | §2.2 (locally-runnable by default)                 |
| Snapshot                          | §3.1 (hard precondition)                           |
| Idempotency marker                | §3.2 (`schemaVersion`)                             |
| Dry-run + forward-rollback dev test | §3.3 (rollback is testable; ship with --rollback) |
| Per-document errors logged-and-continue | §3.4                                          |
| Migration log location/content    | §4.1, §4.2                                         |
| Migration events emitted          | §5                                                 |
| No audit collection               | §6 (no trigger active)                             |
| What rollback covers              | §7 (cross-component reversal deferred)             |

---

*Runbook v0.1 — April 2026 — to be amended as subsequent R2 PVS slice
migrations land and surface operational refinements.*
