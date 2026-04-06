// =============================================================================
// Angsana Exchange — Authenticated Client Fetch Helper
// Slice 6B: Wraps fetch() with Firebase ID token for generic API calls.
//
// The generic API at /api/v1/exchange/{env}/api/... requires auth via
// Authorization: Bearer <token>. This helper gets the current user's
// Firebase ID token and includes it in the request.
//
// NOTE: Firebase Client SDK is loaded lazily (dynamic import) to avoid
// SSR crashes — getAuth() requires browser APIs (indexedDB/localStorage)
// that don't exist in Node.js during server-side rendering.
// =============================================================================

/** Environment for API calls — always 'prod' for now (single-tenant) */
const API_ENV = 'prod';

/**
 * Get the current user's Firebase ID token.
 * Returns null if no user is signed in or if running on the server.
 */
async function getIdToken(): Promise<string | null> {
  // Guard: only run in browser
  if (typeof window === 'undefined') return null;

  try {
    const { auth } = await import('@/lib/firebase/client');
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Authenticated fetch wrapper for the generic Exchange API.
 * Automatically includes the Bearer token and builds the correct URL.
 *
 * Usage:
 *   const data = await apiFetch('/users');           // GET /api/v1/exchange/prod/api/users
 *   const data = await apiFetch('/users/provision', { method: 'POST', body: JSON.stringify({...}) });
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIdToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `/api/v1/exchange/${API_ENV}/api${path.startsWith('/') ? path : '/' + path}`;
  
  return fetch(url, {
    ...options,
    headers,
  });
}
