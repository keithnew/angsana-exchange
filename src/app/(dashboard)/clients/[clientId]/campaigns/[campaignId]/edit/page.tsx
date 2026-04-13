import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CampaignForm } from '../../CampaignForm';
import type { Campaign, ManagedListItem, SoWhat } from '@/types';

/**
 * Campaign Edit Page — /clients/[clientId]/campaigns/[campaignId]/edit
 *
 * Full page form pre-populated with current campaign values.
 * Only internal-user and internal-admin can access.
 * Completed campaigns cannot be edited.
 */
export default async function CampaignEditPage({
  params,
}: {
  params: Promise<{ clientId: string; campaignId: string }>;
}) {
  const { clientId, campaignId } = await params;
  const user = await getUserContext();
  const { tenantId } = user.claims;

  // Only internal users can edit
  if (!isInternalRole(user.claims.role)) {
    redirect(`/clients/${clientId}/campaigns/${campaignId}`);
  }

  if (!hasClientAccess(user.claims, clientId)) {
    redirect('/');
  }

  // Fetch campaign
  const campaignDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .doc(campaignId)
    .get();

  if (!campaignDoc.exists) {
    redirect(`/clients/${clientId}/campaigns`);
  }

  const data = campaignDoc.data()!;

  // Cannot edit completed campaigns
  if (data.status === 'completed') {
    redirect(`/clients/${clientId}/campaigns/${campaignId}`);
  }

  const campaign: Campaign = {
    id: campaignDoc.id,
    campaignName: data.campaignName || '',
    status: data.status || 'draft',
    serviceType: data.serviceType || '',
    serviceTypeId: data.serviceTypeId || '',
    owner: data.owner || '',
    startDate: data.startDate?.toDate?.()?.toISOString() || '',
    campaignSummary: data.campaignSummary || '',
    propositionRefs: data.propositionRefs || [],
    targetGeographies: data.targetGeographies || [],
    targetSectors: data.targetSectors || [],
    targetTitles: data.targetTitles || [],
    companySize: data.companySize || '',
    targetTherapyAreas: data.targetTherapyAreas || [],
    valueProposition: data.valueProposition || '',
    painPoints: data.painPoints || [],
    selectedSoWhats: data.selectedSoWhats || [],
    statusHistory: data.statusHistory || [],
    pauseReason: data.pauseReason || '',
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
  };

  // Fetch client config
  const clientDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  const clientData = clientDoc.exists ? clientDoc.data()! : {};
  const clientName = (clientData.name as string) || clientId;

  // Fetch managed lists
  const listNames = ['serviceTypes', 'geographies', 'sectors', 'titleBands', 'companySizes'];
  const listDocs = await Promise.all(
    listNames.map((name) =>
      adminDb
        .collection('tenants')
        .doc(tenantId)
        .collection('managedLists')
        .doc(name)
        .get()
    )
  );

  const managedLists: Record<string, ManagedListItem[]> = {};
  listNames.forEach((name, i) => {
    managedLists[name] = listDocs[i].exists
      ? (listDocs[i].data()!.items as ManagedListItem[]) || []
      : [];
  });

  // Build therapy area config from client capabilities
  const capabilities: string[] = clientData.capabilities || [];
  const hasTherapyAreas = capabilities.includes('therapyAreas');
  let therapyAreaConfig: { enabled: boolean; activeAreas: ManagedListItem[]; conflictedAreas: string[] } | undefined;

  if (hasTherapyAreas) {
    const therapyAreasDoc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('managedLists')
      .doc('therapyAreas')
      .get();
    const allTherapyAreas: ManagedListItem[] = therapyAreasDoc.exists
      ? (therapyAreasDoc.data()!.items as ManagedListItem[]) || []
      : [];

    const clientActiveIds: string[] = clientData.therapyAreas || [];
    const activeAreas = allTherapyAreas.filter((ta) => clientActiveIds.includes(ta.id));

    const conflictedIds: string[] = clientData.conflictedTherapyAreas || [];
    const conflictedLabels = conflictedIds.map((id) => {
      const item = allTherapyAreas.find((ta) => ta.id === id);
      return item ? item.label : id;
    });

    therapyAreaConfig = {
      enabled: true,
      activeAreas,
      conflictedAreas: conflictedLabels,
    };
  }

  // Fetch approved So Whats for the picker
  const soWhatsSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('soWhats')
    .where('status', '==', 'approved')
    .get();

  const availableSoWhats: SoWhat[] = soWhatsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      headline: d.headline || '',
      emailVersion: d.emailVersion || '',
      supportingEvidence: d.supportingEvidence || '',
      audienceTags: d.audienceTags || [],
      orientationTags: d.orientationTags || [],
      sourceRef: d.sourceRef || '',
      status: d.status || 'approved',
      createdBy: d.createdBy || '',
      createdDate: d.createdDate?.toDate?.()?.toISOString() || '',
      updatedBy: d.updatedBy || '',
      updatedDate: d.updatedDate?.toDate?.()?.toISOString() || '',
    };
  });

  return (
    <CampaignForm
      mode="edit"
      clientId={clientId}
      clientName={clientName}
      managedLists={managedLists}
      initialData={campaign}
      therapyAreaConfig={therapyAreaConfig}
      availableSoWhats={availableSoWhats}
    />
  );
}
