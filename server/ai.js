'use strict';
/**
 * CareVault AI service abstraction.
 *
 * The real product would call an OCR / document-intelligence service here.
 * This prototype ships with a deterministic MOCK engine so the whole flow
 * works with no external API key. Every result is labelled
 * "AI Extracted — Verification Required" in the UI, and results are
 * internally flagged with engine: 'demo-mock'.
 *
 * Swapping in a real provider later means implementing `extract()` with the
 * same return shape.
 */

const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const pick = (arr, seed) => arr[seed % arr.length];

const DOCTORS = ['Dr. Ananya Sharma', 'Dr. Rahul Verma', 'Dr. Kavita Iyer', 'Dr. Suresh Naidu'];
const MED_POOL = [
  { name: 'Paracetamol', dosage: '650 mg', frequency: 'Twice daily', duration: '5 days' },
  { name: 'Amoxicillin', dosage: '250 mg', frequency: 'Three times daily', duration: '7 days' },
  { name: 'Pantoprazole', dosage: '40 mg', frequency: 'Once daily', duration: '14 days' },
  { name: 'Cetirizine', dosage: '10 mg', frequency: 'Once daily at night', duration: '10 days' },
];
const TEST_POOL = [
  { test: 'HbA1c', result: '6.9%', unit: '%' },
  { test: 'Fasting Glucose', result: '104', unit: 'mg/dL' },
  { test: 'LDL Cholesterol', result: '118', unit: 'mg/dL' },
  { test: 'Hemoglobin', result: '13.4', unit: 'g/dL' },
  { test: 'TSH', result: '2.1', unit: 'mIU/L' },
];

function seededDateISO(seed, withinDays = 60) {
  const d = new Date(Date.now() - (seed % withinDays) * 86400000);
  return d.toISOString();
}

/**
 * Mock extraction. Returns a normalized structure:
 * { engine, confidence, uncertain, medicines[], doctor, date, provider,
 *   tests[], diagnoses[], allergies[], notes }
 */
function extract(record, fileHint) {
  const seedSrc = (fileHint || record.title || '') + '|' + (record.type || '');
  const seed = hashStr(seedSrc);
  const lowConfidence = /blurry|unclear|faded|partial/i.test(seedSrc);

  // Canonical demo case from the product brief: uploading ravi_prescription.pdf
  // returns a deterministic, familiar extraction for the showcase.
  if (/ravi/i.test(fileHint || '') && record.type === 'prescription') {
    return {
      engine: 'demo-mock',
      engineLabel: 'Demo AI (mock extraction — no external AI service was used)',
      confidence: 0.95, uncertain: false,
      medicines: [{ name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily', duration: '30 days' }],
      tests: [], diagnoses: [], allergies: [],
      doctor: 'Dr. Ananya Sharma',
      date: record.date || new Date(Date.now() - 10 * 86400000).toISOString(),
      provider: record.provider || 'ABC Clinic',
      notes: [],
    };
  }
  const provider = record.provider || pick(['ABC Clinic', 'City Care Clinic', 'District Hospital'], seed);
  const date = record.date || seededDateISO(seed);

  const result = {
    engine: 'demo-mock',
    engineLabel: 'Demo AI (mock extraction — no external AI service was used)',
    confidence: lowConfidence ? 0.42 : 0.82 + (seed % 15) / 100,
    uncertain: !!lowConfidence,
    medicines: [],
    tests: [],
    diagnoses: [],
    allergies: [],
    doctor: null,
    date,
    provider,
    notes: [],
  };

  switch (record.type) {
    case 'prescription': {
      const n = 1 + (seed % 2);
      for (let i = 0; i < n; i++) {
        const m = pick(MED_POOL, seed + i * 7);
        if (!result.medicines.find(x => x.name === m.name)) result.medicines.push({ ...m });
      }
      result.doctor = pick(DOCTORS, seed);
      break;
    }
    case 'lab_report': {
      const t = pick(TEST_POOL, seed);
      result.tests.push({ ...t });
      if (seed % 3 === 0) result.tests.push({ ...pick(TEST_POOL, seed + 3) });
      break;
    }
    case 'discharge_summary': {
      result.diagnoses.push(pick(['Type 2 Diabetes', 'Hypertension', 'Acute Bronchitis', 'Osteoarthritis'], seed));
      const m = pick(MED_POOL, seed + 1);
      result.medicines.push({ ...m });
      result.doctor = pick(DOCTORS, seed + 2);
      result.notes.push('Discharge advice: follow-up in 2 weeks, continue prescribed medicines.');
      break;
    }
    case 'hospital_record': {
      result.diagnoses.push(pick(['Hypertension review', 'Fever — viral', 'Osteoarthritis'], seed));
      result.doctor = pick(DOCTORS, seed + 1);
      break;
    }
    default: {
      result.notes.push('General clinical note. Key structured fields could not be detected confidently.');
      result.uncertain = true;
      result.confidence = Math.min(result.confidence, 0.55);
    }
  }

  // A small percentage of prescriptions surface an allergy mention.
  if (record.type === 'prescription' && seed % 4 === 0) {
    result.allergies.push({ substance: pick(['Sulfa drugs', 'Aspirin', 'Dust mites'], seed), reaction: 'Reported in notes', severity: 'Unknown' });
  }

  return result;
}

/** Turn a verified extraction into structured patient data. */
function applyExtraction(db, record, extraction, { confirmedByPatient = true } = {}) {
  const ts = new Date().toISOString();
  const insMed = db.prepare(`INSERT INTO Medicines (patientId,name,dosage,frequency,duration,status,verified,sourceRecordId,startDate,lastVerified)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insAlg = db.prepare(`INSERT INTO Allergies (patientId,substance,reaction,severity,verified,sourceLabel,sourceRecordId,lastVerified)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insCond = db.prepare(`INSERT INTO Conditions (patientId,name,source,sourceRecordId,verified,lastUpdated) VALUES (?,?,?,?,?,?)`);
  const added = { medicines: 0, allergies: 0, conditions: 0 };

  for (const m of extraction.medicines || []) {
    const dup = db.prepare('SELECT id FROM Medicines WHERE patientId=? AND name=? AND status=?').get(record.patientId, m.name, 'active');
    if (!dup) {
      insMed.run(record.patientId, m.name, m.dosage, m.frequency, m.duration, 'active', confirmedByPatient ? 1 : 0, record.id, record.date || ts, ts);
      added.medicines++;
    } else {
      db.prepare('UPDATE Medicines SET dosage=?, frequency=?, lastVerified=?, verified=? WHERE id=?')
        .run(m.dosage, m.frequency, ts, confirmedByPatient ? 1 : 0, dup.id);
    }
  }
  for (const a of extraction.allergies || []) {
    const dup = db.prepare('SELECT id FROM Allergies WHERE patientId=? AND substance=?').get(record.patientId, a.substance);
    if (!dup) {
      insAlg.run(record.patientId, a.substance, a.reaction, a.severity, confirmedByPatient ? 1 : 0, `${record.title} (${record.provider || 'unknown'})`, record.id, ts);
      added.allergies++;
    }
  }
  for (const d of extraction.diagnoses || []) {
    const dup = db.prepare('SELECT id FROM Conditions WHERE patientId=? AND name=?').get(record.patientId, d);
    if (!dup) { insCond.run(record.patientId, d, record.provider, record.id, confirmedByPatient ? 1 : 0, ts); added.conditions++; }
    else db.prepare('UPDATE Conditions SET lastUpdated=? WHERE id=?').run(ts, dup.id);
  }
  return added;
}

module.exports = { extract, applyExtraction };
