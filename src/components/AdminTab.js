import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const ROLES = ['admin', 'tech', 'readonly'];
const ROLE_COLORS = {
  admin:    { bg: '#fee2e2', color: '#991b1b' },
  tech:     { bg: '#dbeafe', color: '#1e40af' },
  readonly: { bg: '#f1f5f9', color: '#475569' },
};

export default function AdminTab() {
  const { profile: me } = useAuth();
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [msg, setMsg]           = useState({ text: '', type: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) {
      console.error('profiles fetch error:', error);
      showMsg('Could not load users: ' + error.message + '. Check Supabase RLS policies.', 'error');
    }
    setUsers(data || []);
    setLoading(false);
  }

  function showMsg(text, type = 'success') {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: 'success' }), 3000);
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({ full_name: u.full_name || '', email: u.email || '', role: u.role || 'readonly' });
  }

  function cancelEdit() { setEditingId(null); setEditForm({}); }

  async function saveEdit(userId) {
    setSaving(userId);
    const { error } = await supabase.from('profiles').update({
      full_name: editForm.full_name?.trim() || null,
      role: editForm.role,
    }).eq('id', userId);
    if (error) {
      showMsg('Error: ' + error.message, 'error');
    } else {
      setUsers(u => u.map(x => x.id === userId ? { ...x, full_name: editForm.full_name, role: editForm.role } : x));
      showMsg('User updated.');
      setEditingId(null);
    }
    setSaving(null);
  }

  async function updateRole(userId, role) {
    setSaving(userId);
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
    if (!error) {
      setUsers(u => u.map(x => x.id === userId ? { ...x, role } : x));
      showMsg('Role updated.');
    }
    setSaving(null);
  }

  async function deleteUser(userId) {
    setSaving(userId);
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) {
      showMsg('Error deleting user: ' + error.message, 'error');
    } else {
      setUsers(u => u.filter(x => x.id !== userId));
      showMsg('User removed.');
    }
    setConfirmDelete(null);
    setSaving(null);
  }

  const S = {
    card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 24 },
    row: { padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'grid', alignItems: 'center' },
    th: { fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' },
    input: { fontSize: 13, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, width: '100%', outline: 'none' },
    btn: (variant) => ({
      fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: 'none',
      ...(variant === 'primary' ? { background: '#1B3A6B', color: '#fff' } :
          variant === 'danger'  ? { background: '#fee2e2', color: '#991b1b' } :
          { background: '#f1f5f9', color: '#475569' })
    }),
  };

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          <i className="ti ti-settings" style={{ marginRight: 8 }} />Admin Panel
        </h2>
        <p style={{ fontSize: 13, color: '#64748b' }}>Manage team members, roles and permissions.</p>
      </div>

      {msg.text && (
        <div style={{ background: msg.type === 'error' ? '#fee2e2' : '#dcfce7', color: msg.type === 'error' ? '#991b1b' : '#166534', borderRadius: 6, padding: '9px 14px', fontSize: 13, marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Remove user?</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              This will remove <strong>{confirmDelete.full_name || confirmDelete.email}</strong> from the app. They won't be able to log in.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={S.btn()} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button style={S.btn('danger')} onClick={() => deleteUser(confirmDelete.id)} disabled={saving === confirmDelete.id}>
                {saving === confirmDelete.id ? 'Removing…' : 'Remove user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users table */}
      <div style={S.card}>
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Team members ({users.length})</span>
        </div>

        {/* Header */}
        <div style={{ ...S.row, gridTemplateColumns: '1fr 220px 130px 140px', background: '#f8fafc' }}>
          {['Name', 'Email', 'Role', 'Actions'].map(h => <span key={h} style={S.th}>{h}</span>)}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        ) : users.map(u => {
          const rc = ROLE_COLORS[u.role] || ROLE_COLORS.readonly;
          const isEditing = editingId === u.id;
          const isMe = u.id === me?.id;

          return (
            <div key={u.id} style={{ ...S.row, gridTemplateColumns: '1fr 220px 130px 140px', background: isEditing ? '#f8fbff' : 'white' }}>
              {/* Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#64748b', flexShrink: 0, fontWeight: 600 }}>
                  {(u.full_name || u.email || '?')[0].toUpperCase()}
                </div>
                {isEditing ? (
                  <input style={{ ...S.input, maxWidth: 180 }} value={editForm.full_name}
                    onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="Full name" autoFocus />
                ) : (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{u.full_name || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No name set</span>}</div>
                    {isMe && <div style={{ fontSize: 10, color: '#94a3b8' }}>You</div>}
                  </div>
                )}
              </div>

              {/* Email */}
              <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>

              {/* Role */}
              <div>
                {isEditing ? (
                  <select style={{ fontSize: 12, padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }}
                    value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: rc.bg, color: rc.color }}>{u.role}</span>
                    {!isMe && !isEditing && (
                      <select value={u.role} disabled={saving === u.id}
                        onChange={e => updateRole(u.id, e.target.value)}
                        style={{ fontSize: 11, padding: '3px 5px', border: '1px solid #e2e8f0', borderRadius: 5, color: '#475569', background: '#fff', cursor: 'pointer' }}>
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                {isEditing ? (
                  <>
                    <button style={S.btn('primary')} onClick={() => saveEdit(u.id)} disabled={saving === u.id}>
                      {saving === u.id ? '…' : 'Save'}
                    </button>
                    <button style={S.btn()} onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={S.btn()} onClick={() => startEdit(u)} title="Edit user">
                      <i className="ti ti-pencil" /> Edit
                    </button>
                    {!isMe && (
                      <button style={S.btn('danger')} onClick={() => setConfirmDelete(u)} title="Remove user">
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Role permissions reference */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 12 }}>Role permissions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
          {[
            { role: 'admin',    perms: ['View everything', 'Edit all data', 'Manage users & roles', 'Delete sites & racks', 'Manage port rules'] },
            { role: 'tech',     perms: ['View everything', 'Edit sites & racks', 'Update port status', 'Add/move devices', 'Cannot manage users'] },
            { role: 'readonly', perms: ['View sites & racks', 'View port map', 'View network map', 'View port guide', 'No editing'] },
          ].map(({ role, perms }) => {
            const rc = ROLE_COLORS[role];
            return (
              <div key={role} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: rc.bg, color: rc.color, display: 'inline-block', marginBottom: 10 }}>{role}</span>
                {perms.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', marginBottom: 4 }}>
                    <i className="ti ti-check" style={{ color: '#22c55e', fontSize: 13 }} />{p}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
