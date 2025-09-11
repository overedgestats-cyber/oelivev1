// api/subscription/status.js
import { admin, db } from '../_lib/admin';

const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing')
  .split(',')
  .map(s => s.trim().toLowerCase());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Vary', 'Authorization');

  try {
    const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: 'missing_token' });

    const user = await admin.auth().verifyIdToken(m[1]);
    const uid = user.uid;

    if (!db) {
      return res.status(500).json({
        ok: false, error: 'sub_check_failed', detail: 'firestore_not_initialized'
      });
    }

    let active = false;
    let proUntil = null;
    let statuses = [];

    const custRef = db.collection('customers').doc(uid);
    const [custDoc, subsSnap] = await Promise.all([
      custRef.get(),
      custRef.collection('subscriptions').orderBy('updatedAt', 'desc').limit(5).get().catch(() => null),
    ]);

    if (custDoc.exists) {
      const raw = custDoc.data()?.proUntil || null;
      if (raw) {
        const d = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
        if (!isNaN(d)) proUntil = d;
      }
    }

    if (subsSnap && !subsSnap.empty) {
      statuses = subsSnap.docs.map(d => {
        const x = d.data() || {};
        return {
          id: d.id,
          status: (x.status || '').toLowerCase(),
          current_period_end: x.current_period_end || null,
          updatedAt: x.updatedAt || null,
        };
      });
      active = statuses.some(s => OK_STATUSES.includes(s.status));
    }

    if (!active && proUntil && proUntil > new Date()) active = true;

    return res.status(200).json({
      ok: true,
      active,
      uid,
      email: user.email || null,
      proUntil,
      statuses,
      source: 'firestore',
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: 'sub_check_failed',
      detail: e.message,
      hint: 'Ensure FIREBASE_SERVICE_ACCOUNT (JSON) or FIREBASE_PROJECT_ID is set in Vercel Env.',
    });
  }
}
