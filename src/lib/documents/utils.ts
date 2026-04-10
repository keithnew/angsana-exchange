// =============================================================================
// Angsana Exchange — Document Utility Helpers
// Slice 7A Steps 5 & 6: Documents UI
// =============================================================================

import type { UserRole, DocumentFolderItem } from '@/types';

// ─── Google Editor URL Construction ───────────────────────────────────────────

/**
 * Build the Google editor/viewer URL for a Drive file based on its mimeType.
 * Internal users open files directly in Google Workspace editors.
 */
export function getGoogleEditorUrl(driveFileId: string, mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return `https://docs.google.com/document/d/${driveFileId}/edit`;
    case 'application/vnd.google-apps.spreadsheet':
      return `https://docs.google.com/spreadsheets/d/${driveFileId}/edit`;
    case 'application/vnd.google-apps.presentation':
      return `https://docs.google.com/presentation/d/${driveFileId}/edit`;
    default:
      return `https://drive.google.com/file/d/${driveFileId}/view`;
  }
}

// ─── Role Helpers ─────────────────────────────────────────────────────────────

export function isInternalRole(role: UserRole): boolean {
  return role === 'internal-admin' || role === 'internal-user';
}

export function isClientApproverRole(role: UserRole): boolean {
  return role === 'client-approver';
}

// ─── Upload Permission Check ──────────────────────────────────────────────────

/** Folder categories that client-approvers can upload to. */
const CLIENT_APPROVER_UPLOAD_CATEGORIES = [
  'client_material',
  'targeting',
  'tlm_ready',
  'ai_source',
  'general',
];

/**
 * Check whether the user's role permits uploading to a given folder.
 */
export function canUploadToFolder(
  role: UserRole,
  folderCategory: string,
  isContainer: boolean
): boolean {
  // Cannot upload to container folders
  if (isContainer) return false;

  // Internal users can upload to any non-container folder
  if (isInternalRole(role)) return true;

  // Client-approver can upload to specific folders only
  if (role === 'client-approver') {
    return CLIENT_APPROVER_UPLOAD_CATEGORIES.includes(folderCategory);
  }

  // client-viewer cannot upload
  return false;
}

// ─── Folder Tree Helpers ──────────────────────────────────────────────────────

export interface FolderTreeNode {
  folderCategory: string;
  name: string;
  visibility: 'client-visible' | 'internal-only';
  isContainer: boolean;
  sortOrder: number;
  children: FolderTreeNode[];
}

/**
 * Build a folder tree from the flat documentFolders list.
 * Filters by role visibility.
 */
export function buildFolderTree(
  folders: DocumentFolderItem[],
  role: UserRole
): FolderTreeNode[] {
  const isInternal = isInternalRole(role);

  // Filter by active and visibility
  const visible = folders.filter((f) => {
    if (!f.active) return false;
    if (!isInternal && f.visibility === 'internal-only') return false;
    return true;
  });

  // Build parent-child relationships
  const topLevel = visible
    .filter((f) => !f.parentCategory)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return topLevel.map((parent) => ({
    folderCategory: parent.folderCategory,
    name: parent.name,
    visibility: parent.visibility,
    isContainer: parent.isContainer,
    sortOrder: parent.sortOrder,
    children: visible
      .filter((f) => f.parentCategory === parent.folderCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((child) => ({
        folderCategory: child.folderCategory,
        name: child.name,
        visibility: child.visibility,
        isContainer: child.isContainer,
        sortOrder: child.sortOrder,
        children: [],
      })),
  }));
}

// ─── Date Formatting ──────────────────────────────────────────────────────────

/**
 * Format a date as short format: "15 Jan"
 */
export function formatShortDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

/**
 * Build display path for nested folders: "Scripts / Client Approved"
 */
export function getFolderDisplayName(
  folderCategory: string,
  folders: DocumentFolderItem[]
): string {
  const folder = folders.find((f) => f.folderCategory === folderCategory);
  if (!folder) return folderCategory;

  if (folder.parentCategory) {
    const parent = folders.find((f) => f.folderCategory === folder.parentCategory);
    if (parent) {
      return `${parent.name} / ${folder.name}`;
    }
  }

  return folder.name;
}
