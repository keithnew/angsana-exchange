// =============================================================================
// /api/tenant/users
//
// S3-code-P3 — directory endpoint for the MentionPicker (composer).
//
// Reads `tenants/{tenantId}/users/*` and returns a slim shape:
//   { uid, email, displayName, role, status }
//
// Only the fields the picker needs. The picker computes
// `audienceClass` per user via `lib/mentions/audienceClass.ts`
// (compute-on-read, Decision #11).
//
// Auth: any authenticated user can read the directory of their own
// tenant. The directory is already used elsewhere in the app (e.g.
// `app/(dashboard)/clients/[clientId]/prospecting-profile/page.tsx`)
// for UID→displayName resolution; this endpoint is the picker's
// dedicated surface so the picker doesn't need to be a server
// component.
//
// Filtering:
//   - Disabled users excluded (status !== 'active' && status !== 'invited').
//     Picker only surfaces actionable accounts.
//   - For client users (clientId set on the caller), ALSO filters down to
//     users whose own `clientId` matches OR who are internal. This is
//     the §"Directive-context-only" Decision #6 affordance — Exchange
//     scopes the picker to the caller's tenant + (when the caller is a
//     client user) the caller's client. S5 does NOT inherit this.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

import {
  getRequestUser,
  isInternal,
} from '@/lib/auth/requestUser';

interface SlimUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  /**
   * Optional clientId from the user doc (client-tenant users have one;
   * internal users do not). Echoed for the picker so it can render
   * "(at <client>)" hints if it wants — today the picker doesn't.
   */
  clientId: string | null;
}

export async function GET(request: NextRequest) {
  const user = getRequestUser(request);
  if (!user.uid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const usersRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('users');
  const snap = await usersRef.get();

  const all: SlimUser[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      uid: d.id,
      email: (data.email as string) ?? '',
      displayName:
        (data.displayName as string) || (data.email as string) || d.id,
      role: (data.role as string) ?? '',
      status: (data.status as string) ?? 'active',
      clientId: (data.clientId as string | undefined) ?? null,
    };
  });

  const callerInternal = isInternal(user);
  const callerClientId = user.clientId;

  const filtered = all.filter((u) => {
    // Drop disabled accounts.
    if (u.status !== 'active' && u.status !== 'invited') return false;

    // Internal callers see everyone in the tenant directory.
    if (callerInternal) return true;

    // Client callers see internal users + members of their own client.
    // (§"Directive-context-only" — Exchange scopes the picker to the
    // caller's client when the caller is a client user.)
    if (
      u.role === 'internal-admin' ||
      u.role === 'internal-user' ||
      u.role === 'am' ||
      u.role === 'ad' ||
      u.role === 'researcher' ||
      u.role === 'curator'
    ) {
      return true;
    }
    return u.clientId === callerClientId;
  });

  return NextResponse.json({ users: filtered });
}
