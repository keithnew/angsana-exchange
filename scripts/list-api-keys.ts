#!/usr/bin/env npx tsx
// =============================================================================
// Angsana Exchange — List API Keys Script
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Lists all API keys for a tenant, showing their status, role, and last usage.
// Raw key values are never stored — only metadata is available.
//
// Usage:
//   npx tsx scripts/list-api-keys.ts                    (defaults to tenant: angsana)
//   npx tsx scripts/list-api-keys.ts --tenant angsana
//   npx tsx scripts/list-api-keys.ts --status active     (filter by status)
// =============================================================================

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseArgs(): { tenant: string; status?: string } {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) {
      parsed[key] = value;
    }
  }

  return {
    tenant: parsed.tenant || 'angsana',
    status: parsed.status || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  if (ts.toDate) return ts.toDate().toISOString().replace('T', ' ').slice(0, 19);
  if (ts._seconds) return new Date(ts._seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return String(ts);
}

async function main() {
  const { tenant, status } = parseArgs();

  // Initialise Firebase Admin — target the Exchange project explicitly
  if (getApps().length === 0) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'angsana-exchange',
    });
  }
  const db = getFirestore();

  // Query API keys
  let query = db.collection('tenants').doc(tenant).collection('apiKeys').orderBy('createdAt', 'desc');
  
  if (status) {
    query = db.collection('tenants').doc(tenant).collection('apiKeys')
      .where('status', '==', status)
      .orderBy('createdAt', 'desc');
  }

  const snapshot = await query.get();

  if (snapshot.empty) {
    console.log(`\nNo API keys found for tenant '${tenant}'${status ? ` with status '${status}'` : ''}.`);
    return;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`  API Keys — Tenant: ${tenant}${status ? ` (filtered: ${status})` : ''}`);
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const statusIcon = d.status === 'active' ? '🟢' : '🔴';
    
    console.log(`  ${statusIcon} ${d.name || '(unnamed)'}`);
    console.log(`     Key ID:     ${doc.id}`);
    console.log(`     Role:       ${d.role}`);
    console.log(`     Client:     ${d.clientId || '(all clients)'}`);
    console.log(`     Status:     ${d.status}`);
    console.log(`     Created:    ${formatTimestamp(d.createdAt)}`);
    console.log(`     Last Used:  ${formatTimestamp(d.lastUsedAt)}`);
    if (d.status === 'revoked') {
      console.log(`     Revoked:    ${formatTimestamp(d.revokedAt)} by ${d.revokedBy || 'unknown'}`);
    }
    console.log('');
  }

  console.log(`  Total: ${snapshot.size} key(s)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Commands:');
  console.log('    Create:  npx tsx scripts/create-api-key.ts --name "Name" --role internal-admin --tenant angsana');
  console.log('    Revoke:  npx tsx scripts/revoke-api-key.ts --keyId <KEY_ID>');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Failed to list API keys:', err.message);
  process.exit(1);
});
