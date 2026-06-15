import React, { useEffect, useState } from 'react';
import { Plus, Check, Trash2, Edit3, X, Phone, Mail, Users, Search, Send, MoreHorizontal } from 'lucide-react';
import { api } from '../api.js';
import { TASK_TYPES, TASK_TYPE_LABELS, TASK_TYPE_ICONS, AssigneeCombobox } from './MyQueue.jsx';

/**
 * TasksPanel — list + add tasks for a single prospect. Embedded in ProspectDetail.jsx.
 */
export default function TasksPanel({ prospectId, currentUserName }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staffSuggestions, setStaffSuggestions] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { tasks } = await api.get(`/api/prospects/${prospectId}/tasks`);
      setTasks(tasks);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStaff() {
    try {
      const { suggestions } = await api.get('/api/staff-suggestions');
      setStaffSuggestions(suggestions || []);
    } catch {}
  }

  useEffect(() => { load(); loadStaff(); /* eslint-disable-next-line */ }, [prospectId]);

  async function addTask(payload) {
    try {
      await api.post(`/api/prospects/${prospectId}/tasks`, payload);
      setShowAdd(false);
      await load();
    } catch (e) { setError(e.message); }
  }
  async function toggleComplete(task) {
    try {
      await api.patch(`/api/tasks/${task.id}`, { completed: !task.completed });
      await load();
    } catch (e) { setError(e.message); }
  }
  async function deleteTask(task) {
    if (!confirm(`Delete task: "${task.description.slice(0, 80)}"?`)) return;
    try { await api.del(`/api/tasks/${task.id}`); await load(); }
    catch (e) { setError(e.message); }
  }
  async function saveEdit(taskId, payload) {
    try {
      await api.patch(`/api/tasks/${taskId}`, payload);
      setEditingId(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  const open      = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) =>  t.completed);

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}

      {/* Open tasks */}
      {loading ? (
        <div className="empty"><span className="spinner" /></div>
      ) : open.length === 0 && !showAdd ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10 }}>
          No open tasks for this prospect.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {open.map((t) => editingId === t.id ? (
            <TaskEditInline
              key={t.id}
              task={t}
              staffSuggestions={staffSuggestions}
              onCancel={() => setEditingId(null)}
              onSave={(p) => saveEdit(t.id, p)}
            />
          ) : (
            <TaskRowInline
              key={t.id}
              task={t}
              onToggle={() => toggleComplete(t)}
              onEdit={() => setEditingId(t.id)}
              onDelete={() => deleteTask(t)}
            />
          ))}
        </div>
      )}

      {/* Add task button / form */}
      {showAdd ? (
        <NewTaskForm
          defaultAssignee={currentUserName || ''}
          staffSuggestions={staffSuggestions}
          onCancel={() => setShowAdd(false)}
          onSubmit={addTask}
        />
      ) : (
        <button className="btn btn-sm" onClick={() => setShowAdd(true)} style={{ marginBottom: 8 }}>
          <Plus size={12} /> Add task
        </button>
      )}

      {/* Completed tasks (collapsed-by-default summary) */}
      {completed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
            Completed ({completed.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {completed.map((t) => (
              <TaskRowInline
                key={t.id}
                task={t}
                onToggle={() => toggleComplete(t)}
                onEdit={() => setEditingId(t.id)}
                onDelete={() => deleteTask(t)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------- New task form ----------

function NewTaskForm({ defaultAssignee, staffSuggestions, onCancel, onSubmit }) {
  const [description, setDescription] = useState('');
  const [type, setType] = useState('call');
  const [assignedTo, setAssignedTo] = useState(defaultAssignee);
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e?.preventDefault?.();
    if (!description.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
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
    <form onSubmit={submit} style={{ ...formCardStyle }}>
      <input
        className="input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What needs to happen?"
        autoFocus
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}><X size={12} /> Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !description.trim()}>
          {saving ? <span className="spinner" /> : <><Plus size={12} /> Add</>}
        </button>
      </div>
    </form>
  );
}

// ---------- Inline task row ----------

function TaskRowInline({ task, onToggle, onEdit, onDelete }) {
  const Icon = TASK_TYPE_ICONS[task.type] || MoreHorizontal;
  const dueClass = dueClassFor(task);
  return (
    <div style={{
      ...rowStyle,
      opacity: task.completed ? 0.55 : 1,
      borderLeft: dueClass ? `3px solid ${dueClass.color}` : `3px solid transparent`,
    }}>
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        title={task.completed ? 'Reopen' : 'Mark complete'}
        style={{ marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            <Icon size={11} /> {TASK_TYPE_LABELS[task.type] || task.type}
          </span>
          {task.assignedTo && <span style={pillStyle}>👤 {task.assignedTo}</span>}
          {task.dueDate && (
            <span style={{ ...duePillStyle, color: dueClass ? dueClass.color : 'var(--text-muted)', borderColor: dueClass ? dueClass.color + '55' : 'transparent', background: dueClass ? dueClass.color + '15' : 'transparent' }}>
              {formatDueDate(task.dueDate)}{dueClass ? ` · ${dueClass.label}` : ''}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, marginTop: 2, textDecoration: task.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>
          {task.description}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <button className="btn btn-ghost btn-sm" onClick={onEdit} title="Edit"><Edit3 size={12} /></button>
        <button className="btn btn-ghost btn-sm" onClick={onDelete} title="Delete"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function TaskEditInline({ task, onCancel, onSave, staffSuggestions }) {
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
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select className="select" style={{ maxWidth: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <AssigneeCombobox value={assignedTo} onChange={setAssignedTo} suggestions={staffSuggestions} />
        <input type="date" className="input" style={{ maxWidth: 160 }} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}><X size={12} /> Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !description.trim()}>
          {saving ? <span className="spinner" /> : <><Check size={12} /> Save</>}
        </button>
      </div>
    </div>
  );
}

// ---------- Helpers (duplicated from MyQueue so this file stays standalone) ----------

function dueClassFor(task) {
  if (task.completed || !task.dueDate) return null;
  const due = new Date(task.dueDate);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (due < startOfToday) return { label: 'overdue', color: '#ef4444' };
  if (due <= endOfToday)  return { label: 'today',   color: '#f59e0b' };
  return null;
}

function formatDueDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ---------- Styles ----------

const formCardStyle = {
  background: 'var(--bg, #0e0e0e)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 6,
  padding: 10,
  marginBottom: 8,
};
const rowStyle = {
  display: 'flex',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg-elevated, #161616)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 6,
  alignItems: 'flex-start',
};
const pillStyle = {
  fontSize: 11,
  color: 'var(--text-muted)',
  padding: '1px 6px',
  borderRadius: 8,
  background: 'var(--bg, #0e0e0e)',
};
const duePillStyle = {
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid',
  fontWeight: 500,
};
