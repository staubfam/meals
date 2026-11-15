// Turns a recipe web page (or pasted text) into this site's recipe format.
// No Firebase or page code, so it can be tested on its own.

export const TARGET_SERVINGS = 6;
export const PROTEINS = ['Chicken', 'Beef', 'Pork', 'Sausage', 'Turkey', 'Seafood', 'Vegetarian', 'Other'];

// ---------- text cleanup ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- reading the hidden recipe data on a page ----------

function findRecipe(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { for (const x of o) { const r = findRecipe(x); if (r) return r; } return null; }
  const t = o['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return o;
  for (const v of Object.values(o)) { const r = findRecipe(v); if (r) return r; }
  return null;
}

function flattenSteps(x, out = []) {
  for (const s of [].concat(x || [])) {
    if (typeof s === 'string') clean(s).split(/\n+/).forEach(t => t && out.push(t));
    else if (s?.['@type'] === 'HowToSection') {
      const before = out.length;
      flattenSteps(s.itemListElement, out);
      if (s.name && out.length > before) out[before] = `${clean(s.name).replace(/:$/, '')}: ${out[before]}`;
    } else if (s) out.push(clean(s.text || s.name || ''));
  }
  return out.filter(Boolean);
}

export function isoMinutes(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(s || '');
  return m ? (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : 0;
}

const num = v => { const m = /[\d.]+/.exec(String(v ?? '')); return m ? Math.round(Number(m[0])) : undefined; };

// Returns null when the page has no recipe data (or is a "checking your browser" page).
export function readRecipePage(html, url = '') {
  let recipe = null;
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipe = findRecipe(JSON.parse(m[1].trim())); } catch { /* skip bad block */ }
    if (recipe) break;
  }
  const pageTitle = clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
  if (!recipe) return { found: false, pageTitle };

  const siteMeta = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i.exec(html);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const yieldText = clean([].concat(recipe.recipeYield || [])[0]);
  const n = recipe.nutrition || {};
  const nutrition = {
    calories: num(n.calories), protein: num(n.proteinContent), carbs: num(n.carbohydrateContent), fat: num(n.fatContent),
    fiber: num(n.fiberContent), sugar: num(n.sugarContent), sodium: num(n.sodiumContent),
  };
  Object.keys(nutrition).forEach(k => nutrition[k] === undefined && delete nutrition[k]);

  return {
    found: true,
    title: clean(recipe.name),
    description: clean(recipe.description).slice(0, 280),
    yieldText,
    servings: num(yieldText) || 0,
    prepMin: isoMinutes(recipe.prepTime),
    cookMin: isoMinutes(recipe.cookTime) || Math.max(0, isoMinutes(recipe.totalTime) - isoMinutes(recipe.prepTime)),
    ingredients: [].concat(recipe.recipeIngredient || recipe.ingredients || []).map(clean).filter(Boolean),
    steps: flattenSteps(recipe.recipeInstructions),
    nutrition: Object.keys(nutrition).length ? nutrition : null,
    siteName: clean(recipe.publisher?.name || siteMeta?.[1] || '') || host,
  };
}

// ---------- reading one ingredient line ----------

const FRACTION_CHARS = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅕': '1/5', '⅙': '1/6' };
const NUMBER = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+`;
const QTY_RE = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?\s*`);
const toNumber = s => s.trim().split(/\s+/).reduce((sum, p) => sum + (p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p)), 0);

const UNITS = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp', t: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', T: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  clove: 'clove', cloves: 'clove', can: 'can', cans: 'can',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', jar: 'jar', jars: 'jar',
  bag: 'bag', bags: 'bag', box: 'box', boxes: 'box', pinch: 'pinch', pinches: 'pinch', dash: 'pinch', dashes: 'pinch',
  stalk: 'stalk', stalks: 'stalk', rib: 'stalk', ribs: 'stalk', bunch: 'bunch', bunches: 'bunch', head: 'head', heads: 'head',
  slice: 'slice', slices: 'slice', sprig: 'sprig', sprigs: 'sprig', stem: 'stem', stems: 'stem', stick: 'stick', sticks: 'stick',
  quart: 'quart', quarts: 'quart', qt: 'quart', pint: 'pint', pints: 'pint',
  gram: 'g', grams: 'g', g: 'g', kilogram: 'kg', kilograms: 'kg', kg: 'kg', ml: 'ml', milliliters: 'ml', liter: 'l', liters: 'l', l: 'l',
};
// Turned into units the rest of the site already understands.
const CONVERT = { stick: ['tbsp', 8], quart: ['cup', 4], pint: ['cup', 2] };
const UNIT_RE = /^([A-Za-z]+)\.?(?=[\s,(]|$)\s*(?:of\s+)?/;
const CONTAINER_RE = /^\(?\s*(\d+(?:\.\d+)?)\s*-?\s*(?:oz|ounce|ounces)\.?\s*\)?\s*(can|cans|package|packages|pkg|jar|jars|bag|bags|box|boxes)\b\.?\s*(?:of\s+)?/i;

const KEEP_CAPS = ['Italian', 'Parmesan', 'Mexican', 'Monterey', 'Jack', 'Greek', 'Dijon', 'Cajun', 'Worcestershire', 'Sriracha', 'Romano', 'Asiago', 'Swiss', 'Gruyère', 'Thai', 'French', 'Ranch', 'Alfredo', 'Old Bay', 'Kosher'];
function tidyName(s) {
  let out = s.replace(/^[-–•*\s]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const w of KEEP_CAPS) out = out.replace(new RegExp(`\\b${w.toLowerCase()}\\b`, 'g'), w === 'Kosher' ? 'kosher' : w);
  return out;
}
function singular(w) {
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
  if (/(tomato|potato)es$/.test(w)) return w.replace(/es$/, '');
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

// "1 (15 oz) can black beans, drained" -> { qty: 1, unit: '(15-oz) can', item: 'black beans', note: 'drained' }
export function parseIngredient(line) {
  let s = clean(line).replace(/[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙]/g, c => ' ' + FRACTION_CHARS[c]).replace(/^\s*[-–•*]\s*/, '').trim();
  s = s.replace(/^(\d+)\s+(\d+\/\d+)/, '$1 $2');
  let qty = null;
  let unit = '';
  let rangeNote = '';
  const q = QTY_RE.exec(s);
  if (q) {
    qty = toNumber(q[1]);
    if (q[2]) rangeNote = `${q[1].trim()} to ${q[2].trim()}`;
    s = s.slice(q[0].length);
  }
  s = s.replace(/^whole\s+(?=(heads?|bunch(es)?)\b)/i, '');
  const c = CONTAINER_RE.exec(s);
  if (c) {
    unit = `(${c[1]}-oz) ${UNITS[c[2].toLowerCase()] || c[2].toLowerCase()}`;
    s = s.slice(c[0].length);
  } else {
    const u = UNIT_RE.exec(s);
    const key = u && (u[1].length === 1 ? u[1] : u[1].toLowerCase());
    if (u && UNITS[key] && (qty !== null || u[1].length > 1)) {
      unit = UNITS[key];
      s = s.slice(u[0].length);
      if (CONVERT[unit] && qty !== null) { qty *= CONVERT[unit][1]; unit = CONVERT[unit][0]; }
    }
  }

  // Split "item (note), more note" into item and note.
  s = s.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
  const notes = [];
  for (let guard = 0; guard < 5 && /\([^()]*\)/.test(s); guard++) {
    s = s.replace(/\s*\(([^()]*)\)\s*/g, (m, inner) => { if (inner.trim()) notes.unshift(inner.replace(/^,\s*/, '').trim()); return ' '; });
  }
  s = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const comma = s.indexOf(',');
  if (comma > 0) { notes.unshift(s.slice(comma + 1).trim()); s = s.slice(0, comma); }
  if (/\bto taste\b/i.test(s)) { notes.push('to taste'); s = s.replace(/\s*\bto taste\b/i, ''); }
  if (/\b(optional)\b/i.test(s)) { notes.push('optional'); s = s.replace(/\s*\boptional\b/i, ''); }
  if (rangeNote) notes.push(`${rangeNote}${unit ? ' ' + unit : ''}`);
  let item = tidyName(s.replace(/^of\s+/i, ''));

  // "4 garlic cloves" / "4 cloves of garlic" -> 4 cloves garlic
  if (!unit && /^(garlic cloves?|cloves? garlic)$/.test(item)) { unit = 'clove'; item = 'garlic'; }

  const out = { qty, unit: unit || undefined, item: item || clean(line) };
  if (!unit && qty !== null && qty > 1) {
    const words = out.item.split(' ');
    const last = words.pop();
    const one = singular(last);
    if (one !== last) { out.itemPlural = out.item; out.item = [...words, one].join(' '); }
  }
  const note = notes.join(', ').split(/\s*,\s*/)
    .filter(n => n && !/^note\s*\d+$/i.test(n) && !/^\d+(\.\d+)?\s*(g|ml|oz|grams?)$/i.test(n))
    .join(', ').replace(/\s+/g, ' ').trim();
  if (note) out.note = note;
  return out;
}

// ---------- store aisle and pantry staple guesses ----------

const AISLE_RULES = [
  ['Frozen', /\bfrozen\b/],
  ['Canned goods', /\b(broth|stock|canned|diced tomatoes|crushed tomatoes|tomato (sauce|paste)|coconut milk|beans|chickpeas|salsa|enchilada sauce|corn kernels|sun-dried|olives|artichoke|green chiles)\b/],
  ['Spices', /\b(salt|black pepper|pepper flakes|cayenne|paprika|cumin|chili powder|oregano|thyme|rosemary|basil|garlic powder|onion powder|cinnamon|nutmeg|seasoning|bay leaf|bay leaves|turmeric|curry powder|ginger powder|ground ginger|dried parsley|dried dill|red pepper|white pepper|allspice|cloves ground|old bay)\b/],
  ['Condiments', /\b(oyster sauce|fish sauce|cooking wine|mirin|rice wine|sake|sesame seeds|soy sauce|worcestershire|hot sauce|buffalo sauce|bbq sauce|barbecue sauce|ketchup|mustard|mayo|mayonnaise|dressing|vinegar|sriracha|hoisin|teriyaki|pesto|marinara|alfredo sauce)\b/],
  ['Pantry', /\b(cornflour|corn starch|cornstarch|oil|cooking spray|flour|sugar|honey|maple syrup|breadcrumbs|bread crumbs|panko|cornstarch|baking powder|baking soda|vanilla|water|peanut butter|cocoa|chocolate chips|oats|nuts|almonds|pecans|walnuts|raisins|brown sugar)\b/],
  ['Dairy', /\b(milk|cream|butter|cheese|cheddar|mozzarella|parmesan|yogurt|sour cream|half-and-half|half and half|egg|eggs|ricotta|feta|monterey jack)\b/],
  ['Meat', /\b(chicken|beef|steak|pork|sausage|bacon|turkey|ham|shrimp|salmon|cod|tilapia|fish|lamb|meatballs|ground meat|chorizo|pepperoni|filet|tenderloin|ribs|brisket)\b/],
  ['Pasta & grains', /\b(pasta|penne|spaghetti|linguine|fettuccine|rigatoni|ziti|macaroni|noodles|rice|quinoa|orzo|gnocchi|couscous|lasagna|tortellini|ravioli|farfalle|rotini|egg noodles)\b/],
  ['Bakery', /\b(tortilla|tortillas|bread|bun|buns|rolls|pita|naan|baguette|croutons)\b/],
  ['Produce', /\b(onion|garlic|bell pepper|jalape|tomato|lettuce|spinach|kale|celery|carrot|potato|lemon|lime|cilantro|parsley|basil|dill|chives|scallion|green onion|ginger|mushroom|zucchini|squash|broccoli|cauliflower|avocado|cucumber|apple|berries|corn|cabbage|asparagus|green beans|peas|shallot|herbs|arugula|sprouts|bok choy|choy sum|greens|leaves|jalapeño|serrano|poblano|fresh)\b/],
];
// Order matters above: "chicken broth" is canned, "garlic powder" is a spice, "peanut butter" is pantry.

export function guessAisle(item) {
  const s = item.toLowerCase();
  if (/\bfresh\b/.test(s) && /\b(rosemary|thyme|basil|oregano|dill|parsley|cilantro|mint|sage|chives)\b/.test(s)) return 'Produce';
  for (const [aisle, re] of AISLE_RULES) if (re.test(s) || re.test(s.replace(/(?:es|s)\b/g, ''))) return aisle;
  return 'Other';
}

export function guessStaple(item, aisle) {
  const s = item.toLowerCase();
  if (aisle === 'Spices') return true;
  return /\b(olive oil|vegetable oil|canola oil|cooking oil|oil|cooking spray|water|all-purpose flour|flour|sugar|baking soda|baking powder|vanilla|cornstarch)\b/.test(s) && !/sesame|truffle|coconut/.test(s);
}

export function guessProtein(ingredients, title = '') {
  const text = `${title} ${ingredients.map(i => i.item).join(' ')}`.toLowerCase();
  if (/\b(sausage|kielbasa|chorizo|bratwurst)\b/.test(text)) return 'Sausage';
  if (/\bchicken\b/.test(text)) return 'Chicken';
  if (/\b(beef|steak|filet mignon|brisket|meatball)/.test(text)) return 'Beef';
  if (/\bturkey\b/.test(text)) return 'Turkey';
  if (/\b(pork|bacon|ham|prosciutto)\b/.test(text)) return 'Pork';
  if (/\b(shrimp|salmon|cod|tilapia|tuna|fish|scallops|crab|halibut)\b/.test(text)) return 'Seafood';
  return 'Vegetarian';
}

export function guessTags(title, minutes, ingredients) {
  const t = title.toLowerCase();
  const tags = [];
  if (minutes && minutes <= 30) tags.push('Under 30 minutes');
  if (/one[- ]pot|one[- ]pan/.test(t)) tags.push('One pot');
  if (/sheet[- ]pan/.test(t)) tags.push('Sheet pan');
  if (/slow cooker|crock ?pot/.test(t)) tags.push('Slow cooker');
  if (/instant pot|pressure cooker/.test(t)) tags.push('Instant Pot');
  if (/soup|stew|chili\b/.test(t)) tags.push('Soup');
  if (ingredients.some(i => guessAisle(i.item) === 'Pasta & grains' && /pasta|penne|spaghetti|linguine|fettuccine|rigatoni|ziti|macaroni|noodles|gnocchi|orzo|tortellini|ravioli|rotini|farfalle/.test(i.item))) tags.push('Pasta');
  return tags;
}

// ---------- highlighting amounts inside the steps ----------

const GENERIC = new Set(['fresh', 'large', 'small', 'medium', 'ground', 'chopped', 'shredded', 'grated', 'dried', 'boneless', 'skinless', 'sliced', 'diced', 'minced', 'whole', 'cooked', 'unsalted', 'salted', 'extra', 'virgin', 'light', 'dark', 'sweet', 'mild', 'plain', 'kosher', 'low-sodium', 'reduced', 'packed', 'softened', 'melted', 'cold', 'warm', 'hot', 'red', 'green', 'yellow', 'white', 'black']);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function candidates(item) {
  const words = item.split(' ').filter(Boolean);
  const out = [item];
  if (words.length > 2) out.push(words.slice(-2).join(' '));
  if (words.length > 1 && !GENERIC.has(words[words.length - 1])) out.push(words[words.length - 1]);
  // "boneless skinless chicken breast" is usually just "chicken" in the steps.
  const meat = /\b(chicken|beef|pork|turkey|sausage|shrimp|salmon|steak|lamb)\b/.exec(item);
  if (meat && guessAisle(item) === 'Meat') out.push(meat[1]);
  return [...new Set(out)];
}

// Replace the first match outside existing {iN} tokens.
// Skips a mention right after a number ("6 of the tortillas"), where an amount would read wrong.
function replaceOutsideTokens(text, re, fn) {
  const parts = text.split(/(\{i\d+(?::[^}]*)?\})/);
  const g = new RegExp(re.source, 'gi');
  for (let i = 0; i < parts.length; i += 2) {
    for (const m of parts[i].matchAll(g)) {
      if (/\d[^.;]{0,16}$/.test(parts[i].slice(0, m.index))) continue;
      parts[i] = parts[i].slice(0, m.index) + fn(m[0]) + parts[i].slice(m.index + m[0].length);
      return parts.join('');
    }
  }
  return null;
}

// Each ingredient with an amount is linked once, at its first mention.
export function linkSteps(steps, ingredients) {
  const out = steps.map(s => s.replace(/[{}]/g, ''));
  const order = ingredients.filter(i => i.qty != null).sort((a, b) => b.item.length - a.item.length);
  // A word shared by two ingredients (two kinds of butter) is ambiguous, so it isn't used.
  const uses = {};
  ingredients.forEach(i => candidates(i.item).forEach(c => { uses[c] = (uses[c] || 0) + 1; }));
  // Pass 1 links full names for everyone ("garlic powder" before "garlic"), pass 2 the shorter names.
  const linked = new Set();
  for (const pass of [0, 1]) {
    for (const ing of order) {
      if (linked.has(ing.id)) continue;
      const res = candidates(ing.item)
        .filter((c, k) => (pass === 0 ? k === 0 : k > 0 && uses[c] === 1))
        .map(c => new RegExp(`\\b${escapeRe(c)}(?:e?s)?\\b`, 'i'));
      // Earliest step wins; within a step, the most specific name wins.
      outer: for (let k = 0; k < out.length; k++) {
        for (const re of res) {
          const next = replaceOutsideTokens(out[k], re, match => `{${ing.id}:${match}}`);
          if (next !== null) { out[k] = next; linked.add(ing.id); break outer; }
        }
      }
    }
  }
  return out;
}

// ---------- building the recipe to save ----------

export function slugify(title) {
  return title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'recipe';
}

function pluralize(item) {
  const words = item.split(' ');
  const w = words.pop();
  const pl = /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|z|ch|sh|o)$/.test(w) ? w + 'es' : w + 's';
  return [...words, pl].join(' ');
}

const isHeader = line => /:\s*$/.test(line) && !/\d/.test(line);

export function buildRecipe(f, existingIds = []) {
  const orig = Number(f.origServings) > 0 ? Number(f.origServings) : TARGET_SERVINGS;
  const scale = TARGET_SERVINGS / orig;
  const ingredients = f.ingredientLines.map(l => l.trim()).filter(l => l && !isHeader(l)).map((line, n) => {
    const p = parseIngredient(line);
    const aisle = guessAisle(p.item);
    const ing = { id: `i${n + 1}`, qty: p.qty == null ? null : Math.round(p.qty * scale * 1000) / 1000, item: p.item, aisle };
    if (p.unit) ing.unit = p.unit;
    if (p.itemPlural) ing.itemPlural = p.itemPlural;
    else if (!p.unit && p.qty != null && !/\bof\b/.test(p.item)) ing.itemPlural = pluralize(p.item);
    if (p.note) ing.note = p.note;
    if (guessStaple(p.item, aisle)) ing.staple = true;
    return ing;
  });
  const stepTexts = f.stepLines.map(l => l.trim().replace(/^(step\s*)?\d+[.)]\s*/i, '')).filter(Boolean);
  let id = slugify(f.title);
  for (let k = 2; existingIds.includes(id); k++) id = `${slugify(f.title)}-${k}`;

  const recipe = {
    id,
    title: f.title.trim(),
    description: (f.description || '').trim(),
    servings: TARGET_SERVINGS,
    prepMin: Number(f.prepMin) || 0,
    cookMin: Number(f.cookMin) || 0,
    protein: f.protein || guessProtein(ingredients, f.title),
    tags: f.tags,
    source: { name: f.sourceName || '', url: f.sourceUrl || '' },
    ingredients,
    steps: linkSteps(stepTexts, ingredients),
    tips: [],
    imported: 'link',
  };
  if (f.nutrition) recipe.nutrition = f.nutrition;
  if (f.rating) recipe.rating = f.rating;
  if (orig !== TARGET_SERVINGS) recipe.tips.push(`Scaled to ${TARGET_SERVINGS} servings from the original ${orig}.`);
  return recipe;
}
