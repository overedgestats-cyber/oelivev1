// Firebase v10 (modular) via CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut, getIdToken
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const app = initializeApp(window.FIREBASE_CONFIG);
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export function watchAuth(cb){ onAuthStateChanged(auth, cb); }
export async function signIn(){ await signInWithPopup(auth, provider); }
export async function signOutUser(){ await signOut(auth); }
export async function getToken(){ return auth.currentUser ? await getIdToken(auth.currentUser, true) : null; }
