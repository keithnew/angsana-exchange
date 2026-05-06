// =============================================================================
// /api/clients/[clientId]/action-items
//
// S3-code-P3 — new Action UI replacement for the legacy
// /api/clients/[clientId]/actions endpoint.
//
// The legacy endpoint wrote to
//   tenants/{tenantId}/clients/{clientId}/actions
// on the angsana-exchange project (Action document shape per
// `src/types/index.ts:Action`).
//
// This endpoint writes to
//   tenants/{tenantId}/workItems/{workItemId}
// on the **angsana-core-prod** project (action-lite Work Item shape per
// Spec §7.1; see `src/lib/workItems/actionLite.ts`).
//
// Naming:
//   The route segment is `action-items` rather than re-using `actions`
//   because the legacy `actions/` route tree is still live until S3-P4
//   deletes it. Keeping both alive in parallel for the P3 cutover lets
//   the operator hot-redirect: deploy P3 → smoke the new UI → P4 wipes
//   the legacy tree.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

import {
  getRequestUser,
  hasClientAccess,
  isInternal,
  type RequestUser,
} from '@/lib/auth/requestUser';
import {
  buildCreatePayload,
  type ActionLitePriority,
  type ActionLiteRaisedBy,
} from '@/lib/workItems/actionLite';
import {
  createActionLite,
  listActionLiteForClient,
} from '@/lib/workItems/actionLitePersistence';
import { deriveAudienceClass } from '@/lib/mentions/audienceClass';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Project a RequestUser to the `raisedBy` shape action-lite expects.
 * Decision #11's audience-class table converts to the `raisedByRoles`
 * registry value:
 *   - internal-* → 'am' (the v0.1 default for internal authors —
 *     finer-grained mapping is banked alongside the user-directory
 *     normalisation #18; v0.1 picks one acceptable value and notes it).
 *   - client-* → 'client'.
 *   - anything unknown → 'system' (defensive).
 *
 * Banked: when S5's user-directory normalisation lands, this mapping
 * tightens to the platform-spec roles (`am | ad | researcher`).
 */
function raisedByForUser(user: RequestUser): ActionLiteRaisedBy {
  const cls = deriveAudienceClass(user.role);
  let role: ActionLiteRaisedBy['role'];
  if (cls === 'client') role = 'client';
  else if (user.role === 'internal-admin' || user.role === 'internal-user')
    role = 'am';
  else role = 'system';
  return { userId: user.email || user.uid, tenantId: user.tenantId, role };
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client' },
      { status: 403 }
    );
  }

  // Resolve the client's campaign IDs so the listing query can union the
  // client-subject and campaign-subject result sets. Same shape as the
  // legacy `actions/page.tsx` did for campaign-name lookup.
  const campaignsSnap = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaignIds = campaignsSnap.docs.map((d) => d.id);

  const items = await listActionLiteForClient({
    tenantId: user.tenantId,
    clientId,
    campaignIds,
  });

  return NextResponse.json({ items });
}

// ─── POST ───────────────────────────────────────────────────────────────────

interface CreateInput {
  title?: string;
  body?: string;
  /** Free-text email/identity (legacy `assignedTo`). */
  assignedTo?: string | null;
  /** ISO date string from `<input type="date">`. */
  deadline?: string | null;
  priority?: ActionLitePriority;
  relatedCampaign?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getRequestUser(request);

  // Permission gate matches legacy `actions/route.ts` — internal users +
  // client-approver. Banked: S5 may tighten this when client-approver
  // surfaces (proposition / wishlist auto-gen routes) move to a
  // dedicated workItemsApi POST shape.
  const canCreate = isInternal(user) || user.role === 'client-approver';
  if (!canCreate) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client' },
      { status: 403 }
    );
  }

  let body: CreateInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid or empty request body' },
      { status: 400 }
    );
  }

  if (!body.title || !body.title.trim()) {
    return NextResponse.json(
      { error: 'Missing required field: title' },
      { status: 400 }
    );
  }

  let payload;
  try {
    payload = buildCreatePayload({
      tenantId: user.tenantId,
      clientId,
      title: body.title,
      body: body.body ?? '',
      assignedTo: body.assignedTo ?? null,
      deadline: body.deadline ?? null,
      priority: body.priority ?? 'medium',
      relatedCampaign: body.relatedCampaign ?? null,
      raisedBy: raisedByForUser(user),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }

  const { workItemId } = await createActionLite(payload);

  return NextResponse.json({ workItemId, success: true }, { status: 201 });
}
