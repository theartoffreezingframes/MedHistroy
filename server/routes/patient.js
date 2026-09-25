'use strict';
const express = require('express');
const { db } = require('../db');
const { now, ageFromDob, HttpError, asyncH, fmtDate } = require('../util');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please log in.');
  if (req.user.role !== 'patient') throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this record.');
  next();
});

const profileRow = (uid) => db.prepare('SELECT * FROM PatientProfiles WHERE userId=?').get(uid);

function patientInfo(uid) {
  const u = db.prepare('SELECT * FROM Users WHERE id=?').get(uid);
  const p = profileRow(uid) || {};
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, language: p.language || u.language,
    abhaId: p.abhaId, abhaConnected: !!p.abhaConnected, dateOfBirth: p.dateOfBirth,
    age: ageFromDob(p.dateOfBirth), gender: p.gender, bloodGroup: p.bloodGroup, location: p.location,
  };
}

router.get('/profile', asyncH(async (req, res) => res.json({ patient: patientInfo(req.user.id) })));

router.put('/profile', asyncH(async (req, res) => {
  const { name, phone, dateOfBirth, gender, bloodGroup, location, language } = req.body || {};
  db.prepare('UPDATE Users SET name=COALESCE(?,name), phone=COALESCE(?,phone), language=COALESCE(?,language) WHERE id=?')
    .run(name || null, phone || null, language || null, req.user.id);
  if (!profileRow(req.user.id)) db.prepare('INSERT INTO PatientProfiles (userId) VALUES (?)').run(req.user.id);
  db.prepare(`UPDATE PatientProfiles SET dateOfBirth=COALESCE(?,dateOfBirth), gender=COALESCE(?,gender),
    bloodGroup=COALESCE(?,bloodGroup), location=COALESCE(?,location), language=COALESCE(?,language) WHERE userId=?`)
    .run(dateOfBirth || null, gender || null, bloodGroup || null, location || null, language || null, req.user.id);
  res.json({ patient: patientInfo(req.user.id) });
}));

/** ABHA connection — clearly a DEMO mock; real ABDM sandbox integration can be added later. */
router.post('/abha/connect', asyncH(async (req, res) => {
  const { abhaId } = req.body || {};
  if (!abhaId || !/^[\dXx\- ]{8,24}$/.test(abhaId.trim())) throw new HttpError(400, 'BAD_REQUEST', 'Enter a valid ABHA number (demo format).');
  if (!profileRow(req.user.id)) db.prepare('INSERT INTO PatientProfiles (userId) VALUES (?)').run(req.user.id);
  db.prepare('UPDATE PatientProfiles SET abhaId=?, abhaConnected=1 WHERE userId=?').run(abhaId.trim().toUpperCase(), req.user.id);
  res.json({ ok: true, integration: 'demo-mock', message: 'ABHA Connected (Demo Integration)', patient: patientInfo(req.user.id) });
}));

router.get('/dashboard', asyncH(async (req, res) => {
  const uid = req.user.id;
  const c = (sql, ...args) => db.prepare(sql).get(...args).c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM ConsentRequests WHERE patientId=? AND status='PENDING'`).get(uid).c;
  res.json({
    counts: {
      medicines: c(`SELECT COUNT(*) c FROM Medicines WHERE patientId=? AND status='active'`, uid),
      allergies: c('SELECT COUNT(*) c FROM Allergies WHERE patientId=?', uid),
      recentReports: c(`SELECT COUNT(*) c FROM MedicalRecords WHERE patientId=? AND type='lab_report'`, uid),
      activeAccess: c(`SELECT COUNT(*) c FROM ConsentRequests WHERE patientId=? AND status='ACTIVE' AND expiresAt>?`, uid, now()),
      records: c('SELECT COUNT(*) c FROM MedicalRecords WHERE patientId=?', uid),
      unreadNotifications: c('SELECT COUNT(*) c FROM Notifications WHERE userId=? AND read=0', uid),
      pendingRequests: pending,
    },
    patient: patientInfo(uid),
  });
}));

// ---------- Health summary ----------
function buildSummary(uid) {
  const info = patientInfo(uid);
  const conditions = db.prepare('SELECT * FROM Conditions WHERE patientId=? ORDER BY lastUpdated DESC').all(uid);
  const medicines = db.prepare(`SELECT m.*, r.title AS sourceTitle, r.provider AS sourceProvider, r.date AS sourceDate
    FROM Medicines m LEFT JOIN MedicalRecords r ON r.id=m.sourceRecordId WHERE m.patientId=? AND m.status='active' ORDER BY m.name`).all(uid);
  const allergies = db.prepare(`SELECT a.*, r.title AS recordTitle FROM Allergies a LEFT JOIN MedicalRecords r ON r.id=a.sourceRecordId WHERE a.patientId=?`).all(uid);
  const reports = db.prepare(`SELECT id,title,provider,date,extraction,extractionStatus FROM MedicalRecords
    WHERE patientId=? AND type='lab_report' ORDER BY date DESC LIMIT 5`).all(uid)
    .map(r => ({ ...r, extraction: r.extraction ? JSON.parse(r.extraction) : null }));
  const visits = db.prepare('SELECT * FROM Visits WHERE patientId=? ORDER BY date DESC LIMIT 8').all(uid);
  return { patient: info, conditions, medicines, allergies, reports, visits };
}

router.get('/summary', asyncH(async (req, res) => res.json(buildSummary(req.user.id))));

/** AI-generated health summary (mock engine). Every claim links back to a source document. */
router.post('/summary/generate', asyncH(async (req, res) => {
  const uid = req.user.id;
  const s = buildSummary(uid);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const recsThisMonth = db.prepare('SELECT COUNT(*) c FROM MedicalRecords WHERE patientId=? AND createdAt>=?').get(uid, monthStart.toISOString()).c;
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const content = {
    engine: 'demo-mock',
    engineLabel: 'Demo AI summary — verify before clinical use.',
    generatedAt: now(),
    sections: [
      { key: 'recentActivity', title: 'Recent Activity', text: `${recsThisMonth || db.prepare('SELECT COUNT(*) c FROM MedicalRecords WHERE patientId=?').get(uid).c} medical records were added during ${monthLabel}.`, sources: [] },
      { key: 'medicines', title: 'Current Medicines', text: `${s.medicines.length} active medicines identified.`, sources: s.medicines.map(m => ({ label: `${m.name} ${m.dosage || ''}`.trim(), doc: m.sourceTitle ? `${m.sourceTitle} — ${m.sourceProvider} — ${fmtDate(m.sourceDate)}` : 'Manual entry' })) },
      { key: 'allergies', title: 'Allergies', text: s.allergies.length ? `${s.allergies.length} patient-verified allergy recorded.` : 'No allergy information recorded.', sources: s.allergies.map(a => ({ label: a.substance, doc: a.sourceLabel || 'Patient reported' })) },
      { key: 'tests', title: 'Recent Tests', text: `${s.reports.length} recent laboratory reports available.`, sources: s.reports.map(r => ({ label: r.title, doc: `${r.provider} — ${fmtDate(r.date)}` })) },
      { key: 'visits', title: 'Recent Visits', text: `${s.visits.length} healthcare visits recorded.`, sources: s.visits.map(v => ({ label: `${v.organization} — ${v.reason}`, doc: fmtDate(v.date) })) },
    ],
  };
  db.prepare('INSERT INTO GeneratedSummaries (patientId,content,createdAt) VALUES (?,?,?)').run(uid, JSON.stringify(content), now());
  res.json({ summary: content });
}));

router.get('/summary/latest', asyncH(async (req, res) => {
  const row = db.prepare('SELECT * FROM GeneratedSummaries WHERE patientId=? ORDER BY id DESC LIMIT 1').get(req.user.id);
  res.json({ summary: row ? JSON.parse(row.content) : null });
}));

// ---------- Medicines / allergies / conditions / visits ----------
router.get('/medicines', asyncH(async (req, res) => {
  const rows = db.prepare(`SELECT m.*, r.title AS sourceTitle, r.provider AS sourceProvider, r.date AS sourceDate
    FROM Medicines m LEFT JOIN MedicalRecords r ON r.id=m.sourceRecordId WHERE m.patientId=? ORDER BY m.status, m.name`).all(req.user.id);
  res.json({ medicines: rows });
}));

router.put('/medicines/:id', asyncH(async (req, res) => {
  const m = db.prepare('SELECT * FROM Medicines WHERE id=?').get(req.params.id);
  if (!m || m.patientId !== req.user.id) throw new HttpError(404, 'NOT_FOUND', 'Medicine not found.');
  const { name, dosage, frequency, status, endDate } = req.body || {};
  db.prepare('UPDATE Medicines SET name=COALESCE(?,name), dosage=COALESCE(?,dosage), frequency=COALESCE(?,frequency), status=COALESCE(?,status), endDate=COALESCE(?,endDate), verified=1, lastVerified=? WHERE id=?')
    .run(name || null, dosage || null, frequency || null, status || null, endDate || null, now(), m.id);
  res.json({ medicine: db.prepare('SELECT * FROM Medicines WHERE id=?').get(m.id) });
}));

router.get('/allergies', asyncH(async (req, res) => {
  const rows = db.prepare(`SELECT a.*, r.title AS recordTitle FROM Allergies a LEFT JOIN MedicalRecords r ON r.id=a.sourceRecordId WHERE a.patientId=?`).all(req.user.id);
  res.json({ allergies: rows });
}));

router.put('/allergies/:id', asyncH(async (req, res) => {
  const a = db.prepare('SELECT * FROM Allergies WHERE id=?').get(req.params.id);
  if (!a || a.patientId !== req.user.id) throw new HttpError(404, 'NOT_FOUND', 'Allergy not found.');
  const { substance, reaction, severity } = req.body || {};
  db.prepare('UPDATE Allergies SET substance=COALESCE(?,substance), reaction=COALESCE(?,reaction), severity=COALESCE(?,severity), verified=1, lastVerified=? WHERE id=?')
    .run(substance || null, reaction || null, severity || null, now(), a.id);
  res.json({ allergy: db.prepare('SELECT * FROM Allergies WHERE id=?').get(a.id) });
}));

router.get('/visits', asyncH(async (req, res) => {
  const rows = db.prepare('SELECT * FROM Visits WHERE patientId=? ORDER BY date DESC').all(req.user.id);
  res.json({ visits: rows });
}));

// ---------- Global search ----------
router.get('/search', asyncH(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ groups: [] });
  const uid = req.user.id;
  const like = `%${q}%`;
  const groups = [];
  const meds = db.prepare(`SELECT * FROM Medicines WHERE patientId=? AND (name LIKE ? OR dosage LIKE ? OR frequency LIKE ?)`).all(uid, like, like, like);
  if (meds.length) groups.push({ label: 'Medicines', items: meds.map(m => ({ id: m.id, title: `${m.name} ${m.dosage || ''}`.trim(), sub: `${m.frequency || ''} · ${m.status}`, link: '/medicines' })) });
  const algs = db.prepare('SELECT * FROM Allergies WHERE patientId=? AND (substance LIKE ? OR reaction LIKE ?)').all(uid, like, like);
  if (algs.length) groups.push({ label: 'Allergies', items: algs.map(a => ({ id: a.id, title: a.substance, sub: a.reaction || '', link: '/allergies' })) });
  const recs = db.prepare(`SELECT * FROM MedicalRecords WHERE patientId=? AND (title LIKE ? OR provider LIKE ? OR extraction LIKE ?)`).all(uid, like, like, like);
  if (recs.length) groups.push({ label: 'Records & Reports', items: recs.map(r => ({ id: r.id, title: r.title, sub: `${r.provider || ''} · ${fmtDate(r.date)}`, link: '/records' })) });
  const visits = db.prepare('SELECT * FROM Visits WHERE patientId=? AND (organization LIKE ? OR reason LIKE ? OR notes LIKE ?)').all(uid, like, like, like);
  if (visits.length) groups.push({ label: 'Visits', items: visits.map(v => ({ id: v.id, title: `${v.organization} — ${v.reason}`, sub: fmtDate(v.date), link: '/visits' })) });
  const conds = db.prepare('SELECT * FROM Conditions WHERE patientId=? AND name LIKE ?').all(uid, like);
  if (conds.length) groups.push({ label: 'Conditions', items: conds.map(c => ({ id: c.id, title: c.name, sub: `Source: ${c.source || '—'}`, link: '/summary' })) });
  res.json({ groups });
}));

// ---------- Notifications ----------
router.get('/notifications', asyncH(async (req, res) => {
  const rows = db.prepare('SELECT * FROM Notifications WHERE userId=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: rows, unread: rows.filter(n => !n.read).length });
}));

router.post('/notifications/read', asyncH(async (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids) && ids.length) db.prepare(`UPDATE Notifications SET read=1 WHERE userId=? AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
  else db.prepare('UPDATE Notifications SET read=1 WHERE userId=?').run(req.user.id);
  res.json({ ok: true });
}));

module.exports = { router, buildSummary, patientInfo };
