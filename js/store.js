// Data layer. For now: sample recipes + this browser's localStorage.
// When Firebase is set up, these same functions will read and write Firestore,
// so the pages don't need to change.

import { SAMPLE_RECIPES } from '../data/sample-recipes.js';

const KEY = 'meals-preview-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: changes last until reload */ }
}

const state = Object.assign({ ratings: {}, notes: {} }, load());

function withUserData(r) {
  return {
    ...r,
    rating: state.ratings[r.id] ?? r.rating ?? 0,
    notes: [...(state.notes[r.id] ?? r.notes ?? [])],
  };
}

export async function listRecipes() {
  return SAMPLE_RECIPES.map(withUserData);
}

export async function getRecipe(id) {
  const r = SAMPLE_RECIPES.find(x => x.id === id);
  return r ? withUserData(r) : null;
}

// Times made comes from the calendar once the planner exists; samples carry a stand-in.
export async function cookedHistory(id) {
  const r = SAMPLE_RECIPES.find(x => x.id === id);
  return r?.previewHistory ?? { count: 0, last: null };
}

export async function setRating(id, stars) {
  state.ratings[id] = stars;
  save();
}

export async function addNote(id, text) {
  const r = SAMPLE_RECIPES.find(x => x.id === id);
  const list = state.notes[id] ?? [...(r?.notes ?? [])];
  const note = { id: 'n' + Date.now(), date: new Date().toISOString(), text };
  list.unshift(note);
  state.notes[id] = list;
  save();
  return note;
}

export async function deleteNote(id, noteId) {
  const r = SAMPLE_RECIPES.find(x => x.id === id);
  const list = state.notes[id] ?? [...(r?.notes ?? [])];
  state.notes[id] = list.filter(n => n.id !== noteId);
  save();
}
