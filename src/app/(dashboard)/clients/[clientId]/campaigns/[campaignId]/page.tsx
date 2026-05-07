import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CampaignDetailClient } from './CampaignDetailClient';
import type { Campaign, ManagedListItem, SoWhat } from '@/types';
import { listActionLiteForClient } from '@/lib/workItems/actionLitePersistence';

/**
 * Campaign Detail Page — /clients/[clientId]/campaigns/[campaignId]
 *
 * Server component that:
 * 1. Verifies the user has access to this client
 * 2. Fetches the campaign document from Firestore
 * 3. Fetches managed lists for label lookups
 * 4. Passes data to the client component for display and interactions
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; campaignId: string }>;
}) {
  const { clientId, campaignId } = await params;
  const user = await getUserContext();
  const { tenantId } = user.claims;

  // Access check
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
  const campaign: Campaign = {
    id: campaignDoc.id,
    campaignName: data.campaignName || '',
    status: data.status || 'draft',
    serviceType: data.serviceType || '',
    serviceTypeId: data.serviceTypeId || '',
    owner: data.owner || '',
    startDate: data.startDate?.toDate?.()?.toISOString() || '',
    propositionRefs: data.propositionRefs || [],
    campaignSummary: data.campaignSummary || '',
    targetGeographies: data.targetGeographies || [],
    targetSectors: data.targetSectors || [],
    targetTitles: data.targetTitles || [],
    companySize: data.companySize || '',
    valueProposition: data.valueProposition || '',
    painPoints: data.painPoints || [],
    selectedSoWhats: data.selectedSoWhats || [],
    statusHistory: (data.statusHistory || []).map((entry: Record<string, unknown>) => ({
      from: (entry.from as string) || null,
      to: (entry.to as string) || 'draft',
      timestamp: (entry.timestamp as string) || '',
      changedBy: (entry.changedBy as string) || '',
      reason: (entry.reason as string) || undefined,
    })),
    pauseReason: data.pauseReason || '',
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
  };

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

  // Fetch managed lists for label lookups
  const listNames = ['geographies', 'sectors', 'titleBands', 'companySizes', 'serviceTypes'];
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

  const isInternal =
    user.claims.role === 'internal-admin' || user.claims.role === 'internal-user';

  // Fetch related check-ins (where this campaign is in relatedCampaigns)
  const clientRef = adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId);

  // Fetch related check-ins — gracefully handle missing composite index
  let relatedCheckins: { id: string; date: string; type: string; keyPoints: string[] }[] = [];
  try {
    const checkinsSnapshot = await clientRef
      .collection('checkIns')
      .where('relatedCampaigns', 'array-contains', campaignId)
      .orderBy('date', 'desc')
      .get();

    relatedCheckins = checkinsSnapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        date: d.date?.toDate?.()?.toISOString() || '',
        type: d.type || 'regular',
        keyPoints: d.keyPoints || [],
      };
    });
  } catch (err) {
    // Composite index may not exist yet — fall back to unordered query
    console.warn('Check-ins composite index not ready, falling back:', err);
    try {
      const checkinsSnapshot = await clientRef
        .collection('checkIns')
        .where('relatedCampaigns', 'array-contains', campaignId)
        .get();

      relatedCheckins = checkinsSnapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          date: d.date?.toDate?.()?.toISOString() || '',
          type: d.type || 'regular',
          keyPoints: d.keyPoints || [],
        };
      });
      // Sort client-side
      relatedCheckins.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch {
      // If even the simple query fails, return empty
      relatedCheckins = [];
    }
  }

  // S3-code-P4: related actions read from action-lite Work Items on
  // angsana-core-prod (cross-project). Filter to subject.entityId
  // matching this campaign — the action-lite Work Item shape encodes
  // the campaign relationship via `subject` (Spec §2.1) rather than the
  // legacy `relatedCampaign` field.
  // Pass [campaignId] alone for `campaignIds` — the union still queries
  // client-subject + this single campaign-subject; we filter to just
  // this campaign post-union.
  const allActions = await listActionLiteForClient({
    tenantId,
    clientId,
    campaignIds: [campaignId],
  });
  const relatedActions = allActions
    .filter((a) => a.subject?.entityType === 'campaign' && a.subject?.entityId === campaignId)
    .map((a) => ({
      id: a.workItemId,
      title: a.title,
      // The CampaignDetailClient renders this via ACTION_LITE_STATE_CONFIG;
      // the value we pass here is the action-lite `state` enum (open,
      // in-progress, done, blocked) — same enum the legacy `status` had.
      status: a.state,
      assignedTo: a.owner?.userId ?? '',
      dueDate: a.deadline ?? '',
    }));

  // Fetch So Whats data for this campaign's selectedSoWhats
  let soWhatsData: SoWhat[] = [];
  if (campaign.selectedSoWhats.length > 0) {
    const soWhatsSnap = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('soWhats')
      .get();

    soWhatsData = soWhatsSnap.docs
      .filter((doc) => campaign.selectedSoWhats.includes(doc.id))
      .map((doc) => {
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
  }

  return (
    <CampaignDetailClient
      campaign={campaign}
      clientId={clientId}
      clientName={clientName}
      managedLists={managedLists}
      isInternal={isInternal}
      userEmail={user.email}
      relatedCheckins={relatedCheckins}
      relatedActions={relatedActions}
      soWhatsData={soWhatsData}
    />
  );
}
