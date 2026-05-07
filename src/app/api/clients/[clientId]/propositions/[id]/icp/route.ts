// =============================================================================
// Angsana Exchange — Proposition ICP API Route (Slice 8 Patch)
//
// PATCH /api/clients/{clientId}/propositions/{id}/icp
//
// Updates the ICP (Ideal Client Profile) on a proposition.
// Access: internal users and client-approver (on own drafts).
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
 * PATCH /api/clients/[clientId]/propositions/[id]/icp
 *
 * Request body: ICP object (industries, companySizing, titles, seniority,
 * buyingProcess, geographies, exclusions).
 *
 * Internal users: can update ICP on any proposition.
 * Client-approver: can update ICP on own drafts only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; id: string }> }
) {
  const { clientId, id } = await params;
  const user = getUserFromHeaders(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  // Must be internal or client-approver
  if (!isInternal(user.role) && user.role !== 'client-approver') {
    return NextResponse.json(
      { error: 'Forbidden: only internal users and client-approvers can edit ICP' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    const docRef = adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('propositions')
      .doc(id);

    const existing = await docRef.get();
    if (!existing.exists) {
      return NextResponse.json({ error: 'Proposition not found' }, { status: 404 });
    }

    const existingData = existing.data()!;

    // Client-approver: can only edit ICP on own drafts
    if (user.role === 'client-approver') {
      if (existingData.status !== 'draft') {
        return NextResponse.json(
          { error: 'Client-approvers can only edit ICP on draft propositions' },
          { status: 403 }
        );
      }
      if (existingData.createdBy !== user.uid) {
        return NextResponse.json(
          { error: 'Client-approvers can only edit ICP on their own draft propositions' },
          { status: 403 }
        );
      }
    }

    // Build ICP object — validate structure loosely, trust front-end form
    const icp = {
      industries: {
        managedListRefs: Array.isArray(body.industries?.managedListRefs) ? body.industries.managedListRefs : [],
        specifics: typeof body.industries?.specifics === 'string' ? body.industries.specifics.slice(0, 500) : '',
      },
      companySizing: Array.isArray(body.companySizing) ? body.companySizing.slice(0, 10) : [],
      titles: {
        managedListRefs: Array.isArray(body.titles?.managedListRefs) ? body.titles.managedListRefs : [],
        specifics: typeof body.titles?.specifics === 'string' ? body.titles.specifics.slice(0, 500) : '',
      },
      seniority: {
        managedListRefs: Array.isArray(body.seniority?.managedListRefs) ? body.seniority.managedListRefs : [],
        specifics: typeof body.seniority?.specifics === 'string' ? body.seniority.specifics.slice(0, 500) : '',
      },
      buyingProcess: {
        type: typeof body.buyingProcess?.type === 'string' ? body.buyingProcess.type : '',
        notes: typeof body.buyingProcess?.notes === 'string' ? body.buyingProcess.notes.slice(0, 500) : '',
      },
      geographies: {
        managedListRefs: Array.isArray(body.geographies?.managedListRefs) ? body.geographies.managedListRefs : [],
        specifics: typeof body.geographies?.specifics === 'string' ? body.geographies.specifics.slice(0, 500) : '',
      },
      exclusions: Array.isArray(body.exclusions) ? body.exclusions.slice(0, 20) : [],
      lastUpdatedBy: user.uid,
      lastUpdatedAt: new Date().toISOString(),
    };

    await docRef.update({
      icp,
      lastUpdatedBy: user.uid,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });

    // S3-code-P4: legacy actions/ collection retired in P4 deletes;
    // this auto-action path is banked for S6 createActionLite rewire
    // (P3 audit-1 + P4 plan §0 audit-3 banked refinement). Replaced
    // with a log-and-no-op — see propositions/route.ts for the
    // identical pattern + reasoning.
    if (user.role === 'client-approver') {
      console.warn('[S3-P4] legacy auto-action skipped — banked for S6 createActionLite rewire', {
        surface: 'propositions/[id]/icp/route.ts',
        clientId,
        propositionId: id,
        proposedTitle: `Client updated ICP on proposition: ${existingData.name}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Proposition ICP PATCH error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
