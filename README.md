# CareVault

> **Your Health. Your Records. Your Consent.**

CareVault is a **patient-controlled digital health record platform** prototype. Patients collect and organize their medical records, verify AI-extracted information, and selectively share the right information with the right healthcare provider — only when they choose, for as long as they choose. Providers get a fast, consent-gated clinical snapshot instead of digging through scattered papers.

CareVault is designed as a **last-mile patient/provider experience layer** that can eventually work with ABDM/ABHA infrastructure. It does **not** replace ABDM, and it is **not** a diagnostic or medical decision-making system.

---

## Quick start

```bash
npm install
npm start          # → http://localhost:3000
```

The SQLite database (`data/carevault.db`) is created and seeded automatically on first boot with four fictional patients, three providers, records, visits, and consent history.

To reset the demo to a pristine state at any time:

```bash
npm run reseed     # wipes and re-seeds the database (server must be stopped)
```

### Demo accounts (all passwords: `Demo123!`)

| Role | Email | Who |
|---|---|---|
| 🙋 Patient | `patient@carevault.demo` | Ravi Kumar (42, diabetes + hypertension, penicillin allergy) |
| 🩺 Provider | `doctor@carevault.demo` | Dr. Ananya Sharma, ABC Primary Care Clinic |
| 🩺 Provider | `dr.rahul@carevault.demo` | Dr. Rahul Verma, District Hospital |
| 🩺 Provider | `labs@carevault.demo` | ABC Diagnostics |
| 🛠️ Admin | `admin@carevault.demo` | Operational console (no PHI) |

More patients: `priya@carevault.demo`, `arjun@carevault.demo`, `meena@carevault.demo` (Meena is used for the assisted-access demo).

---

## The flagship demo story

The core interaction — and the one that must feel magical:

**Patient → Generate QR → Provider requests → Patient consents → Provider sees snapshot → Patient revokes → Provider loses access.**

1. Log in as **Ravi Kumar** → open **Share Records**.
2. Keep *Medicines, Allergies, Recent Reports* selected, purpose *Consultation*, duration *1 hour* → **Generate Secure QR**.
3. Log in as **Dr. Ananya Sharma** (second browser/incognito) → **Scan Patient QR** → use the camera, the **Demo QR**, or type the access code shown under the patient's QR.
4. The provider sees a **Patient Access Request** — *Waiting for patient consent*. No patient data, not even the patient's name, is revealed yet.
5. Back as Ravi: **Consent & Access** → **Allow Access**.
6. The provider's screen switches to the **Patient Health Snapshot**: allergies (Penicillin, patient-verified), medicines, recent tests. Every item can be traced to its **source document** (*View Original*).
7. The provider can also **Add a Visit** — Ravi gets a notification.
8. As Ravi: **Consent & Access** → **Revoke Access**.
9. The provider's next refresh shows **ACCESS REVOKED** — enforced by the backend; every further API call for that session fails.

---

## Feature map

### Public site (`/`)
Premium landing page (hero, problem flow, how it works, product showcase, patient/provider experience, AI organization, consent & control, security center, assisted access, platform capabilities, FAQ, CTA) with scroll-reveal animations, counters, marquee, sticky nav and full responsive behavior.

### Patient app (`/app/patient`)
- **Dashboard** — greeting, stat cards (medicines, allergies, reports, active access, records), ABHA status, quick actions, notifications preview
- **Health Summary** — patient info + demo ABHA, conditions, current medicines table with *View Source*, allergy banner, recent tests with *View Original*, **Generate Health Summary** (mock AI, every claim linked to a source document)
- **Medical Records** — drag-&-drop upload (PDF/JPG/PNG) with progress, staged AI processing animation, *Information Detected* review (**Confirm / Edit / Reject**), manual record entry, type filters, search, view/download/delete
- **My Medicines** — medication passport with dose/frequency/start/end/status/source/last-verified, confirm & edit
- **My Allergies** — allergy passport; if nothing is recorded it says **“No allergy information recorded”** (never “no allergies”)
- **Reports** — lab reports with original-document viewer
- **Visit History** — visual timeline
- **Share Records** — category checkboxes, purpose, duration (15 min / 1 h / 24 h / custom), **Generate Secure QR** (QR contains only an opaque temporary code — never health data), cancel sharing, live consent status
- **Consent & Access** — pending requests (*Allow / Reject*), active access with live countdown + **Revoke** (confirm modal → revoked state), consent history timeline, full access log
- **Notifications** — request / granted / revoked / expiry-warning / document / visit events
- **Profile** — personal details + **Connect ABHA** (clearly-labelled *Demo Integration* mock)
- **Settings** — language selector (**English / हिन्दी / తెలుగు**, extensible), connectivity status
- Global search (medicines, allergies, reports, visits, conditions, providers) and a **voice command** button (browser speech recognition with a realistic simulated fallback)

### Provider app (`/app/provider`)
Deliberately simple:
- **Scan Patient QR** — real camera scanning where supported (`BarcodeDetector`), always with **Demo QR** and **access-code entry** fallbacks so the demo can't fail
- **Patient Access Request** screen while waiting for consent (polls live)
- **Patient Health Snapshot** after consent: allergies, medicines, conditions, recent tests, documents — only the categories the patient shared; expiry countdown; **View Original** with backend consent checks
- **Add Visit** → patient is notified
- **Assisted Patient Access** — for patients without smartphones: identity lookup → category/purpose selection → the patient taps **I Approve** on the clinic's device → temporary authorized access
- Blocked screens for *revoked*, *expired*, *not-in-consent* — enforced server-side

### Admin app (`/app/admin`)
Operational statistics with clearly-labelled **fictional platform numbers** (1,284 patients, 146 providers, 4,892 records processed) plus live prototype counters and pseudonymized consent activity. Admins intentionally have **no access to patient medical content**.

---

## Architecture

```
server/
  index.js            Express app: sessions, static hosting, error handling, consent sweep
  db.js               SQLite schema (Users, PatientProfiles, Providers, MedicalRecords,
                      Medicines, Allergies, Conditions, Visits, ConsentRequests,
                      ShareTokens, AccessLogs, Notifications, Sessions, GeneratedSummaries)
  seed.js             Fictional demo data (patients, providers, records, visits, history)
  consent.js          Consent state machine + backend enforcement (assertActiveConsent,
                      recordAllowed, approve/reject/revoke, expiry sweep + warnings)
  ai.js               AI service abstraction — deterministic MOCK engine; swap-in point
                      for a real OCR/document-intelligence service
  util.js             scrypt password hashing, sessions, helpers
  routes/             auth, patient, records (multer uploads), consent, provider, admin
public/
  index.html + js/landing.js        Marketing site
  login.html + js/login.js          Auth (login + patient registration)
  patient.html + js/patient.js      Patient SPA (hash router)
  provider.html + js/provider.js    Provider SPA
  admin.html + js/admin.js          Admin SPA
  js/ui.js                          Shared: API client, modals, toasts, i18n, voice,
                                    document viewer, connectivity indicator
  css/style.css + css/app.css       Design system + application components
```

### API surface (highlights)

```
POST /api/auth/login · /logout · /register · GET /api/auth/me
GET  /api/patient/profile · /dashboard · /summary · /medicines · /allergies · /visits
POST /api/patient/summary/generate · /abha/connect
GET  /api/patient/search · /notifications
GET|POST /api/records · /upload (multipart) · /process · /manual
POST /api/records/:id/verify  (confirm | edit | reject)
GET  /api/records/:id · /:id/file · DELETE /api/records/:id
POST /api/consent/share-token · /approve · /reject · /revoke
GET  /api/consent/pending · /active · /history · /access-logs
POST /api/provider/scan · /demo-token · /visits
GET  /api/provider/request/:id/status · /consent/:id/snapshot · /consent/:id/document/:rid
POST /api/provider/assisted/init · /assisted/request · /assisted/patient-approve
GET  /api/admin/stats · /users
```

### Consent engine (real backend state machine)

```
PENDING ──approve──▶ ACTIVE ──┬──expire──▶ EXPIRED
   │                          └──revoke──▶ REVOKED
   └──reject──▶ REJECTED
```

Every provider data endpoint calls `assertActiveConsent()` — expiry and revocation are enforced **server-side**, not hidden in the UI. Documents are additionally filtered by the granted categories (e.g. discharge summaries require *Full Medical History*).

### QR system
The QR encodes only `CAREVAULT:<temporary-code>` — **no health data**. The code maps to a share token on the server; scanning it creates a `PENDING` consent request; the backend releases data only after the patient approves.

### AI
`server/ai.js` ships a deterministic **demo mock** engine so the whole flow works with no API key. All outputs are flagged `engine: 'demo-mock'`, labelled **“AI Extracted — Verification Required”**, and only enter the patient's verified record after **Confirm**. Uncertain extractions show *“Some information could not be confidently extracted. Please verify manually.”*

### ABHA
`Connect ABHA` is a clearly-labelled **mock integration** (the prototype is not connected to live ABDM). The data model stores the ABHA id on the profile so a real ABDM sandbox integration can be added later without schema changes.

---

## Non-functional notes

- **Low connectivity:** compressed responses, no heavy images (all visuals are CSS/SVG), lightweight dashboards, and a live connection indicator (Good / Limited connectivity / Offline).
- **Responsive:** desktop-first layouts; the sidebar collapses to a mobile drawer; QR sharing and consent are designed for phones; the provider view is tablet-friendly.
- **Multilingual UI:** English primary; Hindi and Telugu dictionaries ship for the app chrome and are trivially extensible.
- **Security posture:** scrypt-hashed passwords, httpOnly session cookies, role-based authorization on every route, consent-gated data access, audit logging of every request/view/revoke. No unrealistic “100% secure” claims.

## Honesty labels

Throughout the prototype you will see explicit labels: **Demo Data**, **Demo Accounts**, **Demo Integration** (ABHA), and **Demo AI (mock extraction — no external AI service was used)**. This prototype is for demonstration and hackathon use.
