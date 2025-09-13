// public/app.js (ES module)
const FB_APP_URL  = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
const FB_AUTH_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let CFG = null;
let app = null;
let auth = null;
let user = null;

async function loadConfig() {
  const r = await fetch('/api/public-config', { cache: 'no-store' });
  if (!r.ok) throw new Error('Failed to load /api/public-config');
  CFG = await r.json();
}

async function initFirebase() {
  const { initializeApp } = await import(FB_APP_URL);
  const {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
  } = await import(FB_AUTH_URL);

  app  = initializeApp(CFG.firebase);
  auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  // expose simple helpers
  window.signIn = async () => { await signInWithPopup(auth, provider); };
  window.signOutAll = async () => { await signOut(auth); };

  onAuthStateChanged(auth, (u) => {
    user = u || null;

    const elUser = document.querySelector('#nav-user');
    const elAuth = document.querySelector('#nav-auth');

    if (elUser) elUser.textContent = user?.email || 'Account';
    if (elAuth) {
      elAuth.innerHTML = user
        ? `<button class="btn" type="button" onclick="signOutAll()">Sign out</button>`
        : `<button class="btn" type="button" onclick="signIn()">Sign in with Google</button>`;
    }

    document.dispatchEvent(new CustomEvent('authchange', { detail: { user } }));
  });
}

(async function boot() {
  try {
    await loadConfig();
    await initFirebase();
  } catch (e) {
    console.error('boot error', e);
  }
})();

// light helpers for pages
window.$api  = async (path) => (await fetch(path, { cache: 'no-store' })).json();
window.$user = () => user;
