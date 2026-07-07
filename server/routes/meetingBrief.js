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
      select: { id: true, name: true, type: true, principals: true },
    });
    iccNetworkConnections = donors;
  }

  // Last 3 notes for context (not displayed but used by AI)
  const recentNotes = await prisma.note.findMany({
    where: { prospectId: id },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { body: true, createdAt: true, user: { select: { name: true } } },
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
      ? iccNetworkConnections.map((d) => `- ${d.name}${d.type === 'org' ? ' (org)' : ''}`).join('\n')
      : '(none recorded)';
    const notesText = recentNotes.length
      ? recentNotes.map((n) => `- ${(n.body || '').slice(0, 200)}`).join('\n')
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
// Spacing constants (Fix 3 — prevent overlap).
// Minimum line-height ratio 1.4 is applied via lineGap on all flowing text.
const LG_BODY = 3;         // ~10pt font × 1.4 ≈ 4pt gap; use 3 for tightness
const PAD_SECTION = 14;    // vertical padding between sections (≥ 12pt requirement)
const PAD_HEADING = 8;     // gap between section title and its content

function renderBriefPdf(res, { prospect, iccNetworkConnections, talkingPoints, generatedBy, generatedAt }) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 54, bottom: 72, left: 54, right: 54 }, // extra bottom margin to protect footer
    bufferPages: true, // required so we can stamp footers on every page after layout
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
  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // NOTE: Footer is drawn on every page at the end of this function using
  // bufferedPageRange + switchToPage. This is safer than a 'pageAdded'
  // listener, which can recurse infinitely if drawing the footer itself
  // spans a page break.

  // ---- Header band ------------------------------------------------------
  // Draw logo/date at fixed positions but reserve a safe band height so
  // nothing below can overlap the header.
  const HEADER_TOP = doc.page.margins.top;
  const HEADER_HEIGHT = 56;

  if (LOGO_EXISTS) {
    try {
      doc.image(LOGO_PATH, left, HEADER_TOP, { height: 32 });
    } catch (_e) { /* ignore image errors */ }
  } else {
    doc.fillColor(COLOR_PRIMARY).font('Helvetica-Bold').fontSize(18)
      .text('ICC', left, HEADER_TOP, { lineBreak: false });
  }
  doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(9)
    .text('Donor Intelligence · Meeting Brief', left, HEADER_TOP + 38, { lineBreak: false });

  // Date on right (single line, aligned right within pageWidth)
  doc.fontSize(9).fillColor(COLOR_MUTED)
    .text(dateStr, left, HEADER_TOP, { width: pageWidth, align: 'right', lineBreak: false });

  // Divider below header band
  const dividerY = HEADER_TOP + HEADER_HEIGHT;
  doc.moveTo(left, dividerY).lineTo(left + pageWidth, dividerY)
    .strokeColor(COLOR_RULE).lineWidth(0.5).stroke();

  // Advance doc cursor to just below the divider. From here on we let pdfkit
  // manage y via moveDown() so nothing can overlap. Explicit y is only used
  // for the pill row (which we then follow up with moveDown).
  doc.x = left;
  doc.y = dividerY + PAD_SECTION;

  // ---- Prospect name ---------------------------------------------------
  doc.fillColor(COLOR_TEXT).font('Helvetica-Bold').fontSize(26)
    .text(prospect.name, { width: pageWidth, lineGap: 4 });
  doc.moveDown(0.2);

  // ---- Meta line -------------------------------------------------------
  const metaParts = [];
  if (prospect.occupation) metaParts.push(prospect.occupation);
  if (prospect.location) metaParts.push(prospect.location);
  if (metaParts.length) {
    doc.font('Helvetica').fontSize(11).fillColor(COLOR_MUTED)
      .text(metaParts.join(' · '), { width: pageWidth, lineGap: 2 });
  }
  doc.moveDown(0.6);

  // ---- Snapshot pill row (wraps to a new line if it overflows) ---------
  const pills = [];
  if (prospect.tier) pills.push({ label: `Tier ${prospect.tier}`, color: COLOR_ACCENT });
  if (prospect.stage) pills.push({ label: STAGE_LABELS[prospect.stage] || prospect.stage, color: COLOR_PRIMARY });
  if (prospect.netWorth) pills.push({ label: `Net worth: ${prospect.netWorth}`, color: COLOR_MUTED });
  const suggested = suggestedAskRange(prospect);
  if (suggested) pills.push({ label: `Suggested ask: ${suggested}`, color: COLOR_PRIMARY });

  if (pills.length > 0) {
    doc.font('Helvetica-Bold').fontSize(9);
    const pillHeight = 20;
    const pillGap = 6;
    const rowGap = 6;
    let pillX = left;
    let pillY = doc.y;
    for (const pill of pills) {
      const w = doc.widthOfString(pill.label) + 14;
      // Wrap onto a new pill row if this pill would overflow the page width
      if (pillX + w > left + pageWidth) {
        pillX = left;
        pillY += pillHeight + rowGap;
      }
      doc.roundedRect(pillX, pillY, w, pillHeight, 4).fillAndStroke(pill.color, pill.color);
      doc.fillColor('#ffffff')
        .text(pill.label, pillX + 7, pillY + 6, { lineBreak: false, width: w - 14 });
      pillX += w + pillGap;
    }
    // Advance doc.y past the pill block, whatever row it ended on
    doc.x = left;
    doc.y = pillY + pillHeight + PAD_SECTION;
  }

  // ---- Bio --------------------------------------------------------------
  if (prospect.bio) {
    sectionTitle(doc, 'Background', left, pageWidth);
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT)
      .text(prospect.bio.trim(), left, doc.y, { width: pageWidth, lineGap: LG_BODY });
    doc.moveDown(0.8);
    doc.y += PAD_SECTION - 8;
  }

  // ---- ICC network connections -----------------------------------------
  sectionTitle(doc, `ICC Donor Network Connections (${iccNetworkConnections.length})`, left, pageWidth);
  if (iccNetworkConnections.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLOR_MUTED)
      .text('No overlap with the existing ICC donor base recorded.', left, doc.y, { width: pageWidth, lineGap: LG_BODY });
    doc.moveDown(0.6);
  } else {
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT);
    const cols = 2;
    const colWidth = pageWidth / cols;
    const rowHeight = 16;                 // bumped from 14 to prevent tight-line overlap
    const startY = doc.y;
    let maxY = startY;
    const items = iccNetworkConnections.slice(0, 14);
    items.forEach((d, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = left + col * colWidth;
      const itemY = startY + row * rowHeight;
      const badge = d.type === 'org' ? '  · Org' : '';
      doc.text(`• ${d.name}${badge}`, x, itemY, { width: colWidth - 12, lineBreak: false, ellipsis: true });
      if (itemY + rowHeight > maxY) maxY = itemY + rowHeight;
    });
    doc.x = left;
    doc.y = maxY + 4;
    if (iccNetworkConnections.length > 14) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR_MUTED)
        .text(`+ ${iccNetworkConnections.length - 14} more`, left, doc.y, { width: pageWidth, lineBreak: false });
      doc.moveDown(0.4);
    }
  }
  doc.y += PAD_HEADING;

  // ---- Talking points ---------------------------------------------------
  sectionTitle(doc, 'Suggested Talking Points', left, pageWidth);
  if (talkingPoints.points && talkingPoints.points.length > 0) {
    talkingPoints.points.forEach((pt, i) => {
      const numStr = `${i + 1}.`;
      const rowTop = doc.y;
      // Draw the number label at rowTop, no line-break so doc.y is not moved.
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_PRIMARY)
        .text(numStr, left, rowTop, { width: 16, lineBreak: false });
      // Draw the actual text, flowing, indented — this call sets doc.y past
      // the wrapped text. Use continued:false and pass width so wrap works.
      doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT)
        .text(pt, left + 20, rowTop, { width: pageWidth - 20, lineGap: LG_BODY });
      doc.moveDown(0.4);   // 0.4 of a line ≈ ~5pt padding between points
    });
  } else {
    const note = talkingPoints.error
      ? `AI talking points unavailable: ${talkingPoints.error}`
      : 'AI talking points unavailable.';
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLOR_MUTED)
      .text(note, left, doc.y, { width: pageWidth, lineGap: LG_BODY });
    doc.moveDown(0.4);
  }

  // ---- Footer stamped on every page ----------------------------------
  // Iterate buffered pages so we can draw a consistent footer on each
  // without recursion (drawing the footer via pageAdded is unsafe because
  // the text call itself can trigger a new page and cause infinite loops).
  //
  // pdfkit auto-adds a new page whenever text() is written past the bottom
  // margin — even with lineBreak:false. Because footerY sits inside that
  // reserved bottom-margin band, we temporarily zero the bottom margin on
  // each page during footer stamping to prevent phantom blank pages from
  // being appended (see https://github.com/foliojs/pdfkit/issues/764).
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      const footerY = doc.page.height - 48;
      doc.moveTo(left, footerY - 6).lineTo(left + pageWidth, footerY - 6)
        .strokeColor(COLOR_RULE).lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED)
        .text(
          `Prepared by ${generatedBy || 'ICC Donor Intelligence'} · ${dateStr} · Confidential`,
          left, footerY,
          { width: pageWidth, align: 'center', lineBreak: false }
        );
    } finally {
      doc.page.margins.bottom = savedBottom;
    }
  }

  doc.end();
}

function sectionTitle(doc, label, x, pageWidth) {
  // Draw the section heading, then leave doc.y correctly positioned so the
  // following content flows below it with proper padding.
  const titleY = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR_PRIMARY)
    .text(label.toUpperCase(), x, titleY, { characterSpacing: 0.5, width: pageWidth, lineBreak: false });
  // Underline sits just below the text baseline
  const underlineY = doc.y + 1;
  doc.moveTo(x, underlineY).lineTo(x + 60, underlineY)
    .strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
  // Advance doc.y past the underline plus a heading pad so content doesn't touch
  doc.x = x;
  doc.y = underlineY + PAD_HEADING;
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
