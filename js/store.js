// Data layer: Firestore. One shared household, so everyone signed in sees the same data.
//
// members/{email}              who may sign in (added by hand in the Firebase console)
// recipes/{id}                 a recipe, including its family rating
// recipes/{id}/notes/{noteId}  dated notes

// plan/{YYYY-MM-DD}             one dinner per night (see planner.js for the shape)

import { db, auth } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, orderBy, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { buildHistory } from './planner.js';

export async function isMember(email) {
  try {
    return (await getDoc(doc(db, 'members', email))).exists();
  } catch {
    return false;
  }
}

export async function listRecipes() {
  const snap = await getDocs(collection(db, 'recipes'));
  return snap.docs
    .map(d => ({ ...d.data(), id: d.id }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getRecipe(id) {
  const d = await getDoc(doc(db, 'recipes', id));
  if (!d.exists()) return null;
  const notes = await getDocs(query(collection(db, 'recipes', id, 'notes'), orderBy('date', 'desc')));
  return { ...d.data(), id, rating: d.data().rating ?? 0, notes: notes.docs.map(n => ({ ...n.data(), id: n.id })) };
}

// ---------- plan ----------

// The whole plan is small (one row per night), so it's read in one go.
export async function getPlan() {
  const snap = await getDocs(collection(db, 'plan'));
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
}

export async function setNight(date, entry) {
  await setDoc(doc(db, 'plan', date), { ...entry, date, updatedAt: new Date().toISOString() });
}

export async function setNights(map) {
  const batch = writeBatch(db);
  for (const [date, entry] of Object.entries(map)) {
    batch.set(doc(db, 'plan', date), { ...entry, date, updatedAt: new Date().toISOString() });
  }
  await batch.commit();
}

export async function clearNight(date) {
  await deleteDoc(doc(db, 'plan', date));
}

export async function clearNights(dates) {
  const batch = writeBatch(db);
  dates.forEach(d => batch.delete(doc(db, 'plan', d)));
  await batch.commit();
}

// ---------- saved for Claude ----------
// inbox/{id} = { url, title, addedAt, addedBy }: links the site couldn't import, for Claude to add.

const sameUrl = u => String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();

export async function listInbox() {
  const snap = await getDocs(collection(db, 'inbox'));
  return snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export async function addToInbox(url, title = '') {
  const existing = await listInbox();
  if (existing.some(x => sameUrl(x.url) === sameUrl(url))) return false;
  await addDoc(collection(db, 'inbox'), {
    url, title, addedAt: new Date().toISOString(), addedBy: (auth.currentUser?.displayName || '').split(' ')[0],
  });
  return true;
}

export async function removeFromInbox(id) {
  await deleteDoc(doc(db, 'inbox', id));
}

// Called after recipes are saved: their links are done.
async function clearInboxFor(recipes) {
  const urls = new Set(recipes.map(r => sameUrl(r.source?.url)).filter(Boolean));
  if (!urls.size) return;
  const items = await listInbox();
  await Promise.all(items.filter(x => urls.has(sameUrl(x.url))).map(x => removeFromInbox(x.id)));
}

// ---------- pantry staples ----------
// settings/staples = { add: [items you always have], remove: [items a recipe called a staple that aren't] }

export async function getStaples() {
  const d = await getDoc(doc(db, 'settings', 'staples'));
  return { add: [], remove: [], ...(d.exists() ? d.data() : {}) };
}

export async function saveStaples(staples) {
  await setDoc(doc(db, 'settings', 'staples'), { add: staples.add, remove: staples.remove });
}

// Times made: every recipe night on the calendar before today.
export async function getHistory() {
  return buildHistory(Object.values(await getPlan()));
}

export async function cookedHistory(id) {
  return (await getHistory())[id] ?? { count: 0, last: null };
}

export async function setRating(id, stars) {
  await updateDoc(doc(db, 'recipes', id), { rating: stars });
}

function firstName() {
  return (auth.currentUser?.displayName || '').split(' ')[0];
}

export async function addNote(id, text) {
  const note = { date: new Date().toISOString(), text, author: firstName() };
  const ref = await addDoc(collection(db, 'recipes', id, 'notes'), note);
  return { ...note, id: ref.id };
}

export async function deleteNote(id, noteId) {
  await deleteDoc(doc(db, 'recipes', id, 'notes', noteId));
}

// Adds new recipes or replaces existing ones with the same id.
// An existing rating is kept unless the file gives a new one.
export async function saveRecipes(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of list.slice(i, i + 400)) {
      const { id, notes, previewHistory, ...data } = r;
      if (!data.rating) delete data.rating;
      data.updatedAt = new Date().toISOString();
      batch.set(doc(db, 'recipes', id), data, { merge: true });
    }
    await batch.commit();
  }
  try { await clearInboxFor(list); } catch (err) { console.error(err); }
}

export async function deleteRecipe(id) {
  const notes = await getDocs(collection(db, 'recipes', id, 'notes'));
  await Promise.all(notes.docs.map(n => deleteDoc(n.ref)));
  await deleteDoc(doc(db, 'recipes', id));
}
