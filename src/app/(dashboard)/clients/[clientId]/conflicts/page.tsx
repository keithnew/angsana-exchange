import { ConflictsClient } from './ConflictsClient';

export default async function ConflictsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ConflictsClient clientId={clientId} />;
}
