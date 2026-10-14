-- ============================================================
-- Max Fit — Migration 001: security hardening
-- Run in Supabase → SQL Editor, AFTER running 000_diagnostics.sql.
-- Idempotent: safe to run twice. Wrapped in a transaction.
-- Uses existing helpers my_role() and i_coach(student_profiles.id).
-- ============================================================
begin;

-- ------------------------------------------------------------
-- 1. profiles: nobody can change their own role (C1)
-- ------------------------------------------------------------
drop policy if exists "own profile" on public.profiles;
drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

create policy "profiles read own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
-- (no insert/delete policy: rows are created by the signup trigger / service role)

-- Block role changes from any signed-in client. The SQL editor and the
-- service key (Netlify functions) have auth.uid() = null, so they still work.
create or replace function public.block_role_change()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'role is immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_role_change on public.profiles;
create trigger trg_block_role_change
  before update on public.profiles
  for each row execute function public.block_role_change();

-- Signup trigger: never trust a client-supplied role. Self-signups are students.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ------------------------------------------------------------
-- 2. student_profiles: student can read/update self but not re-parent (C2)
-- ------------------------------------------------------------
drop policy if exists "student owns profile" on public.student_profiles;
drop policy if exists "student reads own sp" on public.student_profiles;
drop policy if exists "student updates own sp" on public.student_profiles;
drop policy if exists "coach manages students" on public.student_profiles;

create policy "student reads own sp"
  on public.student_profiles for select
  using (user_id = auth.uid());

create policy "student updates own sp"
  on public.student_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "coach manages students"
  on public.student_profiles for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

create or replace function public.lock_student_links()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and
     (new.coach_id is distinct from old.coach_id or new.user_id is distinct from old.user_id) then
    raise exception 'coach_id / user_id are immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_lock_student_links on public.student_profiles;
create trigger trg_lock_student_links
  before update on public.student_profiles
  for each row execute function public.lock_student_links();

-- ------------------------------------------------------------
-- 3. Coach policies: add WITH CHECK so a coach can't write rows
--    for someone else's student (C3)
-- ------------------------------------------------------------
drop policy if exists "coach manages plans" on public.workout_plans;
create policy "coach manages plans"
  on public.workout_plans for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and public.i_coach(student_id));

drop policy if exists "coach manages nutrition plans" on public.nutrition_plans;
create policy "coach manages nutrition plans"
  on public.nutrition_plans for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and public.i_coach(student_id));

drop policy if exists "coach manages assignments" on public.exercise_assignments;
create policy "coach manages assignments"
  on public.exercise_assignments for all
  using (exists (select 1 from public.workout_plans wp
                 where wp.id = exercise_assignments.plan_id and wp.coach_id = auth.uid()))
  with check (exists (select 1 from public.workout_plans wp
                      where wp.id = exercise_assignments.plan_id and wp.coach_id = auth.uid()));

-- extra_trainings: check the existing policy bodies first (see diagnostics);
-- they already use i_coach(student_id) with check in the schema file.

-- ------------------------------------------------------------
-- 4. voice-notes storage: coach may only touch folders of THEIR students (C4)
--    Object path is  <student_profiles.id>/<file>
--    Bucket stays public for now (stored public_url values keep working);
--    moving to a private bucket + signed URLs is a later step.
-- ------------------------------------------------------------
create or replace function public.voice_folder_is_mine(p_name text)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$'
      then public.i_coach(((storage.foldername(p_name))[1])::uuid)
    else false
  end
$$;

drop policy if exists "coach upload voice" on storage.objects;
drop policy if exists "coach delete voice" on storage.objects;
drop policy if exists "coach update voice" on storage.objects;

create policy "coach upload voice"
  on storage.objects for insert
  with check (bucket_id = 'voice-notes' and public.my_role() = 'coach'
              and public.voice_folder_is_mine(name));

create policy "coach delete voice"
  on storage.objects for delete
  using (bucket_id = 'voice-notes' and public.my_role() = 'coach'
         and public.voice_folder_is_mine(name));

create policy "coach update voice"
  on storage.objects for update
  using (bucket_id = 'voice-notes' and public.my_role() = 'coach'
         and public.voice_folder_is_mine(name))
  with check (bucket_id = 'voice-notes' and public.my_role() = 'coach'
              and public.voice_folder_is_mine(name));

commit;

-- ============================================================
-- Verification (run each as a STUDENT session, e.g. from the app console;
-- every one must fail):
--   await sb.from('profiles').update({role:'coach'}).eq('id', (await sb.auth.getUser()).data.user.id)
--   await sb.from('student_profiles').update({coach_id:'<other uuid>'}).eq('user_id', '<me>')
-- ============================================================
