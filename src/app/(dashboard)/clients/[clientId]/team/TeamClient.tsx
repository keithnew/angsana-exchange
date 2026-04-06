'use client';

// =============================================================================
// Angsana Exchange — Client Team Page (Client Component)
// Slice 6B: Client-approvers can invite/deactivate. Client-viewers see read-only.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { apiFetch } from '@/lib/api/client-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus, Mail, Ban, MoreHorizontal } from 'lucide-react';

interface TeamUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

const ROLE_COLOURS: Record<string, string> = {
  'client-approver': 'bg-amber-500 text-white',
  'client-viewer': 'bg-purple-400 text-white',
};

const STATUS_COLOURS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  invited: 'bg-amber-100 text-amber-800',
  disabled: 'bg-gray-200 text-gray-600',
};

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ─── Invite Dialog ──────────────────────────────────────────────────────────

function InviteDialog({
  open, onClose, onSuccess, clientId,
}: {
  open: boolean; onClose: () => void; onSuccess: () => void; clientId: string;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('client-viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/users/provision', {
        method: 'POST',
        body: JSON.stringify({ email, displayName, role, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite user');
      setSuccess(`Invite sent to ${email}`);
      setTimeout(() => { onSuccess(); onClose(); setEmail(''); setDisplayName(''); setRole('client-viewer'); setSuccess(''); }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally { setLoading(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Invite Team Member</h2>
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
              <option value="client-viewer">Viewer</option>
              <option value="client-approver">Approver</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Inviting...' : 'Send Invite'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function TeamClient({ clientId }: { clientId: string }) {
  const authContext = useAuth();
  const isApprover = authContext.claims.role === 'client-approver';
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [actionMenuUid, setActionMenuUid] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    try {
      const res = await apiFetch(`/users?where=clientId==${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setUsers((data.documents || []).map((d: { id: string; [key: string]: unknown }) => ({ uid: d.id, ...d })));
      }
    } catch (err) { console.error('Failed to fetch team:', err); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleDisable = async (uid: string, name: string) => {
    if (!confirm(`Deactivate ${name}? They will no longer be able to access Exchange.`)) return;
    setActionMenuUid(null);
    try {
      const res = await apiFetch(`/users/${uid}/disable`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); alert(d.error); }
      fetchTeam();
    } catch { alert('Failed to deactivate user'); }
  };

  const handleResend = async (uid: string) => {
    setActionMenuUid(null);
    try {
      const res = await apiFetch(`/users/${uid}/resend-invite`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); alert(d.error); }
      else alert('Invite resent successfully.');
    } catch { alert('Failed to resend invite'); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading team...</div>;

  return (
    <div className="space-y-4">
      {isApprover && (
        <div className="flex justify-end">
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Invite Team Member
          </Button>
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-500">Name</th>
              <th className="px-4 py-3 font-medium text-gray-500">Role</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 font-medium text-gray-500">Last Login</th>
              {isApprover && <th className="px-4 py-3 font-medium text-gray-500 w-12"></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.uid} className={`hover:bg-gray-50 ${u.status === 'invited' ? 'opacity-75' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{u.displayName}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLOURS[u.role] || 'bg-gray-200 text-gray-800'}`}>
                    {u.role === 'client-approver' ? 'Approver' : 'Viewer'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[u.status] || 'bg-gray-200'}`}>
                    {u.status === 'invited' ? 'Pending' : u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${!u.lastLoginAt ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                    {relativeDate(u.lastLoginAt)}
                  </span>
                </td>
                {isApprover && (
                  <td className="px-4 py-3 relative">
                    <button onClick={() => setActionMenuUid(actionMenuUid === u.uid ? null : u.uid)} className="p-1 hover:bg-gray-100 rounded">
                      <MoreHorizontal className="h-4 w-4 text-gray-400" />
                    </button>
                    {actionMenuUid === u.uid && (
                      <div className="absolute right-4 top-10 z-20 bg-white border rounded-lg shadow-lg py-1 w-44">
                        {u.status === 'invited' && (
                          <button onClick={() => handleResend(u.uid)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5" /> Resend Invite
                          </button>
                        )}
                        {u.status !== 'disabled' && (
                          <button onClick={() => handleDisable(u.uid, u.displayName)} className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600 flex items-center gap-2">
                            <Ban className="h-3.5 w-3.5" /> Deactivate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={isApprover ? 5 : 4} className="px-4 py-8 text-center text-gray-500">No team members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <InviteDialog
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSuccess={fetchTeam}
        clientId={clientId}
      />
    </div>
  );
}
