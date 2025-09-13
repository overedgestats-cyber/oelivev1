// /api/free-picks.js
// Minimal, robust free-picks endpoint with JSON error reporting

import axios from "axios";

const API_KEY   = process.env.API_FOOTBALL_KEY || "";
const API_TZ    = process.env.API_FOOTBALL_TZ || "Europe/London";

const REQUEST_TIMEOUT_MS     = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const MAX_FIXTURE_PAGES      = Number(process.env.MAX_FIXTURE_PAGES || 3);
const MAX_FIXTURES_TO_SCORE  = Number(process.env.MAX_FIXTURES_TO_SCORE || 220);
const FREEPICKS_MIN_CONF     = Number(process.env.FREEPICKS_MIN_CONF || 65);

// axios instance
const http = axios.create({
  baseURL: "https://v3.football.api-sports.io",
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "x-apisports-key": API_KEY }
});

// --- helpers
const todayYMD = () => new Date().toISOString().slice(0, 10);
const seasonFromDate = (ymd) => {
  const d = new Date(ymd);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
};

const EURO_COUNTRIES = new Set([
  "England","Spain","Italy","Germany","France","Scotland","Wales","Northern Ireland","Ireland",
  "Norway","Sweden","Denmark","Finland","Iceland","Estonia","Latvia","Lithuania",
  "Netherlands","Belgium","Luxembourg","Austria","Switzerland","Liechtenstein",
  "Croatia","Serbia","Bosnia and Herzegovina","Slovenia","North Macedonia","Montenegro","Albania","Kosovo",
  "Bulgaria","Romania","Hungary","Czech Republic","Slovakia","Poland",
  "Portugal","Greece","Turkey","Cyprus","Malta",
  "Ukraine","Belarus","Moldova","Georgia","Armenia","Azerbaijan",
  "Andorra","San Marino","Gibraltar","Faroe Islands","Europe","World"
]);

function isYouthOrWomen(f) {
  const s = [
    f?.teams?.home?.name,
    f?.teams?.away?.name,
    f?.league?.name
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function inScopeEuropeFirstSecondOrCups(f) {
  // keep Europe + remove youth/women. Allow league or cup, any tier (we’ll still filter by Europe).
  if (isYouthOrWomen(f)) return false;
  const country = f?.league?.country;
  if (!EURO_COUNTRIES.has(country)) return false;
  const t = (f?.league?.type || "").toLowerCase(); // "league" or "cup"
  return t === "league" || t === "cup";
}

async function fetchFixturesForDate(ymd) {
  const out = [];
  const TZ = [API_TZ, "Europe/London", "UTC"];

  const tryFetch = async (tz) => {
    let page = 1, total = 1;
    do {
      const { data } = await http.get(
        `/fixtures?date=${encodeURIComponent(ymd)}&page=${page}&timezone=${encodeURIComponent(tz)}`
      );
      total = data?.paging?.total || 1;
      const arr = data?.response || [];
      for (const f of arr) {
        if (inScopeEuropeFirstSecondOrCups(f)) {
          out.push(f);
          if (out.length >= MAX_FIXTURES_TO_SCORE) return true;
        }
      }
      page += 1;
      if (page > MAX_FIXTURE_PAGES) break;
      if (page <= total) await new Promise(r => setTimeout(r, 120));
    } while (page <= total);
    return false;
  };

  for (const tz of TZ) {
    const done = await tryFetch(tz);
    if (out.length || done) break;
  }
  return out;
}

// quick+simple team stats (blend current w/ previous)
async function fetchTeamStats(leagueId, season, teamId) {
  const { data } = await http.get(`/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`);
  const r = data?.response || null;
  if (!r) return null;
  const played = r.fixtures?.played?.total || 0;
  const gf = r.goals?.for?.total?.total || 0;
  const ga = r.goals?.against?.total?.total || 0;
  const avgGF = played ? gf / played : 0;
  const avgGA = played ? ga / played : 0;
  const explicitO25 = r.goals?.for?.over_2_5?.total;
  const pace = avgGF + avgGA;
  const estO25 = Math.min(95, Math.max(0, Math.round(pace * 10)));
  const o25pct = (typeof explicitO25 === "number" && explicitO25 >= 0) ? explicitO25 : estO25;

  const sumMin = (obj) => {
    try { return Object.values(obj || {}).reduce((s, m) => s + (m?.total || 0), 0); }
    catch { return 0; }
  };
  const cardsAvg = played ? (sumMin(r.cards?.yellow) + sumMin(r.cards?.red)) / played : 0;

  return { played, avgGF, avgGA, o25pct, cardsAvg };
}

// very light confidence (no odds)
const PRIOR_EXP_GOALS = Number(process.env.PRIOR_EXP_GOALS || 2.6);
const asPct = (n) => Math.max(1, Math.min(99, Math.round(Number(n) || 0)));

function scoreOU25(h, a) {
  const paceTotal = ((h.avgGF + h.avgGA) + (a.avgGF + a.avgGA)) / 2;
  const hist = (h.o25pct + a.o25pct) / 2;
  let rawOver  = 50 + (hist - 50) * 0.5 + (paceTotal - PRIOR_EXP_GOALS) * 20;
  let rawUnder = 50 + (50 - hist) * 0.5 + (PRIOR_EXP_GOALS - paceTotal) * 22;
  rawOver  = asPct(rawOver);
  rawUnder = asPct(rawUnder);
  if (rawOver >= rawUnder) return { side: "Over 2.5",  conf: rawOver };
  return { side: "Under 2.5", conf: rawUnder };
}

function reasonText(f, side, expGoals) {
  const home = f.teams?.home?.name || "Home";
  const away = f.teams?.away?.name || "Away";
  if (/under/i.test(side)) {
    return `${home} and ${away} trend to controlled phases with fewer clear chances. Projection ~${expGoals.toFixed(2)} total goals.`;
  } else {
    return `${home} and ${away} carry attacking intent; transitions should appear. Projection ~${expGoals.toFixed(2)} total goals.`;
  }
}

// tiny Poisson-ish expected goals proxy
function expGoalsFrom(h, a) {
  return Math.max(0.8, Math.min(4.5, (h.avgGF + a.avgGA + a.avgGF + h.avgGA) / 2));
}

// --- handler
export default async function handler(req, res) {
  const date = (req.query.date || todayYMD()).toString().slice(0, 10);
  const minConf = Number(req.query.minConf || FREEPICKS_MIN_CONF);
  const season = seasonFromDate(date);

  if (!API_KEY) {
    return res.status(500).json({ error: "missing_api_key" });
  }

  try {
    const fixturesFull = await fetchFixturesForDate(date);
    const fixtures = fixturesFull.slice(0, MAX_FIXTURES_TO_SCORE);

    const candidates = [];

    for (const f of fixtures) {
      const L   = f?.league?.id;
      const hId = f?.teams?.home?.id;
      const aId = f?.teams?.away?.id;
      if (!L || !hId || !aId) continue;

      try {
        const [h, a] = await Promise.all([
          fetchTeamStats(L, season, hId),
          fetchTeamStats(L, season, aId)
        ]);
        if (!h || !a) continue;

        const pick = scoreOU25(h, a);
        if (pick.conf < minConf) continue;

        const expG = expGoalsFrom(h, a);

        candidates.push({
          f, side: pick.side, confidence: pick.conf,
          expGoals: expG
        });
      } catch (_) {
        // skip this fixture on any error
      }
    }

    const picks = candidates
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 2)
      .map(x => ({
        match: `${x.f.teams.home.name} vs ${x.f.teams.away.name}`,
        league: x.f.league.name,
        kickoff: x.f.fixture.date,
        market: "Over/Under 2.5 Goals",
        prediction: x.side,
        odds: "—",
        confidence: x.confidence,
        reasoning: reasonText(x.f, x.side, x.expGoals)
      }));

    return res.json({
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf },
      meta: { poolSize: fixtures.length, candidates: candidates.length },
      picks,
      computedAt: new Date().toISOString()
    });

  } catch (e) {
    // Always return JSON with details so the frontend never sees a plain-text error
    const status = e?.response?.status || 500;
    const detail = e?.response?.data || e?.message || String(e);
    console.error("free-picks error:", status, detail);
    return res.status(500).json({
      error: "failed_to_load_picks",
      status,
      detail
    });
  }
}
