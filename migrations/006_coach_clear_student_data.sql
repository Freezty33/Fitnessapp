-- Lets a coach wipe a student's exercise_logs (series/reps/charge/réalisé
-- progress) from the "Supprimer le plan d'entraînement" button.
-- Students can't write exercise_logs policies that allow a coach to delete
-- rows, so this goes through a SECURITY DEFINER RPC gated by i_coach(),
-- the same helper already used for workout_plans/session_feedback RLS.
-- Deleted rows are still archived by the existing trg_archive_exercise_log
-- trigger (migrations/005_log_integrity.sql), so nothing is lost server-side.

create or replace function public.clear_student_progress(p_student uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.i_coach(p_student) then
    raise exception 'not authorized';
  end if;

  delete from public.exercise_logs where student_id = p_student;
end;
$$;

revoke all on function public.clear_student_progress(uuid) from public;
grant execute on function public.clear_student_progress(uuid) to authenticated;
