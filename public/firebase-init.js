// Client Firebase init + helpers
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let _app, _auth, _provider;

function ensureInit() {
  if (!_app) {
    if (!window.FIREBASE_CONFIG) throw new Error('Missing FIREBASE_CONFIG');
    _app = getApps().length ? getApps()[0] : initializeApp(window.FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _provider = new GoogleAuthProvider();
  }
  return { app:_app, auth:_auth, provider:_provider };
}
try { if (window.FIREBASE_CONFIG) ensureInit(); } catch {}

export function watchAuth(cb){ return onAuthStateChanged(ensureInit().auth, cb); }
export async function signIn(){ await signInWithPopup(ensureInit().auth, ensureInit().provider); }
export async function signOutUser(){ await signOut(ensureInit().auth); }
export async function getToken(){
  const u = ensureInit().auth.currentUser;
  return u ? await u.getIdToken(true) : null;
}

window.getToken = getToken;
window.signIn = signIn;
window.signOutUser = signOutUser;
window.watchAuth = watchAuth;
