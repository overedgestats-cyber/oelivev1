// public/auth.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const LS_KEY = "oe.user";
let auth = null;

// --------- helpers ---------
const $ = (id) => document.getElementById(id);

function getLocalUser() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch { return null; }
}
function setLocalUser(u) {
  if (!u) localStorage.removeItem(LS_KEY);
  else localStorage.setItem(LS_KEY, JSON.stringify(u));
}
function humanFirebaseError(e) {
  const c = e?.code || "";
  if (c.includes("operation-not-allowed")) return "Google provider is disabled in Firebase.";
  if (c.includes("unauthorized-domain"))   return "This domain is not authorized in Firebase Authentication.";
  if (c.includes("popup-blocked"))         return "Popup blocked. Using redirect flow…";
  if (c.includes("popup-closed-by-user"))  return "Popup closed before completing.";
  if (c.includes("invalid-api-key"))       return "Invalid Firebase API key/config.";
  return e?.message || "Unknown error";
}

async function initFirebase() {
  try {
    const res = await fetch("/api/rpc?action=public-config");
    const cfg = (await res.json())?.firebase || {};
    if (!cfg.apiKey) { console.warn("Firebase config missing. Check Vercel env vars."); return null; }
    if (!getApps().length) initializeApp(cfg);
    return getAuth();
  } catch (err) {
    console.error("Failed to load Firebase config", err);
    return null;
  }
}

async function signInFlow() {
  if (!auth) return;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code || "";
    if (code.includes("popup-")) {
      // Fallback: works even with popup blockers
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithRedirect(auth, provider);
      return;
    }
    alert("Google sign-in failed: " + humanFirebaseError(e));
  }
}

async function signOutFlow() {
  if (!auth) return;
  try { await signOut(auth); } catch {}
}

function renderNav(user) {
  const btn = $("nav-auth");
  const badge = $("nav-plan");
  if (!btn) return; // page may not include the button

  if (user) {
    btn.textContent = "Sign Out";
    btn.classList.add("secondary");
    btn.onclick = () => signOutFlow();
    const u = getLocalUser();
    if (badge) {
      const pro = u?.pro === true;
      badge.style.display = "";
      badge.className = "badge" + (pro ? "" : " muted");
      badge.textContent = pro ? "Pro" : "Free";
    }
  } else {
    btn.textContent = "Sign In";
    btn.classList.add("secondary");
    btn.onclick = () => signInFlow();
    if (badge) badge.style.display = "none";
  }
}

// --------- boot ---------
(async function boot() {
  auth = await initFirebase();
  if (!auth) return;

  try { await getRedirectResult(auth); } catch {}

  onAuthStateChanged(auth, (user) => {
    if (user) {
      const prev = getLocalUser() || {};
      setLocalUser({ email: user.email, uid: user.uid, pro: !!prev.pro, plan: prev.plan || null });
    } else {
      setLocalUser(null);
    }
    renderNav(user);
  });

  // initial paint
  renderNav(auth.currentUser);
})();

// Optional debugging helpers
window.oeAuth = {
  get user() { return auth?.currentUser || null; },
  signIn:  () => signInFlow(),
  signOut: () => signOutFlow()
};
