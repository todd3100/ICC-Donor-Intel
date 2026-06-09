// Bulk AI research — sequential processor with module-level job state.
// POST /api/research/bulk        (admin only)        — kicks off job, returns immediately
//   body: { mode: 'unresearched' | 'all' | 'errored', prospectIds?: string[] }
//     - 'unresearched' (default): only prospects with aiResearchCompleted=false AND aiResearchError=false
//     - 'all': every prospect, overwrites existing research
//     - 'errored': only prospects with aiResearchError=true (retry failures)
//   If prospectIds is provided, mode is ignored and those exact IDs are processed.
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

// Anthropic Tier 1 = 30,000 input tokens per minute. Each prospect call uses
// roughly 8-15k input tokens (system prompt + donor list + web_search results),
// so we pace ~20s between starts to stay under the rolling 60s window.
// If you upgrade to Tier 2 (80k ITPM), you can lower this to ~6000ms.
const DELAY_MS = 20000;

// On a 429 rate-limit error, wait this long before retrying. Anthropic also returns
// a `retry-after` header (in seconds) which we honor when present.
const RATE_LIMIT_RETRY_MS = 30000;
const MAX_RATE_LIMIT_RETRIES = 2;

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const bulkJob = {
  running: false,
  mode: null,
  total: 0,
  completed: 0,
  failed: 0,
  currentName: null,
  currentId: null,
  failedIds: [],
  failures: [], // [{ id, name, error }]
  startedAt: null,
  finishedAt: null,
  triggeredBy: null,
};

function snapshot() {
  return {
    ...bulkJob,
    failedIds: [...bulkJob.failedIds],
    failures: bulkJob.failures.slice(-20), // cap payload size
  };
}

function resetJob() {
  bulkJob.running = false;
  bulkJob.mode = null;
  bulkJob.total = 0;
  bulkJob.completed = 0;
  bulkJob.failed = 0;
  bulkJob.currentName = null;
  bulkJob.currentId = null;
  bulkJob.failedIds = [];
  bulkJob.failures = [];
  bulkJob.startedAt = null;
  bulkJob.finishedAt = null;
  bulkJob.triggeredBy = null;
}

async function runBulk(ids, triggeredBy, mode) {
  bulkJob.running = true;
  bulkJob.mode = mode || 'custom';
  bulkJob.total = ids.length;
  bulkJob.completed = 0;
  bulkJob.failed = 0;
  bulkJob.currentName = null;
  bulkJob.currentId = null;
  bulkJob.failedIds = [];
  bulkJob.failures = [];
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
          bulkJob.failures.push({ id, name: '(deleted)', error: 'Prospect no longer exists' });
          bulkJob.failed++;
          continue;
        }
        bulkJob.currentId = id;
        bulkJob.currentName = prospect.name;

        // Inline retry-on-429 with exponential backoff, honoring retry-after header
        let data, resolvedMatchIds;
        {
          let attempt = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            try {
              ({ data, resolvedMatchIds } = await researchProspect(prospect));
              break;
            } catch (e) {
              const is429 = e.status === 429 || /rate.?limit/i.test(e.message || '');
              if (!is429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw e;
              attempt++;
              const headerRetry = Number(e.headers?.['retry-after']) * 1000;
              const waitMs = Number.isFinite(headerRetry) && headerRetry > 0
                ? headerRetry + 2000
                : RATE_LIMIT_RETRY_MS * attempt;
              console.warn(`[researchBulk] 429 on ${prospect.name}, retry ${attempt}/${MAX_RATE_LIMIT_RETRIES} after ${waitMs}ms`);
              bulkJob.currentName = `${prospect.name} (waiting ${Math.round(waitMs / 1000)}s for rate limit…)`;
              await sleep(waitMs);
            }
          }
        }
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
              detail: `Applied bulk AI research update (mode=${mode || 'custom'})`,
            },
          });
        });

        bulkJob.completed++;
      } catch (e) {
        // Verbose logging so we can see the real failure cause in Railway logs
        console.error(`[researchBulk] prospect ${id} (${prospect?.name || '?'}) failed:`, {
          message: e.message,
          code: e.code,
          status: e.status,
          type: e.type,
          raw: e.raw?.slice(0, 300),
        });
        bulkJob.failedIds.push(id);
        bulkJob.failures.push({
          id,
          name: prospect?.name || '(unknown)',
          error: (e.message || 'unknown error').slice(0, 200),
        });
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
  setImmediate(() => { runBulk(ids, triggeredBy, 'csv_import').catch((e) => console.error('[runBulk]', e)); });
  return true;
}

async function resolveIdsForMode(mode) {
  let where;
  if (mode === 'all') {
    where = {}; // everyone, overwrite
  } else if (mode === 'errored') {
    where = { aiResearchError: true };
  } else {
    // 'unresearched' (default): never completed AND not currently errored
    where = { aiResearchCompleted: false, aiResearchError: false };
  }
  const rows = await prisma.prospect.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((p) => p.id);
}

router.post('/research/bulk', requireAdmin, async (req, res) => {
  if (bulkJob.running) {
    return res.status(409).json({
      error: 'A bulk research job is already running',
      job: snapshot(),
    });
  }

  const body = req.body || {};
  const explicitIds = Array.isArray(body.prospectIds) ? body.prospectIds.filter(Boolean) : null;
  const rawMode = typeof body.mode === 'string' ? body.mode : 'unresearched';
  const mode = ['unresearched', 'all', 'errored'].includes(rawMode) ? rawMode : 'unresearched';

  let ids;
  if (explicitIds && explicitIds.length > 0) {
    ids = explicitIds;
  } else {
    ids = await resolveIdsForMode(mode);
  }

  if (ids.length === 0) {
    return res.json({
      accepted: false,
      total: 0,
      mode,
      message: mode === 'all'
        ? 'No prospects in the database.'
        : mode === 'errored'
        ? 'No errored prospects to retry.'
        : 'No unresearched prospects.',
    });
  }

  // Fire-and-forget
  setImmediate(() => { runBulk(ids, req.user.id, mode).catch((e) => console.error('[runBulk]', e)); });

  res.json({
    accepted: true,
    total: ids.length,
    mode,
    jobId: 'singleton',
    estimatedSeconds: ids.length * 35, // ~15s Anthropic + 20s delay (Tier 1 pacing)
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

// Admin-only: clear the error flag on all prospects so they can be retried via 'unresearched' mode.
router.post('/research/bulk/clear-errors', requireAdmin, async (req, res) => {
  const result = await prisma.prospect.updateMany({
    where: { aiResearchError: true },
    data: { aiResearchError: false, aiResearchErrorMsg: null },
  });
  res.json({ ok: true, cleared: result.count });
});

module.exports = router;
module.exports.enqueueBulkResearch = enqueueBulkResearch;
