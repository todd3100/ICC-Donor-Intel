import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import CSVUpload from './CSVUpload.jsx';

export default function DonorList({ user }) {
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // donor object being edited (or { isNew: true })
  const [showUpload, setShowUpload] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { donors } = await api.get('/api/donors');
      setDonors(donors);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = donors.filter((d) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return d.name.toLowerCase().includes(s) ||
      (d.principals || []).some((p) => p.toLowerCase().includes(s)) ||
      (d.notes || '').toLowerCase().includes(s);
  });

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search donors by name, principal, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{filtered.length} of {donors.length} donors</div>
        <div style={{ flex: 1 }} />
        {user.role === 'admin' && (
          <>
            <button className="btn" onClick={() => setShowUpload(true)}>Import CSV</button>
            <button className="btn btn-primary" onClick={() => setEditing({ isNew: true, name: '', type: 'org', principals: [], notes: '' })}>+ Add Donor</button>
          </>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Principals</th>
              <th>Notes</th>
              <th>Prospects</th>
              {user.role === 'admin' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} onClick={user.role === 'admin' ? () => setEditing(d) : undefined} style={user.role === 'admin' ? {} : { cursor: 'default' }}>
                <td className="name-cell">{d.name}</td>
                <td><span className="tag">{d.type}</span></td>
                <td>{(d.principals || []).join(', ') || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td style={{ color: 'var(--text-dim)', fontSize: 12, maxWidth: 340 }}>{d.notes || '—'}</td>
                <td>{d.prospectCount > 0 ? <span className="icc-match">⚡ {d.prospectCount}</span> : <span style={{ color: 'var(--text-muted)' }}>0</span>}</td>
                {user.role === 'admin' && <td><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Edit</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <DonorEditModal
          donor={editing}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {showUpload && (
        <CSVUpload
          onClose={() => setShowUpload(false)}
          onImported={() => { setShowUpload(false); load(); }}
        />
      )}
    </>
  );
}

function DonorEditModal({ donor, isNew, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: donor.name || '',
    type: donor.type || 'org',
    principals: (donor.principals || []).join('\n'),
    notes: donor.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        principals: form.principals.split('\n').map((s) => s.trim()).filter(Boolean),
        notes: form.notes,
      };
      if (isNew) {
        await api.post('/api/donors', payload);
      } else {
        await api.patch(`/api/donors/${donor.id}`, payload);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${donor.name}?`)) return;
    await api.del(`/api/donors/${donor.id}`);
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'Add donor' : 'Edit donor'}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <div className="full"><label>Name *</label><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><label>Type</label>
            <select className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="org">Organization</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <div></div>
          <div className="full"><label>Principals (one per line)</label><textarea className="textarea" value={form.principals} onChange={(e) => set('principals', e.target.value)} placeholder="e.g. Adam Milstein&#10;Gila Milstein" /></div>
          <div className="full"><label>Notes</label><textarea className="textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            {!isNew && <button className="btn btn-danger btn-sm" onClick={remove}>Delete</button>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
