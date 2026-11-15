// Builds a shopping list from planned nights. No Firebase or page code, so it can be tested alone.

import { formatQty, unitFor } from './format.js';

export const AISLES = ['Produce', 'Meat', 'Dairy', 'Bakery', 'Canned goods', 'Pasta & grains', 'Condiments', 'Pantry', 'Spices', 'Frozen', 'Other'];

const VOLUME = { tsp: 1, tbsp: 3, cup: 48 }; // in teaspoons
const WEIGHT = { oz: 1, lb: 16 };            // in ounces

export const itemKey = name => name.trim().toLowerCase();

// staples = { add: [keys marked as staples], remove: [keys that are NOT staples after all] }
export function isStaple(key, recipeSaysStaple, staples) {
  if (staples?.remove?.includes(key)) return false;
  return !!recipeSaysStaple || !!staples?.add?.includes(key);
}

function volumeText(tsp) {
  if (tsp >= 12) return amount(tsp / 48, 'cup');   // ¼ cup or more
  if (tsp >= 3) return amount(tsp / 3, 'tbsp');
  return amount(tsp, 'tsp');
}
function weightText(oz) {
  return oz >= 16 ? amount(oz / 16, 'lb') : amount(oz, 'oz');
}
function amount(q, unit) {
  return [formatQty(q), unitFor(unit, q)].filter(Boolean).join(' ');
}

// You can't buy 1⅓ onions or 1⅓ cans, so things you buy whole round up.
const WHOLE_UNITS = /(^|\s|\))(can|package|jar|bag|box|bunch|head|stalk|clove|slice|sprig)$/;

function describe(it) {
  const parts = [];
  let count = 0;
  const isButter = /\bbutter\b/i.test(it.name) && !/peanut|almond|apple/i.test(it.name);
  for (const [k, q] of Object.entries(it.amounts)) {
    if (k === 'vol' && isButter) {
      const sticks = Math.ceil((q / 24) * 2) / 2; // 1 stick = 8 tbsp; round up to a half stick
      parts.push(`${formatQty(sticks)} stick${sticks > 1 ? 's' : ''}`);
    } else if (k === 'vol') parts.push(volumeText(q));
    else if (k === 'wt') parts.push(weightText(q));
    else if (k === 'u:') { count = Math.ceil(q - 0.01); parts.push(String(count)); }
    else {
      const unit = k.slice(2);
      if (WHOLE_UNITS.test(unit)) {
        const n = Math.ceil(q - 0.01);
        parts.push(amount(n, unit));
        if (unit === 'clove' && n >= 8) it.after = ` (about ${Math.ceil(n / 10)} head${n > 10 ? 's' : ''})`;
      } else parts.push(amount(q, unit));
    }
  }
  const name = count > 1 && it.plural ? it.plural : it.name;
  return (parts.length ? `${parts.join(' + ')} ${name}` : name) + (it.after || '');
}

export function buildGroceryList({ plan, recipes, dates, staples }) {
  const byId = Object.fromEntries(recipes.map(r => [r.id, r]));
  const nights = [];
  const items = new Map();

  for (const date of dates) {
    const e = plan[date];
    if (!e) { nights.push({ date, kind: 'empty' }); continue; }
    if (e.type !== 'recipe') { nights.push({ date, kind: 'special', label: e.label }); continue; }
    const r = byId[e.recipeId];
    if (!r) { nights.push({ date, kind: 'missing', title: e.title }); continue; }
    const servings = e.servings || r.servings || 6;
    nights.push({ date, kind: 'recipe', title: r.title, servings });
    const scale = servings / (r.servings || 6);

    for (const ing of r.ingredients || []) {
      const key = itemKey(ing.item);
      let it = items.get(key);
      if (!it) {
        it = { key, name: ing.item.trim(), plural: ing.itemPlural, aisle: AISLES.includes(ing.aisle) ? ing.aisle : 'Other', recipeStaple: false, amounts: {}, recipes: new Set() };
        items.set(key, it);
      }
      if (ing.staple) it.recipeStaple = true;
      if (!it.plural && ing.itemPlural) it.plural = ing.itemPlural;
      it.recipes.add(r.title);
      if (ing.qty == null) continue;
      const q = ing.qty * scale;
      const u = ing.unit || '';
      const k = VOLUME[u] ? 'vol' : WEIGHT[u] ? 'wt' : 'u:' + u;
      it.amounts[k] = (it.amounts[k] || 0) + q * (VOLUME[u] || WEIGHT[u] || 1);
    }
  }

  const list = [...items.values()]
    .map(it => ({
      key: it.key, name: it.name, aisle: it.aisle, text: describe(it),
      recipes: [...it.recipes], staple: isStaple(it.key, it.recipeStaple, staples),
    }))
    .sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));

  return { nights, items: list };
}

// One item per line, which Google Keep turns into separate checklist items.
export function listText(items) {
  return items.map(i => i.text).join('\n');
}
