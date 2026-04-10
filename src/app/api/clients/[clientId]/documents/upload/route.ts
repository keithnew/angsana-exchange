// =============================================================================
// Angsana Exchange — Document Upload API Route (Dual-Write)
// Slice 7A Step 3: File Download & Upload Streaming Routes
// Slice 7A Step 4, Step 10: Dual write — Drive + Firestore registry
//
// POST /api/clients/{clientId}/documents/upload
//
// Accepts a multipart form data upload and creates the file in the specified
// folder within the client's Google Drive tree. Files are buffered in memory
// (up to 50MB limit) — acceptable for Cloud Run 512Mi.
//
// Dual-write behaviour (Step 4):
//   - After successful Drive upload, creates a DocumentRegistryEntry in
//     Firestore at tenants/{tenantId}/clients/{clientId}/documents/{docId}
//   - Uses the client's folderMap to resolve folderCategory + visibility
//   - Falls back gracefully if no folderMap exists (legacy clients)
//
// Auto-action for client-approver uploads:
//   - If the uploader is a client-approver, creates an action for internal
//     review: "Review uploaded document: {filename}"
//
// Access: internal-admin, internal-user, and client-approver.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { uploadToDrive } from '@/lib/drive/upload';
import { isFolderWithinRoot } from '@/lib/drive/browse';
import { getUserFromHeaders, hasClientAccess, isInternal, isClientApprover } from '@/lib/api/middleware/user-context';
import { lookupFolderCategory } from '@/lib/drive/visibility';
import { getDocumentFolderTemplate } from '@/lib/drive/folder-template-loader';
import type { FolderMap, FolderVisibility, DocumentFolderItem } from '@/types';

export const runtime = 'nodejs';

/** Maximum file size: 50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

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
 * POST /api/clients/{clientId}/documents/upload
 *
 * Accepts multipart form data with:
 *   - file: the file to upload
 *   - folderId: the Drive folder ID to upload into (must be in client's tree)
 *   - campaignRef (optional): related campaign ID
 *
 * Returns the created file's metadata from Drive + Firestore registry entry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // ── Auth: internal roles + client-approver can upload ───────────────────
  const canUpload = isInternal(user.role) || isClientApprover(user.role);
  if (!canUpload) {
    return NextResponse.json(
      { error: 'Forbidden: only internal users and client-approvers can upload documents', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Parse multipart form data ───────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart form data', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const file = formData.get('file') as File | null;
  const folderId = formData.get('folderId') as string | null;
  const campaignRef = (formData.get('campaignRef') as string | null) || null;

  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: 'No file provided in the upload', code: 'MISSING_FILE' },
      { status: 400 }
    );
  }

  if (!folderId || typeof folderId !== 'string' || folderId.trim() === '') {
    return NextResponse.json(
      { error: 'Missing folderId — specify the target Drive folder', code: 'MISSING_FOLDER_ID' },
      { status: 400 }
    );
  }

  // ── File size check ─────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the 50MB limit`,
        code: 'PAYLOAD_TOO_LARGE',
      },
      { status: 413 }
    );
  }

  // ── Read client config to get driveId or driveFolderId ──────────────────
  const configRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId);

  const configDoc = await configRef.get();

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

  if (!rootId) {
    return NextResponse.json(
      { error: 'No Drive folder configured for this client', code: 'NO_DRIVE_FOLDER' },
      { status: 404 }
    );
  }

  // ── Verify target folder is within client's Drive tree ──────────────────
  try {
    const isValid = await isFolderWithinRoot(folderId, rootId, isSharedDrive);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Forbidden: target folder is not within this client\'s Drive folder', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }
  } catch (err) {
    const driveError = err as { code?: number; message?: string };
    if (driveError.code === 404) {
      return NextResponse.json(
        { error: 'Target folder not found in Drive', code: 'FOLDER_NOT_FOUND' },
        { status: 404 }
      );
    }
    console.error('[documents/upload] Folder validation error:', driveError.message);
    return NextResponse.json(
      { error: 'Drive API error during folder validation', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }

  // ── Upload file to Drive ────────────────────────────────────────────────
  let driveResult;
  try {
    // Buffer the file content (acceptable for ≤50MB on 512Mi Cloud Run)
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';

    driveResult = await uploadToDrive(file.name, mimeType, buffer, folderId, isSharedDrive);
  } catch (err) {
    const driveError = err as { code?: number; message?: string };
    console.error('[documents/upload] Drive API error:', driveError.message);
    return NextResponse.json(
      { error: 'Failed to upload file to Google Drive', code: 'DRIVE_API_ERROR' },
      { status: 500 }
    );
  }

  // ── Dual-write: create Firestore registry entry ─────────────────────────
  let registryEntry = null;

  if (folderMap) {
    // Resolve folderCategory from the folderMap
    const folderInfo = lookupFolderCategory(folderId, folderMap);

    if (folderInfo) {
      // Load the template to resolve visibility
      let visibility: FolderVisibility = 'internal-only';
      try {
        const template = await getDocumentFolderTemplate(user.tenantId);
        visibility = resolveVisibility(folderInfo.folderCategory, template);
      } catch (err) {
        console.warn('[documents/upload] Could not load folder template for visibility resolution, defaulting to internal-only:', err);
      }

      const now = new Date().toISOString();
      const registryData = {
        driveFileId: driveResult.id,
        name: driveResult.name,
        mimeType: driveResult.mimeType,
        size: driveResult.size,
        folderCategory: folderInfo.folderCategory,
        folderId,
        visibility,
        status: 'active',
        campaignRef: campaignRef || null,
        registrySource: 'exchange_upload',
        uploadedBy: user.uid,
        uploadedByName: user.email || user.uid,
        uploadedAt: now,
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

        registryEntry = {
          documentId: docRef.id,
          ...registryData,
        };

        console.log(`[documents/upload] Registry entry created: ${docRef.id} for Drive file ${driveResult.id}`);
      } catch (err) {
        // Registry write failed — Drive upload succeeded. Log but don't fail the request.
        // The file can be registered later via the /register endpoint.
        console.error('[documents/upload] Firestore registry write failed (Drive upload succeeded):', err);
      }
    } else {
      // Folder not in the folderMap — might be a container folder or custom folder
      console.warn(
        `[documents/upload] Folder ${folderId} not found in folderMap — ` +
        `skipping registry write. File can be registered via /register endpoint.`
      );
    }
  } else {
    console.log('[documents/upload] No folderMap on client config — skipping registry write (legacy client)');
  }

  // ── Auto-action for client-approver uploads ─────────────────────────────
  let autoActionId: string | null = null;

  if (isClientApprover(user.role) && registryEntry) {
    try {
      const actionData = {
        title: `Review uploaded document: ${driveResult.name}`,
        description: `${user.email} uploaded "${driveResult.name}" to ${registryEntry.folderCategory}. Please review.`,
        assignedTo: '',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        status: 'open',
        priority: 'medium',
        source: { type: 'document_upload', ref: registryEntry.documentId },
        relatedCampaign: campaignRef || '',
        createdBy: user.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const actionRef = await adminDb
        .collection('tenants')
        .doc(user.tenantId)
        .collection('clients')
        .doc(clientId)
        .collection('actions')
        .add(actionData);

      autoActionId = actionRef.id;
      console.log(`[documents/upload] Auto-action created: ${actionRef.id} for client-approver upload`);
    } catch (err) {
      // Auto-action creation failed — not critical, log and continue
      console.error('[documents/upload] Auto-action creation failed:', err);
    }
  }

  // ── Success response ────────────────────────────────────────────────────
  return NextResponse.json(
    {
      success: true,
      data: {
        id: driveResult.id,
        name: driveResult.name,
        mimeType: driveResult.mimeType,
        size: driveResult.size,
        folderId,
        createdTime: driveResult.createdTime,
        // Registry data (null if no folderMap or write failed)
        registry: registryEntry
          ? {
              documentId: registryEntry.documentId,
              folderCategory: registryEntry.folderCategory,
              visibility: registryEntry.visibility,
              registrySource: registryEntry.registrySource,
            }
          : null,
        // Auto-action (null if not applicable or creation failed)
        autoActionId,
      },
    },
    { status: 201 }
  );
}
