import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CheckInEditForm } from './CheckInEditForm';
import type { CheckIn } from '@/types';
import { listActionLiteForClient } from '@/lib/workItems/actionLitePersistence';
import type { ActionLiteWire } from '@/lib/workItems/actionLite';
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

  // S3-code-P4: linked actions read from action-lite Work Items on
  // angsana-core-prod (cross-project). Same shape as the read-only
  // detail page; here used by the edit form to render existing-action
  // status pills next to decision/next-step rows.
  let linkedActions: ActionLiteWire[] = [];
  // Fetch campaigns first so we can pass IDs into the cross-project
  // listActionLiteForClient query AND reuse the snapshot below for the
  // edit form's campaign-selector.
  const campaignsSnapshot = await clientRef.collection('campaigns').get();
  if (checkin.generatedWorkItemIds.length > 0) {
    const allActions = await listActionLiteForClient({
      tenantId,
      clientId,
      campaignIds: campaignsSnapshot.docs.map((d) => d.id),
    });
    const expectedRef = `tenants/${tenantId}/clients/${clientId}/checkIns/${checkInId}`;
    linkedActions = allActions.filter((a) => {
      const raw = a as unknown as { source?: { ref?: string } };
      if (raw.source?.ref === expectedRef) return true;
      return checkin.generatedWorkItemIds.includes(a.workItemId);
    });
  }

  // Fetch client name
  const clientDoc = await clientRef.get();
  const clientName = clientDoc.exists
    ? (clientDoc.data()?.name as string) || clientId
    : clientId;

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
