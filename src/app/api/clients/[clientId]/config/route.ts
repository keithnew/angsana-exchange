import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * GET /api/clients/{clientId}/config
 * Returns the client config document.
 * Accessible to internal-admin and internal-user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const role = request.headers.get('x-user-role') || '';
  const tenantId = request.headers.get('x-user-tenant') || 'angsana';

  if (role !== 'internal-admin' && role !== 'internal-user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const doc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  if (!doc.exists) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const data = doc.data()!;
  return NextResponse.json({
    id: doc.id,
    name: data.name || '',
    slug: data.slug || '',
    tier: data.tier || 'standard',
    capabilities: data.capabilities || [],
    competitors: data.competitors || [],
    logoPath: data.logoPath || null,
    therapyAreas: data.therapyAreas || [],
    conflictedTherapyAreas: data.conflictedTherapyAreas || [],
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
    updatedBy: data.updatedBy || '',
  });
}

/**
 * PUT /api/clients/{clientId}/config
 * Updates the client config document.
 * Only internal-admin can write.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const role = request.headers.get('x-user-role') || '';
  const email = request.headers.get('x-user-email') || '';
  const tenantId = request.headers.get('x-user-tenant') || 'angsana';

  if (role !== 'internal-admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await request.json();

  // Build update object — only write fields that are provided
  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: email,
  };

  if (body.name !== undefined) update.name = body.name;
  if (body.tier !== undefined) update.tier = body.tier;
  if (body.capabilities !== undefined) update.capabilities = body.capabilities;
  if (body.competitors !== undefined) update.competitors = body.competitors;
  if (body.therapyAreas !== undefined) update.therapyAreas = body.therapyAreas;
  if (body.conflictedTherapyAreas !== undefined) update.conflictedTherapyAreas = body.conflictedTherapyAreas;

  await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .update(update);

  return NextResponse.json({ success: true });
}
