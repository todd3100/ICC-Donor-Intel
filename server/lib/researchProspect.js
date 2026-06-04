// Shared Anthropic research helper. Used by both the single-prospect route
// (server/routes/research.js) and the bulk research route (server/routes/researchBulk.js).
//
// Returns: { data, resolvedMatchIds, modelUsed }
// Throws: on missing API key, on unparseable model output, on Anthropic SDK errors.

const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('./prisma');

const MODEL = 'claude-sonnet-4-5-20250929';

function buildDonorListString(donors) {
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
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  const slice = candidate.slice(first, last + 1);
  try { return JSON.parse(slice); } catch { return null; }
}

async function researchProspect(prospect) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not configured on the server');
    err.code = 'NO_API_KEY';
    throw err;
  }

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
    console.warn('[researchProspect] web_search unavailable, falling back:', toolErr.message);
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  }

  const textBlocks = (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const data = extractJson(textBlocks);
  if (!data) {
    const err = new Error('The AI returned a response that could not be parsed as JSON.');
    err.code = 'UNPARSEABLE';
    err.raw = textBlocks?.slice(0, 2000) || '';
    throw err;
  }

  let resolvedMatchIds = [];
  if (Array.isArray(data.iccDonorMatchNames) && data.iccDonorMatchNames.length) {
    const matched = await prisma.donor.findMany({
      where: { name: { in: data.iccDonorMatchNames } },
      select: { id: true, name: true },
    });
    resolvedMatchIds = matched.map((d) => d.id);
  }

  return { data, resolvedMatchIds, modelUsed: MODEL };
}

// Build the writable fields object to apply research data to a prospect record.
function buildApplyFields(data, resolvedMatchIds) {
  const parts = [];
  if (data.warmPathwaySummary) parts.push(data.warmPathwaySummary);
  if (data.suggestedIntroAsk) parts.push('Suggested ask: ' + data.suggestedIntroAsk);
  if (data.iccNetworkNotes) parts.push('Notes: ' + data.iccNetworkNotes);
  const connectionDetail = parts.join('\n\n');

  return {
    campusConnections: Array.isArray(data.campus) ? data.campus.map(String).filter(Boolean) : undefined,
    philanthropicFootprint: Array.isArray(data.philanthropic) ? data.philanthropic.map(String).filter(Boolean) : undefined,
    oct7Signals: typeof data.oct7signals === 'string' ? data.oct7signals : undefined,
    children: typeof data.children === 'string' ? data.children : undefined,
    spouse: typeof data.spouse === 'string' ? data.spouse : undefined,
    personalConnections: typeof data.personalConnections === 'string' ? data.personalConnections : undefined,
    iccNetworkMatches: resolvedMatchIds,
    connectionDetail: connectionDetail || undefined,
  };
}

module.exports = { researchProspect, buildApplyFields, MODEL };
