-- ============================================================
-- LouisFIT — Supabase Schema
-- Paste this entire file into Supabase → SQL Editor → Run
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================

-- Extends auth.users — one row per user (coach or student)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('coach','student')),
  full_name   text,
  avatar_url  text,
  created_at  timestamptz default now()
);

-- Links a student to their coach + stores physical goals
create table public.student_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  coach_id        uuid not null references public.profiles(id),
  height_cm       numeric(5,1),
  starting_weight numeric(5,2),
  goal_weight     numeric(5,2),
  goal_text       text,
  created_at      timestamptz default now(),
  unique(user_id)
);

-- Workout programs assigned by the coach
create table public.workout_plans (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  coach_id    uuid not null references public.profiles(id),
  label       text not null default 'Programme',
  week_count  int  not null default 5,
  day_count   int  not null default 4,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Individual exercises inside a plan
create table public.exercise_assignments (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.workout_plans(id) on delete cascade,
  day_number      int  not null,
  position        int  not null default 0,
  name            text not null,
  tips            text,
  target_series   int,
  target_reps     text,
  target_charge   numeric(6,2),
  video_url       text,
  rest_seconds    int default 90
);

-- Per-session exercise logs (written by the student)
create table public.exercise_logs (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.student_profiles(id) on delete cascade,
  assignment_id   uuid references public.exercise_assignments(id) on delete set null,
  exercise_name   text not null,
  logged_date     date not null default current_date,
  week_number     int  not null,
  series_done     text,
  reps_done       text,
  charge_kg       numeric(6,2),
  completed       boolean default false,
  notes           text,
  synced_at       timestamptz default now(),
  unique(student_id, exercise_name, logged_date, week_number)
);

create index on public.exercise_logs(student_id, logged_date);

-- Weekly body composition measurements
create table public.body_metrics (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles(id) on delete cascade,
  week_number  int  not null,
  recorded_at  date not null default current_date,
  weight_kg    numeric(5,2),
  body_fat_pct numeric(5,2),
  water_pct    numeric(5,2),
  muscle_kg    numeric(5,2),
  unique(student_id, week_number)
);

-- Nutrition plans created by the coach
create table public.nutrition_plans (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles(id) on delete cascade,
  coach_id     uuid not null references public.profiles(id),
  label        text default 'Plan alimentaire',
  kcal_target  int,
  protein_g    int,
  carbs_g      int,
  fat_g        int,
  plan_data    jsonb not null default '{}',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Extra (repeated) training sessions scoped to a specific week
create table public.extra_trainings (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.student_profiles(id) on delete cascade,
  week_number    int  not null,
  exercises_json jsonb not null default '[]',
  created_at     timestamptz default now(),
  unique(student_id, week_number)
);
alter table public.extra_trainings enable row level security;

create policy "coach manages extra trainings"
  on public.extra_trainings for all
  using (public.i_coach(student_id))
  with check (public.i_coach(student_id));

create policy "student reads extra trainings"
  on public.extra_trainings for select
  using (exists(
    select 1 from public.student_profiles
    where id = student_id and user_id = auth.uid()
  ));

-- Coach voice notes linked to exercises (for cross-device sharing via Storage)
create table public.coach_voice_notes (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles(id) on delete cascade,
  voice_key    text not null,          -- "dayNum_exerciseName"
  storage_path text not null,          -- path inside voice-notes bucket
  public_url   text not null,
  created_at   timestamptz default now(),
  unique(student_id, voice_key)
);

-- Post-session feedback (rating + notes + pain map)
create table public.session_feedback (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  day_number  int  not null,
  week_number int  not null,
  rating      int  check (rating is null or rating between 0 and 5),
  note        text,
  pain_points jsonb default '[]',
  created_at  timestamptz default now(),
  unique(student_id, day_number, week_number)
);


-- ============================================================
-- 2. ROW LEVEL SECURITY — enable on all tables
-- ============================================================

alter table public.profiles             enable row level security;
alter table public.student_profiles     enable row level security;
alter table public.workout_plans        enable row level security;
alter table public.exercise_assignments enable row level security;
alter table public.exercise_logs        enable row level security;
alter table public.body_metrics         enable row level security;
alter table public.nutrition_plans      enable row level security;
alter table public.session_feedback     enable row level security;
alter table public.coach_voice_notes    enable row level security;


-- ============================================================
-- 3. HELPER FUNCTIONS
-- ============================================================

-- Returns the caller's role (coach / student)
create or replace function public.my_role()
returns text language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Returns true if the caller is the coach of the given student_profile
create or replace function public.i_coach(p_student_id uuid)
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.student_profiles
    where id = p_student_id
      and coach_id = auth.uid()
  )
$$;


-- ============================================================
-- 4. RLS POLICIES
-- ============================================================

-- profiles: own row + coach can read their students' rows
create policy "own profile"
  on public.profiles for all
  using (id = auth.uid());

create policy "coach reads student profiles"
  on public.profiles for select
  using (
    exists(
      select 1 from public.student_profiles sp
      where sp.user_id = public.profiles.id
        and sp.coach_id = auth.uid()
    )
  );

-- student_profiles
create policy "student owns profile"
  on public.student_profiles for all
  using (user_id = auth.uid());

create policy "coach manages students"
  on public.student_profiles for all
  using (coach_id = auth.uid());

-- workout_plans
create policy "student reads own plan"
  on public.workout_plans for select
  using (
    public.i_coach(student_id) or
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );

create policy "coach manages plans"
  on public.workout_plans for all
  using (coach_id = auth.uid());

-- exercise_assignments
create policy "read assignments"
  on public.exercise_assignments for select
  using (
    exists(
      select 1 from public.workout_plans wp
      where wp.id = exercise_assignments.plan_id
        and (
          wp.coach_id = auth.uid() or
          exists(
            select 1 from public.student_profiles sp
            where sp.id = wp.student_id and sp.user_id = auth.uid()
          )
        )
    )
  );

create policy "coach manages assignments"
  on public.exercise_assignments for all
  using (
    exists(
      select 1 from public.workout_plans wp
      where wp.id = exercise_assignments.plan_id
        and wp.coach_id = auth.uid()
    )
  );

-- exercise_logs
create policy "student logs own data"
  on public.exercise_logs for all
  using (
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );

create policy "coach reads student logs"
  on public.exercise_logs for select
  using (public.i_coach(student_id));

-- body_metrics
create policy "student body metrics"
  on public.body_metrics for all
  using (
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );

create policy "coach reads body metrics"
  on public.body_metrics for select
  using (public.i_coach(student_id));

-- nutrition_plans
create policy "student reads nutrition plan"
  on public.nutrition_plans for select
  using (
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );

create policy "coach manages nutrition plans"
  on public.nutrition_plans for all
  using (coach_id = auth.uid());

-- session_feedback
create policy "student feedback"
  on public.session_feedback for all
  using (
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );

create policy "coach reads feedback"
  on public.session_feedback for select
  using (public.i_coach(student_id));

create policy "coach writes feedback"
  on public.session_feedback for all
  using (public.i_coach(student_id))
  with check (public.i_coach(student_id));

-- coach_voice_notes
create policy "coach manages voice notes"
  on public.coach_voice_notes for all
  using (public.i_coach(student_id))
  with check (public.i_coach(student_id));

create policy "student reads voice notes"
  on public.coach_voice_notes for select
  using (
    exists(
      select 1 from public.student_profiles
      where id = student_id and user_id = auth.uid()
    )
  );


-- ============================================================
-- 5. PROFILE AUTO-CREATE TRIGGER
-- Automatically inserts a row in public.profiles when a new
-- user signs up via Supabase Auth.
-- Set role manually afterwards (default: 'student').
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 6. SEED YOUR COACH ACCOUNT
-- After running this file, go to Authentication → Users in the
-- Supabase dashboard, invite yourself, then run:
--
--   update public.profiles
--   set role = 'coach', full_name = 'Louis'
--   where id = '<your-auth-user-uuid>';
--
-- ============================================================


-- ============================================================
-- 7. STORAGE BUCKET FOR VOICE NOTES
-- Run these in the SQL Editor to create the bucket and policies.
-- ============================================================

-- Create the bucket (public so student devices can play audio without auth)
insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', true)
on conflict (id) do nothing;

-- Allow coaches to upload / delete their own students' files
create policy "coach upload voice"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-notes'
    and public.my_role() = 'coach'
  );

create policy "coach delete voice"
  on storage.objects for delete
  using (
    bucket_id = 'voice-notes'
    and public.my_role() = 'coach'
  );

create policy "coach update voice"
  on storage.objects for update
  using (
    bucket_id = 'voice-notes'
    and public.my_role() = 'coach'
  );

-- Anyone can read (bucket is public, but belt-and-suspenders)
create policy "public read voice"
  on storage.objects for select
  using (bucket_id = 'voice-notes');
