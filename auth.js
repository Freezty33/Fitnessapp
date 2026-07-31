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

  _showSignOutButton();

  if (_myProfile.role === 'coach') {
    await _buildCoachSwitcher();
    if (_viewingStudentId && typeof loadStudentData === 'function') {
      await loadStudentData(_viewingStudentId);
    }
  } else {
    const { data } = await sb
      .from('student_profiles')
      .select('id')
      .eq('user_id', _myProfile.id)
      .single();
    _viewingStudentId = data ? data.id : null;
    if (_viewingStudentId && typeof loadStudentData === 'function') {
      await loadStudentData(_viewingStudentId);
    }
  }
  hideLoginScreen();
}

async function _fetchProfile(uid) {
  const { data } = await sb.from('profiles').select('*').eq('id', uid).single();
  return data;
}

// ── Show déconnexion button for all signed-in users ───────────
function _showSignOutButton() {
  const btn  = document.getElementById('btn-signout');
  const btnM = document.getElementById('btn-signout-mobile');
  if (btn)  btn.style.display  = '';
  if (btnM) btnM.style.display = '';
}

function _hideSignOutButton() {
  const btn  = document.getElementById('btn-signout');
  const btnM = document.getElementById('btn-signout-mobile');
  if (btn)  btn.style.display  = 'none';
  if (btnM) btnM.style.display = 'none';
}

// ── Coach student switcher (uses header elements) ─────────────
async function _buildCoachSwitcher() {
  const { data: students, error: swErr } = await sb
    .from('student_profiles')
    .select('id, profiles!student_profiles_user_id_fkey(full_name)')
    .eq('coach_id', _myProfile.id);

  if (swErr) { console.error('[switcher]', swErr.message); }
  if (!students || !students.length) return;

  const controls = document.getElementById('coach-header-controls');
  const sel      = document.getElementById('coach-student-select');
  if (!controls || !sel) return;

  // Rebuild options
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  students.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    const prof = s['profiles!student_profiles_user_id_fkey'] || s.profiles;
    opt.textContent = (prof && prof.full_name) ? prof.full_name : s.id;
    sel.appendChild(opt);
  });

  sel.onchange = () => {
    _viewingStudentId = sel.value;
    if (typeof onStudentSwitch === 'function') onStudentSwitch(_viewingStudentId);
  };

  _viewingStudentId = students[0].id;
  controls.style.display = 'flex';
}

// ── Create-student modal ──────────────────────────────────────
function _showCreateStudentModal() {
  if (document.getElementById('create-student-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'create-student-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center';

  const box = document.createElement('div');
  box.style.cssText = 'background:#111;border:1px solid #222;border-radius:12px;padding:32px;width:340px;display:flex;flex-direction:column;gap:16px';

  const title = document.createElement('h2');
  title.textContent = 'Nouvel étudiant';
  title.style.cssText = 'color:#C8FF00;margin:0;font-size:18px';
  box.appendChild(title);

  const fields = [
    { id: 'cs-name',  label: 'Nom complet',         type: 'text',     placeholder: 'Louis Dupont' },
    { id: 'cs-email', label: 'Email',                type: 'email',    placeholder: 'etudiant@email.com' },
    { id: 'cs-pass',  label: 'Mot de passe',         type: 'password', placeholder: 'Min. 6 caractères' },
    { id: 'cs-goal',  label: 'Objectif (optionnel)', type: 'text',     placeholder: 'Prise de masse…' },
  ];
  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    const lbl = document.createElement('label');
    lbl.textContent = f.label;
    lbl.style.cssText = 'color:#aaa;font-size:12px';
    const inp = document.createElement('input');
    inp.id = f.id; inp.type = f.type; inp.placeholder = f.placeholder;
    inp.style.cssText = 'background:#1a1a1a;color:#fff;border:1px solid #333;border-radius:6px;padding:8px 10px;font-size:13px;outline:none';
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    box.appendChild(wrap);
  });

  const errEl = document.createElement('p');
  errEl.style.cssText = 'color:#ff4444;font-size:12px;margin:0;display:none';
  box.appendChild(errEl);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:4px';

  const cancel = document.createElement('button');
  cancel.textContent = 'Annuler';
  cancel.style.cssText = 'background:transparent;border:1px solid #333;color:#666;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer';
  cancel.addEventListener('click', () => overlay.remove());

  const submit = document.createElement('button');
  submit.textContent = 'Créer';
  submit.style.cssText = 'background:#C8FF00;color:#000;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer';
  submit.addEventListener('click', async () => {
    const name  = document.getElementById('cs-name').value.trim();
    const email = document.getElementById('cs-email').value.trim();
    const pass  = document.getElementById('cs-pass').value;
    const goal  = document.getElementById('cs-goal').value.trim();

    errEl.style.display = 'none';
    if (!name || !email || !pass) {
      errEl.textContent = 'Nom, email et mot de passe sont requis.';
      errEl.style.display = 'block';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Création…';

    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch('/.netlify/functions/create-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, password: pass, full_name: name, goal_text: goal }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur serveur');

      overlay.remove();
      await _buildCoachSwitcher();

      // Auto-select the new student
      const sel = document.getElementById('coach-student-select');
      if (sel) {
        for (const opt of sel.options) {
          if (opt.textContent === name) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
            break;
          }
        }
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      submit.disabled = false;
      submit.textContent = 'Créer';
    }
  });

  row.appendChild(cancel);
  row.appendChild(submit);
  box.appendChild(row);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('cs-name').focus();
}

// ── Auth state listener ───────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    _myProfile = null;
    _viewingStudentId = null;
    const controls = document.getElementById('coach-header-controls');
    if (controls) controls.style.display = 'none';
    _hideSignOutButton();
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
