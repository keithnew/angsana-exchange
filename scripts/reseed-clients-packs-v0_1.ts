#!/usr/bin/env npx tsx
/**
 * Dimension Packs v0.1 — Client `packs` field reseed
 * ===================================================
 *
 * Implements the Angsana Reseed Pattern v0.1 (in-tree mirror at
 * docs/architecture/Angsana_Reseed_Pattern_v0_1.md). Forward-only,
 * three-part script per pattern §2:
 *
 *   1. Read   — load all Client documents under the named tenant.
 *   2. Reseed — write the new shape in place: add the `packs` field
 *               populated by the §6.1 heuristic
 *               (src/lib/packs/heuristic.ts). Bump schemaVersion to
 *               'packs-v1'. Existing fields preserved verbatim.
 *   3. Delete — verification-only sweep. ID-stable reseed (per pattern
 *               §2.1) — there is no separate old-shape document to
 *               delete. The delete step surfaces stragglers: Clients
 *               whose schemaVersion ≠ 'packs-v1' or whose `packs` field
 *               is still missing.
 *
 * Spec citations:
 *   Packs §5.1   Client record gains required `packs: string[]` field.
 *   Packs §6.1   Heuristic-driven initial pack toggles (delegated to
 *                src/lib/packs/heuristic.ts so the rule is unit-tested
 *                and re-usable rather than buried in this script).
 *   Packs §6     "The migration runs under Reseed Pattern v0.1, since
 *                Exchange remains in the seed-data era per the Migration
 *                Pattern Amendment §0.5."
 *
 * Pattern citations:
 *   §2     Three-part script structure
 *   §2.1   Two-step execution model (--delete-old separate command)
 *   §3.1   Single reseed.completed event
 *   §3.2   Local log file at reseeds/{pattern}-{timestamp}.json
 *   §3.3   schemaVersion bump (packs-v1)
 *
 * Note: per Packs §6.1 "the migration is not a one-shot decision; it is
 * a starting point that operators correct." After this script runs, the
 * heuristic-applied toggles are spot-checked by an operator and edited
 * on individual Clients where the heuristic was wrong. Override is a
 * single edit on the Client record.
 *
 * Usage:
 *   # Dry run (no writes; recommended first):
 *   npx tsx scripts/reseed-clients-packs-v0_1.ts --tenant=angsana
 *
 *   # Execute reseed step (writes packs field in place):
 *   npx tsx scripts/reseed-clients-packs-v0_1.ts --tenant=angsana --execute
 *
 *   # Verification sweep (after operator has confirmed reseed):
 *   npx tsx scripts/reseed-clients-packs-v0_1.ts --tenant=angsana --delete-old
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - Target project: angsana-exchange
 *   - Pack catalogue must already be seeded in Core's reference store
 *     (functions/scripts/standup-pack-catalogue.ts in
 *     angsana-core-prod-project). The reseed itself does not depend on
 *     the catalogue at write time — it only writes pack ID strings —
 *     but consumers expect the catalogue to resolve them.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishEvent } from '../src/lib/events/publish';
import { applyMigrationHeuristic } from '../src/lib/packs/heuristic';

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ID = 'angsana-exchange';
const PATTERN_ID = 'packs-v0_1-clients';
const SCHEMA_VERSION_TARGET = 'packs-v1';

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
const isExecute = flag('execute');
const isDeleteOld = flag('delete-old');

if (!tenantId) {
  console.error('Must pass --tenant=<tenantId>. Example: --tenant=angsana');
  process.exit(1);
}
if (isExecute && isDeleteOld) {
  console.error(
    'Per Reseed Pattern §2.1 the reseed and the delete-old steps are run as separate operator invocations. Pick one of --execute or --delete-old, not both.'
  );
  process.exit(1);
}

const operatorId = process.env.USER || process.env.USERNAME || 'unknown-operator';
const mode: 'dry-run' | 'execute' | 'delete-old' = isDeleteOld
  ? 'delete-old'
  : isExecute
    ? 'execute'
    : 'dry-run';

console.log('━'.repeat(70));
console.log(`  Reseed: ${PATTERN_ID}`);
console.log(`  Mode:   ${mode.toUpperCase()}`);
console.log(`  Tenant: ${tenantId}`);
console.log(`  schemaVersion: → ${SCHEMA_VERSION_TARGET}`);
console.log(`  Operator: ${operatorId}`);
console.log('━'.repeat(70));

// ─── Firestore bootstrap ────────────────────────────────────────────────────

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore();

// ─── Run ────────────────────────────────────────────────────────────────────

interface ReseedLog {
  pattern: string;
  timestamp: string;
  mode: typeof mode;
  tenantId: string;
  schemaVersionTarget: string;
  operatorId: string;
  read: number;
  alreadyAtTarget: number;
  reseeded: number;
  errored: number;
  deletedOld: number;
  stragglersFound: number;
  /**
   * The heuristic's per-client output, recorded so an operator can
   * audit which Clients got which packs without re-querying. Only
   * populated for documents that the reseed actually touched.
   */
  heuristicResults: Array<{ clientId: string; packs: string[] }>;
  errors: Array<{ docId: string; error: string }>;
}

const log: ReseedLog = {
  pattern: PATTERN_ID,
  timestamp: new Date().toISOString(),
  mode,
  tenantId,
  schemaVersionTarget: SCHEMA_VERSION_TARGET,
  operatorId,
  read: 0,
  alreadyAtTarget: 0,
  reseeded: 0,
  errored: 0,
  deletedOld: 0,
  stragglersFound: 0,
  heuristicResults: [],
  errors: [],
};

async function main() {
  const clientsRef = db.collection('tenants').doc(tenantId!).collection('clients');

  const snap = await clientsRef.get();
  log.read = snap.size;
  console.log(`Read ${log.read} client documents.`);

  if (mode === 'delete-old') {
    await runDeleteOldStep(snap);
  } else {
    await runReseedStep(snap, clientsRef);
  }

  // Write the local log per Reseed Pattern §3.2.
  mkdirSync(RESEEDS_DIR, { recursive: true });
  const logPath = resolve(
    RESEEDS_DIR,
    `${PATTERN_ID}-${log.timestamp.replace(/[:.]/g, '-')}.json`
  );
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  console.log(`\nLog written to: ${logPath}`);

  // Single reseed.completed event per Reseed Pattern §3.1, only on the
  // reseed step (the delete step is verification-only for ID-stable
  // reseeds and emitting a second event would be noise).
  if (mode === 'execute') {
    await publishEvent({
      eventType: 'reseed.completed',
      payload: {
        pattern: PATTERN_ID,
        collection: `tenants/${tenantId}/clients`,
        countReseeded: log.reseeded,
        countAlreadyAtTarget: log.alreadyAtTarget,
        countErrored: log.errored,
        schemaVersionTarget: SCHEMA_VERSION_TARGET,
        operatorId,
      },
      tenantId: tenantId!,
      // Reseed is tenant-scoped (covers all Clients under the tenant) per
      // the event publisher's tenant-level convention. clientId is null.
      clientId: null,
      actorUid: `script:${operatorId}`,
      occurredAt: new Date().toISOString(),
    });
    console.log('Emitted reseed.completed event.');
  }

  console.log('━'.repeat(70));
  console.log('Summary:');
  console.log(`  Read              : ${log.read}`);
  if (mode !== 'delete-old') {
    console.log(`  Already at target : ${log.alreadyAtTarget}`);
    console.log(
      `  Reseeded          : ${log.reseeded}${mode === 'dry-run' ? ' (dry-run; no writes)' : ''}`
    );
    console.log(`  Errored           : ${log.errored}`);
    if (log.heuristicResults.length > 0) {
      console.log('');
      console.log('Heuristic per-client toggles:');
      for (const r of log.heuristicResults) {
        console.log(`  ${r.clientId.padEnd(30)} → [${r.packs.join(', ')}]`);
      }
      console.log('');
      console.log(
        '  (Per Packs §6.1 the heuristic is a starting point;'
      );
      console.log('  operators override individual Clients where wrong.)');
    }
  } else {
    console.log(`  Deleted old       : ${log.deletedOld}`);
    console.log(`  Stragglers found  : ${log.stragglersFound}`);
  }
  console.log('━'.repeat(70));
}

/**
 * Reseed step. ID-stable: each existing Client document is updated in
 * place with the v0.1 Packs shape:
 *
 *   • packs                     → applyMigrationHeuristic(client) (when missing
 *                                  or when forced by --re-apply)
 *   • schemaVersion             → SCHEMA_VERSION_TARGET
 *   • reseededAt / reseededBy   → audit stamps (Reseed Pattern §3.3)
 *
 * Re-runs are no-ops because the schemaVersion check skips already-bumped
 * documents — once an operator has overridden the heuristic-applied packs,
 * a re-run will not clobber their corrections.
 */
async function runReseedStep(
  snap: FirebaseFirestore.QuerySnapshot,
  clientsRef: FirebaseFirestore.CollectionReference
) {
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const existingVersion = data.schemaVersion as string | undefined;

    // Idempotency: already-reseeded documents are skipped. This is
    // important because operators correct the heuristic afterwards
    // (Packs §6.1) — re-running must not undo their work.
    if (existingVersion === SCHEMA_VERSION_TARGET) {
      log.alreadyAtTarget += 1;
      continue;
    }

    // Heuristic input: prefer Salesforce industry if the doc carries one;
    // fall back to the Exchange managedLists/sectors ids and, as a final
    // signal, the presence of therapyAreas.
    const heuristicInput = {
      sfIndustry: (data.salesforceIndustry as string | undefined) ?? null,
      sectors: (data.sectors as string[] | undefined) ?? null,
      therapyAreas: (data.therapyAreas as string[] | undefined) ?? null,
    };
    const packs = applyMigrationHeuristic(heuristicInput);

    log.heuristicResults.push({ clientId: doc.id, packs });

    // Build the in-place update. We use update() rather than set() so we
    // cannot accidentally drop a field; only `packs`, `schemaVersion`,
    // and the reseed audit stamps are touched.
    const update: Record<string, unknown> = {
      packs,
      schemaVersion: SCHEMA_VERSION_TARGET,
      reseededAt: FieldValue.serverTimestamp(),
      reseededBy: `script:${PATTERN_ID}:${operatorId}`,
    };

    if (mode === 'dry-run') {
      log.reseeded += 1; // would-have-been
      continue;
    }

    try {
      await clientsRef.doc(doc.id).update(update);
      log.reseeded += 1;
    } catch (err) {
      log.errored += 1;
      log.errors.push({
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(
        `  ERROR reseeding ${doc.id}: ${log.errors.at(-1)?.error}`
      );
    }
  }
}

/**
 * Delete-old step. ID-stable reseed → verification sweep. Surfaces
 * stragglers (Clients still missing the packs field or the target
 * schemaVersion) so the operator can decide whether to re-run.
 */
async function runDeleteOldStep(snap: FirebaseFirestore.QuerySnapshot) {
  console.log(
    '\nThis is an ID-stable reseed; the delete step is a verification sweep.\n'
  );
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const existingVersion = data.schemaVersion as string | undefined;
    const packsValue = data.packs as unknown;

    if (
      existingVersion === SCHEMA_VERSION_TARGET &&
      Array.isArray(packsValue)
    ) {
      continue;
    }

    log.stragglersFound += 1;
    console.warn(
      `  STRAGGLER: ${doc.id} — schemaVersion=${
        existingVersion ?? '(missing)'
      }, packs=${
        Array.isArray(packsValue) ? `[${(packsValue as string[]).join(', ')}]` : '(missing)'
      }`
    );
  }

  if (log.stragglersFound === 0) {
    console.log('✓ No stragglers. All Clients are at the target shape.');
  } else {
    console.warn(
      `\n⚠ ${log.stragglersFound} stragglers found. Re-run with --execute to bring them to the target shape.`
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
