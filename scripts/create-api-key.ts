#!/usr/bin/env npx tsx
// =============================================================================
// Angsana Exchange — API Key Creation Script
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Generates a cryptographically random API key, stores its SHA-256 hash in
// Firestore, and prints the raw key exactly once. The raw key is never stored
// and cannot be retrieved. If lost, revoke and create a new one.
//
// Usage:
//   npx tsx scripts/create-api-key.ts --name "Make.com Production" --role internal-admin --tenant angsana
//   npx tsx scripts/create-api-key.ts --name "Research Team" --role internal-user --tenant angsana --clientId cegid-spain
// =============================================================================

import { randomBytes, createHash } from 'crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ─── Parse CLI arguments ────────────────────────────────────────────────────

function parseArgs(): {
  name: string;
  role: string;
  tenant: string;
  clientId: string | null;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) {
      parsed[key] = value;
    }
  }

  if (!parsed.name) {
    console.error('❌ --name is required (e.g. "Make.com Production")');
    process.exit(1);
  }
  if (!parsed.role) {
    console.error('❌ --role is required (internal-admin | internal-user | client-approver | client-viewer)');
    process.exit(1);
  }
  if (!parsed.tenant) {
    parsed.tenant = 'angsana';
  }

  const validRoles = ['internal-admin', 'internal-user', 'client-approver', 'client-viewer'];
  if (!validRoles.includes(parsed.role)) {
    console.error(`❌ Invalid role '${parsed.role}'. Valid roles: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  return {
    name: parsed.name,
    role: parsed.role,
    tenant: parsed.tenant,
    clientId: parsed.clientId || null,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  // Initialise Firebase Admin — target the Exchange project explicitly
  if (getApps().length === 0) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'angsana-exchange',
    });
  }
  const db = getFirestore();

  // Generate cryptographically random key (32 bytes, base64url encoded)
  const rawKeyBytes = randomBytes(32);
  const rawKey = rawKeyBytes.toString('base64url');

  // Hash with SHA-256
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // Store in Firestore
  const keyRef = db
    .collection('tenants')
    .doc(config.tenant)
    .collection('apiKeys')
    .doc();

  await keyRef.set({
    keyId: keyRef.id,
    keyHash,
    name: config.name,
    role: config.role,
    tenantId: config.tenant,
    clientId: config.clientId,
    collections: null,
    permissions: null,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'seed-script',
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
  });

  // Print the raw key
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✅ API Key Created Successfully');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Name:      ${config.name}`);
  console.log(`  Role:      ${config.role}`);
  console.log(`  Tenant:    ${config.tenant}`);
  console.log(`  Client:    ${config.clientId || '(all clients — cross-client access)'}`);
  console.log(`  Key ID:    ${keyRef.id}`);
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log(`  │  API Key: ${rawKey}  │`);
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  ⚠️  SAVE THIS KEY NOW — it cannot be retrieved after this point.');
  console.log('  ⚠️  Store it in a password manager, not in source code.');
  console.log('');
  console.log('  Usage:');
  console.log(`    curl -H "x-api-key: ${rawKey}" \\`);
  console.log(`      https://exchange.angsana-uk.com/api/v1/exchange/prod/api/campaigns?clientId=cegid-spain`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('❌ Failed to create API key:', err.message);
  process.exit(1);
});
