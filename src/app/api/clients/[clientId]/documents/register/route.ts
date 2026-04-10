// =============================================================================
// Angsana Exchange — Document Register API Route
// Slice 7A Step 4, Step 12: Register existing Drive file in Firestore registry
//
// POST /api/clients/{clientId}/documents/register
//
// Registers an existing file that already exists in the client's Google Drive
// (e.g., uploaded via Make.com, manually by an AM, or during migration) into
// the Firestore document registry. This brings unregistered Drive files into
// the managed document model so they appear in Firestore-first browse results.
//
// The endpoint:
//   1. Resolves folderId from folderCategory via the client's folderMap
//   2. Validates the file exists in the client's Drive tree
//   3. Fetches file metadata from Drive API
//   4. Resolves visibility from the managed list template
//   5. Creates a DocumentRegistryEntry with source = 'manual_import'
//   6. Returns the created registry entry
//
// Access: internal-admin and internal-user only.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { isFileWithinRoot } from '@/lib/drive/browse';
import { getDriveClientAsSA, getDriveClient } from '@/lib/drive/client';
import { getUserFromHeaders, hasClientAccess, isInternal } from '@/lib/api/middleware/user-context';
import { getCategoryToFolderMap } from '@/lib/drive/visibility';
import { getDocumentFolderTemplate } from '@/lib/drive/folder-template-loader';
import type { FolderMap, FolderVisibility, DocumentFolderItem } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the visibility for a folder using the managed list template.
 * Falls back to 'internal-only' if the category is unknown (safety default).
 */
function resolveVisibility(
  folderCategory: string,
  folderTemplate: DocumentFolderItem[]
): FolderVisibility {
  const match = folderTemplate.find((f) => f.folderCategory === folderCategory);
  return match?.visibility || 'internal-only';
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * POST /api/clients/{clientId}/documents/register
 *
 * Request body (JSON):
 *   - driveFileId: string — the Google Drive file ID to register
 *   - folderCategory: string — the canonical folder key (e.g. "targeting", "working")
 *     The route resolves the actual Drive folderId from the client's folderMap
 *     so callers don't need to know Drive folder IDs.
 *   - campaignRef (optional): string — related campaign ID
 *
 * Returns the created DocumentRegistryEntry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // ── Auth: internal roles only ───────────────────────────────────────────
  if (!isInternal(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users can register documents', code: 'FORBIDDEN' },
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
  let body: { driveFileId?: string; folderCategory?: string; campaignRef?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const { driveFileId, folderCategory, campaignRef } = body;

  if (!driveFileId || typeof driveFileId !== 'string' || driveFileId.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required field: driveFileId', code: 'MISSING_FIELD' },
      { status: 400 }
    );
  }

  if (!folderCategory || typeof folderCategory !== 'string' || folderCategory.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required field: folderCategory', code: 'MISSING_FIELD' },
      { status: 400 }
    );
  }

  // ── Read client config ──────────────────────────────────────────────────
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

  const driveId = configData.driveId as string | undefined;
  const rootId = (driveId || configData.driveFolderId) as string | undefined;
  const isSharedDrive = !!driveId;
  const folderMap = (configData.folderMap || null) as FolderMap | null;

  if (!rootId) {
    return NextResponse.json(
      { error: 'No Drive folder configured for this client', code: 'NO_DRIVE_FOLDER' },
      { status: 404 }
    );
  }

  if (!folderMap) {
    return NextResponse.json(
      { error: 'Client has no folderMap — provision or backfill first', code: 'NO_FOLDER_MAP' },
      { status: 400 }
    );
  }

  // ── Resolve folderId from folderCategory via the folderMap ──────────────
  const categoryMap = getCategoryToFolderMap(folderMap);
  const folderLookup = categoryMap[folderCategory];

  if (!folderLookup) {
    return NextResponse.json(
      {
        error: `Folder category "${folderCategory}" is not in this client's folderMap. ` +
          `Valid categories: ${Object.keys(categoryMap).join(', ')}`,
        code: 'UNKNOWN_FOLDER_CATEGORY',
      },
      { status: 400 }
    );
  }

  const folderId = folderLookup.folderId;

  // ── Check for duplicate registration ────────────────────────────────────
  const existingDocs = await adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('documents')
    .where('driveFileId', '==', driveFileId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (!existingDocs.empty) {
    const existing = existingDocs.docs[0];
    return NextResponse.json(
      {
        error: 'This Drive file is already registered',
        code: 'ALREADY_REGISTERED',
        existingDocumentId: existing.id,
      },
      { status: 409 }
    );
  }

  // ── Verify file exists in client's Drive tree ───────────────────────────
  try {
    const fileExists = await isFileWithinRoot(driveFileId, rootId, isSharedDrive);
    if (!fileExists) {
      return NextResponse.json(
        { error: 'File not found in this client\'s Drive folder tree', code: 'FILE_NOT_FOUND' },
        { status: 404 }
      );
    }
  } catch (err) {
    const driveError = err as { code?: number; message?: string };
    console.error('[documents/register] File validation error:', driveError.message);
    return NextResponse.json(
      { error: 'Drive API error during file validation', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }

  // ── Fetch file metadata from Drive ──────────────────────────────────────
  let fileMetadata: { name: string; mimeType: string; size: number; createdTime: string };
  try {
    const drive = isSharedDrive ? await getDriveClientAsSA() : getDriveClient();
    const response = await drive.files.get({
      fileId: driveFileId,
      fields: 'id, name, mimeType, size, createdTime',
      supportsAllDrives: true,
    });

    const file = response.data;
    fileMetadata = {
      name: file.name || 'unknown',
      mimeType: file.mimeType || 'application/octet-stream',
      size: file.size ? parseInt(file.size, 10) : 0,
      createdTime: file.createdTime || new Date().toISOString(),
    };
  } catch (err) {
    const driveError = err as { code?: number; message?: string };
    if (driveError.code === 404) {
      return NextResponse.json(
        { error: 'Drive file not found — it may have been deleted', code: 'FILE_NOT_FOUND' },
        { status: 404 }
      );
    }
    console.error('[documents/register] Drive metadata fetch error:', driveError.message);
    return NextResponse.json(
      { error: 'Failed to fetch file metadata from Drive', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }

  // ── Resolve visibility ──────────────────────────────────────────────────
  let visibility: FolderVisibility = 'internal-only';
  try {
    const template = await getDocumentFolderTemplate(user.tenantId);
    visibility = resolveVisibility(folderCategory, template);
  } catch (err) {
    console.warn('[documents/register] Could not load folder template, defaulting to internal-only:', err);
  }

  // ── Create Firestore registry entry ─────────────────────────────────────
  const now = new Date().toISOString();
  const registryData = {
    driveFileId,
    name: fileMetadata.name,
    mimeType: fileMetadata.mimeType,
    size: fileMetadata.size,
    folderCategory,
    folderId,
    visibility,
    status: 'active',
    campaignRef: campaignRef || null,
    registrySource: 'manual_import',
    uploadedBy: user.uid,
    uploadedByName: user.email || user.uid,
    uploadedAt: fileMetadata.createdTime,
    lastModifiedAt: now,
    lastModifiedBy: user.uid,
    deletedAt: null,
    deletedBy: null,
    storageBackend: 'gdrive',
  };

  try {
    const docRef = await adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('documents')
      .add(registryData);

    console.log(`[documents/register] Registered Drive file ${driveFileId} as document ${docRef.id}`);

    return NextResponse.json(
      {
        success: true,
        data: {
          documentId: docRef.id,
          ...registryData,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[documents/register] Firestore write error:', err);
    return NextResponse.json(
      { error: 'Failed to create registry entry in Firestore', code: 'FIRESTORE_ERROR' },
      { status: 500 }
    );
  }
}
