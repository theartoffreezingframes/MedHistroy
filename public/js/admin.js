/* ============================================================
   CareVault — Admin console (operational stats only, no PHI)
   ============================================================ */
(function () {
'use strict';
const { api, esc, fmtDate, fmtDateTime, toast, ic } = CV;
let ME = null;
const view = () => document.getElementById('view');

const NAV = [
  { r: '/home', k: 'Dashboard', i: 'dash' },
  { r: '/users', k: 'Users & Providers', i: 'user' },
  { r: '/consents', k: 'Consent Sessions', i: 'shield' },
];

function renderSidebar() {
  document.getElementById('sideNav').innerHTML = NAV.map(n =>
    `<a class="side-link" href="#${n.r}" data-route="${n.r}">${ic(n.i)}<span>${n.k}</span></a>`).join('');
  document.getElementById('logoutBtn').innerHTML = `${ic('logout')}<span>Logout</span>`;
  highlight();
}
function highlight() {
  const route = (location.hash.slice(1) || '/home');
  document.querySelectorAll('.side-link[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));
}

const badge = (s) => ({ ACTIVE: '<span class="badge ok">Active</span>', PENDING: '<span class="badge warn">Pending</span>', REVOKED: '<span class="badge danger">Revoked</span>', EXPIRED: '<span class="badge muted">Expired</span>', REJECTED: '<span class="badge muted">Rejected</span>' }[s] || esc(s));

async function pageHome() {
  view().innerHTML = '<div class="empty"><span class="spinner" style="margin:0 auto"></span></div>';
  const s = await api('/admin/stats');
  view().innerHTML = `
    <div class="page-head row between"><div><h1>Platform Overview</h1>
      <p class="sub">Operational statistics. Admins do not have access to patient medical records.</p></div>
      <span class="badge warn">Demo Data</span></div>
    <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      <div class="card stat-card"><span class="ic">🙋</span><span class="num">${s.platformStats.registeredPatients.toLocaleString()}</span><span class="lbl">Registered Patients *</span></div>
      <div class="card stat-card"><span class="ic">🩺</span><span class="num">${s.platformStats.registeredProviders.toLocaleString()}</span><span class="lbl">Registered Providers *</span></div>
      <div class="card stat-card"><span class="ic">🟢</span><span class="num">${s.live.activeConsents}</span><span class="lbl">Active Consent Sessions</span></div>
      <div class="card stat-card"><span class="ic">🚫</span><span class="num">${s.live.revokedSessions}</span><span class="lbl">Revoked Sessions</span></div>
      <div class="card stat-card"><span class="ic">🧠</span><span class="num">${s.platformStats.recordsProcessed.toLocaleString()}</span><span class="lbl">Records Processed *</span></div>
    </div>
    <p class="small muted mt-2">* Fictional demo numbers used for the showcase. Live counters below reflect this prototype's seeded data.</p>
    <div class="grid mt-3" style="grid-template-columns:1fr 1fr">
      <div class="panel"><h3>Live prototype counters</h3>
        <div class="kv"><span class="k">Patients (seeded)</span><span class="v">${s.live.patients}</span></div>
        <div class="kv"><span class="k">Providers (seeded)</span><span class="v">${s.live.providers}</span></div>
        <div class="kv"><span class="k">Records in vaults</span><span class="v">${s.live.records}</span></div>
        <div class="kv"><span class="k">Expired sessions</span><span class="v">${s.live.expiredSessions}</span></div>
        <div class="kv"><span class="k">Audit log entries</span><span class="v">${s.live.accessLogEntries}</span></div>
      </div>
      <div class="panel"><h3>Recent consent sessions</h3>
        <div class="table-wrap" style="border:none"><table class="tbl"><thead><tr><th>Patient</th><th>Organization</th><th>Purpose</th><th>Status</th></tr></thead><tbody>
        ${s.recentConsents.map(c => `<tr><td>${esc(c.patientName)}</td><td>${esc(c.organization)}</td><td>${esc(c.purpose)}</td><td>${badge(c.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sessions yet.</td></tr>'}
        </tbody></table></div>
      </div>
    </div>
    <div class="banner info mt-3"><span>🔒</span><span><b>Privacy by role:</b> this console intentionally shows operational metrics only — never clinical content.</span></div>`;
}

async function pageUsers() {
  const { users } = await api('/admin/users');
  view().innerHTML = `<div class="page-head"><h1>Users &amp; Providers</h1><p class="sub">Account management (demo).</p></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organization</th><th>Created</th></tr></thead><tbody>
    ${users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td>
      <td>${u.role === 'patient' ? '<span class="badge info">Patient</span>' : u.role === 'provider' ? '<span class="badge ok">Provider</span>' : '<span class="badge warn">Admin</span>'}</td>
      <td>${esc(u.org || '—')}</td><td class="small">${fmtDate(u.createdAt)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function pageConsents() {
  view().innerHTML = '<div class="empty"><span class="spinner" style="margin:0 auto"></span></div>';
  const s = await api('/admin/stats');
  view().innerHTML = `<div class="page-head"><h1>Consent Sessions</h1><p class="sub">Pseudonymized operational view of consent activity.</p></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Patient (pseudonym)</th><th>Organization</th><th>Purpose</th><th>Status</th><th>Created</th></tr></thead><tbody>
    ${s.recentConsents.map(c => `<tr><td>${esc(c.patientName)}</td><td>${esc(c.organization)}</td><td>${esc(c.purpose)}</td><td>${badge(c.status)}</td><td class="small">${fmtDateTime(c.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No consent sessions yet.</td></tr>'}
    </tbody></table></div>`;
}

const ROUTES = { '/home': pageHome, '/users': pageUsers, '/consents': pageConsents };
async function render() {
  highlight();
  const route = location.hash.slice(1) || '/home';
  try { await (ROUTES[route] || pageHome)(); }
  catch (e) { view().innerHTML = `<div class="empty card"><div class="big">⚠️</div><b>${esc(e.message || 'Something went wrong.')}</b></div>`; }
}

async function boot() {
  try {
    const { user } = await api('/auth/me');
    if (!user) return location.href = '/login';
    if (user.role !== 'admin') return location.href = user.role === 'patient' ? '/app/patient' : '/app/provider';
    ME = user;
  } catch { return location.href = '/login'; }
  document.getElementById('userName').textContent = ME.name;
  renderSidebar();
  document.getElementById('logoutBtn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }); location.href = '/login'; });
  document.getElementById('hamburger').addEventListener('click', () => { document.getElementById('sidebar').classList.add('open'); document.getElementById('sideBackdrop').classList.add('open'); });
  document.getElementById('sideBackdrop').addEventListener('click', () => { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sideBackdrop').classList.remove('open'); });
  document.addEventListener('click', (e) => { if (e.target.closest('.side-link')) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sideBackdrop').classList.remove('open'); } });
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/home';
  render();
}
boot();
})();
