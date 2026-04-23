const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

router.get('/', async (req, res) => {
  try {
    const donors = await prisma.donor.findMany({ orderBy: { name: 'asc' } });
    // Compute prospect connection counts per donor
    const prospects = await prisma.prospect.findMany({ select: { iccNetworkMatches: true } });
    const counts = {};
    for (const p of prospects) {
      for (const id of p.iccNetworkMatches || []) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    res.json({ donors: donors.map((d) => ({ ...d, prospectCount: counts[d.id] || 0 })) });
  } catch (e) {
    console.error('[donors/list]', e);
    res.status(500).json({ error: 'Failed to list donors' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const type = req.body?.type === 'individual' ? 'individual' : 'org';
    const principals = Array.isArray(req.body?.principals) ? req.body.principals.filter(Boolean) : [];
    const notes = req.body?.notes || null;
    const donor = await prisma.donor.create({ data: { name, type, principals, notes } });
    res.json({ donor });
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ error: 'Donor with that name already exists' });
    console.error('[donors/create]', e);
    res.status(500).json({ error: 'Failed to create donor' });
  }
});

router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const data = {};
    if ('name' in req.body) data.name = req.body.name.trim();
    if ('type' in req.body) data.type = req.body.type === 'individual' ? 'individual' : 'org';
    if ('principals' in req.body) data.principals = Array.isArray(req.body.principals) ? req.body.principals.filter(Boolean) : [];
    if ('notes' in req.body) data.notes = req.body.notes || null;
    const donor = await prisma.donor.update({ where: { id: req.params.id }, data });
    res.json({ donor });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update donor' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.donor.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete donor' });
  }
});

// CSV import — columns: name, type, principals, notes
router.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    let records;
    try {
      records = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (parseErr) {
      return res.status(400).json({ error: 'Could not parse CSV: ' + parseErr.message });
    }

    let added = 0, updated = 0, skipped = 0;
    const errors = [];

    for (const [i, row] of records.entries()) {
      const name = (row.name || row.Name || '').trim();
      if (!name) { skipped++; continue; }
      const typeRaw = (row.type || row.Type || 'org').toLowerCase().trim();
      const type = typeRaw === 'individual' ? 'individual' : 'org';
      const principalsRaw = (row.principals || row.Principals || '').toString();
      const principals = principalsRaw
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      const notes = (row.notes || row.Notes || '').toString().trim() || null;

      try {
        const existing = await prisma.donor.findUnique({ where: { name } });
        if (existing) {
          await prisma.donor.update({
            where: { id: existing.id },
            data: { type, principals, notes },
          });
          updated++;
        } else {
          await prisma.donor.create({ data: { name, type, principals, notes } });
          added++;
        }
      } catch (rowErr) {
        errors.push({ row: i + 2, error: rowErr.message });
        skipped++;
      }
    }

    res.json({ added, updated, skipped, errors });
  } catch (e) {
    console.error('[donors/import]', e);
    res.status(500).json({ error: 'Import failed' });
  }
});

module.exports = router;
