// =============================================================================
// Angsana Exchange — Document Campaign Link API Route
// Slice 7A Step 4, Step 15: Link/unlink a document to campaigns
// Slice 8 Patch Change 7: campaignRef → campaignRefs (multi-tag support)
//
// PATCH /api/clients/{clientId}/documents/{documentId}/campaign
//
// Updates the campaignRefs on a Firestore document registry entry.
// This is a Firestore-only mutation — no Drive API call needed since
// campaign associations are purely a Firestore concern.
//
// Access: internal-admin and internal-user only.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromHeaders, hasClientAccess, isInternal } from '@/lib/api/middleware/user-context';
import { buildCampaignRefsUpdate } from '@/lib/documents/campaignRefs';

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * PATCH /api/clients/{clientId}/documents/{documentId}/campaign
 *
 * Request body (JSON):
 *   - campaignRefs: string[] — campaign IDs to link. Empty array clears all.
 *
 * Backward compat: also accepts legacy { campaignRef: string | null } body.
 *
 * Returns the updated document metadata.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; documentId: string }> }
) {
  const { clientId, documentId } = await params;
  const user = getUserFromHeaders(request);

  // ── Auth: internal roles only ───────────────────────────────────────────
  if (!isInternal(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users can update campaign links', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Parse request body ──────────────────────────────────────────────────
  let body: { campaignRefs?: string[]; campaignRef?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  // ── Normalise input: accept both new (campaignRefs) and legacy (campaignRef) ──
  let campaignIds: string[];

  if ('campaignRefs' in body) {
    // New multi-tag format
    if (!Array.isArray(body.campaignRefs)) {
      return NextResponse.json(
        { error: 'campaignRefs must be an array of campaign ID strings', code: 'INVALID_FIELD' },
        { status: 400 }
      );
    }
    // Validate each entry is a non-empty string
    for (const ref of body.campaignRefs) {
      if (typeof ref !== 'string' || ref.trim() === '') {
        return NextResponse.json(
          { error: 'Each entry in campaignRefs must be a non-empty string', code: 'INVALID_FIELD' },
          { status: 400 }
        );
      }
    }
    campaignIds = body.campaignRefs;
  } else if ('campaignRef' in body) {
    // Legacy single-value format — convert to array
    const legacyRef = body.campaignRef;
    if (legacyRef === null || legacyRef === undefined) {
      campaignIds = [];
    } else if (typeof legacyRef === 'string' && legacyRef.trim() !== '') {
      campaignIds = [legacyRef];
    } else {
      return NextResponse.json(
        { error: 'campaignRef must be a non-empty string or null', code: 'INVALID_FIELD' },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      { error: 'Missing required field: campaignRefs (use [] to unlink all)', code: 'MISSING_FIELD' },
      { status: 400 }
    );
  }

  // ── Load registry entry ─────────────────────────────────────────────────
  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('documents')
    .doc(documentId);

  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    return NextResponse.json(
      { error: 'Document not found in registry', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  const docData = docSnap.data()!;

  if (docData.status !== 'active') {
    return NextResponse.json(
      { error: 'Cannot update campaign link on a deleted document', code: 'DOCUMENT_DELETED' },
      { status: 400 }
    );
  }

  // Previous refs for logging
  const previousRefs: string[] = Array.isArray(docData.campaignRefs)
    ? docData.campaignRefs
    : docData.campaignRef
      ? [docData.campaignRef]
      : [];

  // ── Validate each campaign ID exists ────────────────────────────────────
  const campaignsRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns');

  for (const cid of campaignIds) {
    const campaignDoc = await campaignsRef.doc(cid).get();
    if (!campaignDoc.exists) {
      return NextResponse.json(
        { error: `Campaign "${cid}" not found for this client`, code: 'CAMPAIGN_NOT_FOUND' },
        { status: 404 }
      );
    }
  }

  // ── Firestore update (using helper for backward compat) ─────────────────
  const now = new Date().toISOString();
  const refsPayload = buildCampaignRefsUpdate(campaignIds);

  try {
    await docRef.update({
      ...refsPayload,
      lastModifiedAt: now,
      lastModifiedBy: user.uid,
    });

    console.log(
      `[documents/campaign] Document ${documentId} campaign links: ` +
      `[${previousRefs.join(', ') || '(none)'}] → [${campaignIds.join(', ') || '(none)'}]`
    );
  } catch (err) {
    console.error('[documents/campaign] Firestore update failed:', err);
    return NextResponse.json(
      { error: 'Failed to update campaign link', code: 'FIRESTORE_ERROR' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      documentId,
      name: docData.name,
      previousCampaignRefs: previousRefs,
      campaignRefs: campaignIds,
      // Legacy field for backward compat
      campaignRef: campaignIds.length > 0 ? campaignIds[0] : null,
      lastModifiedAt: now,
      lastModifiedBy: user.uid,
    },
  });
}
