// =============================================================================
// Angsana Exchange — Service Name Constants
// Infrastructure Slice: Structured Logging
//
// Consistent service identifiers used across all logger calls.
// Add new services here as Exchange grows.
// =============================================================================

/** JWT validation, API key resolution, session handling, login tracking */
export const SVC_AUTH = 'authMiddleware';

/** Shared Drive creation, folder tree creation */
export const SVC_DRIVE_PROVISION = 'driveProvisioning';

/** Browse, upload, download, rename, delete, register */
export const SVC_DRIVE_OPS = 'driveOperations';

/** Firestore document registry CRUD */
export const SVC_DOC_REGISTRY = 'documentRegistry';

/** User provision, disable, enable, resend invite, claims update */
export const SVC_USER_LIFECYCLE = 'userLifecycle';

/** Client provision, deprovision, status updates */
export const SVC_CLIENT_LIFECYCLE = 'clientLifecycle';

/** Campaign CRUD, lifecycle transitions */
export const SVC_CAMPAIGNS = 'campaignManagement';

/** Check-in create, edit, auto-action generation */
export const SVC_CHECKINS = 'checkIns';

/** Action CRUD, status updates */
export const SVC_ACTIONS = 'actions';

/** Wishlist CRUD, auto-action on client additions */
export const SVC_WISHLISTS = 'wishlists';

/** So What library CRUD */
export const SVC_SOWHATS = 'soWhats';

/** Managed list admin operations */
export const SVC_MANAGED_LISTS = 'managedLists';

/** Settings read, cache refresh */
export const SVC_SETTINGS = 'settings';

/** Generic API layer (v1 collection routes) */
export const SVC_API_GENERIC = 'apiGeneric';

/** Prospecting profile and propositions */
export const SVC_PROSPECTING = 'prospecting';

/** Retry utility internal logging */
export const SVC_RETRY = 'retryManager';
