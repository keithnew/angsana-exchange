// =============================================================================
// Angsana Exchange — Admin Users Page
// Slice 6B: Replaces "Coming soon" placeholder with full user management.
// =============================================================================

import UsersClient from './UsersClient';

export default function AdminUsersPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-1">Manage all Exchange users — internal and client.</p>
      </div>
      <UsersClient />
    </div>
  );
}
