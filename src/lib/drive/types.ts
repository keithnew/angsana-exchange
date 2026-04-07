// =============================================================================
// Angsana Exchange — Drive Types
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
//
// Type definitions for Drive file/folder items returned by the browse API.
// =============================================================================

/**
 * A single item (file or folder) from a Google Drive folder listing.
 * Returned by the browse endpoint. Never includes direct Drive URLs.
 */
export interface DriveItem {
  /** Google Drive file ID */
  id: string;
  /** File or folder name */
  name: string;
  /** MIME type. Folders: application/vnd.google-apps.folder */
  mimeType: string;
  /** Convenience flag derived from mimeType */
  isFolder: boolean;
  /** File size in bytes. Null for Google Docs/Sheets/folders */
  size: number | null;
  /** ISO 8601 timestamp — last modified */
  modifiedTime: string;
  /** ISO 8601 timestamp — created */
  createdTime: string;
  /** Google-hosted icon URL for the file type */
  iconLink: string | null;
}

/** MIME type constant for Google Drive folders */
export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
