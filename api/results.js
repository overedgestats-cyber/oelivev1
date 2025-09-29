// /api/results.js
// Returns merged results: Firestore (if available) + manual fallback.
// Shape: { picks:[...flat list...], days:[{date, picks:[...] }], summary:{wins,losses,push} }

import { db } from './_firebase.js'; // must export a Firestore db (admin or web) from here

// ---------- Manual fallback (keep this in sync with the public page) ----------
const MANUAL_RESULTS = [
  // 2025-09-29 (today)
  { date:"2025-09-29", home:"Dortmund W", away:"Bayern Munich W", market:"Over 2.5", odds:2.00, status:"lose" },
  { date:"2025-09-29", home:"Utsikten",   away:"IK Brage",        market:"Over 2.5", odds:1.67, status:"win" },

  // 2025-09-26
  { date:"2025-09-26", home:"Fanalamanga", away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
  { date:"2025-09-26", home:"Tukums II",   away:"Riga Mariners",      market:"Over 2.5",  odds:1.33, status:"win" },

  // 2025-09-25
  { date:"2025-09-25", home:"Johor Darul Takzim FC", away:"Bangkok United", market:"Over 2.5", odds:1.44, status:"win" },
  { date:"2025-09-25", home:"Nam Dinh",              away:"Svay Rieng",     market:"Over 2.5", odds:1.90, status:"win" },

  // 2025-09-24
  { date:"2025-09-24", home:"VfL Wolfsburg W", away:"Werder Bremen W",   market:"Over 2.5",  odds:1.57, status:"win" },
  { date:"2025-09-24", home:"Kabel Novi Sad",  away:"Semendrija 1924",   market:"Under 2.5", odds:1.44, status:"lose" },

  // 2025-09-23
  { date:"2025-09-23", home:"Miedź Legnica II", away:"Świt Skolwin",     market:"Over 2.5",  odds:1.55, status:"win" },
  { date:"2025-09-23", home:"Cagliari",         away:"Frosinone",        market:"Under 2.5", odds:1.80, status:"lose" },

  // 2025-09-22
  { date:"2025-09-22", home:"Barcelona Atlètic", away:"Castellón B",     market:"Over 2.5",  odds:1.60, status:"win" },

  // 2025-09-21
  { date:"2025-09-21", home:"Rēzekne FA",       away:"Skanste",          market:"Over 2.5",  odds:1.45, status:"win" },
  { date:"2025-09-21", home:"Häcken W",         away:"Rosengård W",      market:"Over 2.5",  odds:1.73, status:"win" },

  // 2025-09-20
  { date:"2025-09-20", home:"1899 Hoffenheim",  away:"Bayern München",   market:"Over 2.5",  odds:1.35, status:"win" },
  { date:"2025-09-20", home:"Ogre United",      away:"Riga Mariners",    market:"Over 2.5",  odds:1.65, status:"win" },

  // 2025-09-17
  { date:"2025-09-17", home:"Cham",             away:"Vevey Sports",     market:"Over 2.5",  odds:1.54, status:"win" },
  { date:"2025-09-17", home:"Rothis",           away:"Sturm Graz",       market:"Over 2.5",  odds:1.20, status:"lose" },

  // 2025-09-16
  { date:"2025-09-16", home:"Tonbridge Angels", away:"Steyning Town",    market:"Over 2.5",  odds:1.67, status:"win" },
  { date:"2025-09-16", home:"Rylands",          away:"Ashton United",    market:"Under 2.5", odds:1.80, status:"win" },
  { date:"2025-09-16", home:"Sharjah FC",       away:"Al-Gharafa",       market:"Over 2.5",  odds:1.70, status:"win" },

  // 2025-09-14
  { date:"2025-09-14", home:"Pitea W",          away:"Brommapojkarna W", market:"Over 2.5",  odds:1.69, status:"win" },
  { date:"2025-09-14", home:"Marupe",           away:"JDFS Alberts",     market:"Over 2.5",  odds:1.47, status:"win" },
];

// helper: YYYY-MM-DD
function ymd(d) { return d.toISOString().slice(0, 10); }
function keyOf(p) { return `${p.date}#${p.home}#${p.away}#${(p.market||'').toLowerCase()}`; }

async function fetchFirestore(days = 180) {
  if (!db) return [];
  const colNames = ['results_free', 'free_picks_results'];
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.max(1, Number(days)||180));

  let rows = [];
  for (const name of colNames) {
    try {
      const snap = await db.collection(name)
        .where('date', '>=', ymd(start))
        .where('date', '<=', ymd(end))
        .get();

      if (!snap.empty) {
        snap.forEach(doc => {
          const v = doc.data() || {};
          const row = {
            date: v.date || (v.ts ? ymd(new Date(v.ts)) : null),
            home: v.home || v.homeTeam || v.h || '',
            away: v.away || v.awayTeam || v.a || '',
            market: v.market || v.m || '',
            selection: v.selection || v.pick || '',
            odds: typeof v.odds === 'number' ? v.odds : (typeof v.o === 'number' ? v.o : undefined),
            closing: typeof v.closing === 'number' ? v.closing : undefined,
            status: (v.status || v.result || '').toLowerCase(), // 'win' | 'lose' | 'push'
          };
          if (row.date && row.home && row.away) rows.push(row);
        });
      }
    } catch (e) {
      // ignore per-collection errors; fallback handled below
    }
  }
  return rows;
}

function dedupePreferFirestore(manual = [], remote = []) {
  const map = new Map();
  for (const r of manual) map.set(keyOf(r), r);
  for (const r of remote) map.set(keyOf(r), r); // prefer remote
  return Array.from(map.values()).sort((a,b)=> (a.date||'').localeCompare(b.date||''));
}

function toDays(picks) {
  const byDate = new Map();
  for (const p of picks) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date).push(p);
  }
  return Array.from(byDate.entries())
    .sort((a,b)=> b[0].localeCompare(a[0]))
    .map(([date, arr]) => ({ date, picks: arr }));
}

function summarize(picks) {
  let wins = 0, losses = 0, push = 0;
  for (const p of picks) {
    const s = String(p.status||'').toLowerCase();
    if (s === 'win') wins++;
    else if (s === 'lose' || s === 'loss') losses++;
    else if (s === 'push') push++;
  }
  return { wins, losses, push };
}

export default async function handler(req, res) {
  try {
    const days = Math.max(1, Number(req.query.days || 180));
    const remote = await fetchFirestore(days).catch(()=>[]);
    const merged = dedupePreferFirestore(MANUAL_RESULTS, remote);
    const daysOut = toDays(merged);
    const summary = summarize(merged);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ picks: merged, days: daysOut, summary });
  } catch (e) {
    const merged = MANUAL_RESULTS.slice().sort((a,b)=> a.date.localeCompare(b.date));
    res.status(200).json({ picks: merged, days: toDays(merged), summary: summarize(merged), fallback:true });
  }
}
