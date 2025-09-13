// api/free-picks.js
// Free Picks — Top-2 OU2.5 across European club football (1st/2nd + national cups + UCL/UEL/UECL)
// Uses last-15 official matches per team, Poisson-ish model for OU2.5,
// robust fixture discovery (date -> league whitelist -> fallback leagues -> from/to -> dynamic league scan).

const axios = require('axios');

// ===== ENV / CONSTANTS =======================================================
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ  || 'Europe/London';

const REQUEST_TIMEOUT_MS     = Number(process.env.REQUEST_TIMEOUT_MS     || 10000);
const MAX_FIXTURE_PAGES      = Number(process.env.MAX_FIXTURE_PAGES      || 3);
const MAX_FIXTURES_TO_SCORE  = Number(process.env.MAX_FIXTURES_TO_SCORE  || 140);
const DEFAULT_MIN_CONF       = Number(process.env.FREEPICKS_MIN_CONF     || 60);
const MAX_LEAGUES_FALLBACK   = Number(process.env.MAX_LEAGUES_FALLBACK   || 60);   // cap dynamic league scan

if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY');

const AXIOS = {
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'x-apisports-key': API_KEY }
};

function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){
  const d = new Date(dateStr);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return (m >= 7) ? y : y - 1;
}

// ---------- Explicit league whitelists (API-Football IDs) ----------
const PRIMARY_LEAGUE_IDS = [
  // Top 5
  39,   // England Premier League
  140,  // Spain La Liga
  135,  // Italy Serie A
  78,   // Germany Bundesliga
  61,   // France Ligue 1
  // UEFA
  2,    // UEFA Champions League
  3,    // UEFA Europa League
  848   // UEFA Europa Conference League
];

const FALLBACK_LEAGUE_IDS = [
  88,   // Netherlands Eredivisie
  94,   // Portugal Primeira Liga
  144,  // Belgium Pro League
  253   // USA MLS (last resort)
];

// Countries considered “Europe” here (club football), plus “Europe/World” to include UCL/UEL/UECL
const EURO_COUNTRIES = new Set([
  'England','Spain','Italy','Germany','France','Scotland','Wales','Northern Ireland','Ireland',
  'Norway','Sweden','Denmark','Finland','Iceland','Estonia','Latvia','Lithuania',
  'Netherlands','Belgium','Luxembourg','Austria','Switzerland','Liechtenstein',
  'Croatia','Serbia','Bosnia and Herzegovina','Slovenia','North Macedonia','Montenegro','Albania','Kosovo',
  'Bulgaria','Romania','Hungary','Czech Republic','Slovakia','Poland',
  'Portugal','Greece','Turkey','Cyprus','Malta',
  'Ukraine','Belarus','Moldova','Georgia','Armenia','Azerbaijan',
  'Andorra','San Marino','Gibraltar','Faroe Islands','Europe','World'
]);

// UEFA competitions (Champions League / Europa League / Conference League)
const UEFA_LEAGUE_IDS = new Set([2, 3, 848]);

function isYouthOrNonSenior(text){
  const s = (text || '').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function isFriendlies(league){
  const n = (league?.name || '').toLowerCase();
  return n.includes('friendlies');
}
function isInEuropeClubScope(f){
  if (!f) return false;
  const c   = f.league?.country;
  const lid = f.league?.id;
  const t   = (f.league?.type || '').toLowerCase(); // 'league' | 'cup' | 'Friendly'
  // basic excludes
  if (isYouthOrNonSenior(f.teams?.home?.name + ' ' + f.teams?.away?.name + ' ' + f.league?.name)) return false;
  if (isFriendlies(f.league)) return false;
  // Europe club scope (1st/2nd divisions + national cups + UCL/UEL/UECL)
  const inGeo = EURO_COUNTRIES.has(c) || UEFA_LEAGUE_IDS.has(lid);
  const inType = (t === 'league' || t === 'cup');
  return inGeo && inType;
}

// ===== Fixture discovery with league IDs first ===============================

async function fetchFixturesByLeagueList(date, season, leagueIds, debugRows, tag='whitelist'){
  const keep = (arr) => (arr || []).filter(isInEuropeClubScope);
  const TZS = [API_TZ, 'Europe/London', 'UTC'];
  const out = [];

  for (const lid of leagueIds) {
    for (const tz of TZS) {
      // API-Football requires one league per request
      const url = `https://v3.football.api-sports.io/fixtures?league=${lid}&season=${season}&date=${date}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const d = r.data || {};
        const results = typeof d.results === 'number' ? d.results : (d.response?.length || 0);
        debugRows.push({ stage:`${tag}-league`, leagueId: lid, url, status: r.status, results, errors: d?.errors || null });
        out.push(...keep(d.response));
      } catch (e) {
        debugRows.push({ stage:`${tag}-league`, leagueId: lid, url, status: e?.response?.status || 0, errors: e?.response?.data?.errors || e?.message || 'error' });
      }
      if (out.length >= MAX_FIXTURES_TO_SCORE) break;
    }
    if (out.length >= MAX_FIXTURES_TO_SCORE) break;
  }
  return out;
}

// Try date / from-to with 3 TZs, then dynamic league-by-league scan for Europe
async function fetchFixturesRobust(date, season, debugRows){
  const keep = (arr) => (arr || []).filter(isInEuropeClubScope);
  const TZS = [API_TZ, 'Europe/London', 'UTC'];

  const attempt = async (query, tz) => {
    let page = 1, total = 1, out = [];
    do {
      const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const d = r.data || {};
        const results = typeof d.results === 'number' ? d.results : (d.response?.length || 0);
        total = d?.paging?.total || 1;
        debugRows.push({ stage: 'date-scan', url, status: r.status, results, total, errors: d?.errors || null, message: d?.message || null });
        out = out.concat(keep(d.response));
        if (out.length >= MAX_FIXTURES_TO_SCORE) break;
      } catch (e) {
        debugRows.push({ stage:'date-scan', url, status: e?.response?.status || 0, results: 0, total: 0, errors: e?.response?.data?.errors || e?.message || 'error' });
        break;
      }
      page += 1;
      if (page > MAX_FIXTURE_PAGES) break;
      if (page <= total) await new Promise(r => setTimeout(r, 120));
    } while (page <= total);
    return out;
  };

  // A) date=? first
  for (const tz of TZS) {
    const arr = await attempt(`date=${date}`, tz);
    if (arr.length) return arr;
  }
  // B) fallback from=to
  for (const tz of TZS) {
    const arr = await attempt(`from=${date}&to=${date}`, tz);
    if (arr.length) return arr;
  }

  // C) Dynamic League-by-league fallback (heavier): enumerate current European leagues (1st/2nd + national cups + UCL/UEL/UECL)
  let leagues = [];
  try {
    // Pull all current leagues, then filter to Europe scope
    const url = `https://v3.football.api-sports.io/leagues?current=true`;
    const r = await axios.get(url, AXIOS);
    const d = r.data || {};
    debugRows.push({ stage:'leagues-current', url, status: r.status, results: d?.results || (d?.response?.length || 0), errors: d?.errors || null });
    leagues = (d.response || []).filter(L => {
      const c = L.country?.name;
      const t = (L.league?.type || '').toLowerCase(); // league/cup
      if (!EURO_COUNTRIES.has(c) && !UEFA_LEAGUE_IDS.has(L.league?.id)) return false;
      if (isYouthOrNonSenior(L.league?.name)) return false;
      if (isFriendlies(L.league)) return false;
      return (t === 'league' || t === 'cup');
    }).slice(0, MAX_LEAGUES_FALLBACK);
  } catch (e) {
    debugRows.push({ stage:'leagues-current', url:'.../leagues?current=true', status: e?.response?.status || 0, errors: e?.response?.data?.errors || e?.message || 'error' });
  }

  const byLeague = [];
  for (const L of leagues) {
    const lid = L.league?.id;
    if (!lid) continue;
    for (const tz of TZS) {
      const url = `https://v3.football.api-sports.io/fixtures?league=${lid}&season=${season}&date=${date}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const d = r.data || {};
        const results = typeof d.results === 'number' ? d.results : (d.response?.length || 0);
        debugRows.push({ stage:'league-scan', url, status: r.status, results, errors: d?.errors || null });
        byLeague.push(...(d.response || []).filter(isInEuropeClubScope));
      } catch (e) {
        debugRows.push({ stage:'league-scan', url, status: e?.response?.status || 0, errors: e?.response?.data?.errors || e?.message || 'error' });
      }
      if (byLeague.length >= MAX_FIXTURES_TO_SCORE) break;
    }
    if (byLeague.length >= MAX_FIXTURES_TO_SCORE) break;
  }

  return byLeague;
}

// ===== Last-15 official matches per team =====================================

const teamLastCache = new Map(); // teamId -> array of last fixtures (filtered)
function isOfficialClubFixture(fix){
  // exclude friendlies/youth/women/reserves
  if (isYouthOrNonSenior(fix.league?.name)) return false;
  if (isFriendlies(fix.league)) return false;
  return true;
}
async function getTeamLastOfficialMatches(teamId, count=15){
  if (teamLastCache.has(teamId)) return teamLastCache.get(teamId);
  // fixtures?team=XXX&last=15  (returns across competitions)
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=${count}`;
  try {
    const r = await axios.get(url, AXIOS);
    const d = r.data || {};
    let arr = (d.response || []).filter(isOfficialClubFixture);
    teamLastCache.set(teamId, arr);
    return arr;
  } catch {
    teamLastCache.set(teamId, []);
    return [];
  }
}

function computeTeamForm(lastFixtures, teamId){
  // simple summary from last fixtures: goals for/against per match, OU2.5 rate
  let games = 0, gf=0, ga=0, over25=0;
  for (const fx of lastFixtures) {
    const hs = fx.score?.fulltime?.home ?? fx.goals?.home ?? 0;
    const as = fx.score?.fulltime?.away ?? fx.goals?.away ?? 0;
    if (typeof hs !== 'number' || typeof as !== 'number') continue;
    if (fx.fixture?.status?.short !== 'FT') continue; // only finished
    games += 1;
    const isHome = fx.teams?.home?.id === teamId;
    gf += isHome ? hs : as;
    ga += isHome ? as : hs;
    if ((hs + as) >= 3) over25 += 1;
  }
  const avgGF = games ? gf/games : 0;
  const avgGA = games ? ga/games : 0;
  const o25   = games ? (over25/games) : 0;
  return { games, avgGF, avgGA, o25 };
}

// ===== Poisson-ish OU2.5 model ===============================================

function _logFact(n){ let s=0; for (let i=1;i<=n;i++) s+=Math.log(i); return s; }
function poissonP(lambda, k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }
function probTotalsAtLeast(lambdaH, lambdaA, minGoals=3, maxK=10){
  let p=0;
  for (let h=0; h<=maxK; h++){
    const ph = poissonP(lambdaH, h);
    for (let a=0; a<=maxK; a++){
      if (h+a >= minGoals) p += ph * poissonP(lambdaA, a);
    }
  }
  return Math.min(Math.max(p,0),1);
}

// Priors to stabilize small samples
const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.60);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 16);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.45);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.60);

function estimateLambdasFromForm(hForm, aForm){
  const estH = Math.max(((hForm.avgGF||0) + (aForm.avgGA||0))/2, 0.05);
  const estA = Math.max(((aForm.avgGF||0) + (hForm.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS * PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS * (1 - PRIOR_HOME_SHARE);
  const n = Math.max(0, (hForm.games||0) + (aForm.games||0));
  const w = n / (n + PRIOR_MATCHES);
  const lambdaHome = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w) + estH*w));
  const lambdaAway = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorA*(1-w) + estA*w));
  const expGoals   = lambdaHome + lambdaAway;
  return { lambdaHome, lambdaAway, expGoals };
}

function toPct(n){ return Math.max(1, Math.min(99, Math.round(Number(n)||0))); }

// Friendly reason text
function reason(f, exp, hForm, aForm){
  const home = f.teams?.home?.name || 'Home';
  const away = f.teams?.away?.name || 'Away';
  return `${home} vs ${away}: pace from last-15 suggests ~${exp.toFixed(2)} goals `
    + `(H avgGF ${hForm.avgGF.toFixed(2)} / A avgGF ${aForm.avgGF.toFixed(2)}; `
    + `def rates H ${hForm.avgGA.toFixed(2)} / A ${aForm.avgGA.toFixed(2)}).`;
}

// ===== Handler ================================================================
module.exports = async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    const date    = (req.query.date || todayYMD()).slice(0,10);
    const season  = seasonFromDate(date);
    const minConf = Number(req.query.minConf || DEFAULT_MIN_CONF); // label only
    const strict  = req.query.strict === '1';
    const debug   = req.query.debug  === '1';

    const debugRows = [];

    // ---- 1) Primary whitelist scan (Top-5 + UEFA) ----
    let fixturesRaw = await fetchFixturesByLeagueList(date, season, PRIMARY_LEAGUE_IDS, debugRows, 'primary');

    // ---- 2) If not enough candidates later, we may need more fixtures:
    // We'll *append* fallback leagues *only if* the scored pool ends < 2.
    // For now, just keep fixturesRaw as-is; we might add more after scoring.
    let usedLeagueSets = { primary: [...PRIMARY_LEAGUE_IDS], fallback: [] };

    // We only score up to MAX_FIXTURES_TO_SCORE to control cost/time.
    let fixtures = fixturesRaw.slice(0, MAX_FIXTURES_TO_SCORE);

    const picksRaw = [];
    for (const f of fixtures) {
      try {
        const lid = f.league?.id;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!lid || !hId || !aId) continue;

        const [lastH, lastA] = await Promise.all([
          getTeamLastOfficialMatches(hId, 15),
          getTeamLastOfficialMatches(aId, 15)
        ]);
        const hForm = computeTeamForm(lastH, hId);
        const aForm = computeTeamForm(lastA, aId);
        // require some minimum data
        if ((hForm.games + aForm.games) < 8) continue;

        const { lambdaHome, lambdaAway, expGoals } = estimateLambdasFromForm(hForm, aForm);
        const pOver  = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
        const pUnder = 1 - pOver;
        const side   = (pOver >= pUnder) ? 'Over 2.5' : 'Under 2.5';
        const conf   = toPct(100 * Math.max(pOver, pUnder));

        picksRaw.push({
          match: `${f.teams.home.name} vs ${f.teams.away.name}`,
          league: f.league?.name || '',
          kickoff: f.fixture?.date,
          market: 'Over/Under 2.5 Goals',
          prediction: side,
          confidence: conf,
          meta: {
            leagueId: lid,
            pOver25: toPct(100 * pOver),
            expGoals: Number(expGoals.toFixed(2)),
            last15: { homeGames: hForm.games, awayGames: aForm.games }
          },
          reasoning: reason(f, expGoals, hForm, aForm)
        });
      } catch (_) { /* skip this fixture */ }
    }

    // sort & take top2; enforce 'strict' if requested
    const finalize = (poolArr) => {
      let pool = [...poolArr].sort((a,b)=> b.confidence - a.confidence);
      if (strict) pool = pool.filter(x => x.confidence >= minConf);
      let picks = pool.slice(0,2);
      if (!strict && picks.length < 2 && poolArr.length) {
        picks = [...poolArr].sort((a,b)=> b.confidence - a.confidence).slice(0,2);
      }
      return picks;
    };

    let picks = finalize(picksRaw);

    // ---- 3) If still < 2 picks, extend with FALLBACK leagues then, as last resort, robust scan ----
    if (picks.length < 2) {
      // Add more fixtures from fallback leagues
      const fallbackFixtures = await fetchFixturesByLeagueList(date, season, FALLBACK_LEAGUE_IDS, debugRows, 'fallback');
      usedLeagueSets.fallback = [...FALLBACK_LEAGUE_IDS];

      const moreFixtures = fallbackFixtures.slice(0, Math.max(0, MAX_FIXTURES_TO_SCORE - fixtures.length));
      fixtures = fixtures.concat(moreFixtures);

      // Score only the newly added fixtures to avoid rework
      for (const f of moreFixtures) {
        try {
          const lid = f.league?.id;
          const hId = f.teams?.home?.id;
          const aId = f.teams?.away?.id;
          if (!lid || !hId || !aId) continue;

          const [lastH, lastA] = await Promise.all([
            getTeamLastOfficialMatches(hId, 15),
            getTeamLastOfficialMatches(aId, 15)
          ]);
          const hForm = computeTeamForm(lastH, hId);
          const aForm = computeTeamForm(lastA, aId);
          if ((hForm.games + aForm.games) < 8) continue;

          const { lambdaHome, lambdaAway, expGoals } = estimateLambdasFromForm(hForm, aForm);
          const pOver  = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
          const pUnder = 1 - pOver;
          const side   = (pOver >= pUnder) ? 'Over 2.5' : 'Under 2.5';
          const conf   = toPct(100 * Math.max(pOver, pUnder));

          picksRaw.push({
            match: `${f.teams.home.name} vs ${f.teams.away.name}`,
            league: f.league?.name || '',
            kickoff: f.fixture?.date,
            market: 'Over/Under 2.5 Goals',
            prediction: side,
            confidence: conf,
            meta: {
              leagueId: lid,
              pOver25: toPct(100 * pOver),
              expGoals: Number(expGoals.toFixed(2)),
              last15: { homeGames: hForm.games, awayGames: aForm.games }
            },
            reasoning: reason(f, expGoals, hForm, aForm)
          });
        } catch (_) {}
      }

      picks = finalize(picksRaw);

      // Last resort: if still nothing, fall back to your original robust discovery
      if (picks.length < 2) {
        const robustFixtures = await fetchFixturesRobust(date, season, debugRows);
        const add = robustFixtures.slice(0, Math.max(0, MAX_FIXTURES_TO_SCORE - fixtures.length));
        fixtures = fixtures.concat(add);

        for (const f of add) {
          try {
            const lid = f.league?.id;
            const hId = f.teams?.home?.id;
            const aId = f.teams?.away?.id;
            if (!lid || !hId || !aId) continue;

            const [lastH, lastA] = await Promise.all([
              getTeamLastOfficialMatches(hId, 15),
              getTeamLastOfficialMatches(aId, 15)
            ]);
            const hForm = computeTeamForm(lastH, hId);
            const aForm = computeTeamForm(lastA, aId);
            if ((hForm.games + aForm.games) < 8) continue;

            const { lambdaHome, lambdaAway, expGoals } = estimateLambdasFromForm(hForm, aForm);
            const pOver  = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
            const pUnder = 1 - pOver;
            const side   = (pOver >= pUnder) ? 'Over 2.5' : 'Under 2.5';
            const conf   = toPct(100 * Math.max(pOver, pUnder));

            picksRaw.push({
              match: `${f.teams.home.name} vs ${f.teams.away.name}`,
              league: f.league?.name || '',
              kickoff: f.fixture?.date,
              market: 'Over/Under 2.5 Goals',
              prediction: side,
              confidence: conf,
              meta: {
                leagueId: lid,
                pOver25: toPct(100 * pOver),
                expGoals: Number(expGoals.toFixed(2)),
                last15: { homeGames: hForm.games, awayGames: aForm.games }
              },
              reasoning: reason(f, expGoals, hForm, aForm)
            });
          } catch (_) {}
        }

        picks = finalize(picksRaw);
      }
    }

    const payload = {
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf, strict },
      meta: {
        rawFixtures: fixtures.length,
        candidates: picksRaw.length,
        leagueSetsUsed: usedLeagueSets,
        ...(debug ? { debugLog: debugRows } : {})
      },
      picks,
      computedAt: new Date().toISOString()
    };
    res.json(payload);

  } catch (e) {
    console.error('free-picks error:', e?.message || e);
    res.status(500).json({ error: 'failed_to_load_picks', detail: e?.message || String(e) });
  }
};
