import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { CheckInDetailClient } from './CheckInDetailClient';
import type { CheckIn } from '@/types';
import { listActionLiteForClient } from '@/lib/workItems/actionLitePersistence';
import type { ActionLiteWire } from '@/lib/workItems/actionLite';
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

  // S3-code-P4: linked actions read from action-lite Work Items on
  // angsana-core-prod (cross-project) instead of the legacy `actions/`
  // collection. Filter by `source.ref` matching the canonical check-in
  // path (the auto-gen path writes
  //   source: { type: 'check-in', ref: 'tenants/.../checkIns/<id>' }
  // ). Pre-P4 generated Work Items carry the same shape; pre-P3 docs
  // had no source field — those were on the legacy collection and are
  // gone post `--delete-old`.
  let linkedActions: ActionLiteWire[] = [];
  if (checkin.generatedWorkItemIds.length > 0) {
    // Need campaign IDs for the campaign-subject branch of the union.
    const campaignSnap = await clientRef.collection('campaigns').get();
    const allActions = await listActionLiteForClient({
      tenantId,
      clientId,
      campaignIds: campaignSnap.docs.map((d) => d.id),
    });
    const expectedRef = `tenants/${tenantId}/clients/${clientId}/checkIns/${checkInId}`;
    linkedActions = allActions.filter((a) => {
      // Defensive: source.ref exact match OR — for forward-compat with
      // any future shape change — workItemId membership in the check-in
      // doc's `generatedWorkItemIds` crumb.
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
