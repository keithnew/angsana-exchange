import { adminDb } from '@/lib/firebase/admin';
import { getUserContext } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import PortfolioClientComponent from './PortfolioClient';
import { PagePadding } from '@/components/layout/PagePadding';
import { listActionLiteForClient } from '@/lib/workItems/actionLitePersistence';

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

      // Parallel fetches for each client. S3-code-P4: actions now read
      // cross-project from action-lite Work Items on `angsana-core-prod`
      // via `listActionLiteForClient`. The campaign snapshot is fetched
      // first (cheap, local) so we can pass campaignIds into the
      // cross-project query for the campaign-subject branch.
      const [campaignSnap, checkInSnap, wishlistSnap] = await Promise.all([
        clientRef.collection('campaigns').get(),
        clientRef.collection('checkIns').orderBy('date', 'desc').limit(1).get(),
        clientRef.collection('wishlists').where('status', '==', 'new').get(),
      ]);

      const activeCampaigns = campaignSnap.docs.filter(
        (d) => d.data().status === 'active'
      ).length;

      // S3-code-P4: action-lite read replaces legacy actions/ collection
      // query. Filter to non-terminal-non-blocked-or-blocked
      // (legacy `status in [open, in-progress]` ≡ action-lite
      //  `state !== 'done' && state !== 'blocked'`).
      const allActionsForClient = await listActionLiteForClient({
        tenantId,
        clientId,
        campaignIds: campaignSnap.docs.map((d) => d.id),
      });
      const openActionsArray = allActionsForClient.filter(
        (a) => a.state !== 'done' && a.state !== 'blocked'
      );
      const openActions = openActionsArray.length;

      // Count overdue actions — action-lite carries `deadline` as an
      // ISO string (or null); compare against now.
      let overdueActions = 0;
      openActionsArray.forEach((a) => {
        if (a.deadline && new Date(a.deadline) < now) {
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

  return <PagePadding><PortfolioClientComponent clients={clients} /></PagePadding>;
}
