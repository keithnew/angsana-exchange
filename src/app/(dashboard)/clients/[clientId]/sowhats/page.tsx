import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import SoWhatListClient from './SoWhatListClient';
import type { SoWhat } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function SoWhatsPage({ params }: Props) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Fetch So Whats
  const soWhatsSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('soWhats')
    .orderBy('createdDate', 'desc')
    .get();

  const soWhats: SoWhat[] = soWhatsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
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
  });

  // Fetch title bands for audience tag labels
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
    <SoWhatListClient
      clientId={clientId}
      soWhats={soWhats}
      titleBands={titleBands}
      userRole={user.claims.role}
    />
      </PagePadding>
  );
}
