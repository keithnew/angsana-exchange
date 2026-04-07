// =============================================================================
// Angsana Exchange — Server-side Password Reset Email Sender
//
// The Firebase Admin SDK's generatePasswordResetLink() only RETURNS a link
// string — it does NOT send an email.  To trigger Firebase's built-in
// password-reset email from the server we must call the Identity Toolkit REST
// API directly.  This uses the same email template configured in the Firebase
// Console under Authentication → Templates.
// =============================================================================

/**
 * Send a password-reset email via the Firebase Auth REST API.
 *
 * This calls the Identity Toolkit v1 `sendOobCode` endpoint with
 * `requestType: "PASSWORD_RESET"`, which causes Firebase to deliver its
 * standard password-reset email (subject / body configured in the console).
 *
 * @param email - The user's email address.
 * @throws If the API key is missing or the REST call fails.
 */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not configured — cannot send password reset email.');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PASSWORD_RESET',
      email,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.error?.message || res.statusText;
    throw new Error(`Firebase sendOobCode failed (${res.status}): ${detail}`);
  }
}
