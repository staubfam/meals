// Data layer: Firestore. One shared household, so everyone signed in sees the same data.
//
// members/{email}              who may sign in (added by hand in the Firebase console)
// recipes/{id}                 a recipe, including its family rating
// recipes/{id}/notes/{noteId}  dated notes

import { db, auth } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, updateDoc, deleteDoc, addDoc, query, orderBy, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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

// Times made will come from the calendar once the planner is built.
export async function cookedHistory() {
  return { count: 0, last: null };
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
}

export async function deleteRecipe(id) {
  const notes = await getDocs(collection(db, 'recipes', id, 'notes'));
  await Promise.all(notes.docs.map(n => deleteDoc(n.ref)));
  await deleteDoc(doc(db, 'recipes', id));
}
