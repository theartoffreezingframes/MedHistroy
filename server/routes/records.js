'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, DATA_DIR } = require('../db');
const ai = require('../ai');
const { now, HttpError, asyncH, fmtDate } = require('../util');

const router = express.Router();
router.use((req, res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please log in.');
  next();
});

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^application\/pdf$|^image\/(png|jpe?g)$/.test(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'UNSUPPORTED', 'Supported formats: PDF, JPG, JPEG, PNG.'));
  },
});

const TYPE_LABEL = { prescription: 'Prescription', lab_report: 'Lab Report', hospital_record: 'Hospital Record', discharge_summary: 'Discharge Summary', other: 'Other' };

function requireRecordOwner(req, patientOnly = true) {
  const r = db.prepare('SELECT * FROM MedicalRecords WHERE id=?').get(req.params.id);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
  if (patientOnly && r.patientId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to view this record.');
  return r;
}

router.post('/upload', (req, res, next) => {
  if (req.user.role !== 'patient') return next(new HttpError(403, 'FORBIDDEN', 'Only patients can upload records.'));
  upload.single('file')(req, res, (err) => {
    if (err) return next(err instanceof HttpError ? err : new HttpError(400, 'UPLOAD', err.message || 'Upload failed.'));
    try {
      if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded.');
      const { title, type, provider, date } = req.body || {};
      const recType = TYPE_LABEL[type] ? type : 'other';
      const id = db.prepare(`INSERT INTO MedicalRecords (patientId,type,title,provider,date,fileUrl,mimeType,originalName,processingStatus,createdAt)
        VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`)
        .run(req.user.id, recType, title || req.file.originalname, provider || null, date || now(),
          `/files/${req.file.filename}`, req.file.mimetype, req.file.originalname, now()).lastInsertRowid;
      res.json({ record: db.prepare('SELECT * FROM MedicalRecords WHERE id=?').get(id) });
    } catch (e) { next(e); }
  });
});

router.post('/manual', asyncH(async (req, res) => {
  if (req.user.role !== 'patient') throw new HttpError(403, 'FORBIDDEN', 'Only patients can add records.');
  const { title, type, provider, date, notes } = req.body || {};
  if (!title) throw new HttpError(400, 'BAD_REQUEST', 'A document title is required.');
  const recType = TYPE_LABEL[type] ? type : 'other';
  const preview = { kind: 'note', org: provider || 'CareVault manual entry', patient: 'Patient record', date: fmtDate(date || now()), body: notes || 'Manually added record.', manual: true };
  const id = db.prepare(`INSERT INTO MedicalRecords (patientId,type,title,provider,date,synthetic,docPreview,processingStatus,extractionStatus,createdAt)
    VALUES (?,?,?,?,?,1,?, 'processed','manual', ?)`)
    .run(req.user.id, recType, title, provider || null, date || now(), JSON.stringify(preview), now()).lastInsertRowid;
  res.json({ record: db.prepare('SELECT * FROM MedicalRecords WHERE id=?').get(id) });
}));

/** Run (mock) AI extraction. In production this would call the document-intelligence service. */
router.post('/process', asyncH(async (req, res) => {
  const { recordId, fileName } = req.body || {};
  const r = db.prepare('SELECT * FROM MedicalRecords WHERE id=?').get(recordId);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
  if (r.patientId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You are not authorized to process this record.');
  db.prepare(`UPDATE MedicalRecords SET processingStatus='processing' WHERE id=?`).run(r.id);
  const extraction = ai.extract(r, fileName || r.originalName || r.title);
  db.prepare(`UPDATE MedicalRecords SET processingStatus='processed', extraction=?, extractionStatus='ai_extracted' WHERE id=?`)
    .run(JSON.stringify(extraction), r.id);
  const { notify } = require('../consent');
  notify(db, r.patientId, 'document', `Your document "${r.title}" has been processed and is ready for verification.`, '/records');
  res.json({ recordId: r.id, extraction });
}));

/** Confirm / edit / reject AI-extracted information. */
router.post('/:id/verify', asyncH(async (req, res) => {
  const r = requireRecordOwner(req);
  const { action, extraction } = req.body || {};
  if (!['confirm', 'edit', 'reject'].includes(action)) throw new HttpError(400, 'BAD_REQUEST', 'action must be confirm|edit|reject.');
  if (action === 'reject') {
    db.prepare(`UPDATE MedicalRecords SET extractionStatus='rejected', processingStatus='rejected' WHERE id=?`).run(r.id);
    return res.json({ ok: true, extractionStatus: 'rejected' });
  }
  const finalExtraction = action === 'edit' && extraction ? extraction : (r.extraction ? JSON.parse(r.extraction) : null);
  if (!finalExtraction) throw new HttpError(400, 'BAD_REQUEST', 'No extraction available.');
  if (action === 'edit') db.prepare('UPDATE MedicalRecords SET extraction=? WHERE id=?').run(JSON.stringify(finalExtraction), r.id);
  const added = ai.applyExtraction(db, r, finalExtraction, { confirmedByPatient: true });
  db.prepare(`UPDATE MedicalRecords SET extractionStatus='patient_verified' WHERE id=?`).run(r.id);
  res.json({ ok: true, extractionStatus: 'patient_verified', applied: added });
}));

router.get('/', asyncH(async (req, res) => {
  if (req.user.role !== 'patient') throw new HttpError(403, 'FORBIDDEN', 'Forbidden.');
  const { type, q } = req.query;
  let rows = db.prepare('SELECT * FROM MedicalRecords WHERE patientId=? ORDER BY date DESC, id DESC').all(req.user.id);
  if (type && type !== 'all') rows = rows.filter(r => r.type === type);
  if (q) {
    const like = String(q).toLowerCase();
    rows = rows.filter(r => (r.title + (r.provider || '')).toLowerCase().includes(like));
  }
  res.json({ records: rows.map(r => ({ ...r, extraction: r.extraction ? JSON.parse(r.extraction) : null })) });
}));

router.get('/:id', asyncH(async (req, res) => {
  const r = requireRecordOwner(req);
  res.json({ record: { ...r, extraction: r.extraction ? JSON.parse(r.extraction) : null, docPreview: r.docPreview ? JSON.parse(r.docPreview) : null } });
}));

/** Original file (uploaded PDF/image). Owner only; providers use the consent-gated document route. */
router.get('/:id/file', asyncH(async (req, res) => {
  const r = requireRecordOwner(req);
  if (!r.fileUrl) return res.json({ synthetic: true });
  const p = path.join(DATA_DIR, r.fileUrl.replace(/^\/files/, 'uploads'));
  if (!fs.existsSync(p)) throw new HttpError(404, 'NOT_FOUND', 'File missing on server.');
  res.setHeader('Content-Type', r.mimeType || 'application/octet-stream');
  res.sendFile(p);
}));

router.delete('/:id', asyncH(async (req, res) => {
  const r = requireRecordOwner(req);
  if (r.fileUrl) {
    const p = path.join(DATA_DIR, r.fileUrl.replace(/^\/files/, 'uploads'));
    fs.promises.unlink(p).catch(() => {});
  }
  db.prepare('UPDATE Medicines SET sourceRecordId=NULL WHERE sourceRecordId=?').run(r.id);
  db.prepare('UPDATE Allergies SET sourceRecordId=NULL WHERE sourceRecordId=?').run(r.id);
  db.prepare('UPDATE Conditions SET sourceRecordId=NULL WHERE sourceRecordId=?').run(r.id);
  db.prepare('DELETE FROM MedicalRecords WHERE id=?').run(r.id);
  res.json({ ok: true });
}));

module.exports = { router };
