#!/usr/bin/env npx tsx
/**
 * One-off migration: convert slug-ID propositions to auto-ID propositions
 * and rewrite all references in campaigns and documents.
 *
 * Prerequisites:
 *   - gcloud auth application-default login   (matches scripts/seed.ts pattern)
 *   - Target project: angsana-exchange
 *
 * Usage:
 *   npx tsx scripts/migrate-propositions-to-auto-ids.ts --client=cegid-spain
 *   npx tsx scripts/migrate-propositions-to-auto-ids.ts --client=cegid-spain --execute
 *
 * Flow per client:
 *   1. Read all propositions
 *   2. Identify slug-ID ones (ID doesn't match Firestore auto-ID pattern)
 *   3. For each slug-ID proposition:
 *        a. Create a new auto-ID proposition with the same data
 *        b. Record the old→new ID mapping
 *   4. Sweep campaigns.propositionRefs[] — rewrite old IDs to new IDs
 *   5. Sweep documents.propositionRefs[] — rewrite old IDs to new IDs
 *   6. Delete the old slug-ID proposition documents
 *
 * Safety:
 *   - Dry-run by default. Must pass --execute to write.
 *   - Per-client scoping. Must pass --client=<clientId>.
 *   - Logs everything it would do / has done.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ─── Setup ──────────────────────────────────────────────────────────────

const PROJECT_ID = 'angsana-exchange';
const TENANT_ID = 'angsana';

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();

// ─── Arg parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');
const clientArg = args.find((a) => a.startsWith('--client='));
const clientId = clientArg ? clientArg.split('=')[1] : null;

if (!clientId) {
  console.error('Must pass --client=<clientId>. Example: --client=cegid-spain');
  process.exit(1);
}

// ─── Slug detection ─────────────────────────────────────────────────────

/**
 * Firestore auto-IDs are 20 characters, alphanumeric (no hyphens/underscores).
 * Slug IDs are lowercase with hyphens: "erp-solutions", "hr-payroll".
 */
function isSlugId(id: string): boolean {
  if (id.length === 20 && /^[A-Za-z0-9]+$/.test(id)) return false;
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function run() {
  console.log('─────────────────────────────────────────────');
  console.log(`Migration: slug → auto-ID propositions`);
  console.log(`Project:   ${PROJECT_ID}`);
  console.log(`Tenant:    ${TENANT_ID}`);
  console.log(`Client:    ${clientId}`);
  console.log(`Mode:      ${dryRun ? 'DRY RUN (no writes)' : 'EXECUTE (will write)'}`);
  console.log('─────────────────────────────────────────────');
  console.log();

  const clientRef = db
    .collection('tenants')
    .doc(TENANT_ID)
    .collection('clients')
    .doc(clientId!);

  // ─── 1. Find slug-ID propositions ─────────────────────────────────────
  console.log('Step 1: Scanning propositions...');
  const propsSnap = await clientRef.collection('propositions').get();
  const slugProps: Array<{ oldId: string; data: FirebaseFirestore.DocumentData }> = [];
  for (const doc of propsSnap.docs) {
    if (isSlugId(doc.id)) {
      slugProps.push({ oldId: doc.id, data: doc.data() });
    }
  }
  console.log(`  Found ${propsSnap.size} total propositions`);
  console.log(`  Of which ${slugProps.length} have slug IDs needing migration`);
  slugProps.forEach((p) => console.log(`    - ${p.oldId}  (${p.data.name ?? '(no name)'})`));
  console.log();

  if (slugProps.length === 0) {
    console.log('No slug-ID propositions found. Nothing to do.');
    return;
  }

  // ─── 2. Create new auto-ID propositions, build ID map ─────────────────
  console.log('Step 2: Creating new auto-ID propositions...');
  const idMap: Record<string, string> = {};
  for (const { oldId, data } of slugProps) {
    if (dryRun) {
      const fakeNewId = `<new-auto-id-for-${oldId}>`;
      idMap[oldId] = fakeNewId;
      console.log(`  [dry-run] would create new auto-ID for "${oldId}" → ${fakeNewId}`);
    } else {
      const newDocRef = clientRef.collection('propositions').doc(); // auto-ID
      await newDocRef.set(data);
      idMap[oldId] = newDocRef.id;
      console.log(`  Created: ${oldId} → ${newDocRef.id}  (${data.name ?? '(no name)'})`);
    }
  }
  console.log();

  // ─── 3. Rewrite campaign propositionRefs ──────────────────────────────
  console.log('Step 3: Scanning campaigns for references...');
  const campaignsSnap = await clientRef.collection('campaigns').get();
  let campaignsUpdated = 0;
  for (const campaignDoc of campaignsSnap.docs) {
    const refs: string[] = campaignDoc.data().propositionRefs || [];
    if (refs.length === 0) continue;
    const newRefs = refs.map((ref) => idMap[ref] ?? ref);
    const changed = newRefs.some((r, i) => r !== refs[i]);
    if (!changed) continue;

    console.log(`  Campaign ${campaignDoc.id} (${campaignDoc.data().campaignName}):`);
    console.log(`    old: ${JSON.stringify(refs)}`);
    console.log(`    new: ${JSON.stringify(newRefs)}`);
    if (!dryRun) {
      await campaignDoc.ref.update({ propositionRefs: newRefs });
    }
    campaignsUpdated++;
  }
  console.log(`  ${campaignsUpdated} campaign(s) ${dryRun ? 'would be' : 'were'} updated`);
  console.log();

  // ─── 4. Rewrite document propositionRefs ──────────────────────────────
  console.log('Step 4: Scanning documents for references...');
  const docsSnap = await clientRef.collection('documents').get();
  let docsUpdated = 0;
  for (const docDoc of docsSnap.docs) {
    const refs: string[] = docDoc.data().propositionRefs || [];
    if (refs.length === 0) continue;
    const newRefs = refs.map((ref) => idMap[ref] ?? ref);
    const changed = newRefs.some((r, i) => r !== refs[i]);
    if (!changed) continue;

    console.log(`  Document ${docDoc.id} (${docDoc.data().name}):`);
    console.log(`    old: ${JSON.stringify(refs)}`);
    console.log(`    new: ${JSON.stringify(newRefs)}`);
    if (!dryRun) {
      await docDoc.ref.update({ propositionRefs: newRefs });
    }
    docsUpdated++;
  }
  console.log(`  ${docsUpdated} document(s) ${dryRun ? 'would be' : 'were'} updated`);
  console.log();

  // ─── 5. Delete old slug-ID propositions ───────────────────────────────
  console.log('Step 5: Deleting old slug-ID propositions...');
  for (const { oldId } of slugProps) {
    if (dryRun) {
      console.log(`  [dry-run] would delete proposition: ${oldId}`);
    } else {
      await clientRef.collection('propositions').doc(oldId).delete();
      console.log(`  Deleted: ${oldId}`);
    }
  }
  console.log();

  // ─── Done ─────────────────────────────────────────────────────────────
  console.log('─────────────────────────────────────────────');
  console.log(`Summary for client "${clientId}":`);
  console.log(`  Propositions migrated:  ${slugProps.length}`);
  console.log(`  Campaigns updated:      ${campaignsUpdated}`);
  console.log(`  Documents updated:      ${docsUpdated}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN — nothing was written' : 'EXECUTE — changes applied'}`);
  console.log('─────────────────────────────────────────────');

  if (dryRun) {
    console.log();
    console.log('Re-run with --execute to apply changes.');
  } else {
    console.log();
    console.log('Next steps:');
    console.log('  1. Verify the client UI renders propositions and linked items correctly');
    console.log('  2. Update scripts/seed.ts to use .add() instead of .doc(slug).set() for propositions');
    console.log('  3. Run this script for any other clients with slug-ID propositions');
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
