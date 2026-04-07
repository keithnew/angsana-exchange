import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

/**
 * Force Node.js runtime — firebase-admin requires Node.js APIs
 * that aren't available in the Edge runtime.
 */
export const runtime = 'nodejs';

/**
 * JWT Middleware — validates Firebase Auth tokens on every protected request.
 *
 * Flow:
 * 1. Read __session cookie (set by POST /api/auth/session after login)
 *    — OR — Authorization: Bearer {token} header (for API routes called via curl/programmatic)
 * 2. Verify the Firebase ID token using Admin SDK
 * 3. Extract custom claims (tenantId, role, clientId, assignedClients, permittedModules)
 * 4. Forward claims as request headers for server components and API routes
 * 5. Redirect to /login if token is missing, invalid, or expired (pages)
 *    — OR — return 401 JSON (API routes)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');

  // Public routes — no auth required
  // /api/v1/* is excluded because the Exchange programmatic API handles its own
  // multi-method auth (Firebase tokens, API keys, future client JWTs).
  // Without this exclusion, API key callers would receive a 302 redirect to /login.
  const publicRoutes = ['/login', '/api/auth/session', '/api/health', '/api/v1/'];
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Resolve the token from either:
  // 1. __session cookie (browser UI)
  // 2. Authorization: Bearer header (curl / programmatic callers)
  let token = request.cookies.get('__session')?.value;

  if (!token) {
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ') && authHeader.length > 7) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Authentication required. Provide a session cookie or Authorization: Bearer token.', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    // Verify token and extract claims
    const decoded = await adminAuth.verifyIdToken(token);

    const role = (decoded.role as string) || '';
    const tenantId = (decoded.tenantId as string) || '';
    const clientId = (decoded.clientId as string) || '';
    const assignedClients = (decoded.assignedClients as string[]) || [];
    const permittedModules = (decoded.permittedModules as string[]) || [];
    const displayName = decoded.name || decoded.email || '';

    // Forward claims via request headers for downstream server components
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-uid', decoded.uid);
    requestHeaders.set('x-user-email', decoded.email || '');
    requestHeaders.set('x-user-display-name', displayName);
    requestHeaders.set('x-user-role', role);
    requestHeaders.set('x-user-tenant', tenantId);
    requestHeaders.set('x-user-client', clientId);
    requestHeaders.set('x-assigned-clients', JSON.stringify(assignedClients));
    requestHeaders.set('x-permitted-modules', JSON.stringify(permittedModules));

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Invalid or expired authentication token.', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    // Token invalid or expired — redirect to login
    const response = NextResponse.redirect(new URL('/login', request.url));
    // Clear the invalid cookie
    response.cookies.set('__session', '', { maxAge: 0, path: '/' });
    return response;
  }
}

/**
 * Match all routes except static assets and Next.js internals.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'],
};
