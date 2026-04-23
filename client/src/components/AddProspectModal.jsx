import React, { useState } from 'react';
import { api } from '../api.js';

export default function AddProspectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', status: 'cold', tier: 3, location: '', netWorth: '', occupation: '',
    undergrad: '', grad: '', age: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, tier: Number(form.tier), age: form.age ? Number(form.age) : null };
      const { prospect } = await api.post('/api/prospects', payload);
      onCreated(prospect);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add prospect</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <div className="full"><label>Name *</label><input className="input" autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div><label>Status</label>
            <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {['hot','warm','cold','connected'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label>Tier</label>
            <select className="select" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
              <option value="1">Tier 1 — Campus-Connected</option>
              <option value="2">Tier 2 — Jewish Philanthropic</option>
              <option value="3">Tier 3 — Wealth Screening</option>
            </select>
          </div>
          <div><label>Location</label><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} /></div>
          <div><label>Net worth</label><input className="input" value={form.netWorth} onChange={(e) => set('netWorth', e.target.value)} /></div>
          <div className="full"><label>Occupation</label><input className="input" value={form.occupation} onChange={(e) => set('occupation', e.target.value)} /></div>
          <div><label>Undergrad</label><input className="input" value={form.undergrad} onChange={(e) => set('undergrad', e.target.value)} /></div>
          <div><label>Graduate</label><input className="input" value={form.grad} onChange={(e) => set('grad', e.target.value)} /></div>
          <div><label>Age</label><input className="input" type="number" value={form.age} onChange={(e) => set('age', e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create prospect'}</button>
        </div>
      </div>
    </div>
  );
}
