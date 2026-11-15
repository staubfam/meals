// Quantity formatting, scaling and step rendering.

const FRACTIONS = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 1.5 -> "1½", 0.333 -> "⅓", 12.4 -> "12½"
export function formatQty(q) {
  if (q == null || isNaN(q)) return '';
  if (q >= 10) {
    const half = Math.round(q * 2) / 2;
    return half % 1 ? `${Math.floor(half)}½` : String(half);
  }
  let whole = Math.floor(q);
  const frac = q - whole;
  let best = FRACTIONS[0];
  let dist = 1;
  for (const f of FRACTIONS) {
    const d = Math.abs(frac - f[0]);
    if (d < dist) { dist = d; best = f; }
  }
  if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
  if (whole === 0 && !best[1]) return q > 0 ? '⅛' : '0';
  return `${whole || ''}${best[1]}`;
}

const PLURAL_UNITS = {
  cup: 'cups', clove: 'cloves', can: 'cans', head: 'heads', bunch: 'bunches', package: 'packages',
  slice: 'slices', stalk: 'stalks', sprig: 'sprigs', pinch: 'pinches', jar: 'jars', bag: 'bags', box: 'boxes',
};

export function unitFor(unit, q) {
  if (!unit) return '';
  if (q == null || q <= 1) return unit;
  const parts = unit.split(' ');
  const last = parts[parts.length - 1];
  const m = last.match(/^(.*?)([a-z]+)$/i);
  if (m && PLURAL_UNITS[m[2]]) parts[parts.length - 1] = m[1] + PLURAL_UNITS[m[2]];
  return parts.join(' ');
}

function itemFor(ing, q) {
  if (!ing.unit && q != null && q > 1 && ing.itemPlural) return ing.itemPlural;
  return ing.item;
}

export function scaledQty(ing, scale) {
  return ing.qty == null ? null : ing.qty * scale;
}

// "2 lb" style amount text, or '' when there is no amount.
// Small amounts read better in a smaller unit: ⅙ cup -> 2⅔ tbsp, ½ tbsp -> 1½ tsp.
function friendlier(unit, q) {
  if (unit === 'cup' && q < 1 / 4 - 0.001) return friendlier('tbsp', q * 16);
  if (unit === 'tbsp' && q < 1 - 0.001) return ['tsp', q * 3];
  return [unit, q];
}

export function amountText(ing, scale) {
  const raw = scaledQty(ing, scale);
  if (raw == null) return '';
  const [unit, q] = friendlier(ing.unit, raw);
  return [formatQty(q), unitFor(unit, q)].filter(Boolean).join(' ');
}

export function ingredientHTML(ing, scale) {
  const q = scaledQty(ing, scale);
  const amt = amountText(ing, scale);
  return `${amt ? `<span class="q">${esc(amt)}</span> ` : ''}${esc(itemFor(ing, q))}${ing.note ? `<span class="ing-note">, ${esc(ing.note)}</span>` : ''}`;
}

export function ingredientPlain(ing, scale) {
  const q = scaledQty(ing, scale);
  const amt = amountText(ing, scale);
  return `${amt ? amt + ' ' : ''}${itemFor(ing, q)}${ing.note ? ', ' + ing.note : ''}`;
}

const TOKEN = /\{(i\d+)(?::([^}]+))?\}/g;

// Steps reference ingredients as {i3} or {i3:custom label}; they render with the scaled amount.
export function stepHTML(text, byId, scale) {
  return esc(text).replace(TOKEN, (m, id, label) => {
    const ing = byId[id];
    if (!ing) return m;
    const amt = amountText(ing, scale);
    const name = label || itemFor(ing, scaledQty(ing, scale));
    return `<span class="amt">${esc(amt ? `${amt} ${name}` : name)}</span>`;
  });
}

export function stepPlain(text, byId, scale) {
  return text.replace(TOKEN, (m, id, label) => {
    const ing = byId[id];
    if (!ing) return m;
    const amt = amountText(ing, scale);
    const name = label || itemFor(ing, scaledQty(ing, scale));
    return amt ? `${amt} ${name}` : name;
  });
}

export function stepIngredientIds(text) {
  return [...new Set([...text.matchAll(TOKEN)].map(m => m[1]))];
}

export function minutes(n) {
  if (!n) return '';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}

export function niceDate(iso) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
