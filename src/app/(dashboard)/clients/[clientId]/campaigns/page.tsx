import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CampaignTable } from './CampaignTable';
import type { Campaign, Proposition } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * Campaign List Page — /clients/[clientId]/campaigns
 *
 * Server component that:
 * 1. Verifies the user has access to this client
 * 2. Queries Firestore for campaigns
 * 3. Renders the CampaignTable client component
 */
export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getUserContext();
  const { tenantId } = user.claims;

  // Access check
  if (!hasClientAccess(user.claims, clientId)) {
    redirect('/');
  }

  // Fetch client config for the heading
  const clientDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  const clientName = clientDoc.exists
    ? (clientDoc.data()?.name as string) || clientId
    : clientId;

  // Fetch campaigns and propositions in parallel
  const [snapshot, propsSnapshot] = await Promise.all([
    adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('campaigns')
      .orderBy('startDate', 'desc')
      .get(),
    adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('propositions')
      .get(),
  ]);

  const propositions: Proposition[] = propsSnapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name || '',
      description: d.description || '',
      status: d.status || 'active',
      category: d.category || '',
      icpStatus: d.icpStatus || 'draft',
      icp: d.icp || {},
    } as Proposition;
  });

  const campaigns: Campaign[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      campaignName: data.campaignName || '',
      status: data.status || 'draft',
      serviceType: data.serviceType || '',
      serviceTypeId: data.serviceTypeId || '',
      owner: data.owner || '',
      startDate: data.startDate?.toDate?.()?.toISOString() || '',
      campaignSummary: data.campaignSummary || '',
      targetGeographies: data.targetGeographies || [],
      targetSectors: data.targetSectors || [],
      targetTitles: data.targetTitles || [],
      companySize: data.companySize || '',
      valueProposition: data.valueProposition || '',
      painPoints: data.painPoints || [],
      propositionRefs: data.propositionRefs || [],
      selectedSoWhats: data.selectedSoWhats || [],
      statusHistory: data.statusHistory || [],
      pauseReason: data.pauseReason || '',
      createdBy: data.createdBy || '',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
    };
  });

  const isInternal =
    user.claims.role === 'internal-admin' || user.claims.role === 'internal-user';

  return (
    <PagePadding>
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)]">
            {clientName} — Campaigns
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
          </p>
        </div>

        {isInternal && (
          <Link
            href={`/clients/${clientId}/campaigns/new`}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            + New Campaign
          </Link>
        )}
      </div>

      <CampaignTable campaigns={campaigns} clientId={clientId} propositions={propositions} />
    </div>
      </PagePadding>
  );
}
