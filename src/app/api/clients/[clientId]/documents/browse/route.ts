// =============================================================================
// Angsana Exchange — Document Browse API Route (Firestore-First)
// Slice 7A: Google Drive API Connectivity & Browse Endpoint
// Slice 7A Step 4, Step 11: Firestore-first reads with role-based visibility
//
// GET /api/clients/{clientId}/documents/browse[?folderId={subfolderId}&source=drive]
//
// Behaviour depends on whether the client has a folderMap (managed client):
//
//   A. Managed client (has folderMap):
//      - Default: reads from Firestore document registry, grouped by folderCategory
//      - Applies role-based visibility filtering:
//        * Internal users: see all categories
//        * Client-approver / client-viewer: see only "client-visible" categories
//      - Optional ?folderId=X&source=drive: falls back to Drive API for raw listing
//      - Includes hasUnregisteredContent flag when Drive files don't match registry
//
//   B. Legacy client (no folderMap):
//      - Falls back to Drive API listing (same as Step 1 behaviour)
//      - Internal-only access enforced
//
// Access: All authenticated roles with client access.
// Internal users see everything. Client users see client-visible folders only.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { listFolderContents, isFolderWithinRoot } from '@/lib/drive/browse';
import { getUserFromHeaders, hasClientAccess, isInternal } from '@/lib/api/middleware/user-context';
import { getClientVisibleCategories } from '@/lib/drive/visibility';
import { getDocumentFolderTemplate } from '@/lib/drive/folder-template-loader';
import { getCampaignRefs } from '@/lib/documents/campaignRefs';
import type { FolderMap, DocumentFolderItem } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A document entry from the Firestore registry, shaped for the browse response. */
interface BrowseRegistryItem {
  documentId: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
  folderCategory: string;
  visibility: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  campaignRefs: string[];
  /** @deprecated Legacy single-ref kept for backward compat */
  campaignRef: string | null;
  propositionRefs: string[];
  status: string;
}

/** A folder grouping in the Firestore-first browse response. */
interface BrowseFolderGroup {
  folderCategory: string;
  folderName: string;
  folderId: string | null;
  visibility: string;
  files: BrowseRegistryItem[];
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * GET /api/clients/{clientId}/documents/browse
 *
 * Query params:
 *   folderId (optional) — browse a specific subfolder (Drive mode)
 *   source (optional) — "drive" forces Drive API listing even for managed clients
 *   folderCategory (optional) — filter Firestore results to a single category
 *
 * Returns folder contents, either from Firestore registry (managed) or
 * Drive API (legacy / explicit drive mode).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  // ── Client access check ─────────────────────────────────────────────────
  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json(
      { error: 'Forbidden: no access to this client', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Parse query params ──────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const requestedFolderId = searchParams.get('folderId');
  const source = searchParams.get('source');
  const filterCategory = searchParams.get('folderCategory');
  const campaignFilter = searchParams.get('campaign');
  const propositionFilter = searchParams.get('proposition');
  const includeUnregisteredCheck = searchParams.get('includeUnregisteredCheck') === 'true';

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

  // driveId = Shared Drive (new model), driveFolderId = regular folder (legacy)
  const driveId = configData.driveId as string | undefined;
  const driveFolderId = configData.driveFolderId as string | undefined;
  const rootId = driveId || driveFolderId;
  const folderMap = (configData.folderMap || null) as FolderMap | null;
  const isManagedClient = !!folderMap && Object.keys(folderMap).length > 0;

  if (!rootId) {
    return NextResponse.json(
      { error: 'No Drive folder configured for this client', code: 'NO_DRIVE_FOLDER' },
      { status: 404 }
    );
  }

  // ── Decision: Firestore-first or Drive fallback ─────────────────────────

  // Force Drive mode: explicit source=drive, or subfolder navigation, or legacy client
  const useDriveMode = source === 'drive' || !!requestedFolderId || !isManagedClient;

  if (useDriveMode) {
    // ── Drive API mode (legacy or explicit) ─────────────────────────────
    // Legacy clients: internal-only. Managed clients with source=drive: any role with access.
    if (!isManagedClient && !isInternal(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: only internal users can browse unmanaged client documents', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    const targetFolderId = requestedFolderId || rootId;

    // Subfolder security: verify folder is within client's tree
    if (requestedFolderId && requestedFolderId !== rootId) {
      try {
        const isValid = await isFolderWithinRoot(requestedFolderId, rootId, !!driveId);
        if (!isValid) {
          return NextResponse.json(
            { error: 'Forbidden: folder is not within this client\'s Drive folder', code: 'FORBIDDEN' },
            { status: 403 }
          );
        }
      } catch (err) {
        const driveError = err as { code?: number; message?: string };
        if (driveError.code === 404) {
          return NextResponse.json(
            { error: 'Folder not found or access denied', code: 'FOLDER_NOT_FOUND' },
            { status: 404 }
          );
        }
        console.error('[documents/browse] Parent-chain validation error:', driveError.message);
        return NextResponse.json(
          { error: 'Drive API error during folder validation', code: 'DRIVE_API_ERROR' },
          { status: 500 }
        );
      }
    }

    // List folder contents from Drive
    try {
      const items = await listFolderContents(targetFolderId, driveId || undefined);

      return NextResponse.json({
        success: true,
        mode: 'drive',
        data: {
          folderId: targetFolderId,
          items,
          count: items.length,
        },
      });
    } catch (err) {
      const driveError = err as { code?: number; message?: string };
      if (driveError.code === 404) {
        return NextResponse.json(
          { error: 'Drive folder not found — folder may have been deleted or SA lost access', code: 'FOLDER_NOT_FOUND' },
          { status: 404 }
        );
      }
      console.error('[documents/browse] Drive API error:', driveError.message);
      return NextResponse.json(
        { error: 'Failed to list folder contents from Google Drive', code: 'DRIVE_API_ERROR' },
        { status: 500 }
      );
    }
  }

  // ── Firestore-first mode (managed client, no subfolder navigation) ──────

  // Load the document folder template for visibility resolution
  let folderTemplate: DocumentFolderItem[];
  try {
    folderTemplate = await getDocumentFolderTemplate(user.tenantId);
  } catch (err) {
    console.error('[documents/browse] Failed to load folder template:', err);
    return NextResponse.json(
      { error: 'Failed to load folder template', code: 'TEMPLATE_LOAD_ERROR' },
      { status: 500 }
    );
  }

  // Determine which categories this user can see
  const isInternalUser = isInternal(user.role);
  const visibleCategories = isInternalUser
    ? folderTemplate.filter((f) => !f.isContainer && f.active).map((f) => f.folderCategory)
    : getClientVisibleCategories(folderTemplate);

  // Apply optional folderCategory filter
  const targetCategories = filterCategory
    ? visibleCategories.filter((c) => c === filterCategory)
    : visibleCategories;

  if (filterCategory && targetCategories.length === 0) {
    return NextResponse.json(
      { error: `Folder category "${filterCategory}" is not accessible`, code: 'CATEGORY_NOT_FOUND' },
      { status: 404 }
    );
  }

  // ── Query Firestore document registry ───────────────────────────────────
  try {
    const documentsRef = adminDb
      .collection('tenants')
      .doc(user.tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('documents');

    // When campaign filter is active, we use a simpler query to avoid needing
    // a composite index for folderCategory(in) + campaignRefs(array-contains).
    // We query both the new campaignRefs (array) field AND the legacy
    // campaignRef (string) field, then merge and deduplicate results.
    let snapshot;
    if (campaignFilter) {
      // Query 1: new array field
      const arrayQuery = documentsRef
        .where('campaignRefs', 'array-contains', campaignFilter)
        .where('status', '==', 'active')
        .orderBy('uploadedAt', 'desc');
      // Query 2: legacy string field
      const stringQuery = documentsRef
        .where('campaignRef', '==', campaignFilter)
        .where('status', '==', 'active')
        .orderBy('uploadedAt', 'desc');

      const [arraySnap, stringSnap] = await Promise.all([
        arrayQuery.get(),
        stringQuery.get(),
      ]);

      // Merge and deduplicate by document ID
      const seenIds = new Set<string>();
      const mergedDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const doc of arraySnap.docs) {
        seenIds.add(doc.id);
        mergedDocs.push(doc);
      }
      for (const doc of stringSnap.docs) {
        if (!seenIds.has(doc.id)) {
          mergedDocs.push(doc);
        }
      }

      // Create a lightweight snapshot-like object
      snapshot = { docs: mergedDocs };
    } else if (propositionFilter) {
      // Proposition filter — same pattern as campaign filter
      // Uses the propositionRefs composite index
      const propQuery = documentsRef
        .where('propositionRefs', 'array-contains', propositionFilter)
        .where('status', '==', 'active')
        .orderBy('uploadedAt', 'desc');

      snapshot = await propQuery.get();
    } else {
      // No campaign filter — use folderCategory `in` query as before
      const categoryQuery = documentsRef
        .where('status', '==', 'active')
        .where('folderCategory', 'in', targetCategories.length > 0 ? targetCategories : ['__none__'])
        .orderBy('uploadedAt', 'desc');
      snapshot = await categoryQuery.get();
    }

    // Build category-keyed map of folder groups using the folderMap
    const categoryToFolderId = new Map<string, string>();
    if (folderMap) {
      for (const [fId, entry] of Object.entries(folderMap)) {
        categoryToFolderId.set(entry.folderCategory, fId);
      }
    }

    // Group documents by folderCategory
    const groups = new Map<string, BrowseFolderGroup>();

    // Pre-populate groups for all visible categories (so empty folders still appear)
    for (const category of targetCategories) {
      const templateItem = folderTemplate.find((f) => f.folderCategory === category);
      if (templateItem) {
        groups.set(category, {
          folderCategory: category,
          folderName: templateItem.name,
          folderId: categoryToFolderId.get(category) || null,
          visibility: templateItem.visibility,
          files: [],
        });
      }
    }

    // Populate files into their category groups
    // When campaign filter is active, files may have categories not in targetCategories.
    // Dynamically create groups for any category found in campaign-filtered results.
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const category = data.folderCategory as string;
      let group = groups.get(category);
      if (!group && (campaignFilter || propositionFilter)) {
        // Dynamically create a group for this category (campaign/proposition filter mode)
        const templateItem = folderTemplate.find((f) => f.folderCategory === category);
        if (templateItem) {
          group = {
            folderCategory: category,
            folderName: templateItem.name,
            folderId: categoryToFolderId.get(category) || null,
            visibility: templateItem.visibility,
            files: [],
          };
          groups.set(category, group);
        }
      }
      if (group) {
        const refs = getCampaignRefs(data as { campaignRefs?: string[]; campaignRef?: string });
        group.files.push({
          documentId: doc.id,
          driveFileId: data.driveFileId,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size,
          folderCategory: category,
          visibility: data.visibility,
          uploadedBy: data.uploadedBy,
          uploadedByName: data.uploadedByName || data.uploadedBy || '',
          uploadedAt: data.uploadedAt,
          campaignRefs: refs,
          campaignRef: refs.length > 0 ? refs[0] : null,
          propositionRefs: Array.isArray(data.propositionRefs) ? data.propositionRefs : [],
          status: data.status,
        });
      }
    }

    // Sort groups by template sortOrder
    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      const aOrder = folderTemplate.find((f) => f.folderCategory === a.folderCategory)?.sortOrder || 99;
      const bOrder = folderTemplate.find((f) => f.folderCategory === b.folderCategory)?.sortOrder || 99;
      return aOrder - bOrder;
    });

    // ── Check for unregistered Drive content ────────────────────────────
    // Compare registered driveFileIds against Drive listing to flag drift.
    // Only for internal users (lightweight check, not per-request for clients).
    let hasUnregisteredContent = false;

    if (isInternalUser && driveId && includeUnregisteredCheck) {
      try {
        // Get all registered driveFileIds for this client
        const registeredFileIds = new Set(
          snapshot.docs.map((d) => d.data().driveFileId as string)
        );

        // Quick check: list root-level items from Drive, check if any files are missing
        const driveItems = await listFolderContents(driveId, driveId);
        // Only check folders that are in the folderMap
        for (const item of driveItems) {
          if (item.isFolder && folderMap && folderMap[item.id]) {
            // List files in this folder
            const folderFiles = await listFolderContents(item.id, driveId);
            for (const file of folderFiles) {
              if (!file.isFolder && !registeredFileIds.has(file.id)) {
                hasUnregisteredContent = true;
                break;
              }
            }
            if (hasUnregisteredContent) break;
          }
        }
      } catch (err) {
        // Non-critical — just log and skip the check
        console.warn('[documents/browse] Unregistered content check failed:', err);
      }
    }

    const totalFiles = sortedGroups.reduce((sum, g) => sum + g.files.length, 0);

    return NextResponse.json({
      success: true,
      mode: 'firestore',
      data: {
        folders: sortedGroups,
        totalFiles,
        totalFolders: sortedGroups.length,
        hasUnregisteredContent,
        visibilityFilter: isInternalUser ? 'all' : 'client-visible',
        campaignFilter: campaignFilter || null,
      },
    });
  } catch (err) {
    const firestoreError = err as { message?: string; code?: number };
    console.error('[documents/browse] Firestore query error:', firestoreError.message);
    return NextResponse.json(
      { error: 'Failed to query document registry', code: 'FIRESTORE_ERROR' },
      { status: 500 }
    );
  }
}
