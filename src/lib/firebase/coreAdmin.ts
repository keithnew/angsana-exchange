// =============================================================================
// Core-prod admin-SDK accessor (cross-project Firestore for action-lite
// Work Items).
//
// Background — S3-code-P3:
//   The S3-P2 reseed migrated Cegid Spain's Action documents onto the
//   `action-lite` Work Item type. action-lite is a *tenant-scoped* type
//   (Spec §7.1) and its instances live on the **angsana-core-prod**
//   project at `tenants/{tenantId}/workItems/{workItemId}` — NOT on
//   `angsana-exchange`. The reseed script already targets that location
//   (see `scripts/reseed-actions-to-work-items-v0_1.ts`).
//
//   For P3 the runtime — both the new Action UI server components and the
//   rewired check-in auto-generation path — must read and write the same
//   collection from inside the `angsana-exchange` Next.js app. This module
//   is the cross-project admin-SDK accessor.
//
// Continuing P2's deviation:
//   The S3-pre-code §"P3" deliverable named `workItemsApi.createWorkItem`
//   (HTTP POST through Core's Cloud Function) as the write path. P2 chose
//   firebase-admin direct-write for the reseed script (P2 handover
//   §"Implementation deviation"). P3 continues that deviation for the
//   same reasons:
//     1. Parity with P2's chosen execution model.
//     2. The platform-router authentication needed to call the Cloud
//        Function from a Cloud Run service is operationally heavier than
//        warranted (router-issued token or `X-Platform-Admin-Token`
//        shared secret).
//     3. On-disk shape is identical — `workItemsApi.createWorkItem` is a
//        thin validator over the same Firestore write. The new Action UI's
//        own server-side validation reproduces what the validator covers
//        (typeId pinning, required fields), so validator coverage is not
//        load-bearing.
//   The P3 handover documents this; if a future cross-tenant or
//   cross-acquirer integration needs validator-mediated writes, the
//   workItemsApi POST path remains available.
//
// Deploy-time IAM:
//   The `angsana-exchange` Cloud Run service account requires
//   `roles/datastore.user` on the `angsana-core-prod` project. Locally
//   `gcloud auth application-default login` typically covers both
//   projects on a developer machine.
//
// Bootstrap pattern:
//   Mirrors `scripts/reseed-actions-to-work-items-v0_1.ts::ensureApp` — a
//   secondary firebase-admin App named `'core-prod'` is initialised on
//   first access and reused. The default unnamed app (this app) stays on
//   `angsana-exchange` for everything that already works.
// =============================================================================

import {
  initializeApp,
  getApps,
  cert,
  type App,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const CORE_APP_NAME = 'core-prod';
const CORE_PROJECT_ID = 'angsana-core-prod';

let _coreApp: App | null = null;
let _coreDb: Firestore | null = null;

function getCoreApp(): App {
  if (_coreApp) return _coreApp;

  const existing = getApps().find((a) => a.name === CORE_APP_NAME);
  if (existing) {
    _coreApp = existing;
    return existing;
  }

  // GOOGLE_APPLICATION_CREDENTIALS path (local dev) — same pattern as
  // `lib/firebase/admin.ts` but pinned to the core-prod projectId. On
  // Cloud Run the service account is auto-discovered.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    _coreApp = initializeApp(
      {
        credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        projectId: CORE_PROJECT_ID,
      },
      CORE_APP_NAME
    );
    return _coreApp;
  }

  _coreApp = initializeApp({ projectId: CORE_PROJECT_ID }, CORE_APP_NAME);
  return _coreApp;
}

/**
 * Lazy accessor for the `angsana-core-prod` Firestore. Use this for any
 * code that reads or writes Work Items of tenant-scoped types
 * (`action-lite`, etc.) — those instances live on Core, not Exchange.
 */
export function getCoreDb(): Firestore {
  if (_coreDb) return _coreDb;
  _coreDb = getFirestore(getCoreApp());
  return _coreDb;
}
