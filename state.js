// ============================================================
// state.js — Single store for active student + generation token
// Prevents stale responses after a student switch (C6/C7)
// Load this BEFORE auth.js
// ============================================================

const Ctx = (() => {
  let studentId = null;
  let generation = 0;
  const subscribers = new Set();

  return {
    get id() { return studentId; },
    get gen() { return generation; },

    // Check if a generation token is still current (dropped after a switch)
    isCurrent(g) { return g === generation; },

    // Set the active student and bump the generation token
    set(id, { persist = true } = {}) {
      if (id === studentId) return;  // no change
      studentId = id;
      generation++;
      if (persist && typeof sessionStorage !== 'undefined') {
        if (id) sessionStorage.setItem('mf_activeStudent', id);
        else sessionStorage.removeItem('mf_activeStudent');
      }
      subscribers.forEach(fn => fn(id, generation));
    },

    // Restore the selected student from sessionStorage, validated against the list
    restore(validIds) {
      if (typeof sessionStorage === 'undefined') return validIds?.[0] ?? null;
      const stored = sessionStorage.getItem('mf_activeStudent');
      return stored && validIds?.includes(stored) ? stored : validIds?.[0] ?? null;
    },

    // Subscribe to changes: fn(newId, newGeneration)
    onChange(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // Clear everything (on sign-out)
    clear() {
      studentId = null;
      generation++;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('mf_activeStudent');
      }
      subscribers.forEach(fn => fn(null, generation));
    },
  };
})();
