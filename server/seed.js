'use strict';
/** Seed CareVault with fictional demo data (clearly labelled demo throughout the UI). */
const { db } = require('./db');
const { hashPassword, now, daysAgo, iso } = require('./util');

const d = (isoDate) => new Date(isoDate + 'T09:30:00').toISOString();

function seed(force = false) {
  if (force) {
    db.exec(`DELETE FROM AccessLogs; DELETE FROM Notifications; DELETE FROM ConsentRequests; DELETE FROM ShareTokens;
      DELETE FROM GeneratedSummaries; DELETE FROM Visits; DELETE FROM Conditions; DELETE FROM Allergies;
      DELETE FROM Medicines; DELETE FROM MedicalRecords; DELETE FROM Providers; DELETE FROM PatientProfiles;
      DELETE FROM Sessions; DELETE FROM Users;`);
  }
  const users = db.prepare('SELECT COUNT(*) c FROM Users').get().c;
  if (users > 0) return { seeded: false };

  const ts = now();
  const PW = hashPassword('Demo123!');
  const insUser = db.prepare('INSERT INTO Users (name,email,phone,passwordHash,role,language,createdAt) VALUES (?,?,?,?,?,?,?)');
  const insProfile = db.prepare('INSERT INTO PatientProfiles (userId,abhaId,abhaConnected,dateOfBirth,gender,bloodGroup,location,language) VALUES (?,?,?,?,?,?,?,?)');
  const insProvider = db.prepare('INSERT INTO Providers (userId,organization,registrationNumber,specialty,providerType) VALUES (?,?,?,?,?)');

  // ---------- Users ----------
  const ravi = insUser.run('Ravi Kumar', 'patient@carevault.demo', '+91 98450 12345', PW, 'patient', 'en', daysAgo(220)).lastInsertRowid;
  const priya = insUser.run('Priya Sharma', 'priya@carevault.demo', '+91 98123 45670', PW, 'patient', 'en', daysAgo(180)).lastInsertRowid;
  const arjun = insUser.run('Arjun Rao', 'arjun@carevault.demo', '+91 99887 66554', PW, 'patient', 'en', daysAgo(160)).lastInsertRowid;
  const meena = insUser.run('Meena Devi', 'meena@carevault.demo', '+91 91234 77880', PW, 'patient', 'en', daysAgo(140)).lastInsertRowid;

  const ananyaUser = insUser.run('Dr. Ananya Sharma', 'doctor@carevault.demo', '+91 98765 43210', PW, 'provider', 'en', daysAgo(300)).lastInsertRowid;
  const rahulUser = insUser.run('Dr. Rahul Verma', 'dr.rahul@carevault.demo', '+91 98220 11223', PW, 'provider', 'en', daysAgo(280)).lastInsertRowid;
  const diagUser = insUser.run('ABC Diagnostics Staff', 'labs@carevault.demo', '+91 90000 55511', PW, 'provider', 'en', daysAgo(260)).lastInsertRowid;

  const admin = insUser.run('CareVault Admin', 'admin@carevault.demo', '+91 90000 00001', PW, 'admin', 'en', daysAgo(400)).lastInsertRowid;

  // ---------- Profiles & providers ----------
  // Demo ABHA identifier (fictional).
  insProfile.run(ravi, 'XX-XXXX-XXXX-1234', 1, '1984-03-12', 'Male', 'B+', 'Hyderabad', 'en');
  insProfile.run(priya, null, 0, '1997-07-22', 'Female', 'O+', 'Bengaluru', 'en');
  insProfile.run(arjun, null, 0, '1970-01-30', 'Male', 'A+', 'Vijayawada', 'en');
  insProfile.run(meena, null, 0, '1963-11-05', 'Female', 'B-', 'Hyderabad', 'te');

  const ananya = insProvider.run(ananyaUser, 'ABC Primary Care Clinic', 'KA-2019-004312', 'General Medicine', 'clinic').lastInsertRowid;
  const rahul = insProvider.run(rahulUser, 'District Hospital', 'TS-2011-088456', 'Internal Medicine', 'hospital').lastInsertRowid;
  const diag = insProvider.run(diagUser, 'ABC Diagnostics', 'TS-LAB-2020-1177', 'Diagnostic Center', 'diagnostic').lastInsertRowid;

  // ---------- Records (Ravi — 7) ----------
  const insRec = db.prepare(`INSERT INTO MedicalRecords
    (patientId,type,title,provider,date,fileUrl,mimeType,originalName,synthetic,docPreview,processingStatus,extraction,extractionStatus,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const R = (patientId, type, title, provider, date, preview, extraction, status = 'verified', extractionStatus = 'patient_verified', createdDaysAgo = 20) =>
    insRec.run(patientId, type, title, provider, d(date), null, null, null, 1, JSON.stringify(preview), status,
      extraction ? JSON.stringify(extraction) : null, extractionStatus, daysAgo(createdDaysAgo)).lastInsertRowid;

  const rec_rx1 = R(ravi, 'prescription', 'Prescription — Metformin & Amlodipine', 'ABC Primary Care Clinic', '2026-09-10', {
    kind: 'prescription', org: 'ABC Primary Care Clinic', doctor: 'Dr. Ananya Sharma', reg: 'KA-2019-004312',
    patient: 'Ravi Kumar, 42/M', date: '10 Sept 2026',
    meds: [
      { name: 'Metformin', dose: '500 mg', freq: 'Twice daily', duration: '30 days' },
      { name: 'Amlodipine', dose: '5 mg', freq: 'Once daily', duration: '30 days' },
    ],
    advice: 'Low-salt diet. 30-minute walk daily. Review after 30 days with HbA1c report.',
  }, { engine: 'demo-mock', confidence: 0.94, medicines: [
      { name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily', duration: '30 days' },
      { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', duration: '30 days' }],
    doctor: 'Dr. Ananya Sharma', date: '2026-09-10', provider: 'ABC Primary Care Clinic' }, 'verified', 'patient_verified', 15);

  const rec_hba1c = R(ravi, 'lab_report', 'HbA1c Report', 'ABC Diagnostics', '2026-09-15', {
    kind: 'lab', org: 'ABC Diagnostics', patient: 'Ravi Kumar, 42/M', date: '15 Sept 2026',
    items: [
      { test: 'HbA1c (Glycated Hemoglobin)', result: '7.2', unit: '%', range: '4.0 – 5.6 (normal); < 7.0 (diabetic target)' },
      { test: 'Average Blood Glucose', result: '154', unit: 'mg/dL', range: '—' },
    ], signed: 'Dr. Meera Krishnan, MD Pathology',
  }, { engine: 'demo-mock', confidence: 0.97, tests: [{ test: 'HbA1c', result: '7.2', unit: '%', interpretation: 'Above diabetic target of 7.0%' }], date: '2026-09-15', provider: 'ABC Diagnostics' }, 'verified', 'patient_verified', 10);

  const rec_cbc = R(ravi, 'lab_report', 'CBC Report', 'District Hospital', '2026-09-10', {
    kind: 'lab', org: 'District Hospital Laboratory', patient: 'Ravi Kumar, 42/M', date: '10 Sept 2026',
    items: [
      { test: 'Hemoglobin', result: '13.6', unit: 'g/dL', range: '13.0 – 17.0' },
      { test: 'WBC Count', result: '7,400', unit: '/µL', range: '4,000 – 11,000' },
      { test: 'Platelet Count', result: '245,000', unit: '/µL', range: '150,000 – 410,000' },
    ], signed: 'Lab Officer, District Hospital',
  }, { engine: 'demo-mock', confidence: 0.95, tests: [{ test: 'Complete Blood Count (CBC)', result: 'All parameters within normal range', unit: '', interpretation: 'Normal study' }], date: '2026-09-10', provider: 'District Hospital' }, 'verified', 'patient_verified', 15);

  const rec_discharge = R(ravi, 'discharge_summary', 'Discharge Summary — Hypertension Review', 'District Hospital', '2026-08-20', {
    kind: 'discharge', org: 'District Hospital', patient: 'Ravi Kumar, 42/M', date: '20 Aug 2026',
    diagnosis: 'Uncontrolled hypertension; Type 2 Diabetes Mellitus',
    treatment: 'Observed under Internal Medicine for 1 day. BP stabilized on oral therapy.',
    meds: [
      { name: 'Amlodipine', dose: '5 mg', freq: 'Once daily', duration: 'Continue' },
      { name: 'Metformin', dose: '500 mg', freq: 'Twice daily', duration: 'Continue' },
    ],
    advice: 'Daily BP monitoring. Follow-up in Internal Medicine OPD after 3 weeks.',
  }, { engine: 'demo-mock', confidence: 0.91, diagnoses: ['Hypertension', 'Type 2 Diabetes'], medicines: [
      { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', duration: 'Continue' }],
    doctor: 'Dr. Rahul Verma', date: '2026-08-20', provider: 'District Hospital' }, 'verified', 'patient_verified', 36);

  const rec_lipid = R(ravi, 'lab_report', 'Lipid Profile Report', 'ABC Diagnostics', '2026-08-22', {
    kind: 'lab', org: 'ABC Diagnostics', patient: 'Ravi Kumar, 42/M', date: '22 Aug 2026',
    items: [
      { test: 'Total Cholesterol', result: '182', unit: 'mg/dL', range: '< 200' },
      { test: 'LDL Cholesterol', result: '112', unit: 'mg/dL', range: '< 130' },
      { test: 'Triglycerides', result: '148', unit: 'mg/dL', range: '< 150' },
    ], signed: 'Dr. Meera Krishnan, MD Pathology',
  }, { engine: 'demo-mock', confidence: 0.93, tests: [{ test: 'Lipid Profile', result: 'Within acceptable limits', unit: '', interpretation: 'Borderline triglycerides' }], date: '2026-08-22', provider: 'ABC Diagnostics' }, 'processed', 'ai_extracted', 34);

  const rec_opd = R(ravi, 'hospital_record', 'OPD Consultation Note', 'ABC Primary Care Clinic', '2026-07-28', {
    kind: 'note', org: 'ABC Primary Care Clinic', doctor: 'Dr. Ananya Sharma', patient: 'Ravi Kumar, 42/M', date: '28 Jul 2026',
    body: 'Patient reports improved compliance with medicines. BP 138/88 mmHg. Fasting glucose 112 mg/dL. Advised lifestyle modification and HbA1c after 6 weeks.',
  }, { engine: 'demo-mock', confidence: 0.84, diagnoses: ['Type 2 Diabetes review'], doctor: 'Dr. Ananya Sharma', date: '2026-07-28', provider: 'ABC Primary Care Clinic' }, 'processed', 'ai_extracted', 59);

  R(ravi, 'other', 'Fundus Examination Report', 'District Hospital', '2026-06-30', {
    kind: 'note', org: 'District Hospital — Ophthalmology', doctor: 'Dr. S. Reddy', patient: 'Ravi Kumar, 42/M', date: '30 Jun 2026',
    body: 'Fundus examination: No evidence of diabetic retinopathy. Advised annual review.',
  }, { engine: 'demo-mock', confidence: 0.8, notes: ['Ophthalmology note'], date: '2026-06-30', provider: 'District Hospital' }, 'processed', 'ai_extracted', 87);

  // ---------- Records (Priya / Arjun / Meena) ----------
  R(priya, 'lab_report', 'Pulmonary Function Test', 'City Lung Clinic', '2026-09-05', {
    kind: 'lab', org: 'City Lung Clinic', patient: 'Priya Sharma, 29/F', date: '05 Sept 2026',
    items: [{ test: 'FEV1', result: '86', unit: '% predicted', range: '> 80%' }, { test: 'FEV1/FVC', result: '0.74', unit: '', range: '> 0.70' }],
    signed: 'Dr. Nikhil Menon, Pulmonologist',
  }, { engine: 'demo-mock', confidence: 0.9, tests: [{ test: 'Spirometry', result: 'Mild obstructive pattern, improved with bronchodilator', unit: '', interpretation: 'Consistent with asthma' }], date: '2026-09-05', provider: 'City Lung Clinic' }, 'verified', 'patient_verified', 20);

  const priyaRx = R(priya, 'prescription', 'Asthma Prescription', 'City Lung Clinic', '2026-09-05', {
    kind: 'prescription', org: 'City Lung Clinic', doctor: 'Dr. Nikhil Menon', reg: 'KA-2016-77821', patient: 'Priya Sharma, 29/F', date: '05 Sept 2026',
    meds: [{ name: 'Salbutamol Inhaler', dose: '100 mcg', freq: 'As needed (max 4/day)', duration: '90 days' }],
    advice: 'Rinse mouth after use. Carry inhaler at all times.',
  }, { engine: 'demo-mock', confidence: 0.92, medicines: [{ name: 'Salbutamol Inhaler', dosage: '100 mcg', frequency: 'As needed', duration: '90 days' }], doctor: 'Dr. Nikhil Menon', date: '2026-09-05', provider: 'City Lung Clinic' }, 'verified', 'patient_verified', 20);

  R(priya, 'other', 'Follow-up Note', 'City Lung Clinic', '2026-09-18', {
    kind: 'note', org: 'City Lung Clinic', doctor: 'Dr. Nikhil Menon', patient: 'Priya Sharma, 29/F', date: '18 Sept 2026',
    body: 'Symptoms well controlled on reliever inhaler. No night-time symptoms in past month. Continue current plan.',
  }, { engine: 'demo-mock', confidence: 0.85, date: '2026-09-18', provider: 'City Lung Clinic' }, 'processed', 'ai_extracted', 7);

  R(arjun, 'lab_report', 'Blood Test — Metabolic Panel', 'ABC Diagnostics', '2026-09-12', {
    kind: 'lab', org: 'ABC Diagnostics', patient: 'Arjun Rao, 56/M', date: '12 Sept 2026',
    items: [{ test: 'LDL Cholesterol', result: '142', unit: 'mg/dL', range: '< 130' }, { test: 'Creatinine', result: '1.0', unit: 'mg/dL', range: '0.7 – 1.3' }],
    signed: 'Dr. Meera Krishnan, MD Pathology',
  }, { engine: 'demo-mock', confidence: 0.93, tests: [{ test: 'LDL Cholesterol', result: '142', unit: 'mg/dL', interpretation: 'Above target' }], date: '2026-09-12', provider: 'ABC Diagnostics' }, 'verified', 'patient_verified', 13);

  R(arjun, 'prescription', 'BP & Cholesterol Prescription', 'ABC Primary Care Clinic', '2026-09-12', {
    kind: 'prescription', org: 'ABC Primary Care Clinic', doctor: 'Dr. Ananya Sharma', reg: 'KA-2019-004312', patient: 'Arjun Rao, 56/M', date: '12 Sept 2026',
    meds: [
      { name: 'Amlodipine', dose: '5 mg', freq: 'Once daily', duration: '30 days' },
      { name: 'Atorvastatin', dose: '10 mg', freq: 'Once daily at night', duration: '30 days' },
    ], advice: 'Low-fat diet. Review lipid profile in 3 months.',
  }, { engine: 'demo-mock', confidence: 0.9, medicines: [
      { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', duration: '30 days' },
      { name: 'Atorvastatin', dosage: '10 mg', frequency: 'Once daily at night', duration: '30 days' }],
    doctor: 'Dr. Ananya Sharma', date: '2026-09-12', provider: 'ABC Primary Care Clinic' }, 'verified', 'patient_verified', 13);

  R(arjun, 'hospital_record', 'Hospital Visit Record', 'District Hospital', '2026-08-02', {
    kind: 'note', org: 'District Hospital — Cardiology OPD', doctor: 'Dr. Rahul Verma', patient: 'Arjun Rao, 56/M', date: '02 Aug 2026',
    body: 'Evaluated for exertional chest discomfort. ECG normal sinus rhythm. Advised statin therapy and risk-factor modification.',
  }, { engine: 'demo-mock', confidence: 0.86, diagnoses: ['Hyperlipidemia'], date: '2026-08-02', provider: 'District Hospital' }, 'processed', 'ai_extracted', 54);

  R(meena, 'prescription', 'Osteoarthritis Prescription', 'Ortho Care Clinic', '2026-09-08', {
    kind: 'prescription', org: 'Ortho Care Clinic', doctor: 'Dr. Vikram Joshi', reg: 'TS-2014-55231', patient: 'Meena Devi, 63/F', date: '08 Sept 2026',
    meds: [{ name: 'Calcium + Vitamin D3', dose: '500 mg / 400 IU', freq: 'Once daily', duration: '60 days' }, { name: 'Paracetamol', dose: '500 mg', freq: 'If pain, max 3/day', duration: '10 days' }],
    advice: 'Hot fomentation. Gentle knee exercises twice daily.',
  }, { engine: 'demo-mock', confidence: 0.9, medicines: [{ name: 'Calcium + Vitamin D3', dosage: '500 mg / 400 IU', frequency: 'Once daily', duration: '60 days' }], doctor: 'Dr. Vikram Joshi', date: '2026-09-08', provider: 'Ortho Care Clinic' }, 'verified', 'patient_verified', 17);

  R(meena, 'lab_report', 'X-Ray Report — Right Knee', 'Ortho Care Clinic', '2026-09-08', {
    kind: 'lab', org: 'Ortho Care Clinic — Radiology', patient: 'Meena Devi, 63/F', date: '08 Sept 2026',
    items: [{ test: 'Right Knee X-Ray (AP & Lateral)', result: 'Grade II joint space narrowing', unit: '', range: 'Medial compartment' }],
    signed: 'Dr. Vikram Joshi, Orthopedics',
  }, { engine: 'demo-mock', confidence: 0.88, tests: [{ test: 'Right Knee X-Ray', result: 'Grade II joint space narrowing', unit: '', interpretation: 'Consistent with osteoarthritis' }], date: '2026-09-08', provider: 'Ortho Care Clinic' }, 'verified', 'patient_verified', 17);

  R(meena, 'hospital_record', 'Orthopedic Consultation', 'Ortho Care Clinic', '2026-09-08', {
    kind: 'note', org: 'Ortho Care Clinic', doctor: 'Dr. Vikram Joshi', patient: 'Meena Devi, 63/F', date: '08 Sept 2026',
    body: 'Bilateral knee pain, worse on right. Crepitus present. Advised physiotherapy and weight management. Review in 6 weeks.',
  }, { engine: 'demo-mock', confidence: 0.87, diagnoses: ['Osteoarthritis'], date: '2026-09-08', provider: 'Ortho Care Clinic' }, 'processed', 'ai_extracted', 17);

  // ---------- Conditions ----------
  const insCond = db.prepare('INSERT INTO Conditions (patientId,name,source,sourceRecordId,verified,lastUpdated) VALUES (?,?,?,?,?,?)');
  insCond.run(ravi, 'Type 2 Diabetes', 'ABC Clinic', rec_rx1, 1, d('2026-09-15'));
  insCond.run(ravi, 'Hypertension', 'District Hospital', rec_discharge, 1, d('2026-09-10'));
  insCond.run(priya, 'Asthma', 'City Lung Clinic', null, 1, d('2026-09-05'));
  insCond.run(arjun, 'Hypertension', 'ABC Primary Care Clinic', null, 1, d('2026-09-12'));
  insCond.run(arjun, 'Hyperlipidemia', 'District Hospital', null, 1, d('2026-08-02'));
  insCond.run(meena, 'Osteoarthritis', 'Ortho Care Clinic', null, 1, d('2026-09-08'));

  // ---------- Medicines ----------
  const insMed = db.prepare('INSERT INTO Medicines (patientId,name,dosage,frequency,duration,status,verified,sourceRecordId,startDate,endDate,lastVerified) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insMed.run(ravi, 'Metformin', '500 mg', 'Twice daily', '30 days', 'active', 1, rec_rx1, d('2026-09-10'), null, ts);
  insMed.run(ravi, 'Amlodipine', '5 mg', 'Once daily', '30 days', 'active', 1, rec_rx1, d('2026-09-10'), null, ts);
  insMed.run(priya, 'Salbutamol Inhaler', '100 mcg', 'As needed', '90 days', 'active', 1, priyaRx, d('2026-09-05'), null, d('2026-09-05'));
  insMed.run(arjun, 'Amlodipine', '5 mg', 'Once daily', '30 days', 'active', 1, null, d('2026-09-12'), null, d('2026-09-12'));
  insMed.run(arjun, 'Atorvastatin', '10 mg', 'Once daily at night', '30 days', 'active', 1, null, d('2026-09-12'), null, d('2026-09-12'));
  insMed.run(meena, 'Calcium + Vitamin D3', '500 mg / 400 IU', 'Once daily', '60 days', 'active', 1, null, d('2026-09-08'), null, d('2026-09-08'));

  // ---------- Allergies ----------
  db.prepare('INSERT INTO Allergies (patientId,substance,reaction,severity,verified,sourceLabel,sourceRecordId,lastVerified) VALUES (?,?,?,?,?,?,?,?)')
    .run(ravi, 'Penicillin', 'Skin rash', 'Moderate', 1, 'Prescription + Patient verification', rec_rx1, ts);
  // Priya, Arjun, Meena intentionally have NO allergy information recorded (never display "no allergies").

  // ---------- Visits ----------
  const insVisit = db.prepare('INSERT INTO Visits (patientId,providerId,providerName,organization,date,reason,notes,medicines,tests,followUp,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  insVisit.run(ravi, ananya, 'Dr. Ananya Sharma', 'ABC Primary Care Clinic', d('2026-09-25'), 'Consultation', 'Medicine review', 'Metformin, Amlodipine continued', null, 'Review with HbA1c', 'seed', ts);
  insVisit.run(ravi, diag, 'ABC Diagnostics', 'ABC Diagnostics', d('2026-09-15'), 'HbA1c Test', 'Sample collected; report delivered same day.', null, 'HbA1c', null, 'seed', ts);
  insVisit.run(ravi, rahul, 'Dr. Rahul Verma', 'District Hospital', d('2026-09-10'), 'Follow-up consultation', 'Prescription updated', 'Amlodipine continued', 'CBC', '3 weeks', 'seed', ts);
  insVisit.run(priya, null, 'Dr. Nikhil Menon', 'City Lung Clinic', d('2026-09-18'), 'Asthma follow-up', 'Well controlled', null, null, '3 months', 'seed', ts);
  insVisit.run(arjun, ananya, 'Dr. Ananya Sharma', 'ABC Primary Care Clinic', d('2026-09-12'), 'BP & cholesterol review', 'Started statin', null, 'Lipid profile', '3 months', 'seed', ts);
  insVisit.run(meena, null, 'Dr. Vikram Joshi', 'Ortho Care Clinic', d('2026-09-08'), 'Knee pain consultation', 'Physiotherapy advised', null, 'X-Ray right knee', '6 weeks', 'seed', ts);

  // ---------- Consent history (Ravi) ----------
  const insConsent = db.prepare(`INSERT INTO ConsentRequests (patientId,providerId,purpose,categories,durationMin,status,mode,createdAt,decidedAt,expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const oldConsent = insConsent.run(ravi, rahulUser, 'Follow-up', JSON.stringify(['medicines', 'reports']), 60, 'EXPIRED', 'qr', d('2026-09-20'), d('2026-09-20'), new Date('2026-09-20T10:30:00').toISOString()).lastInsertRowid;
  const insLog = db.prepare('INSERT INTO AccessLogs (consentId,patientId,providerId,providerLabel,action,detail,timestamp) VALUES (?,?,?,?,?,?,?)');
  insLog.run(oldConsent, ravi, rahulUser, 'District Hospital', 'ACCESS_REQUESTED', 'Purpose: Follow-up', d('2026-09-20'));
  insLog.run(oldConsent, ravi, rahulUser, 'District Hospital', 'ACCESS_GRANTED', 'Duration 60 min', d('2026-09-20'));
  insLog.run(oldConsent, ravi, rahulUser, 'District Hospital', 'RECORDS_VIEWED', 'Health snapshot opened', d('2026-09-20'));
  insLog.run(oldConsent, ravi, rahulUser, 'District Hospital', 'ACCESS_EXPIRED', null, new Date('2026-09-20T10:30:00').toISOString());

  // ---------- Notifications ----------
  const insNotif = db.prepare('INSERT INTO Notifications (userId,type,message,link,read,createdAt) VALUES (?,?,?,?,?,?)');
  insNotif.run(ravi, 'document', 'Your new laboratory report (HbA1c) has been processed.', '/records', 1, d('2026-09-15'));
  insNotif.run(ravi, 'document', 'Your CBC report has been processed.', '/records', 0, d('2026-09-10'));
  insNotif.run(ravi, 'expiry', 'Consent session for District Hospital has expired.', '/consent', 0, d('2026-09-20'));
  insNotif.run(ananyaUser, 'info', 'Welcome to CareVault for Providers. Scan a patient QR to begin.', null, 1, daysAgo(30));

  return { seeded: true, admin, ravi, ananyaUser };
}

module.exports = { seed };

if (require.main === module) {
  const res = seed(process.argv.includes('--force'));
  console.log(res.seeded ? '✓ Seeded demo data.' : 'Database already contains data. Use --force to reseed.');
}
