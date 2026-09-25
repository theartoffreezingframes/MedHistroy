'use strict';
const crypto = require('crypto');

/** Hash a password with scrypt. Format: scrypt$<salt>$<hash> */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch { return false; }
}

function token(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

/** Short human-friendly access code, e.g. "K7QX-3M9F" */
function accessCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const rnd = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += alphabet[rnd[i] % alphabet.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}

const now = () => new Date().toISOString();
const iso = (d) => new Date(d).toISOString();
const addMinutes = (mins, from = new Date()) => new Date(from.getTime() + mins * 60000).toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob), t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
  return a;
}

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function asyncH(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { hashPassword, verifyPassword, token, accessCode, now, iso, addMinutes, daysAgo, fmtDate, ageFromDob, HttpError, asyncH };
