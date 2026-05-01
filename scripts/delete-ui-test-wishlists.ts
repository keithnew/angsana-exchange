// =============================================================================
// One-shot cleanup: delete two UI-created test wishlist documents on
// cegid-spain that pre-date the 7c migration rehearsal.
//
// Documents:
//   - 3eoLvgRkxSHy3lCqMoYA  Widget Corp                  (alessandro@cegid.com)
//   - UY00YS76x2B8R2sTbdst  Graham Sound Technologies    (alessandro@cegid.com)
//
// Both were created by Alessandro via the live UI during early R1 testing,
// not via scripts/seed.ts. Removing them gives a clean baseline of 8
// documents (5 named-ID seed + 3 §6.6 routing seeds) for the migration
// rehearsal in 7c.
//
// Idempotent: missing documents are reported and skipped.
// Safe by default: refuses to run without --execute.
// =============================================================================

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'angsana-exchange';
const TENANT_ID = 'angsana';
const CLIENT_ID = 'cegid-spain';

const TARGET_DOC_IDS = [
  { id: '3eoLvgRkxSHy3lCqMoYA', expectedCompanyName: 'Widget Corp' },
  { id: 'UY00YS76x2B8R2sTbdst', expectedCompanyName: 'Graham Sound Technologies' },
] as const;

const isExecute = process.argv.includes('--execute');

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const db = getFirestore();

async function main() {
  const collectionPath = `tenants/${TENANT_ID}/clients/${CLIENT_ID}/wishlists`;
  console.log(`[cleanup] target collection: ${collectionPath}`);
  console.log(`[cleanup] mode: ${isExecute ? 'EXECUTE (will delete)' : 'DRY-RUN (no writes)'}`);
  console.log();

  for (const { id, expectedCompanyName } of TARGET_DOC_IDS) {
    const ref = db.doc(`${collectionPath}/${id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`  [skip] ${id} — not found (already deleted?)`);
      continue;
    }

    const data = snap.data() ?? {};
    const actualName = (data.companyName as string | undefined) ?? '<missing>';

    if (actualName !== expectedCompanyName) {
      console.error(
        `  [abort] ${id} — companyName mismatch. Expected "${expectedCompanyName}", got "${actualName}". ` +
          `Refusing to delete; this is not the document we expected.`
      );
      process.exit(1);
    }

    if (isExecute) {
      await ref.delete();
      console.log(`  [deleted] ${id} — ${actualName}`);
    } else {
      console.log(`  [would-delete] ${id} — ${actualName}`);
    }
  }

  console.log();
  if (!isExecute) {
    console.log('[cleanup] DRY-RUN complete. Re-run with --execute to delete.');
  } else {
    console.log('[cleanup] complete.');
  }
}

main().catch((err) => {
  console.error('[cleanup] failed:', err);
  process.exit(1);
});
