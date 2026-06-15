import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Check, AlertTriangle, Zap, LayoutGrid, List } from 'lucide-react';
import { api } from '../api.js';
import ProspectDetail from './ProspectDetail.jsx';
import AddProspectModal from './AddProspectModal.jsx';
import KanbanBoard from './KanbanBoard.jsx';

const STATUSES = ['hot', 'warm', 'cold', 'connected'];

// Stage display config. Must match server-side ProspectStage enum.
export const STAGES = [
  { key: 'identified',         label: 'Identified',         color: '#6b7280' },
  { key: 'researched',         label: 'Researched',         color: '#3b82f6' },
  { key: 'warm_intro_made',    label: 'Warm Intro',         color: '#8b5cf6' },
  { key: 'meeting_scheduled',  label: 'Meeting Scheduled',  color: '#0ea5e9' },
  { key: 'cultivation',        label: 'Cultivation',        color: '#f59e0b' },
  { key: 'ask_made',           label: 'Ask Made',           color: '#ec4899' },
  { key: 'closed_won',         label: 'Closed — Won',       color: '#10b981' },
  { key: 'closed_declined',    label: 'Closed — Declined',  color: '#ef4444' },
];
export const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
export const STAGE_COLORS = Object.fromEntries(STAGES.map((s) => [s.key, s.color]));

export default function ProspectList({ user }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [iccMatchFilter, setIccMatchFilter] = useState('');
  const [contactedFilter, setContactedFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  // Default sort: primary by ICC connection count (desc), secondary by last name (asc).
  // User-initiated sorts override this temporarily.
  const [sort, setSort] = useState({ key: 'default', dir: 'desc' });
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkMode, setBulkMode] = useState('unresearched'); // 'unresearched' | 'all' | 'errored'
  const [bulkJob, setBulkJob] = useState(null);
  const [bulkToast, setBulkToast] = useState('');
  // View mode: 'table' | 'kanban'. Persist in sessionStorage.
  const [view, setView] = useState(() => {
    try { return sessionStorage.getItem('prospects-view') || 'table'; } catch { return 'table'; }
  });
  const pollRef = useRef(null);

  function changeView(next) {
    setView(next);
    try { sessionStorage.setItem('prospects-view', next); } catch {}
  }

  async function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (statusFilter) params.set('status', statusFilter);
    if (tierFilter) params.set('tier', tierFilter);
    if (iccMatchFilter) params.set('iccMatch', iccMatchFilter);
    if (contactedFilter) params.set('contacted', contactedFilter);
    if (stageFilter) params.set('stage', stageFilter);
    try {
      const { prospects } = await api.get('/api/prospects?' + params.toString());
      setProspects(prospects);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, statusFilter, tierFilter, iccMatchFilter, contactedFilter, stageFilter]);

  // On mount: see if a bulk job is already running (e.g. someone refreshed)
  useEffect(() => {
    api.get('/api/research/bulk/status').then(({ job }) => {
      if (job?.running) {
        setBulkJob(job);
        startPolling();
      }
    }).catch(() => {});
    return () => stopPolling();
    // eslint-disable-next-line
  }, []);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { job } = await api.get('/api/research/bulk/status');
        setBulkJob(job);
        if (!job.running) {
          stopPolling();
          setBulkToast(`Research complete — ${job.completed} updated, ${job.failed} failed.`);
          setTimeout(() => setBulkToast(''), 6000);
          load();
        }
      } catch (e) {
        // ignore transient
      }
    }, 2000);
  }
  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const unresearchedCount = useMemo(
    () => prospects.filter((p) => !p.aiResearchCompleted && !p.aiResearchError).length,
    [prospects]
  );
  const erroredCount = useMemo(
    () => prospects.filter((p) => p.aiResearchError).length,
    [prospects]
  );
  const totalCount = prospects.length;

  const targetCount =
    bulkMode === 'all' ? totalCount :
    bulkMode === 'errored' ? erroredCount :
    unresearchedCount;

  async function triggerBulk() {
    setShowBulkConfirm(false);
    try {
      const res = await api.post('/api/research/bulk', { mode: bulkMode });
      if (res.accepted) {
        setBulkJob({
          running: true,
          mode: res.mode,
          total: res.total,
          completed: 0,
          failed: 0,
          currentName: null,
          failures: [],
        });
        startPolling();
      } else {
        setBulkToast(res.message || 'No prospects to research.');
        setTimeout(() => setBulkToast(''), 4000);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  const sorted = useMemo(() => {
    const rows = [...prospects];
    const { key, dir } = sort;

    // Default two-level sort: ICC connections desc, then last name asc.
    if (key === 'default') {
      rows.sort((a, b) => {
        const aIcc = (a.iccNetworkMatches || []).length;
        const bIcc = (b.iccNetworkMatches || []).length;
        if (aIcc !== bIcc) return bIcc - aIcc; // primary: desc by ICC count
        return lastName(a.name).localeCompare(lastName(b.name)); // secondary: asc by last name
      });
      return rows;
    }

    rows.sort((a, b) => {
      let av = a[key]; let bv = b[key];
      if (key === 'netWorth') { av = parseMoney(av); bv = parseMoney(bv); }
      if (key === 'iccMatches') {
        av = (a.iccNetworkMatches || []).length;
        bv = (b.iccNetworkMatches || []).length;
      }
      if (key === 'suggestedAsk') {
        av = a.suggestedAskMin || 0;
        bv = b.suggestedAskMin || 0;
      }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [prospects, sort]);

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  // Drag-drop handler from Kanban: PATCH the stage, then update locally.
  async function handleStageChange(prospectId, newStage) {
    // Optimistic update
    setProspects((prev) => prev.map((p) => p.id === prospectId ? { ...p, stage: newStage, lastStageChangeAt: new Date().toISOString() } : p));
    try {
      await api.patch(`/api/prospects/${prospectId}`, { stage: newStage });
    } catch (e) {
      setError(`Failed to update stage: ${e.message}`);
      // Reload to get true state
      load();
    }
  }

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search name, location, occupation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 110 }} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={iccMatchFilter} onChange={(e) => setIccMatchFilter(e.target.value)}>
          <option value="">ICC match: any</option>
          <option value="true">Has ICC match</option>
          <option value="false">No match</option>
        </select>
        <select className="select" style={{ maxWidth: 140 }} value={contactedFilter} onChange={(e) => setContactedFilter(e.target.value)}>
          <option value="">Contacted: any</option>
          <option value="true">Contacted</option>
          <option value="false">Not contacted</option>
        </select>

        <div style={{ flex: 1 }} />

        {/* View toggle */}
        <div className="view-toggle" role="group" aria-label="View" style={viewToggleStyle}>
          <button
            type="button"
            onClick={() => changeView('table')}
            className={view === 'table' ? 'active' : ''}
            style={view === 'table' ? viewBtnActive : viewBtn}
            title="Table view"
          >
            <List size={14} /> Table
          </button>
          <button
            type="button"
            onClick={() => changeView('kanban')}
            className={view === 'kanban' ? 'active' : ''}
            style={view === 'kanban' ? viewBtnActive : viewBtn}
            title="Kanban view"
          >
            <LayoutGrid size={14} /> Kanban
          </button>
        </div>

        {user.role === 'admin' && (
          <>
            <select
              className="select"
              style={{ maxWidth: 220 }}
              value={bulkMode}
              onChange={(e) => setBulkMode(e.target.value)}
              disabled={bulkJob?.running}
              title="Choose which prospects to research"
            >
              <option value="unresearched">Unresearched only ({unresearchedCount})</option>
              <option value="errored">Retry errored ({erroredCount})</option>
              <option value="all">All prospects — overwrite ({totalCount})</option>
            </select>
            <button
              className="btn"
              onClick={() => setShowBulkConfirm(true)}
              disabled={bulkJob?.running || targetCount === 0}
            >
              {bulkJob?.running ? <><span className="spinner" /> Researching…</> : `⚡ Run Bulk Research`}
            </button>
          </>
        )}
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Prospect</button>
      </div>

      {bulkToast && <div className="alert alert-success">{bulkToast}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {bulkJob?.running && (
        <div className="bulk-progress">
          <div className="meta">
            <span>Researching {bulkJob.currentName || '…'} ({bulkJob.completed + bulkJob.failed} of {bulkJob.total})</span>
            <span>
              ✓ {bulkJob.completed} · ✕ {bulkJob.failed} ·{' '}
              {Math.round(((bulkJob.completed + bulkJob.failed) / Math.max(bulkJob.total, 1)) * 100)}%
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${((bulkJob.completed + bulkJob.failed) / Math.max(bulkJob.total, 1)) * 100}%` }} />
          </div>
          {bulkJob.failures && bulkJob.failures.length > 0 && (
            <details style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
              <summary style={{ cursor: 'pointer' }}>Recent failures ({bulkJob.failures.length})</summary>
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {bulkJob.failures.slice(-5).map((f, i) => (
                  <li key={i}><strong>{f.name}:</strong> {f.error}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty">No prospects match these filters yet.</div>
      ) : view === 'kanban' ? (
        <KanbanBoard
          prospects={sorted}
          onStageChange={handleStageChange}
          onSelect={(id) => setSelectedId(id)}
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'right', color: 'var(--text-muted)' }}>#</th>
              <th onClick={() => toggleSort('name')}>Name</th>
              <th onClick={() => toggleSort('stage')}>Stage</th>
              <th onClick={() => toggleSort('owner')}>Owner</th>
              <th onClick={() => toggleSort('status')}>Status</th>
              <th onClick={() => toggleSort('tier')}>Tier</th>
              <th onClick={() => toggleSort('netWorth')}>Net Worth</th>
              <th onClick={() => toggleSort('suggestedAsk')}>Suggested Ask</th>
              <th onClick={() => toggleSort('location')}>Location</th>
              <th onClick={() => toggleSort('iccMatches')}>ICC Match</th>
              <th>Research</th>
              <th onClick={() => toggleSort('updatedAt')}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id} onClick={() => setSelectedId(p.id)}>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{i + 1}</td>
                <td className="name-cell">{p.name}</td>
                <td><StageBadge stage={p.stage} /></td>
                <td style={{ fontSize: 13 }}>{p.owner || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                <td><span className="tier">Tier {p.tier}</span></td>
                <td className="mono">{displayNetWorth(p.netWorth)}</td>
                <td className="mono" style={{ fontSize: 12 }}>{displaySuggestedAsk(p)}</td>
                <td>{p.location || '—'}</td>
                <td>{(p.iccNetworkMatches || []).length > 0 ? <span className="icc-match"><Zap size={12} /> {p.iccNetworkMatches.length}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td>
                  {p.aiResearchCompleted && !p.aiResearchError && <span className="research-icon ok" title="Research complete"><Check size={14} /></span>}
                  {p.aiResearchError && <span className="research-icon err" title={p.aiResearchErrorMsg || 'Research error'}><AlertTriangle size={14} /></span>}
                  {!p.aiResearchCompleted && !p.aiResearchError && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                </td>
                <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatDate(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedId && (
        <ProspectDetail
          id={selectedId}
          user={user}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}

      {showAdd && (
        <AddProspectModal
          onClose={() => setShowAdd(false)}
          onCreated={(p) => { setShowAdd(false); load(); setSelectedId(p.id); }}
        />
      )}

      {showBulkConfirm && (
        <div className="modal-backdrop" onClick={() => setShowBulkConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Run bulk AI research?</h2>
            <div className="modal-confirm-body">
              {bulkMode === 'all' && (
                <>
                  This will run AI research on <strong>all {totalCount}</strong> prospects and{' '}
                  <strong>overwrite any existing research data</strong>.<br />
                </>
              )}
              {bulkMode === 'errored' && (
                <>
                  This will retry research on the <strong>{erroredCount}</strong> prospect{erroredCount !== 1 ? 's' : ''} that previously errored.<br />
                </>
              )}
              {bulkMode === 'unresearched' && (
                <>
                  This will run AI research on the <strong>{unresearchedCount}</strong> unresearched prospect{unresearchedCount !== 1 ? 's' : ''}.<br />
                </>
              )}
              Estimated time: ~<strong>{Math.ceil((targetCount * 35) / 60)} min</strong> ({targetCount} × ~35s).<br />
              Research runs in the background — you can keep using the app.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setShowBulkConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={triggerBulk} disabled={targetCount === 0}>
                {targetCount === 0 ? 'Nothing to research' : 'Start research'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- View-toggle inline styles (no global CSS edits required) ----
const viewToggleStyle = {
  display: 'inline-flex',
  borderRadius: 6,
  overflow: 'hidden',
  border: '1px solid var(--border, #2a2a2a)',
};
const viewBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  fontSize: 12,
  background: 'transparent',
  color: 'var(--text-muted)',
  border: 'none',
  cursor: 'pointer',
};
const viewBtnActive = {
  ...viewBtn,
  background: 'var(--bg-elevated, #1f1f1f)',
  color: 'var(--text)',
};

// ---- Reusable Stage badge ----
export function StageBadge({ stage }) {
  const s = stage || 'identified';
  const label = STAGE_LABELS[s] || s;
  const color = STAGE_COLORS[s] || '#6b7280';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 500,
        background: color + '22',
        color: color,
        border: `1px solid ${color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ---- Helpers ----

// Display suggested ask range. Returns "—" if both null.
export function displaySuggestedAsk(p) {
  const lo = p.suggestedAskMin;
  const hi = p.suggestedAskMax;
  if (lo == null && hi == null) return '—';
  if (lo != null && hi != null) {
    return `${fmtMoney(lo)} – ${fmtMoney(hi)}${p.suggestedAskOverride ? ' *' : ''}`;
  }
  return fmtMoney(lo ?? hi) + (p.suggestedAskOverride ? ' *' : '');
}

export function fmtMoney(n) {
  if (n == null) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

// Extract the last whitespace-separated token of a name, ignoring trailing suffixes
// like Jr., Sr., II, III, IV. Returns lowercase for case-insensitive sort.
function lastName(fullName) {
  if (!fullName) return '';
  const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);
  const tokens = String(fullName).trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase().replace(/[,]/g, ''))) {
    tokens.pop();
  }
  return (tokens[tokens.length - 1] || '').toLowerCase();
}

// Display fallback: legacy records may have "Substantial", "Family substantial",
// "Significant wealth", etc. in netWorth. Show "Unknown" for any of these.
function displayNetWorth(v) {
  if (!v) return '—';
  const lower = String(v).trim().toLowerCase();
  if (!lower) return '—';
  if (lower.includes('substantial') || lower.includes('significant')) return 'Unknown';
  if (['unknown', 'undisclosed', 'not disclosed', 'not publicly disclosed',
       'not publicly available', 'not available', 'n/a', 'na', '—', '-'].includes(lower)) {
    return 'Unknown';
  }
  return v;
}

function parseMoney(s) {
  if (!s) return 0;
  const m = String(s).match(/[\d.]+/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  if (/B/i.test(s)) return n * 1e9;
  if (/M/i.test(s)) return n * 1e6;
  if (/K/i.test(s)) return n * 1e3;
  return n;
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
