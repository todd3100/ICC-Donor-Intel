const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// --- Admin: user management ---
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ users });
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const name = (req.body?.name || '').trim();
    const password = req.body?.password || '';
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name, password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'A user with that email already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    res.json({ user });
  } catch (e) {
    console.error('[auth/users create]', e);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
