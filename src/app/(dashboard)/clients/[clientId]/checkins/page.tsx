import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CheckInListClient } from './CheckInListClient';
import type { CheckIn } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * Check-in List Page — /clients/[clientId]/checkins
 *
 * Server component that:
 * 1. Verifies the user has access to this client
 * 2. Queries Firestore for check-ins (ordered by date descending)
 * 3. Renders the CheckInListClient component
 */
export default async function CheckinsPage({
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

  // Fetch check-ins ordered by date descending
  const checkinsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('checkIns')
    .orderBy('date', 'desc')
    .get();

  const checkins: CheckIn[] = checkinsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      date: data.date?.toDate?.()?.toISOString() || '',
      type: data.type || 'regular',
      attendees: data.attendees || [],
      duration: data.duration || 30,
      relatedCampaigns: data.relatedCampaigns || [],
      keyPoints: data.keyPoints || [],
      decisions: (data.decisions || []).map((d: Record<string, unknown>) => ({
        text: (d.text as string) || '',
        assignee: (d.assignee as string) || '',
        dueDate: (d.dueDate as string) || '',
        createAction: d.createAction !== false,
      })),
      nextSteps: (data.nextSteps || []).map((ns: Record<string, unknown>) => ({
        text: (ns.text as string) || '',
        owner: (ns.owner as string) || '',
        targetDate: (ns.targetDate as string) || '',
        createAction: ns.createAction !== false,
      })),
      nextCheckInDate: data.nextCheckInDate?.toDate?.()?.toISOString() || undefined,
      // S3-P3: read from new key with legacy fallback so pre-P3 docs still surface counts.
      generatedWorkItemIds:
        (data.generatedWorkItemIds as string[]) ||
        (data.generatedActionIds as string[]) ||
        [],
      createdBy: data.createdBy || '',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
    };
  });

  // Fetch campaigns for name lookups
  const campaignsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaigns = campaignsSnapshot.docs.map((doc) => ({
    id: doc.id,
    campaignName: doc.data().campaignName || doc.id,
  }));

  const isInternal =
    user.claims.role === 'internal-admin' || user.claims.role === 'internal-user';

  return (
    <PagePadding>
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)]">
            {clientName} — Check-ins
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {checkins.length} check-in{checkins.length !== 1 ? 's' : ''}
          </p>
        </div>

        {isInternal && (
          <Link
            href={`/clients/${clientId}/checkins/new`}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            + New Check-in
          </Link>
        )}
      </div>

      <CheckInListClient
        checkins={checkins}
        clientId={clientId}
        campaigns={campaigns}
      />
    </div>
      </PagePadding>
  );
}
