// api/pro-board.js
// Pro Board — EXACT coverage requested + grouped by competition.
// Markets per fixture: OU2.5, BTTS, 1X2, OU Cards, OU Corners.
// Notes:
// - International cups (FIFA WC, AFCON, Gold Cup, Asian Cup, UEFA Super Cup) are resolved dynamically.
// - Cards/Corners use last fixtures statistics with a global budget to avoid heavy API usage.

const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ  || 'Europe/Sofia';

if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY');

const AXIOS = {
  timeout: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
  headers: { 'x-apisports-key': API_KEY }
};

// ---------- Hard-coded league IDs (domestic) ----------
const L = {
  ENG: { EPL: 39, CHAMP: 40, FA_CUP: 45, EFL_CUP: 48 },
  GER: { BUN1: 78, BUN2: 79, DFB: 81 },
  ITA: { SA: 135, SB: 136, COPPA: 137 },
  ESP: { LL1: 140, LL2: 141, CDR: 139 },
  FRA: { L1: 61, L2: 62, CDF: 66 },
  UEFA: { UCL: 2, UEL: 3, UECL: 848 }
};

// Dynamic competitions we’ll resolve by name (ID changes are rare but safer this way)
const DYNAMIC_LEAGUE_NAMES = [
  'FIFA World Cup',
  'UEFA Super Cup',
  'Africa Cup of Nations',
  'CONCACAF Gold Cup',
  'AFC Asian Cup',
];

// Tuning / budgets
const MAX_FIXTURES = Number(process.env.PROBOARD_MAX_FIXTURES || 400);
const MAX_STATS_BUDGET = Number(process.env.PROBOARD_MAX_STATS_CALLS || 60); // calls to fixtures/statistics
const STATS_PER_TEAM_LAST = Number(process.env.PROBOARD_STATS_LAST_FIX || 3); // last fixtures to sample per team for cards/corners

const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.60);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 16);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.45);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.60);

const DEFAULT_LINES = {
  cards:  Number(process.env.CARDS_LINE   || 4.5),
  corners:Number(process.env.CORNERS_LINE || 9.5),
};

// ---------- Helpers ----------
function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){
  const d = new Date(dateStr);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return (m >= 7) ? y : y - 1;
}
function isYouthOrNonSenior(text){
  const s = (text || '').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function isFriendlies(league){
  const n = (league?.name || '').toLowerCase();
  return n.includes('friendlies');
}
function inScopeFixture(f){
  if (!f) return false;
  if (isYouthOrNonSenior(f.teams?.home?.name + ' ' + f.teams?.away?.name + ' ' + f.league?.name)) return false;
  if (isFriendlies(f.league)) return false;
  return true;
}
const pct = (x) => Math.max(1, Math.min(99, Math.round((Number(x)||0)*100)));
const toPctInt = (x) => Math.max(1, Math.min(99, Math.round(Number(x)||0)));

// ---------- Dynamic ID resolver ----------
const leagueIdCache = new Map(); // name -> id
async function resolveLeagueIdByName(name){
  if (leagueIdCache.has(name)) return leagueIdCache.get(name);
  // We try with current=true and without, then pick the one that has fixtures coverage
  const queries = [
    `https://v3.football.api-sports.io/leagues?name=${encodeURIComponent(name)}&current=true`,
    `https://v3.football.api-sports.io/leagues?name=${encodeURIComponent(name)}`,
  ];
  for (const url of queries) {
    try {
      const r = await axios.get(url, AXIOS);
      const arr = r.data?.response || [];
      const found = arr.find(x => (x?.league?.name||'').toLowerCase() === name.toLowerCase());
      const id = found?.league?.id || null;
      if (id) {
        leagueIdCache.set(name, id);
        return id;
      }
    } catch (_) {}
  }
  return null;
}

async function buildLeagueSetWithDynamics(){
  const dynIds = {};
  for (const name of DYNAMIC_LEAGUE_NAMES) {
    dynIds[name] = await resolveLeagueIdByName(name);
  }
  // build the final set
  const ids = [
    // ENG
    L.ENG.EPL, L.ENG.CHAMP, L.ENG.FA_CUP, L.ENG.EFL_CUP,
    // GER
    L.GER.BUN1, L.GER.BUN2, L.GER.DFB,
    // ITA
    L.ITA.SA, L.ITA.SB, L.ITA.COPPA,
    // ESP
    L.ESP.LL1, L.ESP.LL2, L.ESP.CDR,
    // FRA
    L.FRA.L1, L.FRA.L2, L.FRA.CDF,
    // UEFA (fixed)
    L.UEFA.UCL, L.UEFA.UEL, L.UEFA.UECL,
  ];
  // add dynamic ones if resolved
  Object.values(dynIds).forEach(v => { if (v) ids.push(v); });
  // de-dup + truthy
  return [...new Set(ids.filter(Boolean))];
}

// ---------- Fetch fixtures ----------
async function fetchFixturesForLeagues(date, season, leagueIds, debug){
  const TZS = [API_TZ, 'Europe/London', 'UTC'];
  const out = [];
  for (const lid of leagueIds) {
    for (const tz of TZS) {
      const url = `https://v3.football.api-sports.io/fixtures?league=${lid}&season=${season}&date=${date}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const arr = (r.data?.response || []).filter(inScopeFixture);
        out.push(...arr);
        debug && debug.push({ stage: 'fixtures', leagueId: lid, tz, count: arr.length, status: r.status });
      } catch (e) {
        debug && debug.push({ stage: 'fixtures', leagueId: lid, tz, err: e?.message, status: e?.response?.status || 0 });
      }
      if (out.length >= MAX_FIXTURES) break;
    }
    if (out.length >= MAX_FIXTURES) break;
  }
  // unique by fixture id
  const seen = new Set();
  return out.filter(f => {
    const id = f.fixture?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, MAX_FIXTURES);
}

// ---------- Team form (goals) ----------
const teamLastCache = new Map(); // teamId|N -> fixtures[]
async function getTeamLast(teamId, n){
  const key = `${teamId}|${n}`;
  if (teamLastCache.has(key)) return teamLastCache.get(key);
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=${n}`;
  try {
    const r = await axios.get(url, AXIOS);
    const arr = (r.data?.response || []).filter(inScopeFixture);
    teamLastCache.set(key, arr);
    return arr;
  } catch {
    teamLastCache.set(key, []);
    return [];
  }
}
function formFromFixtures(list, teamId){
  let g=0, gf=0, ga=0, o25=0;
  for (const fx of list) {
    const hs = fx.score?.fulltime?.home ?? fx.goals?.home ?? null;
    const as = fx.score?.fulltime?.away ?? fx.goals?.away ?? null;
    if (typeof hs !== 'number' || typeof as !== 'number') continue;
    if ((fx.fixture?.status?.short || '').toUpperCase() !== 'FT') continue;
    g += 1;
    const isHome = fx.teams?.home?.id === teamId;
    gf += isHome ? hs : as;
    ga += isHome ? as : hs;
    if (hs + as >= 3) o25 += 1;
  }
  return { games:g, avgGF: g? gf/g : 0, avgGA: g? ga/g : 0, ou25: g? o25/g : 0 };
}

// ---------- Poisson model (goals) ----------
function _logFact(n){ let s=0; for (let i=1;i<=n;i++) s+=Math.log(i); return s; }
function pois(lambda, k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }
function probTotalsAtLeast(lambdaH, lambdaA, min=3, maxK=10){
  let p=0;
  for (let h=0; h<=maxK; h++){
    const ph = pois(lambdaH, h);
    for (let a=0; a<=maxK; a++){
      if (h+a >= min) p += ph * pois(lambdaA, a);
    }
  }
  return Math.min(Math.max(p,0),1);
}
function oneX2Probs(lambdaH, lambdaA, maxK=10){
  let pH=0, pD=0, pA=0;
  for (let h=0; h<=maxK; h++){
    const ph = pois(lambdaH, h);
    for (let a=0; a<=maxK; a++){
      const p = ph * pois(lambdaA, a);
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
    }
  }
  const sum = pH+pD+pA || 1;
  return { home:pH/sum, draw:pD/sum, away:pA/sum };
}
function estimateLambdas(hForm, aForm){
  const estH = Math.max(((hForm.avgGF||0)+(aForm.avgGA||0))/2, 0.05);
  const estA = Math.max(((aForm.avgGF||0)+(hForm.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS * PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS * (1 - PRIOR_HOME_SHARE);
  const n = Math.max(0, (hForm.games||0) + (aForm.games||0));
  const w = n / (n + PRIOR_MATCHES);
  const lH = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w) + estH*w));
  const lA = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w) ? priorA : priorA*(1-w) + estA*w)); // keep same prior logic
  const expGoals = lH + lA;
  return { lambdaHome:lH, lambdaAway:lA, expGoals };
}

// ---------- Cards/Corners estimation from last fixtures statistics ----------
const teamDisciplineCache = new Map(); // teamId -> { avgCardsTotal, avgCornersTotal, samples }
let statsBudgetUsed = 0;

async function getTeamDisciplineAgg(teamId, lastN = STATS_PER_TEAM_LAST){
  if (teamDisciplineCache.has(teamId)) return teamDisciplineCache.get(teamId);
  const out = { avgCardsTotal:null, avgCornersTotal:null, samples:0 };
  try {
    const r = await axios.get(`https://v3.football.api-sports.io/fixtures?team=${teamId}&last=${lastN}`, AXIOS);
    const list = r.data?.response || [];
    let cardsTot=0, cornersTot=0, samples=0;

    for (const fx of list) {
      const fid = fx?.fixture?.id;
      if (!fid) continue;
      if (statsBudgetUsed >= MAX_STATS_BUDGET) break;
      try {
        const stats = await axios.get(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fid}`, AXIOS);
        statsBudgetUsed += 1;
        const arr = stats.data?.response || [];
        if (arr.length >= 2) {
          const get = (obj, type) => {
            const v = (obj?.statistics||[]).find(x => (x?.type||'').toLowerCase() === type);
            return typeof v?.value === 'number' ? v.value : 0;
          };
          const home = arr[0];
          const away = arr[1];
          const cCards = get(home, 'yellow cards') + get(away, 'yellow cards'); // yellows only (most books use points, but we approximate)
          const cCorners = get(home, 'corners') + get(away, 'corners');
          if (cCards + cCorners > 0) {
            cardsTot += cCards;
            cornersTot += cCorners;
            samples += 1;
          }
        }
      } catch (_) {/* ignore single-stat errors */}
    }

    if (samples > 0) {
      out.avgCardsTotal = cardsTot / samples;
      out.avgCornersTotal = cornersTot / samples;
      out.samples = samples;
    }
  } catch (_) {/* ignore */ }

  teamDisciplineCache.set(teamId, out);
  return out;
}

// Poisson tail for integer threshold L.5
function poissonOverUnder(lambda, lineHalf){
  const k = Math.floor(lineHalf); // 9.5 -> 9
  // P(> k) = 1 - P(<= k)
  let cdf = 0;
  for (let i=0;i<=k;i++) cdf += pois(lambda, i);
  const pOver = Math.max(0, Math.min(1, 1 - cdf));
  const pUnder = 1 - pOver;
  return { over: pOver, under: pUnder };
}

function mkReasonGoals(f, exp, hForm, aForm){
  const h = f.teams?.home?.name, a = f.teams?.away?.name;
  return `${h} vs ${a}: expected ${exp.toFixed(2)} goals from last-10 pace (H avgGF ${hForm.avgGF.toFixed(2)}, A avgGF ${aForm.avgGF.toFixed(2)}; defenses H ${hForm.avgGA.toFixed(2)}, A ${aForm.avgGA.toFixed(2)}).`;
}
function mkReasonBTTS(lH,lA){
  return `BTTS driven by attack rates (λH ${lH.toFixed(2)}, λA ${lA.toFixed(2)}); independence Poisson model.`;
}
function mkReason1X2(lH,lA){
  return `1X2 from Poisson goal model (λH ${lH.toFixed(2)} vs λA ${lA.toFixed(2)}).`;
}
function mkReasonTotals(label, lam, line, samples){
  const s = samples ? ` from ~${samples} recent games stats` : ` (limited stats)`;
  return `${label} using Poisson total λ≈${lam.toFixed(2)} vs line ${line}${s}.`;
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  try {
    const date    = (req.query.date || todayYMD()).slice(0,10);
    const season  = seasonFromDate(date);
    const debugOn = req.query.debug === '1';

    const lines = {
      cards:  Number(req.query.cardsLine   || DEFAULT_LINES.cards),
      corners:Number(req.query.cornersLine || DEFAULT_LINES.corners),
    };

    const debug = [];
    const leagueIds = await buildLeagueSetWithDynamics();
    debugOn && debug.push({ stage:'league-set', count: leagueIds.length, leagueIds });

    // Fetch fixtures
    let fixtures = await fetchFixturesForLeagues(date, season, leagueIds, debugOn ? debug : null);

    // Compute predictions
    const outByLeague = new Map(); // leagueId -> { leagueId, league, country, fixtures: [] }

    for (const f of fixtures) {
      try {
        const fid = f.fixture?.id;
        const lid = f.league?.id;
        const leagueName = f.league?.name;
        const country = f.league?.country;
        const hId = f.teams?.home?.id;
        const aId = f.teams?.away?.id;
        if (!fid || !hId || !aId) continue;

        // Forms & lambdas from last10
        const [h10, a10] = await Promise.all([ getTeamLast(hId,10), getTeamLast(aId,10) ]);
        const hForm = formFromFixtures(h10, hId);
        const aForm = formFromFixtures(a10, aId);
        const { lambdaHome:lH, lambdaAway:lA, expGoals } = estimateLambdas(hForm, aForm);

        // --- OU 2.5 Goals
        const pOver25  = probTotalsAtLeast(lH, lA, 3);
        const pUnder25 = 1 - pOver25;
        const ou25 = {
          label: 'Over/Under 2.5 Goals',
          over:  toPctInt(100*pOver25),
          under: toPctInt(100*pUnder25),
          bestPick: (pOver25 >= pUnder25) ? { pick: 'Over 2.5', confidence: toPctInt(100*pOver25) }
                                          : { pick: 'Under 2.5', confidence: toPctInt(100*pUnder25) },
          reason: mkReasonGoals(f, expGoals, hForm, aForm),
        };

        // --- BTTS
        const pBTTSyes = 1 - Math.exp(-lH) - Math.exp(-lA) + Math.exp(-(lH+lA));
        const pBTTSno  = 1 - pBTTSyes;
        const btts = {
          label: 'Both Teams To Score',
          yes: toPctInt(100*pBTTSyes),
          no:  toPctInt(100*pBTTSno),
          bestPick: (pBTTSyes >= pBTTSno) ? { pick:'BTTS: Yes', confidence: toPctInt(100*pBTTSyes) }
                                          : { pick:'BTTS: No',  confidence: toPctInt(100*pBTTSno) },
          reason: mkReasonBTTS(lH,lA),
        };

        // --- 1X2
        const px = oneX2Probs(lH,lA);
        const oneX2 = {
          label: '1X2',
          home: toPctInt(100*px.home),
          draw: toPctInt(100*px.draw),
          away: toPctInt(100*px.away),
          bestPick: (() => {
            const arr = [
              { k:'Home', v:px.home },
              { k:'Draw', v:px.draw },
              { k:'Away', v:px.away },
            ].sort((a,b)=> b.v-a.v)[0];
            return { pick: arr.k, confidence: toPctInt(100*arr.v) };
          })(),
          reason: mkReason1X2(lH,lA),
        };

        // --- Cards/Corners via last stats (with budget)
        const [hDisc, aDisc] = await Promise.all([
          getTeamDisciplineAgg(hId), getTeamDisciplineAgg(aId)
        ]);
        const lamCards   = (hDisc.avgCardsTotal && aDisc.avgCardsTotal) ? (hDisc.avgCardsTotal + aDisc.avgCardsTotal)/2
                          : (hDisc.avgCardsTotal || aDisc.avgCardsTotal || null);
        const lamCorners = (hDisc.avgCornersTotal && aDisc.avgCornersTotal) ? (hDisc.avgCornersTotal + aDisc.avgCornersTotal)/2
                          : (hDisc.avgCornersTotal || aDisc.avgCornersTotal || null);

        const cards = (lamCards != null) ? (() => {
          const p = poissonOverUnder(lamCards, lines.cards);
          return {
            label: `Over/Under Cards (${lines.cards})`,
            over: toPctInt(100*p.over), under: toPctInt(100*p.under),
            bestPick: (p.over >= p.under) ? { pick:`Over ${lines.cards}`, confidence: toPctInt(100*p.over) }
                                          : { pick:`Under ${lines.cards}`, confidence: toPctInt(100*p.under) },
            reason: mkReasonTotals('Cards', lamCards, lines.cards, (hDisc.samples||0)+(aDisc.samples||0))
          };
        })() : {
          label: `Over/Under Cards (${lines.cards})`,
          over: null, under: null, bestPick: null,
          reason: 'Insufficient recent cards stats.'
        };

        const corners = (lamCorners != null) ? (() => {
          const p = poissonOverUnder(lamCorners, lines.corners);
          return {
            label: `Over/Under Corners (${lines.corners})`,
            over: toPctInt(100*p.over), under: toPctInt(100*p.under),
            bestPick: (p.over >= p.under) ? { pick:`Over ${lines.corners}`, confidence: toPctInt(100*p.over) }
                                          : { pick:`Under ${lines.corners}`, confidence: toPctInt(100*p.under) },
            reason: mkReasonTotals('Corners', lamCorners, lines.corners, (hDisc.samples||0)+(aDisc.samples||0))
          };
        })() : {
          label: `Over/Under Corners (${lines.corners})`,
          over: null, under: null, bestPick: null,
          reason: 'Insufficient recent corners stats.'
        };

        // Bundle markets + best-of-each pair
        const markets = {
          ou25, btts, oneX2, cards, corners,
          best: [
            { market:'OU 2.5', ...ou25.bestPick },
            { market:'BTTS',   ...btts.bestPick },
            { market:'1X2',    ...oneX2.bestPick },
            { market:'Cards',  ...cards.bestPick },
            { market:'Corners',...corners.bestPick },
          ]
        };

        // Group by league
        if (!outByLeague.has(lid)) {
          outByLeague.set(lid, { leagueId: lid, league: leagueName, country, fixtures: [] });
        }
        outByLeague.get(lid).fixtures.push({
          fixtureId: fid,
          kickoff: f.fixture?.date,
          status: f.fixture?.status?.short,
          home: { id: hId, name: f.teams?.home?.name },
          away: { id: aId, name: f.teams?.away?.name },
          models: { lambdaHome: Number(lH.toFixed(3)), lambdaAway: Number(lA.toFixed(3)), expGoals: Number(expGoals.toFixed(2)) },
          markets
        });

      } catch (e) {
        debugOn && debug.push({ stage:'score', err: e?.message });
      }
      if (statsBudgetUsed >= MAX_STATS_BUDGET) {
        debugOn && debug.push({ stage:'budget', msg:'stats budget exhausted', used: statsBudgetUsed });
      }
    }

    // Sort fixtures inside each league by kickoff
    const groups = [...outByLeague.values()].map(g => ({
      ...g,
      fixtures: g.fixtures.sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff))
    })).sort((a,b) => (a.country||'').localeCompare(b.country||'') || (a.league||'').localeCompare(b.league||''));

    res.json({
      dateRequested: date,
      season,
      lines,
      limits: { MAX_FIXTURES, MAX_STATS_BUDGET, STATS_PER_TEAM_LAST },
      counts: { leagues: groups.length, fixtures: groups.reduce((s,g)=>s+g.fixtures.length,0) },
      data: groups,
      ...(debugOn ? { debug: {
        leagueIds,
        statsBudgetUsed,
        log: debug
      }} : {})
    });
  } catch (e) {
    console.error('pro-board error:', e?.message || e);
    res.status(500).json({ error: 'failed_to_build_pro_board', detail: e?.message || String(e) });
  }
};
