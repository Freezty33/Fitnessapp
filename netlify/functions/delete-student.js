// Netlify Function — deletes a student (auth user + all related rows)
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function adminFetch(path, method = 'GET', body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, { error: 'Method Not Allowed' });

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json(500, { error: 'Server not configured — check env vars' });
  }

  // ── Verify caller JWT ─────────────────────────────────────────
  const authHeader = event.headers['authorization'] || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Unauthorized' });

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${jwt}` },
  });
  if (!verifyRes.ok) return json(401, { error: 'Invalid token' });
  const caller = await verifyRes.json();

  // ── Check caller is coach ─────────────────────────────────────
  const profileRes = await adminFetch(`/rest/v1/profiles?id=eq.${caller.id}&select=role`);
  if (!profileRes.ok || !profileRes.data?.[0] || profileRes.data[0].role !== 'coach') {
    return json(403, { error: 'Forbidden: coaches only' });
  }

  // ── Parse body ────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { student_profile_id } = body;
  if (!UUID_RE.test(student_profile_id || '')) return json(400, { error: 'student_profile_id must be a UUID' });

  // ── Verify this student belongs to the calling coach ──────────
  const spRes = await adminFetch(`/rest/v1/student_profiles?id=eq.${student_profile_id}&coach_id=eq.${caller.id}&select=id,user_id`);
  if (!spRes.ok || !spRes.data?.[0]) {
    return json(403, { error: 'Student not found or not yours' });
  }
  const studentAuthId = spRes.data[0].user_id;

  // ── Remove the student's voice-note files (storage is not covered by FK cascade)
  let storageCleaned = true;
  const list = await adminFetch(`/storage/v1/object/list/voice-notes`, 'POST', { prefix: `${student_profile_id}/`, limit: 1000 });
  if (list.ok && Array.isArray(list.data) && list.data.length) {
    const paths = list.data.map(o => `${student_profile_id}/${o.name}`);
    const rm = await adminFetch(`/storage/v1/object/voice-notes`, 'DELETE', { prefixes: paths });
    storageCleaned = rm.ok;
  } else if (!list.ok) {
    storageCleaned = false;
  }

  // ── Delete cascades via FK: student_profiles → workout_plans,
  //    exercise_assignments, exercise_logs, body_metrics,
  //    session_feedback, nutrition_plans (all ON DELETE CASCADE)
  //    coach_id filter repeated so the delete can never touch another coach's student
  const delSp = await adminFetch(`/rest/v1/student_profiles?id=eq.${student_profile_id}&coach_id=eq.${caller.id}`, 'DELETE');
  if (!delSp.ok && delSp.status !== 404) {
    return json(500, { error: 'Failed to delete student profile' });
  }

  // ── Delete the auth user ──────────────────────────────────────
  const delAuth = await adminFetch(`/auth/v1/admin/users/${studentAuthId}`, 'DELETE');
  if (!delAuth.ok && delAuth.status !== 404) {
    // Profile rows are gone but the login still exists: report it so it can be removed manually
    return json(207, { ok: false, partial: true, error: 'Student data deleted but auth user removal failed', storageCleaned });
  }

  return json(200, { ok: true, storageCleaned });
};
