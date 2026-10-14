-- ============================================================
-- Max Fit — Migration 000: READ-ONLY diagnostics
-- Run in Supabase → SQL Editor. Changes nothing. Paste the results back to me.
-- ============================================================

-- A. Which tables exist, and is RLS on?
select c.relname as table, c.relrowsecurity as rls_on, c.relreplident as replica_identity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- B. Every RLS policy on public tables (look for rdv_bookings / coach_availability)
select tablename, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, policyname;

-- C. Unique indexes on the RDV tables (needed to prevent double booking)
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('rdv_bookings','coach_availability');

-- D. Realtime publication contents
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- E. Storage policies + bucket visibility
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage';
select id, public from storage.buckets;

-- F. Who is a coach right now? (should be only you)
select id, role, full_name from public.profiles where role = 'coach';

-- G. Are public signups enabled? Check in the dashboard:
--    Authentication → Providers → Email → "Allow new users to sign up"
--    (turn OFF if students are only created by the coach)
