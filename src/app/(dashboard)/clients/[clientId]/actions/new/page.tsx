import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { ActionForm } from '../ActionForm';

/**
 * New Action Page — /clients/[clientId]/actions/new
 * Full page form for creating a standalone action.
 */
export default async function NewActionPage({
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

  if (!isInternalRole(user.claims.role)) {
    redirect(`/clients/${clientId}/actions`);
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

  // Fetch campaigns for the related campaign dropdown
  const campaignsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaigns = campaignsSnapshot.docs
    .filter((doc) => {
      const status = doc.data().status;
      return status === 'active' || status === 'paused';
    })
    .map((doc) => ({
      id: doc.id,
      campaignName: doc.data().campaignName || doc.id,
    }));

  return (
    <ActionForm
      clientId={clientId}
      clientName={clientName}
      campaigns={campaigns}
    />
  );
}
