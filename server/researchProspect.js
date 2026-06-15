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
    '- "netWorth": string (estimated net worth from public sources, formatted like "$2.5B" or "$450M". If net worth cannot be determined from public sources, return exactly "Unknown" — do NOT use "Substantial", "Significant", "High", or any other qualifier)',
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

// Normalize the net worth string. AI sometimes returns 'Substantial', 'Significant',
// 'High net worth', etc. when it can't find a public figure — we want a single canonical
// value 'Unknown' so the UI can render consistently and DB queries are predictable.
function normalizeNetWorth(v) {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const UNKNOWN_SYNONYMS = [
    'substantial', 'significant', 'high', 'high net worth', 'high-net-worth',
    'considerable', 'wealthy', 'undisclosed', 'not disclosed', 'not publicly disclosed',
    'not publicly available', 'not available', 'n/a', 'na', 'unknown', '—', '-',
  ];
  if (UNKNOWN_SYNONYMS.includes(lower)) return 'Unknown';
  return trimmed;
}

// Compute the temperature label based on ICC connection count.
// 5+ connections → hot, 2–4 → warm, 0–1 → cold. Returns one of: 'hot' | 'warm' | 'cold'.
// Note: this does NOT include the 'connected' status — that's set when a donor introduction
// has actually happened, and should be preserved separately by callers if needed.
function temperatureFromIccCount(count) {
  if (count >= 5) return 'hot';
  if (count >= 2) return 'warm';
  return 'cold';
}

// Parse a net worth string like "$2.5B" or "~$450M" or "$13.8B" into a number (dollars).
// Returns null if the value is missing, "Unknown", or unparseable.
function parseNetWorthDollars(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'unknown') return null;
  // Match the first number with optional decimals, then the unit suffix.
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

// Round a dollar amount to a nice presentation tier.
// We try to pick a value the eye accepts: 1000/2500/5000/10000/25000/50000/100000/250000/...
function roundAskAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const TIERS = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000,
                 500000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000];
  // Find the closest tier value to n.
  let best = TIERS[0];
  let bestDiff = Math.abs(n - best);
  for (const t of TIERS) {
    const d = Math.abs(n - t);
    if (d < bestDiff) { bestDiff = d; best = t; }
  }
  return best;
}

// Compute a suggested ask range from net worth (if known) or ICC connection count (proxy).
// Returns { min, max } in whole dollars, or { min: null, max: null } if no signal.
// Rules:
//   - If net worth parseable: 0.5% to 1.0% of net worth, rounded to nice tiers.
//   - Else: 5+ ICC connections → $50k-$100k
//           2–4 ICC connections → $10k-$50k
//           0–1 ICC connections → $1k-$10k
function computeSuggestedAsk({ netWorth, iccConnectionCount }) {
  const nw = parseNetWorthDollars(netWorth);
  if (nw && nw > 0) {
    const min = roundAskAmount(nw * 0.005);
    const max = roundAskAmount(nw * 0.01);
    return { min, max: Math.max(min, max) };
  }
  const c = Number(iccConnectionCount) || 0;
  if (c >= 5)  return { min: 50_000, max: 100_000 };
  if (c >= 2)  return { min: 10_000, max: 50_000 };
  return { min: 1_000, max: 10_000 };
}

// Build the writable fields object to apply research data to a prospect record.
function buildApplyFields(data, resolvedMatchIds) {
  const parts = [];
  if (data.warmPathwaySummary) parts.push(data.warmPathwaySummary);
  if (data.suggestedIntroAsk) parts.push('Suggested ask: ' + data.suggestedIntroAsk);
  if (data.iccNetworkNotes) parts.push('Notes: ' + data.iccNetworkNotes);
  const connectionDetail = parts.join('\n\n');

  // Auto-compute the new temperature from the resolved ICC connection count.
  // This overrides any previous status (including manual labels) per product spec.
  // We do NOT overwrite a status of 'connected' here — that's an outcome label set
  // elsewhere when an actual introduction has been made.
  const newStatus = temperatureFromIccCount(
    Array.isArray(resolvedMatchIds) ? resolvedMatchIds.length : 0
  );

  // Auto-compute the suggested ask range based on the newly normalized net worth
  // and the resolved ICC connection count. Callers can still override per-prospect
  // via PATCH; once suggestedAskOverride=true on the prospect, callers should skip
  // overwriting these fields.
  const normalizedNetWorth = normalizeNetWorth(data.netWorth);
  const { min: suggestedAskMin, max: suggestedAskMax } = computeSuggestedAsk({
    netWorth: normalizedNetWorth,
    iccConnectionCount: Array.isArray(resolvedMatchIds) ? resolvedMatchIds.length : 0,
  });

  return {
    campusConnections: Array.isArray(data.campus) ? data.campus.map(String).filter(Boolean) : undefined,
    philanthropicFootprint: Array.isArray(data.philanthropic) ? data.philanthropic.map(String).filter(Boolean) : undefined,
    oct7Signals: typeof data.oct7signals === 'string' ? data.oct7signals : undefined,
    children: typeof data.children === 'string' ? data.children : undefined,
    spouse: typeof data.spouse === 'string' ? data.spouse : undefined,
    personalConnections: typeof data.personalConnections === 'string' ? data.personalConnections : undefined,
    netWorth: normalizedNetWorth,
    iccNetworkMatches: resolvedMatchIds,
    connectionDetail: connectionDetail || undefined,
    status: newStatus,
    suggestedAskMin,
    suggestedAskMax,
  };
}

module.exports = {
  researchProspect,
  buildApplyFields,
  temperatureFromIccCount,
  normalizeNetWorth,
  computeSuggestedAsk,
  parseNetWorthDollars,
  MODEL,
};
