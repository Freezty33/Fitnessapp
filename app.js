// ============================================================
// HTML ESCAPE HELPER
// ============================================================
function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
// PROFILES
// ============================================================
const PROFILE_COLORS = ['#C8FF00','#00D4FF','#FF6B35','#FF3CAC','#7B2FBE','#00C896'];
const _DEFAULT_PROFILE = { id: 'louis', name: 'Louis', color: '#C8FF00' };
const _DEFAULT_DAYS = JSON.parse(JSON.stringify(trainingData.days));

let profiles = JSON.parse(localStorage.getItem('fitProfiles') || JSON.stringify([_DEFAULT_PROFILE]));
let currentProfileId = localStorage.getItem('fitCurrentProfile') || profiles[0].id;
if (!profiles.find(p => p.id === currentProfileId)) currentProfileId = profiles[0].id;

function pk(key) { return `p_${currentProfileId}_${key}`; }
function currentProfile() { return profiles.find(p => p.id === currentProfileId) || profiles[0]; }
function persistProfiles() {
  localStorage.setItem('fitProfiles', JSON.stringify(profiles));
  localStorage.setItem('fitCurrentProfile', currentProfileId);
}

// One-time migration: copy old global keys → louis profile namespace
if (!localStorage.getItem('fitMigrated')) {
  [['fitnessTraining','training'],['fitnessVideos','videos'],['fitnessYoutube','youtube'],
   ['fitnessNotes','notes'],['fitnessProgress','progress'],['fitnessMealOptions','meals'],
   ['fitnessWeekCount','weekCount'],['fitnessDayCount','dayCount']].forEach(([o,n]) => {
    const v = localStorage.getItem(o); if (v) localStorage.setItem('p_louis_'+n, v);
  });
  localStorage.setItem('fitMigrated','1');
}

// ============================================================
// APP STATE (profile-scoped)
// ============================================================
let currentWeek = 1;
let currentDay  = 1;
let currentNutDay = 'lundi';
let currentExercise = null;
let charts = {};
let savedVideos, savedYoutube, savedNotes, savedProgress, mealOptions, weekCount, dayCount;

// Timer state (keyed by exercise index in current view)
let timerState = {};
let timerDefaults = {};
// Meal check state (keyed by "day_mealId_itIdx")
let mealChecks = {};
// Voice recordings (keyed by exercise name → base64 data URL)
let savedVoice = {};
// Workout feedback (keyed by "dayId_weekNum")
let workoutFeedback = {};
// MediaRecorder state
let _recState = {};
// Progress photos (keyed by "week_view" → data URL)
let progressPhotos = {};
// Body measurements (array of {week, poids, taille, waist, chest, armL, armR, thighL, thighR, hips, fat})
let measurements = [];

function loadProfileData() {
  const saved = JSON.parse(localStorage.getItem(pk('training')) || 'null');
  trainingData.days = saved || JSON.parse(JSON.stringify(_DEFAULT_DAYS));
  savedVideos   = JSON.parse(localStorage.getItem(pk('videos'))   || '{}');
  savedYoutube  = JSON.parse(localStorage.getItem(pk('youtube'))  || '{}');
  savedNotes    = JSON.parse(localStorage.getItem(pk('notes'))    || '{}');
  savedProgress = JSON.parse(localStorage.getItem(pk('progress')) || JSON.stringify(progressData));
  mealOptions   = JSON.parse(localStorage.getItem(pk('meals'))    || '{}');
  weekCount     = parseInt(localStorage.getItem(pk('weekCount'))  || '5');
  dayCount      = parseInt(localStorage.getItem(pk('dayCount'))   || String(Object.keys(trainingData.days).length));
  timerDefaults   = JSON.parse(localStorage.getItem(pk('timers'))      || '{}');
  mealChecks      = JSON.parse(localStorage.getItem(pk('mealChecks'))  || '{}');
  savedVoice      = JSON.parse(localStorage.getItem(pk('voice'))        || '{}');
  workoutFeedback = JSON.parse(localStorage.getItem(pk('feedback'))     || '{}');
  progressPhotos  = JSON.parse(localStorage.getItem(pk('photos'))       || '{}');
  measurements    = JSON.parse(localStorage.getItem(pk('measurements')) || '[]');
  const savedNut = localStorage.getItem(pk('nutData'));
  if (savedNut) nutritionData.meals = JSON.parse(savedNut);
  currentWeek = 1; currentDay = 1; currentNutDay = 'lundi';
}

loadProfileData();

function persistTraining() {
  localStorage.setItem(pk('training'), JSON.stringify(trainingData.days));
  _saveStudentPlanToSupabase();
}
function persistCounts() {
  localStorage.setItem(pk('weekCount'), weekCount);
  localStorage.setItem(pk('dayCount'),  dayCount);
}

// ── Sync full plan structure to Supabase ──────────────────────
// Called after any structural edit (exercises, days, weeks, labels).
// Debounced so rapid edits don't flood the API.
let _planSaveTimer = null;
function _saveStudentPlanToSupabase() {
  if (typeof sb === 'undefined' || typeof activeStudentId !== 'function' || !activeStudentId()) return;
  clearTimeout(_planSaveTimer);
  _planSaveTimer = setTimeout(async () => {
    const studentId = activeStudentId();
    if (!studentId) return;

    // Fetch the plan id for this student
    const { data: plan } = await sb
      .from('workout_plans')
      .select('id')
      .eq('student_id', studentId)
      .maybeSingle();
    if (!plan) return;

    // Update plan meta
    await sb.from('workout_plans').update({
      week_count: weekCount,
      day_count:  dayCount,
      updated_at: new Date().toISOString(),
    }).eq('id', plan.id);

    // Delete all existing assignments then re-insert
    await sb.from('exercise_assignments').delete().eq('plan_id', plan.id);

    const assignments = [];
    Object.entries(trainingData.days).forEach(([dayNum, day]) => {
      (day.exercises || []).forEach((ex, pos) => {
        const firstWeek = ex.weeks && ex.weeks[0];
        assignments.push({
          plan_id:        plan.id,
          day_number:     Number(dayNum),
          position:       pos,
          name:           ex.name || '',
          tips:           ex.tips || '',
          target_series:  firstWeek ? (parseInt(firstWeek.series) || null) : null,
          target_reps:    firstWeek ? String(firstWeek.reps || '') : '',
          target_charge:  firstWeek ? (parseFloat(firstWeek.charge) || null) : null,
        });
      });
    });

    if (assignments.length > 0) {
      await sb.from('exercise_assignments').insert(assignments);
    }
  }, 800);
}

// ============================================================
// DYNAMIC KPIs
// ============================================================
function updateKPIs() {
  const days = trainingData.days;
  const dayIds = Object.keys(days).map(Number).filter(d => d <= dayCount);

  let totalExercicesDone = 0;
  let joursRealises = 0;
  let seminesCompletes = 0;

  for (let w = 0; w < weekCount; w++) {
    let daysCompletedThisWeek = 0;

    for (const dayId of dayIds) {
      const exercises = days[dayId].exercises;
      let dayHasDone = false;

      for (const ex of exercises) {
        const wData = ex.weeks[w];
        const done = wData && String(wData.done || '').trim();
        if (done && done !== '—' && done !== '') {
          totalExercicesDone++;
          dayHasDone = true;
        }
      }

      if (dayHasDone) {
        joursRealises++;
        daysCompletedThisWeek++;
      }
    }

    // A week is complete if at least one day was done in it
    if (daysCompletedThisWeek >= 1) seminesCompletes++;
  }

  document.getElementById('kpi-jours').textContent     = joursRealises;
  document.getElementById('kpi-semaines').textContent  = seminesCompletes;
  document.getElementById('kpi-exercices').textContent = totalExercicesDone;
}

// ============================================================
// TAB NAVIGATION
// ============================================================
const TAB_LABELS = {
  training: "Plan d'Entraînement",
  graphs:   'Graphiques',
  nutrition:'Plan Alimentaire',
  photos:   'Photos & Mesures',
};

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-drawer-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const idx = ['training','graphs','nutrition','photos'].indexOf(tab);
  if (idx !== -1) {
    document.querySelectorAll('.nav-btn')[idx].classList.add('active');
    document.querySelectorAll('.nav-drawer-btn')[idx].classList.add('active');
  }
  const lbl = document.getElementById('nav-mobile-label');
  if (lbl) lbl.textContent = TAB_LABELS[tab] || tab;
  if (tab === 'graphs') initCharts();
  if (tab === 'nutrition') renderMeals();
  if (tab === 'photos') renderPhotosTab();
}

function toggleMobileNav() {
  const drawer = document.getElementById('nav-drawer');
  const btn    = document.getElementById('nav-hamburger');
  if (!drawer) return;
  const open = drawer.classList.toggle('open');
  if (btn) btn.classList.toggle('open', open);
  if (open) {
    const header = document.querySelector('.header');
    if (header) drawer.style.top = header.getBoundingClientRect().height + 'px';
    // Use a document-level listener so the drawer buttons are never blocked
    setTimeout(() => document.addEventListener('click', _navOutsideClick), 0);
  } else {
    document.removeEventListener('click', _navOutsideClick);
  }
}

function _navOutsideClick(e) {
  const drawer = document.getElementById('nav-drawer');
  const btn    = document.getElementById('nav-hamburger');
  if (drawer && !drawer.contains(e.target) && btn && !btn.contains(e.target)) {
    closeMobileNav();
  }
}

function closeMobileNav() {
  const drawer = document.getElementById('nav-drawer');
  const btn    = document.getElementById('nav-hamburger');
  if (drawer) drawer.classList.remove('open');
  if (btn)    btn.classList.remove('open');
  document.removeEventListener('click', _navOutsideClick);
}

// ============================================================
// TRAINING — SELECTORS (dynamic)
// ============================================================
function renderSelectors() {
  // Day buttons
  const dayContainer = document.getElementById('day-btns-container');
  if (dayContainer) {
    let html = '';
    for (let d = 1; d <= dayCount; d++) {
      html += `<button class="day-btn ${d === currentDay ? 'active' : ''}" onclick="selectDay(${d},this)">Jour ${d}</button>`;
    }
    dayContainer.innerHTML = html;
  }
  // Week buttons
  const weekContainer = document.getElementById('week-btns-container');
  if (weekContainer) {
    let html = '';
    for (let w = 1; w <= weekCount; w++) {
      html += `<button class="week-btn ${w === currentWeek ? 'active' : ''}" onclick="selectWeek(${w},this)">S${w}</button>`;
    }
    weekContainer.innerHTML = html;
  }
}

function selectWeek(w, btn) {
  currentWeek = w;
  document.querySelectorAll('#week-btns-container .week-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTraining();
}

function selectDay(d, btn) {
  currentDay = d;
  document.querySelectorAll('#day-btns-container .day-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTraining();
}

// Clone current day's exercises to a new day
function repeatTraining(sourceDay) {
  const newId = dayCount + 1;
  dayCount++;
  const sourceExercises = (trainingData.days[sourceDay] || {}).exercises || [];
  // Copy structure (name, tips) and week 1 targets only — other weeks start blank
  const copiedExercises = JSON.parse(JSON.stringify(sourceExercises)).map(ex => {
    const firstWeek = (ex.weeks && ex.weeks[0]) || {};
    ex.weeks = Array.from({ length: weekCount }, (_, wi) =>
      wi === 0
        ? { series: firstWeek.series ?? '', reps: firstWeek.reps ?? '', charge: firstWeek.charge ?? '', done: '' }
        : { series: '', reps: '', charge: '', done: '' }
    );
    return ex;
  });
  trainingData.days[newId] = { label: `Jour ${newId}`, exercises: copiedExercises };
  persistTraining();
  persistCounts();
  currentDay = newId;
  renderSelectors();
  renderTraining();
}

// Add / remove days
function addDay() {
  const newId = dayCount + 1;
  dayCount++;
  if (!trainingData.days[newId]) {
    trainingData.days[newId] = {
      label: `Jour ${newId}`,
      exercises: []
    };
    persistTraining();
  }
  persistCounts();
  renderSelectors();
  // Auto-navigate to the new day
  currentDay = newId;
  renderSelectors();
  renderTraining();
}

function removeDay() {
  const d = currentDay;
  if (dayCount <= 1) {
    if (!confirm(`Effacer tous les exercices de Jour 1 ?`)) return;
    trainingData.days[1] = { label: 'Jour 1', exercises: [] };
    for (let w = 1; w <= weekCount; w++) _deleteFeedbackKey(`1_${w}`);
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
    Object.keys(savedVoice).forEach(k => { if (k.startsWith('1_')) delete savedVoice[k]; });
    localStorage.setItem(pk('voice'), JSON.stringify(savedVoice));
    persistTraining();
    renderTraining();
    return;
  }
  if (!confirm(`Supprimer Jour ${d} et tous ses exercices ?`)) return;
  // Delete feedback for the removed day
  for (let w = 1; w <= weekCount; w++) _deleteFeedbackKey(`${d}_${w}`);
  // Shift feedback keys for days above d down by one
  const newFeedback = {};
  Object.keys(workoutFeedback).forEach(key => {
    const [kd, kw] = key.split('_').map(Number);
    if (kd === d) return; // already deleted above
    const newKey = kd > d ? `${kd - 1}_${kw}` : key;
    newFeedback[newKey] = workoutFeedback[key];
  });
  workoutFeedback = newFeedback;
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  // Delete voice recordings for the removed day, shift keys for days above d
  const newVoice = {};
  Object.keys(savedVoice).forEach(key => {
    const sep = key.indexOf('_');
    const kd = Number(key.slice(0, sep));
    const exPart = key.slice(sep + 1);
    if (kd === d) return;
    const newKey = kd > d ? `${kd - 1}_${exPart}` : key;
    newVoice[newKey] = savedVoice[key];
  });
  savedVoice = newVoice;
  localStorage.setItem(pk('voice'), JSON.stringify(savedVoice));
  // Shift days
  const newDays = {};
  for (let i = 1; i <= dayCount; i++) {
    if (i === d) continue;
    const dest = i < d ? i : i - 1;
    newDays[dest] = trainingData.days[i] || { label: `Jour ${dest}`, exercises: [] };
    newDays[dest].label = `Jour ${dest}`;
  }
  trainingData.days = newDays;
  dayCount--;
  currentDay = Math.min(d, dayCount);
  persistTraining();
  persistCounts();
  renderSelectors();
  renderTraining();
}

// Add / remove weeks
function addWeek() {
  weekCount++;
  // Extend every exercise's weeks array if needed
  Object.values(trainingData.days).forEach(day => {
    day.exercises.forEach(ex => {
      while (ex.weeks.length < weekCount) {
        ex.weeks.push({ series: '', reps: '', charge: '', done: '' });
      }
    });
  });
  persistTraining();
  persistCounts();
  renderSelectors();
}

function removeWeek() {
  const w = currentWeek;
  if (weekCount <= 1) {
    if (!confirm(`Effacer toutes les données de S1 ?`)) return;
    Object.values(trainingData.days).forEach(day => {
      day.exercises.forEach(ex => {
        ex.weeks = [{ series: '', reps: '', charge: '', done: '' }];
      });
    });
    for (let d = 1; d <= dayCount; d++) _deleteFeedbackKey(`${d}_1`);
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
    currentWeek = 1;
    persistTraining();
    persistCounts();
    renderSelectors();
    renderTraining();
    return;
  }
  if (!confirm(`Supprimer S${w} et toutes ses données ?`)) return;
  // Delete feedback for the removed week
  for (let d = 1; d <= dayCount; d++) _deleteFeedbackKey(`${d}_${w}`);
  // Shift feedback keys for weeks above w down by one
  const newFeedback = {};
  Object.keys(workoutFeedback).forEach(key => {
    const [kd, kw] = key.split('_').map(Number);
    if (kw === w) return; // already deleted above
    const newKey = kw > w ? `${kd}_${kw - 1}` : key;
    newFeedback[newKey] = workoutFeedback[key];
  });
  workoutFeedback = newFeedback;
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  // Remove the selected week from every exercise
  Object.values(trainingData.days).forEach(day => {
    day.exercises.forEach(ex => { ex.weeks.splice(w - 1, 1); });
  });
  weekCount--;
  currentWeek = Math.min(w, weekCount);
  persistTraining();
  persistCounts();
  renderSelectors();
  renderTraining();
}

// ============================================================
// TRAINING — RENDER (inline editable)
// ============================================================
function renderTraining() {
  stopAllTimers();
  const grid = document.getElementById('training-grid');
  const dayData = trainingData.days[currentDay] || { label: `Jour ${currentDay}`, exercises: [] };
  const wIdx = currentWeek - 1;

  let html = `
    <div class="day-header">
      <h2 contenteditable="true" class="editable-title" onblur="saveDayLabel(${currentDay}, this)">${h(dayData.label)}</h2>
      <span class="week-badge">Semaine ${currentWeek}</span>
      <button class="btn-repeat-training" onclick="repeatTraining(${currentDay})">🔁 Répéter cet entraînement</button>
    </div>
    <div class="exercises-list">`;

  dayData.exercises.forEach((ex, i) => {
    const w = ex.weeks[wIdx] || { series:'', reps:'', charge:'', done:'' };
    const hasVideo = savedVideos[ex.name];

    // Feature 2: previous session hints
    let prevHint = '';
    let prevChargeHint = '';
    if (wIdx > 0) {
      const prevW = ex.weeks[wIdx - 1];
      const prevDone = prevW && String(prevW.done || '').trim();
      if (prevDone && prevDone !== '—') {
        prevHint = `<span class="prev-session">S${wIdx}: ${h(prevDone)}</span>`;
      }
      const prevCharge = prevW && String(prevW.charge || '').trim();
      if (prevCharge && prevCharge !== '—') {
        prevChargeHint = `<span class="prev-session">S${wIdx}: ${h(prevCharge)} kg</span>`;
      }
    }

    // Feature 1: rest timer defaults
    const timerKey = h(ex.name);
    const defaultSecs = timerDefaults[timerKey] || 90;

    // Voice recording
    const voiceKey = currentDay + '_' + ex.name;
    const hasVoice = !!savedVoice[voiceKey];
    const _coachMode = typeof isCoach === 'function' && isCoach();
    let voiceHtml = '';
    const playerHtml = `
        <audio id="voice-audio-${i}" preload="metadata"></audio>
        <div class="voice-player" id="voice-player-${i}">
          <button class="voice-play-btn" id="voice-play-${i}" onclick="toggleVoicePlay(${i})" title="Lecture">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="voice-progress-wrap" id="voice-prog-wrap-${i}" onclick="seekVoice(event,${i})">
            <div class="voice-progress-bar" id="voice-prog-${i}"></div>
          </div>
          <span class="voice-time" id="voice-time-${i}">0:00</span>
        </div>`;
    if (_coachMode) {
      voiceHtml = `
      <div class="ex-voice" id="voice-${i}">
        <span class="ex-voice-label">🎙 Coach</span>
        <button class="voice-btn${hasVoice ? ' has-audio' : ''}" id="voice-rec-${i}"
                onclick="toggleVoiceRecord(${i})">${hasVoice ? '● Ré-enregistrer' : '● Enregistrer'}</button>
        ${hasVoice ? `${playerHtml}
        <button class="voice-delete-btn" onclick="deleteVoice(${i})" title="Supprimer">✕</button>` : ''}
      </div>`;
    } else if (hasVoice) {
      voiceHtml = `
      <div class="ex-voice ex-voice-student" id="voice-${i}">
        <span class="ex-voice-label">🎙 Coach</span>
        ${playerHtml}
      </div>`;
    }

    html += `
      <div class="exercise-card" id="ex-card-${i}">
        <div class="ex-top">
          <div class="ex-name-wrap">
            <span class="ex-number">${i+1}</span>
            <div>
              <div class="ex-name editable"
                   contenteditable="true"
                   onblur="saveField(${currentDay},${i},'name',this)"
                   title="Cliquez pour modifier">${h(ex.name)}</div>
              <div class="ex-tips editable"
                   contenteditable="true"
                   onblur="saveField(${currentDay},${i},'tips',this)"
                   title="Conseils">${h(ex.tips || 'Ajouter des conseils…')}</div>
            </div>
          </div>
          <div class="ex-actions">
            <div class="ex-video-badge ${(hasVideo || savedYoutube[ex.name]) ? 'has-video' : ''}"
                 onclick="openExerciseModal(${currentDay},${i})">
              ${(hasVideo || savedYoutube[ex.name]) ? '▶ Vidéo' : '+ Vidéo'}
            </div>
            <button class="ex-delete-btn" onclick="deleteExercise(${currentDay},${i})" title="Supprimer">✕</button>
          </div>
        </div>
        ${voiceHtml}
        <div class="ex-metrics">
          <div class="metric">
            <span class="metric-label">Séries</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'series',this)">${h(String(w.series ?? ''))}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Reps</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'reps',this)">${h(String(w.reps ?? ''))}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Charge (kg)</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'charge',this)">${h(String(w.charge ?? ''))}</span>
            ${prevChargeHint}
          </div>
          <div class="metric done-metric">
            <span class="metric-label">Réalisé</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'done',this)">${h(String(w.done ?? ''))}</span>
            ${prevHint}
          </div>
        </div>
        <div class="ex-timer" id="timer-${i}">
          <div class="timer-left">
            <div class="timer-label-row">
              <span class="timer-label">Repos</span>
              <input class="timer-input" type="number" min="5" max="600" value="${defaultSecs}"
                     onchange="setTimerDefault(${i}, this.value)" title="Durée (sec)">
            </div>
            <div class="timer-btns-row">
              <button class="timer-btn" id="timer-btn-${i}" onclick="toggleTimer(${i})">▶</button>
              <button class="timer-reset" onclick="resetTimer(${i})" title="Reset">↺</button>
            </div>
          </div>
          <div class="timer-right">
            <span class="timer-sec" id="timer-val-${i}">${defaultSecs}</span><span class="timer-sec-unit">s</span>
          </div>
        </div>
      </div>`;
  });

  // Workout feedback section for this day
  const fbKey = currentDay + '_' + currentWeek;
  const fb = workoutFeedback[fbKey] || { rating: 0, note: '', pain: [] };
  const stars = [1,2,3,4,5].map(n =>
    `<button class="star-btn${n <= fb.rating ? ' lit' : ''}" data-star="${n}" onclick="setFeedbackRating('${fbKey}',${n})">★</button>`
  ).join('');

  // "Séance terminée" button + saved summary card
  const hasFeedback = fb.rating > 0 || (fb.note || '').trim() || (fb.pain || []).length;
  const summaryStars = [1,2,3,4,5].map(n => `<span class="sum-star${n <= fb.rating ? ' lit' : ''}">★</span>`).join('');
  html += `
    </div>
    <div class="seance-footer" id="seance-footer">
      <button class="btn-seance-terminee" onclick="openBilanOverlay('${fbKey}')">
        ${hasFeedback ? '✏️ Modifier le bilan' : '✅ Séance terminée'}
      </button>
      ${hasFeedback ? `
      <div class="bilan-summary" id="bilan-summary">
        <div class="bilan-summary-header">
          <span class="bilan-summary-title">Bilan de la séance</span>
          <div class="sum-stars">${summaryStars}</div>
        </div>
        ${fb.note ? `<p class="bilan-summary-note">${h(fb.note)}</p>` : ''}
        ${(fb.pain||[]).length ? `<p class="bilan-summary-pain">🔴 ${fb.pain.length} zone${fb.pain.length > 1 ? 's' : ''} douloureuse${fb.pain.length > 1 ? 's' : ''} marquée${fb.pain.length > 1 ? 's' : ''}</p>` : ''}
      </div>` : ''}
    </div>`;

  grid.innerHTML = html;
  // Set audio src and wire custom player after render
  dayData.exercises.forEach((ex, i) => {
    const vKey = currentDay + '_' + ex.name;
    if (!savedVoice[vKey]) return;
    const audioEl = document.getElementById('voice-audio-' + i);
    if (!audioEl) return;
    const dataUrl = savedVoice[vKey];
    try {
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)[1];
      const bytes = atob(b64);
      const buf = new Uint8Array(bytes.length);
      for (let k = 0; k < bytes.length; k++) buf[k] = bytes.charCodeAt(k);
      audioEl.src = URL.createObjectURL(new Blob([buf], { type: mime }));
    } catch (_) {
      audioEl.src = dataUrl;
    }
    _wireVoicePlayer(audioEl, i);
  });
  updateKPIs();
}

// ============================================================
// BODY SVG HELPERS (silhouette outlines)
// ============================================================
function _bodyFrontSVG() {
  // Detailed front muscular anatomy — viewBox 0 0 100 230
  return `<defs>
    <radialGradient id="mg" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#4a4a4a"/>
      <stop offset="100%" stop-color="#1e1e1e"/>
    </radialGradient>
    <radialGradient id="skinhi" cx="50%" cy="30%" r="55%">
      <stop offset="0%" stop-color="#555" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#222" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- neck -->
  <path class="bm-fill" d="M43,32 Q44,26 50,25 Q56,26 57,32 L56,38 Q50,40 44,38 Z"/>
  <!-- head -->
  <ellipse class="bm-fill" cx="50" cy="19" rx="12" ry="14.5"/>
  <ellipse fill="url(#skinhi)" cx="50" cy="16" rx="9" ry="10" opacity="0.4"/>
  <!-- trap left -->
  <path class="bm-fill bm-muscle" d="M43,38 Q36,36 28,42 Q26,48 30,52 Q36,48 44,46 Z"/>
  <!-- trap right -->
  <path class="bm-fill bm-muscle" d="M57,38 Q64,36 72,42 Q74,48 70,52 Q64,48 56,46 Z"/>
  <!-- left shoulder (deltoid) -->
  <path class="bm-fill bm-muscle" d="M26,42 Q18,44 15,52 Q14,60 18,64 Q24,60 28,52 Z"/>
  <!-- right shoulder (deltoid) -->
  <path class="bm-fill bm-muscle" d="M74,42 Q82,44 85,52 Q86,60 82,64 Q76,60 72,52 Z"/>
  <!-- chest left (pec) -->
  <path class="bm-fill bm-muscle" d="M30,48 Q30,56 34,62 Q40,66 50,64 Q50,56 48,50 Q40,46 30,48 Z"/>
  <!-- chest right (pec) -->
  <path class="bm-fill bm-muscle" d="M70,48 Q70,56 66,62 Q60,66 50,64 Q50,56 52,50 Q60,46 70,48 Z"/>
  <!-- pec divider line -->
  <line x1="50" y1="48" x2="50" y2="64" stroke="#111" stroke-width="0.8" opacity="0.6"/>
  <!-- sternum highlight -->
  <line x1="50" y1="40" x2="50" y2="86" stroke="#666" stroke-width="0.6" opacity="0.4"/>
  <!-- abs (6-pack) -->
  <path class="bm-fill bm-muscle" d="M38,66 Q36,78 37,90 Q43,94 50,93 Q57,94 63,90 Q64,78 62,66 Q56,63 50,63 Q44,63 38,66 Z"/>
  <!-- abs horizontal lines -->
  <path fill="none" stroke="#1a1a1a" stroke-width="1" d="M39,72 Q50,74 61,72"/>
  <path fill="none" stroke="#1a1a1a" stroke-width="1" d="M38,80 Q50,82 62,80"/>
  <!-- abs vertical line -->
  <line x1="50" y1="64" x2="50" y2="92" stroke="#111" stroke-width="1.2" opacity="0.7"/>
  <!-- obliques left -->
  <path class="bm-fill bm-muscle" d="M37,68 Q30,72 28,82 Q30,90 37,92 Q37,80 38,70 Z"/>
  <!-- obliques right -->
  <path class="bm-fill bm-muscle" d="M63,68 Q70,72 72,82 Q70,90 63,92 Q63,80 62,70 Z"/>
  <!-- left upper arm (bicep) -->
  <path class="bm-fill bm-muscle" d="M18,64 Q14,72 15,82 Q18,88 24,88 Q28,82 28,72 Q26,64 20,62 Z"/>
  <!-- right upper arm (bicep) -->
  <path class="bm-fill bm-muscle" d="M82,64 Q86,72 85,82 Q82,88 76,88 Q72,82 72,72 Q74,64 80,62 Z"/>
  <!-- left forearm -->
  <path class="bm-fill" d="M15,88 Q12,96 13,108 Q16,114 21,112 Q26,106 26,96 Q25,88 21,86 Z"/>
  <!-- right forearm -->
  <path class="bm-fill" d="M85,88 Q88,96 87,108 Q84,114 79,112 Q74,106 74,96 Q75,88 79,86 Z"/>
  <!-- left hand -->
  <ellipse class="bm-fill" cx="16" cy="116" rx="5" ry="7"/>
  <!-- right hand -->
  <ellipse class="bm-fill" cx="84" cy="116" rx="5" ry="7"/>
  <!-- hip / lower torso -->
  <path class="bm-fill" d="M37,91 Q32,94 30,100 Q32,108 38,110 Q44,112 50,112 Q56,112 62,110 Q68,108 70,100 Q68,94 63,91 Q56,93 50,93 Q44,93 37,91 Z"/>
  <!-- left quad -->
  <path class="bm-fill bm-muscle" d="M30,108 Q27,118 27,132 Q28,144 34,148 Q40,150 44,144 Q47,134 46,118 Q43,110 36,108 Z"/>
  <!-- right quad -->
  <path class="bm-fill bm-muscle" d="M70,108 Q73,118 73,132 Q72,144 66,148 Q60,150 56,144 Q53,134 54,118 Q57,110 64,108 Z"/>
  <!-- quad inner left line -->
  <path fill="none" class="bm-inner" d="M37,112 Q40,128 38,144"/>
  <!-- quad inner right line -->
  <path fill="none" class="bm-inner" d="M63,112 Q60,128 62,144"/>
  <!-- left knee -->
  <ellipse class="bm-fill" cx="35" cy="151" rx="9" ry="6"/>
  <!-- right knee -->
  <ellipse class="bm-fill" cx="65" cy="151" rx="9" ry="6"/>
  <!-- left shin (tibia) -->
  <path class="bm-fill" d="M28,157 Q26,170 27,184 Q30,190 35,190 Q40,190 42,184 Q43,170 41,157 Q38,154 34,155 Z"/>
  <!-- right shin -->
  <path class="bm-fill" d="M72,157 Q74,170 73,184 Q70,190 65,190 Q60,190 58,184 Q57,170 59,157 Q62,154 66,155 Z"/>
  <!-- left foot -->
  <ellipse class="bm-fill" cx="34" cy="194" rx="9" ry="5"/>
  <!-- right foot -->
  <ellipse class="bm-fill" cx="66" cy="194" rx="9" ry="5"/>
  <!-- muscle highlight overlays -->
  <ellipse fill="url(#skinhi)" cx="40" cy="56" rx="7" ry="8" opacity="0.25"/>
  <ellipse fill="url(#skinhi)" cx="60" cy="56" rx="7" ry="8" opacity="0.25"/>
  <ellipse fill="url(#skinhi)" cx="20" cy="72" rx="5" ry="7" opacity="0.2"/>
  <ellipse fill="url(#skinhi)" cx="80" cy="72" rx="5" ry="7" opacity="0.2"/>`;
}

function _bodyBackSVG() {
  // Detailed back muscular anatomy — viewBox 0 0 100 230
  return `<defs>
    <radialGradient id="mgb" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#4a4a4a"/>
      <stop offset="100%" stop-color="#1e1e1e"/>
    </radialGradient>
  </defs>
  <!-- head (back) -->
  <ellipse class="bm-fill" cx="50" cy="19" rx="12" ry="14.5"/>
  <!-- neck -->
  <path class="bm-fill" d="M44,33 Q50,36 56,33 L57,38 Q50,41 43,38 Z"/>
  <!-- trapezius (large diamond shape) -->
  <path class="bm-fill bm-muscle" d="M44,38 Q36,40 28,50 Q26,58 30,62 Q38,60 44,54 Q48,50 50,50 Q52,50 56,54 Q62,60 70,62 Q74,58 72,50 Q64,40 56,38 Q53,37 50,37 Q47,37 44,38 Z"/>
  <!-- trap center ridge -->
  <line x1="50" y1="38" x2="50" y2="60" stroke="#1a1a1a" stroke-width="1.2" opacity="0.6"/>
  <!-- left shoulder (rear deltoid) -->
  <path class="bm-fill bm-muscle" d="M26,50 Q18,52 15,60 Q14,68 18,72 Q24,68 28,60 Z"/>
  <!-- right shoulder (rear deltoid) -->
  <path class="bm-fill bm-muscle" d="M74,50 Q82,52 85,60 Q86,68 82,72 Q76,68 72,60 Z"/>
  <!-- left lat -->
  <path class="bm-fill bm-muscle" d="M30,60 Q26,70 28,84 Q32,92 40,92 Q46,88 46,78 Q44,66 38,60 Z"/>
  <!-- right lat -->
  <path class="bm-fill bm-muscle" d="M70,60 Q74,70 72,84 Q68,92 60,92 Q54,88 54,78 Q56,66 62,60 Z"/>
  <!-- spine line -->
  <line x1="50" y1="38" x2="50" y2="100" stroke="#555" stroke-width="0.8" opacity="0.5"/>
  <!-- lower back (erector spinae) -->
  <path class="bm-fill bm-muscle" d="M40,84 Q38,92 38,100 Q42,104 50,104 Q58,104 62,100 Q62,92 60,84 Q55,86 50,86 Q45,86 40,84 Z"/>
  <!-- erector ridges -->
  <line x1="46" y1="86" x2="46" y2="102" stroke="#1a1a1a" stroke-width="0.8" opacity="0.6"/>
  <line x1="54" y1="86" x2="54" y2="102" stroke="#1a1a1a" stroke-width="0.8" opacity="0.6"/>
  <!-- glute left -->
  <path class="bm-fill bm-muscle" d="M30,100 Q28,110 30,120 Q36,128 44,126 Q50,122 50,112 Q48,102 40,100 Z"/>
  <!-- glute right -->
  <path class="bm-fill bm-muscle" d="M70,100 Q72,110 70,120 Q64,128 56,126 Q50,122 50,112 Q52,102 60,100 Z"/>
  <!-- glute divider -->
  <line x1="50" y1="102" x2="50" y2="122" stroke="#111" stroke-width="1" opacity="0.6"/>
  <!-- left upper arm (tricep) -->
  <path class="bm-fill bm-muscle" d="M18,70 Q14,78 15,90 Q18,96 24,96 Q28,90 28,78 Q26,70 20,68 Z"/>
  <!-- right upper arm (tricep) -->
  <path class="bm-fill bm-muscle" d="M82,70 Q86,78 85,90 Q82,96 76,96 Q72,90 72,78 Q74,70 80,68 Z"/>
  <!-- tricep horseshoe lines -->
  <path fill="none" stroke="#1a1a1a" stroke-width="0.8" d="M19,76 Q21,86 19,92"/>
  <path fill="none" stroke="#1a1a1a" stroke-width="0.8" d="M81,76 Q79,86 81,92"/>
  <!-- left forearm (back) -->
  <path class="bm-fill" d="M15,96 Q12,106 13,116 Q16,122 21,120 Q26,114 26,104 Q25,96 21,94 Z"/>
  <!-- right forearm (back) -->
  <path class="bm-fill" d="M85,96 Q88,106 87,116 Q84,122 79,120 Q74,114 74,104 Q75,96 79,94 Z"/>
  <!-- left hand -->
  <ellipse class="bm-fill" cx="16" cy="124" rx="5" ry="7"/>
  <!-- right hand -->
  <ellipse class="bm-fill" cx="84" cy="124" rx="5" ry="7"/>
  <!-- left hamstring -->
  <path class="bm-fill bm-muscle" d="M30,124 Q27,136 28,150 Q30,158 36,160 Q42,160 44,152 Q46,140 44,128 Q40,122 34,122 Z"/>
  <!-- right hamstring -->
  <path class="bm-fill bm-muscle" d="M70,124 Q73,136 72,150 Q70,158 64,160 Q58,160 56,152 Q54,140 56,128 Q60,122 66,122 Z"/>
  <!-- ham divider lines -->
  <path fill="none" class="bm-inner" d="M34,128 Q36,142 34,156"/>
  <path fill="none" class="bm-inner" d="M66,128 Q64,142 66,156"/>
  <!-- left knee (back) -->
  <ellipse class="bm-fill" cx="35" cy="163" rx="9" ry="6"/>
  <!-- right knee (back) -->
  <ellipse class="bm-fill" cx="65" cy="163" rx="9" ry="6"/>
  <!-- left calf -->
  <path class="bm-fill bm-muscle" d="M28,169 Q26,180 27,190 Q30,196 35,196 Q40,196 42,190 Q43,178 41,169 Q38,166 34,166 Z"/>
  <!-- right calf -->
  <path class="bm-fill bm-muscle" d="M72,169 Q74,180 73,190 Q70,196 65,196 Q60,196 58,190 Q57,178 59,169 Q62,166 66,166 Z"/>
  <!-- calf medial line left -->
  <path fill="none" class="bm-inner" d="M34,170 Q36,180 34,190"/>
  <!-- calf medial line right -->
  <path fill="none" class="bm-inner" d="M66,170 Q64,180 66,190"/>
  <!-- left foot -->
  <ellipse class="bm-fill" cx="34" cy="200" rx="9" ry="5"/>
  <!-- right foot -->
  <ellipse class="bm-fill" cx="66" cy="200" rx="9" ry="5"/>
  <!-- highlight overlays -->
  <ellipse fill="#666" cx="37" cy="68" rx="6" ry="9" opacity="0.15"/>
  <ellipse fill="#666" cx="63" cy="68" rx="6" ry="9" opacity="0.15"/>
  <ellipse fill="#666" cx="50" cy="52" rx="8" ry="8" opacity="0.1"/>`;
}

// ============================================================
// WORKOUT FEEDBACK
// ============================================================
function setFeedbackRating(fbKey, n) {
  if (!workoutFeedback[fbKey]) workoutFeedback[fbKey] = { rating: 0, note: '', pain: [] };
  workoutFeedback[fbKey].rating = n;
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  document.querySelectorAll('#star-row .star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.star) <= n);
  });
}

function saveFeedbackNote(fbKey, el) {
  if (!workoutFeedback[fbKey]) workoutFeedback[fbKey] = { rating: 0, note: '', pain: [] };
  workoutFeedback[fbKey].note = el.value;
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
}

function addPainDot(event, fbKey, view) {
  const svg = event.currentTarget;
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scaleX = vb.width / rect.width;
  const scaleY = vb.height / rect.height;
  const x = Math.round((event.clientX - rect.left) * scaleX);
  const y = Math.round((event.clientY - rect.top) * scaleY);
  if (!workoutFeedback[fbKey]) workoutFeedback[fbKey] = { rating: 0, note: '', pain: [] };
  workoutFeedback[fbKey].pain = workoutFeedback[fbKey].pain || [];
  workoutFeedback[fbKey].pain.push({ view, x, y });
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  // Add dot directly to SVG without full re-render
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('class', 'pain-dot');
  circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', '5');
  svg.appendChild(circle);
}

function clearPain(fbKey) {
  if (!workoutFeedback[fbKey]) return;
  workoutFeedback[fbKey].pain = [];
  localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  document.querySelectorAll('.pain-dot').forEach(d => d.remove());
}

// ============================================================
// BILAN OVERLAY
// ============================================================

// Patches seance-footer DOM in-place after a bilan save — avoids full renderTraining()
// which could race against async Supabase fetches and wipe the just-saved feedback.
function _renderSeanceFooter(fbKey) {
  const footer = document.getElementById('seance-footer');
  if (!footer) return;
  const fb = workoutFeedback[fbKey] || { rating: 0, note: '', pain: [] };
  const hasFeedback = fb.rating > 0 || (fb.note || '').trim() || (fb.pain || []).length;

  // Update the main action button
  const btn = footer.querySelector('.btn-seance-terminee');
  if (btn) btn.textContent = hasFeedback ? '✏️ Modifier le bilan' : '✅ Séance terminée';

  // Remove existing summary if present
  const existing = footer.querySelector('.bilan-summary');
  if (existing) existing.remove();

  if (!hasFeedback) return;

  // Build summary card
  const summary = document.createElement('div');
  summary.id = 'bilan-summary';
  summary.className = 'bilan-summary';

  const summaryHeader = document.createElement('div');
  summaryHeader.className = 'bilan-summary-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'bilan-summary-title';
  titleSpan.textContent = 'Bilan de la séance';

  const starsDiv = document.createElement('div');
  starsDiv.className = 'sum-stars';
  [1,2,3,4,5].forEach(n => {
    const s = document.createElement('span');
    s.className = 'sum-star' + (n <= fb.rating ? ' lit' : '');
    s.textContent = '★';
    starsDiv.appendChild(s);
  });

  summaryHeader.appendChild(titleSpan);
  summaryHeader.appendChild(starsDiv);
  summary.appendChild(summaryHeader);

  if ((fb.note || '').trim()) {
    const noteEl = document.createElement('p');
    noteEl.className = 'bilan-summary-note';
    noteEl.textContent = fb.note;
    summary.appendChild(noteEl);
  }

  if ((fb.pain || []).length) {
    const painEl = document.createElement('p');
    painEl.className = 'bilan-summary-pain';
    const n = fb.pain.length;
    painEl.textContent = `🔴 ${n} zone${n > 1 ? 's' : ''} douloureuse${n > 1 ? 's' : ''} marquée${n > 1 ? 's' : ''}`;
    summary.appendChild(painEl);
  }

  footer.appendChild(summary);
}

function openBilanOverlay(fbKey) {
  if (document.getElementById('bilan-overlay')) return;
  // Anchor fb in workoutFeedback immediately so all mutations (rating, pain, note) share the same object
  if (!workoutFeedback[fbKey]) workoutFeedback[fbKey] = { rating: 0, note: '', pain: [] };
  const fb = workoutFeedback[fbKey];

  const overlay = document.createElement('div');
  overlay.id = 'bilan-overlay';
  overlay.className = 'bilan-overlay';

  const box = document.createElement('div');
  box.className = 'bilan-overlay-box';

  // Header
  const header = document.createElement('div');
  header.className = 'bilan-overlay-header';
  const title = document.createElement('h3');
  title.textContent = 'Bilan de la séance';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'bilan-overlay-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Rating
  const ratingWrap = document.createElement('div');
  ratingWrap.className = 'feedback-rating';
  const ratingLabel = document.createElement('label');
  ratingLabel.textContent = 'Comment tu t\'es senti ?';
  const starRow = document.createElement('div');
  starRow.className = 'star-row';
  starRow.id = 'overlay-star-row';
  [1,2,3,4,5].forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'star-btn' + (n <= fb.rating ? ' lit' : '');
    btn.textContent = '★';
    btn.dataset.star = n;
    btn.addEventListener('click', () => {
      fb.rating = n;
      starRow.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('lit', parseInt(b.dataset.star) <= n));
    });
    starRow.appendChild(btn);
  });
  ratingWrap.appendChild(ratingLabel);
  ratingWrap.appendChild(starRow);

  // Note
  const note = document.createElement('textarea');
  note.className = 'feedback-note';
  note.placeholder = 'Notes sur la séance, sensations, observations…';
  note.value = fb.note || '';

  // Pain map
  const painLabel = document.createElement('div');
  painLabel.className = 'feedback-body-label';
  painLabel.textContent = 'Zones douloureuses — cliquer pour marquer';

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'feedback-body-wrap';

  ['front','back'].forEach(view => {
    const wrap = document.createElement('div');
    wrap.className = 'body-canvas-wrap';
    const lbl = document.createElement('span');
    lbl.textContent = view === 'front' ? 'Avant' : 'Arrière';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'body-svg');
    svg.setAttribute('viewBox', '0 0 100 210');
    svg.innerHTML = (view === 'front' ? _bodyFrontSVG() : _bodyBackSVG());
    (fb.pain || []).filter(p => p.view === view).forEach(p => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'pain-dot'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', '5');
      svg.appendChild(c);
    });
    svg.addEventListener('click', e => {
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const x = Math.round((e.clientX - rect.left) * vb.width / rect.width);
      const y = Math.round((e.clientY - rect.top) * vb.height / rect.height);
      fb.pain = fb.pain || [];
      fb.pain.push({ view, x, y });
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'pain-dot'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '5');
      svg.appendChild(c);
    });
    wrap.appendChild(lbl);
    wrap.appendChild(svg);
    bodyWrap.appendChild(wrap);
  });

  const painControls = document.createElement('div');
  painControls.className = 'feedback-body-controls';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-pain';
  clearBtn.textContent = 'Effacer les zones';
  clearBtn.addEventListener('click', () => {
    fb.pain = [];
    bodyWrap.querySelectorAll('.pain-dot').forEach(d => d.remove());
  });
  painControls.appendChild(clearBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary btn-bilan-save';
  saveBtn.textContent = 'Enregistrer & fermer';
  saveBtn.addEventListener('click', () => {
    fb.note = note.value;
    workoutFeedback[fbKey] = fb;
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
    _saveFeedbackToSupabase(fbKey, fb);
    overlay.remove();
    _renderSeanceFooter(fbKey);
  });

  // Delete button — only shown when a bilan already exists
  const hasSaved = fb.rating > 0 || (fb.note || '').trim() || (fb.pain || []).length;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-bilan-delete';
  deleteBtn.textContent = 'Supprimer le bilan';
  deleteBtn.style.display = hasSaved ? '' : 'none';
  deleteBtn.addEventListener('click', () => {
    if (!confirm('Supprimer définitivement ce bilan de séance ?')) return;
    delete workoutFeedback[fbKey];
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
    _deleteFeedbackFromSupabase(fbKey);
    overlay.remove();
    _renderSeanceFooter(fbKey);
  });

  const scrollBody = document.createElement('div');
  scrollBody.className = 'bilan-overlay-scroll';
  scrollBody.appendChild(ratingWrap);
  scrollBody.appendChild(note);
  scrollBody.appendChild(painLabel);
  scrollBody.appendChild(bodyWrap);
  scrollBody.appendChild(painControls);
  scrollBody.appendChild(saveBtn);
  scrollBody.appendChild(deleteBtn);

  box.appendChild(header);
  box.appendChild(scrollBody);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ============================================================
// VOICE RECORDING
// ============================================================
function toggleVoiceRecord(idx) {
  if (_recState[idx] && _recState[idx].recording) {
    _stopVoiceRecord(idx);
  } else {
    _startVoiceRecord(idx);
  }
}

// Pick the best supported MIME type for the current browser/device
function _bestAudioMime() {
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2', // iOS Safari
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ''; // browser default
}

function _startVoiceRecord(idx) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Microphone non disponible sur cet appareil.');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const mime = _bestAudioMime();
    const chunks = [];
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const actualMime = mr.mimeType || mime || 'audio/webm';
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: actualMime });
      const dayData = trainingData.days[currentDay];
      if (!dayData || !dayData.exercises[idx]) return;
      const exName = currentDay + '_' + dayData.exercises[idx].name;
      // Save locally as base64
      const reader = new FileReader();
      reader.onload = () => {
        savedVoice[exName] = reader.result;
        localStorage.setItem(pk('voice'), JSON.stringify(savedVoice));
        renderTraining();
      };
      reader.readAsDataURL(blob);
      // Upload to Supabase Storage for cross-device sharing
      _uploadVoiceToSupabase(blob, actualMime, exName);
    };
    mr.start();
    _recState[idx] = { recording: true, mr, stream };
    const btn = document.getElementById('voice-rec-' + idx);
    if (btn) { btn.textContent = '■ Arrêter'; btn.classList.add('recording'); }
  }).catch(err => {
    const msg = err && err.name === 'NotAllowedError'
      ? 'Accès au microphone refusé. Vérifie les permissions dans les réglages.'
      : 'Microphone non accessible : ' + (err && err.message || err);
    alert(msg);
  });
}

function _stopVoiceRecord(idx) {
  const s = _recState[idx];
  if (!s) return;
  s.mr.stop();
  s.recording = false;
}


function deleteVoice(idx) {
  const dayData = trainingData.days[currentDay];
  if (!dayData || !dayData.exercises[idx]) return;
  const exName = currentDay + '_' + dayData.exercises[idx].name;
  delete savedVoice[exName];
  localStorage.setItem(pk('voice'), JSON.stringify(savedVoice));
  _deleteVoiceFromSupabase(exName);
  renderTraining();
}

async function _uploadVoiceToSupabase(blob, mime, voiceKey) {
  if (typeof sb === 'undefined' || typeof activeStudentId !== 'function' || !activeStudentId()) return;
  const studentId = activeStudentId();
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  const path = `${studentId}/${voiceKey}.${ext}`;
  const { error: upErr } = await sb.storage.from('voice-notes').upload(path, blob, { upsert: true, contentType: mime });
  if (upErr) { console.warn('[voice upload]', upErr.message); return; }
  const { data: { publicUrl } } = sb.storage.from('voice-notes').getPublicUrl(path);
  await sb.from('coach_voice_notes').upsert({
    student_id: studentId,
    voice_key:  voiceKey,
    storage_path: path,
    public_url: publicUrl,
  }, { onConflict: 'student_id,voice_key' });
}

async function _deleteVoiceFromSupabase(voiceKey) {
  if (typeof sb === 'undefined' || typeof activeStudentId !== 'function' || !activeStudentId()) return;
  const studentId = activeStudentId();
  const { data: row } = await sb.from('coach_voice_notes')
    .select('storage_path').eq('student_id', studentId).eq('voice_key', voiceKey).maybeSingle();
  if (row && row.storage_path) await sb.storage.from('voice-notes').remove([row.storage_path]);
  await sb.from('coach_voice_notes').delete().eq('student_id', studentId).eq('voice_key', voiceKey);
}

async function _loadVoiceFromSupabase(studentId) {
  if (typeof sb === 'undefined') return;
  const { data: rows } = await sb.from('coach_voice_notes').select('voice_key, public_url').eq('student_id', studentId);
  if (!rows || !rows.length) return;
  rows.forEach(row => {
    // Only set if not already in localStorage (local is authoritative on this device)
    if (!savedVoice[row.voice_key]) {
      savedVoice[row.voice_key] = row.public_url;
    }
  });
  localStorage.setItem(pk('voice'), JSON.stringify(savedVoice));
}

function drawWaveform(idx, exName) {
  const canvas = document.getElementById('voice-wave-' + idx);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dataUrl = savedVoice[exName];
  if (!dataUrl) return;
  // Draw a static decorative waveform to indicate audio exists
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#C8FF00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const bars = 24;
  const w = canvas.width / bars;
  const mid = canvas.height / 2;
  const seed = exName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  for (let i = 0; i < bars; i++) {
    const amp = (((seed * (i + 7) * 13) % 17) / 17) * (mid - 2) + 2;
    const x = i * w + w / 2;
    ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp);
  }
  ctx.stroke();
}

// ── Custom voice player helpers ───────────────────────────────
function _fmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function _wireVoicePlayer(audioEl, i) {
  const playBtn  = document.getElementById('voice-play-' + i);
  const progBar  = document.getElementById('voice-prog-' + i);
  const timeEl   = document.getElementById('voice-time-' + i);
  if (!playBtn || !progBar || !timeEl) return;

  const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  audioEl.addEventListener('timeupdate', () => {
    const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
    progBar.style.width = pct + '%';
    timeEl.textContent = _fmtTime(audioEl.currentTime);
  });
  audioEl.addEventListener('ended', () => {
    playBtn.innerHTML = playIcon;
    progBar.style.width = '0%';
    timeEl.textContent = _fmtTime(audioEl.duration || 0);
  });
  audioEl.addEventListener('loadedmetadata', () => {
    timeEl.textContent = _fmtTime(audioEl.duration);
  });

  playBtn.addEventListener('click', () => {
    if (audioEl.paused) { audioEl.play(); playBtn.innerHTML = pauseIcon; }
    else { audioEl.pause(); playBtn.innerHTML = playIcon; }
  });
}

function seekVoice(e, i) {
  const audioEl = document.getElementById('voice-audio-' + i);
  const wrap    = document.getElementById('voice-prog-wrap-' + i);
  if (!audioEl || !wrap || !audioEl.duration) return;
  const rect = wrap.getBoundingClientRect();
  audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
}

function toggleVoicePlay(i) {
  // handled by _wireVoicePlayer listener — this stub prevents "not defined" errors
  // if the button fires before wire-up completes (shouldn't happen but safety net)
}

// ============================================================
// INLINE EDIT HELPERS
// ============================================================
function saveDayLabel(dayId, el) {
  trainingData.days[dayId].label = el.textContent.trim();
  persistTraining();
}

function saveField(dayId, exIdx, field, el) {
  const val = el.textContent.trim();
  if (field === 'name') trainingData.days[dayId].exercises[exIdx].name = val;
  if (field === 'tips') trainingData.days[dayId].exercises[exIdx].tips = val;
  persistTraining();
}

function saveWeekField(dayId, exIdx, wIdx, field, el) {
  const raw = el.textContent.trim();
  const num = parseFloat(raw);
  const val = isNaN(num) ? raw : num;
  const weeks = trainingData.days[dayId].exercises[exIdx].weeks;
  while (weeks.length <= wIdx) weeks.push({ series:'', reps:'', charge:'', done:'' });
  weeks[wIdx][field] = val;
  persistTraining();
  updateKPIs();

  // Sync to Supabase if authenticated
  if (typeof activeStudentId === 'function' && activeStudentId()) {
    const ex = trainingData.days[dayId].exercises[exIdx];
    const w  = weeks[wIdx];
    saveExerciseLog(activeStudentId(), {
      exercise_name: ex.name,
      week_number:   wIdx + 1,
      logged_date:   new Date().toISOString().slice(0, 10),
      series_done:   String(w.series || ''),
      reps_done:     String(w.reps   || ''),
      charge_kg:     parseFloat(w.charge) || null,
      completed:     field === 'done'
    });
  }
}

// ============================================================
// REST TIMER (Feature 1)
// ============================================================
function setTimerDefault(idx, val) {
  const secs = Math.max(5, Math.min(600, parseInt(val) || 90));
  const dayData = trainingData.days[currentDay];
  if (!dayData || !dayData.exercises[idx]) return;
  const exName = dayData.exercises[idx].name;
  timerDefaults[exName] = secs;
  localStorage.setItem(pk('timers'), JSON.stringify(timerDefaults));
  // update display if timer is not running
  if (!timerState[idx] || !timerState[idx].running) {
    const valEl = document.getElementById('timer-val-' + idx);
    if (valEl) valEl.textContent = secs;
    if (timerState[idx]) timerState[idx].remaining = secs;
  }
}

function toggleTimer(idx) {
  if (!timerState[idx]) {
    const dayData = trainingData.days[currentDay];
    const exName = dayData && dayData.exercises[idx] ? dayData.exercises[idx].name : '';
    const defaultSecs = timerDefaults[exName] || 90;
    timerState[idx] = { remaining: defaultSecs, running: false, interval: null };
  }
  const state = timerState[idx];
  if (state.running) {
    // Pause
    clearInterval(state.interval);
    state.interval = null;
    state.running = false;
    const btn = document.getElementById('timer-btn-' + idx);
    if (btn) { btn.textContent = '▶'; btn.classList.remove('running'); }
  } else {
    // Start
    const valEl = document.getElementById('timer-val-' + idx);
    if (valEl) valEl.classList.remove('done');
    state.running = true;
    const btn = document.getElementById('timer-btn-' + idx);
    if (btn) { btn.textContent = '⏸'; btn.classList.add('running'); }
    state.interval = setInterval(() => {
      state.remaining--;
      const el = document.getElementById('timer-val-' + idx);
      if (el) el.textContent = Math.max(0, state.remaining);
      if (state.remaining <= 0) {
        clearInterval(state.interval);
        state.interval = null;
        state.running = false;
        const b = document.getElementById('timer-btn-' + idx);
        if (b) { b.textContent = '▶'; b.classList.remove('running'); }
        if (el) { el.textContent = 'Repos terminé!'; el.classList.add('done'); }
        playBeep();
      }
    }, 1000);
  }
}

function resetTimer(idx) {
  if (timerState[idx]) {
    clearInterval(timerState[idx].interval);
    timerState[idx].interval = null;
    timerState[idx].running = false;
  }
  const dayData = trainingData.days[currentDay];
  const exName = dayData && dayData.exercises[idx] ? dayData.exercises[idx].name : '';
  const defaultSecs = timerDefaults[exName] || 90;
  if (timerState[idx]) timerState[idx].remaining = defaultSecs;
  const valEl = document.getElementById('timer-val-' + idx);
  if (valEl) { valEl.textContent = defaultSecs; valEl.classList.remove('done'); }
  const btn = document.getElementById('timer-btn-' + idx);
  if (btn) { btn.textContent = '▶'; btn.classList.remove('running'); }
}

function stopAllTimers() {
  Object.values(timerState).forEach(state => {
    if (state && state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
  });
  timerState = {};
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch(e) { /* audio not available */ }
}

// ============================================================
// ADD / DELETE EXERCISE
// ============================================================
function addExercise() {
  if (!trainingData.days[currentDay]) {
    trainingData.days[currentDay] = { label: `Jour ${currentDay}`, exercises: [] };
  }
  const dayData = trainingData.days[currentDay];
  dayData.exercises.push({
    name: 'Nouvel exercice',
    tips: '',
    weeks: Array.from({ length: weekCount || 1 }, () => ({ series: 3, reps: '10-12', charge: '', done: '' }))
  });
  persistTraining();
  renderTraining();
  // focus the new name for immediate editing
  setTimeout(() => {
    const cards = document.querySelectorAll('.exercise-card');
    const last = cards[cards.length - 1];
    if (last) {
      const name = last.querySelector('.ex-name');
      if (name) { name.focus(); selectAll(name); }
    }
  }, 50);
}

function deleteExercise(dayId, exIdx) {
  if (!confirm('Supprimer cet exercice ?')) return;
  trainingData.days[dayId].exercises.splice(exIdx, 1);
  persistTraining();
  renderTraining();
}

function selectAll(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ============================================================
// EXERCISE MODAL (video + notes)
// ============================================================
function openExerciseModal(dayId, exIdx) {
  const dayData = trainingData.days[dayId];
  const ex = dayData.exercises[exIdx];
  const wIdx = currentWeek - 1;
  const w = ex.weeks[wIdx] || {};

  currentExercise = ex.name;
  document.getElementById('modal-exercise-name').textContent = ex.name;
  document.getElementById('modal-exercise-tips').textContent = ex.tips || '';

  const video = document.getElementById('exercise-video');
  const placeholder = document.getElementById('video-placeholder');
  const changeBtn = document.getElementById('change-video-btn');

  // Restore file-video state
  if (savedVideos[ex.name]) {
    video.src = savedVideos[ex.name];
    video.style.display = 'block';
    placeholder.style.display = 'none';
    changeBtn.style.display = 'inline-block';
  } else {
    video.style.display = 'none';
    placeholder.style.display = 'flex';
    changeBtn.style.display = 'none';
  }

  // Restore YouTube state
  const ytUrl = savedYoutube[ex.name] || '';
  document.getElementById('youtube-url-input').value = ytUrl;
  if (ytUrl) {
    setYoutubeIframe(ytUrl);
  } else {
    document.getElementById('youtube-iframe').src = '';
    document.getElementById('youtube-preview-wrap').style.display = 'none';
    document.getElementById('youtube-empty').style.display = 'flex';
  }

  // Show the tab that has content, default to file
  if (!savedVideos[ex.name] && savedYoutube[ex.name]) {
    switchVideoTab('youtube');
  } else {
    switchVideoTab('file');
  }

  document.getElementById('video-modal').classList.remove('hidden');
}

function closeVideoModal() {
  document.getElementById('video-modal').classList.add('hidden');
  document.getElementById('exercise-video').pause();
}

// ============================================================
// VIDEO TAB SWITCHING
// ============================================================
function switchVideoTab(tab) {
  document.getElementById('vpanel-file').style.display    = tab === 'file'    ? 'block' : 'none';
  document.getElementById('vpanel-youtube').style.display = tab === 'youtube' ? 'block' : 'none';
  document.getElementById('vtab-file').classList.toggle('active',    tab === 'file');
  document.getElementById('vtab-youtube').classList.toggle('active', tab === 'youtube');
}

// ============================================================
// YOUTUBE HELPERS
// ============================================================
function extractYoutubeId(url) {
  if (!url) return null;
  // Handles: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
    /\/embed\/([^?&#]+)/,
    /\/shorts\/([^?&#]+)/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function setYoutubeIframe(url) {
  const id    = extractYoutubeId(url);
  const wrap  = document.getElementById('youtube-preview-wrap');
  const empty = document.getElementById('youtube-empty');
  const frame = document.getElementById('youtube-iframe');
  const thumb = document.getElementById('yt-thumbnail');
  const link  = document.getElementById('yt-open-link');
  const overlay = document.getElementById('yt-overlay');

  if (id) {
    // Use maxresdefault then fallback to hqdefault
    thumb.src   = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    thumb.style.display = 'block';
    link.href   = `https://www.youtube.com/watch?v=${id}`;
    // store id on iframe for openYoutubeInline
    frame.dataset.ytid  = id;
    frame.style.display = 'none';
    overlay.style.display = 'flex';
    wrap.style.display  = 'block';
    empty.style.display = 'none';
  } else {
    frame.src   = '';
    frame.style.display = 'none';
    wrap.style.display  = 'none';
    empty.style.display = 'flex';
  }
}

function openYoutubeInline() {
  const frame   = document.getElementById('youtube-iframe');
  const overlay = document.getElementById('yt-overlay');
  const thumb   = document.getElementById('yt-thumbnail');
  const id      = frame.dataset.ytid;
  if (!id) return;
  frame.src = `https://www.youtube.com/embed/${id}?rel=0&autoplay=1`;
  frame.style.display = 'block';
  overlay.style.display = 'none';
  thumb.style.display   = 'none';
}

function clearYoutubeInline() {
  const frame   = document.getElementById('youtube-iframe');
  const overlay = document.getElementById('yt-overlay');
  const thumb   = document.getElementById('yt-thumbnail');
  frame.src = '';
  frame.style.display   = 'none';
  overlay.style.display = 'flex';
  thumb.style.display   = 'block';
}

function previewYoutube(val) {
  setYoutubeIframe(val.trim());
}

function saveYoutubeLink() {
  if (!currentExercise) return;
  const url = document.getElementById('youtube-url-input').value.trim();
  if (url && !extractYoutubeId(url)) {
    alert('Lien YouTube non reconnu. Vérifiez l\'URL.');
    return;
  }
  if (url) {
    savedYoutube[currentExercise] = url;
  } else {
    delete savedYoutube[currentExercise];
  }
  localStorage.setItem(pk('youtube'), JSON.stringify(savedYoutube));
  setYoutubeIframe(url);
  renderTraining();
  const btn = document.querySelector('#vpanel-youtube .btn-primary');
  btn.textContent = '✓ Enregistré';
  setTimeout(() => btn.textContent = 'Enregistrer', 1500);
}

function handleVideoUpload(event) {
  const file = event.target.files[0];
  if (!file || !currentExercise) return;
  const url = URL.createObjectURL(file);
  savedVideos[currentExercise] = url;
  localStorage.setItem(pk('videos'), JSON.stringify(savedVideos));
  const video = document.getElementById('exercise-video');
  video.src = url;
  video.style.display = 'block';
  document.getElementById('video-placeholder').style.display = 'none';
  document.getElementById('change-video-btn').style.display = 'inline-block';
  renderTraining();
}

function saveNotes() {
  if (!currentExercise) return;
  savedNotes[currentExercise] = document.getElementById('modal-notes').value;
  localStorage.setItem(pk('notes'), JSON.stringify(savedNotes));
  const btn = document.querySelector('.notes-area .btn-primary');
  btn.textContent = '✓ Sauvegardé';
  setTimeout(() => btn.textContent = 'Sauvegarder', 1500);
}

// ============================================================
// GRAPHS
// ============================================================
const chartColors = {
  poids:   { line: '#C8FF00', bg: 'rgba(200,255,0,0.12)' },
  graisse: { line: '#FF4444', bg: 'rgba(255,68,68,0.12)' },
  eau:     { line: '#44AAFF', bg: 'rgba(68,170,255,0.12)' },
  muscle:  { line: '#FF9900', bg: 'rgba(255,153,0,0.12)' }
};

function makeChart(id, label, key, color) {
  const ctx = document.getElementById(id).getContext('2d');
  if (charts[id]) charts[id].destroy();
  const weeks = savedProgress.weeks.map(w => 'S' + w);
  charts[id] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: weeks,
      datasets: [{ label, data: savedProgress[key],
        borderColor: color.line, backgroundColor: color.bg,
        borderWidth: 2.5, pointBackgroundColor: color.line,
        pointRadius: 5, tension: 0.4, fill: true }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 12 } } } },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.07)' } }
      }
    }
  });
}

function initCharts() {
  makeChart('chart-poids',   'Poids (kg)',             'poids',   chartColors.poids);
  makeChart('chart-graisse', 'Graisse corporelle (%)', 'graisse', chartColors.graisse);
  makeChart('chart-eau',     "Volume d'eau (%)",       'eau',     chartColors.eau);
  makeChart('chart-muscle',  'Masse musculaire (kg)',  'muscle',  chartColors.muscle);
  updateExerciseChart();
  updateVolumeChart();
  updateVolumeStackedChart();
  renderBilanHistory();
}

function renderBilanHistory() {
  const section = document.getElementById('bilan-history-section');
  if (!section) return;

  // Collect all feedback entries sorted by week then day
  // Filter to only days/weeks that currently exist in the plan
  const entries = Object.entries(workoutFeedback)
    .filter(([, fb]) => fb && (fb.rating > 0 || (fb.note || '').trim() || (fb.pain || []).length))
    .map(([key, fb]) => {
      const parts = key.split('_'); // "day_week"
      return { day: parseInt(parts[0]) || 0, week: parseInt(parts[1]) || 0, key, fb };
    })
    .filter(e => e.day >= 1 && e.day <= dayCount && e.week >= 1 && e.week <= weekCount)
    .sort((a, b) => a.week !== b.week ? a.week - b.week : a.day - b.day);

  section.innerHTML = '';
  if (!entries.length) return;

  // --- Section wrapper ---
  const wrap = document.createElement('div');
  wrap.className = 'bilan-history-wrap';

  const titleRow = document.createElement('div');
  titleRow.className = 'bilan-history-title-row';
  const titleEl = document.createElement('h2');
  titleEl.textContent = 'Historique des bilans';
  titleRow.appendChild(titleEl);
  wrap.appendChild(titleRow);

  // --- Rating trend chart ---
  const chartWrap = document.createElement('div');
  chartWrap.className = 'graph-card full-width bilan-trend-card';
  const chartTitle = document.createElement('h3');
  chartTitle.textContent = 'Évolution du ressenti (étoiles)';
  const canvas = document.createElement('canvas');
  canvas.id = 'chart-bilan-trend';
  chartWrap.appendChild(chartTitle);
  chartWrap.appendChild(canvas);
  wrap.appendChild(chartWrap);

  const ratedEntries = entries.filter(e => e.fb.rating > 0);
  const trendLabels = ratedEntries.map(e => `S${e.week} J${e.day}`);
  const trendData   = ratedEntries.map(e => e.fb.rating);

  if (charts['chart-bilan-trend']) charts['chart-bilan-trend'].destroy();
  charts['chart-bilan-trend'] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: 'Ressenti (/ 5)',
        data: trendData,
        borderColor: '#C8FF00',
        backgroundColor: 'rgba(200,255,0,0.12)',
        pointBackgroundColor: trendData.map(v =>
          v >= 4 ? '#C8FF00' : v === 3 ? '#FFB800' : '#ff6666'),
        pointRadius: 6,
        pointHoverRadius: 8,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#ccc' } },
        tooltip: {
          callbacks: {
            label: ctx => '★'.repeat(ctx.parsed.y) + '☆'.repeat(5 - ctx.parsed.y)
          }
        }
      },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { min: 0, max: 5, ticks: { color: '#aaa', stepSize: 1,
               callback: v => v === 0 ? '' : '★'.repeat(v) },
             grid: { color: 'rgba(255,255,255,0.07)' } }
      }
    }
  });

  // --- Cards timeline ---
  const timeline = document.createElement('div');
  timeline.className = 'bilan-timeline';

  entries.forEach(({ day, week, fb }) => {
    const card = document.createElement('div');
    card.className = 'bilan-hist-card';

    // Header row
    const cardHead = document.createElement('div');
    cardHead.className = 'bhc-head';

    const label = document.createElement('span');
    label.className = 'bhc-label';
    label.textContent = `Semaine ${week} — Jour ${day}`;

    const stars = document.createElement('div');
    stars.className = 'bhc-stars';
    for (let n = 1; n <= 5; n++) {
      const s = document.createElement('span');
      s.className = 'bhc-star' + (n <= fb.rating ? ' lit' : '');
      s.textContent = '★';
      stars.appendChild(s);
    }
    cardHead.appendChild(label);
    cardHead.appendChild(stars);
    card.appendChild(cardHead);

    // Toggle body
    const body = document.createElement('div');
    body.className = 'bhc-body';

    if ((fb.note || '').trim()) {
      const note = document.createElement('p');
      note.className = 'bhc-note';
      note.textContent = fb.note.trim();
      body.appendChild(note);
    }

    if ((fb.pain || []).length) {
      const painSect = document.createElement('div');
      painSect.className = 'bhc-pain-sect';

      const painTitle = document.createElement('span');
      painTitle.className = 'bhc-pain-title';
      painTitle.textContent = `🔴 ${fb.pain.length} zone${fb.pain.length > 1 ? 's' : ''} douloureuse${fb.pain.length > 1 ? 's' : ''}`;
      painSect.appendChild(painTitle);

      const svgRow = document.createElement('div');
      svgRow.className = 'bhc-svg-row';

      ['front','back'].forEach(view => {
        const viewPain = fb.pain.filter(p => p.view === view);
        if (!viewPain.length) return;
        const svgWrap = document.createElement('div');
        svgWrap.className = 'bhc-svg-wrap';
        const lbl = document.createElement('span');
        lbl.textContent = view === 'front' ? 'Avant' : 'Arrière';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'body-svg bhc-svg');
        svg.setAttribute('viewBox', '0 0 100 210');
        svg.innerHTML = (view === 'front' ? _bodyFrontSVG() : _bodyBackSVG());
        viewPain.forEach(p => {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('class', 'pain-dot');
          c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', '5');
          svg.appendChild(c);
        });
        svgWrap.appendChild(lbl);
        svgWrap.appendChild(svg);
        svgRow.appendChild(svgWrap);
      });

      painSect.appendChild(svgRow);
      body.appendChild(painSect);
    }

    // Collapse/expand toggle
    let open = false;
    cardHead.style.cursor = 'pointer';
    body.style.display = 'none';
    cardHead.addEventListener('click', () => {
      open = !open;
      body.style.display = open ? 'block' : 'none';
      card.classList.toggle('bhc-open', open);
    });

    card.appendChild(body);
    timeline.appendChild(card);
  });

  wrap.appendChild(timeline);
  section.appendChild(wrap);
}

function addDataEntry() {
  const week    = parseInt(document.getElementById('entry-week').value);
  const poids   = parseFloat(document.getElementById('entry-poids').value);
  const graisse = parseFloat(document.getElementById('entry-graisse').value);
  const eau     = parseFloat(document.getElementById('entry-eau').value);
  const muscle  = parseFloat(document.getElementById('entry-muscle').value);
  if (!week) return;

  // Update local state
  const idx = savedProgress.weeks.indexOf(week);
  if (idx === -1) {
    savedProgress.weeks.push(week);
    savedProgress.poids.push(isNaN(poids) ? null : poids);
    savedProgress.graisse.push(isNaN(graisse) ? null : graisse);
    savedProgress.eau.push(isNaN(eau) ? null : eau);
    savedProgress.muscle.push(isNaN(muscle) ? null : muscle);
  } else {
    if (!isNaN(poids))   savedProgress.poids[idx]   = poids;
    if (!isNaN(graisse)) savedProgress.graisse[idx] = graisse;
    if (!isNaN(eau))     savedProgress.eau[idx]     = eau;
    if (!isNaN(muscle))  savedProgress.muscle[idx]  = muscle;
  }
  localStorage.setItem(pk('progress'), JSON.stringify(savedProgress));
  initCharts();

  // Sync to Supabase if authenticated
  if (typeof sb !== 'undefined' && typeof activeStudentId === 'function' && activeStudentId()) {
    sb.from('body_metrics').upsert({
      student_id:    activeStudentId(),
      week_number:   week,
      recorded_at:   new Date().toISOString().slice(0, 10),
      weight_kg:     isNaN(poids)   ? null : poids,
      body_fat_pct:  isNaN(graisse) ? null : graisse,
      water_pct:     isNaN(eau)     ? null : eau,
      muscle_kg:     isNaN(muscle)  ? null : muscle,
    }, { onConflict: 'student_id,week_number' })
      .then(({ error }) => { if (error) console.warn('[sync] body_metrics', error.message); });
  }
}

function _buildExerciseProgress() {
  // Build {exerciseName: [chargeS1, chargeS2, ...]} from current trainingData
  const map = {};
  Object.values(trainingData.days).forEach(day => {
    (day.exercises || []).forEach(ex => {
      if (!ex.name) return;
      if (!map[ex.name]) map[ex.name] = Array(weekCount).fill(null);
      (ex.weeks || []).forEach((w, i) => {
        if (i < weekCount) {
          const v = parseFloat(w.charge);
          if (!isNaN(v) && v > 0) map[ex.name][i] = v;
        }
      });
    });
  });
  return map;
}

function _refreshExerciseSelect() {
  const sel = document.getElementById('exercise-select');
  if (!sel) return;
  const current = sel.value;
  const names = [];
  Object.values(trainingData.days).forEach(day => {
    (day.exercises || []).forEach(ex => { if (ex.name && !names.includes(ex.name)) names.push(ex.name); });
  });
  // Replace options while keeping any static ones that are still valid
  const all = [...new Set([...names])];
  sel.innerHTML = all.map(n => `<option value="${h(n)}"${n === current ? ' selected' : ''}>${h(n)}</option>`).join('');
}

function updateExerciseChart() {
  _refreshExerciseSelect();
  const sel    = document.getElementById('exercise-select');
  const exName = sel ? sel.value : '';
  const progress = _buildExerciseProgress();
  const data   = (progress[exName] || []).slice(0, weekCount);
  const labels = Array.from({ length: weekCount }, (_, i) => 'S' + (i + 1));
  const ctx    = document.getElementById('chart-exercise').getContext('2d');
  if (charts['chart-exercise']) charts['chart-exercise'].destroy();
  charts['chart-exercise'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Charge (kg)', data,
        backgroundColor: 'rgba(200,255,0,0.65)',
        borderColor: '#C8FF00', borderWidth: 1, borderRadius: 6 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#ccc' } } },
      scales: {
        x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.07)' }, beginAtZero: true }
      }
    }
  });
}

// ============================================================
// NUTRITION
// ============================================================
function selectNutDay(day, btn) {
  currentNutDay = day;
  document.querySelectorAll('.day-nav-bar .week-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMeals();
}

function renderMeals() {
  const grid = document.getElementById('meals-grid');
  let html = '';
  nutritionData.meals.forEach((meal, mealIdx) => {
    const savedOpt = mealOptions[currentNutDay + '_' + meal.id] || 0;
    const opt = meal.options[savedOpt];
    const totals = opt.items.reduce((acc, it) => ({
      p: acc.p + (it.p || 0), g: acc.g + (it.g || 0),
      l: acc.l + (it.l || 0), kcal: acc.kcal + (it.kcal || 0)
    }), { p:0, g:0, l:0, kcal:0 });

    const optBtns = meal.options.map((o, i) =>
      `<button class="opt-btn ${i === savedOpt ? 'active' : ''}" onclick="selectMealOption('${h(currentNutDay)}',${meal.id},${i},this)">${h(o.label)}</button>`
    ).join('');

    // Feature 3 + 4: editable rows with per-item checkmarks + delete
    const itemRows = opt.items.map((it, itIdx) => {
      const ck = currentNutDay + '_' + meal.id + '_' + itIdx;
      const checked = mealChecks[ck] || false;
      return `<tr class="${checked ? 'row-checked' : ''}">
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'food',this)">${h(String(it.food))}</td>
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'qty',this)">${h(String(it.qty))}</td>
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'p',this)">${h(String(it.p))}g</td>
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'g',this)">${h(String(it.g))}g</td>
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'l',this)">${h(String(it.l))}g</td>
        <td contenteditable="true" onblur="saveNutCell(${mealIdx},${savedOpt},${itIdx},'kcal',this)">${h(String(it.kcal))}</td>
        <td class="row-check-cell">
          <button class="row-check-btn${checked ? ' checked' : ''}" onclick="toggleItemCheck('${h(currentNutDay)}',${meal.id},${itIdx})" title="Consommé">✓</button>
          <button class="row-delete-btn" onclick="deleteNutRow(${mealIdx},${savedOpt},${itIdx})" title="Supprimer">✕</button>
        </td>
      </tr>`;
    }).join('');

    // Feature 5: shopping list (editable)
    const shopKey = currentNutDay + '_' + meal.id + '_shop';
    // Use saved custom shopping list if present, else build from items
    let shopEntries = JSON.parse(localStorage.getItem(pk('shop_' + shopKey)) || 'null');
    if (!shopEntries) {
      shopEntries = opt.items
        .filter(it => it.food && it.qty && String(it.qty).toLowerCase() !== 'à volonté')
        .map(it => `${it.food} — ${it.qty}`);
    }
    const shoppingItems = shopEntries.map((entry, sIdx) =>
      `<li contenteditable="true" onblur="saveShopItem('${h(currentNutDay)}',${meal.id},${sIdx},this)">${h(String(entry))}</li>`
    ).join('');
    const shoppingText = shopEntries.map(e => '• ' + e).join('\n');

    html += `
      <div class="meal-card">
        <div class="meal-header">
          <span class="meal-icon" contenteditable="true" onblur="saveNutMealField(${mealIdx},'icon',this)">${h(meal.icon)}</span>
          <span class="meal-type" contenteditable="true" onblur="saveNutMealField(${mealIdx},'type',this)">${h(meal.type)}</span>
          <div class="meal-macros-mini">
            <span>${Math.round(totals.p)}g P</span>
            <span>${Math.round(totals.g)}g G</span>
            <span>${Math.round(totals.l)}g L</span>
            <span class="kcal-badge">${Math.round(totals.kcal)} kcal</span>
          </div>
        </div>
        <div class="meal-options-bar">${optBtns}</div>
        <table class="meal-table">
          <thead><tr>
            <th contenteditable="true">Aliment</th>
            <th contenteditable="true">Qté</th>
            <th contenteditable="true">P</th>
            <th contenteditable="true">G</th>
            <th contenteditable="true">L</th>
            <th contenteditable="true">kcal</th>
            <th></th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <button class="nut-add-row-btn" onclick="addNutRow(${mealIdx},${savedOpt})">+ Aliment</button>
      </div>`;
  });

  // Unified shopping list — aggregate all meals for the current day
  html += _buildUnifiedShoppingHtml(currentNutDay);

  grid.innerHTML = html;
}

// Build aggregated shopping list HTML for a given day
function _buildUnifiedShoppingHtml(day) {
  // Aggregate quantities across all meals for this day
  // Map: normalised food name → { display, qty (number), unit, hasNonNumeric }
  const agg = new Map();

  nutritionData.meals.forEach((meal, mealIdx) => {
    const savedOpt = mealOptions[day + '_' + meal.id] || 0;
    const opt = meal.options[savedOpt] || meal.options[0];
    if (!opt) return;

    // Check if there's a custom saved shop list for this meal
    const shopKey = day + '_' + meal.id + '_shop';
    const customEntries = JSON.parse(localStorage.getItem(pk('shop_' + shopKey)) || 'null');

    if (customEntries) {
      // Parse "Food — qty unit" format from custom entries
      customEntries.forEach(entry => {
        const str = String(entry).trim();
        if (!str) return;
        const dashIdx = str.indexOf('—');
        const food = (dashIdx > -1 ? str.slice(0, dashIdx) : str).trim();
        const qtyStr = dashIdx > -1 ? str.slice(dashIdx + 1).trim() : '';
        _aggAdd(agg, food, qtyStr);
      });
    } else {
      opt.items.filter(it => it.food && it.qty && String(it.qty).toLowerCase() !== 'à volonté')
        .forEach(it => _aggAdd(agg, String(it.food).trim(), String(it.qty).trim()));
    }
  });

  if (!agg.size) return '';

  // Build DOM-safe list items
  const liItems = Array.from(agg.values()).map(entry => {
    const qty = entry.hasNonNumeric
      ? entry.rawQtys.join(' + ')
      : (entry.qty % 1 === 0 ? entry.qty : Math.round(entry.qty * 10) / 10) + (entry.unit ? ' ' + entry.unit : '');
    return `<li class="unified-shop-item" data-food="${h(entry.display)}">`
      + `<span class="ush-food">${h(entry.display)}</span>`
      + `<span class="ush-qty">${h(qty)}</span>`
      + `</li>`;
  }).join('');

  return `
    <div class="unified-shopping-list" id="unified-shop-list">
      <div class="ush-header">
        <span class="ush-title">🛒 Liste de courses</span>
        <button class="btn-secondary ush-copy-btn" onclick="copyUnifiedShoppingList()">Copier</button>
      </div>
      <ul class="ush-items">${liItems}</ul>
    </div>`;
}

// Aggregate helper — parse qty string and add to map
function _aggAdd(agg, food, qtyStr) {
  if (!food) return;
  const key = food.toLowerCase().replace(/\s+/g, ' ');
  const match = qtyStr.match(/^([\d.,]+)\s*(.*)$/);
  const num = match ? parseFloat(match[1].replace(',', '.')) : NaN;
  const unit = match ? match[2].trim().toLowerCase() : '';

  if (!agg.has(key)) {
    agg.set(key, { display: food, qty: 0, unit, hasNonNumeric: false, rawQtys: [] });
  }
  const entry = agg.get(key);
  if (!isNaN(num)) {
    entry.qty += num;
    // Keep the unit from the first numeric entry
    if (!entry.unit && unit) entry.unit = unit;
  } else if (qtyStr) {
    entry.hasNonNumeric = true;
    if (!entry.rawQtys.includes(qtyStr)) entry.rawQtys.push(qtyStr);
  }
}

// Copy unified shopping list to clipboard
function copyUnifiedShoppingList() {
  const ul = document.getElementById('unified-shop-list');
  if (!ul) return;
  const lines = Array.from(ul.querySelectorAll('.unified-shop-item')).map(li => {
    const food = li.querySelector('.ush-food').textContent.trim();
    const qty  = li.querySelector('.ush-qty').textContent.trim();
    return '• ' + food + (qty ? ' — ' + qty : '');
  });
  const text = lines.join('\n');
  const btn = ul.querySelector('.ush-copy-btn');
  const reset = () => { if (btn) btn.textContent = 'Copier'; };
  navigator.clipboard.writeText(text)
    .then(() => { if (btn) { btn.textContent = '✓ Copié!'; setTimeout(reset, 1500); } })
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      if (btn) { btn.textContent = '✓ Copié!'; setTimeout(reset, 1500); }
    });
}

function selectMealOption(day, mealId, optIdx) {
  mealOptions[day + '_' + mealId] = optIdx;
  localStorage.setItem(pk('meals'), JSON.stringify(mealOptions));
  renderMeals();
}

// Feature 3: save editable nutrition cell
function saveNutCell(mealIdx, optIdx, itemIdx, field, el) {
  const raw = el.textContent.replace(/g$/, '').trim();
  const num = parseFloat(raw);
  const val = (field !== 'food' && field !== 'qty' && !isNaN(num)) ? num : raw;
  nutritionData.meals[mealIdx].options[optIdx].items[itemIdx][field] = val;
  localStorage.setItem(pk('nutData'), JSON.stringify(nutritionData.meals));
}

// Feature 3: save editable meal header field (type or icon)
function saveNutMealField(mealIdx, field, el) {
  nutritionData.meals[mealIdx][field] = el.textContent.trim();
  localStorage.setItem(pk('nutData'), JSON.stringify(nutritionData.meals));
}

// Add a blank food row to a meal option
function addNutRow(mealIdx, optIdx) {
  nutritionData.meals[mealIdx].options[optIdx].items.push({ food: '', qty: '', p: 0, g: 0, l: 0, kcal: 0 });
  localStorage.setItem(pk('nutData'), JSON.stringify(nutritionData.meals));
  renderMeals();
  // Focus the new food cell
  setTimeout(() => {
    const tables = document.querySelectorAll('.meal-table');
    const table = tables[mealIdx];
    if (table) {
      const rows = table.querySelectorAll('tbody tr');
      const last = rows[rows.length - 1];
      if (last) { const cell = last.querySelector('td[contenteditable]'); if (cell) cell.focus(); }
    }
  }, 40);
}

// Delete a food row from a meal option
function deleteNutRow(mealIdx, optIdx, itIdx) {
  nutritionData.meals[mealIdx].options[optIdx].items.splice(itIdx, 1);
  localStorage.setItem(pk('nutData'), JSON.stringify(nutritionData.meals));
  renderMeals();
}

// Feature 4: toggle per-item check
function toggleItemCheck(day, mealId, itIdx) {
  const key = day + '_' + mealId + '_' + itIdx;
  mealChecks[key] = !mealChecks[key];
  localStorage.setItem(pk('mealChecks'), JSON.stringify(mealChecks));
  renderMeals();
}

// Save an edited shopping list item
function saveShopItem(day, mealId, sIdx, el) {
  const shopKey = day + '_' + mealId + '_shop';
  const storeKey = pk('shop_' + shopKey);
  const entries = JSON.parse(localStorage.getItem(storeKey) || 'null') || [];
  entries[sIdx] = el.textContent.trim();
  localStorage.setItem(storeKey, JSON.stringify(entries));
}

// Add a blank item to a shopping list
function addShopItem(day, mealId, mealIdx) {
  const shopKey = day + '_' + mealId + '_shop';
  const storeKey = pk('shop_' + shopKey);
  // Read current items from DOM to avoid losing unsaved edits
  const ul = document.getElementById('shop-list-' + mealIdx);
  const entries = ul ? Array.from(ul.children).map(li => li.textContent.trim()) : [];
  entries.push('Nouvel article');
  localStorage.setItem(storeKey, JSON.stringify(entries));
  renderMeals();
  // Focus the new item
  setTimeout(() => {
    const newUl = document.getElementById('shop-list-' + mealIdx);
    if (newUl) {
      const lastLi = newUl.lastElementChild;
      if (lastLi) { lastLi.focus(); const r = document.createRange(); r.selectNodeContents(lastLi); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); }
    }
  }, 50);
}

// Feature 5: copy shopping list (reads live DOM)
function copyShoppingList(mealIdx) {
  const ul = document.getElementById('shop-list-' + mealIdx);
  const text = ul ? Array.from(ul.children).map(li => '• ' + li.textContent.trim()).join('\n') : '';
  if (!text) return;
  const _doCopy = (t) => {
    const btns = document.querySelectorAll('.shopping-copy-btn');
    const btn = btns[mealIdx];
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copié!'; setTimeout(() => btn.textContent = orig, 1500); }
  };
  navigator.clipboard.writeText(text).then(() => _doCopy(text)).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    _doCopy(text);
  });
}

// ============================================================
// PHOTOS & MESURES TAB
// ============================================================

function _photoWeeks() {
  const weeks = new Set();
  for (let w = 1; w <= weekCount; w++) weeks.add(w);
  Object.keys(progressPhotos).forEach(k => { const w = parseInt(k.split('_')[0]); if (w) weeks.add(w); });
  measurements.forEach(m => { if (m.week) weeks.add(m.week); });
  return [...weeks].sort((a, b) => a - b);
}

function _populateWeekSelects() {
  const weeks = _photoWeeks();
  ['photo-week-select','comp-week-a','comp-week-b','meas-week'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = parseInt(sel.value) || weeks[weeks.length - 1] || 1;
    sel.innerHTML = '';
    weeks.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = 'Semaine ' + w;
      if (w === prev) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function renderPhotosTab() {
  _populateWeekSelects();
  renderPhotoTimeline();
  renderComparison();
  renderMeasurementCharts();
  renderMeasurementHistory();
}

// --- upload from top-section buttons ---
function uploadPhoto(event, view) {
  const file = event.target.files[0];
  if (!file) return;
  const week = parseInt(document.getElementById('photo-week-select').value) || 1;
  const reader = new FileReader();
  reader.onload = () => {
    progressPhotos[week + '_' + view] = reader.result;
    localStorage.setItem(pk('photos'), JSON.stringify(progressPhotos));
    renderPhotoTimeline();
    renderComparison();
    _populateWeekSelects();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// --- upload from timeline inline add button ---
function uploadPhotoWeek(event, week, view) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    progressPhotos[week + '_' + view] = reader.result;
    localStorage.setItem(pk('photos'), JSON.stringify(progressPhotos));
    renderPhotoTimeline();
    renderComparison();
    _populateWeekSelects();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function deletePhoto(week, view) {
  delete progressPhotos[week + '_' + view];
  localStorage.setItem(pk('photos'), JSON.stringify(progressPhotos));
  renderPhotoTimeline();
  renderComparison();
}

function openPhotoLightbox(key) {
  const src = progressPhotos[key];
  if (!src) return;
  let lb = document.getElementById('photo-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'photo-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }
  // DOM-safe: set img.src directly, never innerHTML with data URL
  lb.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 0 40px rgba(0,0,0,0.8)';
  lb.appendChild(img);
}

function renderPhotoTimeline() {
  const container = document.getElementById('photo-timeline');
  if (!container) return;
  const weeks = _photoWeeks();
  const views = [['front','Avant'],['side','Côté'],['back','Dos']];
  container.innerHTML = '';

  if (!weeks.length) {
    const p = document.createElement('p');
    p.className = 'photo-empty';
    p.textContent = 'Aucune photo pour l\'instant. Sélectionnez une semaine et importez des photos.';
    container.appendChild(p);
    return;
  }

  weeks.forEach(w => {
    const row = document.createElement('div');
    row.className = 'photo-week-row';
    const badge = document.createElement('div');
    badge.className = 'photo-week-badge';
    badge.textContent = 'S' + w;
    row.appendChild(badge);
    const cells = document.createElement('div');
    cells.className = 'photo-week-cells';
    views.forEach(([v, label]) => {
      const src = progressPhotos[w + '_' + v];
      const cell = document.createElement('div');
      cell.className = 'photo-cell' + (src ? ' has-photo' : ' empty-cell');
      const lbl = document.createElement('span');
      lbl.className = 'photo-cell-label';
      lbl.textContent = label;
      cell.appendChild(lbl);
      if (src) {
        const img = document.createElement('img');
        img.src = src;               // base64 data URL — set via .src, not innerHTML
        img.alt = label + ' S' + w;
        img.addEventListener('click', () => openPhotoLightbox(w + '_' + v));
        cell.insertBefore(img, lbl);
        const delBtn = document.createElement('button');
        delBtn.className = 'photo-delete-btn';
        delBtn.title = 'Supprimer';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => deletePhoto(w, v));
        cell.appendChild(delBtn);
      } else {
        const lblEl = document.createElement('label');
        lblEl.className = 'photo-add-btn';
        lblEl.textContent = '+';
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.style.display = 'none';
        inp.addEventListener('change', (e) => uploadPhotoWeek(e, w, v));
        lblEl.appendChild(inp);
        cell.appendChild(lblEl);
      }
      cells.appendChild(cell);
    });
    row.appendChild(cells);
    container.appendChild(row);
  });
}

function renderComparison() {
  const selA = document.getElementById('comp-week-a');
  const selB = document.getElementById('comp-week-b');
  const selV = document.getElementById('comp-view');
  if (!selA) return;
  const wa  = parseInt(selA.value) || 1;
  const wb  = parseInt(selB.value) || 1;
  const view = selV ? selV.value : 'front';
  const srcA = progressPhotos[wa + '_' + view];
  const srcB = progressPhotos[wb + '_' + view];
  const imgA = document.getElementById('comp-photo-a');
  const imgB = document.getElementById('comp-photo-b');
  const lblA = document.getElementById('comp-label-a');
  const lblB = document.getElementById('comp-label-b');
  if (!imgA) return;
  if (lblA) lblA.textContent = 'Semaine ' + wa;
  if (lblB) lblB.textContent = 'Semaine ' + wb;
  if (srcA) { imgA.src = srcA; imgA.style.display = 'block'; }
  else      { imgA.removeAttribute('src'); imgA.style.display = 'none'; }
  if (srcB) { imgB.src = srcB; imgB.style.display = 'block'; }
  else      { imgB.removeAttribute('src'); imgB.style.display = 'none'; }
  const wrapA = imgA.closest('.comp-photo-wrap');
  const wrapB = imgB.closest('.comp-photo-wrap');
  if (wrapA) wrapA.classList.toggle('no-photo', !srcA);
  if (wrapB) wrapB.classList.toggle('no-photo', !srcB);
}

// --- measurements ---
function saveMeasurements() {
  const weekSel = document.getElementById('meas-week');
  const week = parseInt(weekSel ? weekSel.value : 0);
  if (!week) return;
  const entry = {
    week,
    poids:  parseFloat(document.getElementById('meas-poids').value)  || null,
    taille: parseFloat(document.getElementById('meas-taille').value) || null,
    waist:  parseFloat(document.getElementById('meas-waist').value)  || null,
    chest:  parseFloat(document.getElementById('meas-chest').value)  || null,
    armL:   parseFloat(document.getElementById('meas-arm-l').value)  || null,
    armR:   parseFloat(document.getElementById('meas-arm-r').value)  || null,
    thighL: parseFloat(document.getElementById('meas-thigh-l').value)|| null,
    thighR: parseFloat(document.getElementById('meas-thigh-r').value)|| null,
    hips:   parseFloat(document.getElementById('meas-hips').value)   || null,
    fat:    parseFloat(document.getElementById('meas-fat').value)    || null,
  };
  const idx = measurements.findIndex(m => m.week === week);
  if (idx === -1) measurements.push(entry);
  else measurements[idx] = entry;
  measurements.sort((a, b) => a.week - b.week);
  localStorage.setItem(pk('measurements'), JSON.stringify(measurements));
  renderMeasurementCharts();
  renderMeasurementHistory();
  _populateWeekSelects();
  const btn = document.querySelector('.measurements-entry .btn-save-meas');
  if (btn) { btn.textContent = '✓ Enregistré'; setTimeout(() => { btn.textContent = 'Enregistrer'; }, 1500); }
}

function deleteMeasurement(week) {
  measurements = measurements.filter(m => m.week !== week);
  localStorage.setItem(pk('measurements'), JSON.stringify(measurements));
  renderMeasurementCharts();
  renderMeasurementHistory();
}

const _measChartColors = {
  poids: '#C8FF00', waist: '#FF6B35', chest: '#00D4FF',
  armL: '#FF3CAC', armR: '#FF9CAC', thighL: '#7B2FBE', thighR: '#AB5FEE', hips: '#00C896', fat: '#FF4444',
};
let measCharts = {};

function _buildMeasChart(id, labels, datasets) {
  const el = document.getElementById(id);
  if (!el) return;
  if (measCharts[id]) { measCharts[id].destroy(); delete measCharts[id]; }
  measCharts[id] = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#bbb', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.07)' }, beginAtZero: false }
      }
    }
  });
}

function renderMeasurementCharts() {
  const lbs = measurements.map(m => 'S' + m.week);
  const ds = (key, label, color) => ({
    label, data: measurements.map(m => m[key]),
    borderColor: color, backgroundColor: color + '22',
    borderWidth: 2, pointBackgroundColor: color, pointRadius: 4, tension: 0.4, fill: false
  });
  _buildMeasChart('chart-meas-poids',  lbs, [ds('poids',  'Poids (kg)',    _measChartColors.poids)]);
  _buildMeasChart('chart-meas-waist',  lbs, [ds('waist',  'Tour de taille', _measChartColors.waist)]);
  _buildMeasChart('chart-meas-chest',  lbs, [ds('chest',  'Poitrine',      _measChartColors.chest)]);
  _buildMeasChart('chart-meas-arms',   lbs, [ds('armL','Bras G',_measChartColors.armL), ds('armR','Bras D',_measChartColors.armR)]);
  _buildMeasChart('chart-meas-thighs', lbs, [ds('thighL','Cuisse G',_measChartColors.thighL), ds('thighR','Cuisse D',_measChartColors.thighR)]);
  _buildMeasChart('chart-meas-hips',   lbs, [ds('hips',   'Hanches',       _measChartColors.hips)]);
}

function renderMeasurementHistory() {
  const tbody = document.getElementById('meas-history-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fields = ['poids','taille','waist','chest','armL','armR','thighL','thighR','hips','fat'];
  const rows = [...measurements].reverse();
  if (!rows.length) {
    const tr = tbody.insertRow();
    const td = tr.insertCell();
    td.colSpan = 12;
    td.style.cssText = 'text-align:center;color:var(--muted);padding:20px';
    td.textContent = 'Aucune donnée';
    return;
  }
  rows.forEach(m => {
    const tr = tbody.insertRow();
    const wkTd = tr.insertCell();
    wkTd.textContent = 'S' + m.week;
    fields.forEach(f => {
      const td = tr.insertCell();
      td.textContent = m[f] != null ? m[f] : '—';
    });
    const actTd = tr.insertCell();
    const delBtn = document.createElement('button');
    delBtn.className = 'meas-delete-btn';
    delBtn.title = 'Supprimer';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => deleteMeasurement(m.week));
    actTd.appendChild(delBtn);
  });
}

// --- volume load ---
const MUSCLE_GROUPS = {
  'Dos / Biceps':         ['dos','biceps','tirage','low row','curl','lat pulldown','tractions'],
  'Pectoraux / Triceps':  ['pectoral','tricep','couché','butterfly','chestpress','dips','extension'],
  'Jambes':               ['jambe','squat','fente','leg','quad','hamstring'],
  'Épaules / Dos':        ['épaule','shoulder','deltoid','élévation','incliné','crunch','erec'],
};
const _groupColors = {
  'Dos / Biceps':        '#00D4FF',
  'Pectoraux / Triceps': '#FF6B35',
  'Jambes':              '#C8FF00',
  'Épaules / Dos':       '#FF3CAC',
  'Autre':               '#888',
};

function _getDayGroup(dayLabel) {
  const lc = (dayLabel || '').toLowerCase();
  for (const [group, kws] of Object.entries(MUSCLE_GROUPS)) {
    if (kws.some(kw => lc.includes(kw))) return group;
  }
  return 'Autre';
}

function _computeVolumeData(filterGroup) {
  const groups = filterGroup === 'all' ? [...Object.keys(MUSCLE_GROUPS), 'Autre'] : [filterGroup];
  const labels = Array.from({length: weekCount}, (_, i) => 'S' + (i + 1));
  const datasets = groups.map(group => {
    const weeklyVol = Array(weekCount).fill(0);
    Object.values(trainingData.days).forEach(day => {
      if (_getDayGroup(day.label || '') !== group) return;
      (day.exercises || []).forEach(ex => {
        (ex.weeks || []).forEach((w, wIdx) => {
          if (wIdx >= weekCount) return;
          const charge = parseFloat(w.charge) || 0;
          const reps   = parseFloat(String(w.reps || '').split('-')[0].split('+')[0]) || 0;
          const series = parseFloat(w.series) || 0;
          weeklyVol[wIdx] += charge * reps * series;
        });
      });
    });
    const color = _groupColors[group] || '#888';
    return { label: group, data: weeklyVol, backgroundColor: color + 'BB', borderColor: color, borderWidth: 2, borderRadius: 4 };
  });
  return { labels, datasets };
}

function updateVolumeChart() {
  const el = document.getElementById('chart-volume');
  if (!el) return;
  if (charts['chart-volume']) { charts['chart-volume'].destroy(); }
  const filterGroup = document.getElementById('vol-muscle-select') ? document.getElementById('vol-muscle-select').value : 'all';
  const { labels, datasets } = _computeVolumeData(filterGroup);
  charts['chart-volume'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#ccc', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.raw).toLocaleString()} kg·reps` } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.07)' }, beginAtZero: true,
             title: { display: true, text: 'Volume (kg × reps × séries)', color: '#666', font: { size: 11 } } }
      }
    }
  });
}

function updateVolumeStackedChart() {
  const el = document.getElementById('chart-volume-stacked');
  if (!el) return;
  if (charts['chart-volume-stacked']) { charts['chart-volume-stacked'].destroy(); }
  const { datasets } = _computeVolumeData('all');
  const totalDatasets = datasets.map(ds => ({
    label: ds.label,
    data: [ds.data.reduce((a, b) => a + b, 0)],
    backgroundColor: ds.backgroundColor,
    borderColor: ds.borderColor,
    borderWidth: 2, borderRadius: 6,
  }));
  charts['chart-volume-stacked'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: ['Total programme'], datasets: totalDatasets },
    options: {
      responsive: true, indexAxis: 'y',
      plugins: {
        legend: { labels: { color: '#ccc', font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.raw).toLocaleString()} kg·reps` } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' },
             title: { display: true, text: 'Volume total (kg × reps × séries)', color: '#666', font: { size: 11 } } },
        y: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// ============================================================
// PROFILE SWITCHER UI
// ============================================================
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeColor(c) {
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#C8FF00';
}

function renderProfileMenu() {
  const prof = currentProfile();
  const logoEl = document.getElementById('logo-btn');
  if (logoEl) {
    logoEl.textContent = '';
    logoEl.appendChild(document.createTextNode(prof.name.toUpperCase()));
    const s = document.createElement('span');
    s.style.color = safeColor(prof.color);
    s.textContent = 'FIT';
    logoEl.appendChild(s);
  }
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  menu.textContent = '';

  profiles.forEach(p => {
    const col = safeColor(p.color);
    const div = document.createElement('div');
    div.className = 'pm-item' + (p.id === currentProfileId ? ' active' : '');
    div.style.setProperty('--pcol', col);
    div.addEventListener('click', () => switchProfile(p.id));

    const av = document.createElement('span');
    av.className = 'pm-avatar';
    av.style.cssText = 'background:' + col + '20;border-color:' + col + '40;color:' + col;
    av.textContent = p.name[0].toUpperCase();

    const nm = document.createElement('span');
    nm.className = 'pm-name';
    nm.textContent = p.name;

    div.appendChild(av); div.appendChild(nm);

    if (profiles.length > 1) {
      const del = document.createElement('button');
      del.className = 'pm-delete';
      del.title = 'Supprimer';
      del.textContent = '✕';
      del.addEventListener('click', e => deleteProfile(e, p.id));
      div.appendChild(del);
    }
    menu.appendChild(div);
  });

  const addDiv = document.createElement('div');
  addDiv.className = 'pm-add';
  addDiv.addEventListener('click', addProfile);
  const addAv = document.createElement('span');
  addAv.className = 'pm-avatar';
  addAv.style.cssText = 'background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.12);color:#777;font-size:20px';
  addAv.textContent = '+';
  const addNm = document.createElement('span');
  addNm.className = 'pm-name'; addNm.style.color = '#777';
  addNm.textContent = 'Ajouter un profil';
  addDiv.appendChild(addAv); addDiv.appendChild(addNm);
  menu.appendChild(addDiv);
}

function toggleProfileMenu() {
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  const open = menu.classList.toggle('open');
  if (open) { setTimeout(() => document.addEventListener('click', closeMenuOutside), 0); }
  else document.removeEventListener('click', closeMenuOutside);
}
function closeMenuOutside(e) {
  const wrap = document.getElementById('profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('profile-menu').classList.remove('open');
    document.removeEventListener('click', closeMenuOutside);
  }
}

function switchProfile(id) {
  currentProfileId = id;
  persistProfiles();
  loadProfileData();
  const menu = document.getElementById('profile-menu');
  if (menu) menu.classList.remove('open');
  renderProfileMenu();
  renderSelectors();
  renderTraining();
  renderMeals();
  Object.values(charts).forEach(c => c && c.destroy()); charts = {};
  document.querySelectorAll('.nav-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-training').classList.add('active');
}

function addProfile() {
  const name = prompt('Nom du membre :');
  if (!name || !name.trim()) return;
  const col = PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
  const id = 'p' + Date.now();
  profiles.push({ id, name: name.trim(), color: col });
  persistProfiles();
  switchProfile(id);
}

function deleteProfile(e, id) {
  e.stopPropagation();
  const prof = profiles.find(p => p.id === id);
  if (!prof) return;
  if (!confirm('Supprimer le profil "' + prof.name + '" et toutes ses données ?')) return;
  ['training','videos','youtube','notes','progress','meals','weekCount','dayCount','timers','mealChecks','nutData','voice','feedback','photos','measurements'].forEach(k => {
    localStorage.removeItem('p_' + id + '_' + k);
  });
  profiles = profiles.filter(p => p.id !== id);
  persistProfiles();
  if (currentProfileId === id) switchProfile(profiles[0].id);
  else renderProfileMenu();
}

// ============================================================
// MOBILE PREVIEW TOGGLE (Feature 7) — iframe overlay for true @media behaviour
// ============================================================
function toggleMobilePreview() {
  const existing = document.getElementById('mobile-preview-overlay');
  const btns = document.querySelectorAll('.btn-mobile-preview');
  if (existing) {
    existing.remove();
    btns.forEach(b => b.classList.remove('active'));
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'mobile-preview-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,0.82)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:12px'
  ].join(';');

  // Click backdrop to close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) toggleMobilePreview();
  });

  const frame = document.createElement('iframe');
  frame.src = window.location.href;
  frame.style.cssText = [
    'width:390px', 'height:844px',
    'border:none', 'border-radius:40px',
    'box-shadow:0 0 0 12px #1a1a1a, 0 0 0 14px #444',
    'flex-shrink:0'
  ].join(';');

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Fermer';
  closeBtn.style.cssText = [
    'background:#fff', 'color:#111', 'border:none',
    'border-radius:8px', 'padding:8px 20px', 'font-size:14px',
    'font-weight:600', 'cursor:pointer', 'letter-spacing:.5px'
  ].join(';');
  closeBtn.addEventListener('click', toggleMobilePreview);

  overlay.appendChild(frame);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
  btns.forEach(b => b.classList.add('active'));
}

// ============================================================
// SUPABASE — load student data into app state
// Called by auth.js after login and when coach switches student
// ============================================================

// Hook called by auth.js coach switcher
async function onStudentSwitch(studentId) {
  await loadStudentData(studentId);
}

async function loadStudentData(studentId) {
  if (!studentId || typeof sb === 'undefined') return;

  const switchingStudent = currentProfileId !== studentId;

  // Namespace all localStorage keys under this student's ID
  currentProfileId = studentId;

  // Paint immediately from localStorage cache — only reset nav when switching students
  if (switchingStudent) {
    loadProfileData(); // resets currentDay/currentWeek to 1
  } else {
    // Reload data but preserve current navigation position
    const savedDay = currentDay, savedWeek = currentWeek;
    loadProfileData();
    currentDay = savedDay; currentWeek = savedWeek;
  }
  renderSelectors();
  renderTraining();

  // Fetch workout plan from Supabase in background
  const { data: plan } = await sb
    .from('workout_plans')
    .select('*, exercise_assignments(*)')
    .eq('student_id', studentId)
    .order('position', { foreignTable: 'exercise_assignments' })
    .maybeSingle();

  if (plan) {
    // Only use Supabase plan if there is no locally-saved training for this student.
    // Once a student's plan exists in localStorage it is the source of truth —
    // Supabase is used only for first-load on a new device.
    const hasLocal = !!localStorage.getItem(pk('training'));
    if (!hasLocal) {
      weekCount = plan.week_count;
      dayCount  = plan.day_count;
      trainingData.days = _adaptPlanToLocal(plan);
      localStorage.setItem(pk('training'),  JSON.stringify(trainingData.days));
      localStorage.setItem(pk('weekCount'), weekCount);
      localStorage.setItem(pk('dayCount'),  dayCount);
      renderSelectors();
      renderTraining();
      _renderSeanceFooter(currentDay + '_' + currentWeek);
    }
  }

  // Fetch body metrics
  const { data: metrics } = await sb
    .from('body_metrics')
    .select('*')
    .eq('student_id', studentId)
    .order('week_number');

  if (metrics && metrics.length) {
    savedProgress = {
      weeks:   metrics.map(r => r.week_number),
      poids:   metrics.map(r => r.weight_kg),
      graisse: metrics.map(r => r.body_fat_pct),
      eau:     metrics.map(r => r.water_pct),
      muscle:  metrics.map(r => r.muscle_kg),
    };
    localStorage.setItem(pk('progress'), JSON.stringify(savedProgress));
  }

  // exercise_logs are not applied here — logs lack day_number so applying them
  // by name alone would corrupt days that share the same exercise.

  // Fetch session feedback
  const { data: feedback } = await sb
    .from('session_feedback')
    .select('*')
    .eq('student_id', studentId);

  if (feedback && feedback.length) {
    // Merge: Supabase data fills gaps but never overwrites an entry already saved locally this session
    feedback.forEach(fb => {
      const key = fb.day_number + '_' + fb.week_number;
      const hadLocal = !!(workoutFeedback[key] && (workoutFeedback[key].rating > 0 || (workoutFeedback[key].note || '').trim() || (workoutFeedback[key].pain || []).length));
      if (!hadLocal) {
        workoutFeedback[key] = { rating: fb.rating || 0, note: fb.note || '', pain: fb.pain_points || [] };
      }
    });
  }

  // Purge any feedback keys that reference days/weeks beyond the current plan
  // (handles the case where Supabase re-fetched rows for already-deleted days)
  const orphanKeys = Object.keys(workoutFeedback).filter(key => {
    const [kd, kw] = key.split('_').map(Number);
    return kd < 1 || kd > dayCount || kw < 1 || kw > weekCount;
  });
  orphanKeys.forEach(key => _deleteFeedbackKey(key));
  if (orphanKeys.length) {
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
  }

  if (feedback && feedback.length || orphanKeys.length) {
    localStorage.setItem(pk('feedback'), JSON.stringify(workoutFeedback));
    // Re-render so all days' footers reflect the merged feedback data,
    // then re-patch the current footer in case the user saved a bilan mid-flight.
    renderTraining();
    _renderSeanceFooter(currentDay + '_' + currentWeek);
  }

  // Load voice notes from Supabase Storage (cross-device sharing)
  await _loadVoiceFromSupabase(studentId);
  renderTraining(); // re-render so newly loaded voice notes appear

  // Refresh graphs if the tab is currently visible
  if (document.getElementById('tab-graphs')?.classList.contains('active')) {
    initCharts();
  }
}

// Converts a Supabase workout_plan row into the local trainingData.days shape
function _adaptPlanToLocal(plan) {
  const days = {};
  (plan.exercise_assignments || []).forEach(a => {
    if (!days[a.day_number]) {
      days[a.day_number] = { label: `Jour ${a.day_number}`, exercises: [] };
    }
    days[a.day_number].exercises.push({
      name:  a.name,
      tips:  a.tips || '',
      weeks: Array.from({ length: plan.week_count }, () => ({
        series: a.target_series ?? '',
        reps:   a.target_reps   ?? '',
        charge: a.target_charge ?? '',
        done:   ''
      }))
    });
  });
  return days;
}

// ── Feedback save now also syncs to Supabase ─────────────────
// Patches the bilan overlay save button to call this
async function _saveFeedbackToSupabase(fbKey, fb) {
  if (typeof sb === 'undefined' || !activeStudentId()) return;
  const [day, week] = fbKey.split('_').map(Number);
  const { error } = await sb.from('session_feedback').upsert({
    student_id:  activeStudentId(),
    day_number:  day,
    week_number: week,
    rating:      fb.rating || null,
    note:        fb.note   || '',
    pain_points: fb.pain   || []
  }, { onConflict: 'student_id,day_number,week_number' });
  if (error) console.warn('[sync] feedback', error.message);
}

function _deleteFeedbackKey(fbKey) {
  delete workoutFeedback[fbKey];
  _deleteFeedbackFromSupabase(fbKey);
}

async function _deleteFeedbackFromSupabase(fbKey) {
  if (typeof sb === 'undefined' || !activeStudentId()) return;
  const [day, week] = fbKey.split('_').map(Number);
  const { error } = await sb.from('session_feedback')
    .delete()
    .eq('student_id', activeStudentId())
    .eq('day_number',  day)
    .eq('week_number', week);
  if (error) console.warn('[sync] feedback delete', error.message);
}

// ============================================================
// PDF EXPORT
// ============================================================
function downloadPlanPDF() {
  const studentName = (typeof myProfile === 'function' && myProfile())
    ? myProfile().full_name || 'Programme'
    : 'Programme';

  // Build all weeks, each with all days listed in order
  let daysSections = '';
  for (let wNum = 1; wNum <= weekCount; wNum++) {
    const wIdx = wNum - 1;
    let weekDays = '';
    for (let d = 1; d <= dayCount; d++) {
      const day = trainingData.days[d];
      if (!day) continue;
      const exercises = (day.exercises || []);
      if (!exercises.length) continue;

      let rows = '';
      exercises.forEach((ex, i) => {
        const w = ex.weeks[wIdx] || {};
        const series = w.series !== undefined && w.series !== '' ? w.series : '—';
        const reps   = w.reps   !== undefined && w.reps   !== '' ? w.reps   : '—';
        const charge = w.charge !== undefined && w.charge !== '' ? w.charge + ' kg' : '—';
        const done   = w.done   !== undefined && w.done   !== '' ? `<span class="done-tick">✓ ${h(String(w.done))}</span>` : '';
        rows += `
          <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
            <td class="ex-num">${i + 1}</td>
            <td class="ex-name-cell">
              <span class="ex-title">${h(ex.name)}</span>
              ${ex.tips ? `<span class="ex-tips">${h(ex.tips)}</span>` : ''}
            </td>
            <td class="metric-cell">${h(String(series))}</td>
            <td class="metric-cell">${h(String(reps))}</td>
            <td class="metric-cell">${h(String(charge))}</td>
            <td class="metric-cell done-cell">${done}</td>
          </tr>`;
      });

      const feedback = workoutFeedback[`${d}_${wNum}`];
      let bilanHtml = '';
      if (feedback && (feedback.rating > 0 || (feedback.note || '').trim())) {
        const stars = [1,2,3,4,5].map(n => `<span style="color:${n <= feedback.rating ? '#FFB800' : '#444'}">★</span>`).join('');
        bilanHtml = `
          <div class="bilan-row">
            <span class="bilan-label">Bilan :</span>
            <span class="bilan-stars">${stars}</span>
            ${feedback.note ? `<span class="bilan-note">${h(feedback.note)}</span>` : ''}
          </div>`;
      }

      weekDays += `
        <div class="day-section">
          <div class="day-header-pdf">
            <span class="day-title">${h(day.label || `Jour ${d}`)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th class="th-num">#</th>
                <th class="th-name">Exercice</th>
                <th>Séries</th>
                <th>Reps</th>
                <th>Charge</th>
                <th>Réalisé</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${bilanHtml}
        </div>`;
    }

    if (!weekDays) continue;
    daysSections += `
      <div class="week-block">
        <div class="week-separator">
          <span class="week-sep-label">Semaine ${wNum}</span>
        </div>
        ${weekDays}
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Programme — ${h(studentName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', sans-serif;
    background: #0a0a0a;
    color: #e8e8e8;
    padding: 0 0 40px;
    font-size: 13px;
    line-height: 1.5;
  }
  /* ── Hero header ── */
  .pdf-header {
    position: relative;
    height: 180px;
    overflow: hidden;
    margin-bottom: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pdf-header-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #0a0a0a;
  }
  .pdf-coach-left {
    position: absolute;
    left: 0; bottom: 0;
    height: 100%; width: auto; max-width: 38%;
    object-fit: contain; object-position: left bottom;
    opacity: 0.75;
    filter: grayscale(15%) contrast(1.08);
    -webkit-mask-image: linear-gradient(to right, black 55%, transparent 100%);
    mask-image: linear-gradient(to right, black 55%, transparent 100%);
  }
  .pdf-coach-right {
    position: absolute;
    right: 0; bottom: 0;
    height: 100%; width: auto; max-width: 38%;
    object-fit: contain; object-position: right bottom;
    opacity: 0.75;
    filter: grayscale(15%) contrast(1.08);
    -webkit-mask-image: linear-gradient(to left, black 55%, transparent 100%);
    mask-image: linear-gradient(to left, black 55%, transparent 100%);
  }
  .pdf-header-overlay {
    position: absolute; inset: 0;
    background:
      linear-gradient(to right,  rgba(10,10,10,0.4) 0%, rgba(10,10,10,0) 20%, rgba(10,10,10,0) 80%, rgba(10,10,10,0.4) 100%),
      linear-gradient(to bottom, rgba(10,10,10,0.5) 0%, rgba(10,10,10,0) 30%, rgba(10,10,10,0) 70%, rgba(10,10,10,0.7) 100%);
  }
  .pdf-header-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .pdf-logo {
    font-size: 38px;
    font-weight: 900;
    letter-spacing: -1.5px;
    color: #fff;
    line-height: 1;
    text-shadow: 0 2px 12px rgba(0,0,0,0.7);
  }
  .pdf-logo span { color: #C8FF00; }
  .pdf-student {
    font-size: 13px;
    font-weight: 700;
    color: #C8FF00;
    letter-spacing: 2px;
    text-transform: uppercase;
    text-shadow: 0 1px 6px rgba(0,0,0,0.8);
  }
  .pdf-week {
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .pdf-header-bar {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(to right, transparent, #C8FF00 30%, #C8FF00 70%, transparent);
  }
  /* ── Content wrapper ── */
  .pdf-content { padding: 0 48px; }

  /* ── Day section ── */
  .day-section { margin-bottom: 32px; break-inside: avoid; }
  .day-header-pdf {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .day-title {
    font-size: 15px;
    font-weight: 800;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  /* ── Week block ── */
  .week-block { margin-bottom: 8px; }
  .week-separator {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 36px 0 20px;
    break-before: auto;
  }
  .week-separator::before,
  .week-separator::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #2a2a2a;
  }
  .week-sep-label {
    font-size: 11px;
    font-weight: 900;
    color: #000;
    background: #C8FF00;
    border-radius: 20px;
    padding: 3px 14px;
    letter-spacing: 1px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .week-block:first-child .week-separator { margin-top: 0; }

  /* ── Table ── */
  table {
    width: 100%;
    border-collapse: collapse;
    border-radius: 10px;
    overflow: hidden;
  }
  thead tr {
    background: #1a1a1a;
  }
  th {
    padding: 9px 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #777;
    text-align: center;
  }
  .th-num  { width: 36px; }
  .th-name { text-align: left; width: 40%; }
  td { padding: 10px 12px; vertical-align: top; }
  .row-even { background: #111; }
  .row-odd  { background: #0e0e0e; }
  .ex-num {
    width: 36px;
    text-align: center;
    color: #C8FF00;
    font-weight: 700;
    font-size: 12px;
  }
  .ex-name-cell { text-align: left; }
  .ex-title { font-weight: 600; color: #e8e8e8; display: block; }
  .ex-tips  { font-size: 11px; color: #666; display: block; margin-top: 2px; font-style: italic; }
  .metric-cell {
    text-align: center;
    font-weight: 600;
    color: #ccc;
    font-size: 13px;
  }
  .done-cell { color: #C8FF00; }
  .done-tick { font-size: 11px; }

  /* ── Bilan ── */
  .bilan-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
    padding: 8px 12px;
    background: #111;
    border-left: 3px solid #C8FF00;
    border-radius: 0 6px 6px 0;
    font-size: 12px;
  }
  .bilan-label { color: #777; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
  .bilan-stars { font-size: 14px; }
  .bilan-note { color: #aaa; font-style: italic; }

  /* ── Footer ── */
  .pdf-footer {
    margin-top: 40px;
    padding-top: 12px;
    border-top: 1px solid #1e1e1e;
    font-size: 10px;
    color: #444;
    display: flex;
    justify-content: space-between;
    padding-left: 0;
    padding-right: 0;
  }

  @media print {
    body { background: #0a0a0a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .day-section { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-header-img"></div>
    <img class="pdf-coach-left"  src="coach1.png" alt="">
    <img class="pdf-coach-right" src="coach2.png" alt="">
    <div class="pdf-header-overlay"></div>
    <div class="pdf-header-content">
      <div class="pdf-logo">LOUIS<span>FIT</span></div>
      <div class="pdf-student">${h(studentName)}</div>
      <div class="pdf-week">${dayCount} jour${dayCount > 1 ? 's' : ''} · ${weekCount} semaine${weekCount > 1 ? 's' : ''}</div>
    </div>
    <div class="pdf-header-bar"></div>
  </div>

  <div class="pdf-content">
    ${daysSections || '<p style="color:#555;text-align:center;padding:40px 0">Aucun exercice dans ce programme.</p>'}

    <div class="pdf-footer">
      <span>LouisFIT — Programme personnalisé</span>
      <span>${weekCount} semaine${weekCount > 1 ? 's' : ''} · ${dayCount} jour${dayCount > 1 ? 's' : ''}</span>
    </div>
  </div>
</body>
</html>`;

  // Open in a hidden iframe and trigger print-to-PDF
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:none;';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 600);
}

// ============================================================
// INIT
// ============================================================
renderSelectors();
renderTraining();
renderMeals();
renderProfileMenu();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeVideoModal();
  if (e.key === 'Enter' && e.target.hasAttribute('contenteditable')) {
    e.preventDefault();
    e.target.blur();
  }
});
