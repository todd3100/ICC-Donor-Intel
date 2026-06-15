// Tasks routes.
//
// Mounted as: app.use('/api', tasksRoutes) in server/index.js
//
// Routes:
//   GET    /api/tasks                         List tasks with filters (assignee, completed, type, dueBefore, prospectId)
//   GET    /api/tasks/summary                 Counts for My Queue badges: { overdue, dueToday, dueThisWeek, openTotal }
//   GET    /api/prospects/:prospectId/tasks   List tasks for a single prospect (open + completed)
//   POST   /api/prospects/:prospectId/tasks   Create a task
//   PATCH  /api/tasks/:id                     Update task (description, assignee, type, dueDate, completed)
//   DELETE /api/tasks/:id                     Delete a task

const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const VALID_TYPES = new Set(['call', 'email', 'meeting', 'research', 'send_materials', 'other']);

// Hardcoded suggested assignees (known ICC staff). Mirrors client/components/MyQueue.jsx.
// Kept here so the API can return it from GET /api/users/staff-suggestions too.
const KNOWN_STAFF = ['Jacob', 'Ian', 'Shira', 'Rose', 'Elisabeth', 'Todd'];

// ---------- Helpers ----------

function parseDueDate(v) {
  if (v === undefined) return undefined;       // not provided -> ignore
  if (v === null || v === '') return null;     // explicit clear
  // Accept YYYY-MM-DD or ISO timestamp; store as Date.
  const d = new Date(v);
  if (isNaN(d.getTime())) {
    const err = new Error('Invalid dueDate');
    err.status = 400;
    throw err;
  }
  return d;
}

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function endOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
function endOfWeekUTC() {
  // Sunday 23:59:59 UTC of the current week
  const d = new Date();
  const dow = d.getUTCDay();  // 0..6, Sun=0
  const daysToSun = (7 - dow) % 7;  // if today is Sun, daysToSun=0
  d.setUTCDate(d.getUTCDate() + daysToSun);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function shapeTask(t) {
  return {
    id: t.id,
    prospectId: t.prospectId,
    prospectName: t.prospect?.name,
    prospectStage: t.prospect?.stage,
    prospectStatus: t.prospect?.status,
    assignedTo: t.assignedTo,
    type: t.type,
    description: t.description,
    dueDate: t.dueDate,
    completed: t.completed,
    completedAt: t.completedAt,
    createdById: t.createdById,
    createdByName: t.createdBy?.name,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// ---------- Listing ----------

// GET /api/tasks
router.get('/tasks', async (req, res) => {
  try {
    const { assignee, completed, type, prospectId, dueBefore, overdue, dueToday, dueThisWeek, limit } = req.query;
    const where = {};

    if (assignee) where.assignedTo = assignee;          // exact match (combobox value)
    if (prospectId) where.prospectId = prospectId;
    if (type) {
      if (!VALID_TYPES.has(type)) return res.status(400).json({ error: `Invalid type: ${type}` });
      where.type = type;
    }
    if (completed === 'true')  where.completed = true;
    if (completed === 'false') where.completed = false;

    // Date filters
    if (dueBefore) {
      where.dueDate = { ...(where.dueDate || {}), lte: new Date(dueBefore) };
    }
    if (overdue === 'true') {
      where.completed = false;
      where.dueDate = { ...(where.dueDate || {}), lt: startOfTodayUTC() };
    }
    if (dueToday === 'true') {
      where.completed = false;
      where.dueDate = { gte: startOfTodayUTC(), lte: endOfTodayUTC() };
    }
    if (dueThisWeek === 'true') {
      where.completed = false;
      where.dueDate = { gte: startOfTodayUTC(), lte: endOfWeekUTC() };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        prospect: { select: { id: true, name: true, stage: true, status: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [
        { completed: 'asc' },     // open tasks first
        { dueDate: 'asc' },       // earliest due first (nulls last in postgres asc)
        { createdAt: 'desc' },
      ],
      take: limit ? Math.min(Number(limit) || 200, 500) : 200,
    });

    res.json({ tasks: tasks.map(shapeTask) });
  } catch (e) {
    console.error('[tasks/list]', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to list tasks' });
  }
});

// GET /api/tasks/summary — counts for My Queue badges.
// Optional ?assignee=Name restricts to one person's queue (used by the user's own queue).
router.get('/tasks/summary', async (req, res) => {
  try {
    const { assignee } = req.query;
    const baseWhere = { completed: false };
    if (assignee) baseWhere.assignedTo = assignee;

    const [overdue, dueToday, dueThisWeek, openTotal, openTotalAll] = await Promise.all([
      prisma.task.count({ where: { ...baseWhere, dueDate: { lt: startOfTodayUTC() } } }),
      prisma.task.count({ where: { ...baseWhere, dueDate: { gte: startOfTodayUTC(), lte: endOfTodayUTC() } } }),
      prisma.task.count({ where: { ...baseWhere, dueDate: { gte: startOfTodayUTC(), lte: endOfWeekUTC() } } }),
      prisma.task.count({ where: baseWhere }),
      // total open across everyone (so the team sees a global denominator)
      prisma.task.count({ where: { completed: false } }),
    ]);

    res.json({ overdue, dueToday, dueThisWeek, openTotal, openTotalAll });
  } catch (e) {
    console.error('[tasks/summary]', e);
    res.status(500).json({ error: 'Failed to load task summary' });
  }
});

// GET /api/prospects/:prospectId/tasks — all tasks for a single prospect (open + completed)
router.get('/prospects/:prospectId/tasks', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { prospectId: req.params.prospectId },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [
        { completed: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });
    res.json({ tasks: tasks.map(shapeTask) });
  } catch (e) {
    console.error('[tasks/list-for-prospect]', e);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// ---------- Create ----------

router.post('/prospects/:prospectId/tasks', async (req, res) => {
  try {
    const { description, assignedTo, type, dueDate } = req.body || {};
    const desc = String(description || '').trim();
    if (!desc) return res.status(400).json({ error: 'description is required' });

    let taskType = type || 'other';
    if (!VALID_TYPES.has(taskType)) return res.status(400).json({ error: `Invalid type: ${taskType}` });

    let parsedDueDate;
    try { parsedDueDate = parseDueDate(dueDate); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    // Verify the prospect exists (return 404 cleanly instead of FK error)
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.prospectId }, select: { id: true } });
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          prospectId: req.params.prospectId,
          description: desc,
          assignedTo: assignedTo ? String(assignedTo).trim() || null : null,
          type: taskType,
          dueDate: parsedDueDate ?? null,
          createdById: req.user.id,
        },
        include: {
          prospect: { select: { id: true, name: true, stage: true, status: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          prospectId: req.params.prospectId,
          userId: req.user.id,
          action: 'task_created',
          detail: `Task: ${desc.slice(0, 100)}${assignedTo ? ` → ${assignedTo}` : ''}`,
        },
      });
      return t;
    });

    res.json({ task: shapeTask(task) });
  } catch (e) {
    console.error('[tasks/create]', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to create task' });
  }
});

// ---------- Update ----------

const PATCHABLE = ['description', 'assignedTo', 'type', 'dueDate', 'completed'];

router.patch('/tasks/:id', async (req, res) => {
  try {
    const existing = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, prospectId: true, completed: true, description: true },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const data = {};
    for (const key of Object.keys(req.body || {})) {
      if (!PATCHABLE.includes(key)) continue;
      const val = req.body[key];

      if (key === 'description') {
        const trimmed = String(val || '').trim();
        if (!trimmed) return res.status(400).json({ error: 'description cannot be empty' });
        data.description = trimmed;
      } else if (key === 'assignedTo') {
        data.assignedTo = val ? String(val).trim() || null : null;
      } else if (key === 'type') {
        if (!VALID_TYPES.has(val)) return res.status(400).json({ error: `Invalid type: ${val}` });
        data.type = val;
      } else if (key === 'dueDate') {
        try { data.dueDate = parseDueDate(val); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      } else if (key === 'completed') {
        const wantCompleted = Boolean(val);
        data.completed = wantCompleted;
        // Auto-stamp/clear completedAt
        data.completedAt = wantCompleted ? new Date() : null;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const task = await prisma.$transaction(async (tx) => {
      const t = await tx.task.update({
        where: { id: req.params.id },
        data,
        include: {
          prospect: { select: { id: true, name: true, stage: true, status: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      // Log when a task is completed/reopened so it shows in the prospect's activity log
      if ('completed' in data && data.completed !== existing.completed) {
        await tx.auditLog.create({
          data: {
            prospectId: existing.prospectId,
            userId: req.user.id,
            action: data.completed ? 'task_completed' : 'task_reopened',
            detail: existing.description.slice(0, 100),
          },
        });
      }
      return t;
    });

    res.json({ task: shapeTask(task) });
  } catch (e) {
    console.error('[tasks/update]', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to update task' });
  }
});

// ---------- Delete ----------

router.delete('/tasks/:id', async (req, res) => {
  try {
    const existing = await prisma.task.findUnique({
      where: { id: req.params.id },
      select: { id: true, prospectId: true, description: true },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    await prisma.$transaction(async (tx) => {
      await tx.task.delete({ where: { id: req.params.id } });
      await tx.auditLog.create({
        data: {
          prospectId: existing.prospectId,
          userId: req.user.id,
          action: 'task_deleted',
          detail: existing.description.slice(0, 100),
        },
      });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[tasks/delete]', e);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ---------- Staff suggestions ----------

// GET /api/staff-suggestions
// Returns: { suggestions: [ "Jacob", "Ian", "Shira", "Rose", "Elisabeth", "Todd", ...any owner/assignee names already in the DB ] }
router.get('/staff-suggestions', async (req, res) => {
  try {
    // Pull distinct owner + assignedTo values already in the DB so the dropdown
    // surfaces ad-hoc names the team has been using.
    const [owners, assignees] = await Promise.all([
      prisma.prospect.findMany({
        where: { owner: { not: null } },
        select: { owner: true },
        distinct: ['owner'],
        take: 100,
      }),
      prisma.task.findMany({
        where: { assignedTo: { not: null } },
        select: { assignedTo: true },
        distinct: ['assignedTo'],
        take: 100,
      }),
    ]);
    const fromDb = [
      ...owners.map((o) => o.owner),
      ...assignees.map((a) => a.assignedTo),
    ].filter(Boolean);

    const merged = Array.from(new Set([...KNOWN_STAFF, ...fromDb]));
    res.json({ suggestions: merged });
  } catch (e) {
    console.error('[tasks/staff-suggestions]', e);
    res.status(500).json({ error: 'Failed to load staff suggestions' });
  }
});

module.exports = router;
