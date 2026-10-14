-- Phase 4a: progress photos in a private bucket (folder = student_profiles.id)

insert into storage.buckets (id, name, public)
values ('body-photos', 'body-photos', false)
on conflict (id) do nothing;

create table if not exists public.progress_photos (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  week        int  not null,
  angle       text not null check (angle in ('front','side','back')),
  path        text not null,
  created_at  timestamptz default now(),
  unique (student_id, week, angle)
);
alter table public.progress_photos enable row level security;

create policy "student manages own photos rows" on public.progress_photos for all
  using (exists (select 1 from public.student_profiles sp where sp.id = student_id and sp.user_id = auth.uid()))
  with check (exists (select 1 from public.student_profiles sp where sp.id = student_id and sp.user_id = auth.uid()));

create policy "coach reads photos rows" on public.progress_photos for select
  using (public.i_coach(student_id));

-- Storage: first folder segment = student_profiles.id
create policy "photos student rw" on storage.objects for all
  using (bucket_id = 'body-photos' and exists (
    select 1 from public.student_profiles sp
    where sp.id::text = (storage.foldername(name))[1] and sp.user_id = auth.uid()))
  with check (bucket_id = 'body-photos' and exists (
    select 1 from public.student_profiles sp
    where sp.id::text = (storage.foldername(name))[1] and sp.user_id = auth.uid()));

create policy "photos coach read" on storage.objects for select
  using (bucket_id = 'body-photos' and exists (
    select 1 from public.student_profiles sp
    where sp.id::text = (storage.foldername(name))[1] and sp.coach_id = auth.uid()));
