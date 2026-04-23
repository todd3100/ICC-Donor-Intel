const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// POST /api/prospects/:prospectId/notes
router.post('/prospects/:prospectId/notes', async (req, res) => {
  try {
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Note body required' });
    const note = await prisma.$transaction(async (tx) => {
      const n = await tx.note.create({
        data: {
          prospectId: req.params.prospectId,
          userId: req.user.id,
          body,
        },
        include: { user: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          prospectId: req.params.prospectId,
          userId: req.user.id,
          action: 'note_added',
          detail: `Added a team note`,
        },
      });
      return n;
    });
    res.json({ note });
  } catch (e) {
    console.error('[notes/create]', e);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

module.exports = router;
