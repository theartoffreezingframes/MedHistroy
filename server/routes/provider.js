'use strict';
const express = require('express');
const { db } = require('../db');
const consent = require('../consent');
const { now, addMinutes, HttpError, asyncH, fmtDate } = require('../util');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please log in.');
  if (req.user.role !== 'provider') throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this record.');
  next();
});

const providerRow = (uid) => db.prepare('SELECT * FROM Providers WHERE userId=?').get(uid);

router.get('/me', asyncH(async (req, res) => {
  res.json({ provider: { ...providerRow(req.user.id), userName: req.user.name } });
}));

/**
 * Provider scans a QR / enters a code. The code maps to a share token; this
 * endpoint only creates a PENDING consent request — no patient data is
 * revealed until the patient approves.
 */
router.post('/scan', asyncH(async (req, res) => {
  const raw = String(req.body.code || '').trim().replace(/^CAREVAULT:/i, '').toUpperCase();
  if (!raw) throw new HttpError(400, 'BAD_REQUEST', 'Enter or scan a patient access code.');
  const t = db.prepare(`SELECT * FROM ShareTokens WHERE code=?`).get(raw);
  if (!t) throw new HttpError(404, 'INVALID_CODE', 'This QR / access code is not valid. Please ask the patient to generate a fresh QR.');
  if (t.status !== 'active') throw new HttpError(410, 'CODE_INACTIVE', 'This share session is no longer active. Please ask the patient to generate a fresh QR.');
  if (t.expiresAt <= now()) { db.prepare(`UPDATE ShareTokens SET status='expired' WHERE id=?`).run(t.id); throw new HttpError(410, 'CODE_EXPIRED', 'This QR code has expired. Please ask the patient to generate a fresh QR.'); }
  if (t.patientId === req.user.id) throw new HttpError(400, 'SELF', 'You cannot scan your own code.');

  // Prevent duplicate pending requests for the same token+provider.
  const existing = db.prepare(`SELECT * FROM ConsentRequests WHERE shareTokenId=? AND providerId=? AND status='PENDING'`).get(t.id, req.user.id);
  let c;
  if (existing) c = existing;
  else {
    const id = db.prepare(`INSERT INTO ConsentRequests (patientId,providerId,shareTokenId,purpose,categories,durationMin,status,mode,createdAt)
      VALUES (?,?,?,?,?,?, 'PENDING', 'qr', ?)`).run(t.patientId, req.user.id, t.id, t.purpose, t.categories, t.durationMin, now()).lastInsertRowid;
    c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(id);
    db.prepare(`UPDATE ShareTokens SET status='used' WHERE id=?`).run(t.id);
    consent.log(db, { consentId: id, patientId: t.patientId, providerId: req.user.id, providerLabel: providerRow(req.user.id).organization, action: 'ACCESS_REQUESTED', detail: `Purpose: ${t.purpose}` });
    consent.notify(db, t.patientId, 'request', `${req.user.name} from ${providerRow(req.user.id).organization} requested access to your health records.`, '/consent');
  }
  const prov = providerRow(req.user.id);
  res.json({
    request: {
      id: c.id, status: c.status, purpose: c.purpose, durationMin: c.durationMin,
      categories: JSON.parse(c.categories), categoryLabels: JSON.parse(c.categories).map(x => consent.CATEGORY_LABELS[x]),
      providerName: req.user.name, organization: prov.organization, specialty: prov.specialty, createdAt: c.createdAt,
    },
  });
}));

/** Provider polls the request until the patient decides. */
router.get('/request/:id/status', asyncH(async (req, res) => {
  consent.sweep(db);
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(req.params.id);
  if (!c || c.providerId !== req.user.id) throw new HttpError(404, 'NOT_FOUND', 'Request not found.');
  res.json({ request: { id: c.id, status: c.status, expiresAt: c.expiresAt, categories: JSON.parse(c.categories), purpose: c.purpose, durationMin: c.durationMin } });
}));

function snapshotFor(c, providerUserId) {
  consent.assertActiveConsent(db, c.id, providerUserId);
  const cats = JSON.parse(c.categories);
  const has = (x) => cats.includes(x) || cats.includes('history');

  const patient = db.prepare('SELECT u.name, p.dateOfBirth, p.gender, p.bloodGroup, p.location FROM Users u JOIN PatientProfiles p ON p.userId=u.id WHERE u.id=?').get(c.patientId) || { name: 'Patient' };
  const age = (() => { if (!patient.dateOfBirth) return null; const dt = new Date(patient.dateOfBirth), n = new Date(); let a = n.getFullYear() - dt.getFullYear(); if (n.getMonth() < dt.getMonth() || (n.getMonth() === dt.getMonth() && n.getDate() < dt.getDate())) a--; return a; })();

  const snap = {
    consentId: c.id,
    status: 'ACTIVE',
    expiresAt: c.expiresAt,
    purpose: c.purpose,
    categories: cats,
    categoryLabels: cats.map(x => consent.CATEGORY_LABELS[x]),
    patient: { name: patient.name, age, gender: patient.gender, bloodGroup: patient.bloodGroup },
    sections: {},
  };

  if (has('allergies')) {
    snap.sections.allergies = db.prepare('SELECT substance, reaction, severity, verified, sourceLabel, lastVerified FROM Allergies WHERE patientId=?').all(c.patientId);
  }
  if (has('medicines')) {
    snap.sections.medicines = db.prepare(`SELECT m.name, m.dosage, m.frequency, m.status, m.verified, m.lastVerified, r.title AS sourceTitle, r.provider AS sourceProvider, r.date AS sourceDate
      FROM Medicines m LEFT JOIN MedicalRecords r ON r.id=m.sourceRecordId WHERE m.patientId=? AND m.status='active'`).all(c.patientId);
  }
  if (has('conditions')) {
    snap.sections.conditions = db.prepare('SELECT name, source, lastUpdated FROM Conditions WHERE patientId=? ORDER BY lastUpdated DESC').all(c.patientId);
  }
  if (has('reports')) {
    snap.sections.reports = db.prepare(`SELECT id, title, provider, date, extraction FROM MedicalRecords WHERE patientId=? AND type='lab_report' ORDER BY date DESC LIMIT 5`).all(c.patientId)
      .map(r => ({ id: r.id, title: r.title, provider: r.provider, date: r.date, extraction: r.extraction ? JSON.parse(r.extraction) : null }));
  }

  // Documents visible under the granted categories.
  const all = db.prepare('SELECT * FROM MedicalRecords WHERE patientId=? ORDER BY date DESC LIMIT 12').all(c.patientId);
  snap.sections.documents = all.filter(r => consent.recordAllowed(r, cats)).map(r => ({
    id: r.id, title: r.title, type: r.type, provider: r.provider, date: r.date, viewable: true,
  }));
  return snap;
}

/** The consent-gated health snapshot. Backend enforces state + expiry + revocation. */
router.get('/consent/:id/snapshot', asyncH(async (req, res) => {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  const snap = snapshotFor(c, req.user.id);
  consent.log(db, { consentId: c.id, patientId: c.patientId, providerId: req.user.id, providerLabel: providerRow(req.user.id).organization, action: 'RECORDS_VIEWED', detail: 'Health snapshot opened' });
  res.json({ snapshot: snap });
}));

/** View an original document under an active consent. */
router.get('/consent/:id/document/:recordId', asyncH(async (req, res) => {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  consent.assertActiveConsent(db, c.id, req.user.id);
  const cats = JSON.parse(c.categories);
  const r = db.prepare('SELECT * FROM MedicalRecords WHERE id=? AND patientId=?').get(req.params.recordId, c.patientId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Document not found.');
  if (!consent.recordAllowed(r, cats)) throw new HttpError(403, 'NOT_IN_CONSENT', 'This document is not included in the categories the patient shared.');
  consent.log(db, { consentId: c.id, patientId: c.patientId, providerId: req.user.id, providerLabel: providerRow(req.user.id).organization, action: 'DOCUMENT_VIEWED', detail: r.title });
  res.json({ record: { ...r, extraction: r.extraction ? JSON.parse(r.extraction) : null, docPreview: r.docPreview ? JSON.parse(r.docPreview) : null } });
}));

/** Add a visit — requires an active consent session with that patient. */
router.post('/visits', asyncH(async (req, res) => {
  const { consentId, date, reason, notes, medicines, tests, followUp } = req.body || {};
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(Number(consentId));
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  consent.assertActiveConsent(db, c.id, req.user.id);
  if (!reason) throw new HttpError(400, 'BAD_REQUEST', 'Reason for visit is required.');
  const prov = providerRow(req.user.id);
  const id = db.prepare(`INSERT INTO Visits (patientId,providerId,providerName,organization,date,reason,notes,medicines,tests,followUp,createdBy,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.patientId, req.user.id, req.user.name, prov.organization, date || now(), reason, notes || null, medicines || null, tests || null, followUp || null, `provider:${req.user.id}`, now()).lastInsertRowid;
  consent.log(db, { consentId: c.id, patientId: c.patientId, providerId: req.user.id, providerLabel: prov.organization, action: 'VISIT_ADDED', detail: reason });
  consent.notify(db, c.patientId, 'visit', 'New visit added to your health record.', '/visits');
  res.json({ ok: true, visit: db.prepare('SELECT * FROM Visits WHERE id=?').get(id) });
}));

/**
 * Assisted Patient Access — for patients without a smartphone.
 * The provider identifies the patient; the device is then handed to the
 * patient, who explicitly approves on screen. Nothing is shown before approval.
 */
router.post('/assisted/init', asyncH(async (req, res) => {
  const { patientQuery, categories, purpose, durationMin } = req.body || {};
  const q = String(patientQuery || '').trim();
  if (!q) throw new HttpError(400, 'BAD_REQUEST', 'Enter the patient name or ABHA number.');
  const like = `%${q}%`;
  const matches = db.prepare(`SELECT u.id, u.name, p.abhaId, p.gender, p.dateOfBirth, p.location FROM Users u
    LEFT JOIN PatientProfiles p ON p.userId=u.id WHERE u.role='patient' AND (u.name LIKE ? OR REPLACE(COALESCE(p.abhaId,''),'-','') LIKE REPLACE(?,'-',''))`).all(like, like);
  if (!matches.length) throw new HttpError(404, 'NO_MATCH', 'No patient matched. Check the name or ABHA number.');
  res.json({ patients: matches.map(m => ({ ...m, abhaMasked: m.abhaId ? `XX-XXXX-XXXX-${String(m.abhaId).slice(-4)}` : 'Not linked' })) });
}));

router.post('/assisted/request', asyncH(async (req, res) => {
  const { patientId, categories, purpose, durationMin } = req.body || {};
  const patient = db.prepare(`SELECT * FROM Users WHERE id=? AND role='patient'`).get(Number(patientId));
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Patient not found.');
  const cats = (Array.isArray(categories) ? categories : []).filter(x => consent.ALL_CATEGORIES.includes(x));
  if (!cats.length) throw new HttpError(400, 'BAD_REQUEST', 'Select at least one category.');
  if (!['Consultation', 'Follow-up', 'Emergency Care'].includes(purpose)) throw new HttpError(400, 'BAD_REQUEST', 'Select a valid purpose.');
  const dur = Math.max(1, Math.min(7 * 24 * 60, Number(durationMin) || 60));
  const prov = providerRow(req.user.id);
  const id = db.prepare(`INSERT INTO ConsentRequests (patientId,providerId,purpose,categories,durationMin,status,mode,createdAt)
    VALUES (?,?,?,?,?, 'PENDING', 'assisted', ?)`).run(patient.id, req.user.id, purpose, JSON.stringify(cats), dur, now()).lastInsertRowid;
  consent.log(db, { consentId: id, patientId: patient.id, providerId: req.user.id, providerLabel: prov.organization, action: 'ASSISTED_REQUEST_STARTED', detail: `Purpose: ${purpose}` });
  consent.notify(db, patient.id, 'request', `${req.user.name} from ${prov.organization} started an assisted access session.`, '/consent');
  res.json({ request: { id, patientName: patient.name, status: 'PENDING', categories: cats, categoryLabels: cats.map(x => consent.CATEGORY_LABELS[x]), purpose, durationMin: dur } });
}));

/** The patient (in person) taps approval on the provider's device. */
router.post('/assisted/patient-approve', asyncH(async (req, res) => {
  const { consentId, patientConfirmed } = req.body || {};
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(Number(consentId));
  if (!c || c.mode !== 'assisted') throw new HttpError(404, 'NOT_FOUND', 'Assisted session not found.');
  if (!patientConfirmed) throw new HttpError(400, 'BAD_REQUEST', 'Patient confirmation is required.');
  const approved = consent.approve(db, c.id, c.patientId);
  res.json({ consent: { id: approved.id, status: approved.status, expiresAt: approved.expiresAt, categories: JSON.parse(approved.categories) } });
}));

/** Download the original uploaded file under an active consent. */
router.get('/consent/:id/document/:recordId/file', asyncH(async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { DATA_DIR } = require('../db');
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  consent.assertActiveConsent(db, c.id, req.user.id);
  const cats = JSON.parse(c.categories);
  const r = db.prepare('SELECT * FROM MedicalRecords WHERE id=? AND patientId=?').get(req.params.recordId, c.patientId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Document not found.');
  if (!consent.recordAllowed(r, cats)) throw new HttpError(403, 'NOT_IN_CONSENT', 'This document is not included in the categories the patient shared.');
  if (!r.fileUrl) throw new HttpError(404, 'NOT_FOUND', 'This record has no attached file.');
  const p = path.join(DATA_DIR, 'uploads', path.basename(r.fileUrl));
  if (!fs.existsSync(p)) throw new HttpError(404, 'NOT_FOUND', 'File missing on server.');
  res.setHeader('Content-Type', r.mimeType || 'application/octet-stream');
  res.sendFile(p);
}));

/**
 * Demo QR for hackathon demonstration: pre-linked to the demo patient
 * (Ravi Kumar) so the showcase never depends on manual QR generation.
 */
router.post('/demo-token', asyncH(async (req, res) => {
  const QRCode = require('qrcode');
  const patient = db.prepare(`SELECT * FROM Users WHERE email='patient@carevault.demo'`).get();
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Demo patient not found.');
  const cats = ['medicines', 'allergies', 'reports'];
  const { accessCode: mkCode } = require('../util');
  const code = mkCode();
  db.prepare(`INSERT INTO ShareTokens (code,patientId,categories,purpose,durationMin,status,expiresAt,createdAt)
    VALUES (?,?,?,?,?, 'active', ?, ?)`).run(code, patient.id, JSON.stringify(cats), 'Consultation', 60, addMinutes(30), now());
  const qrDataUrl = await QRCode.toDataURL(`CAREVAULT:${code}`, { width: 420, margin: 2, color: { dark: '#073036', light: '#FFFFFF' } });
  res.json({ code, qrDataUrl, patientName: patient.name });
}));

module.exports = { router };
