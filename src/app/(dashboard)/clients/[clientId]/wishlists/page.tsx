import { getUserContext } from '@/lib/auth/server';
import { adminDb } from '@/lib/firebase/admin';
import WishlistListClient from './WishlistListClient';
import type { WishlistItem, Campaign } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function WishlistsPage({ params }: Props) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  // Fetch wishlists
  const wishlistSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('wishlists')
    .orderBy('addedDate', 'desc')
    .get();

  const wishlists: WishlistItem[] = wishlistSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      companyName: d.companyName || '',
      sector: d.sector || '',
      geography: d.geography || '',
      priority: d.priority || 'medium',
      notes: d.notes || '',
      status: d.status || 'new',
      campaignRef: d.campaignRef || '',
      addedBy: d.addedBy || '',
      addedDate: d.addedDate?.toDate?.()?.toISOString() || '',
      updatedAt: d.updatedAt?.toDate?.()?.toISOString() || '',
    };
  });

  // Fetch campaigns for the campaign dropdown
  const campaignSnap = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .doc(clientId)
    .collection('campaigns')
    .get();

  const campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[] = campaignSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      campaignName: d.campaignName || '',
      status: d.status || 'draft',
    };
  });

  // Fetch managed lists for dropdowns
  const [sectorsSnap, geosSnap] = await Promise.all([
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('sectors').get(),
    adminDb.collection('tenants').doc(tenantId).collection('managedLists').doc('geographies').get(),
  ]);

  const sectors = (sectorsSnap.data()?.items || []).filter((i: { active: boolean }) => i.active);
  const geographies = (geosSnap.data()?.items || []).filter((i: { active: boolean }) => i.active);

  return (
    <PagePadding>
    <WishlistListClient
      clientId={clientId}
      wishlists={wishlists}
      campaigns={campaigns}
      sectors={sectors}
      geographies={geographies}
      userRole={user.claims.role}
      userEmail={user.email}
    />
      </PagePadding>
  );
}
