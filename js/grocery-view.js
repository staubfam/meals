import { listRecipes, getPlan, getStaples, saveStaples } from './store.js';
import { buildGroceryList, listText, AISLES } from './grocery.js';
import { parseYmd, addDays, todayYmd, datesBetween } from './planner.js';
import { esc } from './format.js';
import { toast } from './ui.js';

const DAYS = 7;
const dayLabel = d => parseYmd(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// What you checked off ("we have it") and which staples you need this time.
// Kept on this device per run; it's only a shopping aid.
function loadMarks(start) {
  try { return JSON.parse(localStorage.getItem('meals-grocery-' + start)) || { have: [], need: [] }; } catch { return { have: [], need: [] }; }
}
function saveMarks(start, marks) {
  try { localStorage.setItem('meals-grocery-' + start, JSON.stringify(marks)); } catch { /* fine */ }
}

let G = null;

export async function showGrocery(app, startParam) {
  const today = todayYmd();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startParam || '') ? startParam : today;
  const [recipes, plan, staples] = await Promise.all([listRecipes(), getPlan(), getStaples()]);
  G = { app, start, recipes, plan, staples, marks: loadMarks(start) };
  draw();
}

function draw() {
  const { app, start, recipes, plan, staples, marks } = G;
  const end = addDays(start, DAYS - 1);
  const { nights, items } = buildGroceryList({ plan, recipes, dates: datesBetween(start, end), staples });
  const have = new Set(marks.have);
  const need = new Set(marks.need);
  const toBuyList = items.filter(i => !i.staple || need.has(i.key));
  const staplesList = items.filter(i => i.staple && !need.has(i.key));
  const buying = toBuyList.filter(i => !have.has(i.key));
  const recipeNights = nights.filter(n => n.kind === 'recipe').length;

  const row = i => `
    <li class="g-row ${have.has(i.key) ? 'have' : ''}">
      <label>
        <input type="checkbox" data-have="${esc(i.key)}" ${have.has(i.key) ? 'checked' : ''}>
        <span class="g-main"><span class="g-text">${esc(i.text)}</span>
        <span class="g-for">${esc(i.recipes.join(', '))}</span></span>
      </label>
      ${need.has(i.key) ? '' : `<button type="button" class="link-btn" data-staple="${esc(i.key)}" title="Always have this? Skip it on future lists.">Staple</button>`}
    </li>`;

  const byAisle = AISLES.map(a => [a, toBuyList.filter(i => i.aisle === a)]).filter(([, l]) => l.length);

  app.innerHTML = `
    <section class="page narrow grocery">
      <h1 class="add-title">Grocery run</h1>
      <form class="run-pick" id="runPick">
        <label>Shopping for 7 days starting
          <input type="date" id="runStart" value="${start}" required>
        </label>
        <span class="sub">through ${esc(dayLabel(end))}</span>
      </form>

      <ul class="nights">
        ${nights.map(n => `
          <li class="night ${n.kind}">
            <span class="night-day">${esc(dayLabel(n.date))}</span>
            <span>${n.kind === 'recipe' ? `${esc(n.title)}${n.servings !== 6 ? ` <span class="night-serv">(${n.servings})</span>` : ''}`
              : n.kind === 'special' ? esc(n.label)
              : n.kind === 'missing' ? `${esc(n.title || 'A recipe')} was deleted`
              : 'Nothing planned'}</span>
          </li>`).join('')}
      </ul>

      ${!recipeNights ? `
        <div class="empty-box">
          <h2>No recipes these 7 days</h2>
          <p>Plan some dinners first, then come back for the list.</p>
          <a class="btn primary" href="#/plan">Go to the plan</a>
        </div>` : `
        <p class="g-hint">Check off what you already have. Everything left goes on the list.</p>
        ${byAisle.map(([a, l]) => `
          <h3 class="aisle">${esc(a)}</h3>
          <ul class="g-list">${l.map(row).join('')}</ul>`).join('')}

        ${staplesList.length ? `
          <details class="staples">
            <summary>Pantry staples skipped (${staplesList.length})</summary>
            <p class="fine">These aren't on the list. Tap "Need it" if you're out.</p>
            <ul class="g-list">
              ${staplesList.map(i => `
                <li class="g-row">
                  <span class="g-main"><span class="g-text">${esc(i.text)}</span><span class="g-for">${esc(i.recipes.join(', '))}</span></span>
                  <span class="staple-actions">
                    <button type="button" class="link-btn" data-need="${esc(i.key)}">Need it</button>
                    <button type="button" class="link-btn" data-unstaple="${esc(i.key)}">Not a staple</button>
                  </span>
                </li>`).join('')}
            </ul>
          </details>` : ''}

        <div class="copy-bar">
          <span><strong>${buying.length}</strong> item${buying.length === 1 ? '' : 's'} to buy</span>
          <span class="copy-actions">
            ${navigator.share ? '<button type="button" class="btn" id="shareList">Share</button>' : ''}
            <button type="button" class="btn primary" id="copyList" ${buying.length ? '' : 'disabled'}>Copy list</button>
          </span>
        </div>
        <p class="fine keep-tip">In Google Keep, paste into a new list and each line becomes its own checkbox. If it lands as one block, open the note's menu and choose "Show checkboxes."</p>`}
    </section>`;

  app.querySelector('#runStart').addEventListener('change', e => {
    if (e.target.value) location.hash = '#/grocery/' + e.target.value;
  });
  app.querySelector('#runPick').addEventListener('submit', e => e.preventDefault());

  app.querySelectorAll('[data-have]').forEach(cb => cb.addEventListener('change', () => {
    const k = cb.dataset.have;
    marks.have = cb.checked ? [...new Set([...marks.have, k])] : marks.have.filter(x => x !== k);
    saveMarks(start, marks);
    draw();
  }));
  app.querySelectorAll('[data-need]').forEach(b => b.addEventListener('click', () => {
    marks.need = [...new Set([...marks.need, b.dataset.need])];
    saveMarks(start, marks);
    draw();
  }));
  app.querySelectorAll('[data-staple]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.staple;
    staples.add = [...new Set([...staples.add, k])];
    staples.remove = staples.remove.filter(x => x !== k);
    await saveStaples(staples);
    toast('Marked as a pantry staple. It will be skipped from now on.');
    draw();
  }));
  app.querySelectorAll('[data-unstaple]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.unstaple;
    staples.add = staples.add.filter(x => x !== k);
    staples.remove = [...new Set([...staples.remove, k])];
    await saveStaples(staples);
    toast('Not a staple anymore. It will be on your lists.');
    draw();
  }));

  const text = listText(buying);
  app.querySelector('#copyList')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${buying.length} items. Paste them into Google Keep.`);
    } catch {
      toast('Could not copy on this device. Try Share instead.');
    }
  });
  app.querySelector('#shareList')?.addEventListener('click', async () => {
    try { await navigator.share({ title: `Groceries for ${dayLabel(start)}`, text }); } catch { /* cancelled */ }
  });
}
