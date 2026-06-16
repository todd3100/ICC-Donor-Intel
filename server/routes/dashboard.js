// server/routes/dashboard.js
// Executive Dashboard summary endpoint for Batch C.
// Returns aggregate stats used by the ExecutiveDashboard component:
//   - FY26 / FY27 goal progress (hardcoded for now)
//   - Pipeline counts + total suggested ask per stage
//   - Tier breakdown counts
//   - Top 10 open prospects by suggested ask max
//   - Recent activity (audit_logs)
//   - Team task load (open / overdue per assignee)
//
// All computed in one round-trip so the dashboard loads fast.

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

// Hardcoded fundraising goals. Edit these values to update the dashboard.
// FY runs July 1 -> June 30 at ICC (typical Jewish nonprofit). Update raisedToDate
// occasionally as cash comes in; the dashboard will reflect it immediately.
const FY_GOALS = {
  FY26: {
    label: 'FY26',
    goal: 18000000,
    raisedToDate: 18289016,
    // Fiscal-year boundaries used for the "% of FY elapsed" indicator.
    start: new Date('2025-07-01T00:00:00Z'),
    end: new Date('2026-06-30T23:59:59Z'),
  },
  FY27: {
    label: 'FY27',
    goal: 18000000,
    raisedToDate: 6450000,
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2027-06-30T23:59:59Z'),
  },
};

// Known staff names — same list used elsewhere for assignee suggestions.
const KNOWN_STAFF = ['Jacob', 'Ian', 'Shira', 'Rose', 'Elisabeth', 'Todd'];

// Display order for pipeline stages on the dashboard.
const STAGE_ORDER = [
  'identified',
  'researched',
  'qualified',
  'cultivation',
  'solicitation',
  'stewardship',
];

function pctElapsed(start, end, now = new Date()) {
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;
  return Math.round((elapsed / total) * 1000) / 10; // one decimal
}

function fyProgress(fy) {
  const pctGoal = fy.goal > 0
    ? Math.round((fy.raisedToDate / fy.goal) * 1000) / 10
    : 0;
  return {
    label: fy.label,
    goal: fy.goal,
    raisedToDate: fy.raisedToDate,
    pctGoal,
    pctFyElapsed: pctElapsed(fy.start, fy.end),
    start: fy.start.toISOString(),
    end: fy.end.toISOString(),
  };
}

router.get('/dashboard/summary', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // ---- Pipeline by stage ----------------------------------------------
    // groupBy gives counts and SUM(suggested_ask_max) per stage.
    const stageGroups = await prisma.prospect.groupBy({
      by: ['stage'],
      _count: { _all: true },
      _sum: { suggestedAskMax: true, suggestedAskMin: true },
    });
    const stageMap = new Map(stageGroups.map((g) => [g.stage, g]));
    const pipelineByStage = STAGE_ORDER.map((stage) => {
      const g = stageMap.get(stage);
      return {
        stage,
        count: g ? g._count._all : 0,
        totalSuggestedMin: g && g._sum.suggestedAskMin ? Number(g._sum.suggestedAskMin) : 0,
        totalSuggestedMax: g && g._sum.suggestedAskMax ? Number(g._sum.suggestedAskMax) : 0,
      };
    });
    const totalProspects = pipelineByStage.reduce((s, r) => s + r.count, 0);
    const totalPipelineMin = pipelineByStage.reduce((s, r) => s + r.totalSuggestedMin, 0);
    const totalPipelineMax = pipelineByStage.reduce((s, r) => s + r.totalSuggestedMax, 0);

    // ---- Tier breakdown -------------------------------------------------
    const tierGroups = await prisma.prospect.groupBy({
      by: ['tier'],
      _count: { _all: true },
      _sum: { suggestedAskMax: true },
    });
    const tierBreakdown = [1, 2, 3].map((tier) => {
      const g = tierGroups.find((x) => x.tier === tier);
      return {
        tier,
        count: g ? g._count._all : 0,
        totalSuggestedMax: g && g._sum.suggestedAskMax ? Number(g._sum.suggestedAskMax) : 0,
      };
    });

    // ---- Top 10 prospects by suggested ask max --------------------------
    const topProspects = await prisma.prospect.findMany({
      where: {
        suggestedAskMax: { not: null },
        // Exclude stewardship (already gave) from "open" top opportunities.
        // Use `notIn` for broader Prisma version compatibility (the bare `not`
        // form is rejected by some Prisma versions for enum fields).
        stage: { notIn: ['stewardship'] },
      },
      orderBy: [{ suggestedAskMax: 'desc' }, { name: 'asc' }],
      take: 10,
      select: {
        id: true,
        name: true,
        stage: true,
        tier: true,
        owner: true,
        suggestedAskMin: true,
        suggestedAskMax: true,
        netWorth: true,
        iccNetworkMatches: true,
      },
    });

    // ---- Recent activity (last 20 audit log entries) --------------------
    const recentActivity = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        detail: true,
        createdAt: true,
        prospectId: true,
        prospect: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    // ---- Team task load -------------------------------------------------
    // We want: per assignee, count of open tasks and count of overdue tasks.
    // Build it via two groupBy calls and merge.
    const openCounts = await prisma.task.groupBy({
      by: ['assignedTo'],
      where: { completed: false },
      _count: { _all: true },
    });
    const overdueCounts = await prisma.task.groupBy({
      by: ['assignedTo'],
      where: {
        completed: false,
        dueDate: { lt: startOfTodayUtc },
      },
      _count: { _all: true },
    });

    const loadMap = new Map();
    for (const row of openCounts) {
      const name = row.assignedTo || 'Unassigned';
      loadMap.set(name, { assignee: name, open: row._count._all, overdue: 0 });
    }
    for (const row of overdueCounts) {
      const name = row.assignedTo || 'Unassigned';
      const existing = loadMap.get(name) || { assignee: name, open: 0, overdue: 0 };
      existing.overdue = row._count._all;
      loadMap.set(name, existing);
    }
    // Ensure all known staff appear even with zero tasks.
    for (const name of KNOWN_STAFF) {
      if (!loadMap.has(name)) {
        loadMap.set(name, { assignee: name, open: 0, overdue: 0 });
      }
    }
    const teamTaskLoad = Array.from(loadMap.values()).sort((a, b) => {
      // Known staff first, then alphabetical
      const aKnown = KNOWN_STAFF.includes(a.assignee);
      const bKnown = KNOWN_STAFF.includes(b.assignee);
      if (aKnown && !bKnown) return -1;
      if (!aKnown && bKnown) return 1;
      return a.assignee.localeCompare(b.assignee);
    });

    res.json({
      generatedAt: now.toISOString(),
      goals: {
        fy26: fyProgress(FY_GOALS.FY26),
        fy27: fyProgress(FY_GOALS.FY27),
      },
      totals: {
        prospects: totalProspects,
        pipelineMin: totalPipelineMin,
        pipelineMax: totalPipelineMax,
      },
      pipelineByStage,
      tierBreakdown,
      topProspects,
      recentActivity,
      teamTaskLoad,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
