import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import AIResearchPanel from './AIResearchPanel.jsx';
import TeamNotes from './TeamNotes.jsx';
import ActivityLog from './ActivityLog.jsx';
import ProspectEditForm from './ProspectEditForm.jsx';

export default function ProspectDetail({ id, user, onClose, onChanged }) {
  const [prospect, setProspect] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { prospect, matches } = await api.get(`/api/prospects/${id}`);
      setProspect(prospect);
      setMatches(matches || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function toggleContacted() {
    await api.patch(`/api/prospects/${id}`, { contacted: !prospect.contacted });
    await load();
    onChanged && onChanged();
  }

  async function updateLastContact(dateStr) {
    await api.patch(`/api/prospects/${id}`, { lastContactDate: dateStr || null });
    await load();
  }

  async function updateContactResponse(txt) {
    await api.patch(`/api/prospects/${id}`, { contactResponse: txt });
    await load();
  }

  async function removeProspect() {
    if (!confirm(`Delete ${prospect.name}? This cannot be undone.`)) return;
    await api.del(`/api/prospects/${id}`);
    onClose();
    onChanged && onChanged();
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600 }}>
              {prospect ? prospect.name : 'Loading…'}
            </div>
            {prospect && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                <span className={`badge badge-${prospect.status}`}>{prospect.status}</span>
                <span className="tier">Tier {prospect.tier}</span>
                {(prospect.iccNetworkMatches || []).length > 0 && (
                  <span className="icc-match">⚡ {prospect.iccNetworkMatches.length} ICC match{prospect.iccNetworkMatches.length !== 1 ? 'es' : ''}</span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {prospect && !editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {user.role === 'admin' && prospect && <button className="btn btn-danger btn-sm" onClick={removeProspect}>Delete</button>}
            <button className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="drawer-body">
          {error && <div className="alert alert-error">{error}</div>}
          {loading && <div className="empty"><span className="spinner" /></div>}

          {prospect && editing && (
            <ProspectEditForm
              prospect={prospect}
              onCancel={() => setEditing(false)}
              onSaved={async () => { setEditing(false); await load(); onChanged && onChanged(); }}
            />
          )}

          {prospect && !editing && (
            <>
              {/* ICC Network Match — always at top if present */}
              <ICCMatchPanel
                prospect={prospect}
                matches={matches}
                onChanged={load}
              />

              {/* Identity & Background */}
              <div className="card">
                <h3>Identity &amp; Background</h3>
                <dl className="kv">
                  <dt>Age</dt><dd>{prospect.age ?? '—'}</dd>
                  <dt>Location</dt><dd>{prospect.location || '—'}</dd>
                  <dt>Undergrad</dt><dd>{prospect.undergrad || '—'}</dd>
                  <dt>Graduate</dt><dd>{prospect.grad || '—'}</dd>
                  <dt>Net worth</dt><dd>{prospect.netWorth || '—'} {prospect.netWorthSource && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({prospect.netWorthSource})</span>}</dd>
                  <dt>Occupation</dt><dd>{prospect.occupation || '—'}</dd>
                  <dt>Previous roles</dt><dd>{prospect.previousRoles?.length ? <div className="tag-list">{prospect.previousRoles.map((r, i) => <span className="tag" key={i}>{r}</span>)}</div> : '—'}</dd>
                </dl>
              </div>

              {/* Campus Connections */}
              <div className="card">
                <h3>Campus Connections</h3>
                {prospect.campusConnections?.length ? (
                  <div className="tag-list">{prospect.campusConnections.map((r, i) => <span className="tag" key={i}>{r}</span>)}</div>
                ) : <div style={{ color: 'var(--text-muted)' }}>None recorded yet. Run AI research to populate.</div>}
              </div>

              {/* Philanthropic Footprint */}
              <div className="card">
                <h3>Philanthropic Footprint</h3>
                {prospect.philanthropicFootprint?.length ? (
                  <div className="tag-list">{prospect.philanthropicFootprint.map((r, i) => <span className="tag" key={i}>{r}</span>)}</div>
                ) : <div style={{ color: 'var(--text-muted)' }}>None recorded yet.</div>}
              </div>

              {/* Post-Oct 7 Signals */}
              <div className="card">
                <h3>Post-Oct 7 Signals</h3>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{prospect.oct7Signals || <span style={{ color: 'var(--text-muted)' }}>None recorded.</span>}</div>
              </div>

              {/* Personal Connections */}
              <div className="card">
                <h3>Personal Connections</h3>
                <dl className="kv">
                  <dt>Children</dt><dd>{prospect.children || '—'}</dd>
                  <dt>Spouse</dt><dd>{prospect.spouse || '—'}</dd>
                  <dt>Other</dt><dd>{prospect.personalConnections || '—'}</dd>
                </dl>
              </div>

              {/* AI Research */}
              <AIResearchPanel
                prospect={prospect}
                onApplied={load}
              />

              {/* Outreach Tracking */}
              <div className="card">
                <h3>Outreach Tracking</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0, textTransform: 'none', fontSize: 13, color: 'var(--text)' }}>
                    <input type="checkbox" checked={prospect.contacted} onChange={toggleContacted} />
                    Contacted
                  </label>
                  <div>
                    <label>Last contact</label>
                    <input type="date" className="input" style={{ maxWidth: 180 }}
                      value={prospect.lastContactDate ? prospect.lastContactDate.split('T')[0] : ''}
                      onChange={(e) => updateLastContact(e.target.value)} />
                  </div>
                </div>
                <label>Response log</label>
                <ResponseEditor initial={prospect.contactResponse || ''} onSave={updateContactResponse} />
              </div>

              {/* Team Notes */}
              <TeamNotes prospect={prospect} onAdded={load} />

              {/* Activity Log */}
              <ActivityLog entries={prospect.auditLogs || []} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ICCMatchPanel({ prospect, matches, onChanged }) {
  const [allDonors, setAllDonors] = useState([]);
  const [adding, setAdding] = useState(false);
  const [selectedDonor, setSelectedDonor] = useState('');
  const [detail, setDetail] = useState(prospect.connectionDetail || '');
  const [savingDetail, setSavingDetail] = useState(false);

  useEffect(() => {
    setDetail(prospect.connectionDetail || '');
  }, [prospect.id, prospect.connectionDetail]);

  useEffect(() => {
    if (adding && allDonors.length === 0) {
      api.get('/api/donors').then(({ donors }) => setAllDonors(donors));
    }
  }, [adding, allDonors.length]);

  async function addMatch() {
    if (!selectedDonor) return;
    const next = Array.from(new Set([...(prospect.iccNetworkMatches || []), selectedDonor]));
    await api.patch(`/api/prospects/${prospect.id}`, { iccNetworkMatches: next });
    setSelectedDonor('');
    setAdding(false);
    onChanged && onChanged();
  }

  async function removeMatch(donorId) {
    const next = (prospect.iccNetworkMatches || []).filter((id) => id !== donorId);
    await api.patch(`/api/prospects/${prospect.id}`, { iccNetworkMatches: next });
    onChanged && onChanged();
  }

  async function saveDetail() {
    setSavingDetail(true);
    await api.patch(`/api/prospects/${prospect.id}`, { connectionDetail: detail });
    setSavingDetail(false);
    onChanged && onChanged();
  }

  return (
    <div className="card highlight-amber">
      <h3 style={{ color: 'var(--accent-amber)' }}>⚡ ICC Network Match</h3>
      {matches.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>No ICC network match on file yet. Run AI research or link a donor manually.</div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {matches.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                {d.principals?.length > 0 && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Principals: {d.principals.join(', ')}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => removeMatch(d.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <label>Connection detail / suggested intro framing</label>
      <textarea className="textarea" value={detail} onChange={(e) => setDetail(e.target.value)} onBlur={saveDetail} placeholder="How does this prospect connect to the matched donor? What's the best way to frame the intro ask?" />
      {savingDetail && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>saving…</div>}

      {!adding ? (
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Link a donor</button>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select" style={{ flex: 1 }} value={selectedDonor} onChange={(e) => setSelectedDonor(e.target.value)}>
            <option value="">Choose a donor…</option>
            {allDonors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={addMatch}>Link</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function ResponseEditor({ initial, onSave }) {
  const [val, setVal] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setVal(initial); setDirty(false); }, [initial]);
  return (
    <div>
      <textarea className="textarea" value={val} onChange={(e) => { setVal(e.target.value); setDirty(true); }} />
      {dirty && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={async () => { await onSave(val); setDirty(false); }}>Save response log</button>
      )}
    </div>
  );
}
