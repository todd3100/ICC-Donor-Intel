// Bulk AI research — sequential processor with module-level job state.
// POST /api/research/bulk        (admin only)        — kicks off job, returns immediately
// GET  /api/research/bulk/status (any authed user)   — current job state for polling
//
// Concurrency model: one job at a time, module-level singleton. Resets on dyno restart.
// Sequential processing with a 2s delay between prospects to stay under Anthropic rate limits.

const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { researchProspect, buildApplyFields } = require('../lib/researchProspect');

const router = express.Router();
router.use(requireAuth);

const DELAY_MS = 2000;

const bulkJob = {
  running: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentName: null,
  currentId: null,
  failedIds: [],
  startedAt: null,
  finishedAt: null,
  triggeredBy: null,
};

function snapshot() {
  return { ...bulkJob, failedIds: [...bulkJob.failedIds] };
}

function resetJob() {
  bulkJob.running = false;
  bulkJob.total = 0;
  bulkJob.completed = 0;
  bulkJob.failed = 0;
  bulkJob.currentName = null;
  bulkJob.currentId = null;
  bulkJob.failedIds = [];
  bulkJob.startedAt = null;
  bulkJob.finishedAt = null;
  bulkJob.triggeredBy = null;
}

async function runBulk(ids, triggeredBy) {
  bulkJob.running = true;
  bulkJob.total = ids.length;
  bulkJob.completed = 0;
  bulkJob.failed = 0;
  bulkJob.currentName = null;
  bulkJob.currentId = null;
  bulkJob.failedIds = [];
  bulkJob.startedAt = new Date();
  bulkJob.finishedAt = null;
  bulkJob.triggeredBy = triggeredBy || null;

  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      let prospect;
      try {
        prospect = await prisma.prospect.findUnique({ where: { id } });
        if (!prospect) {
          bulkJob.failedIds.push(id);
          bulkJob.failed++;
          continue;
        }
        bulkJob.currentId = id;
        bulkJob.currentName = prospect.name;

        const { data, resolvedMatchIds } = await researchProspect(prospect);
        const applyFields = buildApplyFields(data, resolvedMatchIds);

        // Strip undefined keys so we don't overwrite existing data with undefined
        const cleanData = {};
        for (const [k, v] of Object.entries(applyFields)) {
          if (v !== undefined) cleanData[k] = v;
        }
        cleanData.aiResearchCompleted = true;
        cleanData.aiResearchLastRun = new Date();
        cleanData.aiResearchError = false;
        cleanData.aiResearchErrorMsg = null;

        await prisma.$transaction(async (tx) => {
          await tx.prospect.update({ where: { id }, data: cleanData });
          await tx.auditLog.create({
            data: {
              prospectId: id,
              userId: triggeredBy || null,
              action: 'ai_research_bulk_applied',
              detail: 'Applied bulk AI research update to profile',
            },
          });
        });

        bulkJob.completed++;
      } catch (e) {
        console.error(`[researchBulk] prospect ${id} failed:`, e.message);
        bulkJob.failedIds.push(id);
        bulkJob.failed++;
        try {
          await prisma.prospect.update({
            where: { id },
            data: {
              aiResearchError: true,
              aiResearchErrorMsg: (e.message || 'unknown error').slice(0, 500),
              aiResearchLastRun: new Date(),
            },
          });
        } catch (markErr) {
          console.error(`[researchBulk] could not mark error on ${id}:`, markErr.message);
        }
      }

      // Delay between prospects (but not after the last one)
      if (i < ids.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  } catch (outerErr) {
    console.error('[researchBulk] processor crashed:', outerErr);
  } finally {
    bulkJob.running = false;
    bulkJob.currentName = null;
    bulkJob.currentId = null;
    bulkJob.finishedAt = new Date();
  }
}

// Public helper — called from prospects.js after CSV import
async function enqueueBulkResearch(ids, triggeredBy) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  if (bulkJob.running) return false;
  setImmediate(() => { runBulk(ids, triggeredBy).catch((e) => console.error('[runBulk]', e)); });
  return true;
}

router.post('/research/bulk', requireAdmin, async (req, res) => {
  if (bulkJob.running) {
    return res.status(409).json({
      error: 'A bulk research job is already running',
      job: snapshot(),
    });
  }

  let ids = Array.isArray(req.body?.prospectIds) ? req.body.prospectIds.filter(Boolean) : null;

  if (!ids || ids.length === 0) {
    const pending = await prisma.prospect.findMany({
      where: { aiResearchCompleted: false, aiResearchError: false },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    ids = pending.map((p) => p.id);
  }

  if (ids.length === 0) {
    return res.json({ accepted: false, total: 0, message: 'No prospects to research' });
  }

  // Fire-and-forget
  setImmediate(() => { runBulk(ids, req.user.id).catch((e) => console.error('[runBulk]', e)); });

  res.json({
    accepted: true,
    total: ids.length,
    jobId: 'singleton',
    estimatedSeconds: ids.length * 17, // ~15s Anthropic + 2s delay
  });
});

router.get('/research/bulk/status', (req, res) => {
  res.json({ job: snapshot() });
});

router.post('/research/bulk/reset', requireAdmin, (req, res) => {
  if (bulkJob.running) {
    return res.status(409).json({ error: 'Cannot reset a running job' });
  }
  resetJob();
  res.json({ ok: true });
});

module.exports = router;
module.exports.enqueueBulkResearch = enqueueBulkResearch;
