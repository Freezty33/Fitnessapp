// Netlify Function — creates a Supabase auth user + student_profiles row
// Uses native fetch (Node 18+) — no npm dependencies required.
// Env vars needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

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
  const caller = (await verifyRes.json());

  // ── Check caller is coach ─────────────────────────────────────
  const profileRes = await adminFetch(`/rest/v1/profiles?id=eq.${caller.id}&select=role`);
  if (!profileRes.ok || !profileRes.data?.[0] || profileRes.data[0].role !== 'coach') {
    return json(403, { error: 'Forbidden: coaches only' });
  }

  // ── Parse body ────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { email, password, full_name, goal_text } = body;
  if (!email || !password || !full_name) return json(400, { error: 'email, password et full_name sont requis' });
  if (password.length < 6)              return json(400, { error: 'Mot de passe : 6 caractères minimum' });

  // ── Create auth user ──────────────────────────────────────────
  const createRes = await adminFetch('/auth/v1/admin/users', 'POST', {
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'student' },
  });
  if (!createRes.ok) {
    const msg = createRes.data?.message || createRes.data?.msg || JSON.stringify(createRes.data);
    return json(400, { error: msg });
  }
  const studentAuthId = createRes.data.id;

  // ── Upsert profile row ────────────────────────────────────────
  await adminFetch('/rest/v1/profiles', 'POST', { id: studentAuthId, role: 'student', full_name });

  // ── Create student_profiles row ───────────────────────────────
  const spRes = await adminFetch('/rest/v1/student_profiles', 'POST', {
    user_id:   studentAuthId,
    coach_id:  caller.id,
    goal_text: goal_text || '',
  });
  if (!spRes.ok) {
    await adminFetch(`/auth/v1/admin/users/${studentAuthId}`, 'DELETE');
    return json(500, { error: spRes.data?.message || 'Erreur student_profiles' });
  }
  const studentProfileId = Array.isArray(spRes.data) ? spRes.data[0].id : spRes.data.id;

  // ── Create blank workout plan ─────────────────────────────────
  await adminFetch('/rest/v1/workout_plans', 'POST', {
    student_id: studentProfileId,
    coach_id:   caller.id,
    label:      'Programme S1',
    week_count: 5,
    day_count:  4,
  });

  return json(200, { ok: true, student_profile_id: studentProfileId, full_name });
};
