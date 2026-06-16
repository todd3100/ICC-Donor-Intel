// server/routes/meetingBrief.js
// Batch D: PDF Meeting Brief generator.
//
// GET  /api/prospects/:id/meeting-brief.pdf      -> streams PDF
// POST /api/prospects/:id/meeting-brief/preview  -> returns JSON the PDF will use
//                                                    (handy for the UI to show a
//                                                    spinner-friendly preview)
//
// Implementation notes:
//   * Uses pdfkit (already added to server/package.json). No Chromium needed.
//   * Talking points are generated via Anthropic Claude (same model/key as
//     researchProspect.js). On any Anthropic error we still produce the PDF
//     with a graceful "talking points unavailable" message — never block the
//     download just because the AI step failed.
//   * Compact ONE-PAGE layout: header (logo + name + tier/stage/ask), bio,
//     ICC network connections, top 3-5 talking points, prepared-by footer.

const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Logo path — file ships in server/assets/icc-logo.png
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'icc-logo.png');
const LOGO_EXISTS = fs.existsSync(LOGO_PATH);

// Brand colors
const COLOR_PRIMARY = '#0E7C66';   // ICC green
const COLOR_ACCENT = '#C9A227';    // gold
const COLOR_TEXT = '#1a1a1a';
const COLOR_MUTED = '#666666';
const COLOR_RULE = '#e0e0e0';

// Stage labels mirror the dashboard / kanban
const STAGE_LABELS = {
  identified: 'Identified',
  researched: 'Researched',
  warm_intro_made: 'Warm Intro',
  meeting_scheduled: 'Meeting Scheduled',
  cultivation: 'Cultivation',
  ask_made: 'Ask Made',
  closed_won: 'Closed Won',
  closed_declined: 'Declined',
};

function fmtMoney(n) {
  if (n == null) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

function suggestedAskRange(p) {
  if (p.suggestedAskMin == null && p.suggestedAskMax == null) return null;
  if (p.suggestedAskMin && p.suggestedAskMax) return `${fmtMoney(p.suggestedAskMin)} – ${fmtMoney(p.suggestedAskMax)}`;
  return fmtMoney(p.suggestedAskMax ?? p.suggestedAskMin);
}

// ---- Fetch full prospect record with related donor names -----------------
async function loadProspectForBrief(id) {
  const prospect = await prisma.prospect.findUnique({ where: { id } });
  if (!prospect) return null;

  // Resolve ICC network match donor names.
  let iccNetworkConnections = [];
  if (Array.isArray(prospect.iccNetworkMatches) && prospect.iccNetworkMatches.length > 0) {
    const donors = await prisma.donor.findMany({
      where: { id: { in: prospect.iccNetworkMatches } },
      select: { id: true, name: true, totalGiving: true, isBoard: true, isTrustee: true },
    });
    iccNetworkConnections = donors;
  }

  // Last 3 notes for context (not displayed but used by AI)
  const recentNotes = await prisma.note.findMany({
    where: { prospectId: id },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { content: true, createdAt: true, user: { select: { name: true } } },
  });

  return { prospect, iccNetworkConnections, recentNotes };
}

// ---- AI talking-point generation -----------------------------------------
async function generateTalkingPoints(prospect, iccNetworkConnections, recentNotes) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { points: [], error: 'ANTHROPIC_API_KEY not configured' };
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const connectionsText = iccNetworkConnections.length
      ? iccNetworkConnections.map((d) => `- ${d.name}${d.isBoard ? ' (ICC board)' : d.isTrustee ? ' (ICC trustee)' : ''}`).join('\n')
      : '(none recorded)';
    const notesText = recentNotes.length
      ? recentNotes.map((n) => `- ${n.content.slice(0, 200)}`).join('\n')
      : '(none recorded)';
    const philanthropyText = Array.isArray(prospect.philanthropicFootprint) && prospect.philanthropicFootprint.length
      ? prospect.philanthropicFootprint.join('; ')
      : '(unknown)';

    const prompt = `You are preparing a development officer for a fundraising meeting at ICC (Israel on Campus Coalition, a $18M nonprofit supporting Jewish/Israel education on US college campuses).

PROSPECT: ${prospect.name}
TITLE/OCCUPATION: ${prospect.occupation || 'unknown'}
LOCATION: ${prospect.location || 'unknown'}
NET WORTH: ${prospect.netWorth || 'unknown'}
TIER: ${prospect.tier ?? 'unknown'}
STAGE: ${STAGE_LABELS[prospect.stage] || prospect.stage}

KNOWN PHILANTHROPY: ${philanthropyText}

ICC DONOR NETWORK CONNECTIONS (people in ICC's existing donor base who are likely connections):
${connectionsText}

RECENT INTERNAL NOTES:
${notesText}

BIO / BACKGROUND:
${prospect.bio || '(none recorded)'}

TASK: Write exactly 3 to 5 personalized talking points the meeting-runner should use to build rapport and frame the ICC opportunity. Each point should be a single sentence, action-oriented (start with a verb like "Reference", "Acknowledge", "Connect", "Ask about", "Bridge from..."), specific to THIS prospect, and grounded in the data above. Do NOT invent facts. Do NOT use bullet symbols. Number them 1. 2. 3. etc.

Return ONLY the numbered list, no preamble.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = (message.content?.[0]?.text || '').trim();
    // Split into individual points by "1.", "2.", ...
    const points = raw
      .split(/\n+/)
      .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
      .filter((line) => line.length > 0)
      .slice(0, 5);

    return { points };
  } catch (err) {
    console.error('[meetingBrief] talking points error:', err.message);
    return { points: [], error: err.message };
  }
}

// ---- PDF layout ----------------------------------------------------------
function renderBriefPdf(res, { prospect, iccNetworkConnections, talkingPoints, generatedBy, generatedAt }) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title: `ICC Meeting Brief — ${prospect.name}`,
      Author: 'ICC Donor Intelligence',
      Subject: 'Meeting Brief',
    },
  });

  // Pipe to HTTP response
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="ICC_Brief_${prospect.name.replace(/[^a-z0-9]+/gi, '_')}.pdf"`
  );
  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  let y = doc.page.margins.top;

  // ---- Header band ------------------------------------------------------
  if (LOGO_EXISTS) {
    try {
      doc.image(LOGO_PATH, left, y, { height: 32 });
    } catch (_e) { /* ignore image errors */ }
  } else {
    doc.fillColor(COLOR_PRIMARY).font('Helvetica-Bold').fontSize(18).text('ICC', left, y);
  }
  doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(9)
    .text('Donor Intelligence · Meeting Brief', left, y + 36);

  // Date on right
  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.fontSize(9).fillColor(COLOR_MUTED)
    .text(dateStr, left, y, { width: pageWidth, align: 'right' });

  y += 60;
  doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(COLOR_RULE).lineWidth(0.5).stroke();
  y += 14;

  // ---- Prospect name + meta line ----------------------------------------
  doc.fillColor(COLOR_TEXT).font('Helvetica-Bold').fontSize(26).text(prospect.name, left, y);
  y = doc.y + 4;

  const metaParts = [];
  if (prospect.occupation) metaParts.push(prospect.occupation);
  if (prospect.location) metaParts.push(prospect.location);
  if (metaParts.length) {
    doc.font('Helvetica').fontSize(11).fillColor(COLOR_MUTED).text(metaParts.join(' · '), left, y);
    y = doc.y + 8;
  }

  // ---- Snapshot pill row ------------------------------------------------
  const pills = [];
  if (prospect.tier) pills.push({ label: `Tier ${prospect.tier}`, color: COLOR_ACCENT });
  if (prospect.stage) pills.push({ label: STAGE_LABELS[prospect.stage] || prospect.stage, color: COLOR_PRIMARY });
  if (prospect.netWorth) pills.push({ label: `Net worth: ${prospect.netWorth}`, color: COLOR_MUTED });

  const suggested = suggestedAskRange(prospect);
  if (suggested) pills.push({ label: `Suggested ask: ${suggested}`, color: COLOR_PRIMARY });

  let pillX = left;
  doc.font('Helvetica-Bold').fontSize(9);
  for (const pill of pills) {
    const w = doc.widthOfString(pill.label) + 14;
    doc.roundedRect(pillX, y, w, 20, 4).fillAndStroke(pill.color, pill.color);
    doc.fillColor('#ffffff').text(pill.label, pillX + 7, y + 6, { lineBreak: false });
    pillX += w + 6;
  }
  y += 32;

  // ---- Bio --------------------------------------------------------------
  if (prospect.bio) {
    sectionTitle(doc, 'Background', left, y);
    y = doc.y + 4;
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT)
      .text(prospect.bio.trim(), left, y, { width: pageWidth, lineGap: 2 });
    y = doc.y + 12;
  }

  // ---- ICC network connections -----------------------------------------
  sectionTitle(doc, `ICC Donor Network Connections (${iccNetworkConnections.length})`, left, y);
  y = doc.y + 4;
  if (iccNetworkConnections.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLOR_MUTED)
      .text('No overlap with the existing ICC donor base recorded.', left, y, { width: pageWidth });
    y = doc.y + 12;
  } else {
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT);
    // Two-column list to keep it tight
    const cols = 2;
    const colWidth = pageWidth / cols;
    const startY = y;
    let maxY = y;
    const items = iccNetworkConnections.slice(0, 14);
    items.forEach((d, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = left + col * colWidth;
      const itemY = startY + row * 14;
      const badge = d.isBoard ? '  · Board' : d.isTrustee ? '  · Trustee' : '';
      doc.text(`• ${d.name}${badge}`, x, itemY, { width: colWidth - 8, lineBreak: false });
      if (itemY + 14 > maxY) maxY = itemY + 14;
    });
    y = maxY + 8;
    if (iccNetworkConnections.length > 14) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR_MUTED)
        .text(`+ ${iccNetworkConnections.length - 14} more`, left, y);
      y = doc.y + 8;
    }
  }

  // ---- Talking points ---------------------------------------------------
  sectionTitle(doc, 'Suggested Talking Points', left, y);
  y = doc.y + 4;
  if (talkingPoints.points && talkingPoints.points.length > 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT);
    talkingPoints.points.forEach((pt, i) => {
      const numStr = `${i + 1}.`;
      doc.font('Helvetica-Bold').text(numStr, left, y, { continued: false, lineBreak: false });
      doc.font('Helvetica').text(pt, left + 18, y, { width: pageWidth - 18, lineGap: 2 });
      y = doc.y + 6;
    });
  } else {
    const note = talkingPoints.error
      ? `AI talking points unavailable: ${talkingPoints.error}`
      : 'AI talking points unavailable.';
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLOR_MUTED)
      .text(note, left, y, { width: pageWidth });
    y = doc.y + 8;
  }

  // ---- Footer -----------------------------------------------------------
  const footerY = doc.page.height - doc.page.margins.bottom - 14;
  doc.moveTo(left, footerY - 6).lineTo(left + pageWidth, footerY - 6).strokeColor(COLOR_RULE).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED)
    .text(`Prepared by ${generatedBy || 'ICC Donor Intelligence'} · ${dateStr} · Confidential`, left, footerY, {
      width: pageWidth,
      align: 'center',
    });

  doc.end();
}

function sectionTitle(doc, label, x, y) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_PRIMARY)
    .text(label.toUpperCase(), x, y, { characterSpacing: 0.5 });
  doc.moveTo(x, doc.y + 1).lineTo(x + 60, doc.y + 1).strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
}

// ---- Routes --------------------------------------------------------------
router.get('/prospects/:id/meeting-brief.pdf', async (req, res, next) => {
  try {
    const data = await loadProspectForBrief(req.params.id);
    if (!data) return res.status(404).json({ error: 'Prospect not found' });
    const { prospect, iccNetworkConnections, recentNotes } = data;
    const talkingPoints = await generateTalkingPoints(prospect, iccNetworkConnections, recentNotes);
    renderBriefPdf(res, {
      prospect,
      iccNetworkConnections,
      talkingPoints,
      generatedBy: req.user?.name || 'ICC Donor Intelligence',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// JSON preview endpoint (handy for the UI to test data before generating PDF)
router.get('/prospects/:id/meeting-brief/preview', async (req, res, next) => {
  try {
    const data = await loadProspectForBrief(req.params.id);
    if (!data) return res.status(404).json({ error: 'Prospect not found' });
    const { prospect, iccNetworkConnections, recentNotes } = data;
    const talkingPoints = await generateTalkingPoints(prospect, iccNetworkConnections, recentNotes);
    res.json({ prospect, iccNetworkConnections, recentNotes, talkingPoints });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
