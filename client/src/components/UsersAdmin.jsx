import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { users } = await api.get('/api/auth/users');
      setUsers(users);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function removeUser(id, email) {
    if (!confirm(`Delete user ${email}?`)) return;
    await api.del(`/api/auth/users/${id}`);
    load();
  }

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Team members</h2>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add user</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="empty"><span className="spinner" /></div> : (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ cursor: 'default' }}>
                <td className="name-cell">{u.name}</td>
                <td className="mono">{u.email}</td>
                <td><span className="tag" style={u.role === 'admin' ? { color: 'var(--accent-amber)', borderColor: 'rgba(232,162,58,0.4)' } : {}}>{u.role}</span></td>
                <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => removeUser(u.id, u.email)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </>
  );
}

function AddUserModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post('/api/auth/users', form);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add user</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <div className="full"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label>Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label>Role</label>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="full"><label>Password (8+ chars)</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create user'}</button>
        </div>
      </div>
    </div>
  );
}
