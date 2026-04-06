// =============================================================================
// Angsana Exchange — Collection-Level API Route Handler
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Handles: GET (list with queries) and POST (create document)
// Path:    /api/v1/exchange/[env]/api/[collection]
// =============================================================================

import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticateRequest, resolveClientId } from '@/lib/api/middleware/auth';
import { logApiRequest } from '@/lib/api/middleware/audit';
import { getCollectionConfig, isOperationAllowed, resolveFirestorePath } from '@/lib/api/collections';
import { parseMultipleWhereClauses } from '@/lib/api/query-parser';
import { buildFirestoreQuery } from '@/lib/api/firestore-query-builder';
import { parsePaginationParams, applyPagination } from '@/lib/api/pagination';
import { listResponse, createResponse, errorResponse } from '@/lib/api/response';
import type { ApiAuthContext, DocumentResponse } from '@/lib/api/types';

export const runtime = 'nodejs';

// ─── GET: List documents with queries ───────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ env: string; collection: string }> }
) {
  const startTime = Date.now();
  const { env, collection: slug } = await params;
  let authContext: ApiAuthContext | undefined;
  let resolvedClientId: string | undefined;

  try {
    // 1. Authenticate
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      logApiRequest({ method: 'GET', collection: slug, env, authContext: { method: 'firebase', tenantId: 'unknown', role: 'client-viewer', permissions: [] } as ApiAuthContext, statusCode: 401, errorCode: authResult.code, responseTimeMs: Date.now() - startTime });
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }
    authContext = authResult;

    // 2. Validate collection
    const config = getCollectionConfig(slug);
    if (!config) {
      logApiRequest({ method: 'GET', collection: slug, env, authContext, statusCode: 400, errorCode: 'INVALID_COLLECTION', responseTimeMs: Date.now() - startTime });
      return errorResponse('INVALID_COLLECTION', `Unknown collection '${slug}'.`);
    }

    // 3. Check operation permission
    if (!isOperationAllowed(config, authContext.role, 'GET')) {
      logApiRequest({ method: 'GET', collection: slug, env, authContext, statusCode: 403, errorCode: 'FORBIDDEN', responseTimeMs: Date.now() - startTime });
      return errorResponse('FORBIDDEN', `GET not allowed on '${slug}' for role '${authContext.role}'.`);
    }

    // 4. Resolve client scoping
    const searchParams = request.nextUrl.searchParams;
    if (config.scope === 'client') {
      const clientResult = resolveClientId(authContext, searchParams.get('clientId') || undefined);
      if (typeof clientResult !== 'string') {
        logApiRequest({ method: 'GET', collection: slug, env, authContext, statusCode: 400, errorCode: clientResult.code, responseTimeMs: Date.now() - startTime });
        return errorResponse(clientResult.code as Parameters<typeof errorResponse>[0], clientResult.message);
      }
      resolvedClientId = clientResult;
    }

    // 5. Handle managedlists special case
    const listType = searchParams.get('listType') || undefined;
    if (slug === 'managedlists' && !listType) {
      logApiRequest({ method: 'GET', collection: slug, env, authContext, clientId: resolvedClientId, statusCode: 400, errorCode: 'INVALID_QUERY', responseTimeMs: Date.now() - startTime });
      return errorResponse('INVALID_QUERY', "The 'managedlists' collection requires a 'listType' query parameter (e.g. listType=serviceTypes).");
    }

    // 6. Build Firestore path and get collection reference
    const firestorePath = resolveFirestorePath(config, authContext.tenantId, resolvedClientId, listType);
    const collectionRef = adminDb.collection(firestorePath);

    // 7. Parse WHERE clauses
    const whereParams = searchParams.getAll('where');
    const whereNode = parseMultipleWhereClauses(whereParams);

    // 8. Build query with WHERE filters
    const queryResult = await buildFirestoreQuery(collectionRef, whereNode);

    // 9. Apply pagination
    const pagination = parsePaginationParams(searchParams);
    const finalQuery = await applyPagination(queryResult.query, collectionRef, pagination);

    // 10. Execute query
    const snapshot = await finalQuery.get();

    // 11. Process results
    let documents: DocumentResponse[] = [];
    let hasMore = false;

    snapshot.docs.forEach((doc, index) => {
      if (index < pagination.limit) {
        documents.push({ id: doc.id, data: doc.data() as Record<string, unknown> });
      } else {
        hasMore = true;
      }
    });

    // 12. Apply client-side filtering if needed
    if (queryResult.requiresClientFilter && queryResult.clientFilter) {
      documents = documents.filter(doc => queryResult.clientFilter!(doc.data));
    }

    // 13. Determine next page token
    const nextPageToken = hasMore && documents.length > 0
      ? documents[documents.length - 1].id
      : null;

    // 14. Log and return
    logApiRequest({ method: 'GET', collection: slug, env, authContext, clientId: resolvedClientId, statusCode: 200, responseTimeMs: Date.now() - startTime });
    return listResponse(documents, nextPageToken);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API GET /${slug} error:`, message);
    if (authContext) {
      logApiRequest({ method: 'GET', collection: slug, env, authContext, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    }
    return errorResponse('INTERNAL_ERROR', message);
  }
}

// ─── POST: Create document ──────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ env: string; collection: string }> }
) {
  const startTime = Date.now();
  const { env, collection: slug } = await params;
  let authContext: ApiAuthContext | undefined;
  let resolvedClientId: string | undefined;

  try {
    // 1. Authenticate
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) {
      return errorResponse(authResult.code as Parameters<typeof errorResponse>[0], authResult.message);
    }
    authContext = authResult;

    // 2. Validate collection
    const config = getCollectionConfig(slug);
    if (!config) {
      logApiRequest({ method: 'POST', collection: slug, env, authContext, statusCode: 400, errorCode: 'INVALID_COLLECTION', responseTimeMs: Date.now() - startTime });
      return errorResponse('INVALID_COLLECTION', `Unknown collection '${slug}'.`);
    }

    // 3. Check operation permission
    if (!isOperationAllowed(config, authContext.role, 'POST')) {
      logApiRequest({ method: 'POST', collection: slug, env, authContext, statusCode: 403, errorCode: 'FORBIDDEN', responseTimeMs: Date.now() - startTime });
      return errorResponse('FORBIDDEN', `POST not allowed on '${slug}' for role '${authContext.role}'.`);
    }

    // 4. Resolve client scoping
    const searchParams = request.nextUrl.searchParams;
    if (config.scope === 'client') {
      const clientResult = resolveClientId(authContext, searchParams.get('clientId') || undefined);
      if (typeof clientResult !== 'string') {
        logApiRequest({ method: 'POST', collection: slug, env, authContext, statusCode: 400, errorCode: clientResult.code, responseTimeMs: Date.now() - startTime });
        return errorResponse(clientResult.code as Parameters<typeof errorResponse>[0], clientResult.message);
      }
      resolvedClientId = clientResult;
    }

    // 5. Handle managedlists
    const listType = searchParams.get('listType') || undefined;
    if (slug === 'managedlists' && !listType) {
      return errorResponse('INVALID_QUERY', "The 'managedlists' collection requires a 'listType' query parameter.");
    }

    // 6. Parse request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      logApiRequest({ method: 'POST', collection: slug, env, authContext, clientId: resolvedClientId, statusCode: 400, errorCode: 'INVALID_QUERY', responseTimeMs: Date.now() - startTime });
      return errorResponse('INVALID_QUERY', 'Request body required. Document data cannot be empty.');
    }

    // 7. Build Firestore path and create document
    const firestorePath = resolveFirestorePath(config, authContext.tenantId, resolvedClientId, listType);
    const collectionRef = adminDb.collection(firestorePath);

    const createData = {
      ...body,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await collectionRef.add(createData);

    // 8. Log and return
    logApiRequest({ method: 'POST', collection: slug, documentId: docRef.id, env, authContext, clientId: resolvedClientId, statusCode: 201, responseTimeMs: Date.now() - startTime });
    return createResponse(docRef.id);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`API POST /${slug} error:`, message);
    if (authContext) {
      logApiRequest({ method: 'POST', collection: slug, env, authContext, clientId: resolvedClientId, statusCode: 500, errorCode: 'INTERNAL_ERROR', responseTimeMs: Date.now() - startTime });
    }
    return errorResponse('INTERNAL_ERROR', message);
  }
}
