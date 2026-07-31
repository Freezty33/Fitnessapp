// ============================================================
// OFFLINE SYNC — IndexedDB queue + auto-flush on reconnect
// Loaded before app.js. Requires `sb` from auth.js.
// ============================================================
const _DB_NAME    = 'louisfit-offline';
const _DB_VERSION = 1;
const _STORE      = 'pending_logs';

function _openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_STORE)) {
        const store = db.createObjectStore(_STORE, { keyPath: 'local_id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function _queueLog(payload) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(_STORE, 'readwrite');
    const req = tx.objectStore(_STORE).add({ ...payload, synced: false, queued_at: new Date().toISOString() });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function _getPendingLogs() {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(_STORE, 'readonly');
    const req = tx.objectStore(_STORE).index('synced').getAll(IDBKeyRange.only(false));
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function _markSynced(local_id) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx    = db.transaction(_STORE, 'readwrite');
    const store = tx.objectStore(_STORE);
    const get   = store.get(local_id);
    get.onsuccess = e => {
      const rec = e.target.result;
      rec.synced = true;
      const put = store.put(rec);
      put.onsuccess = () => res();
      put.onerror   = ev => rej(ev.target.error);
    };
  });
}

// ── Flush pending logs to Supabase ────────────────────────────
async function flushPendingLogs() {
  if (!navigator.onLine || typeof sb === 'undefined') return;
  const pending = await _getPendingLogs();
  if (!pending.length) return;
  console.log('[sync] flushing', pending.length, 'log(s)');
  for (const log of pending) {
    const { local_id, synced, queued_at, ...payload } = log;
    try {
      const { error } = await sb.from('exercise_logs').upsert(payload, {
        onConflict: 'student_id,exercise_name,logged_date,week_number'
      });
      if (!error) await _markSynced(local_id);
      else console.warn('[sync] upsert error', error.message);
    } catch (err) {
      console.warn('[sync] network error', err);
      break;
    }
  }
  _hideOfflineBadge();
}

// ── Save an exercise log (called from app.js) ─────────────────
async function saveExerciseLog(studentId, payload) {
  if (!studentId) return; // not yet authenticated as student
  const record = { student_id: studentId, synced_at: new Date().toISOString(), ...payload };
  if (navigator.onLine && typeof sb !== 'undefined') {
    const { error } = await sb.from('exercise_logs').upsert(record, {
      onConflict: 'student_id,exercise_name,logged_date,week_number'
    });
    if (error) {
      console.warn('[sync] online save failed, queuing', error.message);
      await _queueLog(record);
      _showOfflineBadge();
    }
  } else {
    await _queueLog(record);
    _showOfflineBadge();
  }
}

// ── Offline badge ─────────────────────────────────────────────
function _showOfflineBadge() {
  let badge = document.getElementById('offline-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'offline-badge';
    badge.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1a1a1a', 'border:1px solid #C8FF00', 'color:#C8FF00',
      'padding:8px 18px', 'border-radius:999px', 'font-size:12px',
      'font-weight:700', 'z-index:9999', 'letter-spacing:1px', 'pointer-events:none'
    ].join(';');
    badge.textContent = '⚡ Hors ligne — sync en attente';
    document.body.appendChild(badge);
  }
  badge.style.display = 'block';
}

function _hideOfflineBadge() {
  const badge = document.getElementById('offline-badge');
  if (badge) badge.style.display = 'none';
}

// ── Auto-sync hooks ───────────────────────────────────────────
window.addEventListener('online',  flushPendingLogs);
window.addEventListener('load',    flushPendingLogs);
