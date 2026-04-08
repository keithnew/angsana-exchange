// =============================================================================
// Angsana Exchange — Shared Drive Provisioning
// Slice 7A Step 2/3 Revision: Shared Drive Model
//
// Creates a Google Shared Drive for a client, adds the SA as a Content
// Manager, and creates the canonical folder tree inside the Shared Drive.
//
// The Shared Drive is created via domain-wide delegation (impersonated client)
// because drives.create requires a Workspace user context. Once the SA is
// added as Content Manager, all subsequent operations (folder creation,
// browse, upload, download) use the regular non-impersonated SA client.
//
// The folder structure is driven by CANONICAL_FOLDER_TEMPLATE — the function
// does not hard-code any folder names.
// =============================================================================

import { getDriveClient, getDriveClientWithImpersonation, getSAEmail } from './client';
import { DRIVE_FOLDER_MIME_TYPE } from './types';
import {
  CANONICAL_FOLDER_TEMPLATE,
  type FolderTemplateEntry,
} from './folder-template';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single folder created during provisioning. */
export interface ProvisionedFolder {
  name: string;
  folderId: string;
  parentId: string;
  visibility: 'client-visible' | 'internal-only';
}

/** Result of a successful Shared Drive provisioning operation. */
export interface ProvisionResult {
  /** The Shared Drive ID — stored as driveId on the client config */
  sharedDriveId: string;
  /** The Shared Drive display name */
  sharedDriveName: string;
  /** All folders created inside the Shared Drive */
  folders: ProvisionedFolder[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Create a single folder inside a Shared Drive.
 *
 * Uses the regular (non-impersonated) Drive client — the SA is already a
 * Content Manager on the Shared Drive at this point.
 *
 * @param name - Folder display name
 * @param parentId - Parent folder or Shared Drive ID
 * @returns The newly created folder's Drive ID
 */
async function createFolderInSharedDrive(
  name: string,
  parentId: string
): Promise<string> {
  const drive = getDriveClient();

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
}

/**
 * Recursively create folders from a template entry and its children.
 *
 * @param entries - Template entries to create
 * @param parentId - The Drive ID of the parent folder or Shared Drive
 * @param results - Accumulator array for created folder records
 */
async function createFoldersFromTemplate(
  entries: FolderTemplateEntry[],
  parentId: string,
  results: ProvisionedFolder[]
): Promise<void> {
  for (const entry of entries) {
    const folderId = await createFolderInSharedDrive(entry.name, parentId);

    results.push({
      name: entry.name,
      folderId,
      parentId,
      visibility: entry.visibility,
    });

    // Recurse into children (e.g., Scripts → Client Approved, Internal Working)
    if (entry.children && entry.children.length > 0) {
      await createFoldersFromTemplate(entry.children, folderId, results);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Provision a Google Shared Drive and canonical folder tree for a client.
 *
 * Steps:
 *   1. Create a Shared Drive named "{clientName} (Client)" via the
 *      impersonated client (domain-wide delegation).
 *   2. Add the SA as a Content Manager (organizer) on the Shared Drive
 *      so it can operate without impersonation going forward.
 *   3. Create the canonical folder tree inside the Shared Drive using
 *      the regular (non-impersonated) SA client.
 *
 * Idempotency: The requestId on drives.create is deterministic based on
 * clientId. If the same clientId is provisioned twice, Google returns the
 * existing Shared Drive instead of creating a duplicate.
 *
 * @param clientId - The client's Firestore document ID (used for idempotency key)
 * @param clientName - The client's display name (used in Shared Drive name)
 * @returns ProvisionResult with sharedDriveId and all created folder details
 * @throws Error if any Drive API call fails
 */
export async function provisionClientFolders(
  clientId: string,
  clientName: string
): Promise<ProvisionResult> {
  // ── 1. Create the Shared Drive via impersonated client ──────────────────
  const impersonatedDrive = await getDriveClientWithImpersonation();
  const sharedDriveName = `${clientName} (Client)`;

  const sharedDriveResponse = await impersonatedDrive.drives.create({
    requestId: `exchange-${clientId}`, // deterministic idempotency key
    requestBody: {
      name: sharedDriveName,
    },
  });

  const sharedDriveId = sharedDriveResponse.data.id;
  if (!sharedDriveId) {
    throw new Error('Drive API returned no ID when creating Shared Drive');
  }

  // ── 2. Add SA as Content Manager (organizer) ────────────────────────────
  // This allows the SA to operate without impersonation for all subsequent
  // operations (browse, upload, download, folder creation).
  const saEmail = await getSAEmail();

  await impersonatedDrive.permissions.create({
    fileId: sharedDriveId,
    supportsAllDrives: true,
    requestBody: {
      type: 'user',
      role: 'organizer', // Content Manager = organizer in the API
      emailAddress: saEmail,
    },
  });

  // ── 3. Create canonical folder tree using regular SA client ─────────────
  // The SA is now a Content Manager, so no impersonation needed.
  const folders: ProvisionedFolder[] = [];
  await createFoldersFromTemplate(CANONICAL_FOLDER_TEMPLATE, sharedDriveId, folders);

  return {
    sharedDriveId,
    sharedDriveName,
    folders,
  };
}
