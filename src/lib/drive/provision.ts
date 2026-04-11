// =============================================================================
// Angsana Exchange — Shared Drive Provisioning (State Machine)
// Slice 7A Step 2/3 Revision: Shared Drive Model
// Slice 7A Step 4: Reads folder template from Firestore managed list
//
// State machine with early persistence and retry:
//
//   State A — Create Shared Drive (via impersonated client)
//   State B — Add SA as Content Manager
//   State C — Persist driveId to Firestore IMMEDIATELY (before folder creation)
//   State D — Create folder tree with retry (handles propagation delay)
//   State E — Recovery: resume folder creation if driveId exists but folders pending
//
// The folder structure is driven by the Document Folders managed list in
// Firestore (tenants/{tenantId}/managedLists/documentFolders).
// =============================================================================

import { getDriveClientAsSA, getDriveClientWithImpersonation, getSAEmail } from './client';
import { DRIVE_FOLDER_MIME_TYPE } from './types';
import type { DocumentFolderItem, FolderMapEntry } from '@/types';
import { logger, SVC_DRIVE_PROVISION } from '@/lib/logging';
import { withRetry, isDrivePropagationError } from '@/lib/retry';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single folder created during provisioning. */
export interface ProvisionedFolder {
  name: string;
  folderId: string;
  parentId: string;
  visibility: 'client-visible' | 'internal-only';
}

/** Result of States A+B: Shared Drive created, SA added. */
export interface SharedDriveCreationResult {
  sharedDriveId: string;
  sharedDriveName: string;
}

/** Result of State D: folder tree created, folderMap built. */
export interface FolderCreationResult {
  folders: ProvisionedFolder[];
  folderMap: Record<string, FolderMapEntry>;
}

/** Full provisioning result (all states complete). */
export interface ProvisionResult {
  sharedDriveId: string;
  sharedDriveName: string;
  folders: ProvisionedFolder[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Create a single folder inside a Shared Drive, with retry for propagation delays.
 * Uses the withRetry utility with Drive-specific propagation error classification.
 */
async function createFolderWithRetry(
  name: string,
  parentId: string
): Promise<string> {
  const drive = await getDriveClientAsSA();

  return withRetry(
    async () => {
      const response = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name,
          mimeType: DRIVE_FOLDER_MIME_TYPE,
          parents: [parentId],
        },
        fields: 'id',
      });

      const folderId = response.data.id;
      if (!folderId) {
        throw new Error(`Drive API returned no ID when creating folder "${name}"`);
      }
      return folderId;
    },
    {
      maxAttempts: 5,
      initialDelayMs: 2000,
      backoffMultiplier: 1.5,
      maxDelayMs: 8000,
      retryableErrors: isDrivePropagationError,
      service: 'driveProvisioning',
      operation: `createFolder("${name}")`,
    },
  );
}

/**
 * Create folders from a flat DocumentFolderItem[] list, respecting parent/child
 * relationships via parentCategory. Builds both the ProvisionedFolder[] list
 * and the folderMap (keyed by Drive folder ID).
 *
 * Container folders (isContainer: true) are created in Drive for structure but
 * are NOT included in the folderMap (files cannot be placed in containers).
 */
async function createFoldersFromManagedList(
  items: DocumentFolderItem[],
  sharedDriveId: string,
  results: ProvisionedFolder[],
  folderMap: Record<string, FolderMapEntry>
): Promise<void> {
  // Map folderCategory → created Drive folder ID (for parent lookups)
  const categoryToFolderId: Record<string, string> = {};

  // Process root-level folders first, then children
  const rootItems = items.filter((i) => !i.parentCategory);
  const childItems = items.filter((i) => i.parentCategory);

  // Create root-level folders
  for (const item of rootItems) {
    const folderId = await createFolderWithRetry(item.name, sharedDriveId);
    categoryToFolderId[item.folderCategory] = folderId;

    results.push({
      name: item.name,
      folderId,
      parentId: sharedDriveId,
      visibility: item.isContainer ? 'client-visible' : item.visibility,
    });

    // Only non-container folders go in the folderMap
    if (!item.isContainer) {
      folderMap[folderId] = {
        folderCategory: item.folderCategory,
        name: item.name,
      };
    }
  }

  // Create child folders (e.g., Scripts → Client Approved, Internal Working)
  for (const item of childItems) {
    const parentFolderId = categoryToFolderId[item.parentCategory!];
    if (!parentFolderId) {
      logger.error(SVC_DRIVE_PROVISION, 'createFolderTree',
        `Cannot create folder "${item.name}" — parent category "${item.parentCategory}" not found. Skipping.`,
        { folderName: item.name, parentCategory: item.parentCategory });
      continue;
    }

    const folderId = await createFolderWithRetry(item.name, parentFolderId);
    categoryToFolderId[item.folderCategory] = folderId;

    results.push({
      name: item.name,
      folderId,
      parentId: parentFolderId,
      visibility: item.isContainer ? 'client-visible' : item.visibility,
    });

    // Only non-container folders go in the folderMap
    if (!item.isContainer) {
      folderMap[folderId] = {
        folderCategory: item.folderCategory,
        name: item.name,
      };
    }
  }
}

// ─── Public API: State Machine Steps ──────────────────────────────────────────

/**
 * States A + B: Create Shared Drive and add SA as Content Manager.
 *
 * After this function returns, the caller MUST persist the driveId to
 * Firestore (State C) before proceeding to folder creation.
 *
 * @param clientId - Client Firestore doc ID (used in requestId)
 * @param clientName - Client display name (used in Shared Drive name)
 * @returns SharedDriveCreationResult with the new driveId
 */
export async function createSharedDrive(
  clientId: string,
  clientName: string
): Promise<SharedDriveCreationResult> {
  // ── State A: Create the Shared Drive via impersonated client ────────────
  const impersonatedDrive = await getDriveClientWithImpersonation();
  const sharedDriveName = `${clientName} (Client)`;

  logger.info(SVC_DRIVE_PROVISION, 'createSharedDrive', `State A: Creating Shared Drive "${sharedDriveName}"`, { clientId, sharedDriveName });

  const sharedDriveResponse = await impersonatedDrive.drives.create({
    requestId: `exchange-${clientId}-${Date.now()}`,
    requestBody: {
      name: sharedDriveName,
    },
  });

  const sharedDriveId = sharedDriveResponse.data.id;
  if (!sharedDriveId) {
    throw new Error('Drive API returned no ID when creating Shared Drive');
  }

  logger.info(SVC_DRIVE_PROVISION, 'createSharedDrive', `State A complete: driveId=${sharedDriveId}`, { clientId, sharedDriveId });

  // ── State B: Add SA as Content Manager (organizer) ──────────────────────
  const saEmail = await getSAEmail();

  logger.info(SVC_DRIVE_PROVISION, 'addSAMember', `State B: Adding SA ${saEmail} as Content Manager`, { sharedDriveId, saEmail });

  await impersonatedDrive.permissions.create({
    fileId: sharedDriveId,
    supportsAllDrives: true,
    requestBody: {
      type: 'user',
      role: 'organizer', // Content Manager = organizer in the API
      emailAddress: saEmail,
    },
  });

  logger.info(SVC_DRIVE_PROVISION, 'addSAMember', 'State B complete: SA added as Content Manager', { sharedDriveId });

  return { sharedDriveId, sharedDriveName };
}

/**
 * State D: Create the canonical folder tree inside an existing Shared Drive.
 *
 * Handles permission propagation delays with retry logic.
 * The SA must already be a Content Manager on the Shared Drive.
 *
 * @param sharedDriveId - The Shared Drive to create folders in
 * @param folderTemplate - Active folder items from the Document Folders managed list
 * @returns FolderCreationResult with all created folders and folderMap
 */
export async function createFolderTree(
  sharedDriveId: string,
  folderTemplate: DocumentFolderItem[]
): Promise<FolderCreationResult> {
  logger.info(SVC_DRIVE_PROVISION, 'createFolderTree', `State D: Creating folder tree in drive ${sharedDriveId}`, { sharedDriveId, templateSize: folderTemplate.length });

  // ── Diagnostic: verify SA can see the Shared Drive before creating folders ──
  const drive = await getDriveClientAsSA();
  const saEmail = await getSAEmail();
  logger.debug(SVC_DRIVE_PROVISION, 'createFolderTree', `Diagnostic: SA identity for folder ops: ${saEmail}`, { saEmail });

  try {
    const driveInfo = await drive.drives.get({
      driveId: sharedDriveId,
      fields: 'id,name',
    });
    logger.debug(SVC_DRIVE_PROVISION, 'createFolderTree', `Diagnostic: drives.get OK — name="${driveInfo.data.name}"`, { driveId: driveInfo.data.id });
  } catch (diagErr) {
    const err = diagErr as { code?: number; message?: string };
    logger.error(SVC_DRIVE_PROVISION, 'createFolderTree',
      `SA ${saEmail} cannot see Shared Drive — drives.get FAILED`, { code: err.code, saEmail, sharedDriveId });
    throw new Error(
      `SA ${saEmail} cannot access Shared Drive ${sharedDriveId} via drives.get. ` +
      `The SA may not be a member, or there is an identity mismatch. Error: ${err.message}`
    );
  }

  try {
    const listing = await drive.files.list({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'drive',
      driveId: sharedDriveId,
      q: 'trashed = false',
      fields: 'files(id,name,parents)',
    });
    logger.debug(SVC_DRIVE_PROVISION, 'createFolderTree', `Diagnostic: files.list OK — ${listing.data.files?.length || 0} existing items`, { sharedDriveId });
  } catch (diagErr) {
    const err = diagErr as { code?: number; message?: string };
    logger.warn(SVC_DRIVE_PROVISION, 'createFolderTree', `Diagnostic: files.list FAILED — code=${err.code}`, { code: err.code, sharedDriveId });
    // Don't fail here — the drives.get passed, so folder creation may still work
  }

  const folders: ProvisionedFolder[] = [];
  const folderMap: Record<string, FolderMapEntry> = {};
  await createFoldersFromManagedList(folderTemplate, sharedDriveId, folders, folderMap);

  logger.info(SVC_DRIVE_PROVISION, 'createFolderTree',
    `State D complete: ${folders.length} folders created, ${Object.keys(folderMap).length} entries in folderMap`,
    { sharedDriveId, folderCount: folders.length, folderMapSize: Object.keys(folderMap).length });

  return { folders, folderMap };
}
