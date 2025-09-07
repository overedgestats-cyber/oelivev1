// /api/subscription/status.js
const admin = require('firebase-admin');
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'not_authenticated' });

    const decoded = await admin.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;

    // Prefer Firestore (source of truth from webhook), fallback to custom claims
    const snap = await db.collection('customers').doc(uid).get();
    const d = snap.exists ? snap.data() : {};
    let active = !!d?.proActive;
    let proUntil = d?.proUntil || null;

    if (!active && decoded?.pro) {
      active = true;
      proUntil = decoded.proUntil || proUntil || null;
    }

    res.json({
      active,
      proUntil,
      email: decoded.email || null
    });
  } catch (e) {
    console.error('status error:', e);
    res.status(500).json({ error: 'status_error', message: e.message });
  }
};

module.exports.config = { runtime: 'nodejs20.x' };
