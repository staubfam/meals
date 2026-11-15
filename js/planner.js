// Planning logic with no Firebase or page code, so it can be tested on its own.
//
// A plan entry (one per night, keyed by 'YYYY-MM-DD'):
//   { type: 'recipe', recipeId, title, protein, servings, wantToTry }
//   { type: 'special', label }

export const SPECIALS = ['Leftovers', 'Restaurant night', 'Takeout', "Eating at a friend's"];
export const LOCK_DAYS = 10; // past nights older than this can't be changed

// ---------- dates (local time, as 'YYYY-MM-DD') ----------

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
export const todayYmd = () => ymd(new Date());

export function datesBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function weekKey(date) {
  const d = parseYmd(date);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return ymd(d);
}

export const isLocked = (date, today = todayYmd()) => daysBetween(date, today) > LOCK_DAYS;

// ---------- history ----------

// Every recipe night before today counts as made.
export function buildHistory(entries, today = todayYmd()) {
  const h = {};
  for (const e of entries) {
    if (e.type !== 'recipe' || e.date >= today) continue;
    const x = h[e.recipeId] || (h[e.recipeId] = { count: 0, last: null });
    x.count++;
    if (!x.last || e.date > x.last) x.last = e.date;
  }
  return h;
}

// Never made and not rated yet. (Anything you've rated, you've tried.)
export const isWantToTry = (r, history) => !history[r.id]?.count && !r.rating;

// ---------- auto-fill ----------

const RATING_WEIGHT = { 0: 2.5, 1: 0.2, 2: 0.6, 3: 2, 4: 4, 5: 6 };
const MAX_TRY_PER_WEEK = 2;

function nearestGap(recipeId, date, plan, history) {
  const when = Object.entries(plan).filter(([, e]) => e.type === 'recipe' && e.recipeId === recipeId).map(([d]) => d);
  if (history[recipeId]?.last) when.push(history[recipeId].last);
  return when.length ? Math.min(...when.map(d => Math.abs(daysBetween(d, date)))) : Infinity;
}

// Fills only the empty nights in `dates`. Rules, loosened one step at a time only when needed:
// no same protein next to each other, no repeat within 3 weeks, at most 2 want-to-try per week.
// Filling night by night can paint itself into a corner, so try many plans and keep the
// one that bends the rules least.
export function autoFill({ recipes, history, plan, dates, rand = Math.random, tries = 40 }) {
  let best = null;
  for (let i = 0; i < tries; i++) {
    const attempt = autoFillOnce({ recipes, history, plan, dates, rand });
    if (!best || attempt.penalty < best.penalty) best = attempt;
    if (best.penalty === 0) break;
  }
  return { filled: best.filled, stretched: best.stretched };
}

function autoFillOnce({ recipes, history, plan, dates, rand }) {
  const merged = { ...plan };
  const filled = {};
  let stretched = 0;
  let penalty = 0;
  const proteinOn = d => (merged[d]?.type === 'recipe' ? merged[d].protein : null);

  for (const date of dates) {
    if (merged[date] || !recipes.length) continue;
    const prev = proteinOn(addDays(date, -1));
    const next = proteinOn(addDays(date, 1));
    const wk = weekKey(date);
    const tries = Object.entries(merged).filter(([d, e]) => e.type === 'recipe' && e.wantToTry && weekKey(d) === wk).length;

    const info = recipes.map(r => ({
      r,
      gap: nearestGap(r.id, date, merged, history),
      wtt: isWantToTry(r, history) && !Object.values(merged).some(e => e.recipeId === r.id),
      proteinOk: !r.protein || (r.protein !== prev && r.protein !== next),
    }));
    const capOk = x => !x.wtt || tries < MAX_TRY_PER_WEEK;
    const tiers = [
      x => capOk(x) && x.proteinOk && x.gap >= 21,
      x => capOk(x) && x.proteinOk && x.gap >= 14,
      x => capOk(x) && x.proteinOk && x.gap >= 7,
      x => capOk(x) && x.gap >= 3,
      x => x.gap >= 3,
      x => x.gap >= 1,
    ];
    let tier = 0;
    let pool = [];
    for (; tier < tiers.length; tier++) {
      pool = info.filter(tiers[tier]);
      if (pool.length) break;
    }
    if (!pool.length) pool = info;
    if (tier > 0) stretched++;
    penalty += tier * tier;

    // Proteins with more choices left get picked a bit more, so the rarer ones are saved
    // for the nights between (otherwise 4 chicken recipes end up back to back).
    const perProtein = {};
    pool.forEach(x => { perProtein[x.r.protein] = (perProtein[x.r.protein] || 0) + 1; });
    const base = x => (x.wtt ? (tries < MAX_TRY_PER_WEEK ? 3.5 : 0.5) : RATING_WEIGHT[x.r.rating || 0] ?? 2.5);
    const weight = x => base(x) * perProtein[x.r.protein];
    let pick = rand() * pool.reduce((s, x) => s + weight(x), 0);
    let chosen = pool[pool.length - 1];
    for (const x of pool) {
      pick -= weight(x);
      if (pick <= 0) { chosen = x; break; }
    }
    const entry = {
      type: 'recipe', recipeId: chosen.r.id, title: chosen.r.title, protein: chosen.r.protein || '',
      servings: chosen.r.servings || 6, wantToTry: chosen.wtt,
    };
    merged[date] = entry;
    filled[date] = entry;
  }
  return { filled, stretched, penalty };
}

// ---------- "Want something else" ----------

// Favorites first, then the same protein (you already bought it), then not made recently.
export function suggestSwaps({ recipes, history, plan, date, current, limit = 5 }) {
  return recipes
    .filter(r => r.id !== current?.recipeId)
    .map(r => {
      const gap = nearestGap(r.id, date, plan, history);
      const score = (r.rating >= 4 ? 100 : 0)
        + (current?.protein && r.protein === current.protein ? 50 : 0)
        + (gap >= 14 ? 25 : 0)
        + (r.rating || 0) * 5
        + Math.min(gap, 60) / 10;
      return { r, gap, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// "made 3 days ago", "planned in 5 days", "not made yet"
export function lastMadeText(history, recipeId, today = todayYmd()) {
  const last = history[recipeId]?.last;
  if (!last) return 'Not made yet';
  const n = daysBetween(last, today);
  if (n <= 1) return 'Made yesterday';
  if (n < 14) return `Made ${n} days ago`;
  if (n < 60) return `Made ${Math.round(n / 7)} weeks ago`;
  return `Made ${Math.round(n / 30)} months ago`;
}
