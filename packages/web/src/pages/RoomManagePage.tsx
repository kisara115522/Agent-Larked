import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { get, post, patch, del } from '../api/client';
import { AdminLoginPage } from './AdminLoginPage';

interface Room {
  id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  member_count: number;
  created_by: string;
  created_at: string;
}

interface RoomMember {
  agent_id: string;
  name: string;
  display_name: string;
  status: string;
  joined_at: string;
}

function RoomManageContent() {
  const { adminToken, adminUser, adminLogout } = useAdminAuth();
  const token = adminToken!;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createVisibility, setCreateVisibility] = useState<'public' | 'private'>('public');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('public');
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ rooms: Room[] }>('/admin/rooms', token);
      setRooms(res.rooms);
    } catch (err) {
      setError((err as Error).message || 'Failed to load rooms');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setError('');
    try {
      await post('/admin/rooms', token, {
        name: createName.trim(),
        description: createDesc.trim(),
        visibility: createVisibility,
      });
      setCreateName('');
      setCreateDesc('');
      setCreateVisibility('public');
      setShowCreate(false);
      loadRooms();
    } catch (err) {
      setError((err as Error).message || 'Create failed');
    }
  };

  const handleEdit = (room: Room) => {
    setEditId(room.id);
    setEditName(room.name);
    setEditDesc(room.description || '');
    setEditVisibility(room.visibility);
  };

  const handleSave = async (id: string) => {
    setError('');
    try {
      await patch(`/admin/rooms/${id}`, token, {
        name: editName.trim(),
        description: editDesc.trim(),
        visibility: editVisibility,
      });
      setEditId(null);
      loadRooms();
    } catch (err) {
      setError((err as Error).message || 'Update failed');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete room "${name}"? All messages, members, and invites will be permanently removed. This cannot be undone.`)) return;
    setError('');
    try {
      await del(`/admin/rooms/${id}`, token);
      if (detailRoom?.id === id) setDetailRoom(null);
      loadRooms();
    } catch (err) {
      setError((err as Error).message || 'Delete failed');
    }
  };

  const showDetail = async (room: Room) => {
    setDetailRoom(room);
    setDetailLoading(true);
    try {
      const res = await get<{ members: RoomMember[] }>(`/rooms/${room.id}/members`, token);
      setMembers(res.members);
    } catch {
      setMembers([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRemoveMember = async (roomId: string, agentId: string) => {
    setError('');
    try {
      await del(`/admin/rooms/${roomId}/members/${agentId}`, token);
      setMembers(prev => prev.filter(m => m.agent_id !== agentId));
    } catch (err) {
      setError((err as Error).message || 'Remove member failed');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Room Management</h1>
            <p className="text-sm text-text-muted mt-1">
              <NavLink to="/admin" className="text-accent hover:underline">Agent Management</NavLink>
              {' '}&middot;{' '}
              Logged in as <span className="text-accent">{adminUser?.display_name || adminUser?.username}</span>
              {' '}&middot;{' '}
              <button onClick={adminLogout} className="text-text-muted hover:text-error transition-colors">Logout</button>
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            + New Room
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-sm text-error">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-surface rounded-lg border border-border p-4 w-96" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-medium mb-3">Create New Room</h3>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Room name (unique)"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
              />
              <input
                type="text"
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
              />
              <select
                value={createVisibility}
                onChange={e => setCreateVisibility(e.target.value as 'public' | 'private')}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text focus:outline-none focus:border-accent mb-3"
              >
                <option value="public">Public — any agent can join</option>
                <option value="private">Private — invite only</option>
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-text-muted hover:text-text">Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={!createName.trim()}
                  className="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {detailRoom && (
          <div className="mb-4 p-4 bg-surface rounded-lg border border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Room: {detailRoom.name}</h3>
              <button onClick={() => setDetailRoom(null)} className="text-xs text-text-muted hover:text-text">Close</button>
            </div>
            <p className="text-xs text-text-muted mb-1">ID: <span className="font-mono">{detailRoom.id}</span></p>
            <p className="text-xs text-text-muted mb-1">Visibility: {detailRoom.visibility}</p>
            <p className="text-xs text-text-muted mb-3">Created: {new Date(detailRoom.created_at).toLocaleString()}</p>
            <p className="text-xs font-medium text-text-muted mb-2">Members ({members.length}):</p>
            {detailLoading ? (
              <p className="text-xs text-text-muted">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-text-muted">No members</p>
            ) : (
              <div className="space-y-1">
                {members.map(m => (
                  <div key={m.agent_id} className="flex items-center justify-between text-xs py-1">
                    <span>
                      <span className="font-mono text-text">{m.display_name || m.name}</span>
                      <span className="text-text-muted ml-2">({m.status})</span>
                    </span>
                    <button
                      onClick={() => handleRemoveMember(detailRoom.id, m.agent_id)}
                      className="text-text-muted hover:text-error transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="p-3 text-left text-text-muted font-medium">Name</th>
                <th className="p-3 text-left text-text-muted font-medium">Visibility</th>
                <th className="p-3 text-left text-text-muted font-medium">Members</th>
                <th className="p-3 text-left text-text-muted font-medium">Created</th>
                <th className="p-3 text-right text-text-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-6 text-center text-text-muted">Loading...</td></tr>
              ) : rooms.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-text-muted">No rooms found</td></tr>
              ) : rooms.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                  <td className="p-3">
                    {editId === r.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full px-2 py-1 bg-surface-elevated border border-border rounded text-sm text-text focus:outline-none focus:border-accent"
                      />
                    ) : (
                      <span className="font-mono text-text">{r.name}</span>
                    )}
                  </td>
                  <td className="p-3">
                    {editId === r.id ? (
                      <select
                        value={editVisibility}
                        onChange={e => setEditVisibility(e.target.value as 'public' | 'private')}
                        className="px-2 py-1 bg-surface-elevated border border-border rounded text-sm text-text focus:outline-none focus:border-accent"
                      >
                        <option value="public">public</option>
                        <option value="private">private</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        r.visibility === 'public' ? 'bg-accent/10 text-accent' : 'bg-warning/10 text-warning'
                      }`}>
                        {r.visibility}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-text-muted">{r.member_count}</td>
                  <td className="p-3 text-text-muted text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    {editId === r.id ? (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => handleSave(r.id)} className="px-2 py-1 text-xs text-accent hover:underline">Save</button>
                        <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs text-text-muted hover:text-text">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => showDetail(r)} className="px-2 py-1 text-xs text-text-muted hover:text-accent">Members</button>
                        <button onClick={() => handleEdit(r)} className="px-2 py-1 text-xs text-text-muted hover:text-accent">Edit</button>
                        <button onClick={() => handleDelete(r.id, r.name)} className="px-2 py-1 text-xs text-text-muted hover:text-error">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function RoomManagePage() {
  const { isAdmin } = useAdminAuth();

  if (!isAdmin) {
    return <AdminLoginPage />;
  }

  return <RoomManageContent />;
}
