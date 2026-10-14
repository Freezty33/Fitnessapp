# Phase 2 Correctness Fixes

**Files to modify:**
- `index.html` — load `state.js` before `auth.js`
- `app.js` — stale-response guard, atomic plan save, date helper, dedupe saveExerciseLog
- `supabase-schema.sql` — add atomic plan RPC
- `offline-sync.js` — no changes (keep the saveExerciseLog definition here)

**Issues fixed:**
- C6/C7: Cross-student data corruption on coach switch
- C8: Non-atomic plan save
- Offline queue dead (duplicate saveExerciseLog)
- Duplicate logged_dates near midnight

---

## 1. Load `state.js` before `auth.js` in index.html

Add this line **before** the `<script src="auth.js"></script>` line:
```html
<script src="state.js"></script>
```

---

## 2. Add a date helper to app.js (top section, after the h() function)

```js
// Local date in YYYY-MM-DD format (consistent, avoids midnight bugs)
function localDate(date = new Date()) {
  return date.toLocaleDateString('sv');  // 'sv' locale gives YYYY-MM-DD
}
```

---

## 3. Replace pk() function in app.js

**OLD (line 19):**
```js
function pk(key) { return `p_${currentProfileId}_${key}`; }
```

**NEW:**
```js
function pk(key, sid = Ctx.id) { return `p_${sid}_${key}`; }
```

This uses the context store instead of the global.

---

## 4. Replace _saveStudentPlanToSupabase() in app.js (lines 103-151)

**OLD:**
```js
let _planSaveTimer = null;
function _saveStudentPlanToSupabase() {
  if (typeof sb === 'undefined' || typeof activeStudentId !== 'function' || !activeStudentId()) return;
  clearTimeout(_planSaveTimer);
  _planSaveTimer = setTimeout(async () => {
    const studentId = activeStudentId();
    if (!studentId) return;

    // Fetch the plan id for this student
    const { data: plan } = await sb
      .from('workout_plans')
      .select('id')
      .eq('student_id', studentId)
      .maybeSingle();
    if (!plan) return;

    // Update plan meta
    await sb.from('workout_plans').update({
      week_count: weekCount,
      day_count:  dayCount,
      updated_at: new Date().toISOString(),
    }).eq('id', plan.id);

    // Delete all existing assignments then re-insert
    await sb.from('exercise_assignments').delete().eq('plan_id', plan.id);

    const assignments = [];
    Object.entries(trainingData.days).forEach(([dayNum, day]) => {
      (day.exercises || []).forEach((ex, pos) => {
        const firstWeek = ex.weeks && ex.weeks[0];
        assignments.push({
          plan_id:        plan.id,
          day_number:     Number(dayNum),
          position:       pos,
          name:           ex.name || '',
          tips:           ex.tips || '',
          target_series:  firstWeek ? (parseInt(firstWeek.series) || null) : null,
          target_reps:    firstWeek ? String(firstWeek.reps || '') : '',
          target_charge:  firstWeek ? (parseFloat(firstWeek.charge) || null) : null,
          weeks_data:     ex.weeks || [],
          youtube_url:    savedYoutube[ex.name] || null,
        });
      });
    });

    if (assignments.length > 0) {
      await sb.from('exercise_assignments').insert(assignments);
    }
  }, 800);
}
```

**NEW:**
```js
let _planSaveTimer = null;
function persistTraining() {
  // Capture the student and a deep copy of the plan at EDIT TIME, not at timer-fire time (fixes C7)
  const sid = Ctx.id;
  const snap = {
    weekCount,
    dayCount,
    days: JSON.parse(JSON.stringify(trainingData.days)),
  };
  clearTimeout(_planSaveTimer);
  _planSaveTimer = setTimeout(() => _savePlanToSupabase(sid, snap), 800);
}

async function _savePlanToSupabase(studentId, snapshot) {
  if (typeof sb === 'undefined' || !studentId) return;
  if (!Ctx.isCurrent(snapshot.gen)) return;  // stale: student switched before timer fired

  // Fetch the plan id
  const { data: plan } = await sb
    .from('workout_plans')
    .select('id')
    .eq('student_id', studentId)
    .maybeSingle();
  if (!plan) return;

  // Flatten the exercises for the RPC
  const exercises = [];
  Object.entries(snapshot.days).forEach(([dayNum, day]) => {
    (day.exercises || []).forEach((ex, pos) => {
      exercises.push({
        day: Number(dayNum),
        pos,
        name: ex.name || '',
        tips: ex.tips || '',
        sets: ex.weeks?.[0]?.series || null,
        reps: ex.weeks?.[0]?.reps || '',
        charge: ex.weeks?.[0]?.charge || null,
        weeks: ex.weeks || [],
        video: savedYoutube[ex.name] || null,
      });
    });
  });

  // Call the atomic RPC (update + delete + insert in one transaction)
  const { error } = await sb.rpc('save_student_plan', {
    p_student: studentId,
    p_week_count: snapshot.weekCount,
    p_day_count: snapshot.dayCount,
    p_exercises: exercises,
  });

  if (error) {
    console.error('[plan save]', error.message);
    // Keep the dirty flag: the plan is unsaved, will retry on next timer
  }
}
```

---

## 5. Replace loadStudentData() to add stale-response guards

**In loadStudentData (line 3536), at the START:**
```js
async function loadStudentData(studentId) {
  if (!studentId || typeof sb === 'undefined') return;
  
  // Capture the generation at START so we can drop stale responses (fixes C6)
  const gen = Ctx.gen;
  
  const switchingStudent = Ctx.id !== studentId;
  
  // Update the active student
  Ctx.set(studentId, { persist: true });
  
  // ... rest of the function
```

**After EVERY `await` in loadStudentData, add this check:**
```js
if (!Ctx.isCurrent(gen)) return;  // student switched: drop this response
```

Specifically, after lines:
- 3564 (plan fetch)
- 3592 (metrics fetch)
- 3620 (feedback fetch)
- 3656 (_loadExtraTrainingsFromSupabase)
- 3659 (_loadVoiceFromSupabase)

Example:
```js
  const { data: plan } = await sb
    .from('workout_plans')
    .select('*, exercise_assignments(*)')
    .eq('student_id', studentId)
    .order('position', { foreignTable: 'exercise_assignments' })
    .maybeSingle();

  if (!Ctx.isCurrent(gen)) return;  // <-- ADD THIS

  if (plan) {
    // ... process plan
```

---

## 6. Remove the duplicate saveExerciseLog() from app.js

**DELETE lines 2069-2082** (the entire function definition):
```js
async function saveExerciseLog(studentId, log) {
  if (typeof sb === 'undefined') return;
  await sb.from('exercise_logs').upsert({
    student_id:   studentId,
    exercise_name: log.exercise_name,
    logged_date:   log.logged_date,
    week_number:   log.week_number,
    completed:     log.completed,
    synced_at:     new Date().toISOString(),
  }, { onConflict: 'student_id,exercise_name,logged_date,week_number' });
}
```

The real implementation lives in `offline-sync.js:83` and is loaded later (which is correct).

---

## 7. Fix the two saveExerciseLog CALLS to use the date helper and fix "completed" logic

**Line 1068 area (_syncWmLog):**
```js
// OLD:
saveExerciseLog(activeStudentId(), {
  exercise_name: exName,
  logged_date:   new Date().toISOString().slice(0, 10),
  week_number:   wIdx + 1,
  completed:     field === 'done',
});

// NEW:
saveExerciseLog(activeStudentId(), {
  exercise_name: exName,
  logged_date:   localDate(),
  week_number:   wIdx + 1,
  completed:     String(field).trim() !== '',  // true only if non-empty
});
```

**Line 2057 area (saveWeekField):**
```js
// OLD:
saveExerciseLog(activeStudentId(), {
  exercise_name: exName,
  logged_date:   new Date().toLocaleDateString('sv'),
  week_number:   currentWeek,
  completed:     field === 'done',
});

// NEW:
saveExerciseLog(activeStudentId(), {
  exercise_name: exName,
  logged_date:   localDate(),
  week_number:   currentWeek,
  completed:     String(field).trim() !== '',  // true only if non-empty
});
```

---

## 8. Add SQL RPC to supabase-schema.sql (end of file)

```sql
-- Atomic plan save: update + delete + insert in one transaction
create or replace function public.save_student_plan(
  p_student uuid, 
  p_week_count int, 
  p_day_count int, 
  p_exercises jsonb
)
returns void language plpgsql security invoker as $$
begin
  update public.workout_plans 
    set week_count = p_week_count, 
        day_count = p_day_count, 
        updated_at = now() 
    where student_id = p_student;
  
  delete from public.exercise_assignments 
    where plan_id in (select id from public.workout_plans where student_id = p_student);
  
  insert into public.exercise_assignments 
    (plan_id, day_number, position, name, tips, target_series, target_reps, target_charge, weeks_data, youtube_url)
    select 
      (select id from public.workout_plans where student_id = p_student limit 1),
      (e->>'day')::int,
      (e->>'pos')::int,
      e->>'name',
      e->>'tips',
      (e->>'sets')::int,
      e->>'reps',
      (e->>'charge')::numeric,
      (e->'weeks')::jsonb,
      e->>'video'
    from jsonb_array_elements(p_exercises) e;
end $$;
```

---

## Testing

1. Have a coach logged in with 2 students (A, B).
2. Edit A's plan, wait 800ms (or less) and **quickly switch to B** before the save completes.
3. Check that A's plan and B's plan are both intact (no corruption).
4. Log a day as a student, go offline, and come back online. The log should sync (because offline-sync.js queue is now used).
5. Verify that a logged_date is the same regardless of timezone (midnight tests).
