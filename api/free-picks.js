// api/free-picks.js
// Free Picks — Top-2 OU2.5 across Europe club football (1st/2nd + cups)
// Will always try to return top-2. With ?strict=1 it hard-enforces minConf.

const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ || 'Europe/London';

const REQUEST_TIMEOUT_MS     = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const MAX_FIXTURE_PAGES      = Number(process.env.MAX_FIXTURE_PAGES || 3);
const MAX_FIXTURES_TO_SCORE  = Number(process.env.MAX_FIXTURES_TO_SCORE || 180);
const DEFAULT_MIN_CONF       = Number(process.env.FREEPICKS_MIN_CONF || 60);

if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY');

const AXIOS = { timeout: REQUEST_TIMEOUT_MS, headers: { 'x-apisports-key': API_KEY } };

function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){ const d=new Date(dateStr); const y=d.getUTCFullYear(), m=d.getUTCMonth()+1; return (m>=7)?y:y-1; }

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
const UEFA_IDS = new Set([2,3,848]); // UCL/UEL/UECL

function isYouthFixture(f){
  const s = [f?.teams?.home?.name,f?.teams?.away?.name,f?.league?.name].filter(Boolean).join(' ').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function inEuropeClubScope(f){
  const lid=f?.league?.id, c=f?.league?.country, t=(f?.league?.type||'').toLowerCase();
  if (isYouthFixture(f)) return false;
  if (!EURO_COUNTRIES.has(c) && !UEFA_IDS.has(lid)) return false;
  if (t!=='league' && t!=='cup') return false;
  return true;
}

// ---- fixtures with debug logging
async function fetchAllEuropeFixtures(date, { nofilter=false } = {}){
  const log = [];
  let lastError = null;

  const attempt = async (query, tz) => {
    const out = [];
    let page=1, total=1;
    do {
      const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const resp = r.data || {};
        const arr = resp?.response || [];
        total = resp?.paging?.total || 1;

        const before = arr.length;
        for (const f of arr){
          if (nofilter || inEuropeClubScope(f)) {
            out.push(f);
            if (out.length >= MAX_FIXTURES_TO_SCORE) break;
          }
        }
        log.push({ url, status:r.status, count: before, kept: out.length, total });
        if (out.length >= MAX_FIXTURES_TO_SCORE) return out;
      } catch (e) {
        lastError = { url, message: e?.response?.data || e?.message || String(e), status: e?.response?.status || null };
        log.push({ url, error: lastError.message, status: lastError.status });
        // continue to next page/query/tz instead of breaking everything
        break;
      }
      page += 1;
      if (page > MAX_FIXTURE_PAGES) break;
      if (page <= total) await new Promise(r => setTimeout(r,120));
    } while (page <= total);
    return out;
  };

  const TZS = [API_TZ,'Europe/London','UTC'];
  for (const tz of TZS){ const a = await attempt(`date=${date}`, tz); if (a.length) return { fixtures:a, log, lastError }; }
  for (const tz of TZS){ const b = await attempt(`from=${date}&to=${date}`, tz); if (b.length) return { fixtures:b, log, lastError }; }
  return { fixtures:[], log, lastError };
}

// ---- team stats + poisson
const statsCache = new Map();
async function fetchTeamStatsRaw(leagueId, season, teamId){
  const key = `raw_${leagueId}_${season}_${teamId}`;
  if (statsCache.has(key)) return statsCache.get(key);
  try{
    const url = `https://v3.football.api-sports.io/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`;
    const r = await axios.get(url, AXIOS);
    const data = r.data?.response || null;
    statsCache.set(key, data);
    return data;
  }catch(e){ return null; }
}
function normalizeStats(resp){
  if (!resp) return null;
  const played=resp.fixtures?.played?.total||0;
  const gf=resp.goals?.for?.total?.total||0;
  const ga=resp.goals?.against?.total?.total||0;
  const avgGF = played? gf/played : 0;
  const avgGA = played? ga/played : 0;
  return { played, avgGF, avgGA };
}
async function getTeamStatsBlended(leagueId, season, teamId){
  const cur  = normalizeStats(await fetchTeamStatsRaw(leagueId, season,   teamId));
  if (cur?.played >= 6) return cur;
  const prev = normalizeStats(await fetchTeamStatsRaw(leagueId, season-1, teamId));
  if (!cur && prev) return prev;
  if (cur && prev){
    const wCur = Math.min(0.6, cur.played/8), wPrev=1-wCur;
    return { played: cur.played, avgGF: cur.avgGF*wCur + prev.avgGF*wPrev, avgGA: cur.avgGA*wCur + prev.avgGA*wPrev };
  }
  return cur || null;
}

function _logFact(n){ let s=0; for(let i=1;i<=n;i++) s+=Math.log(i); return s; }
function poissonP(lambda,k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }
function probTotalsAtLeast(lambdaH,lambdaA,minGoals=3,maxK=10){
  let p=0;
  for (let h=0;h<=maxK;h++){ const ph=poissonP(lambdaH,h);
    for (let a=0;a<=maxK;a++){ if (h+a>=minGoals) p += ph*poissonP(lambdaA,a); }
  }
  return Math.min(Math.max(p,0),1);
}

const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.60);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 20);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.50);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.40);

function estimateLambdas(h,a){
  const estH   = Math.max(((h.avgGF||0)+(a.avgGA||0))/2, 0.05);
  const estA   = Math.max(((a.avgGF||0)+(h.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS*PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS*(1-PRIOR_HOME_SHARE);
  const n      = Math.max(0,(h.played||0)+(a.played||0));
  const w      = n/(n+PRIOR_MATCHES);
  const lambdaHome = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w)+estH*w));
  const lambdaAway = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorA*(1-w)+estA*w));
  const expGoals   = lambdaHome + lambdaAway;
  return { lambdaHome, lambdaAway, expGoals };
}

function reasonText(f, exp){
  const home=f.teams?.home?.name||'Home', away=f.teams?.away?.name||'Away';
  return `${home} vs ${away}: projected ~${exp.toFixed(2)} goals from blended attack/defense.`;
}

module.exports = async (req,res)=>{
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date     = (req.query.date || todayYMD()).slice(0,10);
    const season   = seasonFromDate(date);
    const minConf  = Number(req.query.minConf || DEFAULT_MIN_CONF);
    const strict   = req.query.strict === '1';
    const debug    = req.query.debug  === '1';
    const nofilter = req.query.nofilter === '1';

    const { fixtures, log, lastError } = await fetchAllEuropeFixtures(date, { nofilter });
    const cut = fixtures.slice(0, MAX_FIXTURES_TO_SCORE);

    const scored = [];
    for (const f of cut){
      try{
        const L=f.league?.id, hT=f.teams?.home?.id, aT=f.teams?.away?.id;
        if (!L || !hT || !aT) continue;

        let h = await getTeamStatsBlended(L, season, hT);
        let a = await getTeamStatsBlended(L, season, aT);

        // fallback: if no stats at all for both teams, use priors as a weak estimate
        if (!h && !a) { h={played:0,avgGF:PRIOR_EXP_GOALS/2,avgGA:PRIOR_EXP_GOALS/2}; a={played:0,avgGF:PRIOR_EXP_GOALS/2,avgGA:PRIOR_EXP_GOALS/2}; }

        if (!h || !a) continue;

        const { lambdaHome, lambdaAway, expGoals } = estimateLambdas(h,a);
        const pOver = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
        const pUnder = 1 - pOver;
        const prediction = (pOver >= pUnder) ? 'Over 2.5' : 'Under 2.5';
        const confidence = Math.round(100 * Math.max(pOver, pUnder));

        scored.push({
          match: `${f.teams.home.name} vs ${f.teams.away.name}`,
          league: f.league?.name || '',
          kickoff: f.fixture?.date,
          market: 'Over/Under 2.5 Goals',
          prediction, confidence,
          meta: { pOver25: Math.round(100*pOver), expGoals: Number(expGoals.toFixed(2)) },
          reasoning: reasonText(f, expGoals)
        });
      }catch(_){ /* skip */ }
    }

    let pool = scored;
    if (strict) pool = scored.filter(x => x.confidence >= minConf);
    pool.sort((a,b)=> b.confidence - a.confidence);

    let picks = pool.slice(0,2);
    if (picks.length < 2 && scored.length){
      picks = scored.sort((a,b)=> b.confidence - a.confidence).slice(0,2);
    }

    // if still nothing but fixtures existed, create naive top-2 from fixtures
    if (picks.length === 0 && cut.length){
      const naive = cut.slice(0,12).map(f=>{
        const conf = 50; // totally neutral when stats unavailable
        return {
          match: `${f.teams.home.name} vs ${f.teams.away.name}`,
          league: f.league?.name||'',
          kickoff: f.fixture?.date,
          market: 'Over/Under 2.5 Goals',
          prediction: 'Over 2.5',
          confidence: conf,
          meta: { pOver25: conf, expGoals: PRIOR_EXP_GOALS },
          reasoning: 'Fallback: stats unavailable; neutral prior used.'
        };
      }).sort((a,b)=> b.confidence - a.confidence).slice(0,2);
      picks = naive;
    }

    const payload = {
      dateRequested: date, dateUsed: date,
      thresholds: { minConf, strict },
      meta: {
        rawFixtures: fixtures.length,
        fixturesScored: cut.length,
        candidates: scored.length,
        ...(debug ? { debugLog: log, lastError } : {})
      },
      picks,
      computedAt: new Date().toISOString()
    };
    res.json(payload);
  }catch(e){
    console.error('free-picks error:', e?.message || e);
    res.status(500).json({ error:'failed_to_load_picks', detail:e?.message || String(e) });
  }
};
