// api/whoami.js
import { admin } from './_lib/admin';

export default async function handler(req, res) {
  try {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).send('missing_token');

    const user = await admin.auth().verifyIdToken(m[1]);
    const { uid, email, aud, iss } = user;

    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    return res.status(200).json({ ok: true, uid, email, aud, iss });
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'invalid_token', detail: e.message });
  }
}
