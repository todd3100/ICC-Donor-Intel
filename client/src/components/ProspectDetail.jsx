import React, { useEffect, useState, useMemo } from 'react';
import { Landmark, ClipboardList, Megaphone, Zap, Mail, Check, AlertTriangle, ChevronDown, ChevronRight, GraduationCap } from 'lucide-react';
import { api } from '../api.js';
import AIResearchPanel from './AIResearchPanel.jsx';
import TeamNotes from './TeamNotes.jsx';
import ActivityLog from './ActivityLog.jsx';
import ProspectEditForm from './ProspectEditForm.jsx';
import ProspectMiniGraph from './ProspectMiniGraph.jsx';

const UNI_PATTERN = /\b(Harvard|Penn|Wharton|Columbia|Brown|Cornell|Northwestern|Yale|Princeton|Stanford|MIT|Dartmouth|Berkeley|UCLA|NYU|Duke|Chicago|Michigan|Brandeis|Hunter College|Ohio State|Stony Brook|Yeshiva University|Tel Aviv University|Jerusalem College of Technology)\b/g;
const HL_PATTERN = /\b(withdrew|withdrawn|pulled|letter|resign(?:ed|ing)?|antisemitism|antisemitic|protest(?:s|ers|ed)?)\b/gi;

export default function ProspectDetail({ id, user, onClose, onChanged }) {
  const [prospect, setProspect] = useState(null);
  const [matches, setMatches] = useState([]);
  const [allDonors, setAllDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [reRun, setReRun] = useState(false);

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

  // Cache the full donor list once for client-side cross-reference
  useEffect(() => {
    api.get('/api/donors').then(({ donors }) => setAllDonors(donors || [])).catch(() => {});
  }, []);

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

  const donorNamesSet = useMemo(() => new Set(allDonors.map((d) => d.name.toLowerCase())), [allDonors]);
  const warmPathway = useMemo(() => extractWarmPathway(prospect?.connectionDetail), [prospect?.connectionDetail]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" style={{ width: '90vw', maxWidth: 1200 }}>
        <div className="drawer-header">
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600 }}>
              {prospect ? prospect.name : 'Loading…'}
              {prospect?.aiResearchCompleted && !prospect.aiResearchError && (
                <span className="research-icon ok" title="AI research complete"><Check size={16} /></span>
              )}
              {prospect?.aiResearchError && (
                <span className="research-icon err" title={prospect.aiResearchErrorMsg || 'AI research error'}><AlertTriangle size={16} /></span>
              )}
            </div>
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
              {/* Research banner */}
              {!prospect.aiResearchCompleted && !reRun && (
                <div className="research-banner">
                  <span>Research pending — run bulk research from the Prospects page, or research this profile now.</span>
                  <button className="btn btn-sm" onClick={() => setReRun(true)}>Research now</button>
                </div>
              )}

              {/* Mini network graph */}
              <ProspectMiniGraph prospect={prospect} matches={matches} />

              <div className="detail-grid" style={{ marginTop: 16 }}>
                {/* LEFT — At a Glance */}
                <div>
                  <AtAGlanceCard prospect={prospect} matches={matches} warmPathway={warmPathway} />
                </div>

                {/* RIGHT — Collapsible sections */}
                <div>
                  <CollapsibleSection id={`p-${id}-campus`} title="Campus Connections">
                    {prospect.campusConnections?.length ? (
                      <ul>
                        {prospect.campusConnections.map((s, i) => (
                          <li key={i} dangerouslySetInnerHTML={{ __html: formatCampus(s) }} />
                        ))}
                      </ul>
                    ) : <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None recorded yet.</div>}
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-philanthropic`} title="Philanthropic Footprint">
                    {prospect.philanthropicFootprint?.length ? (
                      <ul>
                        {prospect.philanthropicFootprint.map((s, i) => (
                          <li key={i} dangerouslySetInnerHTML={{ __html: formatPhilanthropy(s, donorNamesSet) }} />
                        ))}
                      </ul>
                    ) : <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None recorded yet.</div>}
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-oct7`} title="Post-Oct 7 Signals">
                    {prospect.oct7Signals ? (
                      <Oct7Signals text={prospect.oct7Signals} />
                    ) : <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None recorded.</div>}
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-personal`} title="Personal Connections">
                    <PersonalConnections prospect={prospect} />
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-identity`} title="Identity & Background">
                    <dl className="kv">
                      <dt>Age</dt><dd>{prospect.age ?? '—'}</dd>
                      <dt>Undergrad</dt><dd>{prospect.undergrad || '—'}</dd>
                      <dt>Graduate</dt><dd>{prospect.grad || '—'}</dd>
                      <dt>Occupation</dt><dd>{prospect.occupation || '—'}</dd>
                      <dt>Previous roles</dt><dd>{prospect.previousRoles?.length ? <div className="tag-list">{prospect.previousRoles.map((r, i) => <span className="tag" key={i}>{r}</span>)}</div> : '—'}</dd>
                    </dl>
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-outreach`} title="Outreach Tracking">
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
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-notes`} title="Team Notes">
                    <TeamNotes prospect={prospect} onAdded={load} />
                  </CollapsibleSection>

                  <CollapsibleSection id={`p-${id}-log`} title="Activity Log" defaultOpen={false}>
                    <ActivityLog entries={prospect.auditLogs || []} />
                  </CollapsibleSection>

                  {/* AI research panel — moved into a secondary spot */}
                  {(prospect.aiResearchCompleted || reRun) ? (
                    <CollapsibleSection id={`p-${id}-airesearch`} title="AI Research" defaultOpen={reRun}>
                      <AIResearchPanel prospect={prospect} onApplied={load} />
                      {prospect.aiResearchCompleted && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                          Last run: {prospect.aiResearchLastRun ? new Date(prospect.aiResearchLastRun).toLocaleString() : '—'}
                        </div>
                      )}
                    </CollapsibleSection>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function AtAGlanceCard({ prospect, matches, warmPathway }) {
  const signals = useMemo(() => {
    const list = [];
    if (prospect.campusConnections?.length) list.push({ icon: <Landmark size={12} />, label: 'Named campus donor' });
    const trustee = (prospect.campusConnections || []).concat(prospect.previousRoles || []).some((s) => /trustee|board/i.test(s));
    if (trustee) list.push({ icon: <ClipboardList size={12} />, label: 'Trustee / Board' });
    if (prospect.oct7Signals) list.push({ icon: <Megaphone size={12} />, label: 'Post-Oct 7 statement' });
    if (prospect.contacted) list.push({ icon: <Mail size={12} />, label: 'Contacted' });
    return list;
  }, [prospect]);

  return (
    <div className="at-a-glance">
      <div className="name">{prospect.name}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`badge badge-${prospect.status}`}>{prospect.status}</span>
        <span className="tier">Tier {prospect.tier}</span>
      </div>

      {prospect.netWorth && (
        <div className="net-worth">
          {prospect.netWorth}
          {prospect.netWorthSource && <span className="net-worth-source">{prospect.netWorthSource}</span>}
        </div>
      )}
      {prospect.occupation && <div className="occupation">{prospect.occupation}</div>}
      {prospect.location && <div className="location">{prospect.location}</div>}

      <div className="signal-row">
        {(prospect.iccNetworkMatches?.length || 0) > 0 && (
          <span className="signal-pill icc"><Zap size={14} /> {prospect.iccNetworkMatches.length} ICC match{prospect.iccNetworkMatches.length !== 1 ? 'es' : ''}</span>
        )}
        {signals.map((s, i) => (
          <span className="signal-pill" key={i}>{s.icon} {s.label}</span>
        ))}
      </div>

      {matches.length > 0 && (
        <div className="icc-network-block">
          <div className="heading">⚡ ICC Network Connections</div>
          {matches.map((d) => (
            <div className="match-row" key={d.id}>
              <span className="donor-name">{d.name}</span>
              {d.principals?.length > 0 && <div className="principals">Principals: {d.principals.join(', ')}</div>}
            </div>
          ))}
        </div>
      )}

      {warmPathway && (
        <div className="warm-pathway">
          <div className="heading">Warm Pathway</div>
          <div>{warmPathway}</div>
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({ id, title, children, defaultOpen = true }) {
  const storageKey = `section-open:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = sessionStorage.getItem(storageKey);
      if (v === null) return defaultOpen;
      return v === '1';
    } catch { return defaultOpen; }
  });
  function toggle() {
    setOpen((o) => {
      const next = !o;
      try { sessionStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      return next;
    });
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="section-header" onClick={toggle}>
        <span className="title">{title}</span>
        <span className="toggle">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Oct7Signals({ text }) {
  const sentences = splitToSentences(text);
  const bullets = sentences.length > 3;

  function highlight(s) {
    return s.replace(HL_PATTERN, '<span class="hl">$1</span>');
  }

  if (bullets) {
    return (
      <ul>
        {sentences.map((s, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: highlight(escapeHtml(s)) }} />
        ))}
      </ul>
    );
  }
  return <div style={{ fontSize: 13, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: highlight(escapeHtml(text)) }} />;
}

function PersonalConnections({ prospect }) {
  const items = [];
  if (prospect.spouse) items.push({ label: 'Spouse', text: prospect.spouse });
  if (prospect.children) items.push({ label: 'Children', text: prospect.children, hasGrad: true });
  if (prospect.personalConnections) items.push({ label: 'Other', text: prospect.personalConnections });

  if (items.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None recorded.</div>;

  return (
    <ul>
      {items.map((it, i) => (
        <li key={i}>
          <strong>{it.label}:</strong> <span dangerouslySetInnerHTML={{ __html: formatPersonal(it.text, it.hasGrad) }} />
        </li>
      ))}
    </ul>
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

// --- Formatters ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatCampus(s) {
  let html = escapeHtml(s);
  html = html.replace(UNI_PATTERN, '<span class="uni">$1</span>');
  // Italicize text after a colon, or text in quotes
  html = html.replace(/(:\s*)([A-Z][^.;]+)/g, '$1<span class="named">$2</span>');
  html = html.replace(/&quot;([^&]+)&quot;/g, '<span class="named">"$1"</span>');
  return html;
}

function formatPhilanthropy(s, donorNamesSet) {
  let html = escapeHtml(s);
  // Bold any donor name from the ICC donor list (case-insensitive whole-word match)
  for (const name of donorNamesSet) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${escapedName})\\b`, 'gi');
    html = html.replace(re, '<span class="donor-match">$1</span>');
  }
  return html;
}

function formatPersonal(text, hasGrad) {
  let html = escapeHtml(text);
  // Bold any capitalized two-word name (rough heuristic)
  html = html.replace(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g, '<strong>$1</strong>');
  if (hasGrad) {
    html = html.replace(UNI_PATTERN, '<span class="uni">🎓 $1</span>');
  }
  return html;
}

function splitToSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractWarmPathway(connectionDetail) {
  if (!connectionDetail) return null;
  // Try to extract the "Warm Pathway Summary:" section
  const re = /Warm Pathway(?:\s+Summary)?:\s*([\s\S]+?)(?:\n\n|Suggested ask|Notes:|$)/i;
  const m = connectionDetail.match(re);
  if (m && m[1]) return m[1].trim();
  // Fallback: first 2-3 sentences of connectionDetail
  const sentences = splitToSentences(connectionDetail);
  if (sentences.length === 0) return null;
  return sentences.slice(0, 3).join(' ');
}
