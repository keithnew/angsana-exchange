import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import { notFound } from 'next/navigation';
import SoWhatDetailClient from './SoWhatDetailClient';
import type { SoWhat, Campaign } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string; soWhatId: string }>;
}

export default async function SoWhatDetailPage({ params }: Props) {
  const { clientId, soWhatId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Fetch the So What document
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

  // Fetch title bands and campaigns in parallel
  const [titleBandsSnap, campaignsSnap] = await Promise.all([
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('titleBands').get(),
    adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId).collection('campaigns').get(),
  ]);

  const titleBands = (titleBandsSnap.data()?.items || []).filter(
    (i: { active: boolean }) => i.active
  );

  // Find campaigns that reference this So What
  const usedInCampaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[] = [];
  campaignsSnap.docs.forEach((doc) => {
    const cd = doc.data();
    const selectedSoWhats: string[] = cd.selectedSoWhats || [];
    if (selectedSoWhats.includes(soWhatId)) {
      usedInCampaigns.push({
        id: doc.id,
        campaignName: cd.campaignName || '',
        status: cd.status || 'draft',
      });
    }
  });

  return (
    <PagePadding>
    <SoWhatDetailClient
      clientId={clientId}
      soWhat={soWhat}
      titleBands={titleBands}
      usedInCampaigns={usedInCampaigns}
      userRole={user.claims.role}
      userEmail={user.email}
    />
      </PagePadding>
  );
}
