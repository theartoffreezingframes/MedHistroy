'use strict';
const express = require('express');
const { db } = require('../db');
const { hashPassword, verifyPassword, token, now, HttpError, asyncH } = require('../util');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  const out = { id: u.id, name: u.name, email: u.email, role: u.role, language: u.language };
  if (u.role === 'patient') {
    const p = db.prepare('SELECT * FROM PatientProfiles WHERE userId=?').get(u.id);
    if (p) out.profile = { abhaId: p.abhaId, abhaConnected: !!p.abhaConnected, dateOfBirth: p.dateOfBirth, gender: p.gender, bloodGroup: p.bloodGroup, location: p.location };
  }
  if (u.role === 'provider') {
    const p = db.prepare('SELECT * FROM Providers WHERE userId=?').get(u.id);
    if (p) out.provider = { organization: p.organization, specialty: p.specialty, providerType: p.providerType, registrationNumber: p.registrationNumber };
  }
  return out;
}

router.post('/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'BAD_REQUEST', 'Email and password are required.');
  const u = db.prepare('SELECT * FROM Users WHERE lower(email)=lower(?)').get(String(email).trim());
  if (!u || !verifyPassword(password, u.passwordHash)) throw new HttpError(401, 'BAD_CREDENTIALS', 'Incorrect email or password.');
  const t = token();
  db.prepare('INSERT INTO Sessions (token,userId,createdAt,expiresAt) VALUES (?,?,?,?)')
    .run(t, u.id, now(), new Date(Date.now() + 7 * 86400000).toISOString());
  res.cookie('cv_session', t, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 });
  res.json({ user: publicUser(u) });
}));

router.post('/logout', asyncH(async (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM Sessions WHERE token=?').run(req.sessionToken);
  res.clearCookie('cv_session');
  res.json({ ok: true });
}));

router.get('/me', asyncH(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
}));

router.post('/register', asyncH(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) throw new HttpError(400, 'BAD_REQUEST', 'Name, email and password are required.');
  if (String(password).length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
  const exists = db.prepare('SELECT id FROM Users WHERE lower(email)=lower(?)').get(email);
  if (exists) throw new HttpError(409, 'EXISTS', 'An account with this email already exists.');
  const id = db.prepare('INSERT INTO Users (name,email,phone,passwordHash,role,language,createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(name, email, phone || null, hashPassword(password), 'patient', 'en', now()).lastInsertRowid;
  db.prepare('INSERT INTO PatientProfiles (userId) VALUES (?)').run(id);
  const u = db.prepare('SELECT * FROM Users WHERE id=?').get(id);
  const t = token();
  db.prepare('INSERT INTO Sessions (token,userId,createdAt,expiresAt) VALUES (?,?,?,?)')
    .run(t, id, now(), new Date(Date.now() + 7 * 86400000).toISOString());
  res.cookie('cv_session', t, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 });
  res.json({ user: publicUser(u) });
}));

module.exports = { router, publicUser };
