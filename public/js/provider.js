/* ============================================================
   CareVault — Provider application
   Deliberately simple: scan → consent → snapshot.
   ============================================================ */
(function () {
'use strict';
const { api, esc, fmtDate, fmtDateTime, timeAgo, countdown, toast, modal, ic, openDocument, CAT_LABEL, CAT_IC, mountNetPill } = CV;

let ME = null, PROV = null;
let POLLERS = [];
const view = () => document.getElementById('view');
const stopPollers = () => { POLLERS.forEach(clearInterval); POLLERS = []; };

const NAV = [
  { r: '/home', k: 'Home', i: 'dash' },
  { r: '/scan', k: 'Scan Patient QR', i: 'qr' },
  { r: '/assisted', k: 'Assisted Patient Access', i: 'user' },
  { r: '/notifications', k: 'Notifications', i: 'bell' },
];

function renderSidebar() {
  document.getElementById('sideNav').innerHTML = NAV.map(n =>
    `<a class="side-link" href="#${n.r}" data-route="${n.r}">${ic(n.i)}<span>${n.k}</span></a>`).join('');
  document.getElementById('logoutBtn').innerHTML = `${ic('logout')}<span>Logout</span>`;
  highlight();
}
function highlight() {
  const route = (location.hash.slice(1) || '/home').split('?')[0].replace(/\/\d+$/, '');
  document.querySelectorAll('.side-link[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));
}
function closeSide() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sideBackdrop').classList.remove('open'); }

/* ================= PAGES ================= */

function pageHome() {
  view().innerHTML = `
    <div class="page-head"><h1>Welcome, ${esc(ME.name.replace(/^Dr\.\s*/, 'Dr. '))}</h1>
      <p class="sub">${esc(PROV.organization)} · ${esc(PROV.specialty || '')} — keep it simple: scan, consent, view.</p></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
      <div class="card big-action" data-go="#/scan" style="border:2px solid var(--primary)">
        <div class="em" style="background:var(--soft);color:var(--primary)">${ic('scan')}</div>
        <h3 style="font-size:1.35rem">Scan Patient QR</h3>
        <p class="small muted mt-1">Point the camera at the patient's CareVault QR, or enter the access code.</p>
        <span class="btn btn-primary mt-2">Start scanning <span class="arrow-dot">→</span></span>
      </div>
      <div class="card big-action" data-go="#/assisted">
        <div class="em" style="background:#fdf3e3;color:#b06f0c">🤝</div>
        <h3 style="font-size:1.15rem">Assisted Patient Access</h3>
        <p class="small muted mt-1">For patients without a smartphone — identity check + explicit on-screen approval.</p>
        <span class="btn btn-ghost mt-2">Open assisted mode</span>
      </div>
    </div>
    <div class="panel mt-3">
      <div class="panel-h"><h3>Enter Access Code</h3><span class="badge muted">No camera needed</span></div>
      <div class="row" style="gap:.7rem;flex-wrap:wrap">
        <input class="search-input mono" id="codeIn" placeholder="e.g. K7QX-3M9F" style="max-width:260px;letter-spacing:.14em;text-transform:uppercase">
        <button class="btn btn-primary" id="codeGo">Request Access</button>
      </div>
      <p class="small muted mt-2">The patient's QR code is valid for 30 minutes. Access always requires the patient's explicit consent.</p>
    </div>
    <div class="banner info mt-3"><span>🛡️</span><span><b>Nothing is shown before consent.</b> Scanning a QR only creates an access request; the patient must approve it on their device.</span></div>`;
  view().querySelectorAll('[data-go]').forEach(c => c.addEventListener('click', () => location.hash = c.dataset.go));
  const go = () => requestCode(document.getElementById('codeIn').value);
  document.getElementById('codeGo').addEventListener('click', go);
  document.getElementById('codeIn').addEventListener('keydown', (e) => e.key === 'Enter' && go());
}

async function requestCode(code) {
  if (!code.trim()) return toast('Enter the access code from the patient QR.', 'warn');
  try {
    const { request } = await api('/provider/scan', { body: { code } });
    location.hash = `#/request/${request.id}`;
  } catch (e) {
    if (e.code === 'INVALID_CODE' || e.code === 'CODE_EXPIRED' || e.code === 'CODE_INACTIVE') toast(e.message, 'error');
    else toast(e.message || 'Could not process this code.', 'error');
  }
}

async function pageScan() {
  view().innerHTML = `
    <div class="page-head"><h1>Scan Patient QR</h1><p class="sub">Use the camera, or type the code below. Demo QR available — camera is optional.</p></div>
    <div class="grid" style="grid-template-columns:1.1fr .9fr;gap:1.6rem">
      <div class="panel">
        <div class="scan-frame" id="scanFrame">
          <span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span>
          <div class="scan-line" id="scanLine"></div>
          <div id="scanMsg" class="text-center" style="padding:1rem;z-index:2">
            <p style="font-weight:650">Camera scanner</p>
            <p class="small" style="opacity:.75">Initializing…</p>
          </div>
          <video id="scanVideo" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none"></video>
        </div>
        <div class="row mt-2" style="gap:.7rem;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="camBtn">▶ Enable camera</button>
          <button class="btn btn-ghost btn-sm" id="demoQrBtn">🎬 Use Demo QR</button>
        </div>
      </div>
      <div class="panel">
        <h3>⌨️ Enter Access Code</h3>
        <p class="small muted mb-2">Ask the patient for the 8-character code shown under their QR.</p>
        <div class="field"><input class="mono" id="codeIn" placeholder="K7QX-3M9F" style="letter-spacing:.16em;text-transform:uppercase;font-size:1.2rem;text-align:center"></div>
        <button class="btn btn-primary btn-block" id="codeGo">Request Access</button>
        <div class="divider"></div>
        <p class="small muted">💡 For the demonstration, open the patient app → <b>Share Records</b> → <b>Generate Secure QR</b>, then enter the code here.</p>
      </div>
    </div>`;

  const video = document.getElementById('scanVideo');
  const msg = document.getElementById('scanMsg');
  let stream = null, scanning = false;

  async function handleDetected(text) {
    if (!scanning) return; scanning = false;
    stopCamera();
    toast('QR detected — sending access request…', 'success');
    requestCode(text);
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.style.display = 'none'; msg.style.display = 'block';
  }

  document.getElementById('camBtn').addEventListener('click', async () => {
    msg.innerHTML = '<p style="font-weight:650">Starting camera…</p>';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; video.style.display = 'block'; msg.style.display = 'none';
      scanning = true;
      if ('BarcodeDetector' in window) {
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        const loop = async () => {
          if (!scanning) return;
          try {
            const codes = await det.detect(video);
            if (codes.length) return handleDetected(codes[0].rawValue);
          } catch {}
          requestAnimationFrame(loop);
        };
        loop();
      } else {
        msg.style.display = 'block';
        msg.innerHTML = '<p style="font-weight:650">Camera is on, but this browser cannot decode QR codes.</p><p class="small" style="opacity:.75">Use the Demo QR or type the access code.</p>';
      }
    } catch {
      msg.innerHTML = '<p style="font-weight:650">Camera unavailable.</p><p class="small" style="opacity:.75">No problem — use the Demo QR or enter the code manually.</p>';
    }
  });

  document.getElementById('demoQrBtn').addEventListener('click', async () => {
    const m = modal({
      title: '🎬 Demo QR',
      body: `<div class="text-center">
        <p class="muted small">This demo QR is pre-linked to the patient <b>Ravi Kumar</b> for the showcase flow (medicines, allergies and recent reports for a 1-hour consultation).</p>
        <div id="demoQrImg" class="mt-2" style="min-height:180px;display:grid;place-items:center"><span class="spinner"></span></div>
      </div>`,
      foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="s">Scan this Demo QR</button>',
    });
    try {
      const { code, qrDataUrl } = await api('/provider/demo-token', { body: {} });
      m.body.querySelector('#demoQrImg').innerHTML = `<div><img src="${qrDataUrl}" width="180" height="180" style="border-radius:1rem;border:1px solid var(--line)"><div class="mono mt-1" style="font-weight:700;letter-spacing:.12em">${esc(code)}</div></div>`;
      m.el.querySelector('[data-a="s"]').onclick = () => { m.close(); requestCode(code); };
    } catch (e) { toast(e.message, 'error'); m.close(); }
  });

  const go = () => requestCode(document.getElementById('codeIn').value);
  document.getElementById('codeGo').addEventListener('click', go);
  document.getElementById('codeIn').addEventListener('keydown', (e) => e.key === 'Enter' && go());
}

/* ---------- Pending request ---------- */
function pageRequest(id) {
  view().innerHTML = `<div class="empty"><span class="spinner" style="margin:0 auto"></span></div>`;
  stopPollers();
  const load = async () => {
    let st;
    try { st = await api(`/provider/request/${id}/status`); } catch (e) { view().innerHTML = errorCard(e); stopPollers(); return; }
    const r = st.request;
    if (r.status === 'ACTIVE') { stopPollers(); location.hash = `#/snapshot/${id}`; return; }
    if (r.status === 'REJECTED') {
      stopPollers();
      view().innerHTML = `<div class="page-head"><h1>Request Rejected</h1></div>
        <div class="empty card" style="padding:3rem"><div class="big">✖️</div><b>The patient rejected this access request.</b>
        <p class="muted mt-1">No patient information was shared.</p>
        <a class="btn btn-primary mt-3" href="#/scan">Scan another QR</a></div>`;
      return;
    }
    view().innerHTML = `
      <div class="page-head"><h1>Patient Access Request</h1><p class="sub">Sent to the patient — waiting for their explicit consent.</p></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:1.6rem">
        <div class="panel">
          <div class="kv"><span class="k">Provider</span><span class="v">${esc(ME.name)}</span></div>
          <div class="kv"><span class="k">Organization</span><span class="v">${esc(PROV.organization)}</span></div>
          <div class="kv"><span class="k">Purpose</span><span class="v">${esc(r.purpose)}</span></div>
          <div class="kv"><span class="k">Duration</span><span class="v">${r.durationMin} minutes</span></div>
          <div class="kv"><span class="k">Status</span><span class="v"><span class="badge warn"><span class="dot warn"></span>Waiting for patient consent</span></span></div>
          <div class="banner info mt-2"><span>🔐</span><span>No patient information is shown until the patient approves. Identity stays private until consent.</span></div>
        </div>
        <div class="panel">
          <h3>Requested information</h3>
          <div class="grid" style="gap:.6rem">
            ${r.categories.map(c => `<label class="cat-check checked"><input type="checkbox" checked disabled> ${CAT_IC[c]} ${CAT_LABEL[c]}</label>`).join('')}
          </div>
          <div class="text-center mt-3">
            <span class="spin" style="width:26px;height:26px"></span>
            <p class="small muted mt-1">Polling for the patient's decision…</p>
          </div>
        </div>
      </div>`;
  };
  load();
  POLLERS.push(setInterval(load, 3000));
}

/* ---------- Snapshot ---------- */
async function pageSnapshot(id) {
  stopPollers();
  const poll = setInterval(() => refreshSnapshot(id, true), 8000);
  POLLERS.push(poll);
  refreshSnapshot(id);
}

async function refreshSnapshot(id, silent) {
  let data;
  try { data = await api(`/provider/consent/${id}/snapshot`); }
  catch (e) {
    if (!silent || ['REVOKED', 'EXPIRED', 'REJECTED', 'FORBIDDEN', 'PENDING'].includes(e.code)) {
      stopPollers();
      view().innerHTML = blockedScreen(e, id);
    }
    return;
  }
  const s = data.snapshot;
  const secs = s.sections;
  view().innerHTML = `
    <div class="page-head row between" style="flex-wrap:wrap">
      <div><h1>Patient Health Snapshot</h1>
        <p class="sub">${esc(s.patient.name)} · ${s.patient.age ?? '—'} yrs · ${esc(s.patient.gender || '')}${s.patient.bloodGroup ? ' · ' + esc(s.patient.bloodGroup) : ''}</p></div>
      <div class="row" style="gap:.7rem;flex-wrap:wrap">
        <span class="badge ok" id="snapStatus"><span class="dot ok"></span>Access active</span>
        <span class="badge ${CV.minsLeft(s.expiresAt) <= 10 ? 'warn' : 'info'} countdown" id="snapCountdown">⏳ ${countdown(s.expiresAt)}</span>
      </div>
    </div>
    <div class="banner ok mb-3"><span>🔓</span><span>Patient consent: <b>${esc(s.purpose)}</b> · shared: ${s.categoryLabels.join(' + ')} · expires ${fmtDateTime(s.expiresAt)}</span></div>

    ${secs.allergies !== undefined ? `<div class="snap-section" style="border-color:#f5c6c6">
      <h3>⚠️ ALLERGIES</h3>
      ${secs.allergies.length ? secs.allergies.map(a => `<div class="allergy-banner"><span style="font-size:1.4rem">⚠️</span>
        <div><b style="font-size:1.1rem">${esc(a.substance)}</b> <span class="badge ${a.verified ? 'ok' : 'warn'}" style="margin-left:.4rem">${a.verified ? 'Patient Verified' : 'Unverified'}</span>
        <div class="small muted mt-1">Reaction: ${esc(a.reaction || '—')} · Source: ${esc(a.sourceLabel || '—')}</div></div></div>`).join('')
      : '<p class="muted">No allergy information recorded.</p>'}</div>` : ''}

    ${secs.medicines !== undefined ? `<div class="snap-section"><h3>💊 CURRENT MEDICINES</h3>
      ${secs.medicines.length ? secs.medicines.map(m => `<div class="snap-row">
        <div><b>${esc(m.name)} ${esc(m.dosage || '')}</b><div class="small muted">${esc(m.frequency || '')}${m.verified ? '' : ' · <i>unverified</i>'}</div></div>
        ${m.sourceRecordId ? `<button class="link-btn small" data-srcdoc="${m.sourceRecordId}">View Source</button>` : '<span class="small muted">Manual entry</span>'}</div>`).join('')
      : '<p class="muted">No active medicines recorded.</p>'}</div>` : ''}

    ${secs.conditions !== undefined ? `<div class="snap-section"><h3>🩺 CONDITIONS</h3>
      ${secs.conditions.length ? secs.conditions.map(c => `<div class="snap-row"><b>${esc(c.name)}</b><span class="small muted">Source: ${esc(c.source || '—')} · ${fmtDate(c.lastUpdated)}</span></div>`).join('')
      : '<p class="muted">No information is currently available for this category.</p>'}</div>` : ''}

    ${secs.reports !== undefined ? `<div class="snap-section"><h3>🧪 RECENT TESTS</h3>
      ${secs.reports.length ? secs.reports.map(r => {
        const tt = (r.extraction?.tests || [])[0];
        return `<div class="snap-row"><div><b>${esc(tt ? tt.test : r.title)}</b>${tt ? ` — ${esc(tt.result)}${tt.unit ? ' ' + esc(tt.unit) : ''}` : ''}
        <div class="small muted">${fmtDate(r.date)} · ${esc(r.provider || '')}</div></div>
        <button class="btn btn-ghost btn-sm" data-doc="${r.id}">View Original</button></div>`;
      }).join('') : '<p class="muted">No recent lab reports in the shared categories.</p>'}</div>` : ''}

    <div class="snap-section"><h3>📄 RECENT DOCUMENTS</h3>
      ${(secs.documents || []).length ? secs.documents.map(dcc => `<div class="snap-row">
        <div><b>${esc(dcc.title)}</b><div class="small muted">${esc(dcc.type.replace('_', ' '))} · ${esc(dcc.provider || '')} · ${fmtDate(dcc.date)}</div></div>
        <button class="btn btn-ghost btn-sm" data-doc="${dcc.id}">View Original</button></div>`).join('')
      : '<p class="muted">No documents included in the shared categories.</p>'}</div>

    <div class="panel">
      <div class="panel-h"><h3>➕ Add Visit</h3><span class="badge info">Recorded to the patient's history</span></div>
      <div class="form-grid">
        <div class="field"><label>Date</label><input type="date" id="vDate" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Reason for visit</label><input id="vReason" placeholder="e.g. Follow-up consultation"></div>
      </div>
      <div class="field"><label>Clinical notes</label><textarea id="vNotes" rows="3" placeholder="Observations, advice…"></textarea></div>
      <div class="form-grid">
        <div class="field"><label>Medicines (comma separated)</label><input id="vMeds" placeholder="Metformin 500mg, …"></div>
        <div class="field"><label>Tests ordered</label><input id="vTests" placeholder="HbA1c, …"></div>
      </div>
      <div class="field"><label>Follow-up</label><input id="vFollow" placeholder="e.g. Review in 4 weeks"></div>
      <button class="btn btn-primary" id="vSave">Save Visit</button>
    </div>`;

  view().querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', async () => {
    try {
      const { record } = await api(`/provider/consent/${id}/document/${b.dataset.doc}`);
      openDocument(record, { readOnly: true, fileUrl: record.fileUrl ? `/api/provider/consent/${id}/document/${record.id}/file` : null });
    } catch (e) { handleConsentError(e, id); }
  }));
  view().querySelectorAll('[data-srcdoc]').forEach(b => b.addEventListener('click', async () => {
    try {
      const { record } = await api(`/provider/consent/${id}/document/${b.dataset.srcdoc}`);
      openDocument(record, { readOnly: true, fileUrl: record.fileUrl ? `/api/provider/consent/${id}/document/${record.id}/file` : null });
    } catch (e) { handleConsentError(e, id); }
  }));
  document.getElementById('vSave').addEventListener('click', async () => {
    try {
      await api('/provider/visits', { body: { consentId: Number(id), date: document.getElementById('vDate').value, reason: document.getElementById('vReason').value, notes: document.getElementById('vNotes').value, medicines: document.getElementById('vMeds').value, tests: document.getElementById('vTests').value, followUp: document.getElementById('vFollow').value } });
      toast('Visit saved — the patient has been notified.', 'success');
      document.getElementById('vReason').value = ''; document.getElementById('vNotes').value = '';
    } catch (e) { handleConsentError(e, id); }
  });
}

function handleConsentError(e, id) {
  if (['REVOKED', 'EXPIRED', 'REJECTED'].includes(e.code)) { stopPollers(); view().innerHTML = blockedScreen(e, id); }
  else toast(e.message, 'error');
}

function blockedScreen(e, id) {
  if (e.code === 'REVOKED') return `
    <div class="page-head"><h1>Access Revoked</h1></div>
    <div class="empty card" style="padding:3.4rem;border-top:6px solid var(--coral)">
      <div class="big">🚫</div>
      <h2 style="font-size:1.6rem">Access Revoked</h2>
      <p class="muted mt-2" style="max-width:46ch;margin-left:auto;margin-right:auto">The patient has revoked access to this record. Protected health information is no longer available through this consent session.</p>
      <a class="btn btn-primary mt-3" href="#/scan">Request Access Again</a>
    </div>`;
  if (e.code === 'EXPIRED') return `
    <div class="page-head"><h1>Session Expired</h1></div>
    <div class="empty card" style="padding:3.4rem"><div class="big">⏳</div><b>This consent session has expired.</b>
      <p class="muted mt-1">Ask the patient to share a fresh QR when needed.</p>
      <a class="btn btn-primary mt-3" href="#/scan">Request Access Again</a></div>`;
  return `<div class="empty card" style="padding:3rem"><div class="big">⛔</div><b>${esc(e.message || 'You are not authorized to view this record.')}</b>
    <a class="btn btn-primary mt-3" href="#/home">Back to home</a></div>`;
}

function errorCard(e) { return blockedScreen(e); }

/* ---------- Assisted access ---------- */
function pageAssisted() {
  view().innerHTML = `
    <div class="page-head"><h1>Assisted Patient Access</h1>
      <p class="sub">For patients without a smartphone, with limited connectivity, or who need assistance. The patient still approves explicitly.</p></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:1.6rem">
      <div class="panel">
        <h3>1 · Verify patient identity</h3>
        <div class="field"><label>Patient name or ABHA number</label><input id="aQuery" placeholder="e.g. Meena Devi"></div>
        <button class="btn btn-ghost" id="aSearch">Search patient</button>
        <div id="aResults" class="mt-2"></div>
      </div>
      <div class="panel">
        <h3>2 · What is being requested?</h3>
        <div class="grid" style="gap:.6rem" id="aCats">
          ${[['medicines', true], ['allergies', true], ['reports', true], ['conditions', false], ['history', false]].map(([c, on]) => `<label class="cat-check ${on ? 'checked' : ''}"><input type="checkbox" value="${c}" ${on ? 'checked' : ''}> ${CAT_IC[c]} ${CAT_LABEL[c]}</label>`).join('')}
        </div>
        <div class="form-grid mt-2">
          <div class="field"><label>Purpose</label><select id="aPurpose"><option>Consultation</option><option>Follow-up</option><option>Emergency Care</option></select></div>
          <div class="field"><label>Duration</label><select id="aDur"><option value="15">15 minutes</option><option value="60" selected>1 hour</option><option value="1440">24 hours</option></select></div>
        </div>
      </div>
    </div>
    <div class="banner warn mt-3"><span>🤝</span><span><b>Workflow:</b> verify identity → choose information → hand the device to the patient → patient taps “I Approve” → temporary authorized access begins.</span></div>`;
  view().querySelectorAll('#aCats input').forEach(cb => cb.addEventListener('change', () => cb.closest('.cat-check').classList.toggle('checked', cb.checked)));
  document.getElementById('aSearch').addEventListener('click', async () => {
    const box = document.getElementById('aResults');
    box.innerHTML = '<span class="spinner" style="margin:1rem auto;display:block"></span>';
    try {
      const { patients } = await api('/provider/assisted/init', { body: { patientQuery: document.getElementById('aQuery').value } });
      box.innerHTML = patients.map(p => `<div class="notif-item mt-2"><span class="avatar">${esc(p.name.split(' ').map(x => x[0]).slice(0, 2).join(''))}</span>
        <div style="flex:1"><b>${esc(p.name)}</b><div class="small muted">${p.gender || ''}${p.dateOfBirth ? ' · ' + (new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear()) + ' yrs' : ''} · ABHA ${esc(p.abhaMasked)}</div></div>
        <button class="btn btn-primary btn-sm" data-pick="${p.id}" data-name="${esc(p.name)}">Select</button></div>`).join('');
      box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => startAssisted(Number(b.dataset.pick), b.dataset.name)));
    } catch (e) { box.innerHTML = `<div class="banner warn"><span>⚠️</span><span>${esc(e.message)}</span></div>`; }
  });
}

async function startAssisted(patientId, patientName) {
  const cats = [...view().querySelectorAll('#aCats input:checked')].map(c => c.value);
  try {
    const { request } = await api('/provider/assisted/request', { body: { patientId, categories: cats, purpose: document.getElementById('aPurpose').value, durationMin: Number(document.getElementById('aDur').value) } });
    // Hand device to patient for explicit approval.
    const m = modal({
      title: '🤝 Patient Approval Required',
      body: `<div class="text-center" style="padding:1rem 0">
        <p style="font-size:1.15rem"><b>${esc(patientName)}</b>, do you allow <b>${esc(ME.name)}</b> (${esc(PROV.organization)}) to view the selected health information?</p>
        <div class="chips mt-2 center" style="justify-content:center">${request.categoryLabels.map(l => `<span class="badge info">${esc(l)}</span>`).join('')}</div>
        <p class="small muted mt-2">Purpose: ${esc(request.purpose)} · Duration: ${request.durationMin} minutes. You can revoke this at any time from your CareVault account.</p>
        <div class="row center mt-3" style="gap:1rem">
          <button class="btn btn-accent btn-lg" data-a="y" style="min-width:180px">✓ I Approve</button>
          <button class="btn btn-ghost btn-lg" data-a="n" style="min-width:140px">No, thanks</button>
        </div></div>`,
    });
    m.el.querySelector('[data-a="y"]').addEventListener('click', async () => {
      try {
        await api('/provider/assisted/patient-approve', { body: { consentId: request.id, patientConfirmed: true } });
        m.close(); toast('Patient approved — access is active.', 'success');
        location.hash = `#/snapshot/${request.id}`;
      } catch (e) { toast(e.message, 'error'); }
    });
    m.el.querySelector('[data-a="n"]').addEventListener('click', async () => {
      m.close(); toast('The patient did not approve. No information was shared.', 'info');
    });
  } catch (e) { toast(e.message, 'error'); }
}

/* ---------- Notifications ---------- */
async function pageNotifications() {
  const { notifications } = await api('/notifications');
  view().innerHTML = `<div class="page-head row between"><div><h1>Notifications</h1></div>
    ${notifications.some(n => !n.read) ? '<button class="btn btn-ghost btn-sm" id="mk">Mark all as read</button>' : ''}</div>
    <div class="grid" style="gap:.6rem">${notifications.map(n => `<div class="notif-item ${n.read ? '' : 'unread'}">
      <span class="notif-ic">${{ granted: '✅', rejected: '✖️', revoked: '🚫', expiry: '⏳', info: 'ℹ️' }[n.type] || '🔔'}</span>
      <div style="flex:1"><div>${esc(n.message)}</div><div class="small muted">${timeAgo(n.createdAt)}</div></div></div>`).join('') || '<div class="empty card">No notifications.</div>'}</div>`;
  const mk = document.getElementById('mk');
  if (mk) mk.addEventListener('click', async () => { await api('/notifications/read', { body: {} }); pageNotifications(); });
}

/* ---------------- Router & boot ---------------- */
function render() {
  stopPollers();
  const hash = location.hash.slice(1) || '/home';
  const [route, arg] = hash.replace(/^\//, '').split('/');
  highlight();
  document.getElementById('pageTitle').textContent = { home: 'Clinic Home', scan: 'Scan', request: 'Access Request', snapshot: 'Health Snapshot', assisted: 'Assisted Access', notifications: 'Notifications' }[route] || '';
  if (route === 'home') pageHome();
  else if (route === 'scan') pageScan();
  else if (route === 'request' && arg) pageRequest(Number(arg));
  else if (route === 'snapshot' && arg) pageSnapshot(Number(arg));
  else if (route === 'assisted') pageAssisted();
  else if (route === 'notifications') pageNotifications();
  else pageHome();
}

async function boot() {
  try {
    const { user } = await api('/auth/me');
    if (!user) return location.href = '/login';
    if (user.role === 'patient') return location.href = '/app/patient';
    if (user.role === 'admin') return location.href = '/app/admin';
    ME = user; PROV = user.provider || {};
  } catch { return location.href = '/login'; }
  document.getElementById('userName').textContent = ME.name;
  document.getElementById('userAvatar').textContent = ME.name.replace(/^Dr\.\s*/, '').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('orgFoot').textContent = PROV.organization || '';
  renderSidebar();
  mountNetPill(document.getElementById('netHolder'));
  document.getElementById('bellHolder').innerHTML = ic('bell');
  document.getElementById('bellBtn').addEventListener('click', () => location.hash = '#/notifications');
  document.getElementById('logoutBtn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.href = '/login'; });
  document.getElementById('hamburger').addEventListener('click', () => { document.getElementById('sidebar').classList.add('open'); document.getElementById('sideBackdrop').classList.add('open'); });
  document.getElementById('sideBackdrop').addEventListener('click', closeSide);
  document.addEventListener('click', (e) => { if (e.target.closest('.side-link')) closeSide(); });
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/home';
  render();
}
boot();
})();
