'use strict';
const express = require('express');
const QRCode = require('qrcode');
const { db } = require('../db');
const consent = require('../consent');
const { now, addMinutes, accessCode, HttpError, asyncH } = require('../util');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please log in.');
  if (req.user.role !== 'patient') throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this record.');
  next();
});

const enrich = (c) => {
  const prov = db.prepare('SELECT u.name AS providerName, p.organization, p.specialty FROM Users u JOIN Providers p ON p.userId=u.id WHERE u.id=?').get(c.providerId);
  return { ...c, categories: JSON.parse(c.categories), provider: prov };
};

/** Generate a temporary share token + QR. The QR contains ONLY an opaque code — never health data. */
router.post('/share-token', asyncH(async (req, res) => {
  const { categories, purpose, durationMin } = req.body || {};
  const cats = Array.isArray(categories) ? categories.filter(c => consent.ALL_CATEGORIES.includes(c)) : [];
  if (!cats.length) throw new HttpError(400, 'BAD_REQUEST', 'Select at least one category to share.');
  if (!['Consultation', 'Follow-up', 'Emergency Care'].includes(purpose)) throw new HttpError(400, 'BAD_REQUEST', 'Select a valid purpose.');
  const dur = Math.max(1, Math.min(7 * 24 * 60, Number(durationMin) || 60));
  // Cancel previous unscanned tokens (one live QR at a time keeps the demo clear).
  db.prepare(`UPDATE ShareTokens SET status='cancelled' WHERE patientId=? AND status='active'`).run(req.user.id);
  const code = accessCode();
  const id = db.prepare(`INSERT INTO ShareTokens (code,patientId,categories,purpose,durationMin,status,expiresAt,createdAt)
    VALUES (?,?,?,?,?, 'active', ?, ?)`).run(code, req.user.id, JSON.stringify(cats), purpose, dur, addMinutes(30), now()).lastInsertRowid;
  const qrPayload = `CAREVAULT:${code}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 520, margin: 2, color: { dark: '#062F33', light: '#FFFFFF' } });
  consent.log(db, { patientId: req.user.id, action: 'QR_GENERATED', detail: `${purpose} · ${cats.join(', ')} · ${dur} min` });
  res.json({ share: { id, code, payload: qrPayload, qrDataUrl, categories: cats, categoryLabels: cats.map(c => consent.CATEGORY_LABELS[c]), purpose, durationMin: dur, expiresAt: addMinutes(30), status: 'active' } });
}));

router.delete('/share-token/:code', asyncH(async (req, res) => {
  const t = db.prepare('SELECT * FROM ShareTokens WHERE code=?').get(req.params.code);
  if (!t || t.patientId !== req.user.id) throw new HttpError(404, 'NOT_FOUND', 'Share session not found.');
  db.prepare(`UPDATE ShareTokens SET status='cancelled' WHERE id=?`).run(t.id);
  res.json({ ok: true });
}));

// Pending requests the patient must decide on.
router.get('/pending', asyncH(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM ConsentRequests WHERE patientId=? AND status='PENDING' ORDER BY id DESC`).all(req.user.id).map(enrich);
  res.json({ requests: rows });
}));

router.get('/active', asyncH(async (req, res) => {
  consent.sweep(db);
  const rows = db.prepare(`SELECT * FROM ConsentRequests WHERE patientId=? AND status='ACTIVE' ORDER BY id DESC`).all(req.user.id).map(enrich);
  res.json({ consents: rows });
}));

router.get('/history', asyncH(async (req, res) => {
  consent.sweep(db);
  const rows = db.prepare(`SELECT * FROM ConsentRequests WHERE patientId=? ORDER BY id DESC LIMIT 50`).all(req.user.id).map(enrich);
  res.json({ consents: rows });
}));

router.post('/approve', asyncH(async (req, res) => {
  const c = consent.approve(db, Number(req.body.consentId), req.user.id);
  res.json({ consent: enrich(c) });
}));

router.post('/reject', asyncH(async (req, res) => {
  const c = consent.reject(db, Number(req.body.consentId), req.user.id);
  res.json({ consent: enrich(c) });
}));

router.post('/revoke', asyncH(async (req, res) => {
  const c = consent.revoke(db, Number(req.body.consentId), req.user.id);
  res.json({ consent: enrich(c) });
}));

router.get('/access-logs', asyncH(async (req, res) => {
  const rows = db.prepare('SELECT * FROM AccessLogs WHERE patientId=? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ logs: rows });
}));

module.exports = { router };
