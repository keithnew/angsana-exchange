// =============================================================================
// Angsana Exchange — Drive API Client
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
//
// Lazy-initialises an authenticated Google Drive v3 client using the same
// service account credentials as Firebase Admin SDK. On Cloud Run credentials
// are auto-detected; locally they come from GOOGLE_APPLICATION_CREDENTIALS.
// =============================================================================

import { google, type drive_v3 } from 'googleapis';

let driveClient: drive_v3.Drive | null = null;

/**
 * Returns an authenticated Google Drive v3 API client.
 *
 * Uses GoogleAuth which automatically resolves credentials:
 * - Locally: reads the JSON key file specified by GOOGLE_APPLICATION_CREDENTIALS
 * - Cloud Run: uses the attached service account via metadata server
 *
 * The client is created once and reused on subsequent calls (same lazy-init
 * pattern as the Firebase Admin SDK in lib/firebase/admin.ts).
 */
export function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}
