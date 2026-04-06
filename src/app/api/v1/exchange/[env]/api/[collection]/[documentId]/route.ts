// =============================================================================
// Angsana Exchange — Document-Level API Route Handler
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Handles: GET (single), PUT (full replace), PATCH (partial merge), DELETE
// Path:    /api/v1/exchange/[env]/api/[collection]/[documentId]
// =============================================================================

import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest, resolveClientId } from '@/lib/api/middleware/auth';
import { logApiRequest } from '@/lib/api/middleware/audit';
import { getCollectionConfig, isOperationAllowed, resolveFirestorePath } from '@/lib/api/collections';
import { singleResponse, updateResponse, deleteResponse, errorResponse } from '@/lib/api/response';
import type { ApiAuthContext } from '@/lib/api/types';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ env: string; collection: string; documentId: string }> };

/**
 * Common setup for all document-level operations.
 * Returns the auth context, collection config, and document reference — or an error response.
 */
async function setupDocumentRequest(
  request: NextRequest,
  resolvedParams: { env: string; collection: string; documentId: string },
  method: string,
  startTime: number
) {
  const { env, collection: slug, documentId } = resolvedParams;

  // 1. Authenticate
  const authResult = await authenticateRequest(request);
  if ('error' in authResult) {
    return { error: errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message), slug, env, documentId };
  }
  const authContext = authResult;

  // 2. Validate collection
  const config = getCollectionConfig(slug);
  if (!config) {
    logApiRequest({ method, collection: slug, documentId, env, authContext, statusCode: 400, errorCode: 'INVALID_COLLECTION', responseTimeMs: Date.now() - startTime });
    return { error: errorResponse('INVALID_COLLECTION', `Unknown collection '${slug}'.`), slug, env, documentId, authContext };
  }

  // 3. Check operation permission
  if (!isOperationAllowed(config, authContext.role, method)) {
    logApiRequest({ method, collection: slug, documentId, env, authContext, statusCode: 403, errorCode: 'FORBIDDEN', responseTimeMs: Date.now() - startTime });
    return { error: errorResponse('FORBIDDEN', `${method} not allowed on '${slug}' for role '${authContext.role}'.`), slug, env, documentId, authContext };
  }

  // 4. Resolve client scoping
  let resolvedClientId: string | undefined;
  const searchParams = request.nextUrl.searchParams;
  if (config.scope === 'client') {
    const clientResult = resolveClientId(authContext, searchParams.get('clientId') || undefined);
    if (typeof clientResult !== 'string') {
      logApiRequest({ method, collection: slug, documentId, env, authContext, statusCode: 400, errorCode: clientResult.code, responseTimeMs: Date.now() - startTime });
      return { error: errorResponse(clientResult.code as Parameters<typeof errorResponse>[0], clientResult.message), slug, env, documentId, authContext };
    }
    resolvedClientId = clientResult;
  }

  // 5. Handle managedlists
  const listType = searchParams.get('listType') || undefined;
  if (slug === 'managedlists' && !listType) {
    return { error: errorResponse('INVALID_QUERY', "The 'managedlists' collection requires a 'listType' query parameter."), slug, env, documentId, authContext };
  }

  // 6. Build Firestore path and get document reference
  const firestorePath = resolveFirestorePath(config, authContext.tenantId, resolvedClientId, listType);
  const collectionRef = adminDb.collection(firestorePath);
  const docRef = collectionRef.doc(documentId);

  return { authContext, config, docRef, collectionRef, resolvedClientId, slug, env, documentId };
}

// ─── GET: Single document ───────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const resolvedParams = await params;
  const result = await setupDocumentRequest(request, resolvedParams, 'GET', startTime);

  if ('error' in result && result.error) {
    return result.error;
  }

  const { authContext, docRef, slug, env, documentId, resolvedClientId } = result as Exclude<typeof result, { error: any }>;

  try {
    const docSnap = await docRef!.get();
    if (!docSnap.exists) {
      logApiRequest({ method: 'GET', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 404, errorCode: 'NOT_FOUND', responseTimeMs: Date.now() - startTime });
      return errorResponse('NOT_FOUND', `Document '${documentId}' not found in '${slug}'.`);
    }

    logApiRequest({ method: 'GET', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 200, responseTimeMs: Date.now() - startTime });
    return singleResponse(docSnap.id, docSnap.data() as Record<string, unknown>);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API GET /${slug}/${documentId} error:`, message);
    logApiRequest({ method: 'GET', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    return errorResponse('INTERNAL_ERROR', message);
  }
}

// ─── PUT: Full replace ──────────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const resolvedParams = await params;
  const result = await setupDocumentRequest(request, resolvedParams, 'PUT', startTime);

  if ('error' in result && result.error) {
    return result.error;
  }

  const { authContext, docRef, slug, env, documentId, resolvedClientId } = result as Exclude<typeof result, { error: any }>;

  try {
    // Check document exists
    const docSnap = await docRef!.get();
    if (!docSnap.exists) {
      logApiRequest({ method: 'PUT', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 404, errorCode: 'NOT_FOUND', responseTimeMs: Date.now() - startTime });
      return errorResponse('NOT_FOUND', `Document '${documentId}' not found in '${slug}'.`);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return errorResponse('INVALID_QUERY', 'Request body required. Document data cannot be empty.');
    }

    // Full replace via set
    await docRef!.set({
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logApiRequest({ method: 'PUT', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 200, responseTimeMs: Date.now() - startTime });
    return updateResponse(documentId);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API PUT /${slug}/${documentId} error:`, message);
    logApiRequest({ method: 'PUT', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    return errorResponse('INTERNAL_ERROR', message);
  }
}

// ─── PATCH: Partial merge ───────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const resolvedParams = await params;
  const result = await setupDocumentRequest(request, resolvedParams, 'PATCH', startTime);

  if ('error' in result && result.error) {
    return result.error;
  }

  const { authContext, docRef, slug, env, documentId, resolvedClientId } = result as Exclude<typeof result, { error: any }>;

  try {
    const docSnap = await docRef!.get();
    if (!docSnap.exists) {
      logApiRequest({ method: 'PATCH', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 404, errorCode: 'NOT_FOUND', responseTimeMs: Date.now() - startTime });
      return errorResponse('NOT_FOUND', `Document '${documentId}' not found in '${slug}'.`);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return errorResponse('INVALID_QUERY', 'Request body required. Update data cannot be empty.');
    }

    // Partial merge via update
    await docRef!.update({
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
    });

    logApiRequest({ method: 'PATCH', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 200, responseTimeMs: Date.now() - startTime });
    return updateResponse(documentId);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API PATCH /${slug}/${documentId} error:`, message);
    logApiRequest({ method: 'PATCH', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    return errorResponse('INTERNAL_ERROR', message);
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const resolvedParams = await params;
  const result = await setupDocumentRequest(request, resolvedParams, 'DELETE', startTime);

  if ('error' in result && result.error) {
    return result.error;
  }

  const { authContext, docRef, slug, env, documentId, resolvedClientId } = result as Exclude<typeof result, { error: any }>;

  try {
    const docSnap = await docRef!.get();
    if (!docSnap.exists) {
      logApiRequest({ method: 'DELETE', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 404, errorCode: 'NOT_FOUND', responseTimeMs: Date.now() - startTime });
      return errorResponse('NOT_FOUND', `Document '${documentId}' not found in '${slug}'.`);
    }

    await docRef!.delete();

    logApiRequest({ method: 'DELETE', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 200, responseTimeMs: Date.now() - startTime });
    return deleteResponse(documentId);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API DELETE /${slug}/${documentId} error:`, message);
    logApiRequest({ method: 'DELETE', collection: slug, documentId, env, authContext: authContext!, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    return errorResponse('INTERNAL_ERROR', message);
  }
}
