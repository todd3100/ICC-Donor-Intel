import React, { useState } from 'react';
import { api } from '../api.js';

export default function CSVUpload({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await api.upload('/api/donors/import', fd);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import donor CSV</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Expected columns: <code className="mono">name, type, principals, notes</code>. Multiple principals separated by semicolons. Rows whose <code className="mono">name</code> matches an existing donor are updated; new rows are added.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        {!result && (
          <>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0])} style={{ marginBottom: 14 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={upload} disabled={!file || uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="alert alert-success">
              Added: {result.added} · Updated: {result.updated} · Skipped: {result.skipped}
            </div>
            {result.errors?.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-amber)' }}>{result.errors.length} row errors</summary>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(result.errors, null, 2)}</pre>
              </details>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-primary" onClick={onImported}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
