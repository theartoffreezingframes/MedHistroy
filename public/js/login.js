/* CareVault — login / signup */
(function () {
  const params = new URLSearchParams(location.search);
  let mode = 'login';
  let role = 'patient';

  const tabs = document.querySelectorAll('.role-tab');
  const errBox = document.getElementById('errBox');
  const nameField = document.getElementById('nameField');
  const submitBtn = document.getElementById('submitBtn');
  const swapLine = document.getElementById('swapLine');
  const signupNote = document.getElementById('signupNote');

  if (params.get('signup') === '1') setMode('signup');
  const presetRole = params.get('role');
  if (presetRole && ['patient', 'provider', 'admin'].includes(presetRole)) setRole(presetRole);

  function setRole(r) {
    role = r;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.role === r));
    if (r !== 'patient' && mode === 'signup') setMode('login');
    updateSwapLine();
  }
  function setMode(m) {
    mode = m;
    nameField.classList.toggle('hidden', mode === 'login');
    submitBtn.textContent = mode === 'login' ? 'Login' : 'Create account';
    signupNote.classList.toggle('hidden', mode !== 'signup');
    updateSwapLine();
  }
  function updateSwapLine() {
    if (role !== 'patient') { swapLine.innerHTML = '<span class="muted">Demo ' + role + ' accounts are listed below.</span>'; return; }
    swapLine.innerHTML = mode === 'login'
      ? 'New to CareVault? <span class="swap" id="swapMode">Create a patient account</span>'
      : 'Already have an account? <span class="swap" id="swapMode">Login instead</span>';
    document.getElementById('swapMode').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
  }

  tabs.forEach(t => t.addEventListener('click', () => setRole(t.dataset.role)));
  document.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => {
    document.getElementById('email').value = b.dataset.fill;
    document.getElementById('password').value = 'Demo123!';
    const r = b.dataset.fill.startsWith('patient@') ? 'patient' : b.dataset.fill.startsWith('doctor@') ? 'provider' : 'admin';
    setRole(r); setMode('login');
  }));
  updateSwapLine();

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true; submitBtn.textContent = 'Please wait…';
    const body = { email: document.getElementById('email').value.trim(), password: document.getElementById('password').value };
    try {
      let res;
      if (mode === 'signup' && role === 'patient') {
        body.name = document.getElementById('name').value.trim();
        res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Something went wrong.');
      const target = data.user.role === 'patient' ? '/app/patient' : data.user.role === 'provider' ? '/app/provider' : '/app/admin';
      location.href = target;
    } catch (err) {
      errBox.textContent = err.message; errBox.classList.remove('hidden');
      submitBtn.disabled = false; submitBtn.textContent = mode === 'login' ? 'Login' : 'Create account';
    }
  });

  // Already logged in and no explicit intent (?role/?signup)? Go straight to the app.
  if (!location.search) {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) location.href = d.user.role === 'patient' ? '/app/patient' : d.user.role === 'provider' ? '/app/provider' : '/app/admin';
    }).catch(() => {});
  }
})();
