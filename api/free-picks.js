// api/free-picks.js
'use strict';

/**
 * Free Picks (public)
 * - O/U 2.5 only
 * - European 1st/2nd divisions
 * - EXCLUDES Pro-board leagues:
 *   ENG: Premier League, Championship
 *   GER: Bundesliga, 2. Bundesliga
 *   ESP: La Liga, La Liga 2 / Segunda
 *   ITA: Serie A, Serie B
 *   FRA: Ligue 1, Ligue 2
 * - EXCLUDES international comps (UEFA/FIFA/AFCON/Asian Cup etc).
 *
 * Query overrides:
 *   ?date=YYYY-MM-DD (UTC)
 *   ?minConf=65  ?minOdds=1.5  ?strict=0/1   ?debug=1/0
 */

const { URL } = require('url');
const OE = require('../overedge-api'); // adapt if your helper path differs

// Defaults (env overrides optional)
const DEF_MIN_CONF = Number(process.env.FREE_MIN_CONF ?? 65);
const DEF_MIN_ODDS = Number(process.env.FREE_MIN_ODDS ?? 1.5);
const DEF_STRICT   = String(process.env.FREE_STRICT_ONLY ?? 'false') === 'true';

function qBool(v, fallback) {
  if (v == null) return fallback;
  const s = String(v).toLowerCase();
  if (['1','true','yes','y','on'].includes(s)) return true;
  if (['0','false','no','n','off'].includes(s)) return false;
  return fallback;
}
function qNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
const norm = (s) => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

// Broad list of UEFA/European countries (club competitions)
const EURO_COUNTRIES = new Set([
  'england','scotland','wales','northern ireland','ireland','republic of ireland',
  'spain','germany','france','italy','portugal','netherlands','belgium','austria',
  'switzerland','denmark','sweden','norway','finland','iceland',
  'poland','czech republic','czechia','slovakia','slovenia','croatia','serbia','bosnia','bosnia and herzegovina',
  'montenegro','kosovo','albania','north macedonia','macedonia','greece','turkiye','turkey','bulgaria','romania',
  'hungary','ukraine','belarus','russia','estonia','latvia','lithuania','georgia','armenia','azerbaijan','moldova',
  'luxembourg','andorra','san marino','liechtenstein','malta','cyprus','monaco','faroe islands','gibraltar'
]);

// Matches any of these substrings in a normalized league name
function nameHas(name, arr) {
  const n = norm(name);
  return arr.some(p => n.includes(p));
}

// Detect top-5 + second tiers that are on the Pro board (by name aliases)
function isProBoardLeagueByName(leagueName) {
  const n = norm(leagueName);
  return (
    // England
    nameHas(n, ['premier league','epl']) ||
    nameHas(n, ['championship']) ||

    // Germany
    nameHas(n, ['bundesliga']) ||      // will match both 1 & 2 – refine below:
    // refine: if it says "2. bundesliga", "zweite" or "bundesliga 2" we also mark it:
    nameHas(n, ['2 bundesliga','zweite bundesliga','bundesliga 2']) ||

    // Spain
    nameHas(n, ['la liga','laliga','primera division']) ||
    nameHas(n, ['la liga 2','laliga2','segunda division','laliga smartbank']) ||

    // Italy
    nameHas(n, ['serie a']) ||
    nameHas(n, ['serie b']) ||

    // France
    nameHas(n, ['ligue 1','ligue1']) ||
    nameHas(n, ['ligue 2','ligue2'])
  );
}

// International competitions we exclude from Free Picks
function isInternationalCompetition(name) {
  const n = norm(name);
  return (
    nameHas(n, ['uefa','champions league','europa league','conference league','nations league','euro']) ||
    nameHas(n, ['fifa','world cup','qualifier']) ||
    nameHas(n, ['afcon','africa cup','african cup of nations']) ||
    nameHas(n, ['asian cup','afc asian'])
  );
}

// Decide if a fixture is European domestic (club) 1st/2nd tier
function isEuropeanDomestic12(fx) {
  const region = norm(fx?.league?.region);
  const country = norm(fx?.league?.country || fx?.country);
  const tier = Number(fx?.league?.tier);

  // International comps excluded
  const lname = fx?.league?.name || fx?.league?.code || '';
  if (isInternationalCompetition(lname)) return false;

  // Region/country check
  const european =
    region === 'europe' ||
    EURO_COUNTRIES.has(country);

  if (!european) return false;

  // 1st/2nd tiers: if explicit tier present, enforce <=2; if tier missing, include (don’t under-filter).
  if (Number.isFinite(tier)) return tier === 1 || tier === 2;
  return true;
}

module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const dateStr    = u.searchParams.get('date');        // YYYY-MM-DD (UTC)
    const minConf    = qNum(u.searchParams.get('minConf'), DEF_MIN_CONF);
    const minOdds    = qNum(u.searchParams.get('minOdds'), DEF_MIN_ODDS);
    const strictOnly = qBool(u.searchParams.get('strict'), DEF_STRICT);
    const wantDebug  = qBool(u.searchParams.get('debug'), true);

    const dateUsed = dateStr || new Date().toISOString().slice(0,10);
    const slate = await OE.loadSlate(dateUsed); // <- use your internal data access

    const dbg = {
      raw: slate.length,
      eu12: 0,
      minusProBoard: 0,
      withOU25: 0,
      afterThresholds: 0
    };

    // Step 1: European domestic clubs (1st/2nd tiers)
    let pool = slate.filter(isEuropeanDomestic12);
    dbg.eu12 = pool.length;

    // Step 2: remove Pro-board leagues (top-5 + their seconds)
    pool = pool.filter(fx => !isProBoardLeagueByName(fx?.league?.name || fx?.league?.code));
    dbg.minusProBoard = pool.length;

    // Step 3: keep only O/U 2.5 with a computed confidence
    pool = pool.filter(fx => fx?.markets?.ou25 && typeof fx.markets.ou25.conf === 'number');
    dbg.withOU25 = pool.length;

    // Step 4: thresholds
    const pass = (m) => {
      if (strictOnly) {
        return m.conf >= minConf && Number(m.odds) >= minOdds;
      }
      return (m.conf >= minConf) || (m.conf >= (minConf - 3) && Number(m.odds) >= (minOdds - 0.1));
    };

    const candidates = pool
      .map(fx => ({ fx, m: fx.markets.ou25 }))
      .filter(({ m }) => pass(m))
      .sort((a, b) => b.m.conf - a.m.conf);

    dbg.afterThresholds = candidates.length;

    // Pick top 2 and shape
    const picks = candidates.slice(0, 2).map(({ fx, m }) => ({
      match: `${fx.home} vs ${fx.away}`,
      league: fx.league?.name || fx.league?.code || '—',
      kickoff: fx.kickoff,
      market: 'O/U 2.5',
      prediction: m.pick === 'over' ? 'Over 2.5' : 'Under 2.5',
      confidence: Math.round(m.conf),
      odds: m.odds != null ? String(m.odds) : '—',
      reasoning: OE.buildReasoningForOU25(fx, m) // your 3–4 lines + final expected-goals line
    }));

    const payload = {
      dateRequested: dateStr || null,
      dateUsed,
      thresholds: { minConf, minOdds, strictOnly },
      meta: { poolSize: dbg.eu12, candidates: dbg.afterThresholds },
      ...(wantDebug ? { debug: dbg } : {}),
      picks,
      computedAt: new Date().toISOString(),
      cached: false
    };

    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
  } catch (err) {
    console.error('free-picks error', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'free_picks_failed', message: err?.message || String(err) }));
  }
};

module.exports.config = { runtime: "nodejs20.x" };
