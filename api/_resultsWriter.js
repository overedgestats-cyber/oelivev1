// api/_resultsWriter.js
import { getFirestore, serverTimestamp } from './_firebase.js';

/**
 * We keep one doc per day per “kind”:
 *  collectionName(kind) => results_free_picks | results_hero | results_pro
 *  docId = YYYY-MM-DD
 *  doc shape: { date, picks: [ ... ], updatedAt }
 *
 * We merge by a stable key, so re-running doesn’t duplicate.
 */
function colName(kind = 'free-picks') {
  if (kind === 'hero-bet') return 'results_hero';
  if (kind === 'pro-board') return 'results_pro';
  return 'results_free_picks';
}

// Normalizers to make an idempotent key
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function makeKey(p) {
  // using selection or pick + market for uniqueness
  const sel = p.selection || p.pick || '';
  return [
    p.date,
    norm(p.home),
    norm(p.away),
    norm(p.market || ''),
    norm(sel)
  ].join('|');
}

/**
 * Save/merge today’s picks for a “kind”.
 * Each pick should include minimally:
 *   { date:'YYYY-MM-DD', matchTime, country, league, home, away, market, selection, odds }
 * We set status:'pending' unless caller provides status.
 */
export async function writeDailyPicks(kind, dateYMD, picks = []) {
  const db = getFirestore();
  const ref = db.collection(colName(kind)).doc(dateYMD);

  // read current doc (if any)
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() || {}) : {};
  const curPicks = Array.isArray(cur.picks) ? cur.picks : [];
  const byKey = new Map(curPicks.map(p => [makeKey(p), p]));

  for (const p of picks) {
    if (!p?.home || !p?.away) continue;
    const base = {
      date: p.date || dateYMD,
      matchTime: p.matchTime || null,
      country: p.country || null,
      league: p.league || null,
      home: p.home,
      away: p.away,
      market: p.market || null,
      selection: p.selection || p.pick || null,
      odds: (typeof p.odds === 'number' ? p.odds : null),
      status: p.status || 'pending', // will be updated to win/lose/push later
      source: p.source || 'rpc',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const k = makeKey(base);
    // merge (do not erase status if it was already settled)
    const prev = byKey.get(k);
    if (prev && prev.status && prev.status !== 'pending') {
      byKey.set(k, { ...prev, ...base, status: prev.status, updatedAt: serverTimestamp() });
    } else {
      byKey.set(k, { ...(prev || {}), ...base, updatedAt: serverTimestamp() });
    }
  }

  const next = Array.from(byKey.values());
  await ref.set({ date: dateYMD, picks: next, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Settle a single pick (or update fields like closing odds).
 * Provide the same identity fields you used when writing (date/home/away/market/selection),
 * and any of: { status:'win'|'lose'|'loss'|'push', closing:Number }
 */
export async function settlePick(kind, identity, patch) {
  const { date, home, away, market, selection, pick } = identity || {};
  const dateYMD = String(date || '').slice(0,10);
  if (!dateYMD || !home || !away) throw new Error('settlePick: missing date/home/away');

  const db = getFirestore();
  const ref = db.collection(colName(kind)).doc(dateYMD);
  const snap = await ref.get();
  if (!snap.exists) return; // nothing to update

  const data = snap.data() || {};
  const arr = Array.isArray(data.picks) ? data.picks : [];

  const key = makeKey({ date: dateYMD, home, away, market, selection: selection || pick });
  let changed = false;

  const updated = arr.map(p => {
    const k = makeKey(p);
    if (k !== key) return p;
    changed = true;
    return {
      ...p,
      ...(patch || {}),
      updatedAt: serverTimestamp(),
    };
  });

  if (changed) {
    await ref.set({ date: dateYMD, picks: updated, updatedAt: serverTimestamp() }, { merge: true });
  }
}
