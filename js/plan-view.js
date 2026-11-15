import { listRecipes, getPlan, setNight, setNights, clearNight, clearNights } from './store.js';
import {
  SPECIALS, LOCK_DAYS, ymd, parseYmd, addDays, daysBetween, todayYmd, datesBetween, isLocked,
  buildHistory, isWantToTry, autoFill, suggestSwaps, lastMadeText,
} from './planner.js';
import { esc } from './format.js';
import { starsShow, ICON, toast } from './ui.js';

const sheet = document.getElementById('sheet');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const longDate = d => parseYmd(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = d => parseYmd(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// state for the page that's open
let S = null;

export async function showPlan(app, monthParam) {
  const today = todayYmd();
  const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : today.slice(0, 7);
  const [recipes, plan] = await Promise.all([listRecipes(), getPlan()]);
  S = { app, month, today, recipes, plan, history: buildHistory(Object.values(plan), today) };
  draw();
}

async function reload() {
  S.plan = await getPlan();
  S.history = buildHistory(Object.values(S.plan), S.today);
  draw();
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return { first: ymd(new Date(y, m - 1, 1)), last: ymd(new Date(y, m, 0)) };
}
function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  return ymd(new Date(y, m - 1 + n, 1)).slice(0, 7);
}

// ---------- calendar ----------

function draw() {
  const { app, month, today, plan } = S;
  const { first, last } = monthBounds(month);
  const title = parseYmd(first).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const lead = parseYmd(first).getDay();
  const days = datesBetween(first, last);
  const planned = days.filter(d => plan[d]).length;

  app.innerHTML = `
    <section class="page plan">
      <div class="plan-head">
        <div class="month-nav">
          <a class="icon-btn" href="#/plan/${shiftMonth(month, -1)}" aria-label="Previous month">${ICON.back}</a>
          <h1>${title}</h1>
          <a class="icon-btn" href="#/plan/${shiftMonth(month, 1)}" aria-label="Next month">${ICON.next}</a>
        </div>
        <div class="plan-actions">
          ${month !== today.slice(0, 7) ? `<a class="btn" href="#/plan/${today.slice(0, 7)}">This month</a>` : ''}
          <a class="btn" href="#/grocery">Grocery run</a>
          <button class="btn primary" type="button" id="fillBtn">Auto-fill</button>
        </div>
      </div>
      <p class="sub plan-count">${planned} of ${days.length} nights planned</p>
      <div class="cal">
        <div class="cal-dow" aria-hidden="true">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="cal-grid">
          ${'<span class="cal-blank"></span>'.repeat(lead)}
          ${days.map(d => dayCell(d)).join('')}
        </div>
      </div>
    </section>`;

  app.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => openNight(b.dataset.date)));
  app.querySelector('#fillBtn').addEventListener('click', openAutoFill);
  app.querySelector('.day.today')?.scrollIntoView({ block: 'center' });
}

function dayCell(d) {
  const e = S.plan[d];
  const cls = ['day', d < S.today && 'past', d === S.today && 'today', e?.type === 'special' && 'is-special', !e && 'is-empty'].filter(Boolean).join(' ');
  let body;
  if (e?.type === 'recipe') {
    body = `<span class="day-meal">${esc(e.title)}</span>
            <span class="day-sub">${esc(e.protein || '')}${e.servings && e.servings !== 6 ? ` · ${e.servings} servings` : ''}</span>`;
  } else if (e?.type === 'special') {
    body = `<span class="day-special">${esc(e.label)}</span>`;
  } else {
    body = `<span class="day-empty">${d < S.today ? '&nbsp;' : '+ Add dinner'}</span>`;
  }
  const dt = parseYmd(d);
  return `
    <button type="button" class="${cls}" data-date="${d}" aria-label="${esc(longDate(d))}${e ? ': ' + esc(e.title || e.label) : ''}">
      <span class="day-num"><span class="day-dow">${DOW[dt.getDay()]}</span>${dt.getDate()}</span>
      <span class="day-body">${body}</span>
    </button>`;
}

// ---------- sheet (dialog) ----------

function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-inner">
    <button type="button" class="icon-btn sheet-close" aria-label="Close">${ICON.close}</button>
    ${html}</div>`;
  sheet.querySelector('.sheet-close').addEventListener('click', () => sheet.close());
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

function recipeRow(r) {
  return `
    <button type="button" class="pick" data-recipe="${esc(r.id)}">
      <span class="pick-title">${esc(r.title)}</span>
      <span class="pick-meta"><span class="chip protein">${esc(r.protein || 'Other')}</span>${starsShow(r.rating || 0)}
        <span>${isWantToTry(r, S.history) ? 'Want to try' : esc(lastMadeText(S.history, r.id, S.today))}</span></span>
    </button>`;
}

function openNight(date) {
  const e = S.plan[date];
  const locked = isLocked(date, S.today);
  const past = date < S.today;
  const recipe = e?.type === 'recipe' ? S.recipes.find(r => r.id === e.recipeId) : null;

  let current = '';
  if (e?.type === 'recipe') {
    current = `
      <div class="current">
        <a class="current-title" href="#/recipe/${encodeURIComponent(e.recipeId)}/${e.servings || 6}">${esc(e.title)}</a>
        <div class="current-row">
          <span class="chip protein">${esc(e.protein || 'Other')}</span>
          ${locked ? `<span>${e.servings || 6} servings</span>` : `
          <div class="servings" role="group" aria-label="Servings">
            <button type="button" class="step-btn" data-serv="-1" aria-label="Fewer servings">&minus;</button>
            <span><strong id="nightServ">${e.servings || 6}</strong> servings</span>
            <button type="button" class="step-btn" data-serv="1" aria-label="More servings">+</button>
          </div>`}
        </div>
        ${!recipe ? '<p class="fine">This recipe was deleted from the recipe box.</p>' : ''}
        ${locked ? '' : `<div class="actions">
          ${past ? '' : '<button type="button" class="btn" id="swapBtn">Want something else</button>'}
          <button type="button" class="btn" id="clearBtn">${past ? "We didn't make this" : 'Clear night'}</button>
        </div>`}
        <div id="swaps"></div>
      </div>`;
  } else if (e?.type === 'special') {
    current = `
      <div class="current">
        <p class="current-title special">${esc(e.label)}</p>
        ${locked ? '' : '<div class="actions"><button type="button" class="btn" id="clearBtn">Clear night</button></div>'}
      </div>`;
  }

  const chooser = locked ? `<p class="splash-msg">Nights more than ${LOCK_DAYS} days ago are locked so your history stays accurate.</p>` : `
    <h3 class="sheet-h">${e ? 'Change to' : 'Choose dinner'}</h3>
    <div class="specials">
      ${SPECIALS.map(s => `<button type="button" class="chip-btn" data-special="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>
    <form class="other-form" id="otherForm">
      <input type="text" id="otherText" maxlength="40" placeholder="Something else, like Pizza Friday" aria-label="Other night">
      <button class="btn" type="submit">Add</button>
    </form>
    <label class="search small">${ICON.search}<input id="pickSearch" type="search" placeholder="Search recipes" autocomplete="off"></label>
    <div class="pick-list" id="pickList"></div>`;

  openSheet(`
    <p class="sheet-kicker">${past ? 'Past night' : date === S.today ? 'Tonight' : 'Dinner'}</p>
    <h2>${esc(longDate(date))}</h2>
    ${current}
    ${chooser}`);

  // servings for this night
  let serv = e?.servings || 6;
  sheet.querySelectorAll('[data-serv]').forEach(b => b.addEventListener('click', async () => {
    serv = Math.min(24, Math.max(1, serv + Number(b.dataset.serv)));
    sheet.querySelector('#nightServ').textContent = serv;
    S.plan[date] = { ...e, servings: serv };
    await setNight(date, S.plan[date]);
    draw();
    sheet.querySelector('.current-title').href = `#/recipe/${encodeURIComponent(e.recipeId)}/${serv}`;
  }));

  sheet.querySelector('#clearBtn')?.addEventListener('click', async () => {
    await clearNight(date);
    sheet.close();
    toast(past ? 'Removed. It no longer counts as made.' : 'Night cleared');
    reload();
  });

  sheet.querySelector('#swapBtn')?.addEventListener('click', () => {
    const list = suggestSwaps({ recipes: S.recipes, history: S.history, plan: S.plan, date, current: e });
    const box = sheet.querySelector('#swaps');
    box.innerHTML = list.length ? `
      <h3 class="sheet-h">Try one of these instead</h3>
      <div class="pick-list">${list.map(x => recipeRow(x.r)).join('')}</div>` : '<p class="fine">No other recipes yet.</p>';
    box.querySelectorAll('[data-recipe]').forEach(b => b.addEventListener('click', () => pickRecipe(date, b.dataset.recipe, serv)));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  if (locked) return;

  sheet.querySelectorAll('[data-special]').forEach(b => b.addEventListener('click', () => pickSpecial(date, b.dataset.special)));
  sheet.querySelector('#otherForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const label = sheet.querySelector('#otherText').value.trim();
    if (label) pickSpecial(date, label);
  });

  const listEl = sheet.querySelector('#pickList');
  const drawList = q => {
    const needle = q.trim().toLowerCase();
    const shown = S.recipes.filter(r => !needle || `${r.title} ${r.protein} ${(r.tags || []).join(' ')}`.toLowerCase().includes(needle));
    listEl.innerHTML = shown.length ? shown.map(recipeRow).join('') : '<p class="fine">No recipes match.</p>';
    listEl.querySelectorAll('[data-recipe]').forEach(b => b.addEventListener('click', () => pickRecipe(date, b.dataset.recipe, serv)));
  };
  drawList('');
  sheet.querySelector('#pickSearch').addEventListener('input', ev => drawList(ev.target.value));
}

async function pickRecipe(date, id, servings = 6) {
  const r = S.recipes.find(x => x.id === id);
  const entry = {
    type: 'recipe', recipeId: r.id, title: r.title, protein: r.protein || '', servings,
    wantToTry: isWantToTry(r, S.history),
  };
  await setNight(date, entry);
  sheet.close();
  toast(`${r.title} on ${shortDate(date)}`);
  reload();
}

async function pickSpecial(date, label) {
  await setNight(date, { type: 'special', label });
  sheet.close();
  toast(`${label} on ${shortDate(date)}`);
  reload();
}

// ---------- auto-fill ----------

function openAutoFill() {
  const { first, last } = monthBounds(S.month);
  const from = first < S.today ? S.today : first;
  const to = last < S.today ? addDays(S.today, 30) : last;

  openSheet(`
    <p class="sheet-kicker">Auto-fill</p>
    <h2>Fill the empty nights</h2>
    <p class="sub">Nights you've already planned stay as they are. Auto-fill rotates proteins, leans toward your top-rated recipes, and adds up to 2 want-to-try recipes a week.</p>
    <form id="fillForm" class="fill-form">
      <label>From <input type="date" id="fillFrom" value="${from}" min="${S.today}" required></label>
      <label>To <input type="date" id="fillTo" value="${to}" min="${S.today}" required></label>
      <button class="btn primary" type="submit">Fill empty nights</button>
    </form>
    <div id="fillResult"></div>`);

  sheet.querySelector('#fillForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const a = sheet.querySelector('#fillFrom').value;
    const b = sheet.querySelector('#fillTo').value;
    const out = sheet.querySelector('#fillResult');
    if (!a || !b || b < a) { out.innerHTML = '<p class="splash-msg">The end date needs to be after the start date.</p>'; return; }
    if (daysBetween(a, b) > 92) { out.innerHTML = '<p class="splash-msg">Pick a range of 3 months or less.</p>'; return; }
    if (!S.recipes.length) { out.innerHTML = '<p class="splash-msg">Add some recipes first.</p>'; return; }

    const dates = datesBetween(a, b);
    const { filled, stretched } = autoFill({ recipes: S.recipes, history: S.history, plan: S.plan, dates });
    const n = Object.keys(filled).length;
    if (!n) { out.innerHTML = '<p class="splash-msg">Every night in that range is already planned.</p>'; return; }

    ev.target.querySelector('button').disabled = true;
    await setNights(filled);
    out.innerHTML = `
      <div class="fill-done">
        <p><strong>Filled ${n} night${n > 1 ? 's' : ''}.</strong>
        ${stretched ? `With ${S.recipes.length} recipes, ${stretched} of them repeat a recipe sooner than 3 weeks or put a protein next to itself. More recipes will fix that.` : 'Every rule was followed.'}</p>
        <div class="actions">
          <button type="button" class="btn primary" id="fillDone">Looks good</button>
          <button type="button" class="btn" id="fillUndo">Undo</button>
        </div>
      </div>`;
    out.querySelector('#fillDone').addEventListener('click', () => sheet.close());
    out.querySelector('#fillUndo').addEventListener('click', async () => {
      await clearNights(Object.keys(filled));
      sheet.close();
      toast('Auto-fill undone');
      reload();
    });
    reload();
  });
}
