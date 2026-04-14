import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, hasClientAccess, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { ClientSettingsClient } from './ClientSettingsClient';
import type { ClientConfig, ManagedListItem } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

/**
 * Client Settings Page — /clients/[clientId]/settings
 *
 * Server component that loads client config and therapy area managed list,
 * then renders the client-side settings form.
 * Visible to internal-admin (can edit) and internal-user (view only).
 */
export default async function ClientSettingsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getUserContext();
  const { tenantId, role } = user.claims;

  // Only internal roles can see settings
  if (!isInternalRole(role)) {
    redirect(`/clients/${clientId}/dashboard`);
  }

  // Access check
  if (!hasClientAccess(user.claims, clientId)) {
    redirect('/');
  }

  // Fetch client config
  const clientDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .get();

  if (!clientDoc.exists) {
    redirect('/');
  }

  const data = clientDoc.data()!;
  const clientConfig: ClientConfig = {
    id: clientDoc.id,
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
  };

  // Fetch therapy areas managed list (for the multi-select options)
  const therapyDoc = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('managedLists')
    .doc('therapyAreas')
    .get();

  const therapyAreaOptions: ManagedListItem[] = therapyDoc.exists
    ? (therapyDoc.data()?.items || []).filter((i: ManagedListItem) => i.active)
    : [];

  const canEdit = role === 'internal-admin';

  return (
    <PagePadding>
    <ClientSettingsClient
      clientId={clientId}
      config={clientConfig}
      therapyAreaOptions={therapyAreaOptions}
      canEdit={canEdit}
    />
      </PagePadding>
  );
}
