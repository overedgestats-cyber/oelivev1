const { verify, hasActiveSub, db } = require('../_lib/admin');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Vary', 'Authorization');
  try {
    const user = await verify(req);
    const uid = user.uid;

    let proUntil = null, statuses = [];
    if (db) {
      const cust = db.collection('customers').doc(uid);
      const [custDoc, subs] = await Promise.all([
        cust.get(),
        cust.collection('subscriptions').orderBy('updatedAt', 'desc').limit(5).get().catch(()=>null)
      ]);
      if (custDoc.exists) {
        const raw = custDoc.data()?.proUntil || null;
        if (raw) proUntil = typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw);
      }
      if (subs && !subs.empty) {
        statuses = subs.docs.map(d => {
          const x = d.data() || {};
          return {
            id: d.id,
            status: (x.status || '').toLowerCase(),
            current_period_end: x.current_period_end || null,
            updatedAt: x.updatedAt || null,
          };
        });
      }
    }

    const active = await hasActiveSub(uid);
    res.status(200).json({ ok: true, active, uid, email: user.email || null, proUntil, statuses });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: 'sub_check_failed', detail: e.message || String(e) });
  }
};
