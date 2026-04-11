import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

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
 * Default empty prospecting profile structure.
 * ICP removed — now lives per-proposition (Slice 8 Patch).
 */
function emptyProfile() {
  return {
    marketMessaging: [],
    recommendations: [],
    aiReview: { lastReviewDate: null, status: 'not-requested', findings: [] },
    lastUpdatedBy: '',
    lastUpdatedAt: '',
  };
}

/**
 * GET /api/clients/[clientId]/prospecting-profile
 * Get the full prospecting profile document.
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

  const docRef = adminDb
    .collection('tenants')
    .doc(user.tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('config')
    .doc('prospectingProfile');

  const snap = await docRef.get();

  if (!snap.exists) {
    return NextResponse.json({ profile: emptyProfile() });
  }

  const d = snap.data()!;

  // Normalise timestamps — ICP excluded (now per-proposition)
  const profile = {
    marketMessaging: (d.marketMessaging || []).map((entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: (entry.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || entry.createdAt || '',
    })),
    recommendations: (d.recommendations || []).map((entry: Record<string, unknown>) => ({
      ...entry,
      createdAt: (entry.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || entry.createdAt || '',
      lastUpdatedAt: (entry.lastUpdatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() || entry.lastUpdatedAt || '',
    })),
    aiReview: d.aiReview || { lastReviewDate: null, status: 'not-requested', findings: [] },
    lastUpdatedBy: d.lastUpdatedBy || '',
    lastUpdatedAt: d.lastUpdatedAt?.toDate?.()?.toISOString() || d.lastUpdatedAt || '',
  };

  return NextResponse.json({ profile });
}
