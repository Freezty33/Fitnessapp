-- 005_log_integrity.sql
-- Guards exercise_logs against loss. Run the three STEPS one at a time in the
-- Supabase SQL editor, in order, BEFORE deploying the matching client code.

-- ── STEP 1 ───────────────────────────────────────────────────────────────
-- Document + enforce the snapshot columns the client already writes.
alter table public.exercise_logs add column if not exists day_number int;
alter table public.exercise_logs add column if not exists done_value text;
update public.exercise_logs set day_number = 0 where day_number is null;
alter table public.exercise_logs alter column day_number set default 0;
alter table public.exercise_logs alter column day_number set not null;

-- ── STEP 2 ───────────────────────────────────────────────────────────────
-- Safety net: any DELETE (manual, cascade from a student delete, bad script)
-- copies the row to an archive first; TRUNCATE is refused outright.
create table if not exists public.exercise_logs_archive (
  id          bigserial primary key,
  archived_at timestamptz not null default now(),
  row_data    jsonb not null
);
alter table public.exercise_logs_archive enable row level security;  -- no policies: service role only

create or replace function public.archive_exercise_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exercise_logs_archive (row_data) values (to_jsonb(old));
  return old;
end $$;

drop trigger if exists trg_archive_exercise_log on public.exercise_logs;
create trigger trg_archive_exercise_log before delete on public.exercise_logs
  for each row execute function public.archive_exercise_log();

create or replace function public.block_exercise_log_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'TRUNCATE on exercise_logs is not allowed';
end $$;

drop trigger if exists trg_block_log_truncate on public.exercise_logs;
create trigger trg_block_log_truncate before truncate on public.exercise_logs
  for each statement execute function public.block_exercise_log_truncate();

revoke truncate on public.exercise_logs from anon, authenticated;

-- ── STEP 3 ───────────────────────────────────────────────────────────────
-- Same exercise name on two different days no longer collides. The new key is
-- strictly finer than the old one, so existing rows can never violate it.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.exercise_logs'::regclass and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname::text)
           from unnest(con.conkey) k join pg_attribute att
             on att.attrelid = con.conrelid and att.attnum = k)
          = array['exercise_name','logged_date','student_id','week_number']
  loop
    execute format('alter table public.exercise_logs drop constraint %I', c);
  end loop;
end $$;

alter table public.exercise_logs
  add constraint exercise_logs_slot_key
  unique (student_id, exercise_name, day_number, logged_date, week_number);
