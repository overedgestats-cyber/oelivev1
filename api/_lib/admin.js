// Firebase Admin bootstrap used by all API routes
const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(svc) });
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      });
    }
    // eslint-disable-next-line no-console
    console.log('Firebase Admin initialized.');
  } catch (e) {
    console.error('Firebase Admin init failed:', e);
  }
}

const db = (() => { try { return admin.firestore(); } catch { return null; } })();
const auth = (() => { try { return admin.auth(); } catch { return null; } })();

const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing')
  .split(',').map(s => s.trim().toLowerCase());

function getToken(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const err = new Error('missing_token');
    err.status = 401;
    throw err;
  }
  return m[1];
}

async function verify(req) {
  if (!auth) {
    const err = new Error('auth_not_initialized');
    err.status = 500;
    throw err;
  }
  return auth.verifyIdToken(getToken(req));
}

async function hasActiveSub(uid) {
  if (!db) return false;
  try {
    const cust = db.collection('customers').doc(uid);

    // Manual override: proUntil on customers/{uid}
    const doc = await cust.get();
    const raw = doc.exists ? (doc.data()?.proUntil || null) : null;
    if (raw) {
      const d = typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw);
      if (!isNaN(d) && d > new Date()) return true;
    }

    // Stripe subs
    const snap = await cust.collection('subscriptions')
      .where('status', 'in', OK_STATUSES).limit(1).get();
    return !snap.empty;
  } catch (e) {
    console.log('hasActiveSub error', e.message);
    return false;
  }
}

module.exports = { admin, db, auth, verify, hasActiveSub };
