// =============================================================================
// /api/clients/[clientId]/workItems/[workItemId]/comments
//
// POST — append a comment to the activity log of a Work Item.
//        Body: { body: string, audience?: 'shared' | 'internal' }
//        Default audience matches the Work Item's audience. Audience on the
//        comment is informational (the spec doesn't filter individual log
//        entries by audience for this slice — visibility is governed by
//        the parent Work Item's audience).
//
// Emits workItem.commented per spec §5.2 + v0.2 footer.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getRequestUser,
  hasClientAccess,
  isInternal,
  toActor,
} from '@/lib/auth/requestUser';
import { publishEvent } from '@/lib/events/publish';
import {
  type ActivityLogEntry,
  type WorkItemAudience,
} from '@/types/workItem';

const VALID_AUDIENCES: WorkItemAudience[] = ['internal', 'shared', 'client'];
const COMMENT_MAX_LEN = 2000;

interface Ctx {
  params: Promise<{ clientId: string; workItemId: string }>;
}

interface CommentBody {
  body: string;
  audience?: WorkItemAudience;
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { clientId, workItemId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  let payload: CommentBody;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  if (!payload.body || !payload.body.trim()) {
    return NextResponse.json({ error: 'comment body is required.' }, { status: 400 });
  }
  if (payload.body.length > COMMENT_MAX_LEN) {
    return NextResponse.json(
      { error: `comment body must be ≤${COMMENT_MAX_LEN} chars.` },
      { status: 400 }
    );
  }

  const ref = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('workItems')
    .doc(workItemId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }
  const before = snap.data() as Record<string, unknown>;

  // Audience gate: client users cannot comment on internal items.
  if (!isInternal(user) && before.audience === 'internal') {
    return NextResponse.json({ error: 'Work Item not found' }, { status: 404 });
  }

  const audience = payload.audience ?? (before.audience as WorkItemAudience) ?? 'shared';
  if (!VALID_AUDIENCES.includes(audience)) {
    return NextResponse.json({ error: 'Invalid audience.' }, { status: 400 });
  }
  // Client users can only comment as 'shared' (or 'client'); they cannot
  // post internal-audience comments.
  if (!isInternal(user) && audience === 'internal') {
    return NextResponse.json(
      { error: 'Forbidden: client users may not post internal-audience comments.' },
      { status: 403 }
    );
  }

  const actor = toActor(user);
  const now = Timestamp.now();

  const activity: ActivityLogEntry = {
    type: 'commented',
    by: actor,
    at: now,
    body: payload.body.trim(),
    audience,
  };

  await ref.update({
    updatedAt: FieldValue.serverTimestamp(),
    activityLog: FieldValue.arrayUnion(activity),
  });

  await publishEvent({
    eventType: 'workItem.commented',
    payload: {
      workItemId,
      audience,
      // Don't ship the comment body in the event payload — it could contain
      // PII. Consumers can pull it from the activity log if needed.
    },
    tenantId: user.tenantId,
    clientId,
    actorUid: user.uid,
    occurredAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
