import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import { ProspectingProfileClient } from './ProspectingProfileClient';
import type { Proposition, ManagedListItem, Campaign } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ProspectingProfilePage({ params }: Props) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Fetch all data in parallel
  const [
    clientSnap,
    propositionsSnap,
    profileSnap,
    sectorsSnap,
    titleBandsSnap,
    geographiesSnap,
    propCategoriesSnap,
    messagingTypesSnap,
    buyingProcessTypesSnap,
    usersSnap,
    campaignsSnap,
  ] = await Promise.all([
    adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId).get(),
    adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId)
      .collection('propositions').orderBy('sortOrder', 'asc').get(),
    adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId)
      .collection('config').doc('prospectingProfile').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('sectors').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('titleBands').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('geographies').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('propositionCategories').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('messagingTypes').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('buyingProcessTypes').get(),
    // Change 2: Fetch users for UID→displayName resolution
    adminDb.collection('tenants').doc(tenantId).collection('users').get(),
    // Change 6: Fetch non-completed campaigns for proposition cross-links
    adminDb.collection('tenants').doc(tenantId).collection('clients').doc(clientId)
      .collection('campaigns').where('status', 'in', ['draft', 'active', 'paused']).get(),
  ]);

  const clientName = clientSnap.data()?.name || clientId;

  // Change 2: Build UID→displayName lookup map
  const userMap: Record<string, string> = {};
  usersSnap.docs.forEach((doc) => {
    const data = doc.data();
    const displayName = data.displayName || data.name || data.email || doc.id;
    userMap[doc.id] = displayName;
  });

  // Map propositions (including icp and suggestedCategory)
  const propositions: Proposition[] = propositionsSnap.docs.map((doc) => {
    const d = doc.data();
    const icp = d.icp ? {
      industries: d.icp.industries || { managedListRefs: [], specifics: '' },
      companySizing: d.icp.companySizing || [],
      titles: d.icp.titles || { managedListRefs: [], specifics: '' },
      seniority: d.icp.seniority || { managedListRefs: [], specifics: '' },
      buyingProcess: d.icp.buyingProcess || { type: '', notes: '' },
      geographies: d.icp.geographies || { managedListRefs: [], specifics: '' },
      exclusions: d.icp.exclusions || [],
      lastUpdatedBy: d.icp.lastUpdatedBy || '',
      lastUpdatedAt: d.icp.lastUpdatedAt?.toDate?.()?.toISOString() || d.icp.lastUpdatedAt || '',
    } : undefined;

    return {
      id: doc.id,
      name: d.name || '',
      category: d.category || '',
      description: d.description || '',
      status: d.status || 'active',
      sortOrder: d.sortOrder ?? 0,
      suggestedCategory: d.suggestedCategory || '',
      icp,
      createdBy: d.createdBy || '',
      createdAt: d.createdAt?.toDate?.()?.toISOString() || '',
      lastUpdatedBy: d.lastUpdatedBy || '',
      lastUpdatedAt: d.lastUpdatedAt?.toDate?.()?.toISOString() || '',
    };
  });

  // Change 6: Map campaigns (minimal — just id, name, status, propositionRefs)
  const campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status' | 'propositionRefs'>[] = campaignsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      campaignName: d.campaignName || '',
      status: d.status || 'draft',
      propositionRefs: d.propositionRefs || [],
    };
  });

  // Map profile
  const d = profileSnap.exists ? profileSnap.data()! : {};
  const profile = {
    icp: {
      industries: d.icp?.industries || { managedListRefs: [], specifics: '' },
      companySizing: d.icp?.companySizing || [],
      titles: d.icp?.titles || { managedListRefs: [], specifics: '' },
      seniority: d.icp?.seniority || { managedListRefs: [], specifics: '' },
      buyingProcess: d.icp?.buyingProcess || { type: '', notes: '' },
      geographies: d.icp?.geographies || { managedListRefs: [], specifics: '' },
      exclusions: d.icp?.exclusions || [],
      lastUpdatedBy: d.icp?.lastUpdatedBy || '',
      lastUpdatedAt: d.icp?.lastUpdatedAt?.toDate?.()?.toISOString() || d.icp?.lastUpdatedAt || '',
    },
    marketMessaging: (d.marketMessaging || []).map((e: Record<string, unknown>) => ({
      ...e,
      createdAt: (e.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || e.createdAt || '',
    })),
    recommendations: (d.recommendations || []).map((e: Record<string, unknown>) => ({
      ...e,
      createdAt: (e.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || e.createdAt || '',
      lastUpdatedAt: (e.lastUpdatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || e.lastUpdatedAt || '',
    })),
    aiReview: d.aiReview || { lastReviewDate: null, status: 'not-requested', findings: [] },
    lastUpdatedBy: d.lastUpdatedBy || '',
    lastUpdatedAt: d.lastUpdatedAt?.toDate?.()?.toISOString() || d.lastUpdatedAt || '',
  };

  // Extract managed lists
  const managedLists: Record<string, ManagedListItem[]> = {
    sectors: (sectorsSnap.data()?.items || []) as ManagedListItem[],
    titleBands: (titleBandsSnap.data()?.items || []) as ManagedListItem[],
    geographies: (geographiesSnap.data()?.items || []) as ManagedListItem[],
    propositionCategories: (propCategoriesSnap.data()?.items || []) as ManagedListItem[],
    messagingTypes: (messagingTypesSnap.data()?.items || []) as ManagedListItem[],
    buyingProcessTypes: (buyingProcessTypesSnap.data()?.items || []) as ManagedListItem[],
  };

  return (
    <PagePadding>
    <ProspectingProfileClient
      clientId={clientId}
      clientName={clientName}
      propositions={propositions}
      profile={profile}
      managedLists={managedLists}
      userRole={user.claims.role}
      userUid={user.uid}
      userEmail={user.email}
      userMap={userMap}
      campaigns={campaigns}
    />
      </PagePadding>
  );
}
