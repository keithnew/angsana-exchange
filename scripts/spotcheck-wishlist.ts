// =============================================================================
// One-shot read tool for inspecting wishlist documents post-migration.
//
// Usage:
//   npx tsx scripts/spotcheck-wishlist.ts <docId> [<docId> ...]
//
// Prints the post-migration shape of each doc on
// tenants/angsana/clients/cegid-spain/wishlists. Used in the 7c rehearsal
// to confirm the R2 lift produced the expected fields per spec §6.2.
// =============================================================================

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'angsana-exchange';
const TENANT_ID = 'angsana';
const CLIENT_ID = 'cegid-spain';

const docIds = process.argv.slice(2);

if (docIds.length === 0) {
  console.error('usage: npx tsx scripts/spotcheck-wishlist.ts <docId> [<docId> ...]');
  process.exit(2);
}

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore();

async function main() {
  for (const id of docIds) {
    const path = `tenants/${TENANT_ID}/clients/${CLIENT_ID}/wishlists/${id}`;
    const snap = await db.doc(path).get();
    console.log(`=== ${path} ===`);
    if (!snap.exists) {
      console.log('  <document does not exist>');
      console.log();
      continue;
    }
    const data = snap.data() ?? {};
    console.log(JSON.stringify(data, null, 2));
    console.log();
  }
}

main().catch((err) => {
  console.error('[spotcheck] failed:', err);
  process.exit(1);
});
