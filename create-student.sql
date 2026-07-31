-- ============================================================
-- Create a student account + link them to the coach
-- Run AFTER you've invited the student via Supabase Auth
-- (Authentication → Users → Invite user)
--
-- Replace the values marked with ← before running
-- ============================================================

-- Step 1: set the student's role (auto-created as 'student' by trigger, just confirm)
update public.profiles
set role = 'student', full_name = 'Prénom Étudiant'   -- ← change name
where id = '<student-auth-uuid>';                       -- ← paste from Auth → Users

-- Step 2: create their student_profile linked to the coach
insert into public.student_profiles (user_id, coach_id, goal_text)
values (
  '<student-auth-uuid>',                                -- ← same student uuid
  'da7941a8-a34e-4403-8dd6-fd6ee78c6c3a',              -- ← your coach uuid (already set)
  'Prise de masse / Sèche'                              -- ← optional goal text
);

-- Step 3: create a blank workout plan for this student
-- (the coach can populate exercises via the app later,
--  or you can insert exercise_assignments manually here)
insert into public.workout_plans (student_id, coach_id, label, week_count, day_count)
values (
  (select id from public.student_profiles where user_id = '<student-auth-uuid>'),
  'da7941a8-a34e-4403-8dd6-fd6ee78c6c3a',
  'Programme S1',
  5,   -- weeks
  4    -- training days
);

-- ============================================================
-- Verify everything looks right
-- ============================================================
select
  p.full_name,
  p.role,
  sp.id as student_profile_id,
  wp.label as plan_label,
  wp.week_count,
  wp.day_count
from public.profiles p
join public.student_profiles sp on sp.user_id = p.id
join public.workout_plans wp    on wp.student_id = sp.id
where p.role = 'student';
