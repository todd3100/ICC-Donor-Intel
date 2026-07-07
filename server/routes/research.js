const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { researchProspect, temperatureFromIccCount, normalizeNetWorth, computeSuggestedAsk, MODEL } = require('../lib/researchProspect');

const router = express.Router();
router.use(requireAuth);

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

// ---- Helpers used by the apply route -------------------------------------

// String[] fields in Prisma reject arrays containing null/undefined.
// The AI can occasionally return arrays with empty/null entries — filter them.
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

// Valid enum values for ProspectStatus in the Prisma schema.
const VALID_STATUSES = new Set(['hot', 'warm', 'cold', 'connected']);

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

    // Array fields — sanitize (filter nulls, coerce strings, trim, drop empties)
    if (Array.isArray(updates.campus)) {
      data.campusConnections = sanitizeStringArray(updates.campus) || [];
    }
    if (Array.isArray(updates.philanthropic)) {
      data.philanthropicFootprint = sanitizeStringArray(updates.philanthropic) || [];
    }
    if (Array.isArray(updates.iccNetworkMatches)) {
      data.iccNetworkMatches = sanitizeStringArray(updates.iccNetworkMatches) || [];
    }

    // Scalar string fields — accept null or string, coerce to string, allow ''.
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

    // ---- Auto-recalc temperature from the final ICC connection count.
    // Use the new value if provided, else fall back to the prospect's existing matches.
    // Per product spec: override any previous status, including manual labels.
    // Exception: leave a 'connected' status alone — that's an outcome label, not a heat rating.
    const finalIccMatches = Array.isArray(data.iccNetworkMatches)
      ? data.iccNetworkMatches
      : (prospect.iccNetworkMatches || []);
    if (prospect.status !== 'connected') {
      const newStatus = temperatureFromIccCount(finalIccMatches.length);
      // Defensive: only assign if the value is one of the valid enum members.
      if (VALID_STATUSES.has(newStatus)) {
        data.status = newStatus;
      }
    }

    // ---- Auto-recompute suggested ask range from the final net worth + ICC count,
    // unless staff manually overrode it (suggestedAskOverride=true).
    if (!prospect.suggestedAskOverride) {
      const finalNetWorth = (typeof data.netWorth === 'string') ? data.netWorth : prospect.netWorth;
      const askRange = computeSuggestedAsk({
        netWorth: finalNetWorth,
        iccConnectionCount: finalIccMatches.length,
      }) || {};
      // Only write if we got numeric values; guard against undefined
      data.suggestedAskMin = (typeof askRange.min === 'number') ? askRange.min : null;
      data.suggestedAskMax = (typeof askRange.max === 'number') ? askRange.max : null;
    }

    // ---- Auto-advance pipeline stage from 'identified' → 'researched' the first time
    // research is applied. Never overwrite later stages.
    if (prospect.stage === 'identified') {
      data.stage = 'researched';
      data.lastStageChangeAt = new Date();
    }

    // Mark research as completed when the user applies an update
    data.aiResearchCompleted = true;
    data.aiResearchLastRun = new Date();
    data.aiResearchError = false;
    data.aiResearchErrorMsg = null;

    // ---- Persist. Split writes so we can pinpoint which step fails if the
    // transaction rejects. Prospect update is the important one; audit log
    // is best-effort — a failing audit write should NOT surface as an
    // "Apply failed" error to the user.
    let updatedProspect;
    try {
      updatedProspect = await prisma.prospect.update({
        where: { id: prospectId },
        data,
      });
    } catch (e) {
      console.error('[research/apply] prospect.update failed. data=', JSON.stringify(data), 'err=', e);
      // Surface a specific, actionable error to the client.
      const msg = e?.meta?.cause || e?.message || 'Database update rejected the payload';
      return res.status(500).json({
        error: 'Could not save research to profile: ' + msg,
        code: e?.code || 'UPDATE_FAILED',
      });
    }

    // Best-effort audit log — don't fail the apply if this write breaks.
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
    // Catch-all with the real error message so the client can display something useful.
    console.error('[research/apply] unexpected error:', e);
    return res.status(500).json({
      error: 'Failed to apply research: ' + (e?.message || 'unknown error'),
      code: e?.code || 'UNKNOWN',
    });
  }
});

module.exports = router;
