// =============================================================================
// Action List Page — /clients/[clientId]/actions
//
// S3-code-P3 — rewritten in-place to consume action-lite Work Items.
//
// What changed vs P2:
//   - Reads via `listActionLiteForClient` (cross-project core-prod
//     Firestore) rather than the legacy
//     tenants/{tenantId}/clients/{clientId}/actions subcollection.
//   - Hands `ActionLiteWire[]` to `ActionListClient` (was: `Action[]`).
//   - URL structure unchanged: `/clients/{clientId}/actions` and
//     `/clients/{clientId}/actions/new` per pre-code Decision #5.
// =============================================================================

import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ActionListClient } from './ActionListClient';
import { listActionLiteForClient } from '@/lib/workItems/actionLitePersistence';
import { PagePadding } from '@/components/layout/PagePadding';

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getUserContext();
  const { tenantId } = user.claims;

  if (!hasClientAccess(user.claims, clientId)) {
    redirect('/');
  }

  // Client name (Exchange-side, unchanged from P2).
  const clientDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  const clientName = clientDoc.exists
    ? (clientDoc.data()?.name as string) || clientId
    : clientId;

  // Campaigns — used both for name lookup (display) AND for the
  // campaign-subject query branch in `listActionLiteForClient`.
  const campaignsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaigns = campaignsSnapshot.docs.map((doc) => ({
    id: doc.id,
    campaignName: doc.data().campaignName || doc.id,
  }));

  const items = await listActionLiteForClient({
    tenantId,
    clientId,
    campaignIds: campaigns.map((c) => c.id),
  });

  const isInternal =
    user.claims.role === 'internal-admin' ||
    user.claims.role === 'internal-user';

  return (
    <PagePadding>
      <div>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[var(--foreground)]">
              {clientName} — Actions
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {items.length} action{items.length !== 1 ? 's' : ''}
            </p>
          </div>

          {isInternal && (
            <Link
              href={`/clients/${clientId}/actions/new`}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              + New Action
            </Link>
          )}
        </div>

        <ActionListClient
          items={items}
          clientId={clientId}
          campaigns={campaigns}
          isInternal={isInternal}
        />
      </div>
    </PagePadding>
  );
}
