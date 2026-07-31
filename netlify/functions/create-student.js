// Netlify Function — creates a Supabase auth user + student_profiles row
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Called by the coach via POST with their JWT in Authorization header.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  // ── Verify caller is authenticated ──────────────────────────
  const authHeader = event.headers['authorization'] || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

  // Use anon client to verify the JWT (getUser validates the token with Supabase)
  const anonClient = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || '');
  const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(jwt);
  if (authErr || !caller) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };

  // Use admin client to check the caller's role
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.id).single();
  if (!callerProfile || callerProfile.role !== 'coach') {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden: coaches only' }) };
  }

  // ── Parse request body ───────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, password, full_name, goal_text } = body;
  if (!email || !password || !full_name) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'email, password and full_name are required' }) };
  }
  if (password.length < 6) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Password must be at least 6 characters' }) };
  }

  // ── Create the auth user ─────────────────────────────────────
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: 'student' },
  });
  if (createErr) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: createErr.message }) };
  }

  const studentAuthId = newUser.user.id;

  // ── Ensure profile row exists (trigger may race; upsert is safe) ──
  await admin.from('profiles').upsert({
    id: studentAuthId,
    role: 'student',
    full_name,
  }, { onConflict: 'id' });

  // ── Create student_profiles row ──────────────────────────────
  const { data: sp, error: spErr } = await admin.from('student_profiles').insert({
    user_id:   studentAuthId,
    coach_id:  caller.id,
    goal_text: goal_text || '',
  }).select('id').single();
  if (spErr) {
    // Roll back the auth user so there's no orphan
    await admin.auth.admin.deleteUser(studentAuthId);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: spErr.message }) };
  }

  // ── Create a blank workout plan ──────────────────────────────
  await admin.from('workout_plans').insert({
    student_id: sp.id,
    coach_id:   caller.id,
    label:      'Programme S1',
    week_count: 5,
    day_count:  4,
  });

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, student_profile_id: sp.id, full_name }),
  };
};
