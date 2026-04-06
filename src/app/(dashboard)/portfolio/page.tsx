import { adminDb } from '@/lib/firebase/admin';
import { getUserContext } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import PortfolioClientComponent from './PortfolioClient';

/**
 * Portfolio — /portfolio
 *
 * Landing page for internal-admin.
 * Cross-client dashboard showing all clients with key operational metrics.
 * Enhanced in Slice 4 with actions, check-ins, and wishlist data.
 *
 * Summary cards are clickable — they filter the client table below.
 * Clicking "Overdue Actions: 7" filters the table to only clients with
 * overdue actions, sorted by count descending. From there you click into
 * the client to see their specific Actions page.
 */

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts || !ts.toDate) return '';
  return ts.toDate().toISOString();
}

export default async function PortfolioPage() {
  const user = await getUserContext();

  // Only admin can see the portfolio
  if (user.claims.role !== 'internal-admin') {
    redirect('/');
  }

  const { tenantId } = user.claims;

  // Fetch all clients
  const clientsSnapshot = await adminDb
    .collection('tenants')
    .doc(tenantId)
    .collection('clients')
    .get();

  const now = new Date();

  const clients = await Promise.all(
    clientsSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      const clientId = doc.id;
      const clientRef = adminDb
        .collection('tenants')
        .doc(tenantId)
        .collection('clients')
        .doc(clientId);

      // Parallel fetches for each client
      const [campaignSnap, actionsSnap, checkInSnap, wishlistSnap] = await Promise.all([
        clientRef.collection('campaigns').get(),
        clientRef.collection('actions').where('status', 'in', ['open', 'in-progress']).get(),
        clientRef.collection('checkIns').orderBy('date', 'desc').limit(1).get(),
        clientRef.collection('wishlists').where('status', '==', 'new').get(),
      ]);

      const activeCampaigns = campaignSnap.docs.filter(
        (d) => d.data().status === 'active'
      ).length;

      // Count overdue actions
      const openActions = actionsSnap.size;
      let overdueActions = 0;
      actionsSnap.docs.forEach((actionDoc) => {
        const actionData = actionDoc.data();
        const dueDate = actionData.dueDate?.toDate?.();
        if (dueDate && dueDate < now) {
          overdueActions++;
        }
      });

      // Last check-in date
      const lastCheckIn = checkInSnap.docs.length > 0
        ? formatDate(checkInSnap.docs[0].data().date)
        : '';

      return {
        id: clientId,
        name: data.name || clientId,
        tier: data.tier || 'standard',
        totalCampaigns: campaignSnap.size,
        activeCampaigns,
        openActions,
        overdueActions,
        lastCheckIn,
        newWishlistItems: wishlistSnap.size,
      };
    })
  );

  return <PortfolioClientComponent clients={clients} />;
}
