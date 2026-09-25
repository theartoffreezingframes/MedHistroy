'use strict';
/**
 * Consent engine — a real backend state machine.
 *
 *   PENDING ──approve──▶ ACTIVE ──┬──expire──▶ EXPIRED
 *      │                          └──revoke──▶ REVOKED
 *      └──reject──▶ REJECTED
 *
 * Provider data endpoints MUST call assertActiveConsent(); the backend, not
 * the UI, blocks access after expiry or revocation.
 */
const { now, HttpError } = require('./util');

const CATEGORY_LABELS = {
  medicines: 'Medicines',
  allergies: 'Allergies',
  reports: 'Recent Reports',
  conditions: 'Conditions',
  history: 'Full Medical History',
};
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

function log(db, { consentId, patientId, providerId, providerLabel, action, detail }) {
  db.prepare(`INSERT INTO AccessLogs (consentId, patientId, providerId, providerLabel, action, detail, timestamp)
    VALUES (?,?,?,?,?,?,?)`).run(consentId || null, patientId, providerId || null, providerLabel || null, action, detail || null, now());
}

function notify(db, userId, type, message, link) {
  db.prepare('INSERT INTO Notifications (userId, type, message, link, read, createdAt) VALUES (?,?,?,?,' + '0,?)')
    .run(userId, type, message, link || null, now());
}

/** Sweep expired consents; emit notifications (incl. 10-minute warning). */
function sweep(db) {
  const t = now();
  const expired = db.prepare(`SELECT c.*, u.name AS providerName, p.organization FROM ConsentRequests c
    JOIN Users u ON u.id = c.providerId JOIN Providers p ON p.userId = c.providerId
    WHERE c.status='ACTIVE' AND c.expiresAt <= ?`).all(t);
  for (const c of expired) {
    db.prepare(`UPDATE ConsentRequests SET status='EXPIRED' WHERE id=?`).run(c.id);
    log(db, { consentId: c.id, patientId: c.patientId, providerId: c.providerId, providerLabel: c.organization, action: 'ACCESS_EXPIRED' });
    notify(db, c.patientId, 'expiry', `Consent session for ${c.organization} has expired.`, '/consent');
    notify(db, c.providerId, 'expiry', `Your access to the patient's record has expired.`, null);
  }
  const warning = db.prepare(`SELECT c.*, p.organization FROM ConsentRequests c
    JOIN Providers p ON p.userId = c.providerId
    WHERE c.status='ACTIVE' AND c.expiresAt > ? AND c.expiresAt <= ? AND COALESCE(c.warnedAt,0)=0`).all(t, new Date(Date.now() + 10 * 60000).toISOString());
  for (const c of warning) {
    db.prepare('UPDATE ConsentRequests SET warnedAt=? WHERE id=?').run(t, c.id);
    notify(db, c.patientId, 'warning', `Your consent for ${c.organization} expires in 10 minutes.`, '/consent');
  }
  return { expired: expired.length, warnings: warning.length };
}

/** Enforce an active consent owned by `providerUserId`. Returns the consent row. */
function assertActiveConsent(db, consentId, providerUserId) {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  if (c.providerId !== providerUserId) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this record.');
  if (c.status === 'REVOKED') throw new HttpError(403, 'REVOKED', 'The patient has revoked access.');
  if (c.status === 'REJECTED') throw new HttpError(403, 'REJECTED', 'The patient rejected this access request.');
  if (c.status === 'PENDING') throw new HttpError(409, 'PENDING', 'Waiting for patient consent.');
  if (c.status === 'EXPIRED' || c.expiresAt <= now()) {
    if (c.status === 'ACTIVE') db.prepare(`UPDATE ConsentRequests SET status='EXPIRED' WHERE id=?`).run(c.id);
    throw new HttpError(410, 'EXPIRED', 'This consent session has expired.');
  }
  return c;
}

/** Which record types are visible under which category. */
function recordAllowed(record, categories) {
  if (categories.includes('history')) return true;
  switch (record.type) {
    case 'lab_report': return categories.includes('reports');
    case 'prescription': return categories.includes('medicines');
    case 'discharge_summary':
    case 'hospital_record':
    default: return categories.includes('history');
  }
}

function approve(db, consentId, patientUserId) {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Access request not found.');
  if (c.patientId !== patientUserId) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to act on this request.');
  if (c.status !== 'PENDING') throw new HttpError(409, 'CONFLICT', `This request is already ${c.status.toLowerCase()}.`);
  const durationMin = c.durationMin;
  const expiresAt = new Date(Date.now() + durationMin * 60000).toISOString();
  db.prepare(`UPDATE ConsentRequests SET status='ACTIVE', decidedAt=?, expiresAt=? WHERE id=?`).run(now(), expiresAt, consentId);
  const prov = db.prepare(`SELECT u.name, p.organization FROM Users u JOIN Providers p ON p.userId=u.id WHERE u.id=?`).get(c.providerId);
  log(db, { consentId, patientId: c.patientId, providerId: c.providerId, providerLabel: prov.organization, action: 'ACCESS_GRANTED', detail: `Duration ${durationMin} min` });
  notify(db, c.providerId, 'granted', `The patient granted your access request (${prov.organization}).`, null);
  notify(db, c.patientId, 'granted', `You granted ${prov.organization} access for ${durationMin} minutes.`, '/consent');
  return db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
}

function reject(db, consentId, patientUserId) {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Access request not found.');
  if (c.patientId !== patientUserId) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to act on this request.');
  if (c.status !== 'PENDING') throw new HttpError(409, 'CONFLICT', `This request is already ${c.status.toLowerCase()}.`);
  db.prepare(`UPDATE ConsentRequests SET status='REJECTED', decidedAt=? WHERE id=?`).run(now(), consentId);
  const prov = db.prepare(`SELECT u.name, p.organization FROM Users u JOIN Providers p ON p.userId=u.id WHERE u.id=?`).get(c.providerId);
  log(db, { consentId, patientId: c.patientId, providerId: c.providerId, providerLabel: prov.organization, action: 'ACCESS_REJECTED' });
  notify(db, c.providerId, 'rejected', 'The patient rejected your access request.', null);
  return db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
}

function revoke(db, consentId, patientUserId) {
  const c = db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Consent session not found.');
  if (c.patientId !== patientUserId) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to act on this consent.');
  if (c.status !== 'ACTIVE') throw new HttpError(409, 'CONFLICT', 'Only an active consent session can be revoked.');
  db.prepare(`UPDATE ConsentRequests SET status='REVOKED', revokedAt=? WHERE id=?`).run(now(), consentId);
  const prov = db.prepare(`SELECT u.name, p.organization FROM Users u JOIN Providers p ON p.userId=u.id WHERE u.id=?`).get(c.providerId);
  log(db, { consentId, patientId: c.patientId, providerId: c.providerId, providerLabel: prov.organization, action: 'ACCESS_REVOKED' });
  notify(db, c.providerId, 'revoked', 'The patient revoked access. Protected information is no longer available.', null);
  notify(db, c.patientId, 'revoked', `Access for ${prov.organization} was revoked.`, '/consent');
  return db.prepare('SELECT * FROM ConsentRequests WHERE id=?').get(consentId);
}

module.exports = { CATEGORY_LABELS, ALL_CATEGORIES, log, notify, sweep, assertActiveConsent, recordAllowed, approve, reject, revoke };
