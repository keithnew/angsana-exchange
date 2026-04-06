import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/auth/session
 *
 * Accepts a Firebase ID token from the client after sign-in.
 * Verifies it server-side, then sets a __session cookie containing
 * the raw ID token. The middleware reads this cookie on every request.
 *
 * Why a cookie and not Authorization header?
 * Next.js middleware can read cookies on navigation requests (GET),
 * but browsers don't send Authorization headers on page navigations.
 */
export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();

    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    // Verify the token is valid and not expired
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // ── Login tracking (fire-and-forget) ──────────────────────────────
    // Update lastLoginAt on every login. Flip 'invited' → 'active' on first login.
    const tenantId = decodedToken.tenantId || 'angsana';
    const uid = decodedToken.uid;
    try {
      const userRef = adminDb.collection('tenants').doc(tenantId).collection('users').doc(uid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const updates: Record<string, unknown> = {
          lastLoginAt: FieldValue.serverTimestamp(),
        };
        // First login: flip invited → active
        if (userData?.status === 'invited') {
          updates.status = 'active';
        }
        userRef.update(updates).catch((err: unknown) => {
          console.error('Login tracking write failed:', err);
        });
      }
    } catch (err) {
      // Non-blocking — don't fail the login flow
      console.error('Login tracking error:', err);
    }

    // Set the token as a cookie. The cookie expires when the token expires
    // (Firebase ID tokens are valid for 1 hour). The client refreshes the
    // token and re-POSTs before expiry.
    const response = NextResponse.json({
      status: 'ok',
      uid: decodedToken.uid,
      role: decodedToken.role,
    });

    response.cookies.set('__session', idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Firebase ID tokens expire after 1 hour
      maxAge: 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Session creation failed:', error);
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }
}

/**
 * DELETE /api/auth/session
 *
 * Clears the __session cookie on sign-out.
 */
export async function DELETE() {
  const response = NextResponse.json({ status: 'ok' });

  response.cookies.set('__session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
