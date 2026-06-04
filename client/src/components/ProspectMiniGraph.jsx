import React from 'react';
import ForceGraph from './ForceGraph.jsx';

export default function ProspectMiniGraph({ prospect, matches, onDonorClick }) {
  if (!matches || matches.length === 0) {
    return (
      <div className="card" style={{ background: 'var(--bg-elev)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 16px' }}>
        No ICC network connections mapped yet — run AI research to detect connections.
      </div>
    );
  }

  const prospectNodeId = `prospect_${prospect.id}`;

  const nodes = [
    { id: prospectNodeId, rawId: prospect.id, label: prospect.name, type: 'prospect', status: prospect.status },
    ...matches.map((d) => ({ id: `donor_${d.id}`, rawId: d.id, label: d.name, type: 'donor' })),
  ];

  const edges = matches.map((d) => ({
    source: `donor_${d.id}`,
    target: prospectNodeId,
    detail: '',
  }));

  return (
    <ForceGraph
      nodes={nodes}
      edges={edges}
      height={300}
      centerNodeId={prospectNodeId}
      onNodeClick={(n) => {
        if (n.type === 'donor' && onDonorClick) onDonorClick(n);
      }}
    />
  );
}
