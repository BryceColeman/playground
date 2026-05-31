// srs.js — spaced-repetition engine (SM-2 variant). This is the brain of the
// "quiz myself each Sunday" loop: it decides who you review and when, pushing
// well-known faces further out and resurfacing weak ones.

export const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
export const MASTERED_INTERVAL_DAYS = 21; // "known" once intervals get this long

// Grades fed to the scheduler. Auto-graded modes (multiple choice, typing) use
// AGAIN / GOOD; flashcard self-grading can use all four.
export const Grade = { AGAIN: 'again', HARD: 'hard', GOOD: 'good', EASY: 'easy' };

export function freshSrs(now = Date.now()) {
  return {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueDate: now, // brand-new people are due immediately
  };
}

export function freshStats() {
  return { seen: 0, correct: 0, streak: 0, best: 0 };
}

// Pure function: given the current srs state and a grade, return the next state.
export function schedule(srs, grade, now = Date.now()) {
  const s = { ...srs };

  if (grade === Grade.AGAIN) {
    s.lapses += 1;
    s.reps = 0;
    s.ease = Math.max(MIN_EASE, s.ease - 0.2);
    s.intervalDays = 0;
    // See it again in this same session (≈10 min), still "due today".
    s.dueDate = now + 10 * 60 * 1000;
    return s;
  }

  // Correct-ish answer.
  s.reps += 1;
  if (s.reps === 1) s.intervalDays = 1;
  else if (s.reps === 2) s.intervalDays = 3;
  else s.intervalDays = Math.round(s.intervalDays * s.ease);

  // Ease nudges per SM-2.
  if (grade === Grade.HARD) {
    s.ease = Math.max(MIN_EASE, s.ease - 0.15);
    s.intervalDays = Math.max(1, Math.round(s.intervalDays * 0.7));
  } else if (grade === Grade.EASY) {
    s.ease += 0.15;
    s.intervalDays = Math.round(s.intervalDays * 1.3);
  }

  s.dueDate = now + s.intervalDays * DAY_MS;
  return s;
}

export const isDue = (p, now = Date.now()) => (p.srs?.dueDate ?? 0) <= now;
export const isNew = (p) => (p.srs?.reps ?? 0) === 0;
export const isMastered = (p) =>
  (p.srs?.intervalDays ?? 0) >= MASTERED_INTERVAL_DAYS;

// Build a study queue for a session.
//   - Up to `newLimit` brand-new people (gentle onboarding — don't dump all at
//     once), then every due person.
//   - Interleaved so households are mixed rather than blocked (better recall).
export function buildQueue(people, { newLimit = 6, now = Date.now() } = {}) {
  const due = people.filter((p) => !isNew(p) && isDue(p, now));
  const fresh = people.filter((p) => isNew(p)).slice(0, newLimit);
  const queue = shuffle([...due, ...fresh]);
  return interleaveByHousehold(queue);
}

export function counts(people, now = Date.now()) {
  let neu = 0,
    learning = 0,
    mastered = 0,
    due = 0;
  for (const p of people) {
    if (isNew(p)) neu++;
    else if (isMastered(p)) mastered++;
    else learning++;
    if (!isNew(p) && isDue(p, now)) due++;
  }
  return { total: people.length, new: neu, learning, mastered, due };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Spread people from the same household apart in the queue.
function interleaveByHousehold(queue) {
  const buckets = new Map();
  for (const p of queue) {
    const k = p.householdId || p.id;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const lists = [...buckets.values()];
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of lists) {
      const next = list.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}
