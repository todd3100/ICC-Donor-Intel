import React, { useEffect, useMemo, useState } from 'react';
import { Check, Trash2, Edit3, X, Phone, Mail, Users, Search, Send, MoreHorizontal, AlertTriangle, Clock } from 'lucide-react';
import { api } from '../api.js';
import ProspectDetail from './ProspectDetail.jsx';

export const TASK_TYPES = [
  { key: 'call',           label: 'Call',           icon: Phone },
  { key: 'email',          label: 'Email',          icon: Mail },
  { key: 'meeting',        label: 'Meeting',        icon: Users },
  { key: 'research',       label: 'Research',       icon: Search },
  { key: 'send_materials', label: 'Send materials', icon: Send },
  { key: 'other',          label: 'Other',          icon: MoreHorizontal },
];
export const TASK_TYPE_LABELS = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t.label]));
export const TASK_TYPE_ICONS  = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t.icon]));

/**
 * MyQueue — the tasks tab inside Dashboard.
 *
 * Filters:
 *   - Assignee (defaults to the current logged-in user's name; "All" toggle)
 *   - Status: Open / All / Completed
 *   - Type
 *   - Bucket: All / Overdue / Due today / Due this week
 */
export default function MyQueue({ user }) {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({ overdue: 0, dueToday: 0, dueThisWeek: 0, openTotal: 0, openTotalAll: 0 });
  const [staffSuggestions, setStaffSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [assignee, setAssignee] = useState(user?.name || '');   // default to me
  const [showAllAssignees, setShowAllAssignees] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');     // open | all | completed
  const [typeFilter, setTypeFilter] = useState('');
  const [bucket, setBucket] = useState('');                     // '' | overdue | dueToday | dueThisWeek

  const [editingId, setEditingId] = useState(null);
  const [selectedProspectId, setSelectedProspectId] = useState(null);

  const effectiveAssignee = showAllAssignees ? '' : assignee;

  async function loadStaff() {
    try {
      const { suggestions } = await api.get('/api/staff-suggestions');
      setStaffSuggestions(suggestions || []);
    } catch {}
  }

  async function load() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (effectiveAssignee) params.set('assignee', effectiveAssignee);
    if (statusFilter === 'open')      params.set('completed', 'false');
    if (statusFilter === 'completed') params.set('completed', 'true');
    if (typeFilter) params.set('type', typeFilter);
    if (bucket) params.set(bucket, 'true');
    try {
      const { tasks } = await api.get('/api/tasks?' + params.toString());
      setTasks(tasks);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary() {
    try {
      const params = new URLSearchParams();
      if (effectiveAssignee) params.set('assignee', effectiveAssignee);
      const s = await api.get('/api/tasks/summary?' + params.toString());
      setSummary(s);
    } catch {}
  }

  useEffect(() => { loadStaff(); }, []);
  useEffect(() => { load(); loadSummary(); /* eslint-disable-next-line */ },
    [effectiveAssignee, statusFilter, typeFilter, bucket]);

  async function toggleComplete(task) {
    try {
      await api.patch(`/api/tasks/${task.id}`, { completed: !task.completed });
      await load(); await loadSummary();
    } catch (e) { setError(e.message); }
  }
  async function deleteTask(task) {
    if (!confirm(`Delete task: "${task.description.slice(0, 80)}"?`)) return;
    try {
      await api.del(`/api/tasks/${task.id}`);
      await load(); await loadSummary();
    } catch (e) { setError(e.message); }
  }
  async function saveEdit(taskId, payload) {
    try {
      await api.patch(`/api/tasks/${taskId}`, payload);
      setEditingId(null);
      await load(); await loadSummary();
    } catch (e) { setError(e.message); }
  }

  // Group tasks by bucket for the visual list
  const grouped = useMemo(() => groupByBucket(tasks), [tasks]);

  return (
    <>
      {/* Summary strip */}
      <div style={summaryStrip}>
        <BucketPill label="Overdue" count={summary.overdue}
          active={bucket === 'overdue'} color="#ef4444"
          icon={<AlertTriangle size={12} />}
          onClick={() => setBucket(bucket === 'overdue' ? '' : 'overdue')} />
        <BucketPill label="Due today" count={summary.dueToday}
          active={bucket === 'dueToday'} color="#f59e0b"
          icon={<Clock size={12} />}
          onClick={() => setBucket(bucket === 'dueToday' ? '' : 'dueToday')} />
        <BucketPill label="Due this week" count={summary.dueThisWeek}
          active={bucket === 'dueThisWeek'} color="#3b82f6"
          onClick={() => setBucket(bucket === 'dueThisWeek' ? '' : 'dueThisWeek')} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {showAllAssignees
            ? `${summary.openTotalAll} open across the team`
            : `${summary.openTotal} open for ${assignee || '(unassigned)'} · ${summary.openTotalAll} team-wide`}
        </span>
      </div>

      {/* Filters */}
      <div className="toolbar">
        <label style={filterLabel}>Assignee</label>
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={showAllAssignees ? '__all__' : assignee}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__all__') { setShowAllAssignees(true); }
            else { setShowAllAssignees(false); setAssignee(v); }
          }}
        >
          <option value="__all__">All assignees</option>
          {(staffSuggestions.length ? staffSuggestions : [user?.name].filter(Boolean)).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
          {/* Always include the current user so it's always selectable */}
          {user?.name && !staffSuggestions.includes(user.name) && (
            <option value={user.name}>{user.name}</option>
          )}
        </select>

        <label style={filterLabel}>Status</label>
        <select className="select" style={{ maxWidth: 130 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="completed">Completed</option>
        </select>

        <label style={filterLabel}>Type</label>
        <select className="select" style={{ maxWidth: 140 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        {bucket && (
          <button className="btn btn-ghost btn-sm" onClick={() => setBucket('')}>Clear bucket: {bucketLabel(bucket)} ✕</button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : tasks.length === 0 ? (
        <div className="empty">
          {statusFilter === 'open' ? 'No open tasks match these filters.' : 'No tasks match these filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([key, group]) => (
            group.tasks.length === 0 ? null : (
              <TaskGroup
                key={key}
                title={group.title}
                color={group.color}
                tasks={group.tasks}
                editingId={editingId}
                setEditingId={setEditingId}
                onToggle={toggleComplete}
                onDelete={deleteTask}
                onSave={saveEdit}
                onProspectClick={setSelectedProspectId}
                staffSuggestions={staffSuggestions}
              />
            )
          ))}
        </div>
      )}

      {selectedProspectId && (
        <ProspectDetail
          id={selectedProspectId}
          user={user}
          onClose={() => setSelectedProspectId(null)}
          onChanged={() => { load(); loadSummary(); }}
        />
      )}
    </>
  );
}

// ---------- TaskGroup (header + cards) ----------

function TaskGroup({ title, color, tasks, editingId, setEditingId, onToggle, onDelete, onSave, onProspectClick, staffSuggestions }) {
  return (
    <div>
      <div style={{ ...groupHeader, borderLeft: `3px solid ${color}` }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tasks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tasks.map((t) => (
          editingId === t.id ? (
            <TaskEditRow
              key={t.id}
              task={t}
              onCancel={() => setEditingId(null)}
              onSave={(payload) => onSave(t.id, payload)}
              staffSuggestions={staffSuggestions}
            />
          ) : (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={onToggle}
              onEdit={() => setEditingId(t.id)}
              onDelete={onDelete}
              onProspectClick={onProspectClick}
            />
          )
        ))}
      </div>
    </div>
  );
}

// ---------- TaskRow (presentational) ----------

function TaskRow({ task, onToggle, onEdit, onDelete, onProspectClick }) {
  const Icon = TASK_TYPE_ICONS[task.type] || MoreHorizontal;
  const dueClass = dueClassFor(task);
  return (
    <div style={{
      ...taskRowStyle,
      opacity: task.completed ? 0.55 : 1,
      borderLeft: dueClass ? `3px solid ${dueClass.color}` : `3px solid transparent`,
    }}>
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => onToggle(task)}
        title={task.completed ? 'Reopen' : 'Mark complete'}
        style={{ marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <Icon size={11} /> {TASK_TYPE_LABELS[task.type] || task.type}
          </span>
          {task.prospectName && (
            <button
              type="button"
              onClick={() => onProspectClick && onProspectClick(task.prospectId)}
              style={prospectLink}
              title="Open prospect"
            >
              {task.prospectName}
            </button>
          )}
          {task.assignedTo && (
            <span style={assigneePill}>👤 {task.assignedTo}</span>
          )}
          {task.dueDate && (
            <span style={{ ...duePill, color: dueClass ? dueClass.color : 'var(--text-muted)', borderColor: dueClass ? dueClass.color + '55' : 'transparent', background: dueClass ? dueClass.color + '15' : 'transparent' }}>
              {formatDueDate(task.dueDate)}{dueClass ? ` · ${dueClass.label}` : ''}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, marginTop: 4, textDecoration: task.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>
          {task.description}
        </div>
        {task.createdByName && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Added by {task.createdByName} · {new Date(task.createdAt).toLocaleDateString()}
            {task.completedAt && ` · Completed ${new Date(task.completedAt).toLocaleDateString()}`}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        <button className="btn btn-ghost btn-sm" onClick={onEdit} title="Edit"><Edit3 size={12} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => onDelete(task)} title="Delete"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

// ---------- TaskEditRow (in-place editor) ----------

function TaskEditRow({ task, onCancel, onSave, staffSuggestions }) {
  const [description, setDescription] = useState(task.description);
  const [type, setType] = useState(task.type || 'other');
  const [assignedTo, setAssignedTo] = useState(task.assignedTo || '');
  const [dueDate, setDueDate] = useState(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!description.trim()) return;
    setSaving(true);
    try {
      await onSave({
        description: description.trim(),
        type,
        assignedTo: assignedTo.trim() || null,
        dueDate: dueDate || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ ...taskRowStyle, alignItems: 'stretch', flexDirection: 'column', gap: 8 }}>
      <input
        className="input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Task description"
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="select" style={{ maxWidth: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <AssigneeCombobox
          value={assignedTo}
          onChange={setAssignedTo}
          suggestions={staffSuggestions}
        />
        <input
          type="date"
          className="input"
          style={{ maxWidth: 160 }}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}><X size={12} /> Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !description.trim()}>
          {saving ? <span className="spinner" /> : <><Check size={12} /> Save</>}
        </button>
      </div>
    </div>
  );
}

// ---------- AssigneeCombobox (free-text + datalist) ----------

export function AssigneeCombobox({ value, onChange, suggestions, placeholder = 'Assign to…', style }) {
  const listId = 'staff-suggestions-dl';
  return (
    <>
      <input
        className="input"
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ maxWidth: 180, ...(style || {}) }}
      />
      <datalist id={listId}>
        {(suggestions || []).map((s) => <option key={s} value={s} />)}
      </datalist>
    </>
  );
}

// ---------- Helpers ----------

function groupByBucket(tasks) {
  const groups = {
    overdue:    { title: 'Overdue',          color: '#ef4444', tasks: [] },
    today:      { title: 'Due today',        color: '#f59e0b', tasks: [] },
    week:       { title: 'Due this week',    color: '#3b82f6', tasks: [] },
    later:      { title: 'Due later',        color: '#8b5cf6', tasks: [] },
    nodate:     { title: 'No due date',      color: '#6b7280', tasks: [] },
    completed:  { title: 'Completed',        color: '#10b981', tasks: [] },
  };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = (() => {
    const d = new Date();
    const dow = d.getDay();          // 0..6 Sun..Sat
    const daysToSun = (7 - dow) % 7;
    d.setDate(d.getDate() + daysToSun);
    d.setHours(23, 59, 59, 999);
    return d;
  })();

  for (const t of tasks) {
    if (t.completed) { groups.completed.tasks.push(t); continue; }
    if (!t.dueDate)  { groups.nodate.tasks.push(t); continue; }
    const due = new Date(t.dueDate);
    if (due < startOfToday)      groups.overdue.tasks.push(t);
    else if (due <= endOfToday)  groups.today.tasks.push(t);
    else if (due <= endOfWeek)   groups.week.tasks.push(t);
    else                         groups.later.tasks.push(t);
  }
  return groups;
}

function dueClassFor(task) {
  if (task.completed || !task.dueDate) return null;
  const due = new Date(task.dueDate);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (due < startOfToday)     return { label: 'overdue',   color: '#ef4444' };
  if (due <= endOfToday)      return { label: 'today',     color: '#f59e0b' };
  return null;
}

function formatDueDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function bucketLabel(b) {
  return ({ overdue: 'Overdue', dueToday: 'Due today', dueThisWeek: 'Due this week' })[b] || b;
}

// ---------- Inline styles ----------
const summaryStrip = {
  display: 'flex',
  gap: 8,
  marginBottom: 14,
  alignItems: 'center',
  flexWrap: 'wrap',
};
const filterLabel = {
  fontSize: 11,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginBottom: 0,
};
const groupHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 10px',
  marginBottom: 6,
  background: 'var(--bg-elevated, #1a1a1a)',
  borderRadius: 4,
  fontSize: 12,
};
const taskRowStyle = {
  display: 'flex',
  gap: 10,
  padding: '10px 12px',
  background: 'var(--bg-elevated, #161616)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 6,
  alignItems: 'flex-start',
};
const prospectLink = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  color: 'var(--accent, #3b82f6)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
};
const assigneePill = {
  fontSize: 11,
  color: 'var(--text-muted)',
  padding: '1px 6px',
  borderRadius: 8,
  background: 'var(--bg, #0e0e0e)',
};
const duePill = {
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid',
  fontWeight: 500,
};

// ---------- BucketPill ----------
function BucketPill({ label, count, color, active, onClick, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 14,
        border: `1px solid ${active ? color : color + '55'}`,
        background: active ? color + '22' : color + '0d',
        color: color,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {icon}
      {label}
      <span style={{
        background: color,
        color: '#fff',
        padding: '0 6px',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        minWidth: 18,
        textAlign: 'center',
      }}>{count}</span>
    </button>
  );
}
