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
    const req = tx.objectStore(_STORE).getAll();
    req.onsuccess = e => res(e.target.result.filter(r => r.synced !== true));
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
      if (!rec) return res();
      rec.synced = true;
      const put = store.put(rec);
      put.onsuccess = () => res();
      put.onerror   = ev => rej(ev.target.error);
    };
  });
}

// ── Purge rows synced more than 7 days ago (pending rows are never touched) ──
async function _purgeSynced() {
  try {
    const db = await _openDB();
    const cutoff = Date.now() - 7 * 864e5;
    await new Promise(res => {
      const tx = db.transaction(_STORE, 'readwrite');
      const store = tx.objectStore(_STORE);
      store.openCursor().onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return;
        const r = cur.value;
        if (r.synced === true && Date.parse(r.queued_at) < cutoff) cur.delete();
        cur.continue();
      };
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch (_) { /* purge is best-effort */ }
}

// ── Flush pending logs to Supabase ────────────────────────────
// A record is marked synced ONLY after Supabase confirms the upsert (no
// error). Any failure leaves it queued and schedules a retry with
// exponential backoff (5s, 10s, ... capped at 5 min).
let _flushing = false;
let _retryDelay = 5000;
let _retryTimer = null;

function _scheduleRetry() {
  clearTimeout(_retryTimer);
  _retryTimer = setTimeout(flushPendingLogs, _retryDelay);
  _retryDelay = Math.min(_retryDelay * 2, 300000);
}

async function flushPendingLogs() {
  if (_flushing || typeof sb === 'undefined') return;
  if (!navigator.onLine) return;
  _flushing = true;
  let failed = false;
  try {
    const pending = (await _getPendingLogs()).sort((a, b) => a.local_id - b.local_id);
    if (!pending.length) { _hideOfflineBadge(); _retryDelay = 5000; return; }
    console.log('[sync] flushing', pending.length, 'log(s)');
    for (const log of pending) {
      const { local_id, synced, queued_at, ...payload } = log;
      try {
        const { error } = await sb.from('exercise_logs').upsert(payload, { onConflict: _LOG_CONFLICT });
        if (!error) await _markSynced(local_id);
        else { failed = true; console.warn('[sync] upsert error', error.message); }
      } catch (err) {
        failed = true;
        console.warn('[sync] network error', err);
        break;  // keep order; retry later
      }
    }
  } finally {
    _flushing = false;
  }
  if (failed) { _showOfflineBadge(); _scheduleRetry(); }
  else { _hideOfflineBadge(); _retryDelay = 5000; _purgeSynced(); }
}

// ── Save an exercise log (called from app.js) ─────────────────
// Always lands either in Supabase or in the IndexedDB queue, never nowhere.
const _LOG_CONFLICT = 'student_id,exercise_name,day_number,logged_date,week_number';

async function saveExerciseLog(studentId, payload) {
  if (!studentId) return; // not yet authenticated as student
  const record = { student_id: studentId, synced_at: new Date().toISOString(), ...payload };
  if (navigator.onLine && typeof sb !== 'undefined') {
    try {
      const { error } = await sb.from('exercise_logs').upsert(record, { onConflict: _LOG_CONFLICT });
      if (!error) return;
      console.warn('[sync] online save failed, queuing', error.message);
    } catch (err) {
      console.warn('[sync] online save threw, queuing', err);
    }
  }
  await _queueLog(record);
  _showOfflineBadge();
  _scheduleRetry();
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushPendingLogs();
});
// Ask the browser not to evict IndexedDB/localStorage under storage pressure
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
