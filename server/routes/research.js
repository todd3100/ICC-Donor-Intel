const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
// NOTE: we only pull `researchProspect` and `MODEL` from lib. The helper
// functions (temperatureFromIccCount, normalizeNetWorth, computeSuggestedAsk)
// are inlined below so this route works even if the deployed lib version
// doesn't re-export them (which was the actual production 500 —
// "temperatureFromIccCount is not a function").
const researchLib = require('../lib/researchProspect');
const researchProspect = researchLib.researchProspect;
const MODEL = researchLib.MODEL || 'claude-sonnet-4-5-20250929';

const router = express.Router();
router.use(requireAuth);

// ---- Inlined helpers (do not depend on lib exports) ----------------------

// Normalize a net worth string to a canonical form. Falls back to 'Unknown'
// when the AI returned a vague qualifier instead of a number.
function normalizeNetWorth(v) {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const UNKNOWN_SYNONYMS = new Set([
    'substantial', 'significant', 'high', 'high net worth', 'high-net-worth',
    'considerable', 'wealthy', 'undisclosed', 'not disclosed', 'not publicly disclosed',
    'not publicly available', 'not available', 'n/a', 'na', 'unknown', '—', '-',
  ]);
  if (UNKNOWN_SYNONYMS.has(lower)) return 'Unknown';
  return trimmed;
}

// 5+ ICC connections → hot, 2–4 → warm, 0–1 → cold.
function temperatureFromIccCount(count) {
  const n = Number(count) || 0;
  if (n >= 5) return 'hot';
  if (n >= 2) return 'warm';
  return 'cold';
}

// Parse "$2.5B" / "~$450M" / "$13.8B" → integer dollars, or null.
function parseNetWorthDollars(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'unknown') return null;
  const m = trimmed.match(/([\d.]+)\s*([kmbt])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || '').toLowerCase();
  const multiplier = unit === 't' ? 1e12
    : unit === 'b' ? 1e9
    : unit === 'm' ? 1e6
    : unit === 'k' ? 1e3
    : 1;
  return Math.round(n * multiplier);
}

const ASK_HARD_CAP = 1_500_000;

function computeSuggestedAsk({ netWorth, iccConnectionCount }) {
  const nw = parseNetWorthDollars(netWorth);
  if (!nw || nw <= 0) return { min: null, max: null };

  let min, max;
  if (nw >= 1_000_000_000)      { min = 250_000; max = 1_000_000; }
  else if (nw >= 100_000_000)   { min = 100_000; max =   500_000; }
  else if (nw >=  25_000_000)   { min =  50_000; max =   250_000; }
  else if (nw >=   5_000_000)   { min =  25_000; max =   100_000; }
  else if (nw >=   1_000_000)   { min =  10_000; max =    50_000; }
  else                          { min =   5_000; max =    25_000; }

  const c = Number(iccConnectionCount) || 0;
  if (c >= 5)      { min += 25_000; max += 50_000; }
  else if (c >= 2) { min +=  5_000; max += 10_000; }

  if (max > ASK_HARD_CAP) max = ASK_HARD_CAP;
  if (min > max)          min = max;

  return { min, max };
}

// Prisma String[] fields reject arrays with null/undefined entries. Filter,
// coerce, trim, and drop empties.
function sanitizeStringArray(v) {
  if (!Array.isArray(v)) return null;
  return v
    .filter((s) => s !== null && s !== undefined)
    .map((s) => (typeof s === 'string' ? s : String(s)))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sanitizeString(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return String(v);
  return v;
}

const VALID_STATUSES = new Set(['hot', 'warm', 'cold', 'connected']);

// ---- Routes --------------------------------------------------------------

router.post('/prospects/:id/research', async (req, res) => {
  try {
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const { data, resolvedMatchIds } = await researchProspect(prospect);

    res.json({
      research: data,
      resolvedMatchIds,
      modelUsed: MODEL,
    });
  } catch (e) {
    console.error('[research]', e);
    if (e.code === 'NO_API_KEY') return res.status(500).json({ error: e.message });
    if (e.code === 'UNPARSEABLE') {
      return res.status(502).json({ error: e.message + ' Please try again.', raw: e.raw || '' });
    }
    res.status(500).json({ error: 'Research failed: ' + (e.message || 'unknown error') });
  }
});

// Apply AI research results to a prospect profile (user-approved)
router.post('/prospects/:id/research/apply', async (req, res) => {
  const prospectId = req.params.id;
  const userId = req.user?.id;

  try {
    const updates = req.body?.updates || {};
    const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    // ---- Build the update payload defensively -----------------------------
    const data = {};

    if (Array.isArray(updates.campus)) {
      data.campusConnections = sanitizeStringArray(updates.campus) || [];
    }
    if (Array.isArray(updates.philanthropic)) {
      data.philanthropicFootprint = sanitizeStringArray(updates.philanthropic) || [];
    }
    if (Array.isArray(updates.iccNetworkMatches)) {
      data.iccNetworkMatches = sanitizeStringArray(updates.iccNetworkMatches) || [];
    }

    if (updates.oct7signals !== undefined) {
      const s = sanitizeString(updates.oct7signals);
      if (s !== null) data.oct7Signals = s;
    }
    if (updates.children !== undefined) {
      const s = sanitizeString(updates.children);
      if (s !== null) data.children = s;
    }
    if (updates.spouse !== undefined) {
      const s = sanitizeString(updates.spouse);
      if (s !== null) data.spouse = s;
    }
    if (updates.personalConnections !== undefined) {
      const s = sanitizeString(updates.personalConnections);
      if (s !== null) data.personalConnections = s;
    }
    if (updates.connectionDetail !== undefined) {
      const s = sanitizeString(updates.connectionDetail);
      if (s !== null) data.connectionDetail = s;
    }
    if (typeof updates.netWorth === 'string') {
      const nw = normalizeNetWorth(updates.netWorth);
      if (nw !== undefined) data.netWorth = nw;
    }

    // Auto-recalc temperature from the final ICC connection count.
    const finalIccMatches = Array.isArray(data.iccNetworkMatches)
      ? data.iccNetworkMatches
      : (prospect.iccNetworkMatches || []);
    if (prospect.status !== 'connected') {
      const newStatus = temperatureFromIccCount(finalIccMatches.length);
      if (VALID_STATUSES.has(newStatus)) {
        data.status = newStatus;
      }
    }

    // Auto-recompute suggested ask range unless staff manually overrode it.
    if (!prospect.suggestedAskOverride) {
      const finalNetWorth = (typeof data.netWorth === 'string') ? data.netWorth : prospect.netWorth;
      const askRange = computeSuggestedAsk({
        netWorth: finalNetWorth,
        iccConnectionCount: finalIccMatches.length,
      }) || {};
      data.suggestedAskMin = (typeof askRange.min === 'number') ? askRange.min : null;
      data.suggestedAskMax = (typeof askRange.max === 'number') ? askRange.max : null;
    }

    // Auto-advance pipeline stage from 'identified' → 'researched'.
    if (prospect.stage === 'identified') {
      data.stage = 'researched';
      data.lastStageChangeAt = new Date();
    }

    // Mark research as completed
    data.aiResearchCompleted = true;
    data.aiResearchLastRun = new Date();
    data.aiResearchError = false;
    data.aiResearchErrorMsg = null;

    // ---- Persist. Prospect update stands alone so we can pinpoint failures.
    let updatedProspect;
    try {
      updatedProspect = await prisma.prospect.update({
        where: { id: prospectId },
        data,
      });
    } catch (e) {
      console.error('[research/apply] prospect.update failed. data=', JSON.stringify(data), 'err=', e);
      const msg = e?.meta?.cause || e?.message || 'Database update rejected the payload';
      return res.status(500).json({
        error: 'Could not save research to profile: ' + msg,
        code: e?.code || 'UPDATE_FAILED',
      });
    }

    // Audit log is best-effort.
    if (userId) {
      try {
        await prisma.auditLog.create({
          data: {
            prospectId,
            userId,
            action: 'ai_research_applied',
            detail: 'Applied AI research update to profile',
          },
        });
      } catch (e) {
        console.warn('[research/apply] auditLog.create failed (non-fatal):', e.message);
      }
    }

    return res.json({ prospect: updatedProspect });
  } catch (e) {
    console.error('[research/apply] unexpected error:', e);
    return res.status(500).json({
      error: 'Failed to apply research: ' + (e?.message || 'unknown error'),
      code: e?.code || 'UNKNOWN',
    });
  }
});

module.exports = router;
