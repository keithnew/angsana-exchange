#!/usr/bin/env npx tsx
/**
 * R2 PVS Slice 1 — Wishlists v0.2 reseed
 * ======================================
 *
 * Implements the Angsana Reseed Pattern v0.1 (in-tree mirror at
 * docs/architecture/Angsana_Reseed_Pattern_v0_1.md). Forward-only,
 * three-part script per pattern §2:
 *
 *   1. Read   — load all wishlist entries for the named client tenant.
 *   2. Reseed — write new-shape documents in-place (same Firestore
 *               doc IDs); bump schemaVersion to r2-pvs-wishlist-v2;
 *               add empty `website` and `researchAssistantContext`;
 *               preserve existing `source` and `sourceDetail` verbatim.
 *   3. Delete — verification-only sweep. Because this is an ID-stable
 *               reseed (per pattern §2.1 "ID-stable reseeds"), there
 *               are no separate old-shape documents to delete; the
 *               delete step exists for ceremony and to surface
 *               stragglers (docs the reseed missed). Logged so the
 *               operator is not left wondering why count == 0.
 *
 * What this script does NOT do (deliberately):
 *   • No pre-snapshot (Reseed Pattern §5). The old-shape documents are
 *     themselves the verification baseline until the delete step runs.
 *   • No rollback flag (Reseed Pattern §5). If the new shape is wrong,
 *     the corrective action is another reseed.
 *   • No per-document event. Per Reseed Pattern §3.1 the script emits
 *     exactly one `reseed.completed` event on completion of the reseed
 *     step.
 *   • No side-effect entities. The only mutation is in-place document
 *     reshape. (Side-effect creation would push this over the threshold
 *     into the full Migration Pattern.)
 *
 * Spec citations:
 *   v0.2 spec §3   Schema deltas (website, researchAssistantContext,
 *                  source/sourceDetail retained verbatim, schemaVersion
 *                  bumped to r2-pvs-wishlist-v2).
 *   v0.2 spec §4   Migration approach (this script is the named
 *                  three-part reseed).
 *   v0.2 spec §7   Acceptance #5 (single reseed.completed event;
 *                  preserve source/sourceDetail; website + RAC empty;
 *                  two-step execution model honoured).
 *
 * Pattern citations:
 *   §2     Three-part script structure
 *   §2.1   Two-step execution model (--delete-old separate command)
 *   §3.1   Single reseed.completed event
 *   §3.2   Local log file at reseeds/{pattern}-{timestamp}.json
 *   §3.3   schemaVersion bump (r2-pvs-wishlist-v2)
 *
 * Usage:
 *   # Dry run (no writes; recommended first):
 *   npx tsx scripts/reseed-wishlists-v0_2.ts \
 *       --tenant=angsana --client=cegid-spain
 *
 *   # Execute reseed step (writes new-shape docs in place):
 *   npx tsx scripts/reseed-wishlists-v0_2.ts \
 *       --tenant=angsana --client=cegid-spain --execute
 *
 *   # Verification sweep (after operator has confirmed reseed):
 *   npx tsx scripts/reseed-wishlists-v0_2.ts \
 *       --tenant=angsana --client=cegid-spain --delete-old
 *
 * Prerequisites:
 *   - gcloud auth application-default login
 *   - Target project: angsana-exchange
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishEvent } from '../src/lib/events/publish';

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ID = 'angsana-exchange';
const PATTERN_ID = 'r2-pvs-wishlist-v0_2';
const SCHEMA_VERSION_SOURCE = 'r2-pvs-wishlist-v1'; // v0.1 slice marker
const SCHEMA_VERSION_TARGET = 'r2-pvs-wishlist-v2'; // v0.2 slice marker

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

const operatorId = process.env.USER || process.env.USERNAME || 'unknown-operator';
const mode: 'dry-run' | 'execute' | 'delete-old' = isDeleteOld
  ? 'delete-old'
  : isExecute
    ? 'execute'
    : 'dry-run';

console.log('━'.repeat(70));
console.log(`  Reseed: ${PATTERN_ID}`);
console.log(`  Mode:   ${mode.toUpperCase()}`);
console.log(`  Tenant: ${tenantId}    Client: ${clientId}`);
console.log(`  schemaVersion: ${SCHEMA_VERSION_SOURCE} → ${SCHEMA_VERSION_TARGET}`);
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
  clientId: string;
  schemaVersionSource: string;
  schemaVersionTarget: string;
  operatorId: string;
  // Reseed-step stats
  read: number;
  alreadyAtTarget: number;
  reseeded: number;
  errored: number;
  // Delete-step stats (zero outside delete-old mode)
  deletedOld: number;
  stragglersFound: number;
  errors: Array<{ docId: string; error: string }>;
}

const log: ReseedLog = {
  pattern: PATTERN_ID,
  timestamp: new Date().toISOString(),
  mode,
  tenantId,
  clientId,
  schemaVersionSource: SCHEMA_VERSION_SOURCE,
  schemaVersionTarget: SCHEMA_VERSION_TARGET,
  operatorId,
  read: 0,
  alreadyAtTarget: 0,
  reseeded: 0,
  errored: 0,
  deletedOld: 0,
  stragglersFound: 0,
  errors: [],
};

async function main() {
  const wishlistsRef = db
    .collection('tenants')
    .doc(tenantId!)
    .collection('clients')
    .doc(clientId!)
    .collection('wishlists');

  const snap = await wishlistsRef.get();
  log.read = snap.size;
  console.log(`Read ${log.read} wishlist documents.`);

  if (mode === 'delete-old') {
    await runDeleteOldStep(snap);
  } else {
    await runReseedStep(snap, wishlistsRef);
  }

  // Write the local log per Reseed Pattern §3.2.
  mkdirSync(RESEEDS_DIR, { recursive: true });
  const logPath = resolve(
    RESEEDS_DIR,
    `${PATTERN_ID}-${log.timestamp.replace(/[:.]/g, '-')}.json`
  );
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  console.log(`\nLog written to: ${logPath}`);

  // Emit the single reseed.completed event per Reseed Pattern §3.1 — but
  // ONLY for the reseed step. The delete-old step is a verification
  // sweep with no writes in the ID-stable case, so a second event would
  // be noise; the local log is sufficient.
  if (mode === 'execute') {
    await publishEvent({
      eventType: 'reseed.completed',
      payload: {
        pattern: PATTERN_ID,
        collection: `tenants/${tenantId}/clients/${clientId}/wishlists`,
        countReseeded: log.reseeded,
        countAlreadyAtTarget: log.alreadyAtTarget,
        countErrored: log.errored,
        schemaVersionSource: SCHEMA_VERSION_SOURCE,
        schemaVersionTarget: SCHEMA_VERSION_TARGET,
        operatorId,
      },
      tenantId: tenantId!,
      clientId: clientId!,
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
    console.log(`  Reseeded          : ${log.reseeded}${mode === 'dry-run' ? ' (dry-run; no writes)' : ''}`);
    console.log(`  Errored           : ${log.errored}`);
  } else {
    console.log(`  Deleted old       : ${log.deletedOld}`);
    console.log(`  Stragglers found  : ${log.stragglersFound}`);
  }
  console.log('━'.repeat(70));
}

/**
 * Reseed step. ID-stable: each existing document is overwritten in place
 * with the v0.2 shape. Existing values for `source`, `sourceDetail` and
 * every other field are preserved verbatim; the only changes are:
 *   • schemaVersion             → SCHEMA_VERSION_TARGET
 *   • website                   → '' (when missing)
 *   • researchAssistantContext  → '' (when missing)
 *
 * Re-runs are no-ops because the schemaVersion check skips already-bumped
 * documents.
 */
async function runReseedStep(
  snap: FirebaseFirestore.QuerySnapshot,
  wishlistsRef: FirebaseFirestore.CollectionReference
) {
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const existingVersion = data.schemaVersion as string | undefined;

    // Idempotency: already-reseeded documents are skipped.
    if (existingVersion === SCHEMA_VERSION_TARGET) {
      log.alreadyAtTarget += 1;
      continue;
    }

    // Build the in-place update. We use `update()` rather than `set()` to
    // make it impossible to accidentally drop a field by writing a
    // narrower document — the existing data stays intact and we only
    // touch the three fields that change.
    const update: Record<string, unknown> = {
      schemaVersion: SCHEMA_VERSION_TARGET,
    };
    if (typeof data.website === 'undefined') update.website = '';
    if (typeof data.researchAssistantContext === 'undefined') {
      update.researchAssistantContext = '';
    }

    // The reseed itself doesn't bump updatedAt — that's a user-driven
    // signal and a script-level reshape isn't a meaningful "edit". We
    // do, however, stamp `reseededAt` so an operator can spot which
    // documents touched this run if they need to (the local log is the
    // primary surface, but the field provides Firestore-side legibility).
    update.reseededAt = FieldValue.serverTimestamp();
    update.reseededBy = `script:${PATTERN_ID}:${operatorId}`;

    if (mode === 'dry-run') {
      log.reseeded += 1; // would-have-been
      continue;
    }

    try {
      await wishlistsRef.doc(doc.id).update(update);
      log.reseeded += 1;
    } catch (err) {
      log.errored += 1;
      log.errors.push({
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`  ERROR reseeding ${doc.id}: ${log.errors.at(-1)?.error}`);
    }
  }
}

/**
 * Delete-old step. For ID-stable reseeds (per Reseed Pattern §2.1), this
 * degrades to a verification sweep: there are no separate old-shape
 * documents to delete. We surface any "stragglers" — documents still on
 * the source schemaVersion or missing the marker entirely — so the
 * operator can decide whether to re-run the reseed step.
 */
async function runDeleteOldStep(snap: FirebaseFirestore.QuerySnapshot) {
  console.log(
    '\nThis is an ID-stable reseed; the delete step is a verification sweep.\n'
  );
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const existingVersion = data.schemaVersion as string | undefined;

    if (existingVersion === SCHEMA_VERSION_TARGET) continue;

    // Anything not yet at the target is a straggler.
    log.stragglersFound += 1;
    console.warn(
      `  STRAGGLER: ${doc.id} — schemaVersion=${existingVersion ?? '(missing)'}`
    );
  }

  if (log.stragglersFound === 0) {
    console.log(
      '✓ No stragglers. All documents are at the target schemaVersion.'
    );
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
