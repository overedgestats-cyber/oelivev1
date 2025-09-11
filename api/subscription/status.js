const admin = require('firebase-admin');

if (!admin.apps.length) {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (svc) admin.initializeApp({ credential: admin.credential.cert(svc) });
  else admin.initializeApp();
}

function toDate(raw) {
  if (!raw) return null;
  return typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw);
}

const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing')
  .split(',').map(s => s.trim().toLowerCase());

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');

  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ ok:false, error:'missing_token' });

  try {
    const user = await admin.auth().verifyIdToken(m[1]);
    const uid = user.uid;
    const email = user.email || null;

    const db = admin.firestore();
    const custRef = db.collection('customers').doc(uid);

    const [custDoc, subsSnap] = await Promise.all([
      custRef.get(),
      custRef.collection('subscriptions').orderBy('updatedAt', 'desc').limit(5).get().catch(() => null),
    ]);

    let proUntil = null;
    if (custDoc.exists) proUntil = toDate(custDoc.data().proUntil);

    let active = false;
    if (proUntil && proUntil > new Date()) {
      active = true;
    } else if (subsSnap && !subsSnap.empty) {
      active = subsSnap.docs.some(d =>
        OK_STATUSES.includes((d.data().status || '').toLowerCase())
      );
    }

    res.json({ ok:true, active, uid, email, proUntil, okStatuses: OK_STATUSES, source: 'function' });
  } catch (e) {
    res.status(500).json({ ok:false, error:'sub_check_failed', detail:e.message });
  }
};
