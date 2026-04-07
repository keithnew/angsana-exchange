// =============================================================================
// Angsana Exchange — Document Browse API Route
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
//
// GET /api/clients/{clientId}/documents/browse[?folderId={subfolderId}]
//
// Lists the contents of a client's Google Drive folder. Internal roles only
// for this step. Client roles return 403 (opened in a later step with
// visibility filtering).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { listFolderContents, isFolderWithinRoot } from '@/lib/drive/browse';

/**
 * Extract user claims from request headers (set by middleware).
 * Same pattern used across all /api/clients/{clientId}/* routes.
 */
function getUserFromHeaders(request: NextRequest) {
  return {
    uid: request.headers.get('x-user-uid') || '',
    role: request.headers.get('x-user-role') || '',
    tenantId: request.headers.get('x-user-tenant') || 'angsana',
    email: request.headers.get('x-user-email') || '',
    clientId: request.headers.get('x-user-client') || null,
    assignedClients: JSON.parse(request.headers.get('x-assigned-clients') || '[]') as string[],
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
 * GET /api/clients/{clientId}/documents/browse
 *
 * Query params:
 *   folderId (optional) — browse a specific subfolder instead of root
 *
 * Returns the folder contents as a structured array. No Drive URLs are
 * exposed in the response (Exchange wraps Drive completely).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // ── Auth: internal roles only for this step ─────────────────────────────
  if (!isInternal(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users can browse documents in this step', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Client access check ─────────────────────────────────────────────────
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Read client config to get driveFolderId ─────────────────────────────
  const configDoc = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  if (!configDoc.exists) {
    return NextResponse.json(
      { error: 'Client not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  const configData = configDoc.data()!;
  const driveFolderId = configData.driveFolderId as string | undefined;

  if (!driveFolderId) {
    return NextResponse.json(
      { error: 'No Drive folder configured for this client', code: 'NO_DRIVE_FOLDER' },
      { status: 404 }
    );
  }

  // ── Determine target folder ─────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const requestedFolderId = searchParams.get('folderId');
  const targetFolderId = requestedFolderId || driveFolderId;

  console.log(`[documents/browse] clientId=${clientId} driveFolderId="${driveFolderId}" requestedFolderId="${requestedFolderId}" targetFolderId="${targetFolderId}"`);

  // ── Subfolder security: verify folder is within client's tree ───────────
  if (requestedFolderId && requestedFolderId !== driveFolderId) {
    try {
      const isValid = await isFolderWithinRoot(requestedFolderId, driveFolderId);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Forbidden: folder is not within this client\'s Drive folder', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }
    } catch (err) {
      // If the folder doesn't exist or SA can't access it, treat as not found
      const driveError = err as { code?: number; message?: string };
      if (driveError.code === 404) {
        return NextResponse.json(
          { error: 'Folder not found or access denied', code: 'FOLDER_NOT_FOUND' },
          { status: 404 }
        );
      }
      console.error('[documents/browse] Parent-chain validation error:', driveError.message);
      return NextResponse.json(
        { error: 'Drive API error during folder validation', code: 'DRIVE_API_ERROR' },
        { status: 500 }
      );
    }
  }

  // ── List folder contents ────────────────────────────────────────────────
  try {
    const items = await listFolderContents(targetFolderId);

    return NextResponse.json({
      success: true,
      data: {
        folderId: targetFolderId,
        items,
        count: items.length,
      },
    });
  } catch (err) {
    const driveError = err as { code?: number; message?: string };

    if (driveError.code === 404) {
      return NextResponse.json(
        { error: 'Drive folder not found — folder may have been deleted or SA lost access', code: 'FOLDER_NOT_FOUND' },
        { status: 404 }
      );
    }

    console.error('[documents/browse] Drive API error:', driveError.message);
    return NextResponse.json(
      { error: 'Failed to list folder contents from Google Drive', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }
}
