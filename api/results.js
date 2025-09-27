// api/results.js
import { getDB } from './_firebase';

const CNAME = {
  free: 'results_free',  // one doc per day: {date:'YYYY-MM-DD', picks:[...] }
  hero: 'results_hero',  //           same schema
  pro:  'results_pro',   //           same schema (all markets)
};

function ok(res, data, status = 200) {
  res.status(status).json(data);
}
function bad(res, msg = 'Bad request', status = 400) {
  ok(res, { error: msg }, status);
}

function toYMD(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/** Compute a compact summary */
function computeSummary(days) {
  let wins = 0, losses = 0;
  for (const d of days) {
    const picks = Array.isArray(d.picks) ? d.picks : [];
    for (const p of picks) {
      const s = String(p.status || '').toLowerCase();
      if (s === 'win') wins++;
      else if (s === 'loss' || s === 'lose') losses++;
    }
  }
  const total = wins + losses;
  const winrate = total ? Math.round((wins / total) * 100) : 0;
  return { wins, losses, total, winrate };
}

/** Flat 1u staking ROI */
function computeROI(days) {
  let stake = 0, pnl = 0;
  for (const d of days) {
    for (const p of (d.picks || [])) {
      const s = String(p.status || '').toLowerCase();
      const odds = typeof p.odds === 'number' ? p.odds : null;
      if (odds == null) continue;
      if (s === 'win') { stake += 1; pnl += (odds - 1); }
      else if (s === 'loss' || s === 'lose') { stake += 1; pnl -= 1; }
    }
  }
  const roi = stake ? (pnl / stake) * 100 : 0;
  return { stake, pnl, roi: Math.round(roi * 10) / 10 };
}

/** GET: read results; POST: upsert results */
export default async function handler(req, res) {
  const db = getDB();

  // compatibility shim: allow /api/results?action=free-picks-results
  let { kind, days, from, to, action } = req.query || {};
  if (!kind && action) {
    if (action === 'free-picks-results') kind = 'free';
    else if (action === 'hero-bet-results') kind = 'hero';
    else if (action === 'pro-board-results') kind = 'pro';
  }
  if (!days) days = req.query.limit || 60;

  if (req.method === 'GET') {
    if (!kind || !CNAME[kind]) return bad(res, 'Param "kind" must be one of: free | hero | pro');
    const coll = db.collection(CNAME[kind]);

    try {
      let q = coll.orderBy('date', 'desc').limit(Number(days));
      // Optional window
      if (from) q = coll.where('date', '>=', String(from));
      if (to)   q = q.where('date', '<=', String(to)).orderBy('date', 'desc');

      const snap = await q.get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Normalize to the widget shape
      const daysOut = docs
        .map(d => ({ date: d.date || d.id || '', picks: Array.isArray(d.picks) ? d.picks : [] }))
        .sort((a, b) => a.date.localeCompare(b.date)); // ascending

      const summary = { ...computeSummary(daysOut), ...computeROI(daysOut) };

      return ok(res, { days: daysOut, summary });
    } catch (e) {
      console.error('results GET error', e);
      return bad(res, 'Failed to fetch results', 500);
    }
  }

  if (req.method === 'POST') {
    // secure with a simple token header so you can post from an internal UI/script
    const token = req.headers['x-admin-token'];
    if (!process.env.RESULTS_ADMIN_TOKEN || token !== process.env.RESULTS_ADMIN_TOKEN) {
      return bad(res, 'Unauthorized', 401);
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { kind: bodyKind, date, picks } = body;

      const k = bodyKind || kind;
      if (!k || !CNAME[k]) return bad(res, 'Body.kind must be free|hero|pro');
      if (!date)           return bad(res, 'Body.date (YYYY-MM-DD) required');
      if (!Array.isArray(picks)) return bad(res, 'Body.picks must be an array');

      const id = toYMD(date);
      const ref = db.collection(CNAME[k]).doc(id);

      // merge strategy: replace the whole picks array for that date
      await ref.set({ date: id, picks }, { merge: true });

      return ok(res, { ok: true, id });
    } catch (e) {
      console.error('results POST error', e);
      return bad(res, 'Failed to upsert results', 500);
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return bad(res, 'Method not allowed', 405);
}
