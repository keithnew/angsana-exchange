#!/usr/bin/env npx tsx
// =============================================================================
// Angsana Exchange — API Key Revocation Script
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Revokes an API key by setting its status to 'revoked'. The key hash remains
// in Firestore but the auth middleware rejects it with API_KEY_REVOKED.
// Revocation is immediate — no delay, no grace period.
//
// Usage:
//   npx tsx scripts/revoke-api-key.ts --keyId DnOSS7FrITXpmRNrt1BV --tenant angsana
//   npx tsx scripts/revoke-api-key.ts --keyId DnOSS7FrITXpmRNrt1BV  (defaults to tenant: angsana)
//
// To find the keyId, use: npx tsx scripts/list-api-keys.ts
// =============================================================================

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function parseArgs(): { keyId: string; tenant: string } {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) {
      parsed[key] = value;
    }
  }

  if (!parsed.keyId) {
    console.error('❌ --keyId is required. Use "npx tsx scripts/list-api-keys.ts" to find it.');
    process.exit(1);
  }

  return {
    keyId: parsed.keyId,
    tenant: parsed.tenant || 'angsana',
  };
}

async function main() {
  const { keyId, tenant } = parseArgs();

  // Initialise Firebase Admin — target the Exchange project explicitly
  if (getApps().length === 0) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'angsana-exchange',
    });
  }
  const db = getFirestore();

  // Look up the key document
  const keyRef = db.collection('tenants').doc(tenant).collection('apiKeys').doc(keyId);
  const keyDoc = await keyRef.get();

  if (!keyDoc.exists) {
    console.error(`❌ API key '${keyId}' not found in tenant '${tenant}'.`);
    process.exit(1);
  }

  const data = keyDoc.data()!;

  if (data.status === 'revoked') {
    console.log(`⚠️  API key '${keyId}' (${data.name}) is already revoked.`);
    console.log(`   Revoked at: ${data.revokedAt?.toDate?.() || data.revokedAt}`);
    process.exit(0);
  }

  // Revoke it
  await keyRef.update({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: 'cli-script',
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🔒 API Key Revoked Successfully');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Key ID:    ${keyId}`);
  console.log(`  Name:      ${data.name}`);
  console.log(`  Role:      ${data.role}`);
  console.log(`  Tenant:    ${tenant}`);
  console.log('');
  console.log('  The key is now rejected immediately. Any callers using it');
  console.log('  will receive a 401 API_KEY_REVOKED error.');
  console.log('');
  console.log('  If a replacement key is needed, create one with:');
  console.log(`    npx tsx scripts/create-api-key.ts --name "${data.name}" --role ${data.role} --tenant ${tenant}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('❌ Failed to revoke API key:', err.message);
  process.exit(1);
});
