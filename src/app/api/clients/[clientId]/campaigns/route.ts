import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { publishEvent } from '@/lib/events/publish';

/**
 * Helper: extract user claims from request headers (set by middleware).
 */
function getUserFromHeaders(request: NextRequest) {
  return {
    uid: request.headers.get('x-user-uid') || '',
    role: request.headers.get('x-user-role') || '',
    tenantId: request.headers.get('x-user-tenant') || 'angsana',
    email: request.headers.get('x-user-email') || '',
    clientId: request.headers.get('x-user-client') || null,
    assignedClients: JSON.parse(request.headers.get('x-assigned-clients') || '[]'),
  };
}

function hasClientAccess(user: ReturnType<typeof getUserFromHeaders>, clientId: string): boolean {
  if (user.clientId) return user.clientId === clientId;
  if (user.assignedClients?.includes('*')) return true;
  return user.assignedClients?.includes(clientId) ?? false;
}

function isInternal(role: string): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

/**
 * POST /api/clients/[clientId]/campaigns
 * Creates a new campaign in draft status.
 * Only internal-user and internal-admin can create.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // Permission check: only internal users can create campaigns
  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden: only internal users can create campaigns' }, { status: 403 });
  }

  // Client access check
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const body = await request.json();

  // Validate required fields
  const requiredFields = ['campaignName', 'campaignSummary', 'serviceType', 'serviceTypeId', 'owner', 'startDate'];
  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 });
    }
  }

  // Validate lengths
  if (body.campaignName.length > 100) {
    return NextResponse.json({ error: 'Campaign name must be 100 characters or less' }, { status: 400 });
  }
  if (body.campaignSummary.length > 280) {
    return NextResponse.json({ error: 'Campaign summary must be 280 characters or less' }, { status: 400 });
  }
  if (body.valueProposition && body.valueProposition.length > 200) {
    return NextResponse.json({ error: 'Value proposition must be 200 characters or less' }, { status: 400 });
  }
  if (body.painPoints && body.painPoints.length > 8) {
    return NextResponse.json({ error: 'Maximum 8 pain points allowed' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const campaignData = {
    campaignName: body.campaignName,
    campaignSummary: body.campaignSummary,
    serviceType: body.serviceType,
    serviceTypeId: body.serviceTypeId,
    owner: body.owner,
    startDate: new Date(body.startDate),
    status: 'draft',
    // Proposition linkage (optional, required for draft→active)
    propositionRefs: body.propositionRefs || [],
    // Targeting (optional)
    targetGeographies: body.targetGeographies || [],
    targetSectors: body.targetSectors || [],
    targetTitles: body.targetTitles || [],
    companySize: body.companySize || '',
    // Messaging (optional)
    valueProposition: body.valueProposition || '',
    painPoints: body.painPoints || [],
    selectedSoWhats: body.selectedSoWhats || [],
    // Lifecycle
    statusHistory: [
      { from: null, to: 'draft', timestamp: now, changedBy: user.email },
    ],
    pauseReason: '',
    createdBy: user.email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const docRef = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .add(campaignData);

  // Per Notification Pattern v0.1 §4.2 + S3-pre-code Decision #7: emit
  // `campaign.added` so any open Work Item with `subject.entityType=campaign`
  // and matching `entityId` triggers a linked-edit notification.
  await publishEvent({
    eventType: 'campaign.added',
    payload: {
      campaignId: docRef.id,
      campaignName: campaignData.campaignName,
      status: campaignData.status,
      serviceType: campaignData.serviceType,
      owner: campaignData.owner,
    },
    tenantId: user.tenantId,
    clientId,
    actorUid: user.uid,
    occurredAt: now,
  });

  return NextResponse.json({ id: docRef.id, success: true }, { status: 201 });
}
