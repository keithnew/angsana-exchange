// =============================================================================
// Angsana Exchange — Drive Browse
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
//
// Lists folder contents via the Drive API. Returns structured DriveItem[]
// with no direct Drive URLs (webViewLink is intentionally excluded).
// =============================================================================

import { getDriveClient } from './client';
import { DRIVE_FOLDER_MIME_TYPE, type DriveItem } from './types';

/**
 * List the contents of a Google Drive folder by ID.
 *
 * Returns files and subfolders (excluding trashed items), sorted with
 * folders first then alphabetical by name.
 *
 * @param folderId - The Google Drive folder ID to list
 * @returns Array of DriveItem objects (no direct Drive URLs)
 * @throws Error if the Drive API call fails (caller should handle)
 */
export async function listFolderContents(folderId: string): Promise<DriveItem[]> {
  const drive = getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime, createdTime, iconLink, webViewLink)',
    orderBy: 'folder,name',
    pageSize: 100,
  });

  const files = response.data.files || [];

  // Map to DriveItem — deliberately exclude webViewLink from output.
  // Exchange wraps Drive completely; clients never see raw Drive URLs.
  return files.map((file): DriveItem => ({
    id: file.id || '',
    name: file.name || '',
    mimeType: file.mimeType || '',
    isFolder: file.mimeType === DRIVE_FOLDER_MIME_TYPE,
    size: file.size ? parseInt(file.size, 10) : null,
    modifiedTime: file.modifiedTime || '',
    createdTime: file.createdTime || '',
    iconLink: file.iconLink || null,
  }));
}

/**
 * Verify that a target folder is within a client's folder tree using a
 * top-down breadth-first search from the root.
 *
 * Why top-down instead of walking up via files.get('parents')?
 * The SA has inherited access (shared on the root folder, not on each child).
 * Drive API doesn't return the `parents` field for files accessed via
 * inherited permissions. So we walk DOWN from the root using files.list
 * (which works with inherited access) and check if the target folder
 * appears anywhere in the tree.
 *
 * Max depth: 5 levels (client folder trees are shallow: 2–3 levels typical).
 * Handles folders created by anyone (Make.com, AMs manually, Exchange).
 *
 * @param targetFolderId - The folder the caller wants to browse
 * @param rootFolderId - The client's root driveFolderId from config
 * @returns true if targetFolderId is within rootFolderId's tree
 */
export async function isFolderWithinRoot(
  targetFolderId: string,
  rootFolderId: string
): Promise<boolean> {
  // If they're the same, it's the root — always valid
  if (targetFolderId === rootFolderId) return true;

  const drive = getDriveClient();

  // BFS: start with the root's direct children, expand level by level
  let currentLevel = [rootFolderId];

  for (let depth = 0; depth < 5; depth++) {
    if (currentLevel.length === 0) break;

    const nextLevel: string[] = [];

    // Check each folder at this level for child folders
    for (const parentId of currentLevel) {
      const response = await drive.files.list({
        q: `'${parentId}' in parents and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`,
        fields: 'files(id)',
        pageSize: 100,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const folders = response.data.files || [];

      // Check if the target folder is among the children at this level
      for (const folder of folders) {
        if (folder.id === targetFolderId) {
          console.log(`[drive/browse] isFolderWithinRoot: found ${targetFolderId} at depth ${depth + 1} under ${parentId}`);
          return true;
        }
        // Queue this folder for next-level search
        if (folder.id) {
          nextLevel.push(folder.id);
        }
      }
    }

    currentLevel = nextLevel;
  }

  console.log(`[drive/browse] isFolderWithinRoot: ${targetFolderId} not found in tree rooted at ${rootFolderId}`);
  return false;
}
