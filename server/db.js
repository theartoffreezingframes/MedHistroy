'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'carevault.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS Users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient','provider','admin')),
  language TEXT NOT NULL DEFAULT 'en',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS PatientProfiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER UNIQUE NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  abhaId TEXT,
  abhaConnected INTEGER NOT NULL DEFAULT 0,
  dateOfBirth TEXT,
  gender TEXT,
  bloodGroup TEXT,
  location TEXT,
  language TEXT NOT NULL DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS Providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER UNIQUE NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  organization TEXT NOT NULL,
  registrationNumber TEXT,
  specialty TEXT,
  providerType TEXT NOT NULL DEFAULT 'clinic'
);

CREATE TABLE IF NOT EXISTS MedicalRecords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  provider TEXT,
  date TEXT,
  fileUrl TEXT,
  mimeType TEXT,
  originalName TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0,
  docPreview TEXT,
  processingStatus TEXT NOT NULL DEFAULT 'pending',
  extraction TEXT,
  extractionStatus TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  duration TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  verified INTEGER NOT NULL DEFAULT 0,
  sourceRecordId INTEGER,
  startDate TEXT,
  endDate TEXT,
  lastVerified TEXT
);

CREATE TABLE IF NOT EXISTS Allergies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  substance TEXT NOT NULL,
  reaction TEXT,
  severity TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  sourceLabel TEXT,
  sourceRecordId INTEGER,
  lastVerified TEXT
);

CREATE TABLE IF NOT EXISTS Conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT,
  sourceRecordId INTEGER,
  verified INTEGER NOT NULL DEFAULT 1,
  lastUpdated TEXT
);

CREATE TABLE IF NOT EXISTS Visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  providerId INTEGER,
  providerName TEXT,
  organization TEXT,
  date TEXT NOT NULL,
  reason TEXT,
  notes TEXT,
  medicines TEXT,
  tests TEXT,
  followUp TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ConsentRequests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  providerId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  shareTokenId INTEGER,
  purpose TEXT NOT NULL,
  categories TEXT NOT NULL,
  durationMin INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  mode TEXT NOT NULL DEFAULT 'qr',
  warnedAt TEXT,
  createdAt TEXT NOT NULL,
  decidedAt TEXT,
  expiresAt TEXT,
  revokedAt TEXT
);

CREATE TABLE IF NOT EXISTS ShareTokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  categories TEXT NOT NULL,
  purpose TEXT NOT NULL,
  durationMin INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AccessLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consentId INTEGER,
  patientId INTEGER NOT NULL,
  providerId INTEGER,
  providerLabel TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Sessions (
  token TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS GeneratedSummaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patientId INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_patient ON MedicalRecords(patientId);
CREATE INDEX IF NOT EXISTS idx_consent_patient ON ConsentRequests(patientId);
CREATE INDEX IF NOT EXISTS idx_consent_provider ON ConsentRequests(providerId);
CREATE INDEX IF NOT EXISTS idx_logs_patient ON AccessLogs(patientId);
CREATE INDEX IF NOT EXISTS idx_notif_user ON Notifications(userId, read);
`;

db.exec(SCHEMA);
try { db.exec('ALTER TABLE ConsentRequests ADD COLUMN warnedAt TEXT'); } catch {}

function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS c FROM Users').get().c === 0;
}

module.exports = { db, DATA_DIR, isEmpty };
