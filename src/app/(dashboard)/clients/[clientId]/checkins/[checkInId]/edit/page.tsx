import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CheckInEditForm } from './CheckInEditForm';
import type { CheckIn, Action } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * Edit Check-in Page — /clients/[clientId]/checkins/[checkInId]/edit
 * Pre-populates the form with existing check-in data.
 */
export default async function EditCheckinPage({
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

  if (!isInternalRole(user.claims.role)) {
    redirect(`/clients/${clientId}/checkins/${checkInId}`);
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
    date: data.date?.toDate?.()?.toISOString()?.split('T')[0] || '',
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
    nextCheckInDate: data.nextCheckInDate?.toDate?.()?.toISOString()?.split('T')[0] || undefined,
    // S3-P3: read from new key with legacy fallback so pre-P3 docs still surface counts.
    generatedWorkItemIds:
      (data.generatedWorkItemIds as string[]) ||
      (data.generatedActionIds as string[]) ||
      [],
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
  };

  // Fetch linked actions for read-only context on existing decisions
  const linkedActions: Action[] = [];
  if (checkin.generatedWorkItemIds.length > 0) {
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

  // Fetch campaigns
  const campaignsSnapshot = await clientRef.collection('campaigns').get();
  // Include all campaigns except completed (which is terminal/historical)
  const campaigns = campaignsSnapshot.docs
    .filter((doc) => {
      const status = doc.data().status;
      return status !== 'completed';
    })
    .map((doc) => ({
      id: doc.id,
      campaignName: doc.data().campaignName || doc.id,
    }));

  return (
    <PagePadding>
    <CheckInEditForm
      checkin={checkin}
      linkedActions={linkedActions}
      clientId={clientId}
      clientName={clientName}
      campaigns={campaigns}
    />
      </PagePadding>
  );
}
