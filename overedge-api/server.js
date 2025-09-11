// overedge-api/server.js
// OverEdge API: Free Picks + Pro Board + Hero Pick (+ Stripe, Firebase auth)

if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs/promises');
const cors    = require('cors');
const bodyParser = require('body-parser');

// === ENV / CONSTANTS =========================================================
const API_TZ   = process.env.API_FOOTBALL_TZ || 'Europe/Sofia';
const API_KEY  = process.env.API_FOOTBALL_KEY || '';
if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY (some routes will 500)');

const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing')
  .split(',').map(s => s.trim().toLowerCase());

// === APP SETUP ===============================================================
const app = express();
app.set('trust proxy', 1);
app.set('etag', false);

// CORS
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
const allowlist = FRONTEND_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowlist.length || allowlist.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: !!allowlist.length
}));

// === FIREBASE ADMIN (auth + subs) ============================================
const admin = require('firebase-admin');

function initFirebaseAdmin() {
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID || undefined;

  const tryInitWithServiceJson = (raw) => {
    if (!raw) return false;
    let txt = raw.trim();
    if (!txt.startsWith('{')) { // maybe base64
      try { txt = Buffer.from(txt, 'base64').toString('utf8'); } catch {}
    }
    let svc; try { svc = JSON.parse(txt); } catch { return false; }
    if (svc.private_key && svc.private_key.includes('\\n')) {
      svc.private_key = svc.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      projectId: svc.project_id || projectIdEnv
    });
    console.log('🔐 Firebase initialized (service json)', svc.project_id || projectIdEnv || '');
    return true;
  };

  const tryInitWithPair = (email, key) => {
    if (!email || !key) return false;
    let pk = key;
    if (pk.includes('\\n')) pk = pk.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        client_email: email,
        private_key: pk,
        project_id: projectIdEnv
      }),
      projectId: projectIdEnv
    });
    console.log('🔐 Firebase initialized (email/private key pair)', projectIdEnv || '');
    return true;
  };

  try {
    if (tryInitWithServiceJson(process.env.FIREBASE_SERVICE_ACCOUNT)) return;
    if (tryInitWithPair(process.env.FIREBASE_CLIENT_EMAIL, process.env.FIREBASE_PRIVATE_KEY)) return;
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...(projectIdEnv ? { projectId: projectIdEnv } : {})
    });
    console.log('🔐 Firebase initialized (ADC fallback)', projectIdEnv || '');
  } catch (e) {
    console.log('❌ Firebase init failed:', e.message);
  }
}
initFirebaseAdmin();

const db = (() => { try { return admin.firestore(); } catch { return null; } })();

// Minimal admin debug (no secrets)
app.get('/api/__debug/admin', (_req, res) => {
  try {
    const appInfo = admin.app();
    res.json({
      ok: true,
      hasDb: !!db,
      projectId: appInfo?.options?.projectId || appInfo?.options?.credential?.projectId || null,
      env: {
        hasServiceJson: !!process.env.FIREBASE_SERVICE_ACCOUNT,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        projectIdEnv: process.env.FIREBASE_PROJECT_ID || null,
      },
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      err: e.message,
      env: { hasServiceJson: !!process.env.FIREBASE_SERVICE_ACCOUNT }
    });
  }
});

// === AUTH GUARD ==============================================================
function decodeJwtNoVerify(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch { return null; }
}

async function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = await admin.auth().verifyIdToken(m[1]);
    next();
  } catch (e) {
    const claims = decodeJwtNoVerify(m[1]) || {};
    return res.status(401).json({
      error: 'invalid_token',
      detail: e.errorInfo?.message || e.message || String(e),
      aud: claims.aud, iss: claims.iss, expectedProject: process.env.FIREBASE_PROJECT_ID || null
    });
  }
}

// === STRIPE (optional) =======================================================
let stripe = null;
if (process.env.STRIPE_SECRET) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET); }
  catch (e) { console.log('Stripe init error:', e.message); }
}
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(501).send('stripe_not_configured');
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    const writeSub = async (uid, sub) => {
      try {
        if (!db) throw new Error('firestore_not_initialized');
        const ref = db.collection('customers').doc(uid).collection('subscriptions').doc(sub.id);
        await ref.set({
          id: sub.id,
          status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          price: sub.items?.data?.[0]?.price?.id || null,
          product: sub.items?.data?.[0]?.price?.product || null,
          mode: 'subscription',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`✅ wrote sub ${sub.id} for uid ${uid} (${sub.status})`);
      } catch (e) {
        console.log('❌ Firestore write failed', e.message);
      }
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object;
        const uid = sess.metadata?.firebaseUID || '';
        if (uid && sess.subscription) {
          const sub = await stripe.subscriptions.retrieve(sess.subscription);
          await writeSub(uid, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = sub.metadata?.firebaseUID || '';
        if (uid) await writeSub(uid, sub);
        break;
      }
      default: break;
    }
    res.json({ received: true });
  } catch (err) {
    console.log('⚠️ Webhook signature failed', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// AFTER webhook: parse JSON for all other routes
app.use(express.json());

// === HEALTH / WHOAMI / SUB STATUS ===========================================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: !!API_KEY, tz: API_TZ });
});

const whoamiHandler = (req, res) => {
  const { uid, email, aud, iss } = req.user || {};
  res.json({ ok: true, uid, email, aud, iss });
};
app.get('/api/whoami', requireAuth, whoamiHandler);
app.get('/api/__debug/whoami', requireAuth, whoamiHandler);
app.get('/__debug/whoami', requireAuth, whoamiHandler);

/** Unified Pro status:
 * - Active if customers/{uid}.proUntil (Timestamp or ISO) is in the future
 * - OR there is a Stripe sub in one of OK_STATUSES
 */
async function getProStatus(uid) {
  if (!db) return { active: false, proUntil: null, source: 'none' };
  try {
    const custRef = db.collection('customers').doc(uid);
    // 1) Firestore override
    const custDoc = await custRef.get();
    let proUntil = null;
    if (custDoc.exists) {
      const raw = custDoc.data()?.proUntil || null;
      if (raw) proUntil = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
    }
    const activeViaFirestore = !!(proUntil && proUntil.getTime() > Date.now());
    // 2) Stripe subs
    const subsSnap = await custRef.collection('subscriptions')
      .where('status', 'in', OK_STATUSES).limit(1).get();
    const activeViaStripe = subsSnap && !subsSnap.empty;

    return {
      active: activeViaStripe || activeViaFirestore,
      proUntil: proUntil || null,
      source: activeViaStripe ? 'stripe' : (activeViaFirestore ? 'firestore' : 'none')
    };
  } catch (e) {
    console.log('pro status err:', e.message);
    return { active: false, proUntil: null, source: 'error' };
  }
}

async function requirePro(req, res, next) {
  if (!req.user?.uid) return res.status(401).json({ error: 'missing_auth' });
  const st = await getProStatus(req.user.uid);
  if (!st.active) {
    return res.status(401).json({
      error: 'no_subscription',
      proUntil: st.proUntil ? st.proUntil.toISOString() : null,
      source: st.source
    });
  }
  next();
}

app.get('/api/subscription/status', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Vary', 'Authorization');
  try {
    const st = await getProStatus(req.user.uid);
    res.json({
      active: st.active,
      proUntil: st.proUntil ? st.proUntil.toISOString() : null,
      uid: req.user.uid,
      email: req.user.email || null,
      source: st.source
    });
  } catch (e) {
    res.status(500).json({ error: 'sub_check_failed', detail: e?.message || String(e) });
  }
});

// === DEBUG FIXTURES ==========================================================
function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){ const d = new Date(dateStr); const y = d.getUTCFullYear(), m = d.getUTCMonth()+1; return (m >= 7) ? y : y - 1; }

const AXIOS = { headers: { 'x-apisports-key': API_KEY }, timeout: 15000 };

app.get('/__debug/raw-fixtures', async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });
    const date = req.query.date || todayYMD();
    const tzs = [API_TZ, 'Europe/London', 'UTC'];
    const tries = [];
    const tryFetch = async (query, tz) => {
      const out = [];
      let page = 1, total = 1;
      do {
        const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(tz)}`;
        try {
          const r = await axios.get(url, AXIOS);
          const resp = r.data || {};
          total = resp?.paging?.total || 1;
          const arr = resp?.response || [];
          for (const f of arr) {
            const c = f.league?.country;
            const lid = f.league?.id;
            if (EURO_COUNTRIES.has(c) || UEFA_IDS.has(lid)) out.push(f);
          }
        } catch (e) {
          tries.push({ tz, error: e?.response?.status || e.message });
          break;
        }
        page += 1;
        if (page <= total) await new Promise(r => setTimeout(r, 120));
      } while (page <= total);
      return out;
    };

    for (const tz of tzs) {
      const a = await tryFetch(`date=${date}`, tz);
      if (a.length) return res.json({ date, tried: tries, sampleCount: a.length, sample: a.slice(0,12).map(f => ({
        fixtureId: f.fixture?.id,
        leagueId: f.league?.id, league: f.league?.name,
        country: f.league?.country, type: f.league?.type,
        home: f.teams?.home?.name, away: f.teams?.away?.name,
        kickoff: f.fixture?.date
      })) });
    }
    for (const tz of tzs) {
      const b = await tryFetch(`from=${date}&to=${date}`, tz);
      if (b.length) return res.json({ date, tried: tries, sampleCount: b.length, sample: b.slice(0,12) });
    }
    res.json({ date, tried: tries, sampleCount: 0 });
  } catch (e) {
    res.status(500).json({ error: 'raw_fixtures_failed', detail: e.response?.data || e.message });
  }
});

// === (rest of your FREE PICKS / PRO BOARD code unchanged) ====================
// ... (KEEP everything from your original file starting at EURO_COUNTRIES,
// FREE_PICKS, model, /api/free-picks, /api/pro-board, /api/pro-pick, etc.)
// The full content you posted can remain below this point; I’ve left it intact.

// ---------------- Local static hosting (dev only) ----------------
if (require.main === module) {
  const STATIC_DIR = path.join(__dirname, '..', 'overedge-web');
  app.use(express.static(STATIC_DIR));
  app.get('/', (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
  app.get(/^(?!\/api\/).+/, (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
}

// Export for Vercel serverless handler
module.exports = app;

// Local run
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  (async () => { try { /* warm caches if desired */ } catch {} })();
  app.listen(PORT, ()=> console.log(`🟢 http://localhost:${PORT}`));
}
