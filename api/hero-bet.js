// api/hero-bet.js
// Hero Bet — pick ONE value-style selection for today from the same league scope.
// Chooses the strongest-confidence pick across these markets per fixture:
//   - OU 2.5, BTTS, 1X2, OU Cards, OU Corners
// NOTE: Odds from bookmakers are not used here; we output a model-implied odds estimate (= 100/conf%).
// Query params: date=YYYY-MM-DD, minConf=65, cardsLine=4.5, cornersLine=9.5, debug=1

const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ  || 'Europe/Sofia';
if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY');

const AXIOS = { timeout: 12000, headers: { 'x-apisports-key': API_KEY } };

// --- League IDs (exact scope you asked)
const L = {
  ENG: { EPL: 39, CHAMP: 40, FA_CUP: 45, EFL_CUP: 48 },
  GER: { BUN1: 78, BUN2: 79, DFB: 81 },
  ITA: { SA: 135, SB: 136, COPPA: 137 },
  ESP: { LL1: 140, LL2: 141, CDR: 139 },
  FRA: { L1: 61, L2: 62, CDF: 66 },
  UEFA: { UCL: 2, UEL: 3, UECL: 848 }
};
const DYNAMIC_LEAGUE_NAMES = [
  'FIFA World Cup',
  'UEFA Super Cup',
  'Africa Cup of Nations',
  'CONCACAF Gold Cup',
  'AFC Asian Cup',
];

const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.60);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 16);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.45);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.60);

const DEFAULT_LINES = {
  cards:  Number(process.env.CARDS_LINE   || 4.5),
  corners:Number(process.env.CORNERS_LINE || 9.5),
};

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
const pctInt = (x) => Math.max(1, Math.min(99, Math.round(Number(x)||0)));
const pct = (x) => Math.max(0.01, Math.min(0.99, (Number(x)||0)));

const leagueIdCache = new Map();
async function resolveLeagueIdByName(name){
  if (leagueIdCache.has(name)) return leagueIdCache.get(name);
  const qs = [
    `https://v3.football.api-sports.io/leagues?name=${encodeURIComponent(name)}&current=true`,
    `https://v3.football.api-sports.io/leagues?name=${encodeURIComponent(name)}`
  ];
  for (const url of qs) {
    try {
      const r = await axios.get(url, AXIOS);
      const arr = r.data?.response || [];
      const found = arr.find(x => (x?.league?.name||'').toLowerCase() === name.toLowerCase());
      const id = found?.league?.id || null;
      if (id) { leagueIdCache.set(name, id); return id; }
    } catch {}
  }
  return null;
}
async function buildLeagueSet(){
  const ids = [
    L.ENG.EPL, L.ENG.CHAMP, L.ENG.FA_CUP, L.ENG.EFL_CUP,
    L.GER.BUN1, L.GER.BUN2, L.GER.DFB,
    L.ITA.SA, L.ITA.SB, L.ITA.COPPA,
    L.ESP.LL1, L.ESP.LL2, L.ESP.CDR,
    L.FRA.L1, L.FRA.L2, L.FRA.CDF,
    L.UEFA.UCL, L.UEFA.UEL, L.UEFA.UECL,
  ];
  for (const name of DYNAMIC_LEAGUE_NAMES) {
    const id = await resolveLeagueIdByName(name);
    if (id) ids.push(id);
  }
  return [...new Set(ids.filter(Boolean))];
}
async function fetchFixtures(date, season, leagueIds){
  const TZS = [API_TZ, 'Europe/London', 'UTC'];
  const out = [];
  for (const lid of leagueIds) {
    for (const tz of TZS) {
      const url = `https://v3.football.api-sports.io/fixtures?league=${lid}&season=${season}&date=${date}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        out.push(...(r.data?.response || []).filter(inScopeFixture));
      } catch {}
    }
  }
  const seen = new Set();
  return out.filter(f => {
    const id = f.fixture?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// team last / form
const teamLastCache = new Map(); // teamId|N -> fixtures[]
async function getTeamLast(teamId, n=10){
  const key = `${teamId}|${n}`;
  if (teamLastCache.has(key)) return teamLastCache.get(key);
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=${n}`;
  try {
    const r = await axios.get(url, AXIOS);
    const arr = (r.data?.response || []).filter(inScopeFixture);
    teamLastCache.set(key, arr); return arr;
  } catch { teamLastCache.set(key, []); return []; }
}
function formFromFixtures(list, teamId){
  let g=0, gf=0, ga=0, o25=0;
  for (const fx of list) {
    const hs = fx.score?.fulltime?.home ?? fx.goals?.home;
    const as = fx.score?.fulltime?.away ?? fx.goals?.away;
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
// poisson
function _logFact(n){ let s=0; for (let i=1;i<=n;i++) s+=Math.log(i); return s; }
function pois(l, k){ return Math.exp(-l + k*Math.log(l) - _logFact(k)); }
function probTotalsAtLeast(lH, lA, min=3, maxK=10){
  let p=0;
  for (let h=0; h<=maxK; h++){
    const ph = pois(lH, h);
    for (let a=0; a<=maxK; a++){
      if (h+a >= min) p += ph * pois(lA, a);
    }
  }
  return Math.min(Math.max(p,0),1);
}
function oneX2(lH,lA,maxK=10){
  let pH=0,pD=0,pA=0;
  for (let h=0; h<=maxK; h++){
    const ph = pois(lH,h);
    for (let a=0; a<=maxK; a++){
      const p = ph*pois(lA,a);
      if (h>a) pH+=p; else if (h===a) pD+=p; else pA+=p;
    }
  }
  const s = pH+pD+pA || 1;
  return { home:pH/s, draw:pD/s, away:pA/s };
}
function estimateLambdas(hForm, aForm){
  const estH = Math.max(((hForm.avgGF||0)+(aForm.avgGA||0))/2, 0.05);
  const estA = Math.max(((aForm.avgGF||0)+(hForm.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS * PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS * (1 - PRIOR_HOME_SHARE);
  const n = Math.max(0, (hForm.games||0)+(aForm.games||0));
  const w = n / (n + PRIOR_MATCHES);
  const lH = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w) + estH*w));
  const lA = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorA*(1-w) + estA*w));
  return { lH, lA, exp: lH+lA };
}
function mkReasonGoals(f, exp, hForm, aForm){
  const h=f.teams?.home?.name, a=f.teams?.away?.name;
  return `${h} vs ${a}: expected ${exp.toFixed(2)} goals from last-10 pace (H avgGF ${hForm.avgGF.toFixed(2)}, A avgGF ${aForm.avgGF.toFixed(2)}; defenses H ${aForm.avgGA.toFixed(2)}, A ${hForm.avgGA.toFixed(2)}).`;
}

module.exports = async (req, res) => {
  try {
    const date    = (req.query.date || todayYMD()).slice(0,10);
    const season  = seasonFromDate(date);
    const minConf = Number(req.query.minConf || 65);
    const lines = {
      cards:   Number(req.query.cardsLine   || DEFAULT_LINES.cards),
      corners: Number(req.query.cornersLine || DEFAULT_LINES.corners),
    };
    const leagueIds = await buildLeagueSet();
    const fixtures  = await fetchFixtures(date, season, leagueIds);

    let best = null;

    for (const f of fixtures) {
      try {
        const hId = f.teams?.home?.id, aId = f.teams?.away?.id;
        if (!hId || !aId) continue;

        const [h10,a10] = await Promise.all([ getTeamLast(hId,10), getTeamLast(aId,10) ]);
        const hForm = formFromFixtures(h10, hId);
        const aForm = formFromFixtures(a10, aId);
        if ((hForm.games + aForm.games) < 6) continue;

        const { lH, lA, exp } = estimateLambdas(hForm, aForm);

        // Markets
        const pOver25  = probTotalsAtLeast(lH,lA,3);
        const pUnder25 = 1 - pOver25;
        const ou = (pOver25 >= pUnder25)
          ? { market:'OU 2.5', pick:'Over 2.5', conf: pctInt(100*pOver25), prob:pct(pOver25), reason: mkReasonGoals(f,exp,hForm,aForm) }
          : { market:'OU 2.5', pick:'Under 2.5', conf: pctInt(100*pUnder25), prob:pct(pUnder25), reason: mkReasonGoals(f,exp,hForm,aForm) };

        const bttsYes = 1 - Math.exp(-lH) - Math.exp(-lA) + Math.exp(-(lH+lA));
        const bttsNo  = 1 - bttsYes;
        const btts = (bttsYes >= bttsNo)
          ? { market:'BTTS', pick:'Yes', conf: pctInt(100*bttsYes), prob:pct(bttsYes), reason:`BTTS from λH ${lH.toFixed(2)}, λA ${lA.toFixed(2)}` }
          : { market:'BTTS', pick:'No',  conf: pctInt(100*bttsNo),  prob:pct(bttsNo),  reason:`BTTS from λH ${lH.toFixed(2)}, λA ${lA.toFixed(2)}` };

        const p1x2 = oneX2(lH,lA);
        const arr1x2 = [
          { k:'Home', v:p1x2.home }, { k:'Draw', v:p1x2.draw }, { k:'Away', v:p1x2.away }
        ].sort((a,b)=> b.v-a.v)[0];
        const oneX2Pick = { market:'1X2', pick:arr1x2.k, conf:pctInt(100*arr1x2.v), prob:pct(arr1x2.v), reason:`1X2 from Poisson (λH ${lH.toFixed(2)} vs λA ${lA.toFixed(2)})` };

        // Cards/Corners — modelled as totals using last-10 goal lambdas as proxy (simpler, light)
        // If you want stats-driven cards/corners (heavier), wire in fixtures/statistics calls like pro-board.
        const lamCards   = 4.8;  // light prior; tune later with stats enrichment
        const lamCorners = 10.2; // light prior
        function tailOverUnder(lambda, lineHalf){
          const k = Math.floor(lineHalf);
          let cdf=0; for (let i=0;i<=k;i++) cdf += pois(lambda, i);
          const over = Math.max(0, Math.min(1, 1-cdf));
          return { over, under: 1-over };
        }
        const tCards = tailOverUnder(lamCards,   lines.cards);
        const tCorns = tailOverUnder(lamCorners, lines.corners);
        const cards = (tCards.over >= tCards.under)
          ? { market:`Cards ${lines.cards}`, pick:`Over ${lines.cards}`, conf:pctInt(100*tCards.over), prob:pct(tCards.over), reason:`Cards λ≈${lamCards.toFixed(2)} vs ${lines.cards}` }
          : { market:`Cards ${lines.cards}`, pick:`Under ${lines.cards}`, conf:pctInt(100*tCards.under), prob:pct(tCards.under), reason:`Cards λ≈${lamCards.toFixed(2)} vs ${lines.cards}` };
        const corners = (tCorns.over >= tCorns.under)
          ? { market:`Corners ${lines.corners}`, pick:`Over ${lines.corners}`, conf:pctInt(100*tCorns.over), prob:pct(tCorns.over), reason:`Corners λ≈${lamCorners.toFixed(2)} vs ${lines.corners}` }
          : { market:`Corners ${lines.corners}`, pick:`Under ${lines.corners}`, conf:pctInt(100*tCorns.under), prob:pct(tCorns.under), reason:`Corners λ≈${lamCorners.toFixed(2)} vs ${lines.corners}` };

        const candidates = [ou, btts, oneX2Pick, cards, corners]
          .filter(x => x && x.conf >= minConf);

        if (candidates.length) {
          // choose highest confidence; tie-break by earliest kickoff
          const top = candidates.sort((a,b)=> b.conf - a.conf)[0];
          const hero = {
            date,
            leagueId: f.league?.id, league: f.league?.name, country: f.league?.country,
            fixtureId: f.fixture?.id,
            kickoff: f.fixture?.date,
            home: f.teams?.home?.name, away: f.teams?.away?.name,
            market: top.market, pick: top.pick, confidence: top.conf,
            modelOddsEstimate: Number((100 / top.conf).toFixed(2)), // NOT bookmaker odds
            reasoning: top.reason
          };
          // keep the best across all fixtures
          if (!best || hero.confidence > best.confidence || 
             (hero.confidence === best.confidence && new Date(hero.kickoff) < new Date(best.kickoff))) {
            best = hero;
          }
        }
      } catch {}
    }

    if (!best) return res.status(200).json({ date, hero: null, message: 'No eligible hero pick at current thresholds.' });
    res.json({ date, lines, hero: best });

  } catch (e) {
    console.error('hero-bet error:', e?.message || e);
    res.status(500).json({ error: 'failed_to_build_hero', detail: e?.message || String(e) });
  }
};
