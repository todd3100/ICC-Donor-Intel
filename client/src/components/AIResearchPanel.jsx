import React, { useState } from 'react';
import { api } from '../api.js';

export default function AIResearchPanel({ prospect, onApplied }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rawError, setRawError] = useState('');
  const [result, setResult] = useState(null);
  const [suggestedMatchIds, setSuggestedMatchIds] = useState([]);
  const [checked, setChecked] = useState({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  async function run() {
    setLoading(true);
    setError('');
    setRawError('');
    setResult(null);
    setApplied(false);
    try {
      const data = await api.post(`/api/prospects/${prospect.id}/research`);
      setResult(data.research);
      setSuggestedMatchIds(data.resolvedMatchIds || []);
      // Default: everything checked so user can apply the whole update
      setChecked({
        campus: true,
        philanthropic: true,
        oct7signals: true,
        children: true,
        spouse: true,
        personalConnections: true,
        iccNetworkMatches: (data.resolvedMatchIds || []).length > 0,
        connectionDetail: true,
      });
    } catch (e) {
      setError(e.message);
      if (e.data?.raw) setRawError(e.data.raw);
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setApplying(true);
    try {
      const updates = {};
      if (checked.campus) updates.campus = result.campus || [];
      if (checked.philanthropic) updates.philanthropic = result.philanthropic || [];
      if (checked.oct7signals) updates.oct7signals = result.oct7signals || '';
      if (checked.children) updates.children = result.children || '';
      if (checked.spouse) updates.spouse = result.spouse || '';
      if (checked.personalConnections) updates.personalConnections = result.personalConnections || '';
      if (checked.iccNetworkMatches) updates.iccNetworkMatches = suggestedMatchIds;
      if (checked.connectionDetail) {
        const parts = [];
        if (result.warmPathwaySummary) parts.push(result.warmPathwaySummary);
        if (result.suggestedIntroAsk) parts.push('Suggested ask: ' + result.suggestedIntroAsk);
        if (result.iccNetworkNotes) parts.push('Notes: ' + result.iccNetworkNotes);
        updates.connectionDetail = parts.join('\n\n');
      }
      await api.post(`/api/prospects/${prospect.id}/research/apply`, { updates });
      setApplied(true);
      onApplied && onApplied();
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  function toggle(k) {
    setChecked((c) => ({ ...c, [k]: !c[k] }));
  }

  return (
    <div className="card" style={{ borderColor: 'var(--accent-green)' }}>
      <h3 style={{ color: 'var(--accent-green)' }}>AI Research Engine</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
        Runs Claude against public sources and the full ICC donor list to surface campus ties, philanthropic signals, and warm introduction pathways. Review before applying.
      </p>

      <button className="btn btn-primary" onClick={run} disabled={loading}>
        {loading ? <><span className="spinner" /> Researching…</> : 'Run AI Research'}
      </button>

      {error && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {error}
          {rawError && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>Raw model output</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 6 }}>{rawError}</pre>
            </details>
          )}
        </div>
      )}

      {applied && <div className="alert alert-success" style={{ marginTop: 12 }}>Research applied to profile.</div>}

      {result && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Review each suggested update. Uncheck anything you don't want to apply.
          </div>

          <Section label="Campus Connections" checked={checked.campus} onToggle={() => toggle('campus')} hasData={result.campus?.length}>
            {result.campus?.length ? <div className="tag-list">{result.campus.map((s, i) => <span className="tag" key={i}>{s}</span>)}</div> : <em>none</em>}
          </Section>
          <Section label="Philanthropic Footprint" checked={checked.philanthropic} onToggle={() => toggle('philanthropic')} hasData={result.philanthropic?.length}>
            {result.philanthropic?.length ? <div className="tag-list">{result.philanthropic.map((s, i) => <span className="tag" key={i}>{s}</span>)}</div> : <em>none</em>}
          </Section>
          <Section label="Post-Oct 7 Signals" checked={checked.oct7signals} onToggle={() => toggle('oct7signals')} hasData={result.oct7signals}>
            {result.oct7signals || <em>none</em>}
          </Section>
          <Section label="Children" checked={checked.children} onToggle={() => toggle('children')} hasData={result.children}>
            {result.children || <em>none</em>}
          </Section>
          <Section label="Spouse" checked={checked.spouse} onToggle={() => toggle('spouse')} hasData={result.spouse}>
            {result.spouse || <em>none</em>}
          </Section>
          <Section label="Other Personal Connections" checked={checked.personalConnections} onToggle={() => toggle('personalConnections')} hasData={result.personalConnections}>
            {result.personalConnections || <em>none</em>}
          </Section>
          <Section label="ICC Donor Matches" checked={checked.iccNetworkMatches} onToggle={() => toggle('iccNetworkMatches')} hasData={suggestedMatchIds.length}>
            {suggestedMatchIds.length ? (
              <div className="tag-list">
                {(result.iccDonorMatchNames || []).map((n, i) => <span className="tag" key={i} style={{ color: 'var(--accent-amber)', borderColor: 'rgba(232,162,58,0.35)' }}>⚡ {n}</span>)}
              </div>
            ) : <em>no matches found in ICC network</em>}
            {result.iccNetworkNotes && <div style={{ marginTop: 8, fontSize: 13 }}>{result.iccNetworkNotes}</div>}
          </Section>
          <Section label="Warm Pathway / Intro Ask" checked={checked.connectionDetail} onToggle={() => toggle('connectionDetail')} hasData={result.warmPathwaySummary || result.suggestedIntroAsk}>
            {result.warmPathwaySummary && <div style={{ marginBottom: 6 }}><strong>Pathway:</strong> {result.warmPathwaySummary}</div>}
            {result.suggestedIntroAsk && <div><strong>Suggested ask:</strong> <em>"{result.suggestedIntroAsk}"</em></div>}
          </Section>

          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={apply} disabled={applying}>
              {applying ? <><span className="spinner" /> Applying…</> : 'Apply to Profile'}
            </button>
            <button className="btn btn-ghost" onClick={() => setResult(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, checked, onToggle, children, hasData }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 13, color: 'var(--text)', marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!checked} onChange={onToggle} disabled={!hasData} />
        <span style={{ fontWeight: 600, color: hasData ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
      </label>
      <div style={{ marginLeft: 24, fontSize: 13, color: 'var(--text-dim)' }}>{children}</div>
    </div>
  );
}
