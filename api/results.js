// /api/results.js
// Returns merged results: Firestore (if available) + manual fallback.
// Shape: { picks:[...flat list...], days:[{date, picks:[...]}], summary:{wins,losses,push} }

let db = null;
// Try to import a Firestore db if your project provides one; otherwise stay null.
try {
  // If you have a local helper that exports { db }
  const m = require('./_firebase.js');
  db = m?.db || null;
} catch (_) {
  // Optional: attempt firebase-admin bootstrap if available in this runtime
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp();
    db = admin.firestore();
  } catch (_) {
    db = null; // keep graceful
  }
}

// ---------- Manual fallback (keep in sync with /public/results.js) ----------
// ---------- Manual fallback (keep in sync with /public/results.js) ----------
const MANUAL_RESULTS = [
  // 2025-10-21
{ date:"2025-10-21", home:"Tesla Stropkov",     away:"Liptovsky Mikulas", market:"Over 2.5", odds:1.50, status:"win" },
{ date:"2025-10-21", home:"Malecnik",           away:"Kamnik",            market:"Over 2.5", odds:1.44, status:"win" },

// 2025-10-19
{ date:"2025-10-19", home:"Freiburg",           away:"Eintracht Frankfurt", market:"Over 2.5", odds:1.62, status:"win" },
{ date:"2025-10-19", home:"Brommapojkarna W",   away:"Häcken W",            market:"Over 2.5", odds:1.36, status:"win" },

  // 2025-10-18
{ date: "2025-10-18", home: "AFA Olaine", away: "Skanste", market: "Over 2.5", odds: 1.36, status: "win" },
{ date: "2025-10-18", home: "Sarpsborg 08 FF", away: "Bodo/Glimt", market: "Over 2.5", odds: 1.33, status: "win" },

// 2025-10-17
{ date: "2025-10-17", home: "Wests APIA", away: "Sydney United", market: "Under 2.5", odds: 2.03, status: "lose" },
{ date: "2025-10-17", home: "Linköping", away: "AIK", market: "Over 2.5", odds: 1.61, status: "win" },

  // 2025-10-06
  { date:"2025-10-06", home:"Dragonas IDV W", away:"Santa Fe W",           market:"Under 2.5", odds:1.55, status:"win" },

  // 2025-10-05
  { date:"2025-10-05", home:"Linköping",            away:"Brommapojkarna W", market:"Over 2.5", odds:1.57, status:"win" },
  { date:"2025-10-05", home:"Go Ahead Eagles",      away:"NEC Nijmegen",     market:"Over 2.5", odds:1.44, status:"lose" },

  // 2025-10-04
  { date:"2025-10-04", home:"Eintracht Frankfurt",  away:"Bayern München",   market:"Over 2.5", odds:1.25, status:"win" },
  { date:"2025-10-04", home:"Skanste",              away:"Leevon / PPK",     market:"Over 2.5", odds:1.79, status:"lose" },

  // 2025-10-03
  { date:"2025-10-03", home:"1899 Hoffenheim",      away:"1.FC Köln",        market:"Over 2.5", odds:1.57, status:"lose" },
  { date:"2025-10-03", home:"Buckley Town",         away:"Newtown AFC",      market:"Over 2.5", odds:1.44, status:"win" },

  // 2025-10-02
  { date:"2025-10-02", home:"Tampines (Sgp)",       away:"Pathum United (Tha)", market:"Over 2.5", odds:1.60, status:"win" },
  { date:"2025-10-02", home:"Panathinaikos",        away:"G.A. Eagles",         market:"Over 2.5", odds:1.57, status:"win" },

  // 2025-10-01
  { date:"2025-10-01", home:"FC Schaffhausen",      away:"Zürich II",        market:"Over 2.5", odds:1.40, status:"lose" },
  { date:"2025-10-01", home:"Bayer Leverkusen",     away:"PSV Eindhoven",    market:"Over 2.5", odds:1.53, status:"lose" },

  // 2025-09-30
  { date:"2025-09-30", home:"Galatasaray",          away:"Liverpool",        market:"Over 2.5", odds:1.40, status:"lose" },
  { date:"2025-09-30", home:"Iskra",                away:"Congaz",           market:"Over 2.5", odds:1.60, status:"win" },

  // 2025-09-29
  { date:"2025-09-29", home:"Dortmund W",           away:"Bayern Munich W",  market:"Over 2.5", odds:2.00, status:"lose" },
  { date:"2025-09-29", home:"Utsikten",             away:"IK Brage",         market:"Over 2.5", odds:1.67, status:"win" },

  // 2025-09-28
  { date:"2025-09-28", home:"SC Freiburg",          away:"1899 Hoffenheim",  market:"Over 2.5", odds:1.62, status:"lose" },
  { date:"2025-09-28", home:"Rosengård W",          away:"Brommapojkarna W", market:"Over 2.5", odds:1.53, status:"win" },

  // 2025-09-27
  { date:"2025-09-27", home:"Ogre United",          away:"Smiltene",         market:"Over 2.5",  odds:1.40, status:"lose" },
  { date:"2025-09-27", home:"Piast Gliwice",        away:"Nieciecza",        market:"Under 2.5", odds:1.90, status:"lose" },

  // 2025-09-26
  { date:"2025-09-26", home:"Fanalamanga",          away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
  { date:"2025-09-26", home:"Tukums II",            away:"Riga Mariners",      market:"Over 2.5",  odds:1.33, status:"win" },

  // 2025-09-25
  { date:"2025-09-25", home:"Johor Darul Takzim FC", away:"Bangkok United",  market:"Over 2.5", odds:1.44, status:"win" },
  { date:"2025-09-25", home:"Nam Dinh",              away:"Svay Rieng",      market:"Over 2.5", odds:1.90, status:"win" },

  // 2025-09-24
  { date:"2025-09-24", home:"VfL Wolfsburg W",      away:"Werder Bremen W",  market:"Over 2.5",  odds:1.57, status:"win" },
  { date:"2025-09-24", home:"Kabel Novi Sad",       away:"Semendrija 1924",  market:"Under 2.5", odds:1.44, status:"lose" },

  // 2025-09-23
  { date:"2025-09-23", home:"Miedź Legnica II",     away:"Świt Skolwin",     market:"Over 2.5",  odds:1.55, status:"win" },
  { date:"2025-09-23", home:"Cagliari",             away:"Frosinone",        market:"Under 2.5", odds:1.80, status:"lose" },

  // 2025-09-22
  { date:"2025-09-22", home:"Barcelona Atlètic",    away:"Castellón B",      market:"Over 2.5",  odds:1.60, status:"win" },

  // 2025-09-21
  { date:"2025-09-21", home:"Rēzekne FA",           away:"Skanste",          market:"Over 2.5",  odds:1.45, status:"win" },
  { date:"2025-09-21", home:"Häcken W",             away:"Rosengård W",      market:"Over 2.5",  odds:1.73, status:"win" },

  // 2025-09-20
  { date:"2025-09-20", home:"1899 Hoffenheim",      away:"Bayern München",   market:"Over 2.5",  odds:1.35, status:"win" },
  { date:"2025-09-20", home:"Ogre United",          away:"Riga Mariners",    market:"Over 2.5",  odds:1.65, status:"win" },

  // 2025-09-17
  { date:"2025-09-17", home:"Cham",                 away:"Vevey Sports",     market:"Over 2.5",  odds:1.54, status:"win" },
  { date:"2025-09-17", home:"Rothis",               away:"Sturm Graz",       market:"Over 2.5",  odds:1.20, status:"lose" },

  // 2025-09-16
  { date:"2025-09-16", home:"Tonbridge Angels",     away:"Steyning Town",    market:"Over 2.5",  odds:1.67, status:"win" },
  { date:"2025-09-16", home:"Rylands",              away:"Ashton United",    market:"Under 2.5", odds:1.80, status:"win" },
  { date:"2025-09-16", home:"Sharjah FC",           away:"Al-Gharafa",       market:"Over 2.5",  odds:1.70, status:"win" },

  // 2025-09-14
  { date:"2025-09-14", home:"Pitea W",              away:"Brommapojkarna W", market:"Over 2.5",  odds:1.69, status:"win" },
  { date:"2025-09-14", home:"Marupe",               away:"JDFS Alberts",     market:"Over 2.5",  odds:1.47, status:"win" },
];


// helpers
function ymd(d) { return d.toISOString().slice(0, 10); }
function keyOf(p) { return `${p.date}#${p.home}#${p.away}#${String(p.market||'').toLowerCase()}`; }

async function fetchFirestore(days = 180) {
  if (!db) return [];
  const colNames = ['results_free', 'free_picks_results']; // try both
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.max(1, Number(days)||180));

  const out = [];
  for (const name of colNames) {
    try {
      const q = await db.collection(name)
        .where('date', '>=', ymd(start))
        .where('date', '<=', ymd(end))
        .get();

      if (q?.empty) continue;
      q.forEach(doc => {
        const v = doc.data() || {};
        const row = {
          date: v.date || null,
          home: v.home || v.homeTeam || v.h || '',
          away: v.away || v.awayTeam || v.a || '',
          market: v.market || v.m || '',
          selection: v.selection || v.pick || '',
          odds: typeof v.odds === 'number' ? v.odds
               : typeof v.o    === 'number' ? v.o : undefined,
          closing: typeof v.closing === 'number' ? v.closing : undefined,
          status: String(v.status || v.result || '').toLowerCase(), // 'win'|'lose'|'push'
        };
        if (row.date && row.home && row.away) out.push(row);
      });
    } catch {
      // ignore and try next collection
    }
  }
  return out;
}

function dedupePreferRemote(manual = [], remote = []) {
  const map = new Map();
  for (const r of manual) map.set(keyOf(r), r);
  for (const r of remote) map.set(keyOf(r), r); // remote overwrites manual
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
    // kind is accepted but currently unused; keeping for compatibility
    // const kind = String(req.query.kind || 'free').toLowerCase();

    let remote = [];
    try { remote = await fetchFirestore(days); } catch { remote = []; }

    const merged = dedupePreferRemote(MANUAL_RESULTS, remote);
    const daysOut = toDays(merged);
    const summary = summarize(merged);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ picks: merged, days: daysOut, summary });
  } catch (e) {
    // Always fall back to manual with 200 (avoid 500 on the page)
    const merged = MANUAL_RESULTS.slice().sort((a,b)=> a.date.localeCompare(b.date));
    return res.status(200).json({ picks: merged, days: toDays(merged), summary: summarize(merged), fallback: true });
  }
}
