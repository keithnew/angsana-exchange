#!/usr/bin/env npx tsx
/**
 * R2 PVS Slice 1 — Wishlists migration
 * ====================================
 *
 * Implements the Angsana Migration Pattern v0.1 (in-tree mirror at
 * docs/architecture/Angsana_Migration_Pattern_v0_1.md). The script follows
 * the six-part structure per pattern §2:
 *
 *   1. Pre-snapshot           (§3.1 — hard precondition)
 *   2. Idempotency check      (§3.2 — schemaVersion marker)
 *   3. Transformation         (§3.4 — log and continue on per-doc errors)
 *   4. Side-effect creation   (§4.1 — exhaustive manifest)
 *   5. Migration log          (§4.1 — JSON artefact at known path)
 *   6. Rollback procedure     (§3.3 — --rollback flag)
 *
 * Migration events flow through the publisher-lite (per pattern §5):
 *   - migration.started
 *   - migration.documentUpgraded (per upgraded document)
 *   - migration.completed
 *   - migration.failed (severity ERROR)
 *
 * Usage:
 *   # Dry run (no writes — recommended first):
 *   npx tsx scripts/migrate-wishlists-r2.ts --tenant=angsana --client=cegid-spain
 *
 *   # Execute forward migration:
 *   npx tsx scripts/migrate-wishlists-r2.ts --tenant=angsana --client=cegid-spain --execute
 *
 *   # Rollback (reads the named log + snapshot, restores documents,
 *   # deletes side-effect entities):
 *   npx tsx scripts/migrate-wishlists-r2.ts --tenant=angsana --client=cegid-spain \
 *       --rollback --log=migrations/r2-pvs-wishlist-2026-04-30T10-30-00-angsana.json
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - Target project: angsana-exchange
 *   - Operator should be the only person running migrations (per pattern §6)
 *
 * Pattern citations:
 *   §2   Six-part script structure
 *   §3.1 Pre-snapshot (hard precondition)
 *   §3.2 Idempotency marker (schemaVersion)
 *   §3.3 Rollback procedure
 *   §3.4 Per-document error handling (log and continue)
 *   §4.1 Migration log content (incl. side-effect manifest)
 *   §5   Migration events
 *   §6   Audit-collection trigger (none active for this slice)
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishEvent } from '../src/lib/events/publish';
import { classifyNotes } from '../src/lib/wishlists/notesClassifier';

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ID = 'angsana-exchange';
const PATTERN_ID = 'r2-pvs-wishlist';
const SCHEMA_VERSION_TARGET = 'r2-pvs-wishlist-v1';

const REPO_ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'migrations');
const SNAPSHOTS_DIR = resolve(MIGRATIONS_DIR, 'snapshots');

// ─── Argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}
function value(name: string): string | null {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}

const tenantId = value('tenant');
const clientId = value('client');
const isExecute = flag('execute');
const isRollback = flag('rollback');
const explicitLogPath = value('log');

if (!tenantId) {
  console.error('Must pass --tenant=<tenantId>. Example: --tenant=angsana');
  process.exit(1);
}
if (!clientId) {
  console.error('Must pass --client=<clientId>. Example: --client=cegid-spain');
  process.exit(1);
}
if (isRollback && !explicitLogPath) {
  console.error(
    'Rollback requires --log=<path-to-migration-log.json>. The log is the rollback substrate (pattern §3.3).'
  );
  process.exit(1);
}

// ─── Firebase setup ─────────────────────────────────────────────────────────

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore();

// ─── Operator identity ──────────────────────────────────────────────────────

interface Operator {
  uid: string;
  email: string;
}

function resolveOperator(): Operator {
  // Dev-machine mode: operator's identity comes from env. Documented in the
  // operational runbook. In deployed mode, this would come from the SA.
  return {
    uid: process.env.MIGRATION_OPERATOR_UID || 'local-operator',
    email: process.env.MIGRATION_OPERATOR_EMAIL || 'unknown@angsana.com',
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function timestampSlug(): string {
  // 2026-04-30T10-30-00-000Z (filesystem-safe).
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

// ─── Migration log shapes (per pattern §4.1) ────────────────────────────────

type DocOutcome =
  | { docId: string; outcome: 'upgraded'; fromSchema: string | null }
  | { docId: string; outcome: 'skipped-already-versioned' }
  | { docId: string; outcome: 'errored'; errorMessage: string };

interface SideEffectEntry {
  /** Logical kind of side effect — informs rollback (e.g. delete by id). */
  kind: 'workItem' | 'soWhat';
  collectionPath: string;
  documentId: string;
  /** The wishlist this side-effect was raised against, for traceability. */
  forWishlistId: string;
}

interface MigrationLog {
  patternId: string;
  schemaVersionTarget: string;
  tenantId: string;
  clientId: string;
  operator: Operator;
  startedAt: string;
  endedAt: string | null;
  mode: 'forward' | 'rollback';
  dryRun: boolean;
  summary: {
    upgraded: number;
    skipped: number;
    errored: number;
  };
  documents: DocOutcome[];
  sideEffects: SideEffectEntry[];
  /** Snapshot the forward run wrote, so rollback can find it. */
  snapshotPath: string | null;
}

// ─── Wishlist shape (legacy + target) ───────────────────────────────────────
// Legacy R1 fields are loose; target shape per slice spec §3.2.

interface LegacyWishlistDoc {
  companyName?: string;
  sector?: string;
  geography?: string;
  priority?: 'high' | 'medium' | 'low';
  notes?: string;
  status?: string;
  campaignRef?: string;
  addedBy?: string | { uid: string; name: string };
  addedDate?: Timestamp;
  updatedAt?: Timestamp;
  schemaVersion?: string;
  // Allow additional unknown fields (defensive).
  [key: string]: unknown;
}

// Notes classifier is now in src/lib/wishlists/notesClassifier.ts so it is
// shareable between this script and the unit-test suite (slice spec §10 +
// step 12 of the §12 checklist). Imported above. The behaviour is unchanged
// — see the module header for the four-route definition.

// ─── Pre-snapshot (pattern §3.1) ────────────────────────────────────────────

async function takeSnapshot(): Promise<{ path: string; entries: Array<{ id: string; data: LegacyWishlistDoc }> }> {
  ensureDir(SNAPSHOTS_DIR);
  const path = resolve(
    SNAPSHOTS_DIR,
    `${PATTERN_ID}-${timestampSlug()}-${tenantId}-pre.json`
  );

  const wishlistsRef = db
    .collection('tenants')
    .doc(tenantId!)
    .collection('clients')
    .doc(clientId!)
    .collection('wishlists');

  const snap = await wishlistsRef.get();
  const entries = snap.docs.map((d) => ({ id: d.id, data: d.data() as LegacyWishlistDoc }));

  // Hard precondition: if we cannot write the snapshot, refuse to proceed.
  // No override (pattern §3.1).
  try {
    writeFileSync(path, JSON.stringify({ tenantId, clientId, takenAt: nowIso(), entries }, null, 2));
  } catch (err) {
    throw new Error(
      `Pre-snapshot write failed at ${path}. Migration aborts (pattern §3.1 hard precondition). Cause: ${(err as Error).message}`
    );
  }

  return { path, entries };
}

// ─── Transformation per document ────────────────────────────────────────────

interface TransformResult {
  newDoc: Record<string, unknown>;
  sideEffects: Array<Omit<SideEffectEntry, 'collectionPath' | 'documentId' | 'forWishlistId'> & { writeFn: () => Promise<{ collectionPath: string; documentId: string }> }>;
}

async function transformWishlist(
  docId: string,
  legacy: LegacyWishlistDoc,
  migrationRunId: string
): Promise<TransformResult> {
  // Resolve addedBy: R1 stored an email string; R2 needs { uid, name }.
  // Without an auth lookup at migration time we record the email under name
  // and leave uid as 'migration:<email>'. The post-run cleanup fills in real
  // UIDs (operational runbook step 5).
  const legacyAddedBy = legacy.addedBy;
  const addedBy =
    typeof legacyAddedBy === 'string'
      ? { uid: `migration:${legacyAddedBy}`, name: legacyAddedBy }
      : legacyAddedBy ?? { uid: 'migration:unknown', name: 'unknown' };

  const updatedBy = addedBy;

  // Notes routing (slice spec §6.3).
  const route = classifyNotes(legacy.notes);
  const targetingHintsRaw = route.route === 'targeting-raw' ? route.raw : null;

  // Side-effect entities are created by Firestore writes; we capture the
  // creation operation here as a closure so the executor can call it (or
  // not, in dry-run mode).
  const sideEffects: TransformResult['sideEffects'] = [];

  if (route.route === 'work-item') {
    sideEffects.push({
      kind: 'workItem',
      writeFn: async () => {
        const ref = db
          .collection('tenants')
          .doc(tenantId!)
          .collection('clients')
          .doc(clientId!)
          .collection('workItems')
          .doc();

        await ref.set({
          workItemId: ref.id,
          workItemType: 'wishlist-clarification',
          subject: {
            scope: 'tenant',
            scopeRef: tenantId,
            entityType: 'wishlist',
            entityId: docId,
          },
          state: 'closed',
          audience: 'internal',
          visibility: 'normal',
          archived: false,
          owner: null,
          priority: 'low',
          deadline: null,
          title: `Migrated note for ${legacy.companyName ?? docId}`,
          body: route.body.slice(0, 2000),
          source: { type: 'migration', ref: migrationRunId },
          relations: [],
          activityLog: [
            {
              type: 'state-changed',
              from: 'raised',
              to: 'closed',
              by: { uid: 'migration', name: 'R2 migration' },
              at: Timestamp.now(),
              comment: 'Imported from R1 free-text notes; pre-closed.',
            },
          ],
          createdAt: Timestamp.now(),
          createdBy: { uid: 'migration', tenantId },
          updatedAt: Timestamp.now(),
          tenantId,
          scope: 'tenant',
          // Side-effect idempotency marker (pattern §2 row 4):
          sourceMigrationRun: migrationRunId,
        });

        return { collectionPath: ref.parent.path, documentId: ref.id };
      },
    });
  } else if (route.route === 'so-what-draft') {
    sideEffects.push({
      kind: 'soWhat',
      writeFn: async () => {
        // The So Whats module owns its schema; we write a minimal draft
        // record here that the existing module will accept. The slice spec
        // §6.3 does not require a particular shape — only "draft via the
        // existing So What module's API." Since this is a script-level
        // migration we write directly, with a clear `status: 'draft'` and
        // the migration provenance.
        const ref = db
          .collection('tenants')
          .doc(tenantId!)
          .collection('clients')
          .doc(clientId!)
          .collection('soWhats')
          .doc();

        await ref.set({
          soWhatId: ref.id,
          status: 'draft',
          title: `Draft from migrated wishlist note: ${legacy.companyName ?? docId}`,
          body: route.body,
          createdAt: Timestamp.now(),
          createdBy: { uid: 'migration', tenantId },
          source: { type: 'migration', ref: migrationRunId, fromWishlistId: docId },
          sourceMigrationRun: migrationRunId,
        });

        return { collectionPath: ref.parent.path, documentId: ref.id };
      },
    });
  }

  // Resolve campaignRefs (slice spec §6.2).
  const campaignRefs = legacy.campaignRef ? [legacy.campaignRef].filter(Boolean) : [];

  const newDoc: Record<string, unknown> = {
    wishlistId: docId,
    companyRef: legacy.companyName
      ? { type: 'candidate', candidateId: randomUUID() }
      : null,
    companyName: legacy.companyName ?? null,
    priority: legacy.priority ?? 'medium',
    status: legacy.status ?? 'new',
    campaignRefs,
    targetingHints: [],
    targetingHintsRaw,
    source: 'migration',
    sourceDetail: null,
    addedBy,
    addedAt: legacy.addedDate ?? Timestamp.now(),
    updatedBy,
    updatedAt: Timestamp.now(),
    archived: false,
    schemaVersion: SCHEMA_VERSION_TARGET,
  };

  return { newDoc, sideEffects };
}

// ─── Forward migration ──────────────────────────────────────────────────────

async function runForward(): Promise<void> {
  const operator = resolveOperator();
  const startedAt = nowIso();
  const migrationRunId = `${PATTERN_ID}-${timestampSlug()}-${tenantId}`;

  // Per pattern §5: emit migration.started.
  await publishEvent({
    eventType: 'migration.started',
    payload: {
      patternId: PATTERN_ID,
      schemaVersionTarget: SCHEMA_VERSION_TARGET,
      tenantId,
      clientId,
      operator,
      dryRun: !isExecute,
    },
    tenantId: tenantId!,
    clientId,
    actorUid: operator.uid,
    occurredAt: startedAt,
  });

  console.log(
    `\n[migration] forward pass — pattern=${PATTERN_ID} tenant=${tenantId} client=${clientId} mode=${isExecute ? 'EXECUTE' : 'DRY-RUN'}`
  );

  // ── Part 1: Pre-snapshot (pattern §3.1) ─────────────────────────────────
  // Hard precondition. Done in both dry-run and execute modes (in dry-run
  // it shows the operator the snapshot is writeable, which is the same
  // signal as the production run's first step).
  const { path: snapshotPath, entries } = await takeSnapshot();
  console.log(`[migration] snapshot written: ${snapshotPath} (${entries.length} entries)`);

  const log: MigrationLog = {
    patternId: PATTERN_ID,
    schemaVersionTarget: SCHEMA_VERSION_TARGET,
    tenantId: tenantId!,
    clientId: clientId!,
    operator,
    startedAt,
    endedAt: null,
    mode: 'forward',
    dryRun: !isExecute,
    summary: { upgraded: 0, skipped: 0, errored: 0 },
    documents: [],
    sideEffects: [],
    snapshotPath,
  };

  // ── Parts 2–4: Idempotency check + Transformation + Side-effects ────────
  for (const entry of entries) {
    const { id, data } = entry;
    try {
      // Idempotency check (pattern §3.2).
      if (data.schemaVersion === SCHEMA_VERSION_TARGET) {
        log.summary.skipped += 1;
        log.documents.push({ docId: id, outcome: 'skipped-already-versioned' });
        console.log(`  [skip] ${id} — already at ${SCHEMA_VERSION_TARGET}`);
        continue;
      }

      const { newDoc, sideEffects } = await transformWishlist(id, data, migrationRunId);

      if (isExecute) {
        // Side-effects first so the manifest is exhaustive even if the
        // wishlist write fails (the manifest is the rollback input).
        for (const se of sideEffects) {
          const created = await se.writeFn();
          log.sideEffects.push({
            kind: se.kind,
            collectionPath: created.collectionPath,
            documentId: created.documentId,
            forWishlistId: id,
          });
        }

        // Document upgrade.
        await db
          .collection('tenants')
          .doc(tenantId!)
          .collection('clients')
          .doc(clientId!)
          .collection('wishlists')
          .doc(id)
          .set(newDoc, { merge: false });
      } else {
        // Dry-run: capture intended side-effects without writing them, so
        // the operator can review them in the log.
        for (const se of sideEffects) {
          log.sideEffects.push({
            kind: se.kind,
            collectionPath: '(dry-run, not written)',
            documentId: '(dry-run, not written)',
            forWishlistId: id,
          });
        }
      }

      log.summary.upgraded += 1;
      log.documents.push({
        docId: id,
        outcome: 'upgraded',
        fromSchema: (data.schemaVersion as string) ?? null,
      });
      console.log(`  [upgrade] ${id}`);

      // Per pattern §5: emit migration.documentUpgraded per upgraded doc.
      await publishEvent({
        eventType: 'migration.documentUpgraded',
        payload: {
          patternId: PATTERN_ID,
          documentId: id,
          fromSchema: (data.schemaVersion as string) ?? null,
          toSchema: SCHEMA_VERSION_TARGET,
          dryRun: !isExecute,
        },
        tenantId: tenantId!,
        clientId,
        actorUid: operator.uid,
        occurredAt: nowIso(),
      });
    } catch (err) {
      // Per pattern §3.4: log and continue.
      const msg = (err as Error).message;
      log.summary.errored += 1;
      log.documents.push({ docId: id, outcome: 'errored', errorMessage: msg });
      console.error(`  [error] ${id} — ${msg}`);
    }
  }

  log.endedAt = nowIso();

  // ── Part 5: Migration log ──────────────────────────────────────────────
  ensureDir(MIGRATIONS_DIR);
  const logPath = resolve(MIGRATIONS_DIR, `${migrationRunId}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log('\n[migration] summary');
  console.log(`  upgraded:  ${log.summary.upgraded}`);
  console.log(`  skipped:   ${log.summary.skipped}`);
  console.log(`  errored:   ${log.summary.errored}`);
  console.log(`  log:       ${logPath}`);
  console.log(`  snapshot:  ${snapshotPath}`);

  // Per pattern §5: emit migration.completed.
  await publishEvent({
    eventType: 'migration.completed',
    payload: {
      patternId: PATTERN_ID,
      summary: log.summary,
      logPath,
      snapshotPath,
      dryRun: !isExecute,
    },
    tenantId: tenantId!,
    clientId,
    actorUid: operator.uid,
    occurredAt: log.endedAt,
  });

  if (!isExecute) {
    console.log('\n[migration] DRY-RUN complete. No documents were written. Re-run with --execute to apply.');
  } else {
    console.log('\n[migration] forward pass complete.');
  }
}

// ─── Rollback (pattern §3.3) ────────────────────────────────────────────────

async function runRollback(): Promise<void> {
  const operator = resolveOperator();
  const logPath = resolve(REPO_ROOT, explicitLogPath!);
  if (!existsSync(logPath)) {
    throw new Error(`Migration log not found at ${logPath}. Cannot roll back without it.`);
  }
  const log: MigrationLog = JSON.parse(readFileSync(logPath, 'utf-8'));

  if (!log.snapshotPath || !existsSync(log.snapshotPath)) {
    throw new Error(
      `Snapshot referenced by log (${log.snapshotPath}) is missing. Rollback substrate gone — cannot proceed safely (pattern §3.1).`
    );
  }
  const snapshot = JSON.parse(readFileSync(log.snapshotPath, 'utf-8')) as {
    entries: Array<{ id: string; data: LegacyWishlistDoc }>;
  };

  console.log(`\n[migration] rollback pass — log=${logPath}`);
  console.log(`  snapshot:  ${log.snapshotPath}`);
  console.log(`  side-effects to delete: ${log.sideEffects.length}`);

  // Per pattern §5: emit migration.started for the rollback run.
  await publishEvent({
    eventType: 'migration.started',
    payload: {
      patternId: PATTERN_ID,
      mode: 'rollback',
      sourceLogPath: logPath,
      operator,
      dryRun: !isExecute,
    },
    tenantId: tenantId!,
    clientId,
    actorUid: operator.uid,
    occurredAt: nowIso(),
  });

  // Step 1: delete side-effect entities from the manifest.
  for (const se of log.sideEffects) {
    if (se.documentId === '(dry-run, not written)') continue;
    try {
      if (isExecute) {
        await db.collection(se.collectionPath).doc(se.documentId).delete();
      }
      console.log(`  [delete-side-effect] ${se.collectionPath}/${se.documentId} (${se.kind})`);
    } catch (err) {
      console.error(`  [error] failed to delete ${se.collectionPath}/${se.documentId}: ${(err as Error).message}`);
    }
  }

  // Step 2: restore documents from the snapshot.
  for (const entry of snapshot.entries) {
    try {
      if (isExecute) {
        await db
          .collection('tenants')
          .doc(tenantId!)
          .collection('clients')
          .doc(clientId!)
          .collection('wishlists')
          .doc(entry.id)
          .set(entry.data, { merge: false });
      }
      console.log(`  [restore] wishlist/${entry.id}`);
    } catch (err) {
      console.error(`  [error] failed to restore ${entry.id}: ${(err as Error).message}`);
    }
  }

  // Per pattern §5: emit migration.completed for the rollback run.
  await publishEvent({
    eventType: 'migration.completed',
    payload: {
      patternId: PATTERN_ID,
      mode: 'rollback',
      restored: snapshot.entries.length,
      sideEffectsDeleted: log.sideEffects.length,
      dryRun: !isExecute,
    },
    tenantId: tenantId!,
    clientId,
    actorUid: operator.uid,
    occurredAt: nowIso(),
  });

  if (!isExecute) {
    console.log('\n[migration] ROLLBACK DRY-RUN complete. No writes performed. Re-run with --execute to apply.');
  } else {
    console.log('\n[migration] rollback complete.');
  }
}

// ─── Entrypoint ─────────────────────────────────────────────────────────────

(async () => {
  try {
    if (isRollback) {
      await runRollback();
    } else {
      await runForward();
    }
    process.exit(0);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`\n[migration] FAILED: ${msg}`);
    // Per pattern §5: emit migration.failed (severity ERROR).
    try {
      await publishEvent({
        eventType: 'migration.failed',
        payload: {
          patternId: PATTERN_ID,
          mode: isRollback ? 'rollback' : 'forward',
          error: msg,
          tenantId,
          clientId,
        },
        tenantId: tenantId!,
        clientId,
        actorUid: resolveOperator().uid,
        occurredAt: nowIso(),
      });
    } catch {
      // Best-effort emit; don't double-fail.
    }
    process.exit(1);
  }
})();
