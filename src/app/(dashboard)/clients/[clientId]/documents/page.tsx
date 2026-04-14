// =============================================================================
// Angsana Exchange — Documents Page (Server Component)
// Slice 7A Steps 5 & 6: Documents UI
//
// Fetches folder template + campaigns server-side, then renders DocumentsClient.
// =============================================================================

import { Suspense } from 'react';
import { adminDb } from '@/lib/firebase/admin';
import { getUserContext } from '@/lib/auth/server';
import DocumentsClient from './DocumentsClient';
import type { DocumentFolderItem, Campaign } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

async function getDocumentFolders(tenantId: string): Promise<DocumentFolderItem[]> {
  try {
    const doc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('managedLists')
      .doc('documentFolders')
      .get();

    if (!doc.exists) return [];
    const data = doc.data();
    return (data?.items || []) as DocumentFolderItem[];
  } catch {
    return [];
  }
}

async function getCampaigns(
  tenantId: string,
  clientId: string
): Promise<Pick<Campaign, 'id' | 'campaignName' | 'status'>[]> {
  try {
    const snapshot = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .doc(clientId)
      .collection('campaigns')
      .orderBy('campaignName', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        campaignName: data.campaignName || '',
        status: data.status || 'draft',
      };
    });
  } catch {
    return [];
  }
}

async function getClientName(tenantId: string, clientId: string): Promise<string> {
  try {
    const doc = await adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('clients')
      .doc(clientId)
      .get();

    return doc.exists ? (doc.data()?.name || clientId) : clientId;
  } catch {
    return clientId;
  }
}

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getUserContext();
  const tenantId = user.claims.tenantId;

  const [folderTemplate, campaigns, clientName] = await Promise.all([
    getDocumentFolders(tenantId),
    getCampaigns(tenantId, clientId),
    getClientName(tenantId, clientId),
  ]);

  return (
    <PagePadding>
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#3B7584]" />
        </div>
      }
    >
      <DocumentsClient
        clientId={clientId}
        clientName={clientName}
        folderTemplate={folderTemplate}
        campaigns={campaigns}
      />
    </Suspense>
      </PagePadding>
  );
}
