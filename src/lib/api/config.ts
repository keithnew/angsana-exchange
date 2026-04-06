// =============================================================================
// Angsana Exchange — API Configuration Constants
// Slice 6A: Exchange API Layer & Auth Infrastructure
//
// Stored as constants rather than a Firestore Settings document because these
// values are unlikely to change without a redeploy. If operational tuning is
// needed later, migrating to Firestore Settings is straightforward.
// =============================================================================

/** Default number of documents returned per page */
export const DEFAULT_PAGE_LIMIT = 100;

/** Maximum documents that can be returned per page */
export const MAX_PAGE_LIMIT = 1000;

/** Days before Firestore mutation audit logs are auto-deleted via TTL */
export const AUDIT_LOG_TTL_DAYS = 90;

/** Default tenant for API key resolution (single-tenant for now) */
export const DEFAULT_TENANT_ID = 'angsana';

/** Debug mode — when true, query parsers emit verbose logging */
export const API_DEBUG = process.env.API_DEBUG === 'true';
