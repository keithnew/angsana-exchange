import { adminDb } from '@/lib/firebase/admin';
import { getUserContext } from '@/lib/auth/server';
import { redirect } from 'next/navigation';
import { ManagedListsClient } from './ManagedListsClient';
import type { ManagedListName, ManagedListItem, DocumentFolderItem } from '@/types';
import { PagePadding } from '@/components/layout/PagePadding';

const LIST_NAMES: ManagedListName[] = [
  'serviceTypes',
  'sectors',
  'geographies',
  'titleBands',
  'companySizes',
  'therapyAreas',
  'propositionCategories',
  'messagingTypes',
];

/**
 * Managed Lists Admin Page — /admin/managed-lists
 *
 * Server component that:
 * 1. Verifies the user is internal-admin
 * 2. Fetches all managed lists from Firestore (generic + documentFolders)
 * 3. Passes data to the client component for CRUD interactions
 */
export default async function ManagedListsPage() {
  const user = await getUserContext();

  // Only internal-admin can access
  if (user.claims.role !== 'internal-admin') {
    redirect('/');
  }

  const { tenantId } = user.claims;

  // Fetch generic managed lists + documentFolders in parallel
  const [genericResults, docFoldersSnap] = await Promise.all([
    Promise.all(
      LIST_NAMES.map(async (listName) => {
        const doc = await adminDb
          .collection('tenants')
          .doc(tenantId)
          .collection('managedLists')
          .doc(listName)
          .get();

        const data = doc.exists ? doc.data()! : { items: [] };
        return {
          listName,
          items: (data.items || []) as ManagedListItem[],
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
          updatedBy: data.updatedBy || null,
        };
      })
    ),
    adminDb
      .collection('tenants')
      .doc(tenantId)
      .collection('managedLists')
      .doc('documentFolders')
      .get(),
  ]);

  const initialData: Record<string, { items: ManagedListItem[]; updatedAt: string | null; updatedBy: string | null }> = {};
  for (const result of genericResults) {
    initialData[result.listName] = {
      items: result.items,
      updatedAt: result.updatedAt,
      updatedBy: result.updatedBy,
    };
  }

  const docFoldersData = docFoldersSnap.exists ? docFoldersSnap.data()! : { items: [] };
  const documentFoldersInitial = {
    items: (docFoldersData.items || []) as DocumentFolderItem[],
    updatedAt: docFoldersData.updatedAt?.toDate?.()?.toISOString() || null,
    updatedBy: docFoldersData.updatedBy || null,
  };

  return (
    <PagePadding>
    <ManagedListsClient
      initialData={initialData}
      documentFoldersInitial={documentFoldersInitial}
    />
      </PagePadding>
  );
}
