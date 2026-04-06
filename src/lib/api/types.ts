// =============================================================================
// Angsana Exchange — API Layer Type Definitions
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Composes with existing Exchange types (UserRole, AuthClaims) rather than
// creating parallel hierarchies.
// =============================================================================

import type { UserRole } from '@/types';

/**
 * Auth method used to authenticate an API request.
 */
export type ApiAuthMethod = 'firebase' | 'apiKey' | 'clientJwt';

/**
 * Normalised auth context produced by the API auth middleware.
 * Every authenticated API request resolves to this shape. All downstream
 * logic (collection access, client scoping, audit logging) uses this
 * context, never the raw auth credentials.
 */
export interface ApiAuthContext {
  /** How the caller was authenticated */
  method: ApiAuthMethod;
  /** Tenant this request is scoped to */
  tenantId: string;
  /** Role of the caller — reuses existing UserRole enum */
  role: UserRole;
  /** Set for client users and client-scoped API keys */
  clientId?: string;
  /** Set for internal roles; includes '*' wildcard for unrestricted */
  assignedClients?: string[];
  /** Firebase UID for human callers */
  userId?: string;
  /** API key ID for key-based callers */
  keyId?: string;
  /** From Firebase claims, preserved for future use */
  permittedModules?: string[];
  /** Derived from role (future: from key scope) */
  permissions: string[];
}

/**
 * Collection scope — determines whether a collection requires a clientId.
 */
export type CollectionScope = 'client' | 'tenant';

/**
 * Configuration for a single exposed API collection.
 */
export interface CollectionConfig {
  /** URL slug used in the API path */
  slug: string;
  /** Firestore sub-path relative to tenants/{tenantId}/ */
  firestorePath: string;
  /** Whether this collection requires a clientId */
  scope: CollectionScope;
  /** HTTP methods allowed per role */
  allowedOperations: {
    'internal-admin': readonly string[];
    'internal-user': readonly string[];
    'client-approver': readonly string[];
    'client-viewer': readonly string[];
  };
  /** Notes for documentation */
  notes?: string;
}

/**
 * Query parameters accepted by the API.
 * Matches the platform Retool API convention.
 */
export interface ApiQueryParams {
  /** Max documents to return (default 100, max 1000) */
  limit?: number;
  /** Pagination cursor from previous response's nextPageToken */
  startAfter?: string;
  /** Sort field with optional direction, e.g. 'createdAt:desc' */
  orderBy?: string;
  /** WHERE filter conditions — multiple are combined with AND */
  where?: string[];
  /** Client ID for client-scoped collections */
  clientId?: string;
  /** List type for managedlists collection */
  listType?: string;
}

/**
 * Single document in a list response.
 */
export interface DocumentResponse {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Standard list response envelope.
 */
export interface ListResponse {
  success: true;
  count: number;
  documents: DocumentResponse[];
  nextPageToken: string | null;
}

/**
 * Single document response envelope.
 */
export interface SingleDocResponse {
  data: Record<string, unknown> & { id: string };
}

/**
 * Create response envelope.
 */
export interface CreateResponse {
  id: string;
}

/**
 * Mutation (update/delete) response envelope.
 */
export interface MutationResponse {
  success: true;
  updated?: string;
  deleted?: string;
}

/**
 * Error response envelope.
 */
export interface ErrorResponse {
  error: string;
  code: ApiErrorCode;
}

/**
 * All known API error codes.
 */
export type ApiErrorCode =
  | 'INVALID_COLLECTION'
  | 'INVALID_QUERY'
  | 'CLIENT_ID_REQUIRED'
  | 'CLIENT_ACCESS_DENIED'
  | 'UNAUTHORIZED'
  | 'CLIENT_JWT_NOT_IMPLEMENTED'
  | 'API_KEY_REVOKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/**
 * API key document stored in Firestore.
 * Path: tenants/{tenantId}/apiKeys/{keyId}
 */
export interface ApiKeyDocument {
  keyId: string;
  keyHash: string;
  name: string;
  role: UserRole;
  tenantId: string;
  clientId: string | null;
  collections: string[] | null;
  permissions: string[] | null;
  status: 'active' | 'revoked';
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  lastUsedAt: FirebaseFirestore.Timestamp | null;
  revokedAt: FirebaseFirestore.Timestamp | null;
  revokedBy: string | null;
}

/**
 * User document stored in Firestore.
 * Path: tenants/{tenantId}/users/{uid}
 */
export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  tenantId: string;
  clientId: string | null;
  assignedClients: string[] | null;
  status: 'invited' | 'active' | 'disabled';
  createdAt: FirebaseFirestore.Timestamp;
  createdBy: string | null;
  lastLoginAt: FirebaseFirestore.Timestamp | null;
  disabledAt: FirebaseFirestore.Timestamp | null;
  disabledBy: string | null;
}

/**
 * Audit log entry for mutation operations.
 * Path: tenants/{tenantId}/apiLogs/{autoId}
 */
export interface ApiLogEntry {
  timestamp: FirebaseFirestore.Timestamp;
  method: string;
  collection: string;
  documentId: string | null;
  authMethod: ApiAuthMethod;
  callerId: string;
  callerRole: string;
  clientId: string | null;
  statusCode: number;
  errorCode: string | null;
  expiresAt: FirebaseFirestore.Timestamp;
}
