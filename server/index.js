require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const prospectsRoutes = require('./routes/prospects');
const donorsRoutes = require('./routes/donors');
const notesRoutes = require('./routes/notes');
const researchRoutes = require('./routes/research');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/prospects', prospectsRoutes);
app.use('/api/donors', donorsRoutes);
app.use('/api', notesRoutes);
app.use('/api', researchRoutes);

// Serve the built React client from /client/dist in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('[server/error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;

// Sync the Prisma schema to the database at startup. We do this here (not at
// build time) because Railway's internal Postgres network is only available
// once the service is actually running.
function runDbPushOnBoot() {
  if (process.env.RUN_DB_PUSH_ON_START === 'false') return;
  try {
    const { execSync } = require('child_process');
    console.log('[server] running prisma db push...');
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env,
    });
    console.log('[server] prisma db push complete');
  } catch (e) {
    // Log but do not crash — if the schema is already in sync on a restart,
    // we still want the server to come up.
    console.warn('[server] prisma db push failed (continuing):', e.message);
  }
}

function runSeedOnBoot() {
  if (process.env.RUN_SEED_ON_START === 'false') return;
  try {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, 'prisma', 'seed.js')], {
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => console.log(`[server] seed exited with code ${code}`));
    child.on('error', (e) => console.warn('[server] seed failed to start:', e.message));
  } catch (e) {
    console.warn('[server] seed skipped:', e.message);
  }
}

runDbPushOnBoot();
runSeedOnBoot();
app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
});