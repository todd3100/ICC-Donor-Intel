const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MODEL = 'claude-sonnet-4-5-20250929';

function buildDonorListString(donors) {
  // Compact but readable. Each line: "Donor Name — principals: A, B, C — notes: ..."
  return donors
    .map((d) => {
      const parts = [d.name];
      if (d.principals?.length) parts.push(`principals: ${d.principals.join(', ')}`);
      if (d.notes) parts.push(`notes: ${d.notes}`);
      return `- ${parts.join(' — ')}`;
    })
    .join('\n');
}

function extractJson(text) {
  if (!text) return null;
  // Strip code fences if the model wrapped anyway
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find first { and last }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  const slice = candidate.slice(first, last + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

router.post('/prospects/:id/research', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
  }

  try {
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const donors = await prisma.donor.findMany({
      orderBy: { name: 'asc' },
      select: { name: true, principals: true, notes: true },
    });
    const donorList = buildDonorListString(donors);

    const systemPrompt =
      'You are a philanthropic intelligence analyst for ICC (Israel on Campus Coalition). ' +
      'Research high-net-worth Jewish and pro-Israel donors for donor development purposes using only publicly available information. ' +
      'Return ONLY a valid JSON object with no markdown, no preamble.';

    const userPrompt = [
      'Research this prospect and return a JSON object with these exact keys:',
      '- "campus": array of strings (named buildings, programs, trusteeships, major university donations)',
      '- "philanthropic": array of strings (major orgs donated to, family foundation, boards served on)',
      '- "oct7signals": string (any post-Oct 7, 2023 public statements, letters, donation changes, or media appearances related to campus antisemitism or Israel)',
      '- "iccNetworkNotes": string (any known connections between this prospect and the following ICC donors/principals:',
      donorList,
      ')',
      '- "children": string (children\'s colleges or schools if publicly known)',
      '- "spouse": string (spouse name and affiliations if publicly known)',
      '- "personalConnections": string (any other notable family, business, or civic ties relevant to a philanthropic introduction)',
      '- "suggestedIntroAsk": string (one sentence ICC staff could use to ask an existing donor to make an introduction)',
      '- "warmPathwaySummary": string (2-3 sentences summarizing the single most promising warm introduction route)',
      '- "iccDonorMatchNames": array of strings (names of donors from the list above whom this prospect has a documented or likely connection to — pick ONLY from the donor list)',
      '',
      `Prospect: ${prospect.name || '(unknown name)'}, ${prospect.occupation || 'occupation unknown'}, ${prospect.location || 'location unknown'}. Known net worth: ${prospect.netWorth || 'unknown'}.`,
      prospect.undergrad ? `Undergrad: ${prospect.undergrad}.` : '',
      prospect.grad ? `Graduate education: ${prospect.grad}.` : '',
      prospect.previousRoles?.length ? `Known prior roles: ${prospect.previousRoles.join('; ')}.` : '',
      prospect.campusConnections?.length ? `Known campus connections: ${prospect.campusConnections.join('; ')}.` : '',
      prospect.philanthropicFootprint?.length ? `Known philanthropy: ${prospect.philanthropicFootprint.join('; ')}.` : '',
    ].filter(Boolean).join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Attempt with web_search tool. Fall back to plain messages if web_search errors.
    let message;
    try {
      message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [{ role: 'user', content: userPrompt }],
      });
    } catch (toolErr) {
      console.warn('[research] web_search unavailable, falling back:', toolErr.message);
      message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
    }

    // Gather all text blocks
    const textBlocks = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const data = extractJson(textBlocks);
    if (!data) {
      return res.status(502).json({
        error: 'The AI returned a response that could not be parsed as JSON. Please try again.',
        raw: textBlocks?.slice(0, 2000) || '',
      });
    }

    // Resolve any suggested donor names back to donor IDs from our database
    let resolvedMatchIds = [];
    if (Array.isArray(data.iccDonorMatchNames) && data.iccDonorMatchNames.length) {
      const matched = await prisma.donor.findMany({
        where: { name: { in: data.iccDonorMatchNames } },
        select: { id: true, name: true },
      });
      resolvedMatchIds = matched.map((d) => d.id);
    }

    res.json({
      research: data,
      resolvedMatchIds,
      modelUsed: MODEL,
    });
  } catch (e) {
    console.error('[research]', e);
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
