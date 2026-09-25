/* ============================================================
   CareVault — shared UI library
   ============================================================ */
window.CV = (function () {
  'use strict';

  /* ---------- API helper ---------- */
  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
    if (opts.body && !(opts.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    } else if (opts.body) init.body = opts.body;
    if (opts.method) init.method = opts.method;
    let res;
    try { res = await fetch('/api' + path, init); }
    catch { throw { code: 'NETWORK', message: 'Connection interrupted. Please try again.' }; }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = data?.error || { code: 'ERROR', message: 'Something went wrong.' };
      if (err.code === 'UNAUTHORIZED' && !path.startsWith('/auth')) { location.href = '/login'; return; }
      throw err;
    }
    return data;
  }

  /* ---------- HTML escape ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Dates ---------- */
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const timeAgo = (iso) => {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    return fmtDate(iso);
  };
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const minsLeft = (iso) => Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  const countdown = (iso) => {
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) return '0:00';
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  /* ---------- Toasts ---------- */
  function toastWrap() {
    let w = document.querySelector('.toast-wrap');
    if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
    return w;
  }
  function toast(msg, type = 'info', ms = 4200) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = `<span>${esc(msg)}</span>`;
    toastWrap().appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
  }

  /* ---------- Modal ---------- */
  function modal({ title, body, foot, wide = false, onClose } = {}) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${title || ''}</h3><button class="x-btn" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        </button></div>
        <div class="modal-body"></div>
        ${foot ? '<div class="modal-foot"></div>' : ''}
      </div>`;
    const bodyEl = back.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (foot) { const f = back.querySelector('.modal-foot'); if (typeof foot === 'string') f.innerHTML = foot; else f.appendChild(foot); }
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.querySelector('.x-btn').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    return { el: back, body: bodyEl, close };
  }

  /* ---------- i18n (English / Hindi / Telugu) ---------- */
  const DICT = {
    en: {},
    hi: {
      'Dashboard': 'डैशबोर्ड', 'Health Summary': 'स्वास्थ्य सारांश', 'Medical Records': 'चिकित्सा रिकॉर्ड',
      'Medicines': 'दवाएँ', 'Allergies': 'एलर्जी', 'Reports': 'रिपोर्ट', 'Visit History': 'विज़िट इतिहास',
      'Share Records': 'रिकॉर्ड साझा करें', 'Consent & Access': 'सहमति और पहुँच', 'Notifications': 'सूचनाएँ',
      'Profile': 'प्रोफ़ाइल', 'Settings': 'सेटिंग्स', 'Logout': 'लॉग आउट', 'Search medical records...': 'मेडिकल रिकॉर्ड खोजें...',
      'Generate Secure QR': 'सुरक्षित QR बनाएँ', 'Allow Access': 'पहुँच की अनुमति दें', 'Reject': 'अस्वीकार करें',
      'Revoke Access': 'पहुँच रद्द करें', 'View Original': 'मूल देखें', 'View Source': 'स्रोत देखें',
      'Your health information is under your control.': 'आपकी स्वास्थ्य जानकारी आपके नियंत्रण में है।',
      'Language': 'भाषा', 'Connection: Good': 'कनेक्शन: अच्छा', 'Limited connectivity': 'सीमित कनेक्टिविटी',
    },
    te: {
      'Dashboard': 'డాష్‌బోర్డ్', 'Health Summary': 'ఆరోగ్య సారాంశం', 'Medical Records': 'వైద్య రికార్డులు',
      'Medicines': 'మందులు', 'Allergies': 'అలర్జీలు', 'Reports': 'నివేదికలు', 'Visit History': 'సందర్శన చరిత్ర',
      'Share Records': 'రికార్డులను పంచుకోండి', 'Consent & Access': 'అనుమతి & ప్రాప్యత', 'Notifications': 'నోటిఫికేషన్లు',
      'Profile': 'ప్రొఫైల్', 'Settings': 'సెట్టింగ్‌లు', 'Logout': 'లాగ్ అవుట్', 'Search medical records...': 'వైద్య రికార్డులు వెతకండి...',
      'Generate Secure QR': 'సురక్షిత QR సృష్టించండి', 'Allow Access': 'ప్రాప్యతకు అనుమతించండి', 'Reject': 'తిరస్కరించండి',
      'Revoke Access': 'ప్రాప్యతను రద్దు చేండి', 'View Original': 'అసలు చూడండి', 'View Source': 'మూలం చూడండి',
      'Your health information is under your control.': 'మీ ఆరోగ్య సమాచారం మీ నియంత్రణలో ఉంది.',
      'Language': 'భాష', 'Connection: Good': 'కనెక్షన్: మంచిది', 'Limited connectivity': 'పరిమిత కనెక్టివిటీ',
    },
  };
  let lang = localStorage.getItem('cv_lang') || 'en';
  const t = (key) => (DICT[lang] && DICT[lang][key]) || key;
  const setLang = (l) => { lang = l; localStorage.setItem('cv_lang', l); document.dispatchEvent(new CustomEvent('cv:lang')); };
  const getLang = () => lang;
  const LANG_NAMES = { en: 'English', hi: 'हिन्दी (Hindi)', te: 'తెలుగు (Telugu)' };

  /* ---------- Connectivity indicator ---------- */
  function netStatus() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const online = navigator.onLine;
    const type = conn?.effectiveType;
    const good = online && (!type || !/slow-2g|2g/.test(type));
    return { good, label: !online ? 'Offline' : good ? t('Connection: Good') : t('Limited connectivity') };
  }
  function mountNetPill(container) {
    const pill = document.createElement('span');
    pill.className = 'net-pill';
    const render = () => {
      const s = netStatus();
      pill.innerHTML = `<span class="dot ${s.good ? 'ok' : 'warn'}"></span><span class="lbl">${esc(s.label)}</span>`;
      pill.title = s.label;
    };
    render();
    container.appendChild(pill);
    window.addEventListener('online', render); window.addEventListener('offline', render);
    const conn = navigator.connection; if (conn) conn.addEventListener?.('change', render);
    setInterval(render, 15000);
  }

  /* ---------- Voice ---------- */
  function voiceListen({ onStart, onResult, onError }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError && onError('unsupported'); return; }
    const rec = new SR();
    rec.lang = lang === 'hi' ? 'hi-IN' : lang === 'te' ? 'te-IN' : 'en-IN';
    rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => onStart && onStart();
    rec.onresult = (e) => onResult && onResult(e.results[0][0].transcript);
    rec.onerror = (e) => onError && onError(e.error || 'error');
    rec.onend = () => onStart && onStart(false);
    try { rec.start(); } catch { onError && onError('error'); }
  }
  const VOICE_COMMANDS = [
    { match: /medicine|दवा/, route: '/medicines' },
    { match: /report|lab|रिपोर्ट/, route: '/reports' },
    { match: /allerg|एलर्जी/, route: '/allergies' },
    { match: /share|साझा/, route: '/share' },
    { match: /consent|सहमति/, route: '/consent' },
    { match: /record|रिकॉर्ड/, route: '/records' },
    { match: /summar|सारांश/, route: '/summary' },
    { match: /visit/, route: '/visits' },
    { match: /notification|सूचना/, route: '/notifications' },
    { match: /dashboard|होम/, route: '/dashboard' },
  ];
  function handleVoiceCommand(text) {
    for (const c of VOICE_COMMANDS) if (c.match.test(text)) { location.hash = '#' + c.route; return true; }
    return false;
  }

  /* ---------- Icons ---------- */
  const I = {
    dash: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" stroke-width="2"/><rect x="13" y="10" width="8" height="11" rx="2" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="2"/></svg>',
    heart: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 21C7 16.5 3 13 3 8.9 3 6 5.2 4 7.8 4c1.7 0 3.3.9 4.2 2.3C12.9 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.9c0 4.1-4 7.6-9 12.1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    folder: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    pill: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="9" width="17" height="7" rx="3.5" transform="rotate(-35 12 12.5)" stroke="currentColor" stroke-width="2"/><path d="M9.2 8.4l5 6.9" stroke="currentColor" stroke-width="2"/></svg>',
    alert: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 20h19L12 3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/></svg>',
    lab: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M9 3h6M10 3v6l-5.2 8.7A2 2 0 006.5 21h11a2 2 0 001.7-3.3L14 9V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    share: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shield: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.6C8 19.4 5 15.4 5 11V6l7-3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 11.5l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6M10 19a2.2 2.2 0 004 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    user: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    gear: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    logout: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 7l-5 5 5 5M5 12h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.8-3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mic: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    eye: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>',
    download: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a2 2 0 01-2 2H9a2 2 0 01-2-2V7h10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    qr: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3h-3z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4.5 12.5l5 5 10-11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    scan: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M3 12h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const ic = (n) => I[n] || '';

  /* ---------- Document viewer ---------- */
  function docSheetHTML(rec) {
    const p = rec.docPreview || {};
    const head = (org, sub) => `<div class="dh"><div class="clinic">${esc(org)}<small>${esc(sub || '')}</small></div><div style="text-align:right" class="small muted">Date: ${esc(p.date || fmtDate(rec.date))}<br>Ref: CV-${String(rec.id).padStart(4, '0')}</div></div>`;
    if (p.kind === 'prescription') {
      const meds = (p.meds || []).map(m => `<div class="doc-line"><span><b>${esc(m.name)}</b> — ${esc(m.dose)}</span><span>${esc(m.freq)} · ${esc(m.duration)}</span></div>`).join('');
      return `<div class="doc-sheet">${head(p.org, `${p.doctor || ''} · Reg. ${p.reg || '—'}`)}
        <p class="small"><b>Patient:</b> ${esc(p.patient)}</p><h5>Rx — Medicines</h5>${meds}
        ${p.advice ? `<h5>Advice</h5><p>${esc(p.advice)}</p>` : ''}
        <div class="doc-stamp">Digitally recorded</div></div>`;
    }
    if (p.kind === 'lab') {
      const rows = (p.items || []).map(i => `<div class="doc-line"><span>${esc(i.test)}</span><span><b>${esc(i.result)}</b> ${esc(i.unit || '')} <span class="muted small">(${esc(i.range || '')})</span></span></div>`).join('');
      return `<div class="doc-sheet">${head(p.org, 'Laboratory Services')}
        <p class="small"><b>Patient:</b> ${esc(p.patient)}</p><h5>Results</h5>${rows}
        ${p.signed ? `<p class="small mt-3">Signed: <b>${esc(p.signed)}</b></p>` : ''}
        <div class="doc-stamp">Report verified</div></div>`;
    }
    if (p.kind === 'discharge') {
      const meds = (p.meds || []).map(m => `<div class="doc-line"><span><b>${esc(m.name)}</b> — ${esc(m.dose)}</span><span>${esc(m.freq)}</span></div>`).join('');
      return `<div class="doc-sheet">${head(p.org, 'Discharge Summary')}
        <p class="small"><b>Patient:</b> ${esc(p.patient)}</p>
        <h5>Diagnosis</h5><p>${esc(p.diagnosis || '')}</p>
        <h5>Treatment</h5><p>${esc(p.treatment || '')}</p>
        <h5>Medicines on discharge</h5>${meds}
        ${p.advice ? `<h5>Advice</h5><p>${esc(p.advice)}</p>` : ''}
        <div class="doc-stamp">Digitally recorded</div></div>`;
    }
    return `<div class="doc-sheet">${head(p.org, p.doctor || 'Clinical note')}
      <p class="small"><b>Patient:</b> ${esc(p.patient || '—')}</p>
      <h5>Note</h5><p>${esc(p.body || 'No preview available.')}</p>
      <div class="doc-stamp">Digitally recorded</div></div>`;
  }

  function extractionHTML(rec) {
    const ex = rec.extraction;
    if (!ex) return '<p class="muted small">No AI extraction for this document.</p>';
    const rows = [];
    (ex.medicines || []).forEach(m => rows.push(['Medicine', `${m.name} ${m.dosage || ''} · ${m.frequency || ''}${m.duration ? ' · ' + m.duration : ''}`]));
    (ex.tests || []).forEach(tt => rows.push(['Test', `${tt.test}: ${tt.result}${tt.unit ? ' ' + tt.unit : ''}`]));
    (ex.diagnoses || []).forEach(dd => rows.push(['Diagnosis', dd]));
    if (ex.doctor) rows.push(['Doctor', ex.doctor]);
    if (ex.date) rows.push(['Date', fmtDate(ex.date)]);
    if (ex.provider) rows.push(['Provider', ex.provider]);
    const statusBadge = rec.extractionStatus === 'patient_verified'
      ? '<span class="badge ok">Patient Verified</span>'
      : rec.extractionStatus === 'rejected' ? '<span class="badge danger">Rejected</span>'
      : rec.extractionStatus === 'manual' ? '<span class="badge muted">Manual entry</span>'
      : '<span class="badge warn">AI Extracted — Verification Required</span>';
    return `<div class="row between mb-2"><b>Extracted information</b>${statusBadge}</div>
      ${rows.length ? rows.map(r => `<div class="kv"><span class="k">${esc(r[0])}</span><span class="v">${esc(r[1])}</span></div>`).join('') : '<p class="muted small">No structured fields detected.</p>'}
      ${ex.uncertain ? '<div class="banner warn mt-2"><span>⚠️</span><span>Some information could not be confidently extracted. Please verify manually.</span></div>' : ''}
      <p class="small muted mt-2">Engine: ${esc(ex.engineLabel || ex.engine || '—')}</p>`;
  }

  /** Open the original-document viewer. fileRoute: function(recordId) => url for uploaded files. */
  function openDocument(rec, { fileUrl = null, readOnly = false } = {}) {
    const hasFile = rec.fileUrl && !rec.synthetic && fileUrl !== null;
    const m = modal({
      title: `📄 ${esc(rec.title)}`,
      wide: true,
      body: `<div class="grid" style="grid-template-columns:${hasFile ? '1.2fr .8fr' : '1fr'};gap:1.4rem">
        <div>
          <div class="row between mb-2"><span class="badge muted">${esc((rec.type || '').replace('_', ' '))}</span>
          <span class="small muted">${esc(rec.provider || '')} · ${esc(fmtDate(rec.date))}</span></div>
          ${hasFile
            ? (rec.mimeType && rec.mimeType.startsWith('image/')
              ? `<img src="${fileUrl}" alt="Uploaded document" style="width:100%;border-radius:1rem;border:1px solid var(--line)">`
              : `<iframe src="${fileUrl}" title="Document" style="width:100%;height:520px;border:1px solid var(--line);border-radius:1rem;background:#fff"></iframe>`)
            : docSheetHTML(rec)}
        </div>
        <div style="border-left:1px solid var(--line);padding-left:1.4rem">
          ${extractionHTML(rec)}
          ${!readOnly && rec.fileUrl ? `<a class="btn btn-ghost btn-sm mt-3" href="${fileUrl}" download><span></span>Download original</a>` : ''}
        </div>
      </div>`,
    });
    return m;
  }

  /* ---------- Category labels ---------- */
  const CAT_LABEL = { medicines: 'Medicines', allergies: 'Allergies', reports: 'Recent Reports', conditions: 'Conditions', history: 'Full Medical History' };
  const CAT_IC = { medicines: '💊', allergies: '⚠️', reports: '🧪', conditions: '🩺', history: '📄' };

  return { api, esc, fmtDate, fmtDateTime, timeAgo, greeting, minsLeft, countdown, toast, modal, t, setLang, getLang, LANG_NAMES, netStatus, mountNetPill, voiceListen, handleVoiceCommand, ic, openDocument, docSheetHTML, extractionHTML, CAT_LABEL, CAT_IC };
})();
