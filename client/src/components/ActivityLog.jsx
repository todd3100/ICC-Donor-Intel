import React from 'react';

export default function ActivityLog({ entries }) {
  if (!entries?.length) {
    return (
      <div className="card">
        <h3>Activity Log</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No activity yet.</div>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Activity Log</h3>
      {entries.map((e) => (
        <div key={e.id} className="log-entry">
          <span className="who">{e.user?.name || 'system'}</span>
          {' — '}
          <span>{e.detail || e.action}</span>
          {' '}
          <span className="when">· {new Date(e.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
