import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ActionListClient } from './ActionListClient';
import type { Action } from '@/types';

/**
 * Action List Page — /clients/[clientId]/actions
 *
 * Server component that:
 * 1. Verifies the user has access to this client
 * 2. Queries Firestore for actions
 * 3. Fetches campaign names for display
 * 4. Renders the ActionListClient component
 */
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

  // Fetch client name
  const clientDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  const clientName = clientDoc.exists
    ? (clientDoc.data()?.name as string) || clientId
    : clientId;

  // Fetch actions
  const actionsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('actions')
    .get();

  const actions: Action[] = actionsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title || '',
      description: data.description || '',
      assignedTo: data.assignedTo || '',
      dueDate: data.dueDate?.toDate?.()?.toISOString() || '',
      status: data.status || 'open',
      priority: data.priority || 'medium',
      source: data.source || { type: 'manual' },
      relatedCampaign: data.relatedCampaign || '',
      createdBy: data.createdBy || '',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
    };
  });

  // Fetch campaigns for name lookups
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

  const isInternal =
    user.claims.role === 'internal-admin' || user.claims.role === 'internal-user';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)]">
            {clientName} — Actions
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {actions.length} action{actions.length !== 1 ? 's' : ''}
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
        actions={actions}
        clientId={clientId}
        campaigns={campaigns}
        isInternal={isInternal}
      />
    </div>
  );
}
