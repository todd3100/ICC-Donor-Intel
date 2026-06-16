// client/src/components/ExecutiveDashboard.jsx
// Batch C: Executive Dashboard with FY progress, pipeline funnel, tier donut,
// top prospects, recent activity, and team task load.
//
// All data comes from a single /api/dashboard/summary call.

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';

// ---- formatting helpers ----------------------------------------------------
function fmtMoney(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}
function fmtMoneyFull(n) {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
function fmtPct(n) {
  if (n == null) return '—';
  return `${Math.round(n * 10) / 10}%`;
}
function fmtRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const STAGE_LABELS = {
  identified: 'Identified',
  researched: 'Researched',
  warm_intro_made: 'Warm Intro',
  meeting_scheduled: 'Meeting',
  cultivation: 'Cultivation',
  ask_made: 'Ask Made',
  closed_won: 'Closed Won',
  closed_declined: 'Declined',
};
const TIER_COLORS = ['#4ade80', '#facc15', '#94a3b8']; // T1 green, T2 amber, T3 grey
const STAGE_COLOR = '#60a5fa';

// ---- action label for audit log entries -----------------------------------
function actionLabel(a) {
  switch (a) {
    case 'task_created': return 'created a task';
    case 'task_completed': return 'completed a task';
    case 'task_reopened': return 'reopened a task';
    case 'task_deleted': return 'deleted a task';
    case 'stage_change': return 'changed stage';
    case 'owner_change': return 'changed owner';
    case 'prospect_created': return 'added prospect';
    case 'prospect_deleted': return 'deleted prospect';
    case 'research_completed': return 'completed AI research';
    case 'note_added': return 'added a note';
    case 'suggested_ask_override': return 'overrode suggested ask';
    default: return a.replace(/_/g, ' ');
  }
}

// ---- main component -------------------------------------------------------
export default function ExecutiveDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // api.get returns the parsed JSON directly (fetch wrapper, not axios).
        const json = await api.get('/api/dashboard/summary');
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e?.data?.error || e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading dashboard…</div>;
  if (error) return <div style={{ padding: 24, color: 'var(--accent-red, #f87171)' }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '8px 4px 24px' }}>
      <FyGoals goals={data.goals} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <PipelineChart pipeline={data.pipelineByStage} totals={data.totals} />
        <TierDonut tiers={data.tierBreakdown} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        <TopProspects rows={data.topProspects} />
        <TeamTaskLoad rows={data.teamTaskLoad} />
      </div>
      <RecentActivity rows={data.recentActivity} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        Generated {fmtRelative(data.generatedAt)}
      </div>
    </div>
  );
}

// ---- FY Goals widget ------------------------------------------------------
function FyGoals({ goals }) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <FyCard fy={goals.fy26} />
      <FyCard fy={goals.fy27} />
    </section>
  );
}

function FyCard({ fy }) {
  const pct = fy.pctGoal || 0;
  const elapsed = fy.pctFyElapsed || 0;
  // Color: green if pct >= elapsed, amber if within 10 pts, red otherwise.
  let barColor = '#4ade80';
  if (pct < elapsed - 10) barColor = '#f87171';
  else if (pct < elapsed) barColor = '#facc15';

  const clampedWidth = Math.min(100, pct);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{fy.label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtPct(elapsed)} of FY elapsed</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
        <div style={{ fontSize: 28, fontWeight: 600 }}>{fmtMoney(fy.raisedToDate)}</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>of {fmtMoney(fy.goal)}</div>
      </div>
      <div style={{ position: 'relative', marginTop: 14, height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{
          width: `${clampedWidth}%`,
          height: '100%',
          background: barColor,
          transition: 'width .4s ease',
        }} />
        {elapsed > 0 && elapsed < 100 && (
          <div style={{
            position: 'absolute',
            left: `${elapsed}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: 'rgba(255,255,255,0.55)',
          }} title="FY elapsed marker" />
        )}
      </div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: barColor, fontWeight: 600 }}>{fmtPct(pct)} to goal</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {pct >= 100 ? 'Goal met' : `${fmtMoney(Math.max(0, fy.goal - fy.raisedToDate))} to go`}
        </span>
      </div>
    </div>
  );
}

// ---- Pipeline chart -------------------------------------------------------
function PipelineChart({ pipeline, totals }) {
  const chartData = pipeline.map((row) => ({
    stage: STAGE_LABELS[row.stage] || row.stage,
    Prospects: row.count,
    suggestedMin: row.totalSuggestedMin,
    suggestedMax: row.totalSuggestedMax,
  }));
  return (
    <div style={cardStyle}>
      <div style={cardHeader}>
        <span>Pipeline by stage</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
          {totals.prospects} prospects · {fmtMoney(totals.pipelineMin)}–{fmtMoney(totals.pipelineMax)}
        </span>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="stage" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }}
              formatter={(value, name, item) => {
                if (name === 'Prospects') {
                  const min = item.payload.suggestedMin;
                  const max = item.payload.suggestedMax;
                  return [`${value} · ${fmtMoney(min)}–${fmtMoney(max)}`, name];
                }
                return [value, name];
              }}
            />
            <Bar dataKey="Prospects" fill={STAGE_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- Tier donut -----------------------------------------------------------
function TierDonut({ tiers }) {
  const data = tiers.map((t, i) => ({
    name: `Tier ${t.tier}`,
    value: t.count,
    suggested: t.totalSuggestedMax,
    color: TIER_COLORS[i] || '#94a3b8',
  })).filter((d) => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={cardStyle}>
      <div style={cardHeader}>Prospect tier breakdown</div>
      {total === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No prospects yet.</div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {data.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }}
                formatter={(value, name, item) => [`${value} prospects · ${fmtMoney(item.payload.suggested)}`, name]}
              />
              <Legend
                verticalAlign="bottom"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---- Top prospects -------------------------------------------------------
function TopProspects({ rows }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeader}>Top 10 prospects by suggested ask</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No prospects with a suggested ask yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((p) => (
            <div key={p.id} style={topRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={tierBadgeStyle(p.tier)}>T{p.tier}</span>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={stagePillStyle}>{STAGE_LABELS[p.stage] || p.stage}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.owner || 'Unassigned'}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(p.suggestedAskMin)}–{fmtMoney(p.suggestedAskMax)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Team task load ------------------------------------------------------
function TeamTaskLoad({ rows }) {
  const chartData = rows.map((r) => ({
    assignee: r.assignee,
    Open: r.open - r.overdue,
    Overdue: r.overdue,
  }));
  const totalOpen = rows.reduce((s, r) => s + r.open, 0);
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0);
  return (
    <div style={cardStyle}>
      <div style={cardHeader}>
        <span>Team task load</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
          {totalOpen} open · {totalOverdue} overdue
        </span>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="assignee" stroke="var(--text-muted)" tick={{ fontSize: 11 }} interval={0} />
            <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />
            <Bar dataKey="Open" stackId="a" fill="#60a5fa" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Overdue" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- Recent activity ----------------------------------------------------
function RecentActivity({ rows }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeader}>Recent activity</div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>No activity yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 4px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 110 }}>{r.user?.name || 'System'}</span>
                <span>{actionLabel(r.action)}</span>
                {r.prospect && <span style={{ color: 'var(--accent-blue, #60a5fa)' }}>· {r.prospect.name}</span>}
                {r.detail && <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {r.detail}</span>}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, marginLeft: 12 }}>{fmtRelative(r.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- shared styles -------------------------------------------------------
const cardStyle = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const cardHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.02em',
  marginBottom: 6,
};
const topRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 4px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13,
  gap: 12,
  minWidth: 0,
};
const stagePillStyle = {
  fontSize: 10,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  padding: '2px 8px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.12)',
};
function tierBadgeStyle(tier) {
  const colors = { 1: '#4ade80', 2: '#facc15', 3: '#94a3b8' };
  return {
    display: 'inline-block',
    minWidth: 24,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 700,
    color: '#0b1220',
    background: colors[tier] || '#94a3b8',
    borderRadius: 4,
    padding: '2px 4px',
  };
}
