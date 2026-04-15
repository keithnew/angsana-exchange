import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import type { ConflictDomainType, ConflictScope, ConflictStatus } from '@/types';

/**
 * Helper: extract user claims from request headers (set by middleware).
 */
function getUserFromHeaders(request: NextRequest) {
  return {
    uid: request.headers.get('x-user-uid') || '',
    role: request.headers.get('x-user-role') || '',
    tenantId: request.headers.get('x-user-tenant') || 'angsana',
    email: request.headers.get('x-user-email') || '',
    clientId: request.headers.get('x-user-client') || null,
    assignedClients: JSON.parse(request.headers.get('x-assigned-clients') || '[]'),
  };
}

function hasClientAccess(user: ReturnType<typeof getUserFromHeaders>, clientId: string): boolean {
  if (user.clientId) return user.clientId === clientId;
  if (user.assignedClients?.includes('*')) return true;
  return user.assignedClients?.includes(clientId) ?? false;
}

/**
 * GET /api/clients/[clientId]/conflicts
 *
 * List conflicts for a client with optional filters.
 * Query params:
 *   - status: 'active' | 'removed' | 'all' (default: 'active')
 *   - domainType: 'therapy-area' | 'product-category' | 'industry-segment' | 'all' (default: 'all')
 *   - scope: 'industry-wide' | 'company-specific' | 'all' (default: 'all')
 *   - search: case-insensitive substring match across conflictDomain, companyName, scopeDetail, notes
 *
 * Sort: conflictDomain ASC, then addedAt DESC.
 * All roles can read. Client users are auto-scoped to their own clientId.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const user = getUserFromHeaders(request);

  if (!hasClientAccess(user, clientId)) {
    return NextResponse.json({ error: 'Forbidden: no access to this client' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = (searchParams.get('status') || 'active') as ConflictStatus | 'all';
  const domainTypeFilter = (searchParams.get('domainType') || 'all') as ConflictDomainType | 'all';
  const scopeFilter = (searchParams.get('scope') || 'all') as ConflictScope | 'all';
  const searchQuery = (searchParams.get('search') || '').toLowerCase().trim();

  // Build Firestore query
  let query: FirebaseFirestore.Query = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('conflicts');

  // Status filter — Firestore-level
  if (statusFilter !== 'all') {
    query = query.where('status', '==', statusFilter);
  }

  // Sort: conflictDomain ASC, addedAt DESC
  query = query.orderBy('conflictDomain', 'asc').orderBy('addedAt', 'desc');

  const snapshot = await query.get();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      // Convert Firestore timestamps to ISO strings
      addedAt: data.addedAt?.toDate?.()?.toISOString() ?? data.addedAt,
      removedAt: data.removedAt?.toDate?.()?.toISOString() ?? data.removedAt ?? null,
    };
  });

  // Domain type filter — client-side (keeps Firestore index simple)
  if (domainTypeFilter !== 'all') {
    entries = entries.filter((e: any) => e.domainType === domainTypeFilter);
  }

  // Scope filter — client-side
  if (scopeFilter !== 'all') {
    entries = entries.filter((e: any) => e.scope === scopeFilter);
  }

  // Search filter — client-side (Firestore doesn't support case-insensitive substring)
  if (searchQuery) {
    entries = entries.filter((e: any) => {
      const haystack = [e.conflictDomain, e.companyName, e.scopeDetail, e.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchQuery);
    });
  }

  return NextResponse.json({ data: entries, count: entries.length });
}

/**
 * POST /api/clients/[clientId]/conflicts
 * Placeholder for later step — returns 501 Not Implemented.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Not implemented. Create/edit functionality coming in a later step.' },
    { status: 501 }
  );
}
