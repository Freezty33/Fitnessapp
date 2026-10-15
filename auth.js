const SUPABASE_URL  = 'https://kprgcrlpimtsoecwwpyl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmdjcmxwaW10c29lY3d3cHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0OTAzOTIsImV4cCI6MjEwMTA2NjM5Mn0.-3RipcCPFUgNI-1h2KBPrlhpmDuuPHJLNESsYf9gBLM';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const FUNCTIONS_BASE = 'https://maxfitness33.netlify.app';

let _viewingStudentId  = null;
let _myProfile         = null;
let _realtimeChannel   = null;

function activeStudentId() { return _viewingStudentId; }
function myProfile()       { return _myProfile; }
function isCoach()         { return _myProfile && _myProfile.role === 'coach'; }

// Single point of truth for "which student am I viewing": keeps the legacy
// _viewingStudentId var in sync with Ctx (persistence + generation token).
function _setViewingStudent(id) {
  if (id !== _viewingStudentId && typeof flushPendingPlanSave === 'function') flushPendingPlanSave();
  _viewingStudentId = id;
  if (typeof Ctx !== 'undefined') Ctx.set(id, { persist: true });
}

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
    _setupCoachSync();
  } else {
    let sid = null;
    try {
      const { data } = await sb
        .from('student_profiles')
        .select('id')
        .eq('user_id', _myProfile.id)
        .single();
      if (data) { sid = data.id; localStorage.setItem('mf_sid_' + _myProfile.id, sid); }
    } catch (e) { /* offline */ }
    if (!sid) sid = localStorage.getItem('mf_sid_' + _myProfile.id);
    _viewingStudentId = sid;
    if (_viewingStudentId && typeof loadStudentData === 'function') {
      await loadStudentData(_viewingStudentId);
      _setupStudentSync(_viewingStudentId);
    }
  }
  hideLoginScreen();
}

// Offline-safe: a network failure falls back to the last known profile instead
// of being treated as "no profile" (which would sign the user out of the UI).
async function _fetchProfile(uid) {
  const key = 'mf_profile_' + uid;
  try {
    const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
    if (data) { localStorage.setItem(key, JSON.stringify(data)); return data; }
    if (error && error.code === 'PGRST116') return null;  // genuinely no such profile
  } catch (e) { /* network error: use cache below */ }
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

// ── Show déconnexion button for all signed-in users ───────────
function _showSignOutButton() {
  const btn  = document.getElementById('btn-signout');
  const btnM = document.getElementById('btn-signout-mobile');
  const btnM2 = document.getElementById('mobile-logout-btn');
  if (btn)   btn.style.display   = '';
  if (btnM)  btnM.style.display  = '';
  if (btnM2) btnM2.style.display = '';
}

function _hideSignOutButton() {
  const btn  = document.getElementById('btn-signout');
  const btnM = document.getElementById('btn-signout-mobile');
  const btnM2 = document.getElementById('mobile-logout-btn');
  if (btn)   btn.style.display   = 'none';
  if (btnM)  btnM.style.display  = 'none';
  if (btnM2) btnM2.style.display = 'none';
}

// ── Coach student switcher ────────────────────────────────────
let _students = [];

async function _buildCoachSwitcher() {
  const { data: students, error: swErr } = await sb
    .from('student_profiles')
    .select('id, profiles!student_profiles_user_id_fkey(full_name)')
    .eq('coach_id', _myProfile.id);

  if (swErr) { console.error('[switcher]', swErr.message); }

  const controls    = document.getElementById('coach-header-controls');
  const drawerCtrls = document.getElementById('coach-drawer-controls');

  // A coach with 0 students must still see the controls (incl. "+ Ajouter"),
  // otherwise there is no way to create the first student.
  _students = (students || []).map(st => {
    const prof = st['profiles!student_profiles_user_id_fkey'] || st.profiles;
    return { id: st.id, name: (prof && prof.full_name) ? prof.full_name : st.id };
  });

  // Restore the previously-selected student (sessionStorage) if still valid,
  // keep the current selection if it's still in the list, else fall back to
  // the first student. Avoids always jumping to students[0] (plan 3.4/step 4).
  const validIds = _students.map(s => s.id);
  let restored;
  if (_viewingStudentId && validIds.includes(_viewingStudentId)) {
    restored = _viewingStudentId;
  } else if (typeof Ctx !== 'undefined') {
    restored = Ctx.restore(validIds);
  } else {
    restored = validIds[0] ?? null;
  }
  _viewingStudentId = restored;
  if (typeof Ctx !== 'undefined' && restored) Ctx.set(restored, { persist: true });
  _renderStudentSwitcher();

  if (controls)    controls.style.display    = 'flex';
  if (drawerCtrls) drawerCtrls.style.display = 'block';
}

function _renderStudentSwitcher() {
  const current = _students.find(s => s.id === _viewingStudentId) || _students[0];

  // Desktop pill label
  const label = document.getElementById('student-switcher-label');
  if (label) label.textContent = current ? current.name : 'Aucun étudiant';

  const delBtn = document.getElementById('coach-delete-btn');
  if (delBtn) delBtn.style.display = current ? '' : 'none';

  // "Vous consultez" banner (coach only) — guards against editing the wrong student.
  // With 0 students it stays visible as the mobile entry point to "+ Ajouter".
  const banner = document.getElementById('viewing-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = current ? 'Vous consultez : ' + current.name + ' ▾' : 'Aucun étudiant — appuyez pour en ajouter ▾';
    banner.style.cursor = 'pointer';
    banner.onclick = _openStudentSheet;
  }

  // Desktop dropdown items
  const dropdown = document.getElementById('student-switcher-dropdown');
  if (dropdown) {
    dropdown.innerHTML = '';
    _students.forEach(st => {
      const item = document.createElement('button');
      item.className = 'student-switcher-item' + (st.id === _viewingStudentId ? ' active' : '');
      const avatar = document.createElement('span');
      avatar.className = 'student-switcher-avatar';
      avatar.textContent = st.name.charAt(0).toUpperCase();
      const name = document.createElement('span');
      name.textContent = st.name;
      item.appendChild(avatar);
      item.appendChild(name);
      item.addEventListener('click', () => {
        _closeStudentDropdown();
        _setViewingStudent(st.id);
        _renderStudentSwitcher();
        if (typeof onStudentSwitch === 'function') onStudentSwitch(st.id);
      });
      dropdown.appendChild(item);
    });
  }

  // Mobile list
  const mobileWrap = document.getElementById('student-switcher-mobile');
  if (mobileWrap) {
    mobileWrap.innerHTML = '';
    _students.forEach(st => {
      const item = document.createElement('button');
      item.className = 'student-switcher-item' + (st.id === _viewingStudentId ? ' active' : '');
      item.style.cssText = 'width:100%;margin-bottom:4px';
      const avatar = document.createElement('span');
      avatar.className = 'student-switcher-avatar';
      avatar.textContent = st.name.charAt(0).toUpperCase();
      const name = document.createElement('span');
      name.textContent = st.name;
      item.appendChild(avatar);
      item.appendChild(name);
      item.addEventListener('click', () => {
        _setViewingStudent(st.id);
        _renderStudentSwitcher();
        if (typeof onStudentSwitch === 'function') onStudentSwitch(st.id);
        if (typeof closeMobileNav === 'function') closeMobileNav();
      });
      mobileWrap.appendChild(item);
    });
  }
}

// Mobile student picker: the hamburger drawer is hidden on phones (<=480px),
// so the "Vous consultez" banner opens this sheet instead.
function _openStudentSheet() {
  if (!isCoach() || document.getElementById('student-sheet')) return;
  const overlay = document.createElement('div');
  overlay.id = 'student-sheet';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.6);display:flex;align-items:flex-end';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const box = document.createElement('div');
  box.style.cssText = 'width:100%;max-height:70vh;overflow:auto;background:var(--surface,#111);border-radius:16px 16px 0 0;padding:14px 14px calc(18px + env(safe-area-inset-bottom))';
  const title = document.createElement('div');
  title.textContent = 'Changer d\'étudiant';
  title.style.cssText = 'font-weight:700;margin-bottom:10px;color:var(--accent,#C8FF00)';
  box.appendChild(title);
  if (!_students.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Aucun étudiant pour le moment. Ajoutez votre premier étudiant pour commencer.';
    empty.style.cssText = 'color:#aaa;font-size:13px;margin-bottom:10px';
    box.appendChild(empty);
  }
  _students.forEach(st => {
    const item = document.createElement('button');
    item.className = 'student-switcher-item' + (st.id === _viewingStudentId ? ' active' : '');
    item.style.cssText = 'width:100%;margin-bottom:6px';
    const avatar = document.createElement('span');
    avatar.className = 'student-switcher-avatar';
    avatar.textContent = st.name.charAt(0).toUpperCase();
    const name = document.createElement('span');
    name.textContent = st.name;
    item.appendChild(avatar);
    item.appendChild(name);
    item.addEventListener('click', () => {
      overlay.remove();
      _setViewingStudent(st.id);
      _renderStudentSwitcher();
      if (typeof onStudentSwitch === 'function') onStudentSwitch(st.id);
    });
    box.appendChild(item);
  });
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  const add = document.createElement('button');
  add.className = 'coach-add-btn';
  add.style.flex = '1';
  add.textContent = '+ Ajouter';
  add.addEventListener('click', () => { overlay.remove(); _showCreateStudentModal(); });
  const del = document.createElement('button');
  del.className = 'coach-delete-btn';
  del.textContent = '🗑';
  del.addEventListener('click', () => { overlay.remove(); _confirmDeleteStudent(); });
  row.appendChild(add);
  if (_students.length) row.appendChild(del);
  box.appendChild(row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function _toggleStudentDropdown() {
  const dd = document.getElementById('student-switcher-dropdown');
  if (!dd) return;
  const open = dd.classList.toggle('open');
  if (open) {
    setTimeout(() => document.addEventListener('click', _studentDropdownOutside), 0);
  }
}

function _closeStudentDropdown() {
  const dd = document.getElementById('student-switcher-dropdown');
  if (dd) dd.classList.remove('open');
  document.removeEventListener('click', _studentDropdownOutside);
}

function _studentDropdownOutside(e) {
  const sw = document.getElementById('student-switcher');
  if (sw && !sw.contains(e.target)) _closeStudentDropdown();
}

// Keep _confirmDeleteStudent working — reads current selected student from _viewingStudentId


// ── Delete student ────────────────────────────────────────────
function _confirmDeleteStudent() {
  const id   = _viewingStudentId;
  const st   = _students.find(s => s.id === id);
  const name = st ? st.name : 'cet étudiant';
  if (!id) return;
  if (!confirm(`Supprimer définitivement le profil de ${name} ?\nToutes les données seront effacées.`)) return;
  _doDeleteStudent(id, name);
}

async function _doDeleteStudent(studentProfileId, name) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/delete-student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ student_profile_id: studentProfileId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur serveur');
    // Remove from localStorage
    ['training','weekCount','dayCount','progress','feedback','notes','videos','youtube','timers','mealChecks','voice','photos','measurements','meals','nutData'].forEach(k => {
      localStorage.removeItem(`p_${studentProfileId}_${k}`);
    });
    await _buildCoachSwitcher();
    if (_students.length > 0 && typeof onStudentSwitch === 'function') {
      onStudentSwitch(_viewingStudentId);
    }
  } catch (e) {
    alert('Erreur lors de la suppression : ' + e.message);
  }
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
      const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/create-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ email, password: pass, full_name: name, goal_text: goal }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur serveur');

      overlay.remove();
      await _buildCoachSwitcher();

      // Auto-select the newly created student by name
      const newSt = _students.find(s => s.name === name);
      if (newSt && typeof onStudentSwitch === 'function') {
        _viewingStudentId = newSt.id;
        _renderStudentSwitcher();
        onStudentSwitch(newSt.id);
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
  // Only an explicit sign-out clears the UI; a null session from a failed
  // offline token refresh must not kick the user to the login screen.
  if (event === 'SIGNED_OUT') {
    _myProfile = null;
    _viewingStudentId = null;
    const controls = document.getElementById('coach-header-controls');
    if (controls) controls.style.display = 'none';
    const drawerCtrls = document.getElementById('coach-drawer-controls');
    if (drawerCtrls) drawerCtrls.style.display = 'none';
    _hideSignOutButton();
    showLoginScreen();
  }
  // SIGNED_IN also fires on token refresh / app refocus: skip if already loaded for this user
  if (event === 'SIGNED_IN' && session && !(_myProfile && _myProfile.id === session.user.id)) {
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

// ── Student real-time sync (Option A: visibilitychange + Option B: Realtime) ──
function _setupStudentSync(studentId) {
  // Option A — refresh silently when student returns to the app (background → foreground)
  document.addEventListener('visibilitychange', _onVisibilityChange);

  // Option B — Supabase Realtime: push update when coach saves the workout plan
  if (_realtimeChannel) {
    sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  _realtimeChannel = sb.channel('student-sync-' + studentId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_plans',
        filter: `student_id=eq.${studentId}` },
      () => { if (typeof loadStudentData === 'function') loadStudentData(studentId); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coach_voice_notes',
        filter: `student_id=eq.${studentId}` },
      () => { if (typeof loadStudentData === 'function') loadStudentData(studentId); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nutrition_plans',
        filter: `student_id=eq.${studentId}` },
      () => { if (typeof loadStudentData === 'function') loadStudentData(studentId); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coach_availability' },
      () => { if (typeof renderRdvTab === 'function' && typeof currentTab !== 'undefined' && currentTab === 'rdv') renderRdvTab(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rdv_bookings',
        filter: `student_id=eq.${studentId}` },
      () => { if (typeof renderRdvTab === 'function' && typeof currentTab !== 'undefined' && currentTab === 'rdv') renderRdvTab(); })
    .subscribe();
}

function _onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  if (!_viewingStudentId || isCoach()) return;
  if (typeof loadStudentData === 'function') loadStudentData(_viewingStudentId);
}

function _teardownStudentSync() {
  document.removeEventListener('visibilitychange', _onVisibilityChange);
  if (_realtimeChannel) {
    sb.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

// ── Coach real-time sync ───────────────────────────────────────
// Coaches previously had no realtime channel at all (plan 3.7): they only
// saw new logs/bookings after a reload or manual student switch. This
// channel is scoped to the coach (not per-student), so switching students
// doesn't require resubscribing — only the currently-viewed student's data
// is refreshed, matching plan section 4 step 6.
let _coachRealtimeChannel = null;
let _coachLogReloadTimer = null;

function _setupCoachSync() {
  if (_coachRealtimeChannel) {
    sb.removeChannel(_coachRealtimeChannel);
    _coachRealtimeChannel = null;
  }
  _coachRealtimeChannel = sb.channel('coach-sync-' + _myProfile.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_logs' },
      (payload) => {
        const sid = payload.new?.student_id || payload.old?.student_id;
        if (sid && sid === _viewingStudentId && typeof loadStudentData === 'function') {
          // Debounce: a burst of student logs triggers a single reload
          clearTimeout(_coachLogReloadTimer);
          _coachLogReloadTimer = setTimeout(() => {
            if (_viewingStudentId === sid) loadStudentData(sid);
          }, 500);
        }
      })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rdv_bookings',
        filter: `coach_id=eq.${_myProfile.id}` },
      () => { if (typeof renderRdvTab === 'function' && typeof currentTab !== 'undefined' && currentTab === 'rdv') renderRdvTab(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coach_availability',
        filter: `coach_id=eq.${_myProfile.id}` },
      () => { if (typeof renderRdvTab === 'function' && typeof currentTab !== 'undefined' && currentTab === 'rdv') renderRdvTab(); })
    .subscribe();
}

function _teardownCoachSync() {
  clearTimeout(_coachLogReloadTimer);
  if (_coachRealtimeChannel) {
    sb.removeChannel(_coachRealtimeChannel);
    _coachRealtimeChannel = null;
  }
}

async function signOut() {
  _teardownStudentSync();
  _teardownCoachSync();
  if (typeof Ctx !== 'undefined') Ctx.clear();
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
  title.textContent = 'MAX';
  const span = document.createElement('span');
  span.style.color = '#fff';
  span.textContent = ' FIT';
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

  // Install guide separator
  const sep = document.createElement('p');
  sep.style.cssText = 'color:#333;font-size:11px;margin:20px 0 8px;text-align:center;letter-spacing:.8px';
  sep.textContent = 'INSTALLER L\'APPLICATION';

  const btnIos = document.createElement('button');
  btnIos.style.cssText = 'width:100%;padding:11px;background:transparent;border:1px solid #2a2a2a;border-radius:10px;color:#888;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:border-color .2s';
  btnIos.innerHTML = '<span style="font-size:15px">🍎</span> Installer sur iPhone (iOS)';
  btnIos.addEventListener('mouseover', () => btnIos.style.borderColor = '#C8FF00');
  btnIos.addEventListener('mouseout',  () => btnIos.style.borderColor = '#2a2a2a');
  btnIos.addEventListener('click', () => _showInstallGuide('ios'));

  const btnAndroid = document.createElement('button');
  btnAndroid.style.cssText = 'width:100%;padding:11px;background:transparent;border:1px solid #2a2a2a;border-radius:10px;color:#888;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:border-color .2s';
  btnAndroid.innerHTML = '<span style="font-size:15px">🤖</span> Installer sur Android';
  btnAndroid.addEventListener('mouseover', () => btnAndroid.style.borderColor = '#C8FF00');
  btnAndroid.addEventListener('mouseout',  () => btnAndroid.style.borderColor = '#2a2a2a');
  btnAndroid.addEventListener('click', () => _showInstallGuide('android'));

  form.appendChild(sep);
  form.appendChild(btnIos);
  form.appendChild(btnAndroid);

  scr.appendChild(title);
  scr.appendChild(sub);
  scr.appendChild(form);
  document.body.appendChild(scr);
  return scr;
}

function _showInstallGuide(platform) {
  const existing = document.getElementById('install-guide-overlay');
  if (existing) existing.remove();

  const isIos = platform === 'ios';

  const steps = isIos ? [
    { icon: '🌐', title: 'Ouvre Safari',              desc: 'L\'installation ne fonctionne qu\'avec Safari. Pas Chrome ni Firefox.' },
    { icon: '🔗', title: 'Va sur le site',             desc: 'Tape maxfitness33.netlify.app dans la barre d\'adresse Safari.' },
    { icon: '📤', title: 'Appuie sur Partager',        desc: 'L\'icône carré avec une flèche ↑ en bas de l\'écran Safari.' },
    { icon: '📲', title: '"Sur l\'écran d\'accueil"',  desc: 'Fais défiler la liste des options et appuie dessus.' },
    { icon: '✅', title: 'Appuie sur "Ajouter"',       desc: 'L\'icône Max Fit apparaît sur ton écran d\'accueil !' },
  ] : [
    { icon: '🌐', title: 'Ouvre Chrome',               desc: 'L\'installation fonctionne avec Chrome ou Edge.' },
    { icon: '🔗', title: 'Va sur le site',             desc: 'Tape maxfitness33.netlify.app dans la barre d\'adresse.' },
    { icon: '⋮',  title: 'Menu → "Ajouter à l\'écran"', desc: 'Appuie sur les 3 points ⋮ en haut à droite, puis "Ajouter à l\'écran d\'accueil".' },
    { icon: '📲', title: 'Confirme',                   desc: 'Appuie sur "Ajouter" dans la fenêtre qui apparaît.' },
    { icon: '✅', title: 'C\'est installé !',           desc: 'L\'icône Max Fit apparaît sur ton écran d\'accueil !' },
  ];

  const overlay = document.createElement('div');
  overlay.id = 'install-guide-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px)';

  const box = document.createElement('div');
  box.style.cssText = 'background:#111;border:1px solid #222;border-radius:20px;padding:28px 24px 24px;width:100%;max-width:340px;max-height:80vh;overflow-y:auto;position:relative';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:#1a1a1a;border:1px solid #333;color:#666;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center';
  closeBtn.addEventListener('click', () => overlay.remove());

  const h2 = document.createElement('h2');
  h2.style.cssText = 'color:#C8FF00;font-size:18px;font-weight:900;margin:0 0 4px;padding-right:36px';
  h2.textContent = isIos ? 'Installer sur iPhone' : 'Installer sur Android';

  const subtitle = document.createElement('p');
  subtitle.style.cssText = 'color:#555;font-size:12px;margin:0 0 24px';
  subtitle.textContent = isIos ? 'Via Safari — Ajouter à l\'écran d\'accueil' : 'Via Chrome — Ajouter à l\'écran d\'accueil';

  const stepsWrap = document.createElement('div');
  stepsWrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;margin-bottom:24px';

  steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:14px';

    const num = document.createElement('div');
    num.style.cssText = 'min-width:28px;height:28px;background:#C8FF00;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#000;flex-shrink:0;margin-top:1px';
    num.textContent = i + 1;

    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'font-size:20px;line-height:28px;flex-shrink:0';
    iconEl.textContent = s.icon;

    const text = document.createElement('div');
    const tTitle = document.createElement('p');
    tTitle.style.cssText = 'color:#fff;font-size:13px;font-weight:700;margin:0 0 2px;line-height:1.4';
    tTitle.textContent = s.title;
    const tDesc = document.createElement('p');
    tDesc.style.cssText = 'color:#777;font-size:12px;margin:0;line-height:1.5';
    tDesc.textContent = s.desc;
    text.appendChild(tTitle);
    text.appendChild(tDesc);

    row.appendChild(num);
    row.appendChild(iconEl);
    row.appendChild(text);
    stepsWrap.appendChild(row);
  });

  const doneBtn = document.createElement('button');
  doneBtn.textContent = 'Compris !';
  doneBtn.style.cssText = 'width:100%;padding:13px;background:#C8FF00;color:#000;font-weight:800;border:none;border-radius:10px;font-size:14px;cursor:pointer;letter-spacing:.3px';
  doneBtn.addEventListener('click', () => overlay.remove());

  box.appendChild(closeBtn);
  box.appendChild(h2);
  box.appendChild(subtitle);
  box.appendChild(stepsWrap);
  box.appendChild(doneBtn);
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function hideLoginScreen() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.style.display = 'none';
}
