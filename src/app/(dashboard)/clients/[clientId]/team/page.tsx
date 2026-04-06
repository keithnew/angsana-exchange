// =============================================================================
// Angsana Exchange — Client Team Page
// Slice 6B: /clients/{clientId}/team
// Client-approvers can invite/deactivate. Client-viewers see read-only list.
// =============================================================================

import TeamClient from './TeamClient';

export default async function TeamPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-500 mt-1">Manage who has access to Exchange for your organisation.</p>
      </div>
      <TeamClient clientId={clientId} />
    </div>
  );
}
