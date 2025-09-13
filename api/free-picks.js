import axios from 'axios';

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ || 'Europe/London';
const REQ_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const PAGE_CAP    = Number(process.env.MAX_FIXTURE_PAGES  || 3);
const MAX_SCORE   = Number(process.env.MAX_FIXTURES_TO_SCORE || 220);
const MIN_CONF    = Number(process.env.FREEPICKS_MIN_CONF || 65);

const AX = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  timeout: REQ_TIMEOUT,
  headers: { 'x-apisports-key': API_KEY }
});

const EURO = new Set([
  'England','Spain','Italy','Germany','France','Scotland','Wales','Northern Ireland','Ireland',
  'Norway','Sweden','Denmark','Finland','Iceland','Estonia','Latvia','Lithuania',
  'Netherlands','Belgium','Luxembourg','Austria','Switzerland','Liechtenstein',
  'Croatia','Serbia','Bosnia and Herzegovina','Slovenia','North Macedonia','Montenegro','Albania','Kosovo',
  'Bulgaria','Romania','Hungary','Czech Republic','Slovakia','Poland',
  'Portugal','Greece','Turkey','Cyprus','Malta','Ukraine','Belarus','Moldova','Georgia',
  'Armenia','Azerbaijan','Andorra','San Marino','Gibraltar','Faroe Islands','Europe'
]);
const UEFA_IDS = new Set([2,3,848,4,15,16]); // UCL, UEL, UECL, Super Cup, Euros, Euro Qual

const today = () => new Date().toISOString().slice(0,10);
const seasonFrom = d => { const x=new Date(d), y=x.getUTCFullYear(), m=x.getUTCMonth()+1; return m>=7?y:y-1; };

function isSeniorMenText(s){
  s=(s||'').toLowerCase();
  return !/\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function inEuropeSeniorScope(f){
  const L=f?.league||{};
  const t=String(L.type||'').toLowerCase(); // league|cup|super cup
  const names=[f?.teams?.home?.name,f?.teams?.away?.name,L.name].filter(Boolean).join(' ');
  return isSeniorMenText(names) && (EURO.has(L.country)||UEFA_IDS.has(L.id)) && (t==='league'||t==='cup'||t==='super cup');
}

async function fetchFixtures(date){
  const tzs=[API_TZ,'Europe/London','UTC'];
  for (const tz of tzs){
    const out=[]; let p=1, tot=1;
    do {
      const url=`/fixtures?date=${encodeURIComponent(date)}&page=${p}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r=await AX.get(url); const resp=r.data||{};
        tot=resp?.paging?.total||1; const arr=resp?.response||[];
        for (const f of arr){ if(inEuropeSeniorScope(f)){ out.push(f); if(out.length>=MAX_SCORE) return out; } }
      } catch { break; }
      p++; if(p>PAGE_CAP) break;
      if(p<=tot) await new Promise(r=>setTimeout(r,120));
    } while (p<=tot);
    if (out.length) return out;
  }
  return [];
}

// basic stats/model
const PRIOR_G= Number(process.env.PRIOR_EXP_GOALS  || 2.6);
const HOME_SH= Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_N= Number(process.env.PRIOR_MATCHES    || 20);
const LMIN=Number(process.env.LAMBDA_MIN||0.5), LMAX=Number(process.env.LAMBDA_MAX||2.2);

async function teamStats(leagueId,season,teamId){
  try{ const r=await AX.get(`/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`); return r.data?.response||null; }catch{ return null; }
}
function normStats(s){
  if(!s) return null;
  const played=s?.fixtures?.played?.total||0;
  const gf=s?.goals?.for?.total?.total||0, ga=s?.goals?.against?.total?.total||0;
  const avgGF=played?gf/played:0, avgGA=played?ga/played:0;
  const explicit=s?.goals?.for?.over_2_5?.total;
  const pace=avgGF+avgGA, estO25=Math.min(95,Math.max(0,Math.round(pace*10)));
  const o25= (typeof explicit==='number' && explicit>=0) ? explicit : estO25;
  return {played,avgGF,avgGA,o25};
}
function lambdas(h,a){
  const estH=Math.max(((h.avgGF||0)+(a.avgGA||0))/2,0.05);
  const estA=Math.max(((a.avgGF||0)+(h.avgGA||0))/2,0.05);
  const priorH=PRIOR_G*HOME_SH, priorA=PRIOR_G*(1-HOME_SH);
  const n=Math.max(0,(h.played||0)+(a.played||0)), w=n/(n+PRIOR_N);
  const lH=Math.min(LMAX,Math.max(LMIN,priorH*(1-w)+estH*w));
  const lA=Math.min(LMAX,Math.max(LMIN,priorA*(1-w)+estA*w));
  return {lH,lA,exp:lH+lA};
}
function pct(x){ return Math.max(1,Math.min(99,Math.round(Number(x)||0))); }
function scoreOU(h,a){
  const pace=((h.avgGF+h.avgGA)+(a.avgGF+a.avgGA))/2;
  const hist=(h.o25+a.o25)/2;
  const over = 50 + (hist-50)*0.5 + (pace-PRIOR_G)*20;
  const under= 50 + (50-hist)*0.5 + (PRIOR_G-pace)*22;
  return {over:pct(over), under:pct(under)};
}
function reason(f,m,side){
  const H=f.teams?.home?.name||'Home', A=f.teams?.away?.name||'Away';
  if(/under/i.test(side)){
    return `${H} and ${A} project fewer big chances with compact phases and slower tempo. Set-piece variance is modest; chance creation should be limited. Projection ~${m.exp.toFixed(2)} total goals.`;
  }
  return `${H} and ${A} profile for open transitions and stretched shapes, creating finishing volume as play opens up. Projection ~${m.exp.toFixed(2)} total goals.`;
}

export default async function handler(req,res){
  try{
    if(!API_KEY) return res.status(500).json({error:'missing_api_key'});
    const date=(req.query.date||today()).slice(0,10);
    const season=seasonFrom(date);
    const minConf=Number(req.query.minConf||MIN_CONF);

    const fixtures = await fetchFixtures(date);
    const cand=[];
    for (const f of fixtures){
      try{
        const L=f.league?.id, h=f.teams?.home?.id, a=f.teams?.away?.id;
        if(!L||!h||!a) continue;
        const [hs,as]=await Promise.all([teamStats(L,season,h), teamStats(L,season,a)]);
        const H=normStats(hs), A=normStats(as); if(!H||!A) continue;
        const m=lambdas(H,A);
        const sc=scoreOU(H,A);
        const side = sc.over>=sc.under ? 'Over 2.5' : 'Under 2.5';
        const conf = sc.over>=sc.under ? sc.over : sc.under;
        if(conf<minConf) continue;
        cand.push({f, m, side, conf});
      }catch{}
    }
    cand.sort((x,y)=>y.conf-x.conf);
    const picks=cand.slice(0,2).map(x=>({
      match: `${x.f.teams.home.name} vs ${x.f.teams.away.name}`,
      league: x.f.league.name,
      kickoff: x.f.fixture?.date,
      market: 'Over/Under 2.5 Goals',
      prediction: x.side,
      odds:'—',
      confidence:x.conf,
      reasoning: reason(x.f,x.m,x.side)
    }));
    res.json({dateRequested:date,dateUsed:date,thresholds:{minConf},meta:{poolSize:fixtures.length,candidates:cand.length},picks,computedAt:new Date().toISOString()});
  }catch(e){
    res.status(500).json({error:'free_picks_failed', detail:e?.message||String(e)});
  }
}
