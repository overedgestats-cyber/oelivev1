/* public/firebase-init.js */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let _app = null;
let _auth = null;
let _provider = null;

export function ensureInit() {
  if (!_app) {
    if (!window.FIREBASE_CONFIG) {
      throw new Error("FIREBASE_CONFIG missing вЂ“ did /firebase-config.js load?");
    }
    _app = getApps().length ? getApps()[0] : initializeApp(window.FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _provider = new GoogleAuthProvider();
  }
  return { app: _app, auth: _auth, provider: _provider };
}

// Eager bootstrap when config is already present (avoids races)
try { if (window.FIREBASE_CONFIG) ensureInit(); } catch {}

export function watchAuth(cb) {
  const { auth } = ensureInit();
  return onAuthStateChanged(auth, cb);
}

export async function signIn() {
  const { auth, provider } = ensureInit();
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  const { auth } = ensureInit();
  await signOut(auth);
}

export async function getToken() {
  const { auth } = ensureInit();
  const u = auth.currentUser;
  return u ? await u.getIdToken() : null;
}

export const auth = (() => ensureInit().auth)();
