import React, { useState } from 'react';
import { api } from '../api.js';

export default function ProspectEditForm({ prospect, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...prospect,
    lastContactDate: prospect.lastContactDate ? prospect.lastContactDate.split('T')[0] : '',
    previousRoles: (prospect.previousRoles || []).join('\n'),
    campusConnections: (prospect.campusConnections || []).join('\n'),
    philanthropicFootprint: (prospect.philanthropicFootprint || []).join('\n'),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        age: form.age === '' || form.age == null ? null : Number(form.age),
        tier: Number(form.tier) || 3,
        lastContactDate: form.lastContactDate || null,
        previousRoles: (form.previousRoles || '').split('\n').map((s) => s.trim()).filter(Boolean),
        campusConnections: (form.campusConnections || '').split('\n').map((s) => s.trim()).filter(Boolean),
        philanthropicFootprint: (form.philanthropicFootprint || '').split('\n').map((s) => s.trim()).filter(Boolean),
      };
      await api.patch(`/api/prospects/${prospect.id}`, payload);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3>Edit prospect</h3>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-grid">
        <Field label="Name" full><input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>

        <Field label="Status">
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {['hot','warm','cold','connected'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Tier">
          <select className="select" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
            <option value="1">Tier 1 — Campus-Connected</option>
            <option value="2">Tier 2 — Jewish Philanthropic</option>
            <option value="3">Tier 3 — Wealth Screening</option>
          </select>
        </Field>

        <Field label="Age"><input className="input" type="number" value={form.age ?? ''} onChange={(e) => set('age', e.target.value)} /></Field>
        <Field label="Location"><input className="input" value={form.location || ''} onChange={(e) => set('location', e.target.value)} /></Field>

        <Field label="Undergrad"><input className="input" value={form.undergrad || ''} onChange={(e) => set('undergrad', e.target.value)} /></Field>
        <Field label="Graduate"><input className="input" value={form.grad || ''} onChange={(e) => set('grad', e.target.value)} /></Field>

        <Field label="Net worth"><input className="input" value={form.netWorth || ''} onChange={(e) => set('netWorth', e.target.value)} /></Field>
        <Field label="Net worth source"><input className="input" value={form.netWorthSource || ''} onChange={(e) => set('netWorthSource', e.target.value)} /></Field>

        <Field label="Occupation" full><input className="input" value={form.occupation || ''} onChange={(e) => set('occupation', e.target.value)} /></Field>

        <Field label="Previous roles (one per line)" full><textarea className="textarea" value={form.previousRoles} onChange={(e) => set('previousRoles', e.target.value)} /></Field>
        <Field label="Campus connections (one per line)" full><textarea className="textarea" value={form.campusConnections} onChange={(e) => set('campusConnections', e.target.value)} /></Field>
        <Field label="Philanthropic footprint (one per line)" full><textarea className="textarea" value={form.philanthropicFootprint} onChange={(e) => set('philanthropicFootprint', e.target.value)} /></Field>

        <Field label="Post-Oct 7 signals" full><textarea className="textarea" value={form.oct7Signals || ''} onChange={(e) => set('oct7Signals', e.target.value)} /></Field>
        <Field label="Children" full><input className="input" value={form.children || ''} onChange={(e) => set('children', e.target.value)} /></Field>
        <Field label="Spouse" full><input className="input" value={form.spouse || ''} onChange={(e) => set('spouse', e.target.value)} /></Field>
        <Field label="Personal connections" full><textarea className="textarea" value={form.personalConnections || ''} onChange={(e) => set('personalConnections', e.target.value)} /></Field>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={full ? 'full' : ''}>
      <label>{label}</label>
      {children}
    </div>
  );
}
