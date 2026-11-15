import { configured, signIn, signOutUser, watchUser, sendLink, finishLink } from './firebase.js';
import {
  isMember, listRecipes, getRecipe, cookedHistory, getHistory, setRating, addNote, deleteNote, saveRecipes, deleteRecipe,
} from './store.js';
import { star, starsShow, ICON, toast } from './ui.js';
import { isWantToTry } from './planner.js';
import { showPlan } from './plan-view.js';
import {
  esc, ingredientHTML, ingredientPlain, stepHTML, stepPlain, stepIngredientIds, minutes, niceDate,
} from './format.js';
import { SAMPLE_RECIPES } from '../data/sample-recipes.js';

const app = document.getElementById('app');
const cookEl = document.getElementById('cook');
// ---------- small helpers ----------

function totalTime(r) { return minutes((r.prepMin || 0) + (r.cookMin || 0)); }

// ---------- routing ----------

function setNav(page) {
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === page));
}

let signedIn = false;

async function route() {
  if (!signedIn) return;
  const [page, id, extra] = location.hash.replace(/^#\/?/, '').split('/');
  closeCook();
  window.scrollTo(0, 0);
  if (page === 'recipe' && id) { setNav('recipes'); return showRecipe(decodeURIComponent(id), Number(extra) || null); }
  if (page === 'add') { setNav('recipes'); return showAdd(); }
  if (page === 'plan') { setNav('plan'); return showPlan(app, id); }
  if (page === 'grocery') { setNav('grocery'); return showSoon('Grocery run', 'Build a list from the next seven days, check off what you already have, and copy the rest into Google Keep.'); }
  setNav('recipes');
  return showLibrary();
}

window.addEventListener('hashchange', route);

window.addEventListener('unhandledrejection', e => {
  console.error(e.reason);
  toast('Something went wrong. Check your connection and try again.');
});

// ---------- sign-in ----------

const footer = document.getElementById('foot');

function showSplash(message = '') {
  signedIn = false;
  document.body.classList.add('signed-out');
  footer.hidden = true;
  app.innerHTML = `
    <section class="splash">
      <p class="splash-kicker">The Staub family</p>
      <h1>Meals</h1>
      <p class="sub">Our favorite dinner recipes, monthly plan and grocery list.</p>
      ${message ? `<p class="splash-msg">${message}</p>` : ''}
      ${configured ? `
        <button class="btn primary big" id="signInBtn" type="button">Sign in with Google</button>
        <div class="or"><span>or</span></div>
        <form id="linkForm" class="link-form">
          <label for="linkEmail">Get a sign-in link by email</label>
          <div class="link-row">
            <input id="linkEmail" type="email" required autocomplete="email" placeholder="you@gmail.com">
            <button class="btn" type="submit">Email me a link</button>
          </div>
        </form>` : '<p class="splash-msg">Sign-in isn\'t set up yet.</p>'}
    </section>`;
  app.querySelector('#signInBtn')?.addEventListener('click', async () => {
    try {
      await signIn();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error(err);
        toast('Google sign-in didn\'t work here. Try the email link instead.');
      }
    }
  });
  app.querySelector('#linkForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = app.querySelector('#linkEmail').value.trim().toLowerCase();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await sendLink(email);
      e.target.outerHTML = `<p class="splash-msg">Check <strong>${esc(email)}</strong> for an email with a sign-in link. Open the link on this same device. If it isn't there in a minute, check spam.</p>`;
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Couldn\'t send the email. Check the address and try again.');
    }
  });
}

if (!configured) {
  showSplash();
} else {
  finishLink().catch(err => {
    console.error(err);
    showSplash('That sign-in link didn\'t work. It may have expired or already been used. Ask for a new one below.');
  });
  watchUser(async user => {
    if (!user) return showSplash();
    if (!(await isMember(user.email))) {
      await signOutUser();
      return showSplash(`${esc(user.email)} isn't on this site's list. Sign in with a different Google account.`);
    }
    signedIn = true;
    document.body.classList.remove('signed-out');
    footer.hidden = false;
    footer.querySelector('.who').textContent = `Signed in as ${user.displayName || user.email}`;
    route();
  });
  footer.querySelector('button').addEventListener('click', () => signOutUser());
}

// ---------- recipe library ----------

async function showLibrary() {
  const [recipes, history] = await Promise.all([listRecipes(), getHistory()]);
  const histories = Object.fromEntries(recipes.map(r => [r.id, history[r.id] ?? { count: 0, last: null }]));

  app.innerHTML = `
    <section class="page">
      <div class="page-head">
        <div>
          <h1>Our recipes</h1>
          <p class="sub">${recipes.length} recipe${recipes.length === 1 ? '' : 's'}</p>
        </div>
        <a class="btn" href="#/add">Add recipes</a>
      </div>
      ${recipes.length ? `
        <label class="search">${ICON.search}<input id="q" type="search" placeholder="Search by name, protein or ingredient" autocomplete="off"></label>
        <div class="grid" id="grid"></div>` : `
        <div class="empty-box">
          <h2>No recipes yet</h2>
          <p>Send Claude a recipe link or a Pinterest board, then add the recipes file it gives you.</p>
          <a class="btn primary" href="#/add">Add recipes</a>
        </div>`}
    </section>`;

  if (!recipes.length) return;
  const grid = app.querySelector('#grid');
  const draw = q => {
    const needle = q.trim().toLowerCase();
    const shown = recipes.filter(r => !needle || [r.title, r.protein, ...r.tags, ...r.ingredients.map(i => i.item)]
      .join(' ').toLowerCase().includes(needle));
    grid.innerHTML = shown.length ? shown.map(r => {
      const h = histories[r.id];
      return `
        <a class="card" href="#/recipe/${encodeURIComponent(r.id)}">
          <div class="chips">
            <span class="chip protein">${esc(r.protein)}</span>
            ${isWantToTry(r, history) ? '<span class="chip try">Want to try</span>' : ''}
          </div>
          <h2>${esc(r.title)}</h2>
          <p>${esc(r.description)}</p>
          <div class="card-meta">
            ${starsShow(r.rating)}
            <span class="meta-item">${ICON.clock}${totalTime(r)}</span>
            ${h.count ? `<span class="meta-item">Made ${h.count}×</span>` : ''}
          </div>
        </a>`;
    }).join('') : '<p class="empty">No recipes match that search.</p>';
  };
  draw('');
  app.querySelector('#q').addEventListener('input', e => draw(e.target.value));
}

// ---------- single recipe ----------

async function showRecipe(id, plannedServings) {
  const r = await getRecipe(id);
  if (!r) {
    app.innerHTML = `<section class="page"><h1>Recipe not found</h1><p><a href="#/">Back to all recipes</a></p></section>`;
    return;
  }
  const history = await cookedHistory(id);
  const byId = Object.fromEntries(r.ingredients.map(i => [i.id, i]));
  let servings = plannedServings || r.servings;
  const scale = () => servings / r.servings;
  const n = r.nutrition;

  app.innerHTML = `
    <article class="recipe">
      <a class="back no-print" href="#/">${ICON.back}All recipes</a>

      <header class="recipe-head">
        <div class="chips">
          <span class="chip protein">${esc(r.protein)}</span>
          ${r.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}
        </div>
        <h1>${esc(r.title)}</h1>
        <p class="lede">${esc(r.description)}</p>
        <dl class="times">
          ${r.prepMin ? `<div><dt>Prep</dt><dd>${minutes(r.prepMin)}</dd></div>` : ''}
          ${r.cookMin ? `<div><dt>Cook</dt><dd>${minutes(r.cookMin)}</dd></div>` : ''}
          <div><dt>Total</dt><dd>${totalTime(r)}</dd></div>
          <div class="print-only"><dt>Serves</dt><dd class="serves-print">${servings}</dd></div>
        </dl>
        <div class="rate-row no-print">
          <div class="rate" role="group" aria-label="Rate this recipe">
            ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" aria-label="Rate ${i} star${i > 1 ? 's' : ''}">${star(i <= r.rating)}</button>`).join('')}
          </div>
          <span class="history">${history.count
            ? `Made ${history.count} time${history.count > 1 ? 's' : ''} · last ${niceDate(history.last)}`
            : r.rating ? 'Not on the calendar yet' : 'Not made yet · on your Want to try list'}</span>
        </div>
        <div class="actions no-print">
          <button class="btn primary" id="cookBtn" type="button">Start cooking</button>
          <button class="btn" id="shareBtn" type="button">Share by text</button>
          <button class="btn" id="printBtn" type="button">Print</button>
        </div>
      </header>

      <div class="recipe-body">
        <aside class="ingredients">
          <div class="ing-head">
            <h2>Ingredients</h2>
            <div class="servings no-print" role="group" aria-label="Servings">
              <button type="button" class="step-btn" data-serv="-1" aria-label="Fewer servings">&minus;</button>
              <span><strong id="servCount">${servings}</strong> servings</span>
              <button type="button" class="step-btn" data-serv="1" aria-label="More servings">+</button>
            </div>
          </div>
          <ul class="ing-list" id="ingList"></ul>
        </aside>

        <section class="method">
          <h2>Steps</h2>
          <ol class="steps" id="stepList"></ol>
          ${r.tips?.length ? `
            <div class="tips">
              <h3>Tips</h3>
              <ul>${r.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
            </div>` : ''}
        </section>
      </div>

      ${n ? `
        <section class="nutrition">
          <h2>Nutrition <span class="per">per serving</span></h2>
          <dl class="nut-grid">
            ${[['Calories', n.calories, ''], ['Protein', n.protein, 'g'], ['Carbs', n.carbs, 'g'], ['Fat', n.fat, 'g'],
              ['Fiber', n.fiber, 'g'], ['Sugar', n.sugar, 'g'], ['Sodium', n.sodium, 'mg']]
              .filter(([, v]) => v != null)
              .map(([k, v, u]) => `<div><dt>${k}</dt><dd>${v}${u}</dd></div>`).join('')}
          </dl>
          <p class="fine">Nutrition comes from the original recipe and doesn't change with servings.</p>
        </section>` : ''}

      <section class="notes no-print">
        <h2>Our notes</h2>
        <form id="noteForm" class="note-form">
          <label class="sr-only" for="noteText">Add a note</label>
          <textarea id="noteText" rows="2" placeholder="How did it go? What would you change next time?"></textarea>
          <button class="btn primary" type="submit">Add note</button>
        </form>
        <ul class="note-list" id="noteList"></ul>
      </section>

      <p class="source">${r.source?.url
        ? `Adapted from <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)}</a>`
        : esc(r.source?.name || '')}</p>
      <p class="no-print"><button type="button" class="link-btn" id="deleteRecipe">Delete this recipe</button></p>
    </article>`;

  app.querySelector('#deleteRecipe').addEventListener('click', async () => {
    if (!confirm(`Delete "${r.title}" and its notes? This can't be undone.`)) return;
    await deleteRecipe(id);
    toast('Recipe deleted');
    location.hash = '#/';
  });

  const ingList = app.querySelector('#ingList');
  const stepList = app.querySelector('#stepList');
  const checked = new Set();
  const doneSteps = new Set();

  function drawScaled() {
    ingList.innerHTML = r.ingredients.map(i => `
      <li class="${checked.has(i.id) ? 'got' : ''}">
        <label><input type="checkbox" data-ing="${i.id}" ${checked.has(i.id) ? 'checked' : ''}><span>${ingredientHTML(i, scale())}</span></label>
      </li>`).join('');
    stepList.innerHTML = r.steps.map((s, idx) => `
      <li class="${doneSteps.has(idx) ? 'done' : ''}" data-step="${idx}">
        <span class="num">${idx + 1}</span><p>${stepHTML(s, byId, scale())}</p>
      </li>`).join('');
    app.querySelector('#servCount').textContent = servings;
    app.querySelector('.serves-print').textContent = servings;
  }
  drawScaled();

  ingList.addEventListener('change', e => {
    const id = e.target.dataset.ing;
    if (!id) return;
    e.target.checked ? checked.add(id) : checked.delete(id);
    e.target.closest('li').classList.toggle('got', e.target.checked);
  });
  stepList.addEventListener('click', e => {
    const li = e.target.closest('li[data-step]');
    if (!li) return;
    const idx = Number(li.dataset.step);
    doneSteps.has(idx) ? doneSteps.delete(idx) : doneSteps.add(idx);
    li.classList.toggle('done');
  });
  app.querySelectorAll('[data-serv]').forEach(b => b.addEventListener('click', () => {
    servings = Math.min(24, Math.max(1, servings + Number(b.dataset.serv)));
    drawScaled();
  }));

  // rating: tap a star to set it, tap the same star again to clear
  let rating = r.rating;
  const rateBtns = app.querySelectorAll('[data-star]');
  const drawRate = () => rateBtns.forEach(b => b.querySelector('.star').classList.toggle('on', Number(b.dataset.star) <= rating));
  rateBtns.forEach(b => b.addEventListener('click', async () => {
    const v = Number(b.dataset.star);
    rating = rating === v ? 0 : v;
    drawRate();
    await setRating(id, rating);
    toast(rating ? `Rated ${rating} star${rating > 1 ? 's' : ''}` : 'Rating cleared');
  }));

  // notes
  let notes = r.notes;
  const noteList = app.querySelector('#noteList');
  const drawNotes = () => {
    noteList.innerHTML = notes.length ? notes.map(nt => `
      <li>
        <div class="note-top"><time>${niceDate(nt.date)}${nt.author ? ` · ${esc(nt.author)}` : ''}</time>
          <button type="button" class="link-btn" data-del="${esc(nt.id)}">Delete</button></div>
        <p>${esc(nt.text)}</p>
      </li>`).join('') : '<li class="empty">No notes yet.</li>';
  };
  drawNotes();
  app.querySelector('#noteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const box = app.querySelector('#noteText');
    const text = box.value.trim();
    if (!text) return;
    notes = [await addNote(id, text), ...notes];
    box.value = '';
    drawNotes();
  });
  noteList.addEventListener('click', async e => {
    const del = e.target.dataset.del;
    if (!del || !confirm('Delete this note?')) return;
    await deleteNote(id, del);
    notes = notes.filter(x => x.id !== del);
    drawNotes();
  });

  app.querySelector('#printBtn').addEventListener('click', () => window.print());
  app.querySelector('#shareBtn').addEventListener('click', () => shareRecipe(r, byId, scale(), servings));
  app.querySelector('#cookBtn').addEventListener('click', () => openCook(r, byId, scale()));
}

// The site is behind sign-in, so sharing sends the recipe itself, not a link.
async function shareRecipe(r, byId, scale, servings) {
  const text = [
    r.title,
    `Serves ${servings} · ${totalTime(r)}`,
    '',
    'INGREDIENTS',
    ...r.ingredients.map(i => `- ${ingredientPlain(i, scale)}`),
    '',
    'STEPS',
    ...r.steps.map((s, i) => `${i + 1}. ${stepPlain(s, byId, scale)}`),
    ...(r.source?.url ? ['', `Adapted from ${r.source.name}: ${r.source.url}`] : []),
  ].join('\n');

  if (navigator.share) {
    try { await navigator.share({ title: r.title, text }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Recipe copied. Paste it into a text.');
  } catch {
    toast('Could not copy the recipe on this device.');
  }
}

// ---------- cook mode ----------

let wakeLock = null;
let cookKeys = null;

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (!cookEl.hidden && document.visibilityState === 'visible') keepAwake();
});

function openCook(r, byId, scale) {
  let i = 0;
  const last = r.steps.length - 1;
  const draw = () => {
    const ings = stepIngredientIds(r.steps[i]).map(id => byId[id]).filter(Boolean);
    cookEl.innerHTML = `
      <div class="cook-top">
        <span class="cook-title">${esc(r.title)}</span>
        <button type="button" class="btn" data-cook="close">Done</button>
      </div>
      <div class="cook-bar"><span style="width:${((i + 1) / r.steps.length) * 100}%"></span></div>
      <div class="cook-body">
        <p class="cook-count">Step ${i + 1} of ${r.steps.length}</p>
        <p class="cook-step">${stepHTML(r.steps[i], byId, scale)}</p>
        ${ings.length ? `<div class="cook-ings"><h3>For this step</h3><ul>${ings.map(x => `<li>${ingredientHTML(x, scale)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <div class="cook-nav">
        <button type="button" class="btn big" data-cook="prev" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="btn big primary" data-cook="${i === last ? 'close' : 'next'}">${i === last ? 'Finish' : 'Next step'}</button>
      </div>`;
  };
  cookEl.onclick = e => {
    const a = e.target.closest('[data-cook]')?.dataset.cook;
    if (a === 'next' && i < last) { i++; draw(); }
    if (a === 'prev' && i > 0) { i--; draw(); }
    if (a === 'close') closeCook();
  };
  cookKeys = e => {
    if (e.key === 'ArrowRight' && i < last) { i++; draw(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); }
    if (e.key === 'Escape') closeCook();
  };
  document.addEventListener('keydown', cookKeys);
  draw();
  cookEl.hidden = false;
  document.body.classList.add('cooking');
  keepAwake();
}

function closeCook() {
  if (cookEl.hidden) return;
  cookEl.hidden = true;
  document.body.classList.remove('cooking');
  if (cookKeys) document.removeEventListener('keydown', cookKeys);
  wakeLock?.release?.();
  wakeLock = null;
}

// ---------- add recipes ----------

function checkRecipe(r) {
  const problems = [];
  if (!r || typeof r !== 'object') return ['not a recipe'];
  if (!r.id || !/^[a-z0-9-]+$/.test(r.id)) problems.push('missing or bad id');
  if (!r.title) problems.push('no title');
  if (!Array.isArray(r.ingredients) || !r.ingredients.length) problems.push('no ingredients');
  if (!Array.isArray(r.steps) || !r.steps.length) problems.push('no steps');
  return problems;
}

async function showAdd() {
  const existing = new Set((await listRecipes()).map(r => r.id));
  app.innerHTML = `
    <section class="page narrow">
      <a class="back" href="#/">${ICON.back}All recipes</a>
      <h1 class="add-title">Add recipes</h1>
      <ol class="how">
        <li>Send Claude recipe links or a Pinterest board.</li>
        <li>Claude rewrites each recipe in this site's format and gives you a recipes file (it ends in <strong>.json</strong>).</li>
        <li>Choose that file below, check the list, and add them.</li>
      </ol>
      <label class="btn primary file-btn">Choose recipes file
        <input type="file" id="file" accept=".json,application/json" hidden>
      </label>
      <div id="importPreview"></div>
      <details class="testing">
        <summary>Sample recipes for testing</summary>
        <p>Adds the three sample recipes so you can try the site. Delete them from each recipe page when you're done.</p>
        <button class="btn" type="button" id="samplesBtn">Add 3 sample recipes</button>
      </details>
    </section>`;

  const preview = app.querySelector('#importPreview');

  function showList(list) {
    const rows = list.map(r => ({ r, problems: checkRecipe(r) }));
    const good = rows.filter(x => !x.problems.length).map(x => x.r);
    preview.innerHTML = `
      <ul class="import-list">
        ${rows.map(({ r, problems }) => `
          <li class="${problems.length ? 'bad' : ''}">
            <span>${esc(r?.title || '(no title)')}</span>
            <span class="tag">${problems.length ? esc(problems.join(', ')) : existing.has(r.id) ? 'Replaces existing' : 'New'}</span>
          </li>`).join('')}
      </ul>
      ${good.length ? `<button class="btn primary" type="button" id="saveBtn">Add ${good.length} recipe${good.length > 1 ? 's' : ''}</button>` : ''}`;
    preview.querySelector('#saveBtn')?.addEventListener('click', async e => {
      e.target.disabled = true;
      e.target.textContent = 'Adding...';
      try {
        await saveRecipes(good);
        toast(`Added ${good.length} recipe${good.length > 1 ? 's' : ''}`);
        location.hash = '#/';
      } catch (err) {
        console.error(err);
        toast('Could not save the recipes. Try again.');
        e.target.disabled = false;
        e.target.textContent = `Add ${good.length} recipes`;
      }
    });
  }

  app.querySelector('#file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      showList(Array.isArray(data) ? data : data.recipes || [data]);
    } catch {
      preview.innerHTML = '<p class="splash-msg">That file isn\'t a recipes file Claude made. Check that you picked the .json file.</p>';
    }
  });
  app.querySelector('#samplesBtn').addEventListener('click', () => showList(SAMPLE_RECIPES));
}

// ---------- placeholders ----------

function showSoon(title, text) {
  app.innerHTML = `
    <section class="page soon">
      <h1>${esc(title)}</h1>
      <p class="sub">${esc(text)}</p>
      <p class="pill">Coming next</p>
    </section>`;
}
