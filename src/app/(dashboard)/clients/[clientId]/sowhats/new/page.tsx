import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import { redirect } from 'next/navigation';
import SoWhatForm from '../SoWhatForm';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function NewSoWhatPage({ params }: Props) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Permission: only internal users and client-approvers can create
  if (user.claims.role === 'client-viewer') {
    redirect(`/clients/${clientId}/sowhats`);
  }

  // Fetch title bands for audience tag selection
  const titleBandsSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('managedLists')
    .doc('titleBands')
    .get();

  const titleBands = (titleBandsSnap.data()?.items || []).filter(
    (i: { active: boolean }) => i.active
  );

  return (
    <PagePadding>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New So What</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a new message for the So What library. All entries start as draft.
        </p>
      </div>

      <SoWhatForm clientId={clientId} titleBands={titleBands} mode="create" />
    </div>
      </PagePadding>
  );
}
