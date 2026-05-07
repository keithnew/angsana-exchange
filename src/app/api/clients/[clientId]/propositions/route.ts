// =============================================================================
// Angsana Exchange — Propositions Collection API Route (Slice 8 Patch)
//
// GET  /api/clients/{clientId}/propositions
// POST /api/clients/{clientId}/propositions
//
// Updated: client-approver can create drafts, GET includes icp + suggestedCategory.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

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
 * GET /api/clients/[clientId]/propositions
 * List all propositions for the client. Supports ?status=active filter.
 * Returns icp and suggestedCategory when present.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');

  let query = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('propositions')
    .orderBy('sortOrder', 'asc');

  if (statusFilter) {
    query = query.where('status', '==', statusFilter);
  }

  const snap = await query.get();
  const propositions = snap.docs.map((doc) => {
    const d = doc.data();
    const result: Record<string, unknown> = {
      id: doc.id,
      name: d.name || '',
      category: d.category || '',
      description: d.description || '',
      status: d.status || 'active',
      sortOrder: d.sortOrder ?? 0,
      createdBy: d.createdBy || '',
      createdAt: d.createdAt?.toDate?.()?.toISOString() || '',
      lastUpdatedBy: d.lastUpdatedBy || '',
      lastUpdatedAt: d.lastUpdatedAt?.toDate?.()?.toISOString() || '',
    };
    // Include ICP if present
    if (d.icp) result.icp = d.icp;
    // Include suggestedCategory if present
    if (d.suggestedCategory) result.suggestedCategory = d.suggestedCategory;
    return result;
  });

  return NextResponse.json({ propositions });
}

/**
 * POST /api/clients/[clientId]/propositions
 *
 * Internal users: create with status=active (default) or any status.
 * Client-approver: create with status=draft only. Auto-creates action for AM.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // Must be internal or client-approver
  if (!isInternal(user.role) && user.role !== 'client-approver') {
    return NextResponse.json(
      { error: 'Forbidden: only internal users and client-approvers can create propositions' },
      { status: 403 }
    );
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }
    if (body.name.length > 80) {
      return NextResponse.json({ error: 'Proposition name must be 80 characters or less' }, { status: 400 });
    }
    if (body.description && body.description.length > 280) {
      return NextResponse.json({ error: 'Description must be 280 characters or less' }, { status: 400 });
    }

    const isClientApprover = user.role === 'client-approver';

    // Client-approver: always draft, cannot set category (uses suggestedCategory)
    const propositionData: Record<string, unknown> = {
      name: body.name.trim(),
      category: isClientApprover ? '' : (body.category || ''),
      description: body.description?.trim() || '',
      status: isClientApprover ? 'draft' : (body.status || 'active'),
      sortOrder: body.sortOrder ?? 0,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      lastUpdatedBy: user.uid,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    // Client-approver can suggest a category
    if (isClientApprover && body.suggestedCategory?.trim()) {
      propositionData.suggestedCategory = body.suggestedCategory.trim();
    }

    const collRef = adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('propositions');

    const docRef = await collRef.add(propositionData);

    // S3-code-P4: legacy actions/ collection retired in P4 deletes;
    // this auto-action path is banked for S6 createActionLite rewire
    // (P3 audit-1 + P4 plan §0 audit-3 banked refinement). Replaced with
    // a log-and-no-op: removes the orphan-write footgun (writes to a
    // wiped collection would still succeed on first call but never be
    // read by any surface) and surfaces operator visibility into the
    // banked refinement's trigger condition.
    if (isClientApprover) {
      console.warn('[S3-P4] legacy auto-action skipped — banked for S6 createActionLite rewire', {
        surface: 'propositions/route.ts',
        clientId,
        propositionId: docRef.id,
        proposedTitle: `Client suggested a new proposition: ${body.name.trim()}`,
      });
    }

    return NextResponse.json({ id: docRef.id, success: true }, { status: 201 });
  } catch (err) {
    console.error('Proposition POST error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
