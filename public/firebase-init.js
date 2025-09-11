// Client Firebase init + helpers
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let _app, _auth, _provider;

function ensureInit() {
  if (!_app) {
    if (!window.FIREBASE_CONFIG) throw new Error("Missing FIREBASE_CONFIG");
    _app = getApps().length ? getApps()[0] : initializeApp(window.FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _provider = new GoogleAuthProvider();
  }
  return { app: _app, auth: _auth, provider: _provider };
}

// Eager init if the config is already present (helps avoid races)
try { if (window.FIREBASE_CONFIG) ensureInit(); } catch {}

export function watchAuth(cb) {
  return onAuthStateChanged(ensureInit().auth, cb);
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
  return u ? await u.getIdToken(true) : null;
}

/* COMPAT: allow older code `import { auth } from './firebase-init.js'` */
export const auth = (() => ensureInit().auth)();

/* Optional: make helpers available globally for quick console checks */
window.getToken = getToken;
window.signIn = signIn;
window.signOutUser = signOutUser;
window.watchAuth = watchAuth;
