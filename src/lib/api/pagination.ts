// =============================================================================
// Angsana Exchange — API Pagination Handler
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Cursor-based pagination matching the platform Retool API convention.
// Uses document ID as cursor (startAfter), with configurable limit and orderBy.
// =============================================================================

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './config';

/**
 * Parsed pagination parameters.
 */
export interface PaginationParams {
  limit: number;
  startAfter?: string;
  orderByField?: string;
  orderByDirection: 'asc' | 'desc';
}

/**
 * Parse pagination parameters from the URL search params.
 */
export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
  // Limit
  let limit = DEFAULT_PAGE_LIMIT;
  const limitParam = searchParams.get('limit');
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_PAGE_LIMIT);
    }
  }

  // StartAfter cursor
  const startAfter = searchParams.get('startAfter') || undefined;

  // OrderBy
  let orderByField: string | undefined;
  let orderByDirection: 'asc' | 'desc' = 'asc';
  const orderByParam = searchParams.get('orderBy');
  if (orderByParam) {
    const parts = orderByParam.split(':');
    orderByField = parts[0];
    if (parts[1] === 'desc' || parts[1] === 'asc') {
      orderByDirection = parts[1];
    }
    // Validate field name (alphanumeric, dots, underscores)
    if (orderByField && !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(orderByField)) {
      orderByField = undefined;
    }
  }

  return { limit, startAfter, orderByField, orderByDirection };
}

/**
 * Apply pagination to a Firestore query.
 * Returns the query with orderBy, startAfter, and limit applied.
 * Requests limit + 1 to detect if there are more results (for nextPageToken).
 */
export async function applyPagination(
  query: FirebaseFirestore.Query,
  collectionRef: FirebaseFirestore.CollectionReference,
  params: PaginationParams
): Promise<FirebaseFirestore.Query> {
  let q = query;

  // Apply orderBy
  if (params.orderByField) {
    q = q.orderBy(params.orderByField, params.orderByDirection);
  }

  // Apply startAfter cursor
  if (params.startAfter) {
    try {
      const lastDoc = await collectionRef.doc(params.startAfter).get();
      if (lastDoc.exists) {
        q = q.startAfter(lastDoc);
      }
    } catch {
      // Invalid cursor — ignore and proceed without pagination offset
    }
  }

  // Request limit + 1 to detect next page
  q = q.limit(params.limit + 1);

  return q;
}
