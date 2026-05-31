// study.js — the three study modes and the session runner.
//   • mc    multiple choice (recognition) — easiest, good for new faces
//   • type  type-the-name (active recall) — strongest for retention
//   • flash photo→name flashcard with self-grading
//   • mix   "smart mix": graduates each person mc → type → flash as they improve
import { Grade } from './srs.js';

export const fullName = (p) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ').trim();

// ── answer matching for type mode ──
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Accept exact-ish full name, or just the correct first name (forgiving of
// spelling so a near-miss still counts).
export function matchesName(typed, person) {
  const t = normalize(typed);
  if (!t) return false;
  const first = normalize(person.firstName);
  const full = normalize(fullName(person));
  if (t === first || t === full) return true;
  if (first && levenshtein(t, first) <= 1) return true;
  if (full && levenshtein(t, full) <= 2) return true;
  return false;
}

// Three distractors for multiple choice, preferring same-household names so the
// choice is meaningfully hard, then filling from the rest of the ward.
export function pickDistractors(person, pool, n = 3) {
  const others = pool.filter((p) => p.id !== person.id && fullName(p));
  const same = shuffle(others.filter((p) => p.householdId === person.householdId));
  const rest = shuffle(others.filter((p) => p.householdId !== person.householdId));
  const seen = new Set();
  const out = [];
  for (const p of [...same, ...rest]) {
    const name = fullName(p);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

function modeFor(person, preferred) {
  if (preferred && preferred !== 'mix') return preferred;
  const reps = person.srs?.reps ?? 0;
  if (reps <= 0) return 'mc';
  if (reps <= 2) return 'type';
  return 'flash';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Session runner ──
// container: element to render into
// queue: array of people
// mode: 'mc' | 'type' | 'flash' | 'mix'
// pool: all named people (for distractors)
// onGrade(person, grade, correct), onComplete(summary)
export class StudySession {
  constructor({ container, queue, mode, pool, onGrade, onComplete }) {
    this.el = container;
    this.queue = queue;
    this.mode = mode;
    this.pool = pool;
    this.onGrade = onGrade || (() => {});
    this.onComplete = onComplete || (() => {});
    this.i = 0;
    this.right = 0;
    this.objectUrl = null;
  }

  start() {
    this.i = 0;
    this.right = 0;
    this.next();
  }

  _revoke() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  next() {
    this._revoke();
    if (this.i >= this.queue.length) {
      this.onComplete({ total: this.queue.length, correct: this.right });
      return;
    }
    const person = this.queue[this.i];
    const mode = modeFor(person, this.mode);
    const progress = `${this.i + 1} / ${this.queue.length}`;
    if (mode === 'mc') this._renderMC(person, progress);
    else if (mode === 'type') this._renderType(person, progress);
    else this._renderFlash(person, progress);
  }

  _photo(person) {
    if (person.photo instanceof Blob) {
      this.objectUrl = URL.createObjectURL(person.photo);
      return `<img class="study-photo" src="${this.objectUrl}" alt="photo">`;
    }
    const initial = (person.firstName || '?')[0].toUpperCase();
    return `<div class="study-photo placeholder">${initial}</div>`;
  }

  _shell(progress, body) {
    this.el.innerHTML = `
      <div class="study-card">
        <div class="study-progress">${progress}</div>
        ${body}
      </div>`;
  }

  _advance(person, grade, correct) {
    if (correct) this.right++;
    this.onGrade(person, grade, correct);
    this.i++;
    this.next();
  }

  _renderMC(person, progress) {
    const distractors = pickDistractors(person, this.pool, 3);
    const options = shuffle([person, ...distractors]);
    this._shell(
      progress,
      `${this._photo(person)}
       <div class="study-prompt">Who is this?</div>
       <div class="mc-options"></div>`
    );
    const wrap = this.el.querySelector('.mc-options');
    options.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      b.textContent = fullName(opt);
      b.onclick = () => {
        const correct = opt.id === person.id;
        [...wrap.children].forEach((c) => (c.disabled = true));
        b.classList.add(correct ? 'right' : 'wrong');
        if (!correct) {
          [...wrap.children]
            .find((c) => c.textContent === fullName(person))
            ?.classList.add('right');
        }
        this._feedback(correct, person, () =>
          this._advance(person, correct ? Grade.GOOD : Grade.AGAIN, correct)
        );
      };
      wrap.appendChild(b);
    });
  }

  _renderType(person, progress) {
    this._shell(
      progress,
      `${this._photo(person)}
       <div class="study-prompt">Type this person's name</div>
       <input class="type-input" type="text" autocomplete="off"
              autocapitalize="words" placeholder="Name…">
       <button class="btn-primary type-submit">Check</button>`
    );
    const input = this.el.querySelector('.type-input');
    const submit = this.el.querySelector('.type-submit');
    input.focus();
    const check = () => {
      const correct = matchesName(input.value, person);
      input.classList.add(correct ? 'right' : 'wrong');
      input.disabled = true;
      submit.disabled = true;
      this._feedback(correct, person, () =>
        this._advance(person, correct ? Grade.GOOD : Grade.AGAIN, correct)
      );
    };
    submit.onclick = check;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') check();
    };
  }

  _renderFlash(person, progress) {
    this._shell(
      progress,
      `${this._photo(person)}
       <div class="study-prompt">Recall the name, then reveal.</div>
       <div class="flash-answer hidden">${fullName(person)}</div>
       <button class="btn-primary flash-reveal">Reveal</button>
       <div class="grade-row hidden">
         <button class="grade-btn again">Again</button>
         <button class="grade-btn hard">Hard</button>
         <button class="grade-btn good">Good</button>
         <button class="grade-btn easy">Easy</button>
       </div>`
    );
    const reveal = this.el.querySelector('.flash-reveal');
    reveal.onclick = () => {
      this.el.querySelector('.flash-answer').classList.remove('hidden');
      this.el.querySelector('.grade-row').classList.remove('hidden');
      reveal.classList.add('hidden');
    };
    const map = {
      again: Grade.AGAIN,
      hard: Grade.HARD,
      good: Grade.GOOD,
      easy: Grade.EASY,
    };
    this.el.querySelectorAll('.grade-btn').forEach((b) => {
      b.onclick = () => {
        const grade = map[[...b.classList].find((c) => map[c])];
        this._advance(person, grade, grade !== Grade.AGAIN);
      };
    });
  }

  _feedback(correct, person, done) {
    const card = this.el.querySelector('.study-card');
    const fb = document.createElement('div');
    fb.className = `feedback ${correct ? 'ok' : 'no'}`;
    fb.innerHTML = correct
      ? '✓ Correct'
      : `✗ <strong>${fullName(person)}</strong>${
          person.notes ? ` — <em>${person.notes}</em>` : ''
        }`;
    card.appendChild(fb);
    const cont = document.createElement('button');
    cont.className = 'btn-primary continue-btn';
    cont.textContent = 'Continue';
    cont.onclick = done;
    card.appendChild(cont);
    cont.focus();
  }

  destroy() {
    this._revoke();
  }
}
