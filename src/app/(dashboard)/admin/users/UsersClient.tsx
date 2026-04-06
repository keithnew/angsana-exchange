'use client';

// =============================================================================
// Angsana Exchange — Admin Users Page (Client Component)
// Slice 6B: Full user management with create, edit, disable, enable, resend invite.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus, Search, MoreHorizontal, Mail, Ban, CheckCircle, Trash2 } from 'lucide-react';

/** Fetch helper — relies on __session cookie sent automatically by the browser */
function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`/api/v1/exchange/prod/api${path.startsWith('/') ? path : '/' + path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
    credentials: 'same-origin',
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  clientId: string | null;
  assignedClients: string[] | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string | null;
}

interface ClientDoc {
  id: string;
  name: string;
}

type RoleFilter = 'all' | 'internal-admin' | 'internal-user' | 'client-approver' | 'client-viewer';
type StatusFilter = 'all' | 'active' | 'invited' | 'disabled';

// ─── Badge Components ───────────────────────────────────────────────────────

const ROLE_COLOURS: Record<string, string> = {
  'internal-admin': 'bg-teal-800 text-white',
  'internal-user': 'bg-teal-600 text-white',
  'client-approver': 'bg-amber-500 text-white',
  'client-viewer': 'bg-purple-400 text-white',
};

const STATUS_COLOURS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  invited: 'bg-amber-100 text-amber-800',
  disabled: 'bg-gray-200 text-gray-600',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOURS[role] || 'bg-gray-200 text-gray-800'}`}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'invited' ? 'Pending' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[status] || 'bg-gray-200 text-gray-800'}`}>
      {label}
    </span>
  );
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

// ─── Create User Dialog ─────────────────────────────────────────────────────

function CreateUserDialog({
  open, onClose, onSuccess, clients,
}: {
  open: boolean; onClose: () => void; onSuccess: () => void; clients: ClientDoc[];
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<string>('client-viewer');
  const [clientId, setClientId] = useState('');
  const [assignedClients, setAssignedClients] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isClientRole = role === 'client-approver' || role === 'client-viewer';
  const isInternalUser = role === 'internal-user';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const body: Record<string, unknown> = { email, displayName, role };
      if (isClientRole) body.clientId = clientId;
      if (isInternalUser) body.assignedClients = assignedClients;

      const res = await authedFetch('/users/provision', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setSuccess(`Password reset link sent to ${email}`);
      setTimeout(() => {
        onSuccess();
        onClose();
        resetForm();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEmail('');
    setDisplayName('');
    setRole('client-viewer');
    setClientId('');
    setAssignedClients([]);
    setError('');
    setSuccess('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Add User</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select className="w-full border rounded-md px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="internal-admin">Internal Admin</option>
              <option value="internal-user">Internal User</option>
              <option value="client-approver">Client Approver</option>
              <option value="client-viewer">Client Viewer</option>
            </select>
          </div>
          {isClientRole && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {isInternalUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Clients</label>
              <div className="border rounded-md p-2 max-h-32 overflow-y-auto space-y-1">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={assignedClients.includes(c.id)}
                      onChange={(e) => {
                        if (e.target.checked) setAssignedClients([...assignedClients, c.id]);
                        else setAssignedClients(assignedClients.filter((id) => id !== c.id));
                      }}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { onClose(); resetForm(); }}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create User'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function UsersClient() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [actionMenuUid, setActionMenuUid] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authedFetch('/users');
      if (res.ok) {
        const data = await res.json();
        setUsers((data.documents || []).map((d: { id: string; [key: string]: unknown }) => ({ uid: d.id, ...d })));
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const res = await authedFetch('/clients');
      if (res.ok) {
        const data = await res.json();
        setClients((data.documents || []).map((d: { id: string; name?: string }) => ({ id: d.id, name: (d.name as string) || d.id })));
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    }
  }, []);

  useEffect(() => { fetchUsers(); fetchClients(); }, [fetchUsers, fetchClients]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!u.displayName?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    pending: users.filter((u) => u.status === 'invited').length,
    disabled: users.filter((u) => u.status === 'disabled').length,
  }), [users]);

  const getClientName = (clientId: string | null): string => {
    if (!clientId) return 'All Clients';
    const client = clients.find((c) => c.id === clientId);
    return client?.name || clientId;
  };

  const handleAction = async (uid: string, action: string) => {
    setActionMenuUid(null);
    const endpoint = `/users/${uid}/${action}`;
    try {
      const res = await authedFetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || `Failed to ${action} user`);
      }
      fetchUsers();
    } catch { alert(`Failed to ${action} user`); }
  };

  const handleDelete = async (uid: string, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone. Historical records will retain this user's name.`)) return;
    setActionMenuUid(null);
    // Soft delete: disable + mark deleted
    try {
      await authedFetch(`/users/${uid}/disable`, { method: 'POST' });
      // Mark as deleted in Firestore via PATCH
      await authedFetch(`/users/${uid}`, {
        method: 'PATCH',
        body: JSON.stringify({ deletedAt: new Date().toISOString() }),
      });
      fetchUsers();
    } catch { alert('Failed to delete user'); }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading users...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">Total Users</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{counts.total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{counts.active}</div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-amber-50" onClick={() => setStatusFilter('invited')}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-amber-600">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{counts.pending}</div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-gray-50" onClick={() => setStatusFilter('disabled')}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-gray-500">Disabled</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-gray-400">{counts.disabled}</div></CardContent>
        </Card>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search by name or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
          <option value="all">All Roles</option>
          <option value="internal-admin">Internal Admin</option>
          <option value="internal-user">Internal User</option>
          <option value="client-approver">Client Approver</option>
          <option value="client-viewer">Client Viewer</option>
        </select>
        <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="invited">Pending</option>
          <option value="disabled">Disabled</option>
        </select>
        <Button onClick={() => setShowCreateDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> Add User
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-500">Name</th>
              <th className="px-4 py-3 font-medium text-gray-500">Role</th>
              <th className="px-4 py-3 font-medium text-gray-500">Client</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 font-medium text-gray-500">Last Login</th>
              <th className="px-4 py-3 font-medium text-gray-500 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredUsers.map((u) => (
              <tr key={u.uid} className={`hover:bg-gray-50 ${u.status === 'invited' ? 'opacity-75' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{u.displayName}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3 text-gray-600 text-xs">{getClientName(u.clientId)}</td>
                <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${!u.lastLoginAt ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                    {relativeDate(u.lastLoginAt)}
                  </span>
                </td>
                <td className="px-4 py-3 relative">
                  <button onClick={() => setActionMenuUid(actionMenuUid === u.uid ? null : u.uid)} className="p-1 hover:bg-gray-100 rounded">
                    <MoreHorizontal className="h-4 w-4 text-gray-400" />
                  </button>
                  {actionMenuUid === u.uid && (
                    <div className="absolute right-4 top-10 z-20 bg-white border rounded-lg shadow-lg py-1 w-48">
                      {u.status !== 'disabled' && (
                        <button onClick={() => handleAction(u.uid, 'disable')} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <Ban className="h-3.5 w-3.5" /> Disable
                        </button>
                      )}
                      {u.status === 'disabled' && (
                        <button onClick={() => handleAction(u.uid, 'enable')} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <CheckCircle className="h-3.5 w-3.5" /> Enable
                        </button>
                      )}
                      {u.status !== 'disabled' && (
                        <button onClick={() => handleAction(u.uid, 'resend-invite')} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5" /> Resend Invite
                        </button>
                      )}
                      <button onClick={() => handleDelete(u.uid, u.displayName)} className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Dialog */}
      <CreateUserDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSuccess={fetchUsers}
        clients={clients}
      />
    </div>
  );
}
