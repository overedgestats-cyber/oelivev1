// -----------------------------
// OverEdge front-end bootstrap
// -----------------------------

let CFG = null;
let fbApp = null;
let auth = null;
let user = null;

// ----- Load public config (for Firebase keys etc.)
async function loadConfig() {
  const r = await fetch('/api/public-config', { cache: 'no-store' });
  if (!r.ok) throw new Error('Missing /api/public-config');
  CFG = await r.json();
}

// ----- Firebase (modular via CDN)
async function initFirebase() {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
  } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

  fbApp = initializeApp(CFG.firebase);
  auth = getAuth(fbApp);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // Expose sign in / sign out to the window for buttons
  window.signIn = async () => {
    await signInWithPopup(auth, provider);
  };
  window.signOutAll = async () => {
    await signOut(auth);
  };

  onAuthStateChanged(auth, (u) => {
    user = u || null;
    updateHeader();
    document.dispatchEvent(new CustomEvent('authchange', { detail: { user } }));
  });
}

// ----- Header UI (top-right Account + buttons)
function updateHeader() {
  const elUser = document.querySelector('#nav-user');
  const elAuth = document.querySelector('#nav-auth');
  if (!elUser || !elAuth) return;

  if (user) {
    const label = user.email || 'Account';
    elUser.innerHTML = `<a href="/account.html">${label}</a>`;
    elAuth.innerHTML = `<button class="btn" onclick="signOutAll()">Sign out</button>`;
  } else {
    elUser.innerHTML = `<a href="/account.html">Account</a>`;
    elAuth.innerHTML = `<button class="btn" onclick="signIn()">Sign in with Google</button>`;
  }
}

// ----- Public helpers (available to all pages)
window.$user = () => user;

window.$api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  return r.json();
};

window.$authedFetch = async (path, opts = {}) => {
  const u = window.$user?.();
  if (!u) throw Object.assign(new Error('not_signed_in'), { status: 401 });
  const token = await u.getIdToken();
  const r = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    try { err.body = await r.json(); } catch {}
    throw err;
  }
  return r.json();
};

// ----- Boot
(async () => {
  try {
    await loadConfig();
    await initFirebase();
  } catch (e) {
    console.error('Boot error:', e);
  }
})();
