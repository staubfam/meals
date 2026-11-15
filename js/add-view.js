import { listRecipes, saveRecipes, listInbox, addToInbox, removeFromInbox } from './store.js';
import {
  readRecipePage, buildRecipe, guessProtein, guessTags, parseIngredient, PROTEINS, TARGET_SERVINGS,
} from './import.js';
import { esc, ingredientHTML, stepHTML, niceDate } from './format.js';
import { star, ICON, toast } from './ui.js';
import { SAMPLE_RECIPES } from '../data/sample-recipes.js';

// Recipe pages are read through Jina Reader, because browsers can't load other sites directly.
// Jina only sees the recipe link.
const READER = 'https://r.jina.ai/';

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(READER + url, { headers: { 'X-Return-Format': 'html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('status ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean);

export async function showAdd(app) {
  const existing = await listRecipes();
  const ids = existing.map(r => r.id);
  const proteins = [...new Set([...PROTEINS, ...existing.map(r => r.protein).filter(Boolean)])];
  let nutrition = null;

  app.innerHTML = `
    <section class="page narrow add">
      <a class="back" href="#/">${ICON.back}All recipes</a>
      <h1 class="add-title">Add a recipe</h1>

      <form id="linkForm" class="link-import">
        <label for="linkUrl">Paste a recipe link</label>
        <div class="link-row">
          <input id="linkUrl" type="url" inputmode="url" placeholder="https://www.example.com/recipe" required>
          <button class="btn primary" type="submit">Get recipe</button>
        </div>
      </form>
      <div id="linkStatus" class="link-status" role="status"></div>
      <p class="fine">No link? <button type="button" class="link-btn inline" id="typeIt">Type or paste a recipe instead</button>
        · Rather have Claude do it? <button type="button" class="link-btn inline" id="saveLink">Save the link for Claude</button></p>
      <div id="inbox"></div>

      <form id="recipeForm" class="recipe-form" hidden>
        <div id="dupWarn"></div>
        <label>Title <input id="fTitle" type="text" required maxlength="120"></label>
        <div class="form-row">
          <label>The original recipe serves <input id="fServ" type="number" min="1" max="100" step="1" required>
            <span class="fine" id="servHint"></span></label>
          <label>Protein <select id="fProtein">${proteins.map(p => `<option>${esc(p)}</option>`).join('')}</select></label>
        </div>
        <div class="form-row">
          <label>Prep minutes <input id="fPrep" type="number" min="0" max="1440"></label>
          <label>Cook minutes <input id="fCook" type="number" min="0" max="2880"></label>
        </div>
        <label>Tags <span class="fine">(separate with commas)</span> <input id="fTags" type="text" placeholder="Weeknight, Pasta"></label>
        <label>Ingredients <span class="fine">(one per line, as written)</span>
          <textarea id="fIngs" rows="10" placeholder="1 lb chicken breast, cubed&#10;2 tbsp olive oil&#10;1 (15-oz) can black beans, drained"></textarea></label>
        <label>Steps <span class="fine">(one per line)</span>
          <textarea id="fSteps" rows="8" placeholder="Heat the oil in a large skillet.&#10;Add the chicken and cook until browned."></textarea></label>
        <label>Short description <span class="fine">(optional)</span> <textarea id="fDesc" rows="2" maxlength="280"></textarea></label>
        <div class="rate-line"><span>Rating <span class="fine">(optional)</span></span>
          <span class="rate" id="fRate">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" aria-label="Rate ${i} star${i > 1 ? 's' : ''}">${star(false)}</button>`).join('')}</span></div>
        <input type="hidden" id="fUrl"><input type="hidden" id="fSite">

        <h2 class="preview-h">Preview <span class="fine">saved for ${TARGET_SERVINGS} servings</span></h2>
        <div id="preview" class="import-preview"></div>
        <div class="actions"><button class="btn primary" type="submit" id="saveRecipe">Save recipe</button></div>
      </form>

      <details class="testing">
        <summary>Add from a recipes file</summary>
        <p>For a batch of recipes Claude prepared (a file ending in <strong>.json</strong>).</p>
        <label class="btn file-btn">Choose recipes file <input type="file" id="file" accept=".json,application/json" hidden></label>
        <div id="importPreview"></div>
        <p class="fine">Or <button type="button" class="link-btn inline" id="samplesBtn">add the 3 sample recipes</button> for testing.</p>
      </details>
    </section>`;

  const $ = s => app.querySelector(s);
  const form = $('#recipeForm');
  const status = $('#linkStatus');
  let rating = 0;

  // ----- filling the form -----

  function openForm(data = {}) {
    nutrition = data.nutrition || null;
    $('#fTitle').value = data.title || '';
    $('#fServ').value = data.servings || '';
    $('#fPrep').value = data.prepMin || '';
    $('#fCook').value = data.cookMin || '';
    $('#fIngs').value = (data.ingredients || []).join('\n');
    $('#fSteps').value = (data.steps || []).join('\n');
    $('#fDesc').value = data.description || '';
    $('#fUrl').value = data.url || '';
    $('#fSite').value = data.siteName || '';
    const parsed = (data.ingredients || []).map(parseIngredient);
    proteinPicked = false;
    $('#fProtein').value = guessProtein(parsed, data.title || '');
    $('#fTags').value = guessTags(data.title || '', (data.prepMin || 0) + (data.cookMin || 0), parsed).join(', ');
    $('#servHint').textContent = data.yieldText
      ? `The site says "${data.yieldText}".${data.servings > 10 ? ' That may be pieces, not servings. Check it.' : ''}`
      : data.url ? "The site didn't say. Enter your best guess." : '';
    const dup = data.url && existing.find(r => r.source?.url && r.source.url.replace(/[?#].*$/, '') === data.url.replace(/[?#].*$/, ''));
    $('#dupWarn').innerHTML = dup ? `<p class="splash-msg">You already have this one: <a href="#/recipe/${encodeURIComponent(dup.id)}">${esc(dup.title)}</a>. Saving again adds a second copy.</p>` : '';
    form.hidden = false;
    drawPreview();
  }

  function fields() {
    return {
      title: $('#fTitle').value,
      origServings: $('#fServ').value,
      protein: $('#fProtein').value,
      prepMin: $('#fPrep').value,
      cookMin: $('#fCook').value,
      tags: $('#fTags').value.split(',').map(t => t.trim()).filter(Boolean),
      ingredientLines: lines($('#fIngs').value),
      stepLines: lines($('#fSteps').value),
      description: $('#fDesc').value,
      sourceUrl: $('#fUrl').value,
      sourceName: $('#fSite').value,
      nutrition,
      rating,
    };
  }

  function drawPreview() {
    const f = fields();
    const box = $('#preview');
    if (!f.ingredientLines.length && !f.stepLines.length) {
      box.innerHTML = '<p class="fine">Add ingredients and steps to see the recipe here.</p>';
      return;
    }
    const r = buildRecipe(f, ids);
    const byId = Object.fromEntries(r.ingredients.map(i => [i.id, i]));
    box.innerHTML = `
      <ul class="ing-list">${r.ingredients.map(i => `
        <li><span class="pv-ing">${ingredientHTML(i, 1)}</span>
          <span class="pv-tags"><span class="chip">${esc(i.aisle)}</span>${i.staple ? '<span class="chip try">Staple</span>' : ''}</span></li>`).join('')}
      </ul>
      <ol class="steps">${r.steps.map((s, k) => `<li><span class="num">${k + 1}</span><p>${stepHTML(s, byId, 1)}</p></li>`).join('')}</ol>
      ${nutrition ? '<p class="fine">Nutrition per serving was found and will be saved too.</p>' : ''}`;
  }

  // Keep guessing the protein from the ingredients until someone picks one.
  let proteinPicked = false;
  $('#fProtein').addEventListener('change', () => { proteinPicked = true; });
  const reguess = () => {
    if (proteinPicked) return;
    $('#fProtein').value = guessProtein(lines($('#fIngs').value).map(parseIngredient), $('#fTitle').value);
  };

  let timer;
  form.addEventListener('input', e => {
    if (e.target.id === 'fIngs' || e.target.id === 'fTitle') reguess();
    clearTimeout(timer);
    timer = setTimeout(drawPreview, 250);
  });
  form.addEventListener('change', drawPreview);

  const rateBtns = app.querySelectorAll('#fRate [data-star]');
  rateBtns.forEach(b => b.addEventListener('click', () => {
    const v = Number(b.dataset.star);
    rating = rating === v ? 0 : v;
    rateBtns.forEach(x => x.querySelector('.star').classList.toggle('on', Number(x.dataset.star) <= rating));
  }));

  // ----- getting a recipe from a link -----

  $('#linkForm').addEventListener('submit', async e => {
    e.preventDefault();
    let url = $('#linkUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Getting it...';
    status.innerHTML = '';
    try {
      const page = readRecipePage(await fetchPage(url), url);
      if (page.found && page.ingredients.length) {
        openForm({ ...page, url });
        status.innerHTML = `<p class="ok-msg">Got it. Check everything below, especially the servings and protein, then save.</p>`;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const blocked = /just a moment|attention required|access denied|captcha/i.test(page.pageTitle || '');
        if (/not found|404|page doesn.t exist/i.test(page.pageTitle || '')) {
          status.innerHTML = '<p class="splash-msg">That page wasn\'t found. Check the link and try again.</p>';
          return;
        }
        openForm({ url, siteName: new URL(url).hostname.replace(/^www\./, ''), title: blocked ? '' : (page.pageTitle || '').split(/ [|–-] /)[0] });
        status.innerHTML = `<p class="splash-msg">${blocked ? "This site blocks automatic imports." : "Couldn't find a recipe on that page."}
          Copy the ingredients and steps from the page and paste them below, or save it for Claude to add.</p>
          <button type="button" class="btn" data-save-claude>Save it for Claude</button>`;
      }
    } catch (err) {
      console.error(err);
      openForm({ url, siteName: (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })() });
      status.innerHTML = `<p class="splash-msg">That site wouldn't share the recipe. Copy the ingredients and steps from the page and paste them below, or save it for Claude to add.</p>
        <button type="button" class="btn" data-save-claude>Save it for Claude</button>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get recipe';
    }
  });

  $('#typeIt').addEventListener('click', () => { status.innerHTML = ''; openForm({ servings: TARGET_SERVINGS }); $('#fTitle').focus(); });

  // ----- saved for Claude -----

  async function drawInbox() {
    const box = $('#inbox');
    let items = [];
    try { items = await listInbox(); } catch (err) { console.error(err); }
    box.innerHTML = items.length ? `
      <div class="inbox">
        <h2>Saved for Claude <span class="fine">(${items.length})</span></h2>
        <p class="fine">Claude adds these at the start of the next Meals session. They disappear once the recipe is in.</p>
        <ul class="g-list">${items.map(x => `
          <li class="g-row">
            <span class="g-main"><a class="g-text" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70))}</a>
              <span class="g-for">${esc(niceDate(x.addedAt))}${x.addedBy ? ' · ' + esc(x.addedBy) : ''}</span></span>
            <button type="button" class="link-btn" data-unsave="${esc(x.id)}">Remove</button>
          </li>`).join('')}</ul>
      </div>` : '';
    box.querySelectorAll('[data-unsave]').forEach(b => b.addEventListener('click', async () => {
      await removeFromInbox(b.dataset.unsave);
      drawInbox();
    }));
  }
  drawInbox();

  async function saveForClaude() {
    let url = $('#linkUrl').value.trim();
    if (!url) { toast('Paste the link in the box first.'); $('#linkUrl').focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { toast("That doesn't look like a link."); return; }
    const added = await addToInbox(url, $('#fTitle')?.value?.trim() || '');
    toast(added ? 'Saved for Claude' : 'That link is already saved for Claude');
    $('#linkUrl').value = '';
    status.innerHTML = '';
    form.hidden = true;
    drawInbox();
  }
  $('#saveLink').addEventListener('click', saveForClaude);
  status.addEventListener('click', e => { if (e.target.closest('[data-save-claude]')) saveForClaude(); });

  // ----- saving -----

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = fields();
    if (!f.title.trim()) return toast('Add a title first.');
    if (!f.ingredientLines.length || !f.stepLines.length) return toast('Add at least one ingredient and one step.');
    const recipe = buildRecipe(f, ids);
    const btn = $('#saveRecipe');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      await saveRecipes([recipe]);
      toast(`Saved ${recipe.title}`);
      location.hash = '#/recipe/' + encodeURIComponent(recipe.id);
    } catch (err) {
      console.error(err);
      toast('Could not save. Try again.');
      btn.disabled = false;
      btn.textContent = 'Save recipe';
    }
  });

  // ----- recipes file (from Claude) -----

  const preview = $('#importPreview');
  const existingIds = new Set(ids);
  const checkRecipe = r => {
    const problems = [];
    if (!r || typeof r !== 'object') return ['not a recipe'];
    if (!r.id || !/^[a-z0-9-]+$/.test(r.id)) problems.push('missing or bad id');
    if (!r.title) problems.push('no title');
    if (!Array.isArray(r.ingredients) || !r.ingredients.length) problems.push('no ingredients');
    if (!Array.isArray(r.steps) || !r.steps.length) problems.push('no steps');
    return problems;
  };
  function showList(list) {
    const rows = list.map(r => ({ r, problems: checkRecipe(r) }));
    const good = rows.filter(x => !x.problems.length).map(x => x.r);
    preview.innerHTML = `
      <ul class="import-list">
        ${rows.map(({ r, problems }) => `
          <li class="${problems.length ? 'bad' : ''}">
            <span>${esc(r?.title || '(no title)')}</span>
            <span class="tag">${problems.length ? esc(problems.join(', ')) : existingIds.has(r.id) ? 'Replaces existing' : 'New'}</span>
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
      }
    });
  }
  $('#file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      showList(Array.isArray(data) ? data : data.recipes || [data]);
    } catch {
      preview.innerHTML = '<p class="splash-msg">That file isn\'t a recipes file Claude made. Check that you picked the .json file.</p>';
    }
  });
  $('#samplesBtn').addEventListener('click', () => showList(SAMPLE_RECIPES));
}
