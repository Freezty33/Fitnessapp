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
  currentWeek = 1; currentDay = 1; currentNutDay = 'lundi';
}

loadProfileData();

function persistTraining() {
  localStorage.setItem(pk('training'), JSON.stringify(trainingData.days));
}
function persistCounts() {
  localStorage.setItem(pk('weekCount'), weekCount);
  localStorage.setItem(pk('dayCount'),  dayCount);
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
function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const idx = ['training','graphs','nutrition'].indexOf(tab);
  document.querySelectorAll('.nav-btn')[idx].classList.add('active');
  if (tab === 'graphs') initCharts();
  if (tab === 'nutrition') renderMeals();
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
  if (dayCount <= 1) return;
  if (!confirm(`Supprimer Jour ${dayCount} et tous ses exercices ?`)) return;
  delete trainingData.days[dayCount];
  persistTraining();
  dayCount--;
  if (currentDay > dayCount) currentDay = dayCount;
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
  if (weekCount <= 1) return;
  if (!confirm(`Supprimer la Semaine ${weekCount} et toutes ses données ?`)) return;
  // Trim each exercise's weeks array
  Object.values(trainingData.days).forEach(day => {
    day.exercises.forEach(ex => {
      if (ex.weeks.length >= weekCount) ex.weeks.splice(weekCount - 1, 1);
    });
  });
  persistTraining();
  weekCount--;
  if (currentWeek > weekCount) currentWeek = weekCount;
  persistCounts();
  renderSelectors();
  renderTraining();
}

// ============================================================
// TRAINING — RENDER (inline editable)
// ============================================================
function renderTraining() {
  const grid = document.getElementById('training-grid');
  const dayData = trainingData.days[currentDay];
  if (!dayData) return;
  const wIdx = currentWeek - 1;

  let html = `
    <div class="day-header">
      <h2 contenteditable="true" class="editable-title" onblur="saveDayLabel(${currentDay}, this)">${dayData.label}</h2>
      <span class="week-badge">Semaine ${currentWeek}</span>
    </div>
    <div class="exercises-list">`;

  dayData.exercises.forEach((ex, i) => {
    const w = ex.weeks[wIdx] || { series:'', reps:'', charge:'', done:'' };
    const hasVideo = savedVideos[ex.name];

    html += `
      <div class="exercise-card" id="ex-card-${i}">
        <div class="ex-top">
          <div class="ex-name-wrap">
            <span class="ex-number">${i+1}</span>
            <div>
              <div class="ex-name editable"
                   contenteditable="true"
                   onblur="saveField(${currentDay},${i},'name',this)"
                   title="Cliquez pour modifier">${ex.name}</div>
              <div class="ex-tips editable"
                   contenteditable="true"
                   onblur="saveField(${currentDay},${i},'tips',this)"
                   title="Conseils">${ex.tips || 'Ajouter des conseils…'}</div>
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
        <div class="ex-metrics">
          <div class="metric">
            <span class="metric-label">Séries</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'series',this)">${w.series ?? ''}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Reps</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'reps',this)">${w.reps ?? ''}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Charge (kg)</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'charge',this)">${w.charge ?? ''}</span>
          </div>
          <div class="metric done-metric">
            <span class="metric-label">Réalisé</span>
            <span class="metric-val editable"
                  contenteditable="true"
                  onblur="saveWeekField(${currentDay},${i},${wIdx},'done',this)">${w.done ?? ''}</span>
          </div>
        </div>
      </div>`;
  });

  html += '</div>';
  grid.innerHTML = html;
  updateKPIs();
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
}

// ============================================================
// ADD / DELETE EXERCISE
// ============================================================
function addExercise() {
  const dayData = trainingData.days[currentDay];
  dayData.exercises.push({
    name: 'Nouvel exercice',
    tips: '',
    weeks: Array.from({ length: 5 }, () => ({ series: 3, reps: '10-12', charge: '', done: '' }))
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
  document.getElementById('modal-series').textContent = w.series ?? '—';
  document.getElementById('modal-reps').textContent   = w.reps   ?? '—';
  document.getElementById('modal-charge').textContent = w.charge != null ? w.charge + ' kg' : '—';
  document.getElementById('modal-done').textContent   = w.done   || '—';
  document.getElementById('modal-notes').value = savedNotes[ex.name] || '';

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
}

function addDataEntry() {
  const week   = parseInt(document.getElementById('entry-week').value);
  const poids  = parseFloat(document.getElementById('entry-poids').value);
  const graisse = parseFloat(document.getElementById('entry-graisse').value);
  const eau    = parseFloat(document.getElementById('entry-eau').value);
  const muscle = parseFloat(document.getElementById('entry-muscle').value);
  if (!week) return;
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
}

function updateExerciseChart() {
  const exName = document.getElementById('exercise-select').value;
  const data   = exerciseProgress[exName] || [];
  const ctx    = document.getElementById('chart-exercise').getContext('2d');
  if (charts['chart-exercise']) charts['chart-exercise'].destroy();
  charts['chart-exercise'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['S1','S2','S3','S4','S5'],
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
  nutritionData.meals.forEach(meal => {
    const savedOpt = mealOptions[currentNutDay + '_' + meal.id] || 0;
    const opt = meal.options[savedOpt];
    const totals = opt.items.reduce((acc, it) => ({
      p: acc.p + (it.p || 0), g: acc.g + (it.g || 0),
      l: acc.l + (it.l || 0), kcal: acc.kcal + (it.kcal || 0)
    }), { p:0, g:0, l:0, kcal:0 });

    const optBtns = meal.options.map((o, i) =>
      `<button class="opt-btn ${i === savedOpt ? 'active' : ''}" onclick="selectMealOption('${currentNutDay}',${meal.id},${i},this)">${o.label}</button>`
    ).join('');

    const itemRows = opt.items.map(it =>
      `<tr>
        <td>${it.food}</td><td>${it.qty}</td>
        <td>${it.p}g</td><td>${it.g}g</td><td>${it.l}g</td><td>${it.kcal}</td>
      </tr>`
    ).join('');

    html += `
      <div class="meal-card">
        <div class="meal-header">
          <span class="meal-icon">${meal.icon}</span>
          <span class="meal-type">${meal.type}</span>
          <div class="meal-macros-mini">
            <span>${Math.round(totals.p)}g P</span>
            <span>${Math.round(totals.g)}g G</span>
            <span>${Math.round(totals.l)}g L</span>
            <span class="kcal-badge">${Math.round(totals.kcal)} kcal</span>
          </div>
        </div>
        <div class="meal-options-bar">${optBtns}</div>
        <table class="meal-table">
          <thead><tr><th>Aliment</th><th>Qté</th><th>P</th><th>G</th><th>L</th><th>kcal</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>`;
  });
  grid.innerHTML = html;
}

function selectMealOption(day, mealId, optIdx) {
  mealOptions[day + '_' + mealId] = optIdx;
  localStorage.setItem(pk('meals'), JSON.stringify(mealOptions));
  renderMeals();
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
  ['training','videos','youtube','notes','progress','meals','weekCount','dayCount'].forEach(k => {
    localStorage.removeItem('p_' + id + '_' + k);
  });
  profiles = profiles.filter(p => p.id !== id);
  persistProfiles();
  if (currentProfileId === id) switchProfile(profiles[0].id);
  else renderProfileMenu();
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
