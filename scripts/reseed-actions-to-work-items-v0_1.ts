#!/usr/bin/env npx tsx
/**
 * S3-P2 — Cegid Spain Action → action-lite Work Item reseed.
 * ===========================================================
 *
 * Implements the Angsana Reseed Pattern v0.1 (in-tree mirror at
 * angsana-exchange/docs/architecture/Angsana_Reseed_Pattern_v0_1.md)
 * for the cross-collection migration of Cegid Spain's thirteen Action
 * documents onto the `action-lite` Work Item type.
 *
 * Three-part forward-only structure (Pattern §2):
 *
 *   1. Read   — load Action documents from
 *               tenants/{tenant}/clients/{client}/actions on the source
 *               project (angsana-exchange).
 *   2. Reseed — for each Action, build the action-lite Work Item via the
 *               pure mapper at src/lib/migrations/actionToWorkItem.ts,
 *               auto-mint a workItemId, write to
 *               tenants/{tenant}/workItems/{workItemId} on the target
 *               project (angsana-core-prod). Idempotent: a pre-write
 *               query on `migrationSource.sourceId` skips already-reseeded
 *               Actions.
 *   3. Delete — verification-only sweep gated by --delete-old. Deletes
 *               the original Action documents on the source project AFTER
 *               the operator has confirmed the reseed shape against the
 *               spotcheck script. Cross-collection so this is a real
 *               delete, not the ID-stable degradation case from Pattern
 *               §2.1.
 *
 * Cross-project, cross-collection notes:
 *   - Read source project:  angsana-exchange  (Action docs live there)
 *   - Write target project: angsana-core-prod (Work Items live there)
 *   - Two firebase-admin app instances, one per project.
 *   - --delete-old runs against the source project (Exchange).
 *
 * Implementation note: writes go via the firebase-admin SDK directly
 * rather than via HTTP POST to the Core workItemsApi Cloud Function. The
 * pre-code §"P2" deliverable named the workItemsApi as the write target;
 * this script chose the admin-SDK path for parity with the existing
 * `migrate-wishlists-r2.ts` precedent and to avoid the operational
 * complexity of platform-router authentication from a workstation.
 * On-disk shape is identical (the workItemsApi createWorkItem handler is
 * a thin validator over the same Firestore write); the deviation is
 * documented in the P2 handover so a future re-runner knows.
 *
 * Decision #1 (auto-ID + provenance):
 *   Each reseeded doc carries
 *     migrationSource = {
 *       sourceCollection: 'actions',
 *       sourceClientId: 'cegid-spain',
 *       sourceId: <legacy Firestore docId>,
 *       reseedRun: '<pattern-id>-<timestamp>',
 *       notes: { sourceType, sourceRef }
 *     }
 *   spotcheck-action-lite.ts queries by `migrationSource.sourceId`.
 *
 * Decision #9 (raisedBy):
 *   Action.createdBy → raisedBy.userId; fallback 'system' when missing.
 *   raisedBy.role is always 'system' (the reseed itself is system-driven;
 *   see actionToWorkItem.ts header rationale).
 *
 * Reseed Pattern §3.1 — single `reseed.completed` event on completion.
 * Reseed Pattern §3.2 — local log at reseeds/action-lite-{ts}.json.
 * Reseed Pattern §3.3 — schemaVersion bump (r2-action-v1 → r3-action-lite-v1).
 *
 * Usage:
 *   # Dry run (no writes; recommended first):
 *   npx tsx scripts/reseed-actions-to-work-items-v0_1.ts \
 *       --tenant=angsana --client=cegid-spain
 *
 *   # Execute reseed step (writes Work Items):
 *   npx tsx scripts/reseed-actions-to-work-items-v0_1.ts \
 *       --tenant=angsana --client=cegid-spain --execute
 *
 *   # Verification-only delete sweep (after spotcheck confirms shape):
 *   npx tsx scripts/reseed-actions-to-work-items-v0_1.ts \
 *       --tenant=angsana --client=cegid-spain --delete-old
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - Operator workstation has both projects accessible.
 */

import {
  initializeApp,
  getApps,
  type App,
} from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type CollectionReference,
} from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { publishEvent } from '../src/lib/events/publish';
import {
  SCHEMA_VERSION_SOURCE,
  SCHEMA_VERSION_TARGET,
} from '../src/lib/migrations/actionToWorkItem';
import {
  runReseedLoop,
  runDeleteOldLoop,
  type FakeCollectionRef,
} from '../src/lib/migrations/reseedActionsLoop';

// ─── Constants ──────────────────────────────────────────────────────────────

const SOURCE_PROJECT_ID = 'angsana-exchange';
const TARGET_PROJECT_ID = 'angsana-core-prod';
const PATTERN_ID = 'action-lite';

const REPO_ROOT = resolve(__dirname, '..');
const RESEEDS_DIR = resolve(REPO_ROOT, 'reseeds');

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
const isDeleteOld = flag('delete-old');

if (!tenantId) {
  console.error('Must pass --tenant=<tenantId>. Example: --tenant=angsana');
  process.exit(1);
}
if (!clientId) {
  console.error('Must pass --client=<clientId>. Example: --client=cegid-spain');
  process.exit(1);
}
if (isExecute && isDeleteOld) {
  console.error(
    'Per Reseed Pattern §2.1 the reseed and the delete-old steps are run as separate operator invocations. Pick one of --execute or --delete-old, not both.'
  );
  process.exit(1);
}

const operatorId =
  process.env.USER || process.env.USERNAME || 'unknown-operator';
const mode: 'dry-run' | 'execute' | 'delete-old' = isDeleteOld
  ? 'delete-old'
  : isExecute
    ? 'execute'
    : 'dry-run';

// ─── Firestore bootstrap (two apps; cross-project) ──────────────────────────

function ensureApp(name: string, projectId: string): App {
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  return initializeApp({ projectId }, name);
}

const sourceApp = ensureApp('source', SOURCE_PROJECT_ID);
const targetApp = ensureApp('target', TARGET_PROJECT_ID);
const sourceDb: Firestore = getFirestore(sourceApp);
const targetDb: Firestore = getFirestore(targetApp);

// ─── Run-level identifiers ──────────────────────────────────────────────────

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const runTimestamp = new Date().toISOString();
const runSlug = timestampSlug();
const reseedRun = `${PATTERN_ID}-${runSlug}`;

// ─── Banner ─────────────────────────────────────────────────────────────────

console.log('━'.repeat(74));
console.log(`  Reseed:        ${PATTERN_ID}`);
console.log(`  Mode:          ${mode.toUpperCase()}`);
console.log(`  Tenant:        ${tenantId}    Client: ${clientId}`);
console.log(`  Source proj:   ${SOURCE_PROJECT_ID}`);
console.log(`  Target proj:   ${TARGET_PROJECT_ID}`);
console.log(`  schemaVersion: ${SCHEMA_VERSION_SOURCE} → ${SCHEMA_VERSION_TARGET}`);
console.log(`  Reseed run:    ${reseedRun}`);
console.log(`  Operator:      ${operatorId}`);
console.log('━'.repeat(74));

// ─── Path helpers ───────────────────────────────────────────────────────────

function sourceActionsRef(): CollectionReference {
  return sourceDb
    .collection('tenants')
    .doc(tenantId!)
    .collection('clients')
    .doc(clientId!)
    .collection('actions');
}

function targetWorkItemsRef(): CollectionReference {
  // action-lite is tenant-scoped (Spec §7.1); workItems land at
  // tenants/{tenantId}/workItems/{workItemId}.
  return targetDb.collection('tenants').doc(tenantId!).collection('workItems');
}

// ─── Log shape (Reseed Pattern §3.2) ────────────────────────────────────────

interface ReseedLog {
  pattern: string;
  reseedRun: string;
  startedAt: string;
  endedAt: string | null;
  mode: typeof mode;
  tenantId: string;
  clientId: string;
  sourceProject: string;
  targetProject: string;
  schemaVersionSource: string;
  schemaVersionTarget: string;
  operatorId: string;
  // Reseed-step counts
  read: number;
  reseeded: number;
  skippedAlreadyReseeded: number;
  errored: number;
  // Delete-step counts (zero outside delete-old mode)
  deleted: number;
  heldBack: number;
  deleteErrored: number;
  // Per-doc detail
  reseedOutcomes: unknown[];
  deleteOutcomes: unknown[];
}

const log: ReseedLog = {
  pattern: PATTERN_ID,
  reseedRun,
  startedAt: runTimestamp,
  endedAt: null,
  mode,
  tenantId: tenantId!,
  clientId: clientId!,
  sourceProject: SOURCE_PROJECT_ID,
  targetProject: TARGET_PROJECT_ID,
  schemaVersionSource: SCHEMA_VERSION_SOURCE,
  schemaVersionTarget: SCHEMA_VERSION_TARGET,
  operatorId,
  read: 0,
  reseeded: 0,
  skippedAlreadyReseeded: 0,
  errored: 0,
  deleted: 0,
  heldBack: 0,
  deleteErrored: 0,
  reseedOutcomes: [],
  deleteOutcomes: [],
};

// ─── Local log file (Pattern §3.2) ──────────────────────────────────────────

function writeLogFile(): string {
  mkdirSync(RESEEDS_DIR, { recursive: true });
  const logPath = resolve(RESEEDS_DIR, `${reseedRun}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  return logPath;
}

// ─── Reseed event (Pattern §3.1) ────────────────────────────────────────────

/**
 * Emit `reseed.completed` exactly once on the reseed step.
 *
 * Whitelist decision (S3-pre-code Decision #8 + S3-P1 banked refinement
 * #3): the publisher's FIRESTORE_MIRROR_WHITELIST is scoped to
 * substantive-edit verbs in P1. P2 leaves `reseed.completed` OFF the
 * whitelist (Cloud-Logging-only). Reasoning:
 *   • The reseed is a one-shot operator action; durable observability
 *     beyond Cloud Logging isn't load-bearing.
 *   • The local log file at reseeds/{reseedRun}.json is the operator's
 *     primary verification surface (Pattern §3.2).
 *   • Adding it to the whitelist would route the event through Core's
 *     processTenantEvent trigger, but no handler is registered for
 *     `reseed.completed` in eventRegistry.json — the doc would land in
 *     `pending` with no handler, which is louder than helpful.
 * If a future operator wants Firestore observability for a single run,
 * the publisher exposes the per-call `mirrorToFirestore: true` opt-in;
 * we don't pass it here.
 */
async function emitReseedCompleted(): Promise<void> {
  await publishEvent({
    eventType: 'reseed.completed',
    payload: {
      pattern: PATTERN_ID,
      reseedRun,
      sourceCollection: `tenants/${tenantId}/clients/${clientId}/actions`,
      targetCollection: `tenants/${tenantId}/workItems`,
      countRead: log.read,
      countReseeded: log.reseeded,
      countSkippedAlreadyReseeded: log.skippedAlreadyReseeded,
      countErrored: log.errored,
      schemaVersionSource: SCHEMA_VERSION_SOURCE,
      schemaVersionTarget: SCHEMA_VERSION_TARGET,
      operatorId,
      mode,
    },
    tenantId: tenantId!,
    clientId: clientId!,
    actorUid: `script:${operatorId}`,
    occurredAt: new Date().toISOString(),
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Cast the admin-SDK CollectionReference to our minimal FakeCollectionRef
  // surface. The shapes match by duck-typing (.where(), .limit(), .get(),
  // .doc(), .set(), .delete()); the cast is necessary because the admin
  // SDK's TS types are richer than the loop interface (the loop only
  // names what it uses).
  const srcRef = sourceActionsRef() as unknown as FakeCollectionRef;
  const tgtRef = targetWorkItemsRef() as unknown as FakeCollectionRef;

  if (mode === 'delete-old') {
    const result = await runDeleteOldLoop({
      sourceActions: srcRef,
      targetWorkItems: tgtRef,
    });
    log.read = result.read;
    log.deleted = result.deleted;
    log.heldBack = result.heldBack;
    log.deleteErrored = result.errored;
    log.deleteOutcomes = result.outcomes;
    for (const o of result.outcomes) {
      if (o.outcome === 'deleted') {
        console.log(`  [delete]    ${o.sourceId}`);
      } else if (o.outcome === 'verified-only') {
        console.warn(
          `  [hold]      ${o.sourceId} — no reseed found; not deleting`
        );
      } else {
        console.error(`  [error]     ${o.sourceId} — ${o.errorMessage}`);
      }
    }
  } else {
    const result = await runReseedLoop({
      sourceActions: srcRef,
      targetWorkItems: tgtRef,
      tenantId: tenantId!,
      clientId: clientId!,
      reseedRun,
      operatorId,
      mode,
      mintWorkItemId: () => randomUUID(),
      now: () => Timestamp.fromMillis(Date.now()),
    });
    log.read = result.read;
    log.reseeded = result.reseeded;
    log.skippedAlreadyReseeded = result.skippedAlreadyReseeded;
    log.errored = result.errored;
    log.reseedOutcomes = result.outcomes;
    for (const o of result.outcomes) {
      if (o.outcome === 'reseeded') {
        console.log(
          `  [reseed]    ${o.sourceId} → workItemId=${o.workItemId}`
        );
      } else if (o.outcome === 'skipped-already-reseeded') {
        console.log(
          `  [skip]      ${o.sourceId} — already reseeded as workItemId=${o.workItemId}`
        );
      } else if (o.outcome === 'would-reseed') {
        console.log(`  [would]     ${o.sourceId} (dry-run)`);
      } else {
        console.error(`  [error]     ${o.sourceId} — ${o.errorMessage}`);
      }
    }
  }

  log.endedAt = new Date().toISOString();
  const logPath = writeLogFile();

  // Pattern §3.1: single `reseed.completed` on the reseed step only.
  if (mode === 'execute') {
    try {
      await emitReseedCompleted();
      console.log('\nEmitted reseed.completed event (Cloud Logging).');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`\nreseed.completed emit failed (non-fatal): ${message}`);
    }
  }

  console.log(`\nLog written to: ${logPath}`);
  console.log('━'.repeat(74));
  console.log('Summary:');
  console.log(`  Read:                    ${log.read}`);
  if (mode !== 'delete-old') {
    console.log(
      `  Reseeded:                ${log.reseeded}${mode === 'dry-run' ? ' (dry-run; would-reseed)' : ''}`
    );
    console.log(`  Skipped (idempotency):   ${log.skippedAlreadyReseeded}`);
    console.log(`  Errored:                 ${log.errored}`);
  } else {
    console.log(`  Deleted:                 ${log.deleted}`);
    console.log(`  Held back (no reseed):   ${log.heldBack}`);
    console.log(`  Errored:                 ${log.deleteErrored}`);
  }
  console.log('━'.repeat(74));

  if (mode === 'dry-run') {
    console.log(
      'DRY-RUN complete. No documents were written. Re-run with --execute to apply.'
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
