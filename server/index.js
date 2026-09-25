'use strict';
const express = require('express');
const compression = require('compression');
const path = require('path');
const { db, isEmpty } = require('./db');
const { seed } = require('./seed');
const { token, now, HttpError } = require('./util');
const consent = require('./consent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// ---------- Session middleware ----------
function loadSession(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  try {
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2 && p[0]));
    const t = cookies.cv_session;
    if (t) {
      const s = db.prepare('SELECT * FROM Sessions WHERE token=? AND expiresAt>?').get(t, now());
      if (s) {
        req.sessionToken = t;
        req.user = db.prepare('SELECT * FROM Users WHERE id=?').get(s.userId) || null;
      }
    }
  } catch {}
  next();
}
app.use(loadSession);

// ---------- API routes ----------
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/patient', require('./routes/patient').router);
app.use('/api/records', require('./routes/records').router);
app.use('/api/consent', require('./routes/consentRoutes').router);
app.use('/api/provider', require('./routes/provider').router);
app.use('/api/admin', require('./routes/admin').router);

// Serve uploaded files (auth-checked per-record via the record file route; /files is owner-only too).
app.get('/files/:name', loadSession, (req, res) => {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Please log in.' } });
  const name = path.basename(req.params.name);
  // Only the record owner may fetch the raw file (providers use the consent-gated route).
  const rec = db.prepare('SELECT * FROM MedicalRecords WHERE fileUrl=?').get(`/files/${name}`);
  if (!rec || rec.patientId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not authorized to view this record.' } });
  const fs = require('fs');
  const p = path.join(__dirname, '..', 'data', 'uploads', name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: { message: 'File not found.' } });
  res.setHeader('Content-Disposition', `inline; filename="${rec.originalName || name}"`);
  res.sendFile(p);
});

// Notifications (any authenticated role).
const { db: _db } = require('./db');
app.get('/api/notifications', (req, res) => {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Please log in.' } });
  const rows = _db.prepare('SELECT * FROM Notifications WHERE userId=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: rows, unread: rows.filter(n => !n.read).length });
});
app.post('/api/notifications/read', (req, res) => {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Please log in.' } });
  _db.prepare('UPDATE Notifications SET read=1 WHERE userId=?').run(req.user.id);
  res.json({ ok: true });
});

// Public demo QR used by marketing visuals (contains no real tokens).
app.get('/api/demo-qr', async (req, res) => {
  const QRCode = require('qrcode');
  const url = await QRCode.toDataURL('CAREVAULT:DEMO', { width: 240, margin: 1, color: { dark: '#073036', light: '#FFFFFF' } });
  res.json({ url });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { code: err.code || 'ERROR', message: err.message || 'Something went wrong. Please try again.' } });
});

// ---------- Static frontend ----------
const PUB = path.join(__dirname, '..', 'public');
app.use(express.static(PUB));
app.get('/app/:role', (req, res) => {
  const pages = { patient: 'patient.html', provider: 'provider.html', admin: 'admin.html' };
  const f = pages[req.params.role];
  if (!f) return res.redirect('/');
  res.sendFile(path.join(PUB, f));
});
app.get('/login', (req, res) => res.sendFile(path.join(PUB, 'login.html')));

// ---------- Boot ----------
if (isEmpty()) { console.log('Seeding demo data…'); seed(); }
consent.sweep(db);
setInterval(() => { try { consent.sweep(db); } catch {} }, 30000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CareVault running → http://localhost:${PORT}`);
  console.log('Demo accounts (password Demo123!): patient@carevault.demo · doctor@carevault.demo · admin@carevault.demo');
});
