import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const configured = Boolean(firebaseConfig);
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;

export function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}
export const signOutUser = () => signOut(auth);

// Email-link sign-in: works on iPhones where the Google pop-up can fail.
const EMAIL_KEY = 'meals-signin-email';

export async function sendLink(email) {
  await sendSignInLinkToEmail(auth, email, {
    url: location.origin + location.pathname,
    handleCodeInApp: true,
  });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* ignore */ }
}

// Call on page load. Returns true if this visit came from a sign-in email and finished signing in.
export async function finishLink() {
  if (!configured || !isSignInWithEmailLink(auth, location.href)) return false;
  let email = null;
  try { email = localStorage.getItem(EMAIL_KEY); } catch { /* ignore */ }
  if (!email) email = prompt('To finish signing in, type the email address the link was sent to.');
  if (!email) return false;
  await signInWithEmailLink(auth, email.trim().toLowerCase(), location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname);
  return true;
}
export const watchUser = cb => onAuthStateChanged(auth, cb);
