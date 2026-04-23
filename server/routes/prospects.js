const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Fields the client is allowed to write
const WRITABLE = [
  'name', 'status', 'tier', 'age', 'location', 'undergrad', 'grad',
  'netWorth', 'netWorthSource', 'occupation', 'previousRoles',
  'campusConnections', 'philanthropicFootprint', 'oct7Signals',
  'children', 'spouse', 'personalConnections', 'iccNetworkMatches',
  'connectionDetail', 'contacted', 'lastContactDate', 'contactResponse',
];

function sanitizePayload(body) {
  const data = {};
  for (const k of WRITABLE) {
    if (!(k in body)) continue;
    let v = body[k];
    if (k === 'tier') v = Number(v) || 3;
    if (k === 'age') v = v === '' || v == null ? null : Number(v);
    if (k === 'contacted') v = !!v;
    if (k === 'lastContactDate') v = v ? new Date(v) : null;
    if (['previousRoles','campusConnections','philanthropicFootprint','iccNetworkMatches'].includes(k)) {
      if (!Array.isArray(v)) v = [];
      v = v.map((s) => String(s)).filter(Boolean);
    }
    if (typeof v === 'string') v = v.trim();
    data[k] = v;
  }
  return data;
}

function diffForAudit(before, after) {
  const changes = [];
  for (const k of WRITABLE) {
    if (!(k in after)) continue;
    const a = before?.[k];
    const b = after[k];
    const eq = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!eq) changes.push({ field: k, from: a, to: b });
  }
  return changes;
}

router.get('/', async (req, res) => {
  try {
    const { status, tier, contacted, iccMatch, q } = req.query;
    const where = {};
    if (status) where.status = status;
    if (tier) where.tier = Number(tier);
    if (contacted === 'true') where.contacted = true;
    if (contacted === 'false') where.contacted = false;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
        { occupation: { contains: q, mode: 'insensitive' } },
      ];
    }
    const prospects = await prisma.prospect.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        addedBy: { select: { id: true, name: true } },
        _count: { select: { notes: true } },
      },
    });
    let filtered = prospects;
    if (iccMatch === 'true') {
      filtered = prospects.filter((p) => (p.iccNetworkMatches || []).length > 0);
    } else if (iccMatch === 'false') {
      filtered = prospects.filter((p) => (p.iccNetworkMatches || []).length === 0);
    }
    res.json({ prospects: filtered });
  } catch (e) {
    console.error('[prospects/list]', e);
    res.status(500).json({ error: 'Failed to list prospects' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const prospect = await prisma.prospect.findUnique({
      where: { id: req.params.id },
      include: {
        addedBy: { select: { id: true, name: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!prospect) return res.status(404).json({ error: 'Not found' });

    // Resolve ICC network matches to donor names
    let matches = [];
    if (prospect.iccNetworkMatches?.length) {
      matches = await prisma.donor.findMany({
        where: { id: { in: prospect.iccNetworkMatches } },
        select: { id: true, name: true, type: true, principals: true },
      });
    }
    res.json({ prospect, matches });
  } catch (e) {
    console.error('[prospects/get]', e);
    res.status(500).json({ error: 'Failed to load prospect' });
  }
});

router.post('/', async (req, res) => {
  try {
    const data = sanitizePayload(req.body);
    if (!data.name) return res.status(400).json({ error: 'Name is required' });
    const prospect = await prisma.$transaction(async (tx) => {
      const p = await tx.prospect.create({
        data: { ...data, addedById: req.user.id },
      });
      await tx.auditLog.create({
        data: {
          prospectId: p.id,
          userId: req.user.id,
          action: 'created',
          detail: `Created prospect ${p.name}`,
        },
      });
      return p;
    });
    res.json({ prospect });
  } catch (e) {
    console.error('[prospects/create]', e);
    res.status(500).json({ error: 'Failed to create prospect' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const before = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Not found' });
    const data = sanitizePayload(req.body);
    const prospect = await prisma.$transaction(async (tx) => {
      const p = await tx.prospect.update({ where: { id: req.params.id }, data });
      const changes = diffForAudit(before, data);
      for (const c of changes) {
        await tx.auditLog.create({
          data: {
            prospectId: p.id,
            userId: req.user.id,
            action: 'updated',
            detail: `Changed ${c.field}: ${formatVal(c.from)} → ${formatVal(c.to)}`,
          },
        });
      }
      return p;
    });
    res.json({ prospect });
  } catch (e) {
    console.error('[prospects/update]', e);
    res.status(500).json({ error: 'Failed to update prospect' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.prospect.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete prospect' });
  }
});

function formatVal(v) {
  if (v == null || v === '') return '∅';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : '[' + v.join(', ') + ']';
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v);
}

module.exports = router;
