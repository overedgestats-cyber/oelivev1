// public/app.js  (NO <script> tag here)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let CFG = null, app = null, auth = null, user = null;

// Load public config from your backend
async function loadConfig() {
  const r = await fetch("/api/public-config", { cache: "no-store" });
  if (!r.ok) throw new Error("Missing /api/public-config");
  CFG = await r.json();   // must contain { firebase: { ... } }
}

// Init Firebase
function initFirebase() {
  app = initializeApp(CFG.firebase);
  auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  // expose helpers for buttons in the DOM
  window.signIn = () => signInWithPopup(auth, provider);
  window.signOutAll = () => signOut(auth);

  onAuthStateChanged(auth, (u) => {
    user = u || null;

    const elUser = document.querySelector("#nav-user");
    const elAuth = document.querySelector("#nav-auth");

    if (elUser) elUser.textContent = user?.email || "Account";
    if (elAuth) {
      elAuth.innerHTML = user
        ? `<button class="btn" type="button" onclick="signOutAll()">Sign out</button>`
        : `<button class="btn" type="button" onclick="signIn()">Sign in with Google</button>`;
    }

    document.dispatchEvent(new CustomEvent("authchange", { detail: { user } }));
  });
}

// Boot
async function boot() {
  try {
    await loadConfig();
    initFirebase();
  } catch (e) {
    console.error("Boot failed:", e);
  }
}
boot();

// Small helpers available to pages
window.$api = async (path) => (await fetch(path, { cache: "no-store" })).json();
window.$user = () => user;
