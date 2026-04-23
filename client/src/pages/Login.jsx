import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { user } = await api.post('/api/auth/login', { email, password });
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1><span style={{ color: 'var(--accent-green)' }}>ICC</span> Donor Intelligence</h1>
        <p className="subtitle">Sign in to access donor research, network matches, and prospect tracking.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ marginBottom: 14 }}>
          <label>Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? <span className="spinner" /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
