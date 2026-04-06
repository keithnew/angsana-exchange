// =============================================================================
// Angsana Exchange — API Response Formatter
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Consistent response envelopes matching the platform Retool API convention.
// Includes count in list responses for automation consumers (Make.com, Retool).
// =============================================================================

import { NextResponse } from 'next/server';
import type {
  DocumentResponse,
  ListResponse,
  SingleDocResponse,
  CreateResponse,
  MutationResponse,
  ErrorResponse,
  ApiErrorCode,
} from './types';

// ─── Success responses ──────────────────────────────────────────────────────

/**
 * List response — multiple documents with pagination.
 */
export function listResponse(
  documents: DocumentResponse[],
  nextPageToken: string | null = null
): NextResponse<ListResponse> {
  return NextResponse.json({
    success: true,
    count: documents.length,
    documents,
    nextPageToken,
  });
}

/**
 * Single document response.
 */
export function singleResponse(
  id: string,
  data: Record<string, unknown>
): NextResponse<SingleDocResponse> {
  return NextResponse.json({
    data: { id, ...data },
  });
}

/**
 * Create response — returns the generated document ID.
 */
export function createResponse(id: string): NextResponse<CreateResponse> {
  return NextResponse.json({ id }, { status: 201 });
}

/**
 * Update response.
 */
export function updateResponse(id: string): NextResponse<MutationResponse> {
  return NextResponse.json({ success: true, updated: id });
}

/**
 * Delete response.
 */
export function deleteResponse(id: string): NextResponse<MutationResponse> {
  return NextResponse.json({ success: true, deleted: id });
}

// ─── Error responses ────────────────────────────────────────────────────────

/** Map error codes to HTTP status codes */
const STATUS_MAP: Record<ApiErrorCode, number> = {
  INVALID_COLLECTION: 400,
  INVALID_QUERY: 400,
  CLIENT_ID_REQUIRED: 400,
  CLIENT_ACCESS_DENIED: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  CLIENT_JWT_NOT_IMPLEMENTED: 401,
  API_KEY_REVOKED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Error response with consistent envelope.
 */
export function errorResponse(
  code: ApiErrorCode,
  message: string
): NextResponse<ErrorResponse> {
  const status = STATUS_MAP[code] || 500;
  return NextResponse.json({ error: message, code }, { status });
}
