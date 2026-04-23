import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import ProspectDetail from './ProspectDetail.jsx';
import AddProspectModal from './AddProspectModal.jsx';

const STATUSES = ['hot', 'warm', 'cold', 'connected'];

export default function ProspectList({ user }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [iccMatchFilter, setIccMatchFilter] = useState('');
  const [contactedFilter, setContactedFilter] = useState('');
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' });
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (statusFilter) params.set('status', statusFilter);
    if (tierFilter) params.set('tier', tierFilter);
    if (iccMatchFilter) params.set('iccMatch', iccMatchFilter);
    if (contactedFilter) params.set('contacted', contactedFilter);
    try {
      const { prospects } = await api.get('/api/prospects?' + params.toString());
      setProspects(prospects);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, statusFilter, tierFilter, iccMatchFilter, contactedFilter]);

  const sorted = useMemo(() => {
    const rows = [...prospects];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      let av = a[key]; let bv = b[key];
      if (key === 'netWorth') { av = parseMoney(av); bv = parseMoney(bv); }
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

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search name, location, occupation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ maxWidth: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 120 }} value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={iccMatchFilter} onChange={(e) => setIccMatchFilter(e.target.value)}>
          <option value="">ICC match: any</option>
          <option value="true">Has ICC match</option>
          <option value="false">No match</option>
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={contactedFilter} onChange={(e) => setContactedFilter(e.target.value)}>
          <option value="">Contacted: any</option>
          <option value="true">Contacted</option>
          <option value="false">Not contacted</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Prospect</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : sorted.length === 0 ? (
        <div className="empty">No prospects match these filters yet.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('name')}>Name</th>
              <th onClick={() => toggleSort('status')}>Status</th>
              <th onClick={() => toggleSort('tier')}>Tier</th>
              <th onClick={() => toggleSort('netWorth')}>Net Worth</th>
              <th onClick={() => toggleSort('location')}>Location</th>
              <th>ICC Match</th>
              <th onClick={() => toggleSort('updatedAt')}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} onClick={() => setSelectedId(p.id)}>
                <td className="name-cell">{p.name}</td>
                <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                <td><span className="tier">Tier {p.tier}</span></td>
                <td className="mono">{p.netWorth || '—'}</td>
                <td>{p.location || '—'}</td>
                <td>{(p.iccNetworkMatches || []).length > 0 ? <span className="icc-match">⚡ {p.iccNetworkMatches.length}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
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
    </>
  );
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
