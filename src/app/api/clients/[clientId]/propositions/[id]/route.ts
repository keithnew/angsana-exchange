// =============================================================================
// Angsana Exchange — Proposition Detail API Route (Slice 8 Patch)
//
// PATCH /api/clients/{clientId}/propositions/{id}
// DELETE /api/clients/{clientId}/propositions/{id}
//
// Updated: client-approver can edit own drafts, internal can promote to active.
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
 * PATCH /api/clients/[clientId]/propositions/[id]
 *
 * Internal users: can update any field on any proposition.
 * Client-approver: can edit name, description, suggestedCategory on own drafts only.
 *
 * Special action: { action: 'promote' } — internal only. Sets status to active,
 * clears suggestedCategory if proper category assigned.
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

    // ── Promote action (internal only) ──────────────────────────────────
    if (body.action === 'promote') {
      if (!isInternal(user.role)) {
        return NextResponse.json({ error: 'Forbidden: only internal users can promote propositions' }, { status: 403 });
      }

      const updateData: Record<string, unknown> = {
        status: 'active',
        lastUpdatedBy: user.uid,
        lastUpdatedAt: FieldValue.serverTimestamp(),
      };

      // Clear suggestedCategory if a proper category is assigned
      if (existingData.category && existingData.category.trim()) {
        updateData.suggestedCategory = FieldValue.delete();
      }

      await docRef.update(updateData);
      return NextResponse.json({ success: true, action: 'promoted' });
    }

    // ── Client-approver edit restrictions ────────────────────────────────
    if (user.role === 'client-approver') {
      // Can only edit own drafts
      if (existingData.status !== 'draft') {
        return NextResponse.json({ error: 'Client-approvers can only edit draft propositions' }, { status: 403 });
      }
      if (existingData.createdBy !== user.uid) {
        return NextResponse.json({ error: 'Client-approvers can only edit their own draft propositions' }, { status: 403 });
      }

      // Restrict to allowed fields
      const allowedFields = ['name', 'description', 'suggestedCategory'];
      const attemptedFields = Object.keys(body);
      const forbidden = attemptedFields.filter((f) => !allowedFields.includes(f));
      if (forbidden.length > 0) {
        return NextResponse.json(
          { error: `Client-approvers cannot modify: ${forbidden.join(', ')}` },
          { status: 403 }
        );
      }
    } else if (user.role === 'client-viewer') {
      return NextResponse.json({ error: 'Forbidden: client-viewers cannot update propositions' }, { status: 403 });
    } else if (!isInternal(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Validate fields ─────────────────────────────────────────────────
    if (body.name !== undefined && body.name.length > 80) {
      return NextResponse.json({ error: 'Proposition name must be 80 characters or less' }, { status: 400 });
    }
    if (body.description !== undefined && body.description.length > 280) {
      return NextResponse.json({ error: 'Description must be 280 characters or less' }, { status: 400 });
    }
    if (body.suggestedCategory !== undefined && body.suggestedCategory.length > 280) {
      return NextResponse.json({ error: 'Suggested category must be 280 characters or less' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      lastUpdatedBy: user.uid,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.category !== undefined) updateData.category = body.category;
    if (body.description !== undefined) updateData.description = body.description.trim();
    if (body.status !== undefined) updateData.status = body.status;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.suggestedCategory !== undefined) updateData.suggestedCategory = body.suggestedCategory.trim();

    await docRef.update(updateData);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Proposition PATCH error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[clientId]/propositions/[id]
 * Soft-delete (set status: inactive). Internal users only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; id: string }> }
) {
  const { clientId, id } = await params;
  const user = getUserFromHeaders(request);

  if (!isInternal(user.role)) {
    return NextResponse.json({ error: 'Forbidden: only internal users can delete propositions' }, { status: 403 });
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  try {
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

    await docRef.update({
      status: 'inactive',
      lastUpdatedBy: user.uid,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Proposition DELETE error:', err);
    return NextResponse.json(
      { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
