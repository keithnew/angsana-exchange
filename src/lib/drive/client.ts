// =============================================================================
// Angsana Exchange — Drive API Client
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
//
// Provides two Drive v3 clients:
//   getDriveClient()                        — SA acting as itself (Content Manager)
//   getDriveClientWithImpersonation()       — SA impersonating a Workspace user
//
// Credential loading strategy (for impersonation + SA email):
//   1. GOOGLE_APPLICATION_CREDENTIALS file path (local dev)
//   2. Secret Manager: fetch `firebase-admin-sa-key` secret (Cloud Run)
//
// The regular getDriveClient() uses GoogleAuth (ADC) and never needs the
// key file — it works with both GOOGLE_APPLICATION_CREDENTIALS and the
// Cloud Run metadata server automatically.
//
// Impersonation is ONLY needed for drives.create (creating Shared Drives).
// All other operations (browse, upload, download, folder creation inside a
// Shared Drive) use the regular client — the SA is a direct member.
// =============================================================================

import { google, type drive_v3 } from 'googleapis';
import * as fs from 'fs';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// ─── Shared credential loading ───────────────────────────────────────────────

interface SACredentials {
  client_email: string;
  private_key: string;
}

let cachedCredentials: SACredentials | null = null;

/**
 * Load SA credentials from GOOGLE_APPLICATION_CREDENTIALS (local dev)
 * or Secret Manager (Cloud Run).
 *
 * Strategy:
 *   1. If GOOGLE_APPLICATION_CREDENTIALS is set, read the key file from disk
 *   2. Otherwise, fetch the SA key JSON from Secret Manager using the secret
 *      name in FIREBASE_SA_SECRET_NAME (defaults to 'firebase-admin-sa-key')
 *
 * On Cloud Run, GOOGLE_APPLICATION_CREDENTIALS is NOT set — the regular
 * Firebase Admin SDK uses the metadata server (ADC). But the impersonation
 * client needs the actual private key for JWT auth, so we fetch it from
 * Secret Manager.
 *
 * Credentials are loaded once and cached for the process lifetime.
 */
async function loadSACredentials(): Promise<SACredentials> {
  if (cachedCredentials) return cachedCredentials;

  // ── Path 1: Local dev — key file on disk ────────────────────────────────
  const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFilePath) {
    try {
      const raw = fs.readFileSync(keyFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      cachedCredentials = {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      };
      console.log('[drive/client] Loaded SA credentials from GOOGLE_APPLICATION_CREDENTIALS');
      return cachedCredentials;
    } catch (err) {
      console.error('[drive/client] Failed to load SA credentials from', keyFilePath, err);
      throw new Error(`Failed to load SA credentials from ${keyFilePath}`);
    }
  }

  // ── Path 2: Cloud Run — fetch from Secret Manager ───────────────────────
  const secretName = process.env.FIREBASE_SA_SECRET_NAME || 'firebase-admin-sa-key';
  const projectId = process.env.GCP_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'angsana-exchange';

  try {
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });

    const payload = version.payload?.data;
    if (!payload) {
      throw new Error('Secret Manager returned empty payload');
    }

    const raw = typeof payload === 'string' ? payload : payload.toString('utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Secret JSON is missing client_email or private_key');
    }

    cachedCredentials = {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };

    console.log('[drive/client] Loaded SA credentials from Secret Manager:', secretName);
    return cachedCredentials;
  } catch (err) {
    console.error('[drive/client] Failed to load SA credentials from Secret Manager:', err);
    throw new Error(
      `Cannot load SA credentials: GOOGLE_APPLICATION_CREDENTIALS is not set and ` +
      `Secret Manager fetch for "${secretName}" failed. ` +
      `JWT-based impersonation requires the SA private key.`
    );
  }
}

// ─── Regular Drive client (SA as itself) ─────────────────────────────────────

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

// ─── Impersonated Drive client (SA impersonating a Workspace user) ───────────

let impersonatedDriveClient: drive_v3.Drive | null = null;

/**
 * Returns a Drive v3 client that impersonates a Workspace user via
 * domain-wide delegation.
 *
 * This is ONLY used for creating Shared Drives (drives.create) — an
 * operation that requires a Workspace user context. All other Drive
 * operations use getDriveClient() because the SA is a Content Manager
 * on each Shared Drive.
 *
 * The impersonation target is read from DRIVE_IMPERSONATION_EMAIL env var.
 *
 * Credentials are loaded from GOOGLE_APPLICATION_CREDENTIALS (local dev)
 * or Secret Manager (Cloud Run). This is async because the Secret Manager
 * call is async.
 *
 * @throws Error if credentials or impersonation email are not configured
 */
export async function getDriveClientWithImpersonation(): Promise<drive_v3.Drive> {
  if (impersonatedDriveClient) return impersonatedDriveClient;

  const credentials = await loadSACredentials();

  const impersonationEmail = process.env.DRIVE_IMPERSONATION_EMAIL;
  if (!impersonationEmail) {
    throw new Error(
      'Cannot create impersonated Drive client: DRIVE_IMPERSONATION_EMAIL env var is not set. ' +
      'Set it to a Workspace user email (e.g., keith.new2@angsana-uk.com).'
    );
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: impersonationEmail,
  });

  impersonatedDriveClient = google.drive({ version: 'v3', auth });
  return impersonatedDriveClient;
}

/**
 * Returns the SA's own email address.
 * Used by provision.ts to add the SA as a Content Manager on new Shared Drives.
 *
 * Credentials are loaded from GOOGLE_APPLICATION_CREDENTIALS (local dev)
 * or Secret Manager (Cloud Run). This is async because the Secret Manager
 * call is async.
 *
 * @throws Error if credentials cannot be loaded
 */
export async function getSAEmail(): Promise<string> {
  const credentials = await loadSACredentials();
  return credentials.client_email;
}
