import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { getUserContext, isInternalRole } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

/**
 * My Clients — /my-clients
 *
 * Landing page for internal-user and internal-admin.
 * Shows the user's assigned clients with campaign counts and operational metrics.
 * Enhanced in Slice 4 with actions, check-ins, and wishlist data.
 *
 * Each metric row in the card is individually clickable, linking to the
 * relevant client module page. The card itself is not a single link.
 */

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts || !ts.toDate) return '';
  return ts.toDate().toISOString();
}

function daysSince(isoDate: string): number {
  if (!isoDate) return Infinity;
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatShortDate(iso: string): string {
  if (!iso) return 'None';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function MyClientsPage() {
  const user = await getUserContext();

  // Only internal users should see this page
  if (!isInternalRole(user.claims.role)) {
    redirect('/');
  }

  const { tenantId, assignedClients } = user.claims;
  const isAdmin = assignedClients?.includes('*');

  // Determine which clients to show
  let clientIds: string[] = [];
  if (isAdmin) {
    const snapshot = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .get();
    clientIds = snapshot.docs.map((doc) => doc.id);
  } else {
    clientIds = assignedClients || [];
  }

  const now = new Date();

  // Fetch client configs, campaign counts, and operational metrics
  const clients = await Promise.all(
    clientIds.map(async (clientId) => {
      const clientRef = adminDb
        .collection('tenants')
        .doc(tenantId)
        .collection('clients')
        .doc(clientId);

      // Parallel fetches
      const [clientDoc, campaignSnap, actionsSnap, checkInSnap, wishlistSnap] = await Promise.all([
        clientRef.get(),
        clientRef.collection('campaigns').get(),
        clientRef.collection('actions').where('status', 'in', ['open', 'in-progress']).get(),
        clientRef.collection('checkIns').orderBy('date', 'desc').limit(1).get(),
        clientRef.collection('wishlists').where('status', '==', 'new').get(),
      ]);

      const data = clientDoc.data();
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
        name: data?.name || clientId,
        tier: data?.tier || 'standard',
        totalCampaigns: campaignSnap.size,
        activeCampaigns,
        openActions,
        overdueActions,
        lastCheckIn,
        newWishlistItems: wishlistSnap.size,
      };
    })
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">
          My Clients
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {clients.length} client{clients.length !== 1 ? 's' : ''} assigned
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((client) => {
          const checkInDays = daysSince(client.lastCheckIn);
          const checkInColour =
            checkInDays === Infinity ? 'text-red-600'
              : checkInDays > 30 ? 'text-red-600'
              : checkInDays > 14 ? 'text-amber-600'
              : 'text-[var(--muted)]';

          return (
            <div
              key={client.id}
              className="rounded-lg border border-gray-200 bg-white p-6"
            >
              {/* Client name — links to campaigns (default landing) */}
              <Link
                href={`/clients/${client.id}/campaigns`}
                className="text-lg font-semibold text-[var(--foreground)] hover:text-[var(--primary)] hover:underline"
              >
                {client.name}
              </Link>
              <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-[var(--muted)]">
                {client.tier}
              </span>

              {/* Campaign metrics — link to campaigns */}
              <Link
                href={`/clients/${client.id}/campaigns`}
                className="mt-4 flex gap-6 text-sm hover:opacity-80 transition-opacity"
              >
                <div>
                  <span className="text-2xl font-bold text-[var(--primary)]">
                    {client.activeCampaigns}
                  </span>
                  <p className="text-[var(--muted)]">Active</p>
                </div>
                <div>
                  <span className="text-2xl font-bold text-[var(--foreground)]">
                    {client.totalCampaigns}
                  </span>
                  <p className="text-[var(--muted)]">Total</p>
                </div>
              </Link>

              {/* Operational metrics — each row links to its module */}
              <div className="mt-4 pt-3 border-t border-gray-100 space-y-1 text-sm">
                {/* Open actions → actions page */}
                <Link
                  href={`/clients/${client.id}/actions`}
                  className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded hover:bg-gray-50 transition-colors"
                >
                  <span className="text-[var(--muted)]">Open Actions</span>
                  <span className={`font-medium ${client.overdueActions > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {client.openActions}
                    {client.overdueActions > 0 && (
                      <span className="ml-1 text-red-600 text-xs">
                        ({client.overdueActions} overdue)
                      </span>
                    )}
                  </span>
                </Link>

                {/* Last check-in → check-ins page */}
                <Link
                  href={`/clients/${client.id}/checkins`}
                  className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded hover:bg-gray-50 transition-colors"
                >
                  <span className="text-[var(--muted)]">Last Check-in</span>
                  <span className={`font-medium ${checkInColour}`}>
                    {client.lastCheckIn ? formatShortDate(client.lastCheckIn) : 'None'}
                  </span>
                </Link>

                {/* New wishlist items → wishlists page (filtered to new) */}
                {client.newWishlistItems > 0 && (
                  <Link
                    href={`/clients/${client.id}/wishlists?status=new`}
                    className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-[var(--muted)]">New Wishlist</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-blue-700 bg-blue-100">
                      {client.newWishlistItems}
                    </span>
                  </Link>
                )}
              </div>
            </div>
          );
        })}

        {clients.length === 0 && (
          <p className="col-span-full text-sm text-[var(--muted)]">
            No clients assigned yet.
          </p>
        )}
      </div>
    </div>
  );
}
