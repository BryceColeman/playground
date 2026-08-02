// app.js — main controller: navigation, the home/dashboard, the OCR import
// screen, manual people management, the study session, and backups.
import {
  allPeople,
  putPerson,
  getPerson,
  deletePerson,
  allHouseholds,
  ensureHousehold,
  getMeta,
  setMeta,
  uid,
} from './db.js';
import {
  freshSrs,
  freshStats,
  schedule,
  buildQueue,
  counts,
  isMastered,
  isNew,
  Grade,
} from './srs.js';
import { StudySession, fullName } from './study.js';
import {
  loadImageFile,
  sliceGrid,
  getWorker,
  ocrText,
  parseName,
  canvasToBlob,
} from './ocr.js';
import { exportBackup, importBackup } from './backup.js';

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#view');
let activeSession = null;

const NAV = [
  ['home', 'Home'],
  ['study', 'Study'],
  ['import', 'Import'],
  ['people', 'People'],
  ['backup', 'Backup'],
];

function setNav(active) {
  $('#nav').innerHTML = NAV.map(
    ([id, label]) =>
      `<button class="nav-btn ${id === active ? 'active' : ''}" data-nav="${id}">${label}</button>`
  ).join('');
  $('#nav')
    .querySelectorAll('[data-nav]')
    .forEach((b) => (b.onclick = () => route(b.dataset.nav)));
}

function esc(s) {
  return (s || '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

async function route(view) {
  if (activeSession) {
    activeSession.destroy();
    activeSession = null;
  }
  setNav(view);
  if (view === 'home') return renderHome();
  if (view === 'study') return renderStudyStart();
  if (view === 'import') return renderImport();
  if (view === 'people') return renderPeople();
  if (view === 'backup') return renderBackup();
}

// ── Home / dashboard ──
async function renderHome() {
  const people = await allPeople();
  const c = counts(people);
  const streak = await getMeta('streak', 0);
  const best = await getMeta('bestStreak', 0);

  main.innerHTML = `
    <section class="hero">
      <h2>Ward Names</h2>
      <p class="muted">Learn the faces in your ward, one Sunday at a time.</p>
      <div class="streak-pill">🔥 ${streak}-week streak${
        best > streak ? ` · best ${best}` : ''
      }</div>
    </section>
    <div class="stat-grid">
      ${stat('Due now', c.due, 'accent')}
      ${stat('New', c.new)}
      ${stat('Learning', c.learning)}
      ${stat('Known', c.mastered)}
      ${stat('Total', c.total)}
    </div>
    ${
      people.length === 0
        ? `<div class="empty">
             <p>No people yet. Import your directory screenshots to get started.</p>
             <button class="btn-primary" data-nav="import">Import screenshots</button>
           </div>`
        : `<div class="cta">
             <button class="btn-primary big" id="startBtn">
               Start session · ${c.due + Math.min(c.new, 6)} cards
             </button>
             <p class="muted small">Mixes the people you're due to review with a few new faces.</p>
           </div>`
    }`;

  $('[data-nav="import"]', main)?.addEventListener('click', () => route('import'));
  $('#startBtn', main)?.addEventListener('click', () => route('study'));
}

function stat(label, value, cls = '') {
  return `<div class="stat ${cls}"><div class="stat-num">${value}</div><div class="stat-label">${label}</div></div>`;
}

// ── Study ──
async function renderStudyStart() {
  const people = (await allPeople()).filter((p) => fullName(p));
  if (people.length === 0) {
    main.innerHTML = `<div class="empty"><p>Add some people first.</p></div>`;
    return;
  }
  const queue = buildQueue(people, { newLimit: await getMeta('newLimit', 6) });
  if (queue.length === 0) {
    main.innerHTML = `<div class="empty">
      <p>🎉 Nothing due right now — you're all caught up!</p>
      <button class="btn-primary" id="cram">Review anyway</button></div>`;
    $('#cram').onclick = () => runSession(people.slice(0, 20), people, 'mix');
    return;
  }

  main.innerHTML = `
    <section class="mode-pick">
      <h3>Choose a mode</h3>
      <div class="mode-grid">
        ${modeCard('mix', 'Smart Mix', 'Adapts per person: recognise → recall → self-test. Recommended.')}
        ${modeCard('mc', 'Multiple Choice', 'Pick the name from four. Easiest — good for new faces.')}
        ${modeCard('type', 'Type the Name', 'Type from memory. Strongest for retention.')}
        ${modeCard('flash', 'Flashcards', 'Recall, reveal, and grade yourself.')}
      </div>
      <p class="muted small">${queue.length} cards queued.</p>
    </section>`;
  main.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => runSession(queue, people, b.dataset.mode);
  });
}

function modeCard(mode, title, desc) {
  return `<button class="mode-card" data-mode="${mode}">
    <div class="mode-title">${title}</div>
    <div class="mode-desc">${desc}</div></button>`;
}

function runSession(queue, pool, mode) {
  main.innerHTML = `<div id="studyArea"></div>`;
  activeSession = new StudySession({
    container: $('#studyArea'),
    queue,
    pool,
    mode,
    onGrade: async (person, grade) => {
      const fresh = await getPerson(person.id);
      if (!fresh) return;
      fresh.srs = schedule(fresh.srs || freshSrs(), grade);
      fresh.stats = fresh.stats || freshStats();
      fresh.stats.seen += 1;
      if (grade !== Grade.AGAIN) {
        fresh.stats.correct += 1;
        fresh.stats.streak += 1;
        fresh.stats.best = Math.max(fresh.stats.best, fresh.stats.streak);
      } else {
        fresh.stats.streak = 0;
      }
      await putPerson(fresh);
    },
    onComplete: async (summary) => {
      await bumpStreak();
      const pct = summary.total
        ? Math.round((summary.correct / summary.total) * 100)
        : 0;
      main.innerHTML = `<div class="summary">
        <h2>Session complete 🎉</h2>
        <div class="stat-grid">
          ${stat('Cards', summary.total)}
          ${stat('Correct', summary.correct, 'accent')}
          ${stat('Accuracy', pct + '%')}
        </div>
        <button class="btn-primary" id="again">Another round</button>
        <button class="btn-ghost" id="goHome">Done</button>
      </div>`;
      $('#again').onclick = () => route('study');
      $('#goHome').onclick = () => route('home');
    },
  });
  activeSession.start();
}

// A "week streak": increment when the last session was in a previous calendar
// week, reset if a whole week was skipped.
async function bumpStreak() {
  const now = new Date();
  const week = isoWeekKey(now);
  const last = await getMeta('lastWeek', null);
  let streak = await getMeta('streak', 0);
  if (last === week) {
    /* already counted this week */
  } else if (last === isoWeekKey(new Date(now - 7 * 86400000))) {
    streak += 1;
  } else {
    streak = 1;
  }
  await setMeta('lastWeek', week);
  await setMeta('streak', streak);
  await setMeta('bestStreak', Math.max(streak, await getMeta('bestStreak', 0)));
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

// ── Import (OCR) ──
let importImages = []; // {img, name}
let reviewCards = []; // {photoCanvas, firstName, lastName, household, include}

async function renderImport() {
  importImages = [];
  reviewCards = [];
  main.innerHTML = `
    <section class="import">
      <h3>Import</h3>
      <div class="import-tabs">
        <button class="tab active" data-tab="named">📁 From photo files</button>
        <button class="tab" data-tab="ocr">🖼️ From screenshots (OCR)</button>
      </div>
      <div id="tab-named"></div>
      <div id="tab-ocr" class="hidden"></div>
    </section>`;
  const tabs = main.querySelectorAll('.tab');
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      $('#tab-named').classList.toggle('hidden', t.dataset.tab !== 'named');
      $('#tab-ocr').classList.toggle('hidden', t.dataset.tab !== 'ocr');
    };
  });
  renderNamedTab();
  renderOcrTab();
}

// ── Import: named photo files (the bookmarklet's ZIP, unzipped) ──
// Turn a file name into a name guess. Handles the two formats the grabber
// produces: "Erik Alvarez" (a person) and "Alvarez, Erik & Jenna" (a family).
function parseFilename(filename) {
  const base = filename
    .replace(/\.[^.]+$/, '') // extension
    .replace(/\s*\(\d+\)$/, '') // " (2)" de-dupe suffix
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (base.includes(',')) {
    const last = base.slice(0, base.indexOf(',')).trim();
    const rest = base.slice(base.indexOf(',') + 1).trim();
    return { firstName: rest, lastName: last, household: last, family: true };
  }
  const parts = base.split(' ').filter(Boolean);
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const firstName =
    parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
  return { firstName, lastName, household: lastName, family: false };
}

let namedCards = []; // {blob, firstName, lastName, household, include, family}

function renderNamedTab() {
  const host = $('#tab-named');
  host.innerHTML = `
    <p class="muted small">Unzip <code>ward-photos.zip</code> from the bookmarklet,
      then pick all the images below. Each file name becomes the person's name —
      no typing, no OCR. Review and save.</p>
    <input type="file" id="namedFiles" accept="image/*" multiple>
    <label class="block small"><input type="checkbox" id="incFamily"> also include family group photos</label>
    <div id="namedReview"></div>`;
  namedCards = [];
  $('#namedFiles').onchange = (e) => {
    namedCards = [...e.target.files]
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({ blob: f, ...parseFilename(f.name) }))
      .map((c) => ({ ...c, include: !c.family }));
    $('#incFamily').checked = false;
    renderNamedReview();
  };
  $('#incFamily').onchange = (e) => {
    namedCards.forEach((c) => {
      if (c.family) c.include = e.target.checked;
    });
    renderNamedReview();
  };
}

function renderNamedReview() {
  const wrap = $('#namedReview');
  if (!namedCards.length) {
    wrap.innerHTML = '';
    return;
  }
  const n = namedCards.filter((c) => c.include).length;
  wrap.innerHTML = `
    <div class="review-head">
      <h4>Review &amp; save</h4>
      <button class="btn-primary" id="saveNamed" ${n ? '' : 'disabled'}>Save ${n}</button>
    </div>
    <div class="review-grid"></div>`;
  const grid = $('.review-grid', wrap);
  namedCards.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'review-card' + (card.include ? '' : ' dimmed');
    div.innerHTML = `
      <label class="incl"><input type="checkbox" ${card.include ? 'checked' : ''} data-incl="${i}"> use${card.family ? ' (family)' : ''}</label>
      <div class="thumb"></div>
      <input class="ri" data-field="firstName" data-i="${i}" placeholder="First" value="${esc(card.firstName)}">
      <input class="ri" data-field="lastName" data-i="${i}" placeholder="Last" value="${esc(card.lastName)}">
      <input class="ri" data-field="household" data-i="${i}" placeholder="Household" value="${esc(card.household)}">`;
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = URL.createObjectURL(card.blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    $('.thumb', div).appendChild(img);
    grid.appendChild(div);
  });
  grid.querySelectorAll('.ri').forEach((inp) => {
    inp.oninput = () => {
      namedCards[inp.dataset.i][inp.dataset.field] = inp.value;
    };
  });
  grid.querySelectorAll('[data-incl]').forEach((cb) => {
    cb.onchange = () => {
      namedCards[cb.dataset.incl].include = cb.checked;
      renderNamedReview();
    };
  });
  $('#saveNamed').onclick = saveNamed;
}

async function saveNamed() {
  const chosen = namedCards.filter(
    (c) => c.include && (c.firstName || c.lastName)
  );
  let saved = 0;
  for (const c of chosen) {
    const householdId = await ensureHousehold(c.household);
    await putPerson({
      id: uid(),
      firstName: (c.firstName || '').trim(),
      lastName: (c.lastName || '').trim(),
      householdId,
      photo: c.blob,
      notes: '',
      srs: freshSrs(),
      stats: freshStats(),
      createdAt: Date.now(),
    });
    saved++;
  }
  $('#namedReview').innerHTML = `<div class="empty">
    <p>✓ Saved ${saved} ${saved === 1 ? 'person' : 'people'}. Ready to study!</p>
    <button class="btn-primary" id="toStudyNamed">Start studying</button></div>`;
  $('#toStudyNamed').onclick = () => route('study');
}

// ── Import: screenshots via OCR ──
function renderOcrTab() {
  const host = $('#tab-ocr');
  host.innerHTML = `
      <p class="muted small">Screenshots stay on your device. Pick one or more,
        line up the grid to the cards, then run OCR. You'll review every name
        before it's saved.</p>
      <input type="file" id="files" accept="image/*" multiple>
      <div id="gridControls" class="hidden">
        <div class="controls-row">
          ${num('rows', 'Rows', 4)} ${num('cols', 'Columns', 2)}
        </div>
        <div class="controls-row">
          <label>Name band <input type="range" id="textBand" min="0.12" max="0.5" step="0.02" value="0.28"></label>
          <label>Gutter <input type="range" id="margin" min="0" max="0.15" step="0.01" value="0.04"></label>
        </div>
        <canvas id="preview" class="preview"></canvas>
        <button class="btn-primary" id="runOcr">Run OCR</button>
        <div id="ocrProgress" class="muted small"></div>
      </div>
      <div id="review"></div>`;

  $('#files').onchange = async (e) => {
    importImages = [];
    for (const f of e.target.files) {
      try {
        importImages.push({ img: await loadImageFile(f), name: f.name });
      } catch {
        /* skip unreadable */
      }
    }
    if (importImages.length) {
      $('#gridControls').classList.remove('hidden');
      drawPreview();
    }
  };

  ['rows', 'cols', 'textBand', 'margin'].forEach((id) => {
    const el = $('#' + id);
    if (el) el.oninput = drawPreview;
  });
  $('#runOcr').onclick = runImportOcr;
}

function num(id, label, val) {
  return `<label>${label} <input type="number" id="${id}" min="1" max="12" value="${val}"></label>`;
}

function gridOpts() {
  const m = parseFloat($('#margin').value);
  return {
    rows: Math.max(1, parseInt($('#rows').value || '1', 10)),
    cols: Math.max(1, parseInt($('#cols').value || '1', 10)),
    textBand: parseFloat($('#textBand').value),
    marginX: m,
    marginY: m,
  };
}

function drawPreview() {
  const { img } = importImages[0];
  const { rows, cols, textBand, marginX } = gridOpts();
  const cv = $('#preview');
  const scale = Math.min(1, 640 / img.width);
  cv.width = img.width * scale;
  cv.height = img.height * scale;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const cw = cv.width / cols,
    ch = cv.height / rows;
  ctx.lineWidth = 2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * marginX,
        y = r * ch + ch * marginX;
      const w = cw - 2 * cw * marginX,
        h = ch - 2 * ch * marginX;
      ctx.strokeStyle = '#6C5CE7';
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = '#74b9ff';
      const ty = y + h * (1 - textBand);
      ctx.beginPath();
      ctx.moveTo(x, ty);
      ctx.lineTo(x + w, ty);
      ctx.stroke();
    }
}

async function runImportOcr() {
  const prog = $('#ocrProgress');
  prog.textContent = 'Starting OCR engine…';
  let worker;
  try {
    worker = await getWorker();
  } catch (err) {
    prog.textContent = '⚠ ' + err.message;
    return;
  }
  reviewCards = [];
  const opts = gridOpts();
  let done = 0;
  const cells = importImages.flatMap(({ img }) => sliceGrid(img, opts));
  for (const cell of cells) {
    prog.textContent = `Reading ${++done} / ${cells.length}…`;
    let parsed = { firstName: '', lastName: '', raw: '' };
    try {
      parsed = parseName(await ocrText(cell.text, worker));
    } catch {
      /* leave blank for manual entry */
    }
    reviewCards.push({
      photoCanvas: cell.photo,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      raw: parsed.raw,
      household: parsed.lastName,
      include: !!(parsed.firstName || parsed.lastName),
    });
  }
  prog.textContent = `Done — review ${reviewCards.length} cards below, fix any typos, then save.`;
  renderReview();
}

function renderReview() {
  const wrap = $('#review');
  wrap.innerHTML = `
    <div class="review-head">
      <h4>Review &amp; correct</h4>
      <button class="btn-primary" id="saveAll">Save selected</button>
    </div>
    <div class="review-grid"></div>`;
  const grid = $('.review-grid', wrap);

  reviewCards.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'review-card';
    div.innerHTML = `
      <label class="incl"><input type="checkbox" ${card.include ? 'checked' : ''} data-incl="${i}"> use</label>
      <div class="thumb"></div>
      <input class="ri" data-field="firstName" data-i="${i}" placeholder="First" value="${esc(card.firstName)}">
      <input class="ri" data-field="lastName" data-i="${i}" placeholder="Last" value="${esc(card.lastName)}">
      <input class="ri" data-field="household" data-i="${i}" placeholder="Household" value="${esc(card.household)}">
      <div class="raw">${card.raw ? 'OCR: ' + esc(card.raw) : 'no text read'}</div>`;
    $('.thumb', div).appendChild(card.photoCanvas);
    card.photoCanvas.className = 'thumb-img';
    grid.appendChild(div);
  });

  grid.querySelectorAll('.ri').forEach((inp) => {
    inp.oninput = () => {
      reviewCards[inp.dataset.i][inp.dataset.field] = inp.value;
    };
  });
  grid.querySelectorAll('[data-incl]').forEach((cb) => {
    cb.onchange = () => {
      reviewCards[cb.dataset.incl].include = cb.checked;
    };
  });
  $('#saveAll').onclick = saveReview;
}

async function saveReview() {
  const chosen = reviewCards.filter(
    (c) => c.include && (c.firstName || c.lastName)
  );
  let saved = 0;
  for (const c of chosen) {
    const householdId = await ensureHousehold(c.household);
    const photo = await canvasToBlob(c.photoCanvas);
    await putPerson({
      id: uid(),
      firstName: c.firstName.trim(),
      lastName: c.lastName.trim(),
      householdId,
      photo,
      notes: '',
      srs: freshSrs(),
      stats: freshStats(),
      createdAt: Date.now(),
    });
    saved++;
  }
  $('#review').innerHTML = `<div class="empty">
    <p>✓ Saved ${saved} ${saved === 1 ? 'person' : 'people'}.</p>
    <button class="btn-primary" id="toStudy">Start studying</button></div>`;
  $('#toStudy').onclick = () => route('study');
}

// ── People management ──
async function renderPeople() {
  const [people, households] = await Promise.all([
    allPeople(),
    allHouseholds(),
  ]);
  const hmap = Object.fromEntries(households.map((h) => [h.id, h.name]));
  people.sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || '') ||
    (a.firstName || '').localeCompare(b.firstName || '')
  );

  main.innerHTML = `
    <section class="people">
      <div class="review-head">
        <h3>People (${people.length})</h3>
        <button class="btn-primary" id="addBtn">+ Add</button>
      </div>
      <div id="peopleList" class="people-list"></div>
    </section>`;
  $('#addBtn').onclick = () => openEditor(null);

  const list = $('#peopleList');
  if (!people.length) {
    list.innerHTML = `<p class="muted">No one yet — import or add someone.</p>`;
    return;
  }
  people.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    const status = isNew(p) ? 'new' : isMastered(p) ? 'known' : 'learning';
    row.innerHTML = `
      <div class="avatar" data-id="${p.id}"></div>
      <div class="pr-main">
        <div class="pr-name">${esc(fullName(p)) || '(no name)'}</div>
        <div class="pr-sub muted small">${esc(hmap[p.householdId] || '')} · <span class="tag ${status}">${status}</span></div>
      </div>
      <button class="btn-ghost sm" data-edit="${p.id}">Edit</button>`;
    if (p.photo instanceof Blob) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(p.photo);
      img.className = 'avatar-img';
      img.onload = () => URL.revokeObjectURL(img.src);
      $('.avatar', row).appendChild(img);
    } else {
      $('.avatar', row).textContent = (p.firstName || '?')[0].toUpperCase();
    }
    $('[data-edit]', row).onclick = () => openEditor(p);
    list.appendChild(row);
  });
}

async function openEditor(person) {
  const households = await allHouseholds();
  const p = person || {};
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${person ? 'Edit person' : 'Add person'}</h3>
      <label>First <input id="ef" value="${esc(p.firstName || '')}"></label>
      <label>Last <input id="el" value="${esc(p.lastName || '')}"></label>
      <label>Household <input id="eh" list="hlist" value="${esc(
        households.find((h) => h.id === p.householdId)?.name || ''
      )}"></label>
      <datalist id="hlist">${households
        .map((h) => `<option value="${esc(h.name)}">`)
        .join('')}</datalist>
      <label>Mnemonic note <input id="en" placeholder="e.g. tall, red beard, sits in back" value="${esc(
        p.notes || ''
      )}"></label>
      <label>Photo <input id="ep" type="file" accept="image/*"></label>
      <div class="modal-actions">
        ${person ? '<button class="btn-ghost danger" id="del">Delete</button>' : ''}
        <button class="btn-ghost" id="cancel">Cancel</button>
        <button class="btn-primary" id="save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  $('#cancel', overlay).onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  if (person)
    $('#del', overlay).onclick = async () => {
      await deletePerson(person.id);
      close();
      renderPeople();
    };

  $('#save', overlay).onclick = async () => {
    const file = $('#ep', overlay).files[0];
    let photo = p.photo || null;
    if (file) photo = file;
    const householdId = await ensureHousehold($('#eh', overlay).value);
    await putPerson({
      id: p.id || uid(),
      firstName: $('#ef', overlay).value.trim(),
      lastName: $('#el', overlay).value.trim(),
      householdId,
      notes: $('#en', overlay).value.trim(),
      photo,
      srs: p.srs || freshSrs(),
      stats: p.stats || freshStats(),
      createdAt: p.createdAt || Date.now(),
    });
    close();
    renderPeople();
  };
}

// ── Backup ──
async function renderBackup() {
  const newLimit = await getMeta('newLimit', 6);
  main.innerHTML = `
    <section class="backup">
      <h3>Settings &amp; backup</h3>
      <label class="block">New people per session
        <input type="number" id="newLimit" min="1" max="30" value="${newLimit}">
      </label>
      <p class="muted small">How many never-seen faces to introduce each session.</p>
      <hr>
      <p class="muted small">Your data lives only in this browser. Export a backup
        regularly so you don't lose it, and to move to another device.</p>
      <div class="controls-row">
        <button class="btn-primary" id="export">Export backup</button>
        <label class="btn-ghost file-label">Import backup
          <input type="file" id="import" accept="application/json" hidden>
        </label>
      </div>
      <label class="block"><input type="checkbox" id="replace"> Replace existing data on import</label>
      <div id="backupMsg" class="muted small"></div>
    </section>`;

  $('#newLimit').onchange = (e) =>
    setMeta('newLimit', Math.max(1, parseInt(e.target.value, 10) || 6));
  $('#export').onclick = () => exportBackup();
  $('#import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await importBackup(file, { replace: $('#replace').checked });
      $('#backupMsg').textContent = `✓ Imported ${r.people} people.`;
    } catch (err) {
      $('#backupMsg').textContent = '⚠ ' + err.message;
    }
  };
}

// ── boot ──
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
route('home');
