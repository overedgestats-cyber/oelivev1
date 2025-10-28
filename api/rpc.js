// /api/rpc.js  (PART 1 / 4)
// Unified API handler for OverEdge (Free Picks, Pro Board, Hero Bet, etc.)
// Provides data aggregation, caching, odds fetching, and Firestore integration.

const API_BASE = "https://v3.football.api-sports.io";

/* --------------------------- Basic Helpers --------------------------- */
function ymd(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clampRange(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function pct(n) { return Math.round(Math.max(1, Math.min(99, n * 100))); }

function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.append(k, v);
  });
  return u.toString();
}

/* --------------------------- API-Football Fetch --------------------------- */
async function apiGet(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("Missing API_FOOTBALL_KEY");
  const url = `${API_BASE}${path}?${qs(params)}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
  });
  const json = await res.json();
  if (!json || !json.response) return [];
  return json.response;
}

/* --------------------------- Utility Functions --------------------------- */
function clockFromISO(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function setNoEdgeCache(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
}

function stableSortFixtures(arr = []) {
  return arr.slice().sort((a, b) => {
    const ta = new Date(a?.fixture?.date || 0).getTime();
    const tb = new Date(b?.fixture?.date || 0).getTime();
    return ta - tb;
  });
}

/* --------------------- League Filters & Country Flags -------------------- */
function isYouthFixture(fx) {
  const n = (fx?.league?.name || "").toLowerCase();
  return /u\d{2}|youth|academy|reserve/.test(n);
}
function isEuropeanTier12OrCup(league) {
  const n = (league?.name || "").toLowerCase();
  const c = (league?.country || "").toLowerCase();
  return (
    /(premier|laliga|serie|bundesliga|ligue|uefa|champions|europa|conference)/.test(
      n
    ) ||
    ["england", "spain", "germany", "italy", "france"].includes(c)
  );
}
function getLeagueFlag(league = {}) {
  const c = (league?.country || "").toLowerCase();
  if (c === "england") return "🇬🇧";
  if (c === "germany") return "🇩🇪";
  if (c === "spain") return "🇪🇸";
  if (c === "italy") return "🇮🇹";
  if (c === "france") return "🇫🇷";
  if (c === "portugal") return "🇵🇹";
  if (c === "netherlands") return "🇳🇱";
  if (c === "belgium") return "🇧🇪";
  return "🌍";
}
function flagURLFromCountryName(name = "") {
  return `https://flagcdn.com/24x18/${name.slice(0, 2).toLowerCase()}.png`;
}

/* ------------------------- Reasoning Generators ------------------------- */
function reasonOURich(fx, H, A, pick, conf, model) {
  const dir = pick.includes("Over") ? "high scoring" : "tight/defensive";
  return `Avg goals: ${H.avgFor.toFixed(1)} vs ${A.avgFor.toFixed(
    1
  )}. ${pick} expected due to ${
    dir === "high scoring" ? "attacking form" : "defensive trend"
  }. Confidence ${conf}% (model ${model}%).`;
}
function reasonBTTSRich(fx, H, A, pick, conf) {
  const bttsRate = ((H.bttsRate + A.bttsRate) / 2) * 100;
  return `${pick} (${bttsRate.toFixed(
    0
  )}% BTTS rate avg). Confidence ${conf}%.`;
}
function reason1X2Rich(fx, H, A, pick, conf) {
  return `${pick} lean (${conf}% conf). ${fx.teams?.home?.name} form: ${
    H.ppg.toFixed(2)
  } PPG vs ${A.ppg.toFixed(2)} PPG.`;
}
function reasonCardsRich(fx, H, A, pick, conf) {
  return `${pick} likely — Avg cards ${(
    (H.avgFor + A.avgFor + H.avgAg + A.avgAg) /
    4
  ).toFixed(1)} per match. Confidence ${conf}%.`;
}
function reasonCornersRich(fx, H, A, pick, conf) {
  return `${pick} expected — attack intensity ${((
    (H.avgFor + A.avgFor) * 2.2 +
    (H.avgAg + A.avgAg) * 0.6
  ).toFixed(1))} (Conf. ${conf}%).`;
}

/* ----------------------- Firestore Initialization ----------------------- */
let db = null;
try {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const pk = (process.env.FB_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FB_PROJECT_ID,
        clientEmail: process.env.FB_CLIENT_EMAIL,
        privateKey: pk,
      }),
    });
  }
  db = require("firebase-admin").firestore();
} catch (e) {
  console.error("Firestore init error:", e?.message || e);
  db = null;
}

/* --------------------- Firestore Writer Helpers --------------------- */
async function writeDailyPicks(kind, date, picks) {
  if (!db) return;
  if (!Array.isArray(picks) || !picks.length) return;
  const docId = `${kind}_${date}`;
  await db.collection(`${kind}_results`).doc(docId).set({ date, picks }, { merge: true });
}

/* ----------------------- Volatility / Confidence ---------------------- */
function calibratedConfidence(sideProb, H, A) {
  const vol =
    0.50 * Math.abs(H.avgFor - A.avgFor) +
    0.20 * Math.abs(H.ppg - A.ppg) +
    0.10 * Math.abs(H.cleanSheetRate - A.cleanSheetRate) +
    0.10 * Math.abs(H.failToScoreRate - A.failToScoreRate);

  const base = 0.50 + (sideProb - 0.50) * 1.35 - 0.10 * vol;
  return Math.max(0.53, Math.min(0.90, base));
}

/* ------------------- Baselines for Cards/Corners models ------------------ */
const CARDS_BASELINE = 3.8;
const CORNERS_BASELINE = 9.0;
// /api/rpc.js  (PART 2 / 4)
// Team form, odds map, OU/BTTS models, and Free Picks logic.

/* -------------------------- Team Last-N Stats -------------------------- */
async function teamLastN(teamId, n = 12) {
  try {
    const res = await apiGet("/teams/statistics", {
      team: teamId,
      season: new Date().getFullYear(),
      league: "",
    });
    if (!res || !res[0]) throw new Error("No data");

    const data = res[0];
    const games = data?.fixtures?.played?.total || n;
    const goalsFor = data?.goals?.for?.total?.total || 0;
    const goalsAg = data?.goals?.against?.total?.total || 0;
    const goalsForPer = goalsFor / (games || 1);
    const goalsAgPer = goalsAg / (games || 1);

    return {
      avgFor: goalsForPer,
      avgAg: goalsAgPer,
      ppg: data?.form
        ? data.form.split("").reduce((a, c) => a + (c === "W" ? 3 : c === "D" ? 1 : 0), 0) /
          (data.form.length || 1)
        : 1.5,
      cleanSheetRate: data?.clean_sheet?.total / (games || 1) || 0,
      failToScoreRate: data?.failed_to_score?.total / (games || 1) || 0,
      bttsRate: (data?.both_teams_to_score?.total / (games || 1)) || 0.5,
    };
  } catch {
    return { avgFor: 1.3, avgAg: 1.2, ppg: 1.5, cleanSheetRate: 0.25, failToScoreRate: 0.25, bttsRate: 0.55 };
  }
}

/* ------------------------------- Odds Map ------------------------------- */
async function getOddsMap(fixtureId) {
  try {
    if (!fixtureId) return null;
    const res = await apiGet("/odds", { fixture: fixtureId });
    if (!res?.length) return null;

    const data = res[0]?.bookmakers?.[0]?.bets || [];
    const odds = {};

    for (const b of data) {
      const name = (b.name || "").toLowerCase();
      const v = b.values?.[0];
      if (!v || !v.odd) continue;
      const odd = parseFloat(v.odd);

      if (name.includes("over 2.5")) odds.over25 = odd;
      if (name.includes("under 2.5")) odds.under25 = odd;
      if (name.includes("btts") && v.value.toLowerCase().includes("yes")) odds.bttsYes = odd;
      if (name.includes("btts") && v.value.toLowerCase().includes("no")) odds.bttsNo = odd;
      if (name === "match winner" || name.includes("1x2")) {
        for (const val of b.values) {
          const t = val.value.toLowerCase();
          const o = parseFloat(val.odd);
          if (t === "home") odds.homeWin = o;
          else if (t === "away") odds.awayWin = o;
          else if (t === "draw") odds.draw = o;
        }
      }
      if (name.includes("corners over")) odds.cornersOver = odd;
      if (name.includes("corners under")) odds.cornersUnder = odd;
      if (name.includes("cards over")) odds.cardsOver = odd;
      if (name.includes("cards under")) odds.cardsUnder = odd;
    }
    return odds;
  } catch {
    return null;
  }
}

/* -------------------------- Over/Under Model --------------------------- */
function computeOUModelProb(H, A) {
  const avgG = (H.avgFor + A.avgFor + H.avgAg + A.avgAg) / 4;
  const overP = clampRange(avgG / 3.0, 0.35, 0.92);
  const underP = 1 - overP;
  const pick = overP >= 0.5 ? "Over 2.5" : "Under 2.5";
  return { pick, overP, underP };
}

/* --------------------------- BTTS Model --------------------------- */
function computeBTTSProb(H, A) {
  const p = (H.bttsRate + A.bttsRate) / 2;
  const pick = p >= 0.5 ? "BTTS: Yes" : "BTTS: No";
  return { pick, prob: clampRange(p, 0.45, 0.9) };
}

/* --------------------------- Free Picks Logic --------------------------- */
async function pickFreePicks({ date, tz, minConf = 75 }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league));

  const picks = [];

  for (const fx of fixtures.slice(0, 150)) {
    try {
      const homeId = fx?.teams?.home?.id;
      const awayId = fx?.teams?.away?.id;
      if (!homeId || !awayId) continue;

      const [H, A, odds] = await Promise.all([
        teamLastN(homeId),
        teamLastN(awayId),
        getOddsMap(fx.fixture?.id),
      ]);

      const m = computeOUModelProb(H, A);
      const sideProb = m.pick.includes("Over") ? m.overP : m.underP;
      const conf = calibratedConfidence(sideProb, H, A);
      const confPct = Math.round(conf * 100);

      if (confPct >= minConf) {
        picks.push({
          fixtureId: fx.fixture?.id,
          matchTime: clockFromISO(fx.fixture?.date),
          league: fx.league?.name || "",
          country: fx.league?.country || "",
          home: fx.teams?.home?.name || "",
          away: fx.teams?.away?.name || "",
          market: m.pick,
          confidencePct: confPct,
          modelProbPct: Math.round(sideProb * 100),
          odds: odds ? (m.pick.includes("Over") ? odds.over25 : odds.under25) : null,
          reasoning: reasonOURich(fx, H, A, m.pick, confPct, Math.round(sideProb * 100)),
        });
      }
    } catch {}
  }

  // Sort by confidence and keep top 2
  picks.sort((a, b) => b.confidencePct - a.confidencePct);
  const top = picks.slice(0, 2);

  if (top.length < 2) {
    // Fallback: include secondary leagues
    const fallback = await apiGet("/fixtures", { date, timezone: tz });
    const fb = fallback.filter(fx => !isYouthFixture(fx)).filter(
      fx => ["Netherlands", "Portugal", "Belgium", "USA"].includes(fx.league?.country)
    );
    for (const fx of fb.slice(0, 80)) {
      try {
        const homeId = fx?.teams?.home?.id;
        const awayId = fx?.teams?.away?.id;
        if (!homeId || !awayId) continue;
        const [H, A, odds] = await Promise.all([
          teamLastN(homeId),
          teamLastN(awayId),
          getOddsMap(fx.fixture?.id),
        ]);
        const m = computeOUModelProb(H, A);
        const sideProb = m.pick.includes("Over") ? m.overP : m.underP;
        const conf = calibratedConfidence(sideProb, H, A);
        const confPct = Math.round(conf * 100);
        if (confPct >= minConf - 5) {
          top.push({
            fixtureId: fx.fixture?.id,
            matchTime: clockFromISO(fx.fixture?.date),
            league: fx.league?.name || "",
            country: fx.league?.country || "",
            home: fx.teams?.home?.name || "",
            away: fx.teams?.away?.name || "",
            market: m.pick,
            confidencePct: confPct,
            modelProbPct: Math.round(sideProb * 100),
            odds: odds ? (m.pick.includes("Over") ? odds.over25 : odds.under25) : null,
            reasoning: reasonOURich(fx, H, A, m.pick, confPct, Math.round(sideProb * 100)),
            fallback: true,
          });
        }
      } catch {}
    }
  }

  return { date, timezone: tz, picks: top };
}
// /api/rpc.js  (PART 3 / 4)
// Hero Bet, Pro Board (flat + grouped), with full odds support.

/* ----------------------- 1X2 Lean (quick heuristic) ----------------------- */
function onex2Lean(H, A) {
  // simple differential + venue bump
  const VENUE = 0.20;
  const score = (H.avgFor - H.avgAg + VENUE) - (A.avgFor - A.avgAg);
  if (score > 0.35) return { pick: "Home", conf: clamp01(0.55 + (score - 0.35) * 0.25) };
  if (score < -0.35) return { pick: "Away", conf: clamp01(0.55 + (-score - 0.35) * 0.25) };
  return { pick: "Draw", conf: 0.50 };
}

/* ------------------ Hero Bet: build value candidates ------------------ */
async function scoreHeroCandidates(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return [];

  const [H, A, odds] = await Promise.all([
    teamLastN(homeId),
    teamLastN(awayId),
    getOddsMap(fx?.fixture?.id),
  ]);

  const tLabel = clockFromISO(fx?.fixture?.date);
  const base = {
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    matchTime: tLabel,
    home: fx?.teams?.home?.name || "",
    away: fx?.teams?.away?.name || "",
  };

  const candidates = [];
  const within = (p, lo = 0.58, hi = 0.80) => p >= lo && p <= hi;

  // OU 2.5
  {
    const m = computeOUModelProb(H, A);
    const sideProb = m.pick === "Over 2.5" ? m.overP : m.underP;
    const price = m.pick === "Over 2.5" ? odds?.over25 : odds?.under25;
    if (Number.isFinite(price) && price >= 2.0 && price <= 3.2 && within(sideProb)) {
      const confPct = Math.round(calibratedConfidence(sideProb, H, A) * 100);
      candidates.push({
        ...base,
        market: "OU 2.5",
        selection: m.pick,
        odds: price,
        confidencePct: confPct,
        modelProbPct: Math.round(sideProb * 100),
        valueScore: Number((sideProb * price).toFixed(4)),
        reasoning: reasonOURich(fx, H, A, m.pick, confPct, Math.round(sideProb * 100)),
      });
    }
  }

  // BTTS
  {
    const m = computeBTTSProb(H, A); // { pick, prob }
    const sideProb = m.pick.endsWith("Yes") ? m.prob : (1 - m.prob);
    const price = m.pick.endsWith("Yes") ? odds?.bttsYes : odds?.bttsNo;
    if (Number.isFinite(price) && price >= 2.0 && price <= 3.2 && within(sideProb)) {
      const confPct = Math.round(calibratedConfidence(sideProb, H, A) * 100);
      candidates.push({
        ...base,
        market: "BTTS",
        selection: m.pick,
        odds: price,
        confidencePct: confPct,
        modelProbPct: Math.round(sideProb * 100),
        valueScore: Number((sideProb * price).toFixed(4)),
        reasoning: reasonBTTSRich(fx, H, A, m.pick, confPct),
      });
    }
  }

  // Optionally you can add 1X2 value candidates here if desired, once odds thresholds are defined.

  return candidates;
}

/* ---------------------------- Pick Hero Bet ---------------------------- */
async function pickHeroBet({ date, tz, market = "auto" }) {
  const mode = (market || "auto").toString().toLowerCase(); // auto|ou_goals|btts
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  let all = [];
  for (const fx of fixtures.slice(0, 120)) {
    try {
      const cands = await scoreHeroCandidates(fx);
      const filtered =
        mode === "ou_goals" ? cands.filter(c => c.market === "OU 2.5")
      : mode === "btts"     ? cands.filter(c => c.market === "BTTS")
      : cands;
      all = all.concat(filtered);
    } catch {}
  }
  if (!all.length) return { heroBet: null, note: "No qualifying value pick found yet." };
  all.sort((a, b) => b.valueScore - a.valueScore); // value-first
  return { heroBet: all[0] };
}

/* -------------------- Pro Board league allowlist -------------------- */
const PRO_ALLOWED = {
  England: [/^Premier League$/i, /^Championship$/i, /^FA Cup$/i],
  Germany: [/^Bundesliga$/i, /^2\.?\s*Bundesliga$/i, /^DFB[ -]?Pokal$/i],
  Spain: [/^La ?Liga$/i, /^(Segunda( División)?|La ?Liga 2)$/i, /^Copa del Rey$/i],
  Italy: [/^Serie ?A$/i, /^Serie ?B$/i, /^Coppa Italia$/i],
  France: [/^Ligue ?1$/i, /^Ligue ?2$/i, /^Coupe de France$/i],
};
const PRO_GLOBALS = [
  /UEFA Champions League/i,
  /UEFA Europa League/i,
  /UEFA Europa Conference League/i,
  /FIFA World Cup/i,
  /(UEFA )?European Championship|EURO\b/i,
  /(UEFA )?Nations League/i,
  /FIFA Club World Cup/i,
  /AFCON|Africa Cup of Nations/i,
  /CONCACAF/i,
];
function allowedForProBoard(league = {}) {
  const name = league?.name || "";
  const country = league?.country || "";
  if (PRO_GLOBALS.some(rx => rx.test(name))) return true;
  const rx = PRO_ALLOWED[country];
  if (!rx) return false;
  return rx.some(r => r.test(name));
}

/* ------------------- Pro Board (flat; per fixture row) ------------------- */
async function buildProBoard({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  const rows = [];

  for (const fx of fixtures.slice(0, 200)) {
    try {
      const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
      if (!homeId || !awayId) continue;

      const [H, A, odds] = await Promise.all([
        teamLastN(homeId),
        teamLastN(awayId),
        getOddsMap(fx?.fixture?.id),
      ]);

      // OU 2.5
      const mOU = computeOUModelProb(H, A);
      const ouSide = mOU.pick === "Over 2.5" ? mOU.overP : mOU.underP;
      const ouConfPct = Math.round(calibratedConfidence(ouSide, H, A) * 100);
      const ouModelPct = Math.round(ouSide * 100);
      const ouOdds = mOU.pick === "Over 2.5" ? odds?.over25 : odds?.under25;

      // BTTS
      const mBT = computeBTTSProb(H, A); // { pick, prob }
      const btSide = mBT.pick.endsWith("Yes") ? mBT.prob : (1 - mBT.prob);
      const btConfPct = Math.round(calibratedConfidence(btSide, H, A) * 100);
      const btModelPct = Math.round(btSide * 100);
      const btOdds = mBT.pick.endsWith("Yes") ? odds?.bttsYes : odds?.bttsNo;

      // 1X2
      const ox = onex2Lean(H, A);
      const oxConfPct = Math.round(ox.conf * 100);
      const oxOdds = ox.pick === "Home" ? odds?.homeWin : ox.pick === "Away" ? odds?.awayWin : odds?.draw;

      // Cards (model is coarse; odds if present)
      const avgCards = (H.avgFor + A.avgFor + H.avgAg + A.avgAg) / 4;
      const cardsPick = avgCards >= 4.8 ? "Over 5.5" : "Under 4.5";
      const cardsConfPct = Math.round(clampRange(0.55 + Math.abs(avgCards - 4.8) * 0.06, 0.52, 0.9) * 100);
      const cardsReason = reasonCardsRich(fx, H, A, cardsPick, cardsConfPct);
      const cardsOdds = cardsPick.startsWith("Over") ? odds?.cardsOver : odds?.cardsUnder;

      // Corners
      const pressure = (H.avgFor + A.avgFor) * 2.2 + (H.avgAg + A.avgAg) * 0.6;
      const cornersPick = pressure >= 9.7 ? "Over 10.5" : "Under 9.5";
      const cornersConfPct = Math.round(clampRange(0.55 + Math.abs(pressure - 9.7) * 0.05, 0.52, 0.9) * 100);
      const cornersReason = reasonCornersRich(fx, H, A, cornersPick, cornersConfPct);
      const cornersOdds = cornersPick.startsWith("Over") ? odds?.cornersOver : odds?.cornersUnder;

      // choose "best" by confidence * (odds or 1)
      const score = (conf, price) => (conf / 100) * (Number.isFinite(price) ? price : 1);
      const ranked = [
        { k: "ou25", s: score(ouConfPct, ouOdds) },
        { k: "btts", s: score(btConfPct, btOdds) },
        { k: "onex2", s: score(oxConfPct, oxOdds) },
        { k: "ou_cards", s: score(cardsConfPct, cardsOdds) },
        { k: "ou_corners", s: score(cornersConfPct, cornersOdds) },
      ].sort((a,b)=> b.s - a.s);

      rows.push({
        fixtureId: fx?.fixture?.id,
        competition: (fx?.league?.country ? `${fx.league.country} — ` : "") + (fx?.league?.name || "League"),
        matchTime: clockFromISO(fx?.fixture?.date),
        home: fx?.teams?.home?.name || "",
        away: fx?.teams?.away?.name || "",
        markets: {
          ou25: {
            recommendation: mOU.pick,
            confidencePct: ouConfPct,
            modelProbPct: ouModelPct,
            odds: ouOdds ?? null,
            reasoning: reasonOURich(fx, H, A, mOU.pick, ouConfPct, ouModelPct),
          },
          btts: {
            recommendation: mBT.pick,
            confidencePct: btConfPct,
            modelProbPct: btModelPct,
            odds: btOdds ?? null,
            reasoning: reasonBTTSRich(fx, H, A, mBT.pick, btConfPct),
          },
          onex2: {
            recommendation: ox.pick,
            confidencePct: oxConfPct,
            modelProbPct: oxConfPct,
            odds: oxOdds ?? null,
            reasoning: reason1X2Rich(fx, H, A, ox.pick, oxConfPct),
          },
          ou_cards: {
            recommendation: cardsPick,
            confidencePct: cardsConfPct,
            modelProbPct: cardsConfPct,
            odds: cardsOdds ?? null,
            reasoning: cardsReason,
          },
          ou_corners: {
            recommendation: cornersPick,
            confidencePct: cornersConfPct,
            modelProbPct: cornersConfPct,
            odds: cornersOdds ?? null,
            reasoning: cornersReason,
          },
        },
        best: { market: ranked[0].k },
      });
    } catch {}
  }

  const groups = {};
  rows.forEach(r => {
    groups[r.competition] = groups[r.competition] || [];
    groups[r.competition].push(r);
  });
  Object.keys(groups).forEach(k =>
    groups[k].sort((a,b)=> (a.matchTime || "").localeCompare(b.matchTime || "")));

  return { date, timezone: tz, groups };
}

/* ---------------- Pro Board (grouped by country + league) ---------------- */
async function buildProBoardGrouped({ date, tz, market = "ou_goals" }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));
  fixtures = stableSortFixtures(fixtures);

  const byCountry = new Map();

  for (const fx of fixtures.slice(0, 240)) {
    try {
      const country = fx.league?.country || "International";
      if (!byCountry.has(country)) byCountry.set(country, { country, flag: getLeagueFlag(fx.league) || flagURLFromCountryName(country), leagues: new Map() });

      const c = byCountry.get(country);
      const lid = fx.league?.id;
      const leagueName = fx.league?.name || "League";
      const leagueShort = leagueName.replace(/\s*\(Regular Season\)\s*/i, "").replace(/\s*Group\s+[A-Z]\s*$/i, "");
      if (!c.leagues.has(lid)) c.leagues.set(lid, { leagueId: lid, leagueName, leagueShort, fixtures: [] });

      const L = c.leagues.get(lid);

      const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
      const [H, A, odds] = await Promise.all([
        teamLastN(homeId),
        teamLastN(awayId),
        getOddsMap(fx?.fixture?.id),
      ]);

      let rec = null, why = "";

      if (market === "ou_goals") {
        const m = computeOUModelProb(H, A);
        const sideProb = m.pick === "Over 2.5" ? m.overP : m.underP;
        const confPct = Math.round(calibratedConfidence(sideProb, H, A) * 100);
        const modelPct = Math.round(sideProb * 100);
        const price = m.pick === "Over 2.5" ? odds?.over25 : odds?.under25;
        why = reasonOURich(fx, H, A, m.pick, confPct, modelPct);
        rec = { market: "OU Goals", pick: m.pick, confidencePct: confPct, modelProbPct: modelPct, odds: price ?? null, trend: why };
      } else if (market === "btts") {
        const m = computeBTTSProb(H, A);
        const sideProb = m.pick.endsWith("Yes") ? m.prob : (1 - m.prob);
        const confPct = Math.round(calibratedConfidence(sideProb, H, A) * 100);
        const modelPct = Math.round(sideProb * 100);
        const price = m.pick.endsWith("Yes") ? odds?.bttsYes : odds?.bttsNo;
        why = reasonBTTSRich(fx, H, A, m.pick, confPct);
        rec = { market: "BTTS", pick: m.pick, confidencePct: confPct, modelProbPct: modelPct, odds: price ?? null, trend: why };
      } else if (market === "one_x_two") {
        const ox = onex2Lean(H, A);
        const confPct = Math.round(ox.conf * 100);
        const price = ox.pick === "Home" ? odds?.homeWin : ox.pick === "Away" ? odds?.awayWin : odds?.draw;
        why = reason1X2Rich(fx, H, A, ox.pick, confPct);
        rec = { market: "1X2", pick: ox.pick, confidencePct: confPct, modelProbPct: confPct, odds: price ?? null, trend: why };
      } else if (market === "ou_cards") {
        const avg = (H.avgAg + A.avgAg + H.avgFor + A.avgFor) / 4;
        const pick = avg >= 4.8 ? "Over 5.5" : "Under 4.5";
        const confPct = Math.round(clampRange(0.55 + Math.abs(avg - 4.8) * 0.06, 0.52, 0.9) * 100);
        const price = pick.startsWith("Over") ? odds?.cardsOver : odds?.cardsUnder;
        why = reasonCardsRich(fx, H, A, pick, confPct);
        rec = { market: "OU Cards", pick, confidencePct: confPct, modelProbPct: confPct, odds: price ?? null, trend: why };
      } else if (market === "ou_corners") {
        const pressure = (H.avgFor + A.avgFor) * 2.2 + (H.avgAg + A.avgAg) * 0.6;
        const pick = pressure >= 9.7 ? "Over 10.5" : "Under 9.5";
        const confPct = Math.round(clampRange(0.55 + Math.abs(pressure - 9.7) * 0.05, 0.52, 0.9) * 100);
        const price = pick.startsWith("Over") ? odds?.cornersOver : odds?.cornersUnder;
        why = reasonCornersRich(fx, H, A, pick, confPct);
        rec = { market: "OU Corners", pick, confidencePct: confPct, modelProbPct: confPct, odds: price ?? null, trend: why };
      }

      L.fixtures.push({
        fixtureId: fx.fixture?.id,
        time: clockFromISO(fx.fixture?.date),
        leagueId: lid, leagueName, leagueShort, country, flag: byCountry.get(country).flag,
        home: { id: fx.teams?.home?.id, name: fx.teams?.home?.name, logo: fx.teams?.home?.logo },
        away: { id: fx.teams?.away?.id, name: fx.teams?.away?.name, logo: fx.teams?.away?.logo },
        recommendation: rec,
        reasoning: why
      });
    } catch {}
  }

  const groups = Array.from(byCountry.values())
    .sort((a,b)=> a.country.localeCompare(b.country))
    .map(c => ({
      country: c.country,
      flag: c.flag,
      leagues: Array.from(c.leagues.values()).sort((a,b)=> (a.leagueName || "").localeCompare(b.leagueName || "")),
    }));

  return { date, timezone: tz, groups };
}
// /api/rpc.js  (PART 4 / 4)
// Handler, caching, Stripe verification, and Firestore readers.

/* -------------------------- Redis / Upstash Helpers -------------------------- */
const UP_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "";
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";

async function kvGet(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UP_TOKEN}` },
    cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvSet(key, value, ttlSec = null) {
  if (!UP_URL || !UP_TOKEN) return null;
  let url = `${UP_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  if (ttlSec) url += `?EX=${ttlSec}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` } });
  try { return await r.json(); } catch { return null; }
}

/* ------------------------------ Local Caches ------------------------------ */
const CACHE_TTL_MS = 22 * 60 * 60 * 1000;
const FREE_CACHE = new Map();
const HERO_CACHE = new Map();
const PROBOARD_CACHE = new Map();

function cacheGet(map, key) {
  const e = map.get(key);
  if (e && e.exp > Date.now()) return e.payload;
  if (e) map.delete(key);
  return null;
}
function cacheSet(map, key, payload) {
  map.set(key, { payload, exp: Date.now() + CACHE_TTL_MS });
}

/* ----------------------------- API HANDLER ----------------------------- */
export default async function handler(req, res) {
  try {
    setNoEdgeCache(res);
    const { action = "health" } = req.query;

    /* --- Health --- */
    if (action === "health") return res.status(200).json({ ok: true, ts: Date.now() });

    /* --- Free Picks (Live or Cached) --- */
    if (action === "free-picks") {
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = `${date}|${tz}|${minConf}`;

      if (!refresh) {
        const cached = cacheGet(FREE_CACHE, key);
        if (cached) return res.status(200).json(cached);
        const persisted = await kvGet(`free:${key}`);
        if (persisted?.result) {
          const payload = JSON.parse(persisted.result);
          cacheSet(FREE_CACHE, key, payload);
          return res.status(200).json(payload);
        }
      }

      const payload = await pickFreePicks({ date, tz, minConf });
      cacheSet(FREE_CACHE, key, payload);
      await kvSet(`free:${key}`, JSON.stringify(payload), 22 * 60 * 60);

      // persist to Firestore
      try {
        const toStore = payload.picks.map(p => ({
          date,
          matchTime: p.matchTime,
          country: p.country,
          league: p.league,
          home: p.home, away: p.away,
          market: p.market,
          odds: p.odds ?? null,
          fixtureId: p.fixtureId,
          status: "pending",
        }));
        if (toStore.length) await writeDailyPicks("free_picks", date, toStore);
      } catch {}

      return res.status(200).json(payload);
    }

    /* --- Hero Bet (Risky Bet / Value pick) --- */
    if (action === "pro-pick") {
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "auto").toLowerCase();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = `${date}|${tz}|${market}`;

      if (!refresh) {
        const cached = cacheGet(HERO_CACHE, key);
        if (cached) return res.status(200).json(cached);
        const persisted = await kvGet(`hero:${key}`);
        if (persisted?.result) {
          const payload = JSON.parse(persisted.result);
          cacheSet(HERO_CACHE, key, payload);
          return res.status(200).json(payload);
        }
      }

      const payload = await pickHeroBet({ date, tz, market });
      cacheSet(HERO_CACHE, key, payload);
      await kvSet(`hero:${key}`, JSON.stringify(payload), 22 * 60 * 60);

      // store to Firestore
      try {
        const h = payload.heroBet;
        if (h) await writeDailyPicks("hero_bet", date, [h]);
      } catch {}

      return res.status(200).json(payload);
    }

    /* --- Pro Board --- */
    if (action === "pro-board" || action === "pro-board-grouped") {
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "ou_goals").toLowerCase();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = `${date}|${tz}|${market}`;

      if (!refresh) {
        const cached = cacheGet(PROBOARD_CACHE, key);
        if (cached) return res.status(200).json(cached);
        const persisted = await kvGet(`pro:${key}`);
        if (persisted?.result) {
          const payload = JSON.parse(persisted.result);
          cacheSet(PROBOARD_CACHE, key, payload);
          return res.status(200).json(payload);
        }
      }

      const payload = action === "pro-board"
        ? await buildProBoard({ date, tz })
        : await buildProBoardGrouped({ date, tz, market });

      cacheSet(PROBOARD_CACHE, key, payload);
      await kvSet(`pro:${key}`, JSON.stringify(payload), 22 * 60 * 60);

      // Firestore persistence
      try {
        const recs = [];
        for (const g of payload.groups || []) {
          for (const L of g.leagues || []) {
            for (const fx of L.fixtures || []) {
              if (fx?.recommendation)
                recs.push({
                  date,
                  matchTime: fx.time,
                  league: L.leagueName,
                  country: g.country,
                  home: fx.home?.name,
                  away: fx.away?.name,
                  market: fx.recommendation.market,
                  selection: fx.recommendation.pick,
                  status: "pending",
                });
            }
          }
        }
        if (recs.length) await writeDailyPicks("pro_board", date, recs);
      } catch {}

      return res.status(200).json(payload);
    }

    /* --- Verify subscription (Stripe email) --- */
    if (action === "verify-sub") {
      const email = (req.query.email || "").trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const devList = (process.env.OE_DEV_EMAILS || "")
        .split(",")
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
      if (devList.includes(email))
        return res.status(200).json({ pro: true, plan: "DEV", status: "override" });

      try {
        const info = await verifyStripeByEmail(email);
        return res.status(200).json(info);
      } catch (e) {
        return res.status(200).json({ pro: false, plan: null, status: "error", msg: e.message });
      }
    }

    /* --- Results: Free Picks / Hero Bet / Pro Board --- */
    if (action === "free-picks-results") {
      const snap = await db.collection("free_picks_results").orderBy("date", "desc").limit(60).get();
      const out = [];
      snap.forEach(doc => out.push(doc.data()));
      return res.status(200).json(out);
    }

    if (action === "hero-bet-results") {
      const snap = await db.collection("hero_bet_results").orderBy("date", "desc").limit(60).get();
      const out = [];
      snap.forEach(doc => out.push(doc.data()));
      return res.status(200).json(out);
    }

    if (action === "pro-board-results") {
      const snap = await db.collection("pro_board_results").orderBy("date", "desc").limit(60).get();
      const out = [];
      snap.forEach(doc => out.push(doc.data()));
      return res.status(200).json(out);
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("rpc error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

/* ----------------------------- Stripe Verify ----------------------------- */
async function verifyStripeByEmail(email) {
  const key = process.env.STRIPE_SECRET;
  if (!key) throw new Error("Missing STRIPE_SECRET");

  const res = await fetch(
    `https://api.stripe.com/v1/customers?${qs({ email, limit: 3 })}`,
    { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error("Stripe API error");
  const data = await res.json();
  const customers = data.data || [];
  if (!customers.length) return { pro: false, plan: null, status: "none" };

  for (const c of customers) {
    const subs = await fetch(
      `https://api.stripe.com/v1/subscriptions?${qs({ customer: c.id, status: "active" })}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const sData = await subs.json();
    if (sData?.data?.length) {
      const sub = sData.data[0];
      const plan = sub.items?.data?.[0]?.price?.nickname || "Active plan";
      return { pro: true, plan, status: sub.status };
    }
  }
  return { pro: false, plan: null, status: "none" };
}
