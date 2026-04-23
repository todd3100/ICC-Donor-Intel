import React, { useState } from 'react';
import { api } from '../api.js';

export default function TeamNotes({ prospect, onAdded }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/prospects/${prospect.id}/notes`, { body });
      setBody('');
      onAdded && onAdded();
    } finally {
      setSaving(false);
    }
  }

  const notes = prospect.notes || [];

  return (
    <div className="card">
      <h3>Team Notes</h3>
      <textarea className="textarea" placeholder="Leave a note for the team…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ marginTop: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={saving || !body.trim()} onClick={add}>{saving ? 'Posting…' : 'Post note'}</button>
      </div>
      <div style={{ marginTop: 12 }}>
        {notes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No team notes yet.</div>
        ) : notes.map((n) => (
          <div key={n.id} className="note">
            <div className="meta">{n.user?.name || 'Unknown'} · {new Date(n.createdAt).toLocaleString()}</div>
            <div className="body">{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
