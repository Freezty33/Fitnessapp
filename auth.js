// ============================================================
// SUPABASE AUTH + COACH SWITCHER
// Replace YOUR_PROJECT_URL and YOUR_ANON_KEY with your actual
// values from Supabase → Project Settings → API
// ============================================================
const SUPABASE_URL  = 'https://kprgcrlpimtsoecwwpyl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmdjcmxwaW10c29lY3d3cHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0OTAzOTIsImV4cCI6MjEwMTA2NjM5Mn0.-3RipcCPFUgNI-1h2KBPrlhpmDuuPHJLNESsYf9gBLM';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let _viewingStudentId = null;
let _myProfile        = null;

function activeStudentId() { return _viewingStudentId; }
function myProfile()       { return _myProfile; }
function isCoach()         { return _myProfile && _myProfile.role === 'coach'; }

// ── Boot ─────────────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLoginScreen(); return; }
  await _onSignedIn(session.user.id);
}

async function _onSignedIn(uid) {
  _myProfile = await _fetchProfile(uid);
  if (!_myProfile) { showLoginScreen(); return; }
  if (_myProfile.role === 'coach') {
    await _buildCoachSwitcher();
  } else {
    const { data } = await sb
      .from('student_profiles')
      .select('id')
      .eq('user_id', _myProfile.id)
      .single();
    _viewingStudentId = data ? data.id : null;
  }
  hideLoginScreen();
}

async function _fetchProfile(uid) {
  const { data } = await sb.from('profiles').select('*').eq('id', uid).single();
  return data;
}

// ── Coach student switcher ───────────────────────────────────
async function _buildCoachSwitcher() {
  const { data: students, error: swErr } = await sb
    .from('student_profiles')
    .select('id, profiles!student_profiles_user_id_fkey(full_name)')
    .eq('coach_id', _myProfile.id);

  if (swErr) { console.error('[switcher]', swErr.message); }
  if (!students || !students.length) return;

  let bar = document.getElementById('coach-switcher-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'coach-switcher-bar';
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9998',
      'background:#111', 'border-bottom:1px solid #222',
      'display:flex', 'align-items:center', 'gap:12px',
      'padding:8px 20px', 'font-size:13px', 'color:#aaa'
    ].join(';');
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop) || 0) + 42 + 'px';
  }

  // Build bar using DOM (no innerHTML with data)
  while (bar.firstChild) bar.removeChild(bar.firstChild);

  const lbl = document.createElement('span');
  lbl.style.color = '#666';
  lbl.textContent = 'Étudiant :';
  bar.appendChild(lbl);

  const sel = document.createElement('select');
  sel.style.cssText = 'background:#1a1a1a;color:#fff;border:1px solid #333;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer';
  students.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    const prof = s['profiles!student_profiles_user_id_fkey'] || s.profiles;
    opt.textContent = (prof && prof.full_name) ? prof.full_name : s.id;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    _viewingStudentId = sel.value;
    if (typeof onStudentSwitch === 'function') onStudentSwitch(_viewingStudentId);
  });
  _viewingStudentId = students[0].id;
  bar.appendChild(sel);

  const out = document.createElement('button');
  out.textContent = 'Déconnexion';
  out.style.cssText = 'margin-left:auto;background:transparent;border:1px solid #333;color:#666;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer';
  out.addEventListener('click', signOut);
  bar.appendChild(out);
}

// ── Auth state listener ───────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    _myProfile = null;
    _viewingStudentId = null;
    showLoginScreen();
  }
  if (event === 'SIGNED_IN') {
    await _onSignedIn(session.user.id);
  }
});

// ── Sign-in / out ─────────────────────────────────────────────
async function signIn(email, password) {
  const btn = document.getElementById('auth-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    alert(error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

async function signOut() {
  await sb.auth.signOut();
}

// ── Login screen ─────────────────────────────────────────────
function showLoginScreen() {
  let scr = document.getElementById('login-screen');
  if (!scr) { scr = _buildLoginScreen(); }
  scr.style.display = 'flex';
  const pwdEl = document.getElementById('auth-password');
  if (pwdEl) pwdEl.onkeydown = e => { if (e.key === 'Enter') document.getElementById('auth-submit-btn').click(); };
}

function _buildLoginScreen() {
  const scr = document.createElement('div');
  scr.id = 'login-screen';
  scr.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0';

  const title = document.createElement('h1');
  title.style.cssText = 'color:#C8FF00;font-size:32px;font-weight:900;letter-spacing:-1px;margin-bottom:8px';
  title.textContent = 'LOUIS';
  const span = document.createElement('span');
  span.style.color = '#fff';
  span.textContent = 'FIT';
  title.appendChild(span);

  const sub = document.createElement('p');
  sub.style.cssText = 'color:#555;font-size:13px;margin-bottom:32px';
  sub.textContent = 'Plateforme de coaching';

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:min(300px,90vw)';

  const emailIn = document.createElement('input');
  emailIn.id = 'auth-email'; emailIn.type = 'email'; emailIn.placeholder = 'Email';
  emailIn.style.cssText = 'padding:12px 16px;border-radius:10px;border:1px solid #222;background:#111;color:#fff;font-size:15px;outline:none';

  const pwdIn = document.createElement('input');
  pwdIn.id = 'auth-password'; pwdIn.type = 'password'; pwdIn.placeholder = 'Mot de passe';
  pwdIn.style.cssText = 'padding:12px 16px;border-radius:10px;border:1px solid #222;background:#111;color:#fff;font-size:15px;outline:none';

  const btn = document.createElement('button');
  btn.id = 'auth-submit-btn';
  btn.textContent = 'Se connecter';
  btn.style.cssText = 'padding:14px;background:#C8FF00;color:#000;font-weight:800;border:none;border-radius:10px;font-size:15px;cursor:pointer;letter-spacing:.5px';
  btn.addEventListener('click', () => signIn(emailIn.value, pwdIn.value));

  form.appendChild(emailIn);
  form.appendChild(pwdIn);
  form.appendChild(btn);
  scr.appendChild(title);
  scr.appendChild(sub);
  scr.appendChild(form);
  document.body.appendChild(scr);
  return scr;
}

function hideLoginScreen() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.style.display = 'none';
}
