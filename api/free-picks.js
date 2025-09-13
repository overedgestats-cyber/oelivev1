// api/free-picks.js
// Free Picks — Top-2 OU2.5 across European club football (prefer top-two tiers; cup fallback).
// Always returns the best two edges (unless there are <2 fixtures).
// Use ?strict=1 to hard-enforce minConf; otherwise we still return the top 2 by confidence.

const axios = require('axios');

// ===== ENV / CONSTANTS ========================================================
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ || 'Europe/London';

const REQUEST_TIMEOUT_MS     = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const MAX_FIXTURE_PAGES      = Number(process.env.MAX_FIXTURE_PAGES || 3);     // per TZ query
const MAX_FIXTURES_TO_SCORE  = Number(process.env.MAX_FIXTURES_TO_SCORE || 180);
const DEFAULT_MIN_CONF       = Number(process.env.FREEPICKS_MIN_CONF || 60);   // label only unless strict=1

if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY (free-picks will 500)');

const AXIOS = {
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'x-apisports-key': API_KEY }
};

// ===== HELPERS =================================================================
function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){
  const d = new Date(dateStr); const y = d.getUTCFullYear(); const m = d.getUTCMonth()+1;
  return (m >= 7) ? y : y - 1;
}

// European scope (countries + UEFA comps)
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
// UEFA comps we always allow
const UEFA_IDS = new Set([2, 3, 848]); // UCL, UEL, UECL

function isYouthFixture(f){
  const s = [f?.teams?.home?.name, f?.teams?.away?.name, f?.league?.name].filter(Boolean).join(' ').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}

// Broad “top-two” heuristics from league names (we avoid brittle static ID lists)
const TOP_TIER_PATTERNS = [
  /premier|premiership|super\s*liga|super\s*league|liga\s*i(?!i)|liga 1(?!\d)|primeira|serie a|bundesliga(?!\s*2)|ligue\s*1|eredivisie|ekstraklasa|allsvenskan|eliteserien|pro league|first division a/i,
  /laliga(?!\s*2)|la\s*liga(?!\s*2)/i
];
const SECOND_TIER_PATTERNS = [
  /championship|segunda|liga\s*2|2\.*\s*bundesliga|serie\s*b|ligue\s*2|first division b|2nd|second division|i liga|1\. liga|2\. liga|ii liga/i
];
function isTopTwoDomestic(name){
  if (!name) return false;
  return TOP_TIER_PATTERNS.some(rx => rx.test(name)) || SECOND_TIER_PATTERNS.some(rx => rx.test(name));
}

function isUEFAComp(f){ return UEFA_IDS.has(f?.league?.id); }
function isCup(f){
  const t = String(f?.league?.type || '').toLowerCase();
  return t === 'cup' || isUEFAComp(f);
}
function isLeague(f){
  return String(f?.league?.type || '').toLowerCase() === 'league';
}

function inEuropeClubScope(f){
  const lid = f?.league?.id;
  const c   = f?.league?.country;
  const t   = (f?.league?.type || '').toLowerCase(); // "league" or "cup"
  if (isYouthFixture(f)) return false;
  if (!EURO_COUNTRIES.has(c) && !UEFA_IDS.has(lid)) return false;
  if (t !== 'league' && t !== 'cup') return false;
  return true;
}

async function fetchAllEuropeFixtures(date){
  const attempt = async (query, tz) => {
    const out = [];
    let page = 1, total = 1;
    do {
      const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const resp = r.data || {};
        total = resp?.paging?.total || 1;
        for (const f of (resp.response || [])){
          if (inEuropeClubScope(f)) {
            out.push(f);
            if (out.length >= MAX_FIXTURES_TO_SCORE) return out;
          }
        }
      } catch (_){ break; }
      page += 1;
      if (page > MAX_FIXTURE_PAGES) break;
      if (page <= total) await new Promise(r => setTimeout(r, 120));
    } while (page <= total);
    return out;
  };

  const TZS = [API_TZ, 'Europe/London', 'UTC'];
  for (const tz of TZS){
    const a = await attempt(`date=${date}`, tz);
    if (a.length) return a;
  }
  for (const tz of TZS){
    const b = await attempt(`from=${date}&to=${date}`, tz);
    if (b.length) return b;
  }
  return [];
}

// ===== TEAM STATS + POISSON ===================================================
const statsCache = new Map(); // key: raw_{league}_{season}_{team}

async function fetchTeamStatsRaw(leagueId, season, teamId){
  const key = `raw_${leagueId}_${season}_${teamId}`;
  if (statsCache.has(key)) return statsCache.get(key);
  try{
    const url = `https://v3.football.api-sports.io/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`;
    const r = await axios.get(url, AXIOS);
    const data = r.data?.response || null;
    statsCache.set(key, data);
    return data;
  }catch(_){ return null; }
}

function normalizeStats(resp){
  if (!resp) return null;
  const played = resp.fixtures?.played?.total || 0;
  const gf     = resp.goals?.for?.total?.total || 0;
  const ga     = resp.goals?.against?.total?.total || 0;
  const avgGF  = played ? gf/played : 0;
  const avgGA  = played ? ga/played : 0;
  return { played, avgGF, avgGA };
}

async function getTeamStatsBlended(leagueId, season, teamId){
  const cur  = normalizeStats(await fetchTeamStatsRaw(leagueId, season,   teamId));
  const prev = normalizeStats(await fetchTeamStatsRaw(leagueId, season-1, teamId));
  if (!cur && !prev) return null;
  if (!cur) return prev;
  if (cur.played >= 6 || !prev) return cur;
  // small blend early season
  const wCur= Math.min(0.6, cur.played/8), wPrev=1-wCur;
  return {
    played: cur.played,
    avgGF:  cur.avgGF*wCur + (prev?.avgGF||0)*wPrev,
    avgGA:  cur.avgGA*wCur + (prev?.avgGA||0)*wPrev
  };
}

function _logFact(n){ let s=0; for(let i=1;i<=n;i++) s+=Math.log(i); return s; }
function poissonP(lambda,k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }

function probTotalsAtLeast(lambdaH, lambdaA, minGoals=3, maxK=10){
  let p=0;
  for (let h=0; h<=maxK; h++){
    const ph = poissonP(lambdaH,h);
    for (let a=0; a<=maxK; a++){
      if (h+a>=minGoals) p += ph*poissonP(lambdaA,a);
    }
  }
  return Math.min(Math.max(p,0),1);
}

// Priors for smoothing
const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.60);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 20);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.50);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.40);

function estimateLambdas(h, a){
  const estH = Math.max(((h.avgGF||0)+(a.avgGA||0))/2, 0.05);
  const estA = Math.max(((a.avgGF||0)+(h.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS*PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS*(1-PRIOR_HOME_SHARE);
  const n = Math.max(0, (h.played||0)+(a.played||0));
  const w = n/(n+PRIOR_MATCHES);
  const lambdaHome = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w)+estH*w));
  const lambdaAway = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorA*(1-w)+estA*w));
  const expGoals   = lambdaHome + lambdaAway;
  return { lambdaHome, lambdaAway, expGoals };
}

function reasonText(f, exp){
  const home = f.teams?.home?.name || 'Home';
  const away = f.teams?.away?.name || 'Away';
  return `${home} vs ${away}: projected ~${exp.toFixed(2)} goals based on blended attack/defence rates.`;
}

// ===== HANDLER ================================================================
module.exports = async (req, res) => {
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date     = (req.query.date || todayYMD()).slice(0,10);
    const season   = seasonFromDate(date);
    const minConf  = Number(req.query.minConf || DEFAULT_MIN_CONF); // label (unless strict)
    const strict   = req.query.strict === '1';
    const debug    = req.query.debug  === '1';
    const refresh  = req.query.refresh=== '1'; // accepted for parity (no persistent cache here)

    // 1) Fetch fixtures (Europe + league/cup); then enforce top-two preference with cup fallback.
    const fixturesAll = await fetchAllEuropeFixtures(date);
    const fixturesEu  = fixturesAll.filter(inEuropeClubScope);

    const topTwo = fixturesEu.filter(f => isLeague(f) && isTopTwoDomestic(f.league?.name));
    const cups   = fixturesEu.filter(isCup);

    // Prefer top-two tiers; if none exist that day, use cups instead.
    const fixturesToScore = (topTwo.length > 0 ? topTwo : cups).slice(0, MAX_FIXTURES_TO_SCORE);

    // 2) Score each fixture
    const scored = [];
    for (const f of fixturesToScore){
      try{
        const L  = f.league?.id;
        const hT = f.teams?.home?.id;
        const aT = f.teams?.away?.id;
        if (!L || !hT || !aT) continue;

        const [h, a] = [
          await getTeamStatsBlended(L, season, hT),
          await getTeamStatsBlended(L, season, aT)
        ];
        if (!h || !a) continue;

        const { lambdaHome, lambdaAway, expGoals } = estimateLambdas(h, a);
        const pOver = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
        const pUnder= 1 - pOver;

        const pickSide   = (pOver >= pUnder) ? 'Over 2.5' : 'Under 2.5';
        const confidence = Math.round(100 * Math.max(pOver, pUnder));

        scored.push({
          match: `${f.teams.home.name} vs ${f.teams.away.name}`,
          league: f.league?.name || '',
          kickoff: f.fixture?.date,
          market: 'Over/Under 2.5 Goals',
          prediction: pickSide,
          confidence,
          meta: {
            pOver25: Math.round(100*pOver),
            expGoals: Number(expGoals.toFixed(2)),
          },
          reasoning: reasonText(f, expGoals)
        });
      } catch (_){ /* skip silently */ }
    }

    // 3) Choose top 2
    let pool = scored;
    if (strict) pool = scored.filter(x => x.confidence >= minConf);
    pool.sort((a,b) => b.confidence - a.confidence);

    let picks = pool.slice(0,2);
    // if strict filter yields <2, fall back to top2 overall so the page never empties
    if (!strict && picks.length < 2 && scored.length) {
      picks = scored.sort((a,b)=> b.confidence - a.confidence).slice(0,2);
    }

    const payload = {
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf, strict },
      meta: {
        poolSize: fixturesToScore.length,
        candidates: scored.length,
        usedBucket: (topTwo.length > 0 ? 'top-two' : 'cups'),
        ...(debug ? {
          leaguesSample: Array.from(new Set(fixturesToScore.map(x => x.league?.name))).slice(0,12)
        } : {})
      },
      picks,
      computedAt: new Date().toISOString()
    };
    return res.json(payload);

  }catch(e){
    console.error('free-picks error:', e?.stack || e?.message || e);
    res.status(500).json({ error:'failed_to_load_picks', detail: e?.message || String(e) });
  }
};
