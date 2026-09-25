'use strict';
const express = require('express');
const { db } = require('../db');
const { now, HttpError, asyncH } = require('../util');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please log in.');
  if (req.user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this page.');
  next();
});

/**
 * Operational statistics only. Admins never get patient medical content from
 * this API — record counts and consent metrics are operational data, not
 * clinical data.
 */
router.get('/stats', asyncH(async (req, res) => {
  const g = (sql, ...a) => db.prepare(sql).get(...a).c;
  res.json({
    demoData: true,
    platformStats: {
      registeredPatients: 1284,
      registeredProviders: 146,
      recordsProcessed: 4892,
    },
    live: {
      patients: g(`SELECT COUNT(*) c FROM Users WHERE role='patient'`),
      providers: g(`SELECT COUNT(*) c FROM Users WHERE role='provider'`),
      activeConsents: g(`SELECT COUNT(*) c FROM ConsentRequests WHERE status='ACTIVE' AND expiresAt>?`, now()),
      revokedSessions: g(`SELECT COUNT(*) c FROM ConsentRequests WHERE status='REVOKED'`),
      expiredSessions: g(`SELECT COUNT(*) c FROM ConsentRequests WHERE status='EXPIRED'`),
      records: g('SELECT COUNT(*) c FROM MedicalRecords'),
      accessLogEntries: g('SELECT COUNT(*) c FROM AccessLogs'),
    },
    recentConsents: db.prepare(`SELECT c.id, c.purpose, c.status, c.createdAt, c.expiresAt, pu.name AS patientName, COALESCE(pr.organization,'Provider') AS organization
      FROM ConsentRequests c JOIN Users pu ON pu.id=c.patientId JOIN Users po ON po.id=c.providerId
      LEFT JOIN Providers pr ON pr.userId=c.providerId ORDER BY c.id DESC LIMIT 8`)
      .all().map(r => ({ ...r, patientName: r.patientName.split(' ')[0] + ' ***' })), // pseudonymized
  });
}));

router.get('/users', asyncH(async (req, res) => {
  const users = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.createdAt, COALESCE(p.organization,'') org
    FROM Users u LEFT JOIN Providers p ON p.userId=u.id ORDER BY u.role, u.name`).all();
  res.json({ users });
}));

module.exports = { router };
