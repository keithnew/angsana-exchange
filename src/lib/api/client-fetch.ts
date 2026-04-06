// =============================================================================
// Angsana Exchange — Authenticated Client Fetch Helper
// Slice 6B: Wraps fetch() with Firebase ID token for generic API calls.
//
// The generic API at /api/v1/exchange/{env}/api/... requires auth via
// Authorization: Bearer <token>. This helper gets the current user's
// Firebase ID token and includes it in the request.
// =============================================================================

import { auth } from '@/lib/firebase/client';

/** Environment for API calls — always 'prod' for now (single-tenant) */
const API_ENV = 'prod';

/**
 * Get the current user's Firebase ID token.
 * Returns null if no user is signed in.
 */
async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
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
