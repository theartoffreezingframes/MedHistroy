/* ============================================================
   CareVault — Patient application
   ============================================================ */
(function () {
'use strict';
const { api, esc, fmtDate, fmtDateTime, timeAgo, greeting, countdown, toast, modal, t, setLang, getLang, LANG_NAMES, mountNetPill, voiceListen, handleVoiceCommand, ic, openDocument, CAT_LABEL, CAT_IC } = CV;

let ME = null;
let POLL = null;
const view = () => document.getElementById('view');

/* ---------------- Sidebar ---------------- */
const NAV = [
  { r: '/dashboard', k: 'Dashboard', i: 'dash' },
  { r: '/summary', k: 'Health Summary', i: 'heart' },
  { r: '/records', k: 'Medical Records', i: 'folder' },
  { r: '/medicines', k: 'Medicines', i: 'pill' },
  { r: '/allergies', k: 'Allergies', i: 'alert' },
  { r: '/reports', k: 'Reports', i: 'lab' },
  { r: '/visits', k: 'Visit History', i: 'clock' },
  { r: '/share', k: 'Share Records', i: 'share' },
  { r: '/consent', k: 'Consent & Access', i: 'shield' },
  { r: '/notifications', k: 'Notifications', i: 'bell', badge: 'pendingOrUnread' },
  { r: '/profile', k: 'Profile', i: 'user' },
  { r: '/settings', k: 'Settings', i: 'gear' },
];

function renderSidebar() {
  const nav = document.getElementById('sideNav');
  nav.innerHTML = NAV.map(n => `
    <a class="side-link" href="#${n.r}" data-route="${n.r}">${ic(n.i)}<span>${t(n.k)}</span>${n.badge ? `<span class="pill-count hidden" id="navBadge"></span>` : ''}</a>`).join('');
  document.getElementById('logoutBtn').innerHTML = `${ic('logout')}<span>${t('Logout')}</span>`;
  highlight();
}
function highlight() {
  const route = (location.hash.slice(1) || '/dashboard').split('?')[0];
  document.querySelectorAll('.side-link[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));
}
function closeSide() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sideBackdrop').classList.remove('open'); }

/* ---------------- Topbar ---------------- */
function initTopbar() {
  document.getElementById('searchIcon').innerHTML = ic('search');
  document.getElementById('voiceBtn').innerHTML = ic('mic');
  document.getElementById('bellHolder').innerHTML = ic('bell');
  mountNetPill(document.getElementById('netHolder'));

  const sel = document.getElementById('langSelect');
  sel.innerHTML = Object.entries(LANG_NAMES).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${v}</option>`).join('');
  sel.addEventListener('change', () => { setLang(sel.value); renderSidebar(); render(); toast(`Language: ${LANG_NAMES[sel.value]}`, 'success', 2000); });

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sideBackdrop').classList.add('open');
  });
  document.getElementById('sideBackdrop').addEventListener('click', closeSide);
  document.addEventListener('click', (e) => { if (e.target.closest('.side-link')) closeSide(); });

  document.getElementById('bellBtn').addEventListener('click', () => location.hash = '#/notifications');
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} }); location.href = '/login';
  });

  // Global search
  const input = document.getElementById('globalSearch');
  input.placeholder = t('Search medical records...');
  const pop = document.getElementById('searchPop');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { pop.classList.add('hidden'); return; }
    timer = setTimeout(async () => {
      try {
        const { groups } = await api(`/patient/search?q=${encodeURIComponent(q)}`);
        if (!groups.length) { pop.innerHTML = `<div class="empty small">No information is currently available for “${esc(q)}”.</div>`; }
        else pop.innerHTML = groups.map(g => `<div class="search-group">${esc(g.label)}</div>` +
          g.items.map(it => `<button class="search-item" data-link="${it.link}"><div class="t">${esc(it.title)}</div><div class="s">${esc(it.sub)}</div></button>`).join('')).join('');
        pop.classList.remove('hidden');
        pop.querySelectorAll('.search-item').forEach(b => b.addEventListener('click', () => { location.hash = '#' + b.dataset.link; pop.classList.add('hidden'); input.value = ''; }));
      } catch {}
    }, 250);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) pop.classList.add('hidden'); });

  // Voice
  document.getElementById('voiceBtn').addEventListener('click', () => {
    const m = modal({
      title: '🎤 Voice command',
      body: `<div class="text-center" style="padding:1.6rem 0">
        <div id="voiceIc" style="width:76px;height:76px;margin:0 auto 1.2rem;border-radius:50%;background:var(--coral-soft);display:grid;place-items:center;color:var(--coral)">
          <span class="spin" style="width:30px;height:30px"></span></div>
        <p id="voiceStatus" style="font-weight:650">Listening…</p>
        <p class="small muted mt-1">Try: “Show my medicines” · “Show my reports” · “Share my health records”</p></div>`,
    });
    const finish = (msg, ok) => {
      const st = m.body.querySelector('#voiceStatus');
      m.body.querySelector('#voiceIc').innerHTML = ok ? '<span style="font-size:1.9rem">✅</span>' : '<span style="font-size:1.9rem">🔇</span>';
      if (st) st.textContent = msg;
      setTimeout(m.close, 900);
    };
    voiceListen({
      onResult: (txt) => {
        const ok = handleVoiceCommand(txt);
        finish(ok ? `“${txt}” — got it!` : `“${txt}” — I didn't catch that command.`, ok);
        if (!ok) toast('Command not recognized. Try “show my medicines”.', 'warn');
      },
      onError: (why) => {
        if (why === 'unsupported') {
          // Realistic simulated voice interaction for browsers without speech recognition.
          const sim = 'Show my medicines';
          setTimeout(() => { handleVoiceCommand(sim); finish(`(Simulated) “${sim}” — got it!`, true); }, 1400);
        } else finish('Could not hear you. Please try again.', false);
      },
    });
  });
}

async function refreshBadges() {
  try {
    const d = await api('/patient/dashboard');
    const pending = d.counts.pendingRequests;
    const unread = d.counts.unreadNotifications;
    const total = pending + unread;
    const bc = document.getElementById('bellCount');
    bc.textContent = unread; bc.classList.toggle('hidden', !unread);
    const nb = document.getElementById('navBadge');
    if (nb) { nb.textContent = total; nb.classList.toggle('hidden', !total); }
    return d;
  } catch { return null; }
}

/* ---------------- Helpers ---------------- */
const pageHead = (title, sub, extra = '') => `<div class="page-head row between"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div>${extra}</div></div>`;
const statusBadge = (s) => ({
  ACTIVE: '<span class="badge ok"><span class="dot ok"></span>Active</span>',
  PENDING: '<span class="badge warn"><span class="dot warn"></span>Pending</span>',
  REVOKED: '<span class="badge danger">Revoked</span>',
  EXPIRED: '<span class="badge muted">Expired</span>',
  REJECTED: '<span class="badge muted">Rejected</span>',
}[s] || `<span class="badge muted">${esc(s)}</span>`);

/* ================= PAGES ================= */

async function pageDashboard() {
  const d = await api('/patient/dashboard');
  const first = ME.name.split(' ')[0];
  const abhaCard = d.patient.abhaConnected
    ? `<div class="banner ok"><span>🪪</span><span><b>ABHA Connected</b> · ${esc(d.patient.abhaId)} <span class="badge info">Demo Integration</span></span></div>`
    : `<div class="panel"><div class="row between"><div><b>Connect ABHA</b><p class="small muted">Link your Ayushman Bharat Health Account (demo mock).</p></div><button class="btn btn-primary btn-sm" onclick="location.hash='#/profile'">Connect ABHA</button></div></div>`;
  view().innerHTML = `
    ${pageHead(`${greeting()}, ${esc(first)}`, t('Your health information is under your control.'), `<span class="badge info">Demo Data</span>`)}
    <div class="stats">
      <a href="#/medicines" class="card stat-card click"><span class="ic">💊</span><span class="num">${d.counts.medicines}</span><span class="lbl">Current Medicines</span></a>
      <a href="#/allergies" class="card stat-card click"><span class="ic">⚠️</span><span class="num">${d.counts.allergies}</span><span class="lbl">Allergies</span></a>
      <a href="#/reports" class="card stat-card click"><span class="ic">🧪</span><span class="num">${d.counts.recentReports}</span><span class="lbl">Recent Reports</span></a>
      <a href="#/consent" class="card stat-card click"><span class="ic">🔓</span><span class="num">${d.counts.activeAccess}</span><span class="lbl">Active Access</span></a>
      <a href="#/records" class="card stat-card click"><span class="ic">📁</span><span class="num">${d.counts.records}</span><span class="lbl">Health Records</span></a>
    </div>
    <div class="grid mt-3" style="grid-template-columns:1.4fr 1fr">
      <div class="panel">
        <div class="panel-h"><h3>🧭 Quick actions</h3></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:.8rem">
          <a class="btn btn-ghost" href="#/share">${ic('qr')} Share records via QR</a>
          <a class="btn btn-ghost" href="#/records">${ic('folder')} Upload a record</a>
          <a class="btn btn-ghost" href="#/summary">${ic('heart')} View health summary</a>
          <a class="btn btn-ghost" href="#/consent">${ic('shield')} Manage consent</a>
        </div>
        <div class="mt-3">${abhaCard}</div>
        ${d.counts.pendingRequests ? `<div class="banner warn mt-2"><span>🔔</span><span><b>${d.counts.pendingRequests} access request(s)</b> waiting for your decision. <a class="link-btn" href="#/consent">Review now →</a></span></div>` : ''}
      </div>
      <div class="panel">
        <div class="panel-h"><h3>🔔 Recent notifications</h3><a class="link-btn small" href="#/notifications">See all</a></div>
        <div id="dashNotifs"><div class="empty"><span class="spinner" style="margin:0 auto"></div></div>
      </div>
    </div>`;
  const { notifications } = await api('/patient/notifications');
  const box = document.getElementById('dashNotifs');
  if (box) box.innerHTML = notifications.slice(0, 4).map(notifHTML).join('') || '<div class="empty">No notifications yet.</div>';
}

const NOTIF_ICON = { request: '🔔', granted: '🔓', revoked: '🚫', expiry: '⏳', warning: '⏳', document: '📄', visit: '🩺', rejected: '✖️', info: 'ℹ️' };
function notifHTML(n) {
  return `<div class="notif-item ${n.read ? '' : 'unread'}" style="margin-bottom:.6rem">
    <span class="notif-ic">${NOTIF_ICON[n.type] || '🔔'}</span>
    <div style="flex:1"><div>${esc(n.message)}</div><div class="small muted">${timeAgo(n.createdAt)}</div></div>
    ${n.link ? `<a class="btn btn-ghost btn-sm" href="#${n.link}">Open</a>` : ''}</div>`;
}

async function pageSummary() {
  const s = await api('/patient/summary');
  view().innerHTML = `
    ${pageHead('Health Summary', 'A verified, patient-controlled view of your health information.', `<button class="btn btn-primary" id="genSum">✨ Generate Health Summary</button>`)}
    <div id="aiSummaryBox"></div>
    <div class="panel mb-3">
      <div class="panel-h"><h3>👤 Patient Information</h3>${s.patient.abhaConnected ? '<span class="badge ok">ABHA Connected · Demo</span>' : ''}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="kv" style="display:block"><span class="k small">Name</span><div class="v" style="text-align:left">${esc(s.patient.name)}</div></div>
        <div class="kv" style="display:block"><span class="k small">Age</span><div class="v" style="text-align:left">${s.patient.age ?? '—'}</div></div>
        <div class="kv" style="display:block"><span class="k small">Gender</span><div class="v" style="text-align:left">${esc(s.patient.gender || '—')}</div></div>
        <div class="kv" style="display:block"><span class="k small">ABHA <span class="badge info">Demo</span></span><div class="v mono" style="text-align:left">${esc(s.patient.abhaId || 'Not linked')}</div></div>
      </div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="panel">
        <h3>🩺 Conditions</h3>
        ${s.conditions.length ? s.conditions.map(c => `
          <div class="snap-row"><div><b>${esc(c.name)}</b><div class="small muted">Source: ${esc(c.source || '—')} · Last updated: ${fmtDate(c.lastUpdated)}</div></div>
          <span class="badge ok">Verified</span></div>`).join('') : '<div class="empty">No information is currently available for this category.</div>'}
      </div>
      <div class="panel">
        <h3>⚠️ Allergies</h3>
        ${s.allergies.length ? s.allergies.map(a => `
          <div class="allergy-banner"><span style="font-size:1.4rem">⚠️</span>
            <div style="flex:1"><b style="font-size:1.08rem">${esc(a.substance)}</b>
            <div class="small">Reaction: ${esc(a.reaction || '—')}</div>
            <div class="small muted mt-1">Status: <b>${a.verified ? 'Patient Verified' : 'AI extracted — verify'}</b><br>Source: ${esc(a.sourceLabel || '—')}<br>Last verified: ${fmtDate(a.lastVerified)}</div></div>
          </div>`).join('') : '<div class="empty"><b>No allergy information recorded</b></div>'}
      </div>
    </div>
    <div class="panel mt-3">
      <div class="panel-h"><h3>💊 Current Medicines</h3></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Status</th><th>Source</th></tr></thead><tbody>
      ${s.medicines.map(m => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.dosage || '—')}</td><td>${esc(m.frequency || '—')}</td>
        <td><span class="badge ok">Active</span> ${m.verified ? '<span class="badge info">✓ Verified</span>' : ''}</td>
        <td>${m.sourceRecordId ? `<button class="link-btn" data-src="${m.sourceRecordId}">View Source</button>` : '<span class="muted small">Manual entry</span>'}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No information is currently available for this category.</td></tr>'}
      </tbody></table></div>
    </div>
    <div class="panel mt-3">
      <div class="panel-h"><h3>🧪 Recent Tests</h3></div>
      ${s.reports.length ? s.reports.map(r => {
        const tests = (r.extraction?.tests || []).map(tt => `${esc(tt.test)}: <b>${esc(tt.result)}${tt.unit ? ' ' + esc(tt.unit) : ''}</b>`).join(' · ');
        return `<div class="snap-row"><div><b>${esc(r.title)}</b><div class="small muted">${tests || 'Lab report'} · ${fmtDate(r.date)} · ${esc(r.provider || '')}</div></div>
        <button class="btn btn-ghost btn-sm" data-doc="${r.id}">View Original</button></div>`;
      }).join('') : '<div class="empty">No information is currently available for this category.</div>'}
    </div>
    <div class="panel mt-3">
      <div class="panel-h"><h3>🗓️ Recent Visits</h3><a class="link-btn" href="#/visits">Full history →</a></div>
      ${s.visits.slice(0, 3).map(v => `<div class="snap-row"><div><b>${esc(v.organization)}</b> — ${esc(v.reason)}<div class="small muted">${fmtDate(v.date)}</div></div></div>`).join('') || '<div class="empty">No visits recorded.</div>'}
    </div>`;

  document.getElementById('genSum').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Analyzing your records…';
    try {
      const { summary } = await api('/patient/summary/generate', { body: {} });
      document.getElementById('aiSummaryBox').innerHTML = renderAiSummary(summary);
      toast('Health summary generated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '✨ Generate Health Summary';
  });
  bindSourceAndViewButtons(view());
}

function renderAiSummary(s) {
  return `<div class="panel mb-3" style="border:1.5px solid var(--primary)">
    <div class="panel-h"><h3>✨ AI Health Summary</h3><span class="badge warn">AI generated — verify before use</span></div>
    ${s.sections.map(sec => `
      <div class="mb-2"><b>${esc(sec.title)}</b>
      <p class="muted small" style="margin:.2rem 0 .4rem">${esc(sec.text)}</p>
      ${sec.sources.length ? `<div class="chips">${sec.sources.slice(0, 5).map(src => `<span class="badge muted" title="${esc(src.doc)}">📄 ${esc(src.label)}<span class="muted"> · ${esc(src.doc)}</span></span>`).join('')}</div>` : ''}
      </div>`).join('')}
    <p class="small muted">Engine: ${esc(s.engineLabel)} · Generated ${fmtDateTime(s.generatedAt)}</p></div>`;
}

function bindSourceAndViewButtons(root) {
  root.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', async () => {
    try { const { record } = await api(`/records/${b.dataset.src}`); openDocument(record, { fileUrl: record.fileUrl ? `/files/${record.fileUrl.split('/').pop()}` : null }); }
    catch (e) { toast(e.message, 'error'); }
  }));
  root.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', async () => {
    try { const { record } = await api(`/records/${b.dataset.doc}`); openDocument(record, { fileUrl: record.fileUrl ? `/files/${record.fileUrl.split('/').pop()}` : null }); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

/* ---------------- Records page ---------------- */
let recFilter = 'all', recQuery = '';
async function pageRecords() {
  view().innerHTML = `
    ${pageHead('Medical Records', 'Upload documents and review AI-extracted information.', '<button class="btn btn-ghost btn-sm" id="manualBtn">+ Add record manually</button>')}
    <div class="panel mb-3" id="uploadPanel">
      <div class="dropzone" id="dropzone" role="button" tabindex="0">
        <div class="dz-ic">${ic('share')}</div>
        <b>Drag &amp; drop your document here</b>
        <p class="small muted mt-1">or <span class="link-btn">Choose File</span> · Supported: PDF, JPG, JPEG, PNG</p>
        <input type="file" id="fileInput" accept=".pdf,.jpg,.jpeg,.png" hidden>
      </div>
      <div class="grid mt-2 form-grid" id="uploadMeta">
        <div class="field"><label>Document type</label>
          <select id="upType"><option value="prescription">Prescription</option><option value="lab_report">Lab Report</option><option value="discharge_summary">Discharge Summary</option><option value="hospital_record">Hospital Record</option><option value="other">Other</option></select></div>
        <div class="field"><label>Provider (optional)</label><input id="upProvider" placeholder="e.g. ABC Clinic"></div>
      </div>
      <div id="uploadProgress" class="hidden mt-2">
        <div class="row between small mb-1"><span id="upLabel">Uploading…</span><span id="upPct">0%</span></div>
        <div class="progress"><div id="upBar" style="width:0%"></div></div>
      </div>
    </div>
    <div class="row between mb-2" style="flex-wrap:wrap">
      <div class="filter-row" id="filterRow">
        ${[['all','All'],['prescription','Prescriptions'],['lab_report','Lab Reports'],['hospital_record','Hospital Records'],['discharge_summary','Discharge Summaries'],['other','Other']]
          .map(f => `<button class="filter-chip ${recFilter === f[0] ? 'active' : ''}" data-f="${f[0]}">${f[1]}</button>`).join('')}
      </div>
      <div style="position:relative"><span class="search-icon">${ic('search')}</span>
        <input class="search-input" id="recSearch" placeholder="Search medical records..." value="${esc(recQuery)}" style="padding-left:2.6rem;min-width:250px"></div>
    </div>
    <div class="grid" id="recordsGrid" style="grid-template-columns:repeat(auto-fill,minmax(310px,1fr))"></div>`;

  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', () => fi.files[0] && uploadFile(fi.files[0]));
  document.getElementById('manualBtn').addEventListener('click', manualRecordModal);
  document.getElementById('recSearch').addEventListener('input', (e) => { recQuery = e.target.value; loadRecords(); });
  document.querySelectorAll('#filterRow .filter-chip').forEach(c => c.addEventListener('click', () => { recFilter = c.dataset.f; pageRecords(); }));
  loadRecords();
}

async function loadRecords() {
  const grid = document.getElementById('recordsGrid');
  if (!grid) return;
  const { records } = await api(`/records?type=${recFilter}&q=${encodeURIComponent(recQuery)}`);
  if (!records.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="big">🗂️</div>No records found for this filter.</div>'; return; }
  grid.innerHTML = records.map(r => {
    const ex = r.extraction;
    const exBits = [];
    if (ex) {
      (ex.medicines || []).slice(0, 2).forEach(m => exBits.push(`💊 ${esc(m.name)} ${esc(m.dosage || '')}`));
      (ex.tests || []).slice(0, 2).forEach(tt => exBits.push(`🧪 ${esc(tt.test)}: ${esc(tt.result)}`));
      (ex.diagnoses || []).slice(0, 1).forEach(dd => exBits.push(`🩺 ${esc(dd)}`));
    }
    const st = { pending: '<span class="badge muted">Pending</span>', processing: '<span class="badge warn"><span class="spin" style="width:10px;height:10px;border-width:2px"></span> Processing</span>', processed: '<span class="badge warn">AI Extracted — verify</span>', verified: '<span class="badge ok">Patient Verified</span>', rejected: '<span class="badge danger">Rejected</span>' }[r.processingStatus] || statusBadge(r.processingStatus);
    return `<div class="card record-card">
      <div class="record-top">
        <span class="doc-ic ${r.type}">${{ prescription: '📋', lab_report: '🧪', discharge_summary: '🏨', hospital_record: '🏥', other: '📄' }[r.type] || '📄'}</span>
        <div style="flex:1;min-width:0"><div class="record-title">${esc(r.title)}</div>
          <div class="record-meta"><span>${esc(r.provider || 'Unknown provider')}</span><span>📅 ${fmtDate(r.date)}</span><span>Uploaded ${fmtDate(r.createdAt)}</span></div></div>
      </div>
      <div class="chips">${st}${r.extractionStatus === 'patient_verified' ? '' : r.processingStatus === 'processed' ? '' : ''}</div>
      ${exBits.length ? `<div class="small muted" style="border-top:1px dashed var(--line);padding-top:.6rem">${exBits.join('<br>')}</div>` : ''}
      <div class="record-actions">
        <button class="btn btn-ghost btn-sm" data-view="${r.id}">${ic('eye')} View</button>
        ${r.fileUrl ? `<a class="btn btn-ghost btn-sm" href="/files/${r.fileUrl.split('/').pop()}" download>${ic('download')} Download</a>` : ''}
        ${r.processingStatus === 'pending' ? `<button class="btn btn-accent btn-sm" data-process="${r.id}">🧠 Process with AI</button>` : ''}
        ${r.processingStatus === 'processed' ? `<button class="btn btn-accent btn-sm" data-review="${r.id}">Review extraction</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-del="${r.id}" style="color:var(--coral)">${ic('trash')} Delete</button>
      </div></div>`;
  }).join('');

  grid.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', async () => {
    const { record } = await api(`/records/${b.dataset.view}`);
    openDocument(record, { fileUrl: record.fileUrl ? `/files/${record.fileUrl.split('/').pop()}` : null });
  }));
  grid.querySelectorAll('[data-process]').forEach(b => b.addEventListener('click', () => runProcessing(Number(b.dataset.process))));
  grid.querySelectorAll('[data-review]').forEach(b => b.addEventListener('click', () => reviewExtraction(Number(b.dataset.review))));
  grid.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const m = modal({ title: 'Delete record?', body: '<p>This will remove the document from your vault. Verified medicines/allergies created from it will be kept.</p>', foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-danger" data-a="d">Delete</button>' });
    m.el.querySelector('[data-a="c"]').onclick = m.close;
    m.el.querySelector('[data-a="d"]').onclick = async () => { await api(`/records/${b.dataset.del}`, { method: 'DELETE' }); m.close(); toast('Record deleted.', 'success'); loadRecords(); refreshBadges(); };
  }));
}

function uploadFile(file) {
  const prog = document.getElementById('uploadProgress');
  const bar = document.getElementById('upBar');
  const pct = document.getElementById('upPct');
  const lbl = document.getElementById('upLabel');
  prog.classList.remove('hidden');
  lbl.textContent = `Uploading ${file.name}…`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', document.getElementById('upType').value);
  fd.append('provider', document.getElementById('upProvider').value.trim());
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/records/upload');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); bar.style.width = p + '%'; pct.textContent = p + '%'; } };
  xhr.onload = async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const d = JSON.parse(xhr.responseText);
      lbl.textContent = 'Upload complete.';
      toast('Document uploaded. Processing…', 'success');
      runProcessing(d.record.id, file.name);
    } else {
      let msg = 'Upload failed.'; try { msg = JSON.parse(xhr.responseText).error.message; } catch {}
      toast(msg, 'error'); prog.classList.add('hidden');
    }
  };
  xhr.onerror = () => { toast('Connection interrupted. Please try again.', 'error'); prog.classList.add('hidden'); };
  xhr.send(fd);
}

async function runProcessing(recordId, fileName) {
  const m = modal({
    title: '🧠 AI Document Processing',
    body: `<div class="ai-steps" id="aiSteps">
      <div class="ai-step" data-s="0"><span class="spin"></span> Uploading document…</div>
      <div class="ai-step" data-s="1"><span class="spin"></span> Reading document…</div>
      <div class="ai-step" data-s="2"><span class="spin"></span> Extracting medical information…</div>
      <div class="ai-step" data-s="3"><span class="spin"></span> Organizing information…</div>
      <div class="ai-step" data-s="4"><span class="spin"></span> Ready for verification</div>
    </div>
    <div class="banner info"><span>ℹ️</span><span>Demo AI engine — no external service is called in this prototype. Output always requires your verification.</span></div>
    <div id="aiResult" class="mt-2"></div>`,
    onClose: () => { loadRecords(); refreshBadges(); },
  });
  const steps = m.body.querySelectorAll('.ai-step');
  const mark = (i, state) => { const el = steps[i]; el.className = 'ai-step ' + state; el.firstElementChild.outerHTML = state === 'done' ? '<svg class="check-pop" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' : state === 'on' ? '<span class="spin"></span>' : '<span style="width:18px"></span>'; };
  mark(0, 'done'); mark(1, 'on');
  await sleep(600); mark(1, 'done'); mark(2, 'on');
  const req = api('/records/process', { body: { recordId, fileName } });
  await sleep(850); mark(2, 'done'); mark(3, 'on');
  await sleep(700); mark(3, 'done'); mark(4, 'on');
  let data;
  try { data = await req; } catch (e) { toast(e.message, 'error'); m.close(); return; }
  mark(4, 'done');
  showExtractionResult(m.body.querySelector('#aiResult'), recordId, data.extraction, m);
}

function extractionRowsHTML(ex) {
  const rows = [];
  (ex.medicines || []).forEach(mm => rows.push(['Medicine', `${mm.name}`], ['Dose', mm.dosage || '—'], ['Frequency', mm.frequency || '—'], ...(mm.duration ? [['Duration', mm.duration]] : [])));
  (ex.tests || []).forEach(tt => rows.push(['Test', `${tt.test}`], ['Result', `${tt.result}${tt.unit ? ' ' + tt.unit : ''}`]));
  (ex.diagnoses || []).forEach(dd => rows.push(['Diagnosis', dd]));
  (ex.allergies || []).forEach(aa => rows.push(['Allergy', `${aa.substance} (${aa.reaction || 'reaction unknown'})`]));
  if (ex.doctor) rows.push(['Doctor', ex.doctor]);
  if (ex.date) rows.push(['Date', fmtDate(ex.date)]);
  if (ex.provider) rows.push(['Provider', ex.provider]);
  return rows.map(r => `<div class="kv" data-k="${esc(r[0])}"><span class="k">${esc(r[0])}</span><span class="v">${esc(r[1])}</span></div>`).join('');
}

function showExtractionResult(container, recordId, ex, ownerModal) {
  const closeModal = () => (ownerModal ? ownerModal.close() : document.querySelector('.modal-back')?.remove());
  container.innerHTML = `
    <div class="row between mb-1"><h3 style="margin:0">Information Detected</h3><span class="badge warn">AI extracted information — please verify before using</span></div>
    ${ex.uncertain ? '<div class="banner warn mb-2"><span>⚠️</span><span>Some information could not be confidently extracted. Please verify manually.</span></div>' : ''}
    <div id="exRows">${extractionRowsHTML(ex)}</div>
    <p class="small muted">Confidence: ${Math.round((ex.confidence || 0) * 100)}% · ${esc(ex.engineLabel || '')}</p>
    <div class="row mt-2" style="gap:.7rem;flex-wrap:wrap">
      <button class="btn btn-accent" id="exConfirm">✓ Confirm</button>
      <button class="btn btn-ghost" id="exEdit">✏️ Edit</button>
      <button class="btn btn-ghost" id="exReject" style="color:var(--coral)">✕ Reject</button>
    </div>`;
  let editing = false;
  container.querySelector('#exEdit').addEventListener('click', () => {
    editing = !editing;
    container.querySelectorAll('#exRows .kv').forEach(kv => {
      const v = kv.querySelector('.v');
      if (editing) { const cur = v.textContent; v.innerHTML = `<input value="${esc(cur)}" style="padding:.3rem .5rem;border:1.5px solid var(--line);border-radius:.5rem;width:100%">`; }
      else { const inp = v.querySelector('input'); if (inp) v.textContent = inp.value; }
    });
    container.querySelector('#exEdit').textContent = editing ? '✓ Done editing' : '✏️ Edit';
    if (!editing) applyEditsToExtraction(container, ex);
  });
  const applyEditsToExtraction = (root, ex2) => {
    const vals = [...root.querySelectorAll('#exRows .kv')].map(kv => [kv.dataset.k, kv.querySelector('.v').textContent.trim()]);
    const mm = (k) => { const f = vals.find(v => v[0] === k); return f ? f[1] : null; };
    if (ex2.medicines?.length) { ex2.medicines[0] = { ...ex2.medicines[0], name: mm('Medicine') || ex2.medicines[0].name, dosage: mm('Dose') || ex2.medicines[0].dosage, frequency: mm('Frequency') || ex2.medicines[0].frequency, duration: mm('Duration') || ex2.medicines[0].duration }; }
    if (ex2.doctor !== undefined && mm('Doctor')) ex2.doctor = mm('Doctor');
  };
  container.querySelector('#exConfirm').addEventListener('click', async () => {
    const res = await api(`/records/${recordId}/verify`, { body: { action: editing ? 'edit' : 'confirm', extraction: ex } });
    toast(res.applied && (res.applied.medicines || res.applied.allergies || res.applied.conditions) ? 'Confirmed — added to your health summary.' : 'Confirmed and verified.', 'success');
    closeModal();
  });
  container.querySelector('#exReject').addEventListener('click', async () => {
    await api(`/records/${recordId}/verify`, { body: { action: 'reject' } });
    toast('Extraction rejected. The document stays in your records.', 'info');
    closeModal();
  });
}

function manualRecordModal() {
  const m = modal({
    title: 'Add record manually',
    body: `<div class="field"><label>Title</label><input id="mrTitle" placeholder="e.g. OPD note from City Clinic"></div>
      <div class="form-grid"><div class="field"><label>Type</label><select id="mrType"><option value="prescription">Prescription</option><option value="lab_report">Lab Report</option><option value="discharge_summary">Discharge Summary</option><option value="hospital_record">Hospital Record</option><option value="other">Other</option></select></div>
      <div class="field"><label>Date</label><input id="mrDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <div class="field"><label>Provider</label><input id="mrProvider" placeholder="e.g. ABC Clinic"></div>
      <div class="field"><label>Notes</label><textarea id="mrNotes" rows="4" placeholder="Summary of the document"></textarea></div>`,
    foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="s">Save record</button>',
  });
  m.el.querySelector('[data-a="c"]').onclick = m.close;
  m.el.querySelector('[data-a="s"]').onclick = async () => {
    try {
      await api('/records/manual', { body: { title: m.el.querySelector('#mrTitle').value, type: m.el.querySelector('#mrType').value, provider: m.el.querySelector('#mrProvider').value, date: m.el.querySelector('#mrDate').value, notes: m.el.querySelector('#mrNotes').value } });
      toast('Record added.', 'success'); m.close(); loadRecords(); refreshBadges();
    } catch (e) { toast(e.message, 'error'); }
  };
}

async function reviewExtraction(id) {
  const { record } = await api(`/records/${id}`);
  if (!record.extraction) { toast('No extraction found. Try processing first.', 'warn'); return; }
  const m = modal({ title: `Review — ${esc(record.title)}`, body: '<div id="rvBox"></div>' });
  showExtractionResult(m.body.querySelector('#rvBox'), id, record.extraction, m);
}

/* ---------------- Medicines ---------------- */
async function pageMedicines() {
  const { medicines } = await api('/patient/medicines');
  const active = medicines.filter(m => m.status === 'active');
  view().innerHTML = `
    ${pageHead('My Medicines', 'Your medication passport — every entry links to a source document.')}
    ${active.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      ${active.map(m => `<div class="card consent-card">
        <div class="row between"><b style="font-size:1.15rem">💊 ${esc(m.name)}</b><span class="badge ok">Active</span></div>
        <div class="kv"><span class="k">Dose</span><span class="v">${esc(m.dosage || '—')}</span></div>
        <div class="kv"><span class="k">Frequency</span><span class="v">${esc(m.frequency || '—')}</span></div>
        ${m.duration ? `<div class="kv"><span class="k">Duration</span><span class="v">${esc(m.duration)}</span></div>` : ''}
        <div class="kv"><span class="k">Start date</span><span class="v">${fmtDate(m.startDate)}</span></div>
        <div class="kv"><span class="k">End date</span><span class="v">${m.endDate ? fmtDate(m.endDate) : 'Ongoing'}</span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${m.verified ? 'Patient Verified ✓' : 'AI extracted — verify'}</span></div>
        <div class="kv"><span class="k">Source</span><span class="v small">${m.sourceRecordId ? `${esc(m.sourceTitle || 'Source document')}` : 'Manual entry'}</span></div>
        <div class="kv"><span class="k">Last verified</span><span class="v">${fmtDate(m.lastVerified)}</span></div>
        <div class="row" style="gap:.6rem">
          ${m.verified ? '<span class="badge ok">✓ Confirmed</span>' : `<button class="btn btn-accent btn-sm" data-confirm="${m.id}">Confirm</button>`}
          <button class="btn btn-ghost btn-sm" data-edit="${m.id}">Edit</button>
          ${m.sourceRecordId ? `<button class="btn btn-ghost btn-sm" data-src="${m.sourceRecordId}">View Source</button>` : ''}
        </div></div>`).join('')}</div>` : '<div class="empty card"><div class="big">💊</div>No active medicines. Upload a prescription to get started.</div>'}
    ${medicines.some(m => m.status !== 'active') ? `<div class="panel mt-3"><h3>Past / stopped medicines</h3>${medicines.filter(m => m.status !== 'active').map(m => `<div class="snap-row"><span>${esc(m.name)} ${esc(m.dosage || '')}</span><span class="badge muted">${esc(m.status)}</span></div>`).join('')}</div>` : ''}`;
  bindSourceAndViewButtons(view());
  view().querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
    await api(`/patient/medicines/${b.dataset.confirm}`, { method: 'PUT', body: {} });
    toast('Medicine confirmed.', 'success'); pageMedicines();
  }));
  view().querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const med = medicines.find(x => x.id == b.dataset.edit);
    const m = modal({
      title: `Edit — ${esc(med.name)}`,
      body: `<div class="form-grid">
        <div class="field"><label>Name</label><input id="emName" value="${esc(med.name)}"></div>
        <div class="field"><label>Dose</label><input id="emDose" value="${esc(med.dosage || '')}"></div>
        <div class="field"><label>Frequency</label><input id="emFreq" value="${esc(med.frequency || '')}"></div>
        <div class="field"><label>Status</label><select id="emStatus"><option value="active" ${med.status === 'active' ? 'selected' : ''}>Active</option><option value="stopped" ${med.status === 'stopped' ? 'selected' : ''}>Stopped</option></select></div></div>`,
      foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="s">Save</button>',
    });
    m.el.querySelector('[data-a="c"]').onclick = m.close;
    m.el.querySelector('[data-a="s"]').onclick = async () => {
      await api(`/patient/medicines/${med.id}`, { method: 'PUT', body: { name: m.el.querySelector('#emName').value, dosage: m.el.querySelector('#emDose').value, frequency: m.el.querySelector('#emFreq').value, status: m.el.querySelector('#emStatus').value } });
      m.close(); toast('Medicine updated and verified.', 'success'); pageMedicines();
    };
  }));
}

/* ---------------- Allergies ---------------- */
async function pageAllergies() {
  const { allergies } = await api('/patient/allergies');
  view().innerHTML = `
    ${pageHead('My Allergies', 'Verified allergy information — shared prominently with providers you authorize.')}
    ${allergies.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      ${allergies.map(a => `<div class="card consent-card" style="border-top:4px solid var(--coral)">
        <div class="row between"><b style="font-size:1.2rem">⚠️ ${esc(a.substance)}</b><span class="badge ${a.verified ? 'ok' : 'warn'}">${a.verified ? 'Patient Verified' : 'Verify needed'}</span></div>
        <div class="kv"><span class="k">Reaction</span><span class="v">${esc(a.reaction || '—')}</span></div>
        <div class="kv"><span class="k">Severity</span><span class="v">${esc(a.severity || '—')}</span></div>
        <div class="kv"><span class="k">Source</span><span class="v small">${esc(a.sourceLabel || '—')}</span></div>
        <div class="kv"><span class="k">Last verified</span><span class="v">${fmtDate(a.lastVerified)}</span></div>
        <div class="row" style="gap:.6rem">
          <button class="btn btn-accent btn-sm" data-confirm="${a.id}">${a.verified ? 'Re-confirm' : 'Confirm'}</button>
          <button class="btn btn-ghost btn-sm" data-edit="${a.id}">Edit</button>
          ${a.sourceRecordId ? `<button class="btn btn-ghost btn-sm" data-src="${a.sourceRecordId}">View Source</button>` : ''}
        </div></div>`).join('')}</div>`
    : `<div class="empty card" style="padding:3rem"><div class="big">⚠️</div><b>No allergy information recorded</b><p class="small muted mt-1">CareVault only shows recorded allergy information — it never assumes “no allergies”.</p></div>`}`;
  bindSourceAndViewButtons(view());
  view().querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
    await api(`/patient/allergies/${b.dataset.confirm}`, { method: 'PUT', body: {} });
    toast('Allergy confirmed.', 'success'); pageAllergies();
  }));
  view().querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const al = allergies.find(x => x.id == b.dataset.edit);
    const m = modal({
      title: `Edit — ${esc(al.substance)}`,
      body: `<div class="field"><label>Substance</label><input id="eaSub" value="${esc(al.substance)}"></div>
        <div class="form-grid"><div class="field"><label>Reaction</label><input id="eaRe" value="${esc(al.reaction || '')}"></div>
        <div class="field"><label>Severity</label><select id="eaSe"><option ${al.severity === 'Mild' ? 'selected' : ''}>Mild</option><option ${al.severity === 'Moderate' ? 'selected' : ''}>Moderate</option><option ${al.severity === 'Severe' ? 'selected' : ''}>Severe</option></select></div></div>`,
      foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="s">Save</button>',
    });
    m.el.querySelector('[data-a="c"]').onclick = m.close;
    m.el.querySelector('[data-a="s"]').onclick = async () => {
      await api(`/patient/allergies/${al.id}`, { method: 'PUT', body: { substance: m.el.querySelector('#eaSub').value, reaction: m.el.querySelector('#eaRe').value, severity: m.el.querySelector('#eaSe').value } });
      m.close(); toast('Allergy updated.', 'success'); pageAllergies();
    };
  }));
}

/* ---------------- Reports / Visits / Notifications ---------------- */
async function pageReports() {
  const { records } = await api('/records?type=lab_report');
  view().innerHTML = `${pageHead('Reports', 'Your laboratory reports — always with the original document.')}` +
    (records.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(310px,1fr))">
      ${records.map(r => {
        const tt = (r.extraction?.tests || [])[0];
        return `<div class="card record-card"><div class="record-top"><span class="doc-ic lab_report">🧪</span>
          <div><div class="record-title">${esc(r.title)}</div><div class="record-meta"><span>${esc(r.provider || '')}</span><span>📅 ${fmtDate(r.date)}</span></div></div></div>
          ${tt ? `<div class="kv" style="border:1px solid var(--line);border-radius:.8rem;padding:.5rem .8rem"><span class="k">${esc(tt.test)}</span><span class="v">${esc(tt.result)}${tt.unit ? ' ' + esc(tt.unit) : ''}</span></div>` : ''}
          <div class="record-actions"><button class="btn btn-ghost btn-sm" data-doc="${r.id}">${ic('eye')} View Original</button></div></div>`;
      }).join('')}</div>` : '<div class="empty card"><div class="big">🧪</div>No reports yet.</div>');
  bindSourceAndViewButtons(view());
}

async function pageVisits() {
  const { visits } = await api('/patient/visits');
  view().innerHTML = `${pageHead('Visit History', 'A timeline of your healthcare visits.')}` +
    (visits.length ? `<div class="panel"><div class="timeline">
      ${visits.map(v => `<div class="tl-item">
        <div class="tl-date">${fmtDate(v.date)}</div>
        <h4>${esc(v.organization || v.providerName || 'Provider')}</h4>
        <p><b>${esc(v.reason)}</b>${v.notes ? ` — ${esc(v.notes)}` : ''}</p>
        ${v.medicines ? `<p>💊 ${esc(v.medicines)}</p>` : ''}${v.tests ? `<p>🧪 ${esc(v.tests)}</p>` : ''}${v.followUp ? `<p>🔁 Follow-up: ${esc(v.followUp)}</p>` : ''}
      </div>`).join('')}</div></div>` : '<div class="empty card"><div class="big">🗓️</div>No visits recorded yet.</div>');
}

async function pageNotifications() {
  const { notifications } = await api('/patient/notifications');
  view().innerHTML = `${pageHead('Notifications', 'Everything that happened with your records and consents.',
    notifications.some(n => !n.read) ? '<button class="btn btn-ghost btn-sm" id="markAll">Mark all as read</button>' : '')}
    <div class="grid" style="gap:.6rem">${notifications.map(notifHTML).join('') || '<div class="empty card">No notifications.</div>'}</div>`;
  const mk = document.getElementById('markAll');
  if (mk) mk.addEventListener('click', async () => { await api('/patient/notifications/read', { body: {} }); refreshBadges(); pageNotifications(); });
  setTimeout(refreshBadges, 400);
}

/* ---------------- Share (QR) ---------------- */
let SHARE = null;
async function pageShare() {
  view().innerHTML = `
    ${pageHead('Share My Health Records', 'Choose exactly what to share. The QR contains a secure temporary code — never your medical data.')}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:1.6rem" id="shareLayout">
      <div class="panel">
        <h3>What would you like to share?</h3>
        <div class="grid" style="gap:.7rem" id="catList">
          ${[['medicines', true], ['allergies', true], ['reports', true], ['conditions', true], ['history', false]].map(([c, on]) => `
            <label class="cat-check ${on ? 'checked' : ''}"><input type="checkbox" value="${c}" ${on ? 'checked' : ''}>
            <span>${CAT_IC[c]} ${CAT_LABEL[c]}</span>${c === 'history' ? '<span class="badge muted" style="margin-left:auto">Everything</span>' : ''}</label>`).join('')}
        </div>
        <div class="field mt-3"><label>Purpose</label>
          <select id="purpose"><option>Consultation</option><option>Follow-up</option><option>Emergency Care</option></select></div>
        <div class="field"><label>Access duration</label>
          <div class="row" style="flex-wrap:wrap;gap:.6rem" id="durRow">
            <label class="radio-pill"><input type="radio" name="dur" value="15">15 minutes</label>
            <label class="radio-pill checked"><input type="radio" name="dur" value="60" checked>1 hour</label>
            <label class="radio-pill"><input type="radio" name="dur" value="1440">24 hours</label>
            <label class="radio-pill"><input type="radio" name="dur" value="custom">Custom</label>
          </div>
          <div class="field hidden mt-2" id="customDurWrap"><label>Custom duration (minutes)</label><input type="number" id="customDur" min="1" max="10080" value="90"></div>
        </div>
        <button class="btn btn-primary btn-lg btn-block mt-2" id="genQr">${ic('qr')} Generate Secure QR</button>
      </div>
      <div id="qrSide"><div class="empty card" style="min-height:380px;display:flex;flex-direction:column;justify-content:center">
        <div class="big">📲</div><b>Your secure QR will appear here</b>
        <p class="small muted mt-1">Generated codes expire after 30 minutes if not used.</p></div></div>
    </div>`;
  document.querySelectorAll('#catList input').forEach(cb => cb.addEventListener('change', () => cb.closest('.cat-check').classList.toggle('checked', cb.checked)));
  document.querySelectorAll('#durRow input').forEach(r => r.addEventListener('change', () => {
    document.querySelectorAll('#durRow .radio-pill').forEach(p => p.classList.remove('checked'));
    r.closest('.radio-pill').classList.add('checked');
    document.getElementById('customDurWrap').classList.toggle('hidden', r.value !== 'custom');
  }));
  document.getElementById('genQr').addEventListener('click', generateQr);
}

async function generateQr() {
  const cats = [...document.querySelectorAll('#catList input:checked')].map(c => c.value);
  if (!cats.length) return toast('Select at least one category to share.', 'warn');
  const durRadio = document.querySelector('#durRow input:checked').value;
  const durationMin = durRadio === 'custom' ? Number(document.getElementById('customDur').value) : Number(durRadio);
  const purpose = document.getElementById('purpose').value;
  try {
    const { share } = await api('/consent/share-token', { body: { categories: cats, purpose, durationMin } });
    SHARE = share;
    renderQrSide();
    toast('Secure QR generated. Share it with your healthcare provider.', 'success');
    pollShareRequests();
  } catch (e) { toast(e.message, 'error'); }
}

function renderQrSide() {
  const side = document.getElementById('qrSide');
  if (!SHARE) return;
  side.innerHTML = `
    <div class="qr-box">
      <span class="badge ok"><span class="dot ok"></span>Share session active</span>
      <div class="qr-img"><img src="${SHARE.qrDataUrl}" alt="CareVault secure QR code"></div>
      <div class="text-center"><b>Share this QR with your healthcare provider.</b>
        <div class="small muted mt-1">Or give them the access code:</div>
        <div class="mono" style="font-size:1.5rem;font-weight:700;letter-spacing:.12em">${esc(SHARE.code)}</div></div>
      <div style="width:100%">
        <div class="kv"><span class="k">Selected information</span><span class="v small">${SHARE.categoryLabels.join(' · ')}</span></div>
        <div class="kv"><span class="k">Purpose</span><span class="v">${esc(SHARE.purpose)}</span></div>
        <div class="kv"><span class="k">Access duration</span><span class="v">${SHARE.durationMin} minutes</span></div>
        <div class="kv"><span class="k">QR expires</span><span class="v countdown" id="qrExpiry">${countdown(SHARE.expiresAt)}</span></div>
        <div class="kv"><span class="k">Consent status</span><span class="v" id="shareStatus">${statusBadge('PENDING')} <span class="muted small">waiting for provider…</span></span></div>
      </div>
      <button class="btn btn-danger btn-block" id="cancelShare">Cancel Sharing</button>
    </div>`;
  document.getElementById('cancelShare').addEventListener('click', async () => {
    await api(`/consent/share-token/${SHARE.code}`, { method: 'DELETE' });
    SHARE = null; toast('Sharing cancelled.', 'info'); pageShare();
  });
  if (!window._qrTimer) window._qrTimer = setInterval(() => {
    const el = document.getElementById('qrExpiry');
    if (el && SHARE) el.textContent = countdown(SHARE.expiresAt);
  }, 1000);
}

async function pollShareRequests() {
  if (!SHARE || (location.hash.slice(1) || '').split('?')[0] !== '/share') return;
  try {
    const { requests } = await api('/consent/pending');
    const st = document.getElementById('shareStatus');
    if (st && requests.length) st.innerHTML = `${statusBadge('PENDING')} <span class="small" style="color:var(--amber)"><b>${esc(requests[0].provider.organization)}</b> is waiting for your consent → <a class="link-btn" href="#/consent">decide now</a></span>`;
  } catch {}
  if (SHARE) setTimeout(pollShareRequests, 5000);
}

/* ---------------- Consent & Access ---------------- */
async function pageConsent() {
  view().innerHTML = `${pageHead('Consent & Access', 'See who has access, what was shared, why — and revoke any time.')}
    <div id="consentBody"><div class="empty"><span class="spinner" style="margin:0 auto"></span></div></div>`;
  const [active, pending, history, logs] = await Promise.all([
    api('/consent/active'), api('/consent/pending'), api('/consent/history'), api('/consent/access-logs'),
  ]);
  const body = document.getElementById('consentBody');
  body.innerHTML = `
    ${pending.requests.length ? `<div class="panel mb-3" style="border:2px solid var(--amber)">
      <h3>🔔 Access Request${pending.requests.length > 1 ? 's' : ''}</h3>
      ${pending.requests.map(reqHTML).join('')}</div>` : ''}
    <div class="panel mb-3">
      <h3>🟢 Active Access</h3>
      ${active.consents.length ? active.consents.map(c => `
        <div class="consent-card" style="border:1px solid var(--line);border-radius:1rem">
          <div class="row between" style="flex-wrap:wrap"><b style="font-size:1.1rem">${esc(c.provider.organization)}</b>
            <span class="countdown badge ${CV.minsLeft(c.expiresAt) <= 10 ? 'warn' : 'ok'}" data-cd="${c.expiresAt}">⏳ ${countdown(c.expiresAt)}</span></div>
          <div class="small muted">Provider: ${esc(c.provider.providerName)}</div>
          <div class="kv"><span class="k">Shared</span><span class="v small">${c.categories.map(x => CAT_LABEL[x]).join(' + ')}</span></div>
          <div class="kv"><span class="k">Purpose</span><span class="v">${esc(c.purpose)}</span></div>
          <div class="kv"><span class="k">Mode</span><span class="v">${c.mode === 'assisted' ? 'Assisted access' : 'QR sharing'}</span></div>
          <div class="kv"><span class="k">Expires</span><span class="v">${CV.minsLeft(c.expiresAt)} minutes</span></div>
          <button class="btn btn-danger btn-lg" data-revoke="${c.id}">Revoke Access</button>
        </div>`).join('') : '<div class="empty">No active access. You are not sharing with anyone right now. 🛡️</div>'}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="panel"><h3>🕘 Consent History</h3>
        ${history.consents.length ? `<div class="timeline">${history.consents.map(c => `
          <div class="tl-item"><div class="tl-date">${fmtDate(c.decidedAt || c.createdAt)}</div>
          <h4>${esc(c.provider.organization)}</h4>
          <p>Access ${c.status === 'ACTIVE' ? 'granted' : c.status.toLowerCase()} · ${esc(c.purpose)}</p>
          <p class="small">Shared: ${c.categories.map(x => CAT_LABEL[x]).join(' + ')}</p>
          <p>${statusBadge(c.status)} ${c.mode === 'assisted' ? '<span class="badge info">Assisted</span>' : ''}</p></div>`).join('')}</div>` : '<div class="empty">No consent history yet.</div>'}
      </div>
      <div class="panel"><h3>📜 Access Log</h3>
        <div class="table-wrap" style="border:none"><table class="tbl"><thead><tr><th>Date</th><th>Provider</th><th>Action</th></tr></thead><tbody>
        ${logs.logs.slice(0, 12).map(l => `<tr><td class="small">${fmtDateTime(l.timestamp)}</td><td>${esc(l.providerLabel || 'You')}</td>
          <td><span class="badge ${{ ACCESS_GRANTED: 'ok', ACCESS_REVOKED: 'danger', ACCESS_REJECTED: 'muted', ACCESS_EXPIRED: 'muted', RECORDS_VIEWED: 'info', DOCUMENT_VIEWED: 'info', VISIT_ADDED: 'info', ACCESS_REQUESTED: 'warn' }[l.action] || 'muted'}">${esc(l.action.replaceAll('_', ' ').toLowerCase())}</span></td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">No events yet.</td></tr>'}
        </tbody></table></div>
      </div>
    </div>`;

  // Pending request interactions
  body.querySelectorAll('[data-allow]').forEach(b => b.addEventListener('click', async () => {
    try {
      const { consent } = await api('/consent/approve', { body: { consentId: Number(b.dataset.allow) } });
      grantedModal(consent);
      refreshBadges(); setTimeout(pageConsent, 400);
    } catch (e) { toast(e.message, 'error'); }
  }));
  body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
    try { await api('/consent/reject', { body: { consentId: Number(b.dataset.reject) } }); toast('Request rejected.', 'info'); refreshBadges(); pageConsent(); }
    catch (e) { toast(e.message, 'error'); }
  }));
  body.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => revokeModal(Number(b.dataset.revoke))));
  // live countdown
  if (!window._cdTimer) window._cdTimer = setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = '⏳ ' + countdown(el.dataset.cd); });
  }, 1000);
  // Poll for new pending requests while on this page.
  clearInterval(window._consentPoll);
  window._consentPoll = setInterval(async () => {
    if ((location.hash.slice(1) || '') !== '/consent') return clearInterval(window._consentPoll);
    try { const { requests } = await api('/consent/pending'); if (requests.length !== body.querySelectorAll('[data-allow]').length) pageConsent(); } catch {}
  }, 6000);
}

function reqHTML(r) {
  return `<div class="consent-card" style="border:1px solid var(--line);border-radius:1rem">
    <p style="font-size:1.05rem;margin:0"><b>${esc(r.provider.providerName)}</b> from <b>${esc(r.provider.organization)}</b> is requesting access to your health information.</p>
    <div class="chips mt-2">${r.categories.map(c => `<span class="badge info">${CAT_IC[c]} ${CAT_LABEL[c]}</span>`).join('')}</div>
    <div class="kv mt-2"><span class="k">Purpose</span><span class="v">${esc(r.purpose)}</span></div>
    <div class="kv"><span class="k">Duration</span><span class="v">${r.durationMin} minutes</span></div>
    <div class="kv"><span class="k">Requested</span><span class="v">${timeAgo(r.createdAt)}</span></div>
    ${r.mode === 'assisted' ? '<div class="banner info"><span>🤝</span><span>Assisted access — the patient is present at the clinic.</span></div>' : ''}
    <div class="row" style="gap:.8rem">
      <button class="btn btn-accent btn-lg" style="flex:1" data-allow="${r.id}">Allow Access</button>
      <button class="btn btn-ghost btn-lg" style="flex:1" data-reject="${r.id}">Reject</button>
    </div></div>`;
}

function grantedModal(consent) {
  modal({
    title: '✅ Access Granted',
    body: `<div class="text-center" style="padding:.6rem 0 1.2rem">
        <div style="width:74px;height:74px;margin:0 auto 1rem;border-radius:50%;background:var(--success-soft);display:grid;place-items:center;color:var(--success)">${ic('check')}</div>
        <b style="font-size:1.2rem">${esc(consent.provider.organization)}</b>
        <p class="muted mt-1">can now view the selected information.</p></div>
      <div class="kv"><span class="k">What was shared</span><span class="v small">${consent.categories.map(x => CAT_LABEL[x]).join(' + ')}</span></div>
      <div class="kv"><span class="k">Who received access</span><span class="v">${esc(consent.provider.providerName)}</span></div>
      <div class="kv"><span class="k">Purpose</span><span class="v">${esc(consent.purpose)}</span></div>
      <div class="kv"><span class="k">Start time</span><span class="v">${fmtDateTime(consent.decidedAt)}</span></div>
      <div class="kv"><span class="k">Expiry time</span><span class="v">${fmtDateTime(consent.expiresAt)}</span></div>`,
    foot: '<button class="btn btn-primary" onclick="this.closest(\'.modal-back\').remove();location.hash=\'#/consent\'">View Active Access</button>',
  });
}

function revokeModal(consentId) {
  const m = modal({
    title: 'Revoke Access?',
    body: `<p><b>ABC Primary Care Clinic</b> will no longer have active access through this consent session.</p>
      <p class="small muted">The provider will immediately see an “Access Revoked” screen. This is recorded in your access log.</p>`,
    foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-danger" data-a="r">Revoke Access</button>',
  });
  // Fetch the actual org name for accuracy.
  api('/consent/active').then(({ consents }) => {
    const c = consents.find(x => x.id === consentId);
    if (c) m.body.innerHTML = m.body.innerHTML.replace('ABC Primary Care Clinic', esc(c.provider.organization));
  }).catch(() => {});
  m.el.querySelector('[data-a="c"]').onclick = m.close;
  m.el.querySelector('[data-a="r"]').onclick = async () => {
    try {
      await api('/consent/revoke', { body: { consentId } });
      m.close();
      modal({ title: '✓ Access Revoked', body: `<div class="text-center" style="padding:1rem 0">
        <div style="width:74px;height:74px;margin:0 auto 1rem;border-radius:50%;background:var(--success-soft);display:grid;place-items:center;color:var(--success)">${ic('check')}</div>
        <b style="font-size:1.2rem">Access Revoked</b>
        <p class="muted mt-1">The provider no longer has active access. Status updated to <b>REVOKED</b>.</p></div>`,
        foot: '<button class="btn btn-primary" onclick="this.closest(\'.modal-back\').remove()">Done</button>' });
      refreshBadges(); setTimeout(pageConsent, 400);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- Profile / Settings ---------------- */
async function pageProfile() {
  const { patient } = await api('/patient/profile');
  view().innerHTML = `
    ${pageHead('Profile', 'Your personal and ABHA details.')}
    <div class="grid" style="grid-template-columns:1.2fr .8fr">
      <div class="panel">
        <h3>👤 Personal details</h3>
        <div class="form-grid">
          <div class="field"><label>Full name</label><input id="pfName" value="${esc(patient.name)}"></div>
          <div class="field"><label>Phone</label><input id="pfPhone" value="${esc(patient.phone || '')}"></div>
          <div class="field"><label>Date of birth</label><input id="pfDob" type="date" value="${(patient.dateOfBirth || '').slice(0, 10)}"></div>
          <div class="field"><label>Gender</label><select id="pfGender"><option ${patient.gender === 'Male' ? 'selected' : ''}>Male</option><option ${patient.gender === 'Female' ? 'selected' : ''}>Female</option><option ${patient.gender === 'Other' ? 'selected' : ''}>Other</option></select></div>
          <div class="field"><label>Blood group</label><input id="pfBlood" value="${esc(patient.bloodGroup || '')}"></div>
          <div class="field"><label>Location</label><input id="pfLoc" value="${esc(patient.location || '')}"></div>
        </div>
        <button class="btn btn-primary" id="pfSave">Save changes</button>
      </div>
      <div class="panel">
        <h3>🪪 ABHA Connection</h3>
        ${patient.abhaConnected ? `
          <div class="banner ok"><span>✅</span><span><b>ABHA Connected</b><br><span class="mono">${esc(patient.abhaId)}</span></span></div>
          <p class="small muted mt-2">Demo Integration — this prototype is not connected to the live ABDM system. The backend is ready for real ABDM integration.</p>
          <button class="btn btn-ghost btn-sm mt-2" id="abhaRe">Re-link different ABHA</button>` : `
          <p class="muted small">Link your Ayushman Bharat Health Account to connect CareVault with the national health infrastructure (demo).</p>
          <button class="btn btn-primary mt-2" id="abhaGo">Connect ABHA</button>`}
      </div>
    </div>`;
  document.getElementById('pfSave').addEventListener('click', async () => {
    await api('/patient/profile', { method: 'PUT', body: { name: pf('pfName'), phone: pf('pfPhone'), dateOfBirth: pf('pfDob'), gender: pf('pfGender'), bloodGroup: pf('pfBlood'), location: pf('pfLoc') } });
    toast('Profile updated.', 'success'); boot(false);
  });
  const pf = (id) => document.getElementById(id).value;
  const openAbha = () => {
    const m = modal({
      title: 'Connect ABHA <span class="badge info">Demo Integration</span>',
      body: `<div class="banner info mb-2"><span>ℹ️</span><span>This is a <b>mock integration</b>. No real ABDM APIs are called in this prototype.</span></div>
        <div class="field"><label>Enter your ABHA number</label><input id="abhaIn" placeholder="XX-XXXX-XXXX-0000" value="${patient.abhaId || ''}"></div>
        <div id="abhaSteps"></div>`,
      foot: '<button class="btn btn-ghost" data-a="c">Cancel</button><button class="btn btn-primary" data-a="v">Verify &amp; Connect</button>',
    });
    m.el.querySelector('[data-a="c"]').onclick = m.close;
    m.el.querySelector('[data-a="v"]').onclick = async () => {
      const steps = m.el.querySelector('#abhaSteps');
      steps.innerHTML = '<div class="ai-steps"><div class="ai-step on"><span class="spin"></span> Verifying ABHA number…</div></div>';
      await new Promise(r => setTimeout(r, 1100));
      try {
        await api('/patient/abha/connect', { body: { abhaId: m.el.querySelector('#abhaIn').value } });
        steps.innerHTML = '<div class="banner ok"><span>✅</span><span><b>ABHA Connected ✓</b> (Demo Integration)</span></div>';
        toast('ABHA Connected (demo).', 'success');
        setTimeout(() => { m.close(); pageProfile(); }, 900);
      } catch (e) { toast(e.message, 'error'); steps.innerHTML = ''; }
    };
  };
  const go = document.getElementById('abhaGo'); if (go) go.addEventListener('click', openAbha);
  const re = document.getElementById('abhaRe'); if (re) re.addEventListener('click', openAbha);
}

function pageSettings() {
  view().innerHTML = `
    ${pageHead('Settings', 'Language, connectivity and demo controls.')}
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="panel">
        <h3>🌐 Language</h3>
        <p class="small muted">Choose your interface language. More Indian languages can be added.</p>
        <div class="grid mt-2" style="gap:.6rem">
          ${Object.entries(LANG_NAMES).map(([k, v]) => `<label class="cat-check ${k === getLang() ? 'checked' : ''}"><input type="radio" name="langSet" value="${k}" ${k === getLang() ? 'checked' : ''}> ${v}</label>`).join('')}
        </div>
      </div>
      <div class="panel">
        <h3>📶 Connectivity</h3>
        <p class="small muted">CareVault is optimized for mobile networks: lightweight pages, compressed responses, minimal images.</p>
        <div id="netInfo" class="mt-2"></div>
        <div class="banner info mt-2"><span>💡</span><span>Current status is shown in the top bar. The app stays usable on slow connections.</span></div>
      </div>
    </div>`;
  mountNetPill(document.getElementById('netInfo'));
  view().querySelectorAll('input[name="langSet"]').forEach(r => r.addEventListener('change', () => { setLang(r.value); renderSidebar(); document.getElementById('globalSearch').placeholder = t('Search medical records...'); toast(`Language: ${LANG_NAMES[r.value]}`, 'success'); pageSettings(); }));
}

/* ---------------- Router & boot ---------------- */
const ROUTES = {
  '/dashboard': pageDashboard, '/summary': pageSummary, '/records': pageRecords,
  '/medicines': pageMedicines, '/allergies': pageAllergies, '/reports': pageReports,
  '/visits': pageVisits, '/share': pageShare, '/consent': pageConsent,
  '/notifications': pageNotifications, '/profile': pageProfile, '/settings': pageSettings,
};

async function render() {
  clearInterval(window._consentPoll);
  const route = (location.hash.slice(1) || '/dashboard').split('?')[0];
  const fn = ROUTES[route] || pageDashboard;
  highlight();
  try { await fn(); }
  catch (e) {
    if (e?.code === 'NETWORK') view().innerHTML = `<div class="empty card"><div class="big">📡</div><b>Connection interrupted. Please try again.</b><button class="btn btn-primary mt-3" onclick="location.reload()">Retry</button></div>`;
    else { view().innerHTML = `<div class="empty card"><div class="big">⚠️</div><b>${esc(e?.message || 'Something went wrong.')}</b></div>`; }
  }
}

async function boot(first = true) {
  try {
    const { user } = await api('/auth/me');
    if (!user) return location.href = '/login';
    if (user.role === 'provider') return location.href = '/app/provider';
    if (user.role === 'admin') return location.href = '/app/admin';
    ME = user;
  } catch { return location.href = '/login'; }
  document.getElementById('userName').textContent = ME.name.split(' ')[0];
  document.getElementById('userAvatar').textContent = ME.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('abhaFoot').innerHTML = ME.profile?.abhaConnected ? `🪪 ABHA <span class="mono small">${esc(ME.profile.abhaId)}</span> <span class="badge info">Demo</span>` : '🪪 ABHA not linked';
  if (first) { renderSidebar(); initTopbar(); window.addEventListener('hashchange', render); if (!location.hash) location.hash = '#/dashboard'; render(); }
  refreshBadges();
  clearInterval(POLL);
  POLL = setInterval(refreshBadges, 12000);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
boot();
})();
