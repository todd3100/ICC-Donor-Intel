import React, { useState } from 'react';
import ProspectList from '../components/ProspectList.jsx';
import DonorList from '../components/DonorList.jsx';
import UsersAdmin from '../components/UsersAdmin.jsx';
import { api } from '../api.js';

export default function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState('prospects');

  async function logout() {
    await api.post('/api/auth/logout');
    onLogout();
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>
          <span className="logo-accent">ICC</span> Donor Intelligence
        </h1>
        <div className="user-info">
          <span>{user.name} · <span style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em', color: user.role === 'admin' ? 'var(--accent-amber)' : 'var(--text-muted)' }}>{user.role}</span></span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'prospects' ? 'active' : ''}`} onClick={() => setTab('prospects')}>Prospects</button>
        <button className={`tab ${tab === 'donors' ? 'active' : ''}`} onClick={() => setTab('donors')}>ICC Donor Network</button>
        {user.role === 'admin' && (
          <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</button>
        )}
      </div>

      <div className="content">
        {tab === 'prospects' && <ProspectList user={user} />}
        {tab === 'donors' && <DonorList user={user} />}
        {tab === 'users' && user.role === 'admin' && <UsersAdmin />}
      </div>
    </div>
  );
}
