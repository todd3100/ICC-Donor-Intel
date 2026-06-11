const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { researchProspect, temperatureFromIccCount, normalizeNetWorth, MODEL } = require('../lib/researchProspect');

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

// Apply AI research results to a prospect profile (user-approved)
router.post('/prospects/:id/research/apply', async (req, res) => {
  try {
    const updates = req.body?.updates || {};
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const data = {};
    if (Array.isArray(updates.campus)) data.campusConnections = updates.campus;
    if (Array.isArray(updates.philanthropic)) data.philanthropicFootprint = updates.philanthropic;
    if (typeof updates.oct7signals === 'string') data.oct7Signals = updates.oct7signals;
    if (typeof updates.children === 'string') data.children = updates.children;
    if (typeof updates.spouse === 'string') data.spouse = updates.spouse;
    if (typeof updates.personalConnections === 'string') data.personalConnections = updates.personalConnections;
    if (Array.isArray(updates.iccNetworkMatches)) data.iccNetworkMatches = updates.iccNetworkMatches;
    if (typeof updates.connectionDetail === 'string') data.connectionDetail = updates.connectionDetail;
    if (typeof updates.netWorth === 'string') {
      const nw = normalizeNetWorth(updates.netWorth);
      if (nw !== undefined) data.netWorth = nw;
    }

    // Auto-recalc temperature from the final ICC connection count.
    // Use the new value if provided, else fall back to the prospect's existing matches.
    // Per product spec: override any previous status, including manual labels.
    // Exception: leave a 'connected' status alone — that's an outcome label, not a heat rating.
    const finalIccMatches = Array.isArray(data.iccNetworkMatches)
      ? data.iccNetworkMatches
      : (prospect.iccNetworkMatches || []);
    if (prospect.status !== 'connected') {
      data.status = temperatureFromIccCount(finalIccMatches.length);
    }

    // Mark research as completed when the user applies an update
    data.aiResearchCompleted = true;
    data.aiResearchLastRun = new Date();
    data.aiResearchError = false;
    data.aiResearchErrorMsg = null;

    const result = await prisma.$transaction(async (tx) => {
      const p = await tx.prospect.update({ where: { id: req.params.id }, data });
      await tx.auditLog.create({
        data: {
          prospectId: p.id,
          userId: req.user.id,
          action: 'ai_research_applied',
          detail: 'Applied AI research update to profile',
        },
      });
      return p;
    });

    res.json({ prospect: result });
  } catch (e) {
    console.error('[research/apply]', e);
    res.status(500).json({ error: 'Failed to apply research' });
  }
});

module.exports = router;
