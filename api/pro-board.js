import axios from 'axios';
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_TZ  = process.env.API_FOOTBALL_TZ || 'Europe/London';
const REQ_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const PAGE_CAP    = Number(process.env.MAX_FIXTURE_PAGES  || 3);
const MAX_SCORE   = Number(process.env.MAX_FIXTURES_TO_SCORE || 220);
const PRO_MAX_ROWS= Number(process.env.PRO_MAX_ROWS || 200);

const AX=axios.create({baseURL:'https://v3.football.api-sports.io',timeout:REQ_TIMEOUT,headers:{'x-apisports-key':API_KEY}});

const TOP_LEAGUE_IDS = new Set([39,140,135,78,61,2,3,848]); // EPL, LaLiga, SerieA, Bundesliga, Ligue1 + UCL/UEL/UECL
const NAME_KEYS = ['Champions League','Europa League','Conference League','World Cup','UEFA','FIFA'];

const today = ()=> new Date().toISOString().slice(0,10);
const seasonFrom = d => { const x=new Date(d), y=x.getUTCFullYear(), m=x.getUTCMonth()+1; return m>=7?y:y-1; };

function isTop(f){
  const L=f?.league||{};
  if (TOP_LEAGUE_IDS.has(L.id)) return true;
  const name=(L.name||'') + ' ' + (L.country||'');
  return NAME_KEYS.some(k=>name.includes(k));
}
async function fixtures(date){
  const out=[]; const tzs=[API_TZ,'Europe/London','UTC'];
  for(const tz of tzs){
    let p=1, tot=1;
    do{
      try{
        const r=await AX.get(`/fixtures?date=${encodeURIComponent(date)}&page=${p}&timezone=${encodeURIComponent(tz)}`);
        const resp=r.data||{}; tot=resp?.paging?.total||1;
        for(const f of (resp?.response||[])){ if(isTop(f)){ out.push(f); if(out.length>=MAX_SCORE) return out; } }
      }catch{ break; }
      p++; if(p>PAGE_CAP) break;
      if(p<=tot) await new Promise(r=>setTimeout(r,120));
    } while (p<=tot);
    if (out.length) return out;
  }
  return [];
}

// reuse tiny model pieces from free-picks
const PRIOR_G= Number(process.env.PRIOR_EXP_GOALS  || 2.6);
const HOME_SH= Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_N= Number(process.env.PRIOR_MATCHES    || 20);
const LMIN=Number(process.env.LAMBDA_MIN||0.5), LMAX=Number(process.env.LAMBDA_MAX||2.2);

async function stats(leagueId, season, teamId){
  try{ const r=await AX.get(`/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`); return r.data?.response||null; }catch{ return null; }
}
function norm(s){
  if(!s) return null;
  const played=s?.fixtures?.played?.total||0;
  const gf=s?.goals?.for?.total?.total||0, ga=s?.goals?.against?.total?.total||0;
  const avgGF=played?gf/played:0, avgGA=played?ga/played:0;
  const o25=(s?.goals?.for?.over_2_5?.total ?? Math.min(95,Math.max(0,Math.round((avgGF+avgGA)*10))));
  const cardsAvg=played?(
    Object.values(s?.cards?.yellow||{}).reduce((a,b)=>a+(b?.total||0),0)+
    Object.values(s?.cards?.red||{}).reduce((a,b)=>a+(b?.total||0),0)
  )/played:0;
  return {played,avgGF,avgGA,o25,cardsAvg};
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
function pPois(l,k){ const logF = n=>{let s=0;for(let i=1;i<=n;i++)s+=Math.log(i);return s}; return Math.exp(-l + k*Math.log(l) - logF(k)); }
function probTotalsAtLeast(h,a,min=3,maxK=10){ let p=0; for(let i=0;i<=maxK;i++){const ph=pPois(h,i); for(let j=0;j<=maxK;j++){ if(i+j>=min) p+=ph*pPois(a,j); }} return Math.min(Math.max(p,0),1); }
function probHomeWin(h,a,maxK=10){ let p=0; for(let i=0;i<=maxK;i++){const ph=pPois(h,i); for(let j=0;j<=maxK;j++){ if(i>j)p+=ph*pPois(a,j); }} return Math.min(Math.max(p,0),1); }
function probDraw(h,a,maxK=10){ let p=0; for(let k=0;k<=maxK;k++){ p+=pPois(h,k)*pPois(a,k);} return Math.min(Math.max(p,0),1); }
function probBTTS(h,a){ const p0h=Math.exp(-h), p0a=Math.exp(-a); return Math.min(Math.max(1-p0h-p0a+p0h*p0a,0),1); }
const pct = x => Math.max(1,Math.min(99,Math.round(Number(x)||0)));
const logistic = (d,k=1.2)=> 1/(1+Math.exp(-k*d));

export default async function handler(req,res){
  try{
    if(!API_KEY) return res.status(500).json({error:'missing_api_key'});
    const date=(req.query.date||today()).slice(0,10);
    const season=seasonFrom(date);
    const fx = await fixtures(date);

    const rows=[];
    for(const f of fx){
      try{
        const L=f.league?.id, h=f.teams?.home?.id, a=f.teams?.away?.id;
        if(!L||!h||!a) continue;
        const [hs,as]=await Promise.all([stats(L,season,h),stats(L,season,a)]);
        const H=norm(hs), A=norm(as); if(!H||!A) continue;
        const m=lambdas(H,A);

        // markets
        const pO25=probTotalsAtLeast(m.lH,m.lA,3);
        const cOU = pct(50 + Math.abs(pO25-0.5)*90);
        const pickOU = pO25>=0.5?'Over 2.5':'Under 2.5';

        const pBT=probBTTS(m.lH,m.lA), cBT=pct(50+Math.abs(pBT-0.5)*80), pickBT=pBT>=0.5?'Yes':'No';

        const pH=probHomeWin(m.lH,m.lA), pD=probDraw(m.lH,m.lA), pA=Math.max(0,1-pH-pD);
        const best1 = pH>=pA?'Home':'Away', p1 = best1==='Home'?pH:pA, c1=pct(50+Math.abs(p1-0.5)*80);

        const CARDS_LINE=Number(process.env.CARDS_OU_LINE||4.5),
              CARDS_PRIOR=Number(process.env.PRIOR_CARDS_AVG||4.6);
        const cardsAvg=((H.cardsAvg||CARDS_PRIOR/2)+(A.cardsAvg||CARDS_PRIOR/2))/2;
        const pCardsOver = logistic(cardsAvg - CARDS_LINE, 1.4);
        const cCards = pct(50+Math.abs(pCardsOver-0.5)*85);
        const pickCards = pCardsOver>=0.5?`Over ${CARDS_LINE}`:`Under ${CARDS_LINE}`;

        const CORNERS_LINE=Number(process.env.CORNERS_OU_LINE||9.5),
              CORNERS_BASE=Number(process.env.CORNERS_BASE||8.5),
              CORNERS_K=Number(process.env.CORNERS_PACE_K||0.6);
        const pace = H.avgGF+H.avgGA + A.avgGF+A.avgGA;
        const cornersEst = CORNERS_BASE + CORNERS_K*(pace-PRIOR_G);
        const pCornersOver = logistic(cornersEst-CORNERS_LINE,1.2);
        const cCorners = pct(50+Math.abs(pCornersOver-0.5)*80);
        const pickCorners = pCornersOver>=0.5?`Over ${CORNERS_LINE}`:`Under ${CORNERS_LINE}`;

        const candidates = [
          { market:'Goals Over/Under', pick: pickOU, confidence: cOU, reason:`ExpG ${m.exp.toFixed(2)}` },
          { market:'BTTS', pick: pickBT, confidence: cBT, reason:`BTTS ${Math.round(pBT*100)}%` },
          { market:'1X2',  pick: best1==='Home'?'1':'2', confidence: c1, reason:`H ${Math.round(pH*100)} / D ${Math.round(pD*100)} / A ${Math.round(pA*100)}` },
          { market:'Cards', pick: pickCards, confidence: cCards, reason:`Cards avg ~${cardsAvg.toFixed(2)} vs ${CARDS_LINE}` },
          { market:'Corners', pick: pickCorners, confidence: cCorners, reason:`Corners pace ~${cornersEst.toFixed(2)} vs ${CORNERS_LINE}` },
        ].sort((a,b)=>b.confidence-a.confidence);

        rows.push({
          fixtureId:f.fixture.id,
          kickoff: f.fixture.date,
          league:  f.league.name,
          home: f.teams.home.name,
          away: f.teams.away.name,
          best: candidates[0],
          all: candidates
        });
      }catch{}
    }

    rows.sort((a,b)=> (b.best?.confidence||0)-(a.best?.confidence||0) || new Date(a.kickoff)-new Date(b.kickoff));
    res.json({ dateUsed: date, items: rows.slice(0,PRO_MAX_ROWS), totals:{fixtures:fx.length, rows: Math.min(rows.length,PRO_MAX_ROWS)} });
  }catch(e){
    res.status(500).json({error:'pro_board_failed', detail:e?.message||String(e)});
  }
}
