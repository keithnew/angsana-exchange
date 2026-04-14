import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import { notFound, redirect } from 'next/navigation';
import SoWhatForm from '../../SoWhatForm';
import type { SoWhat } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string; soWhatId: string }>;
}

export default async function EditSoWhatPage({ params }: Props) {
  const { clientId, soWhatId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Fetch the So What
  const soWhatDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('soWhats')
    .doc(soWhatId)
    .get();

  if (!soWhatDoc.exists) {
    notFound();
  }

  const d = soWhatDoc.data()!;
  const soWhat: SoWhat = {
    id: soWhatDoc.id,
    headline: d.headline || '',
    emailVersion: d.emailVersion || '',
    supportingEvidence: d.supportingEvidence || '',
    audienceTags: d.audienceTags || [],
    orientationTags: d.orientationTags || [],
    sourceRef: d.sourceRef || '',
    status: d.status || 'draft',
    createdBy: d.createdBy || '',
    createdDate: d.createdDate?.toDate?.()?.toISOString() || '',
    updatedBy: d.updatedBy || '',
    updatedDate: d.updatedDate?.toDate?.()?.toISOString() || '',
  };

  // Permission check: client-approver can only edit own drafts
  const role = user.claims.role;
  const isInternal = role === 'internal-admin' || role === 'internal-user';
  const canEdit =
    isInternal ||
    (role === 'client-approver' && soWhat.createdBy === user.email && soWhat.status === 'draft');

  if (!canEdit) {
    redirect(`/clients/${clientId}/sowhats/${soWhatId}`);
  }

  // Fetch title bands
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
        <h1 className="text-2xl font-bold text-gray-900">Edit So What</h1>
        <p className="mt-1 text-sm text-gray-500">Update this So What entry.</p>
      </div>

      <SoWhatForm clientId={clientId} titleBands={titleBands} soWhat={soWhat} mode="edit" />
    </div>
      </PagePadding>
  );
}
