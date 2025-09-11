const admin = require('firebase-admin');

if (!admin.apps.length) {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (svc) admin.initializeApp({ credential: admin.credential.cert(svc) });
  else admin.initializeApp();
}

function decodeJwtNoVerify(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });

  try {
    const user = await admin.auth().verifyIdToken(m[1]);
    const { uid, email, aud, iss } = user;
    res.json({ ok: true, uid, email, aud, iss });
  } catch (e) {
    const claims = decodeJwtNoVerify(m[1]);
    res.status(401).json({ error: 'invalid_token', detail: e.message, aud: claims.aud, iss: claims.iss });
  }
};
