import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import ForceGraph from './ForceGraph.jsx';
import ProspectDetail from './ProspectDetail.jsx';

const STATUS_COLORS = {
  hot: '#e85d3a',
  warm: '#e8a23a',
  cold: '#6b8cae',
  connected: '#4caf82',
};

export default function ConnectionMap({ user }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [], counts: { donors: 0, prospects: 0, connections: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [selectedProspectId, setSelectedProspectId] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  async function load() {
    try {
      const data = await api.get('/api/network/graph');
      setGraph(data);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function handleNodeClick(node) {
    if (node.type === 'donor') {
      const prospectsConnected = graph.edges
        .filter((e) => (typeof e.source === 'object' ? e.source.id : e.source) === node.id)
        .map((e) => {
          const targetId = typeof e.target === 'object' ? e.target.id : e.target;
          return graph.nodes.find((n) => n.id === targetId);
        })
        .filter(Boolean);
      setSelectedDonor({ ...node, prospects: prospectsConnected });
    } else if (node.type === 'prospect') {
      setSelectedProspectId(node.rawId);
    }
  }

  if (loading) return <div className="empty"><span className="spinner" /></div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (graph.nodes.length === 0) {
    return <div className="empty">No ICC network connections mapped yet. Run AI research on prospects to populate the map.</div>;
  }

  if (isMobile) {
    return <MobileNetworkList graph={graph} onProspectClick={(id) => setSelectedProspectId(id)} />;
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {graph.counts.donors} donors · {graph.counts.prospects} prospects · {graph.counts.connections} connections
        </div>
        <button className="btn btn-sm" onClick={() => setResetKey((k) => k + 1)}>Reset Layout</button>
      </div>

      <div style={{ position: 'relative' }}>
        <ForceGraph
          key={resetKey}
          nodes={graph.nodes}
          edges={graph.edges}
          height={Math.max(600, window.innerHeight - 260)}
          onNodeClick={handleNodeClick}
        />
        <Legend />
      </div>

      {selectedDonor && (
        <DonorSidebar donor={selectedDonor} onClose={() => setSelectedDonor(null)} onProspectClick={(id) => { setSelectedDonor(null); setSelectedProspectId(id); }} />
      )}

      {selectedProspectId && (
        <ProspectDetail
          id={selectedProspectId}
          user={user}
          onClose={() => setSelectedProspectId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div style={{
      position: 'absolute', top: 12, right: 12,
      background: 'var(--bg-panel)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 11,
      color: 'var(--text-dim)',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>Legend</div>
      <LegendRow color="#e8a23a" label="ICC Donor" />
      <LegendRow color={STATUS_COLORS.hot} label="Prospect · Hot" />
      <LegendRow color={STATUS_COLORS.warm} label="Prospect · Warm" />
      <LegendRow color={STATUS_COLORS.cold} label="Prospect · Cold" />
      <LegendRow color={STATUS_COLORS.connected} label="Prospect · Connected" />
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span>{label}</span>
    </div>
  );
}

function DonorSidebar({ donor, onClose, onProspectClick }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" style={{ width: 420 }}>
        <div className="drawer-header">
          <div>
            <div style={{ color: 'var(--accent-amber)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>ICC Donor</div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600 }}>{donor.label}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>{donor.prospects.length} connected prospect{donor.prospects.length !== 1 ? 's' : ''}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {donor.prospects.length === 0 ? (
            <div className="empty">No connected prospects.</div>
          ) : (
            donor.prospects.map((p) => (
              <div key={p.id} className="card" style={{ cursor: 'pointer', padding: 12 }} onClick={() => onProspectClick(p.rawId)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{p.label}</div>
                  <span className={`badge badge-${p.status}`}>{p.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function MobileNetworkList({ graph, onProspectClick }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const e of graph.edges) {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      const donor = graph.nodes.find((n) => n.id === sId);
      const prospect = graph.nodes.find((n) => n.id === tId);
      if (!donor || !prospect) continue;
      if (!m.has(donor.id)) m.set(donor.id, { donor, prospects: [] });
      m.get(donor.id).prospects.push(prospect);
    }
    return [...m.values()];
  }, [graph]);

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Network map shown as list view on mobile. {graph.counts.donors} donors · {graph.counts.prospects} prospects.
      </div>
      {groups.map(({ donor, prospects }) => (
        <div key={donor.id} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ color: 'var(--accent-amber)' }}>{donor.label}</h3>
          {prospects.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => onProspectClick(p.rawId)}>
              <span>{p.label}</span>
              <span className={`badge badge-${p.status}`}>{p.status}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
