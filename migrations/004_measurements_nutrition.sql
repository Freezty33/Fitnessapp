-- Phase 4b: measurements + nutrition plan sync

-- Body measurements (one row per student per week; values in jsonb)
create table if not exists public.body_measurements (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  week        int  not null,
  data        jsonb not null default '{}',
  updated_at  timestamptz default now(),
  unique (student_id, week)
);
alter table public.body_measurements enable row level security;

create policy "student manages own measurements" on public.body_measurements for all
  using (exists (select 1 from public.student_profiles sp where sp.id = student_id and sp.user_id = auth.uid()))
  with check (exists (select 1 from public.student_profiles sp where sp.id = student_id and sp.user_id = auth.uid()));

create policy "coach reads measurements" on public.body_measurements for select
  using (public.i_coach(student_id));

-- Nutrition: one plan per student (table already exists, was never used)
create unique index if not exists nutrition_plans_student_uidx
  on public.nutrition_plans (student_id);

-- Coach edits reach students live
alter publication supabase_realtime add table public.nutrition_plans;
