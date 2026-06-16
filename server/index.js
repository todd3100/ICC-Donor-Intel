require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth');
// Note: researchBulk must be required BEFORE prospects, because prospects.js
// requires enqueueBulkResearch from researchBulk for the CSV import auto-trigger.
const researchBulkRoutes = require('./routes/researchBulk');
const prospectsRoutes = require('./routes/prospects');
const donorsRoutes = require('./routes/donors');
const notesRoutes = require('./routes/notes');
const researchRoutes = require('./routes/research');
const networkRoutes = require('./routes/network');
const tasksRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const meetingBriefRoutes = require('./routes/meetingBrief');

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
app.use('/api', researchBulkRoutes);
app.use('/api', networkRoutes);
app.use('/api', tasksRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', meetingBriefRoutes);

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
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
