#!/usr/bin/env npx tsx
/**
 * Spotcheck for action-lite reseed (S3-P2).
 * =========================================
 *
 * Mirrors the shape of `scripts/spotcheck-wishlist.ts`. Pivot is the
 * legacy actionId; the script queries `tenants/{tenant}/workItems` on
 * the target project (angsana-core-prod) where
 * `migrationSource.sourceId == <oldActionId>` and prints the resulting
 * Work Item alongside the original Action document for side-by-side
 * inspection.
 *
 * Usage:
 *   npx tsx scripts/spotcheck-action-lite.ts <oldActionId> [<oldActionId> ...]
 *
 * Defaults match P2's operational target (angsana / cegid-spain). Pass
 * --tenant / --client to override.
 */

import {
  initializeApp,
  getApps,
  type App,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const SOURCE_PROJECT_ID = 'angsana-exchange';
const TARGET_PROJECT_ID = 'angsana-core-prod';

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}
function value(name: string): string | null {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : null;
}

const tenantId = value('tenant') ?? 'angsana';
const clientId = value('client') ?? 'cegid-spain';
const ids = args.filter((a) => !a.startsWith('--'));

if (ids.length === 0) {
  console.error(
    'usage: npx tsx scripts/spotcheck-action-lite.ts <oldActionId> [<oldActionId> ...] [--tenant=<id>] [--client=<id>]'
  );
  process.exit(2);
}
void flag; // reserved for future flags; satisfies the lint sweeper

function ensureApp(name: string, projectId: string): App {
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  return initializeApp({ projectId }, name);
}

const sourceDb: Firestore = getFirestore(ensureApp('source', SOURCE_PROJECT_ID));
const targetDb: Firestore = getFirestore(ensureApp('target', TARGET_PROJECT_ID));

async function spotcheckOne(actionId: string): Promise<void> {
  console.log('━'.repeat(74));
  console.log(`actionId: ${actionId}`);
  console.log('━'.repeat(74));

  // Source — the legacy Action document (pre-delete).
  const sourcePath = `tenants/${tenantId}/clients/${clientId}/actions/${actionId}`;
  const sourceSnap = await sourceDb.doc(sourcePath).get();
  console.log(`\n--- SOURCE: ${sourcePath} ---`);
  if (!sourceSnap.exists) {
    console.log(
      '  <document does not exist on source — either never reseeded, or --delete-old already ran>'
    );
  } else {
    console.log(JSON.stringify(sourceSnap.data() ?? {}, null, 2));
  }

  // Target — the reseeded Work Item, found by migrationSource.sourceId.
  const targetSnap = await targetDb
    .collection('tenants')
    .doc(tenantId)
    .collection('workItems')
    .where('migrationSource.sourceId', '==', actionId)
    .limit(2)
    .get();

  console.log(
    `\n--- TARGET: tenants/${tenantId}/workItems where migrationSource.sourceId == ${actionId} ---`
  );
  if (targetSnap.empty) {
    console.log('  <no reseeded Work Item found for this actionId>');
  } else if (targetSnap.size > 1) {
    // Defence: a re-run shouldn't produce duplicates because of the
    // idempotency check, but if it ever does, surface it loudly here.
    console.warn(
      `  ⚠ ${targetSnap.size} Work Items match this sourceId — duplicates! Investigate.`
    );
    targetSnap.docs.forEach((d) =>
      console.log(`\n  workItemId=${d.id}\n${JSON.stringify(d.data(), null, 2)}`)
    );
  } else {
    const d = targetSnap.docs[0];
    console.log(`  workItemId=${d.id}`);
    console.log(JSON.stringify(d.data(), null, 2));
  }

  console.log();
}

async function main(): Promise<void> {
  for (const id of ids) {
    await spotcheckOne(id);
  }
}

main().catch((err) => {
  console.error('[spotcheck] failed:', err);
  process.exit(1);
});
