// =============================================================================
// Angsana Exchange — Document Download API Route
// Slice 7A Step 3: File Download & Upload Streaming Routes
// Slice 7A Step 4, Step 16: Registry status guard for managed clients
//
// GET /api/clients/{clientId}/documents/download/{fileId}
//
// Streams a file from Google Drive through Exchange. Handles both binary
// files and Google Workspace exports (Docs→PDF, Sheets→xlsx, Slides→PDF).
// No direct Drive URLs are ever exposed to the caller.
//
// Supports both Shared Drives (driveId) and legacy regular folders (driveFolderId).
//
// Registry guard (Step 4):
//   For managed clients (those with a folderMap), the download route checks
//   the Firestore document registry for the file's status:
//   - If the file is registered and status='deleted', the download is blocked
//   - If the file is registered and status='active', download proceeds
//   - If the file is NOT registered (unregistered Drive file), download proceeds
//     (to avoid breaking access to files not yet imported into the registry)
//
// Access: All authenticated roles with client access (visibility check enforced).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { adminDb } from '@/lib/firebase/admin';
import { downloadDriveFile } from '@/lib/drive/download';
import { isFileWithinRoot } from '@/lib/drive/browse';
import { getUserFromHeaders, hasClientAccess, isInternal, isClientApprover } from '@/lib/api/middleware/user-context';
import type { FolderMap } from '@/types';

export const runtime = 'nodejs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitise a filename for use in Content-Disposition header.
 * Removes characters that break the header (quotes, newlines, backslashes).
 * For non-ASCII filenames, uses RFC 5987 encoding.
 */
function sanitiseFilename(name: string): string {
  // Replace characters that are problematic in Content-Disposition
  const safe = name
    .replace(/[\r\n]/g, '')
    .replace(/"/g, "'")
    .replace(/\\/g, '_');

  // Check if name is ASCII-safe
  const isAscii = /^[\x20-\x7E]+$/.test(safe);

  if (isAscii) {
    return `attachment; filename="${safe}"`;
  }

  // RFC 5987: filename*=UTF-8''encoded_name for non-ASCII
  const encoded = encodeURIComponent(safe).replace(/'/g, '%27');
  return `attachment; filename="${safe.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encoded}`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * GET /api/clients/{clientId}/documents/download/{fileId}
 *
 * Streams a file from the client's Google Drive folder through Exchange.
 * Sets Content-Type, Content-Disposition, and Content-Length headers.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; fileId: string }> }
) {
  const { clientId, fileId } = await params;
  const user = getUserFromHeaders(request);

  // ── Auth: all authenticated users with client access can download ───────
  // Visibility filtering (internal-only vs client-visible) is enforced below
  // via the registry guard for managed clients.

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Read client config to get driveId or driveFolderId ──────────────────
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

  // driveId = Shared Drive (new model), driveFolderId = regular folder (legacy)
  const driveId = configData.driveId as string | undefined;
  const rootId = (driveId || configData.driveFolderId) as string | undefined;
  const isSharedDrive = !!driveId;
  const folderMap = (configData.folderMap || null) as FolderMap | null;
  const isManagedClient = !!folderMap && Object.keys(folderMap).length > 0;

  if (!rootId) {
    return NextResponse.json(
      { error: 'No Drive folder configured for this client', code: 'NO_DRIVE_FOLDER' },
      { status: 404 }
    );
  }

  // ── Registry guard: check document status for managed clients ───────────
  if (isManagedClient) {
    try {
      // Look up by driveFileId — the fileId in the URL IS the Drive file ID
      const registrySnapshot = await adminDb
        .collection('tenants')
        .doc(user.tenantId)
        .collection('clients')
        .doc(clientId)
        .collection('documents')
        .where('driveFileId', '==', fileId)
        .limit(1)
        .get();

      if (!registrySnapshot.empty) {
        const registryDoc = registrySnapshot.docs[0];
        const registryData = registryDoc.data();

        // Block download of soft-deleted documents
        if (registryData.status === 'deleted') {
          return NextResponse.json(
            {
              error: 'This document has been deleted',
              code: 'DOCUMENT_DELETED',
              deletedAt: registryData.deletedAt,
              deletedBy: registryData.deletedBy,
            },
            { status: 410 } // 410 Gone
          );
        }

        // Client user visibility check: ensure the document's visibility
        // allows client access (client-approver and client-viewer)
        if (!isInternal(user.role) && registryData.visibility === 'internal-only') {
          return NextResponse.json(
            { error: 'Forbidden: this document is internal-only', code: 'FORBIDDEN' },
            { status: 403 }
          );
        }
      }
      // If file is NOT in registry (unregistered), allow download to proceed.
      // This avoids breaking access for files uploaded outside Exchange.
    } catch (err) {
      // Registry check failed — log but don't block the download
      console.warn('[documents/download] Registry status check failed (proceeding with download):', err);
    }
  }

  // ── Verify file belongs to client's Drive tree ──────────────────────────
  try {
    const fileInTree = await isFileWithinRoot(fileId, rootId, isSharedDrive);
    if (!fileInTree) {
      return NextResponse.json(
        { error: 'Forbidden: file is not within this client\'s Drive folder', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }
  } catch (err) {
    const driveError = err as { code?: number; message?: string };
    console.error('[documents/download] File validation error:', driveError.message);
    return NextResponse.json(
      { error: 'Drive API error during file validation', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }

  // ── Download / export the file ──────────────────────────────────────────
  try {
    const result = await downloadDriveFile(fileId, isSharedDrive);

    // Determine response headers
    const contentType = result.isExport
      ? result.exportMimeType!
      : result.metadata.mimeType;

    const filename = result.isExport
      ? result.exportFilename!
      : result.metadata.name;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': sanitiseFilename(filename),
    };

    // Content-Length only if known (not available for Google Workspace exports)
    if (!result.isExport && result.metadata.size) {
      headers['Content-Length'] = String(result.metadata.size);
    }

    // Convert Node.js Readable to Web ReadableStream for the response
    const webStream = Readable.toWeb(result.stream) as ReadableStream;

    return new Response(webStream, { headers });
  } catch (err) {
    const driveError = err as { code?: number; message?: string };

    if (driveError.code === 404) {
      return NextResponse.json(
        { error: 'File not found in Drive', code: 'FILE_NOT_FOUND' },
        { status: 404 }
      );
    }

    console.error('[documents/download] Drive API error:', driveError.message);
    return NextResponse.json(
      { error: 'Failed to download file from Google Drive', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }
}
