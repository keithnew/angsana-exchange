// =============================================================================
// /api/clients/[clientId]/action-items/[workItemId]
//
// S3-code-P3 — Status transition for action-lite Work Items.
// Replaces the legacy PATCH on /api/clients/[clientId]/actions/[actionId]
// (which today persists `status` directly on the Action doc).
//
// PATCH body: { state: 'open' | 'in-progress' | 'blocked' | 'done' }
//
// Validation lives in the persistence helper
// (`actionLitePersistence.ts::transitionActionLite`); the route handler is
// auth + thin pass-through.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

import {
  getRequestUser,
  hasClientAccess,
  isInternal,
} from '@/lib/auth/requestUser';
import { transitionActionLite } from '@/lib/workItems/actionLitePersistence';
import {
  ACTION_LITE_STATES,
  type ActionLiteState,
} from '@/lib/workItems/actionLite';

interface PatchInput {
  state?: ActionLiteState;
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ clientId: string; workItemId: string }>;
  }
) {
  const { clientId, workItemId } = await params;
  const user = getRequestUser(request);

  // Internal-only — matches the legacy PATCH on actions/[actionId]/route.ts.
  if (!isInternal(user)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users can change Action state' },
      { status: 403 }
    );
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client' },
      { status: 403 }
    );
  }

  let body: PatchInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid or empty request body' },
      { status: 400 }
    );
  }

  const newState = body.state;
  if (!newState || !ACTION_LITE_STATES.includes(newState)) {
    return NextResponse.json(
      {
        error: `Invalid state. Valid: ${ACTION_LITE_STATES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  const result = await transitionActionLite({
    tenantId: user.tenantId,
    workItemId,
    newState,
    actorUid: user.uid,
    actorName: user.name || user.email,
  });

  if (!result.ok) {
    if (result.reason === 'not-found') {
      return NextResponse.json(
        { error: 'Action not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: result.reason },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
