import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CheckInForm } from '../CheckInForm';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * New Check-in Page — /clients/[clientId]/checkins/new
 * Full page form for recording a check-in.
 */
export default async function NewCheckinPage({
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
    redirect(`/clients/${clientId}/checkins`);
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

  // Fetch campaigns for the related campaigns multi-select
  const campaignsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  // Include all campaigns except completed (which is terminal/historical)
  const campaigns = campaignsSnapshot.docs
    .filter((doc) => {
      const status = doc.data().status;
      return status !== 'completed';
    })
    .map((doc) => ({
      id: doc.id,
      campaignName: doc.data().campaignName || doc.id,
    }));

  return (
    <PagePadding>
    <CheckInForm
      clientId={clientId}
      clientName={clientName}
      campaigns={campaigns}
    />
      </PagePadding>
  );
}
