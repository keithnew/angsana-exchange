import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CheckInDetailClient } from './CheckInDetailClient';
import type { CheckIn, Action } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * Check-in Detail Page — /clients/[clientId]/checkins/[checkInId]
 *
 * Server component that:
 * 1. Verifies user access
 * 2. Fetches the check-in document
 * 3. Fetches linked actions for status display
 * 4. Fetches campaign names for display
 */
export default async function CheckInDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; checkInId: string }>;
}) {
  const { clientId, checkInId } = await params;
  const user = await getUserContext();
  const { tenantId } = user.claims;

  if (!hasClientAccess(user.claims, clientId)) {
    redirect('/');
  }

  const clientRef = adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId);

  // Fetch check-in
  const checkInDoc = await clientRef.collection('checkIns').doc(checkInId).get();

  if (!checkInDoc.exists) {
    redirect(`/clients/${clientId}/checkins`);
  }

  const data = checkInDoc.data()!;
  const checkin: CheckIn = {
    id: checkInDoc.id,
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

  // Fetch linked actions
  const linkedActions: Action[] = [];
  if (checkin.generatedWorkItemIds.length > 0) {
    // Firestore `in` query supports up to 30 items — fine for check-in actions
    const actionsSnapshot = await clientRef
      .collection('actions')
      .where('source.ref', '==', checkInId)
      .get();

    for (const doc of actionsSnapshot.docs) {
      const ad = doc.data();
      linkedActions.push({
        id: doc.id,
        title: ad.title || '',
        description: ad.description || '',
        assignedTo: ad.assignedTo || '',
        dueDate: ad.dueDate?.toDate?.()?.toISOString() || '',
        status: ad.status || 'open',
        priority: ad.priority || 'medium',
        source: ad.source || { type: 'manual' },
        relatedCampaign: ad.relatedCampaign || '',
        createdBy: ad.createdBy || '',
        createdAt: ad.createdAt?.toDate?.()?.toISOString() || '',
        updatedAt: ad.updatedAt?.toDate?.()?.toISOString() || '',
      });
    }
  }

  // Fetch client name
  const clientDoc = await clientRef.get();
  const clientName = clientDoc.exists
    ? (clientDoc.data()?.name as string) || clientId
    : clientId;

  // Fetch campaign names
  const campaignsSnapshot = await clientRef.collection('campaigns').get();
  const campaignMap: Record<string, string> = {};
  campaignsSnapshot.docs.forEach((doc) => {
    campaignMap[doc.id] = doc.data().campaignName || doc.id;
  });

  const isInternal =
    user.claims.role === 'internal-admin' || user.claims.role === 'internal-user';

  return (
    <PagePadding>
    <CheckInDetailClient
      checkin={checkin}
      linkedActions={linkedActions}
      clientId={clientId}
      clientName={clientName}
      campaignMap={campaignMap}
      isInternal={isInternal}
    />
      </PagePadding>
  );
}
