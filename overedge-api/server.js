// overedge-api/server.js
// OverEdge API (clean): Free Picks + Pro Board + Hero Bet (+ Stripe, Firebase auth)

if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (_) {}
}

const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs/promises');
const cors    = require('cors');
const bodyParser = require('body-parser');

// ====== ENV / CONSTANTS ======================================================

const API_TZ   = process.env.API_FOOTBALL_TZ || 'Europe/London';
const API_KEY  = process.env.API_FOOTBALL_KEY || '';
if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY (data routes will 500)');

const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing')
  .split(',').map(s => s.trim().toLowerCase());

// Pro Board markets (UI filter)
const PRO_MARKETS = (process.env.PRO_MARKETS || 'OU25,BTTS,ONE_X_TWO,CARDS,CORNERS')
  .split(',').map(s => s.trim().toUpperCase());

const PRO_MAX_ROWS = Number(process.env.PRO_MAX_ROWS || 200);

// Free Picks (model-only) threshold
const FREEPICKS_MIN_CONF = Number(process.env.FREEPICKS_MIN_CONF || 65);

// Hard limits to avoid timeouts
const MAX_FIXTURES_TO_SCORE = Number(process.env.MAX_FIXTURES_TO_SCORE || 220);

// ====== APP ==================================================================
const app = express();
app.set('trust proxy', 1);
app.set('etag', false);

// CORS (allowlist optional)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
const allowlist = FRONTEND_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowlist.length || allowlist.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: !!allowlist.length
}));

// ====== FIREBASE ADMIN (optional; auth for Pro/Hero) =========================
const admin = require('firebase-admin');

(function initFirebaseAdmin() {
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID || undefined;

  const tryInitWithServiceJson = (raw) => {
    if (!raw) return false;
    let txt = raw.trim();
    if (!txt.startsWith('{')) { try { txt = Buffer.from(txt, 'base64').toString('utf8'); } catch {} }
    let svc; try { svc = JSON.parse(txt); } catch { return false; }
    if (svc.private_key && svc.private_key.includes('\\n')) svc.private_key = svc.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(svc), projectId: svc.project_id || projectIdEnv });
    console.log('🔐 Firebase initialized (service json)');
    return true;
  };

  const tryInitWithPair = (email, key) => {
    if (!email || !key) return false;
    let pk = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
    admin.initializeApp({ credential: admin.credential.cert({ client_email: email, private_key: pk, project_id: projectIdEnv }), projectId: projectIdEnv });
    console.log('🔐 Firebase initialized (email/key)');
    return true;
  };

  try {
    if (tryInitWithServiceJson(process.env.FIREBASE_SERVICE_ACCOUNT)) return;
    if (tryInitWithPair(process.env.FIREBASE_CLIENT_EMAIL, process.env.FIREBASE_PRIVATE_KEY)) return;
    admin.initializeApp({ credential: admin.credential.applicationDefault(), ...(projectIdEnv ? { projectId: projectIdEnv } : {}) });
    console.log('🔐 Firebase initialized (ADC)');
  } catch (e) {
    console.log('❌ Firebase init failed:', e.message);
  }
})();

const db = (() => { try { return admin.firestore(); } catch { return null; } })();

function decodeJwtNoVerify(token) {
  try { const p = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); return JSON.parse(Buffer.from(p, 'base64').toString('utf8')); }
  catch { return null; }
}
async function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  try { req.user = await admin.auth().verifyIdToken(m[1]); next(); }
  catch (e) {
    const claims = decodeJwtNoVerify(m[1]) || {};
    return res.status(401).json({ error:'invalid_token', detail: e.errorInfo?.message || e.message || String(e), aud: claims.aud, iss: claims.iss });
  }
}
async function getProStatus(uid) {
  if (!db) return { active:false, proUntil:null, source:'none' };
  try {
    const custRef = db.collection('customers').doc(uid);
    let proUntil = null;
    const custDoc = await custRef.get();
    if (custDoc.exists) {
      const raw = custDoc.data()?.proUntil || null;
      if (raw) proUntil = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
    }
    const activeViaFirestore = !!(proUntil && proUntil.getTime() > Date.now());
    const subsSnap = await custRef.collection('subscriptions').where('status','in',OK_STATUSES).limit(1).get();
    const activeViaStripe = subsSnap && !subsSnap.empty;
    return { active: activeViaStripe || activeViaFirestore, proUntil: proUntil || null, source: activeViaStripe ? 'stripe' : (activeViaFirestore ? 'firestore':'none') };
  } catch { return { active:false, proUntil:null, source:'error' }; }
}
async function requirePro(req, res, next) {
  if (!req.user?.uid) return res.status(401).json({ error:'missing_auth' });
  const st = await getProStatus(req.user.uid);
  if (!st.active) return res.status(401).json({ error:'no_subscription', proUntil: st.proUntil ? st.proUntil.toISOString() : null, source: st.source });
  next();
}

// ====== STRIPE WEBHOOK (optional; safe no-op if not set) =====================
let stripe = null;
if (process.env.STRIPE_SECRET) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET); }
  catch (e) { console.log('Stripe init error:', e.message); }
}
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(501).send('stripe_not_configured');
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    const writeSub = async (uid, sub) => {
      try {
        if (!db) throw new Error('firestore_not_initialized');
        const ref = db.collection('customers').doc(uid).collection('subscriptions').doc(sub.id);
        await ref.set({
          id: sub.id, status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end*1000) : null,
          price: sub.items?.data?.[0]?.price?.id || null, product: sub.items?.data?.[0]?.price?.product || null,
          mode: 'subscription', updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge:true });
      } catch (e) { console.log('❌ Firestore write failed', e.message); }
    };
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const uid = s.metadata?.firebaseUID || '';
        if (uid && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          await writeSub(uid, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = sub.metadata?.firebaseUID || '';
        if (uid) await writeSub(uid, sub);
        break;
      }
      default: break;
    }
    res.json({ received:true });
  } catch (err) { res.status(400).send(`Webhook Error: ${err.message}`); }
});

// JSON body after webhook
app.use(express.json());

// ====== HEALTH / WHOAMI ======================================================
app.get('/api/health', (_req,res) => res.json({ ok:true, hasKey: !!API_KEY, tz: API_TZ }));
app.get('/api/whoami', requireAuth, (req,res)=> res.json({ ok:true, uid:req.user?.uid||null, email:req.user?.email||null }));

// ====== FIXTURE HELPERS / FETCH =============================================
function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){ const d = new Date(dateStr); const y = d.getUTCFullYear(), m = d.getUTCMonth()+1; return (m >= 7) ? y : y - 1; }
const AXIOS = { headers: { 'x-apisports-key': API_KEY }, timeout: 15000 };

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
const UEFA_IDS = new Set([2,3,848,4,15,16]); // UCL, UEL, UECL, Super Cup, Euros, Euro Qual

function isYouthFixture(f){
  const s = [f?.teams?.home?.name, f?.teams?.away?.name, f?.league?.name].filter(Boolean).join(' ').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function inEuropeClubScope(f){
  const lid = f?.league?.id, c = f?.league?.country;
  const t = (f?.league?.type || '').toLowerCase();
  return !isYouthFixture(f) && (EURO_COUNTRIES.has(c) || UEFA_IDS.has(lid)) && t === 'league';
}
async function fetchAllEuropeFixturesFast(date){
  const tryFetch = async (query, tz) => {
    const out = [];
    let page = 1, total = 1;
    do {
      const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(tz)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const resp = r.data || {};
        total = resp?.paging?.total || 1;
        const arr = resp?.response || [];
        for (const f of arr) if (inEuropeClubScope(f)) out.push(f);
      } catch (e) { break; }
      page += 1;
      if (page <= total) await new Promise(r => setTimeout(r, 120));
    } while (page <= total);
    return out;
  };

  const TZ = [API_TZ, 'Europe/London', 'UTC'];
  for (const tz of TZ) { const a = await tryFetch(`date=${date}`, tz); if (a.length) return a; }
  for (const tz of TZ) { const b = await tryFetch(`from=${date}&to=${date}`, tz); if (b.length) return b; }
  return [];
}
// ====== DATA DIR / CALIBRATION / CACHE ======================================
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR  = process.env.DATA_DIR || (IS_VERCEL ? '/tmp/overedge-data' : path.join(__dirname, '..', 'data'));
const CAL_FILE  = path.join(DATA_DIR, 'calibration.json');
const DAILY_FILE= path.join(DATA_DIR, 'daily_cache.json');

function defaultCalibration(){
  return {
    updatedAt: null, horizonDays: 0,
    markets: {
      OU25: { Over:{bins:[],mapping:[]}, Under:{bins:[],mapping:[]} },
      BTTS: { Yes:{bins:[],mapping:[]},   No:{bins:[],mapping:[]} },
      ONE_X_TWO: { Home:{bins:[],mapping:[]}, Draw:{bins:[],mapping:[]}, Away:{bins:[],mapping:[]} }
    },
    note: 'Identity mapping.'
  };
}
async function ensureDataFiles(){
  try { fs.mkdirSync(DATA_DIR, { recursive:true }); } catch {}
  if (!fs.existsSync(CAL_FILE))   await fsp.writeFile(CAL_FILE, JSON.stringify(defaultCalibration(),null,2));
  if (!fs.existsSync(DAILY_FILE)) await fsp.writeFile(DAILY_FILE, '{}');
}
async function loadJSON(f, fb){ try { return JSON.parse(await fsp.readFile(f,'utf-8')); } catch { return fb; } }
async function saveJSON(f, obj){ await fsp.writeFile(f, JSON.stringify(obj, null, 2)); }
let CAL = defaultCalibration();
const dailyPicksCache = new Map();
async function loadDailyCacheIntoMap(){ const obj = await loadJSON(DAILY_FILE, {}); dailyPicksCache.clear(); for (const [k,v] of Object.entries(obj)) dailyPicksCache.set(k,v); }
async function persistDailyCache(){
  const keepDays=14, cutoff = new Date(); cutoff.setDate(cutoff.getDate()-keepDays);
  const asObj = {};
  for (const [k,v] of dailyPicksCache.entries()){
    const keyDate = new Date((k.split('|')[0]||'').slice(0,10));
    if (!isNaN(keyDate) && keyDate < cutoff) continue;
    asObj[k] = v;
  }
  await saveJSON(DAILY_FILE, asObj);
}
function interp(mapping, x){
  if (!Array.isArray(mapping) || !mapping.length) return x;
  if (x <= mapping[0].x) return mapping[0].y;
  if (x >= mapping[mapping.length-1].x) return mapping[mapping.length-1].y;
  for (let i=1;i<mapping.length;i++){ const a=mapping[i-1], b=mapping[i]; if (x <= b.x){ const t=(x-a.x)/(b.x-a.x||1); return a.y + t*(b.y-a.y); } }
  return x;
}
function asPct(n){ return Math.max(1, Math.min(99, Math.round(Number(n)||0))); }
function calibrate(market, side, confRaw){ const m = CAL.markets?.[market]; const map = m?.[side]?.mapping; return asPct(interp(map, confRaw)); }
// ====== MODEL: team stats + probabilities ===================================
const statsCache = new Map(); // key raw_{league}_{season}_{team}
async function fetchTeamStatsRaw(leagueId, season, teamId){
  const key = `raw_${leagueId}_${season}_${teamId}`;
  if (statsCache.has(key)) return statsCache.get(key);
  try {
    const url = `https://v3.football.api-sports.io/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`;
    const r = await axios.get(url, AXIOS);
    const data = r.data?.response || null;
    statsCache.set(key, data);
    return data;
  } catch { return null; }
}
function normalizeStats(resp){
  if (!resp) return null;
  const played = resp.fixtures?.played?.total || 0;
  const gf = resp.goals?.for?.total?.total || 0;
  const ga = resp.goals?.against?.total?.total || 0;
  const avgGF = played ? gf/played : 0;
  const avgGA = played ? ga/played : 0;
  const explicitO25 = resp.goals?.for?.over_2_5?.total;
  const pace = avgGF + avgGA;
  const estO25 = Math.min(95, Math.max(0, Math.round(pace*10)));
  const o25pct = (typeof explicitO25 === 'number' && explicitO25 >= 0) ? explicitO25 : estO25;

  const sumMin = (obj)=>{ try{ return Object.values(obj||{}).reduce((s,m)=> s+(m?.total||0),0);}catch{ return 0; } };
  const cardsAvg = played ? (sumMin(resp.cards?.yellow)+sumMin(resp.cards?.red))/played : 0;

  return { played, avgGF, avgGA, o25pct, cardsAvg };
}
async function getTeamStatsBlended(leagueId, season, teamId){
  const cur = normalizeStats(await fetchTeamStatsRaw(leagueId, season, teamId));
  if (!cur) {
    return normalizeStats(await fetchTeamStatsRaw(leagueId, season-1, teamId))
        || normalizeStats(await fetchTeamStatsRaw(leagueId, season-2, teamId))
        || null;
  }
  if (cur.played >= 5) return cur;
  const prev = normalizeStats(await fetchTeamStatsRaw(leagueId, season-1, teamId));
  if (!prev) return cur;
  const wCur = Math.min(0.6, cur.played/6), wPrev = 1 - wCur;
  return {
    played: cur.played,
    avgGF: cur.avgGF*wCur + prev.avgGF*wPrev,
    avgGA: cur.avgGA*wCur + prev.avgGA*wPrev,
    o25pct: Math.round(cur.o25pct*wCur + prev.o25pct*wPrev),
    cardsAvg: cur.cardsAvg*wCur + prev.cardsAvg*wPrev
  };
}

// Poisson-ish model
const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.6);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 20);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.50);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.20);

function _logFact(n){ let s=0; for(let i=1;i<=n;i++) s+=Math.log(i); return s; }
function poissonP(lambda,k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }
function probTotalsAtLeast(lambdaH, lambdaA, minGoals=3, maxK=10){
  let p=0; for(let h=0;h<=maxK;h++){ const ph = poissonP(lambdaH,h); for(let a=0;a<=maxK;a++){ if (h+a>=minGoals) p += ph*poissonP(lambdaA,a); } }
  return Math.min(Math.max(p,0),1);
}
function probHomeWin(lambdaH, lambdaA, maxK=10){
  let p=0; for(let h=0;h<=maxK;h++){ const ph = poissonP(lambdaH,h); for(let a=0;a<=maxK;a++){ if (h>a) p += ph*poissonP(lambdaA,a); } }
  return Math.min(Math.max(p,0),1);
}
function probDraw(lambdaH, lambdaA, maxK=10){
  let p=0; for(let k=0;k<=maxK;k++){ p += poissonP(lambdaH,k)*poissonP(lambdaA,k); } return Math.min(Math.max(p,0),1);
}
function probBTTS_lambda(lambdaH, lambdaA){ const p0h=Math.exp(-lambdaH), p0a=Math.exp(-lambdaA); return Math.min(Math.max(1 - p0h - p0a + p0h*p0a, 0), 1); }

function estimateLambdasFromTeamStats(h,a){
  const estH = Math.max(((h.avgGF||0)+(a.avgGA||0))/2, 0.05);
  const estA = Math.max(((a.avgGF||0)+(h.avgGA||0))/2, 0.05);
  const priorH = PRIOR_EXP_GOALS*PRIOR_HOME_SHARE;
  const priorA = PRIOR_EXP_GOALS*(1-PRIOR_HOME_SHARE);
  const n = Math.max(0, (h.played||0)+(a.played||0));
  const w = n/(n+PRIOR_MATCHES);
  const lambdaHome = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorH*(1-w) + estH*w));
  const lambdaAway = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, priorA*(1-w) + estA*w));
  const expGoals = lambdaHome + lambdaAway;
  return {
    lambdaHome, lambdaAway, expGoals,
    pO25: probTotalsAtLeast(lambdaHome, lambdaAway, 3),
    pBTTS: probBTTS_lambda(lambdaHome, lambdaAway),
    pH: probHomeWin(lambdaHome, lambdaAway),
    pD: probDraw(lambdaHome, lambdaAway),
    pA: Math.max(0, 1 - probHomeWin(lambdaHome, lambdaAway) - probDraw(lambdaHome, lambdaAway)),
    n: (h.played||0)+(a.played||0)
  };
}

// Confidence scoring (no odds)
function scoreOver25(h, a){
  const paceTotal = ((h.avgGF + h.avgGA) + (a.avgGF + a.avgGA)) / 2;
  const hist = (h.o25pct + a.o25pct) / 2;
  let raw = 50;
  raw += (hist - 50) * 0.50;
  raw += (paceTotal - PRIOR_EXP_GOALS) * 20;
  return { score: raw, confidence: asPct(raw) };
}
function scoreUnder25(h, a){
  const paceTotal = ((h.avgGF + h.avgGA) + (a.avgGF + a.avgGA)) / 2;
  const hist = (h.o25pct + a.o25pct) / 2;
  let raw = 50;
  raw += (50 - hist) * 0.50;
  raw += (PRIOR_EXP_GOALS - paceTotal) * 22;
  return { score: raw, confidence: asPct(raw) };
}

// Friendly reasoning text
function buildFreeReason(f, h, a, m, side) {
  const home = f.teams?.home?.name || 'Home';
  const away = f.teams?.away?.name || 'Away';
  if (/under/i.test(side)) {
    return [
      `${home} and ${away} trend toward controlled phases without many clean looks at goal.`,
      `Midfield profiles suggest slower progression and fewer high-value chances.`,
      `Set-piece volatility is modest; compact shapes are rewarded over risk.`,
      `Projection: ~${m.expGoals.toFixed(2)} total goals.`
    ].join(' ');
  } else {
    return [
      `${home} and ${away} both carry attacking intent and can be stretched when pressed.`,
      `Transitions should appear and finishing volume builds as the game opens up.`,
      `Market prices often lag a style clash that favors goals in this spot.`,
      `Projection: ~${m.expGoals.toFixed(2)} total goals.`
    ].join(' ');
  }
}

// ====== FREE PICKS (model-only top 2) ========================================
async function pickEuropeTwo({ date, season, minConf, wantDebug=false }){
  const fixturesFull = await fetchAllEuropeFixturesFast(date);
  // Cap amount we score to avoid timeouts
  const fixtures = fixturesFull.slice(0, MAX_FIXTURES_TO_SCORE);

  const cand = [];
  for (const f of fixtures) {
    try {
      const L   = f.league?.id;
      const hId = f.teams?.home?.id;
      const aId = f.teams?.away?.id;
      if (!L || !hId || !aId) continue;

      const [h, a] = await Promise.all([
        getTeamStatsBlended(L, season, hId),
        getTeamStatsBlended(L, season, aId),
      ]);
      if (!h || !a) continue;

      const model = estimateLambdasFromTeamStats(h, a);

      const so = scoreOver25(h, a);
      const su = scoreUnder25(h, a);
      let side, confRaw;
      if (so.confidence >= su.confidence) { side = 'Over 2.5';  confRaw = so.confidence; }
      else                                 { side = 'Under 2.5'; confRaw = su.confidence; }

      if (confRaw < minConf) continue;
      const confCal = calibrate('OU25', /under/i.test(side) ? 'Under' : 'Over', confRaw);

      cand.push({
        f, h, a, model,
        side,
        confidenceRaw: asPct(confRaw),
        confidence:    asPct(confCal)
      });
    } catch (_) {}
  }

  const dbg = wantDebug ? {
    fixturesTotal: fixturesFull.length,
    fixturesScored: fixtures.length,
    countriesSample: Array.from(new Set(fixtures.map(x => x.league?.country))).slice(0, 10),
    leaguesSample: Array.from(new Set(fixtures.map(x => x.league?.name))).slice(0, 12),
  } : undefined;

  return { cand, poolSize: fixtures.length, dbg };
}

// ====== /api/free-picks ======================================================
app.get('/api/free-picks', async (req,res)=>{
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const minConf = Number(req.query.minConf ?? FREEPICKS_MIN_CONF);
    const force   = req.query.refresh === '1';
    const wantDebug = req.query.debug === '1';

    await ensureDataFiles();
    CAL = await loadJSON(CAL_FILE, defaultCalibration());
    if (!force && dailyPicksCache.size === 0) await loadDailyCacheIntoMap();

    const cacheKey = `${date}|${minConf}`;
    if (!force && dailyPicksCache.has(cacheKey)) {
      const cached = { ...(dailyPicksCache.get(cacheKey)), cached:true };
      if (!wantDebug) return res.json(cached);
    }

    const { cand, poolSize, dbg } = await pickEuropeTwo({ date, season, minConf, wantDebug });

    const picks = cand
      .sort((a,b)=> b.confidence - a.confidence)
      .slice(0,2)
      .map(x => ({
        match: `${x.f.teams.home.name} vs ${x.f.teams.away.name}`,
        league: x.f.league.name,
        kickoff: x.f.fixture.date,
        market: 'Over/Under 2.5 Goals',
        prediction: x.side,
        odds: '—', // model-only
        confidence: x.confidence,
        confidenceRaw: x.confidenceRaw,
        reasoning: buildFreeReason(x.f, x.h, x.a, x.model, x.side)
      }));

    const payload = {
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf },
      meta: { poolSize, candidates: cand.length, ...(wantDebug ? { debug: dbg } : {}) },
      picks,
      computedAt: new Date().toISOString(),
      cached:false
    };

    if (!wantDebug) {
      dailyPicksCache.set(cacheKey, payload);
      await persistDailyCache();
    }

    res.json(payload);
  }catch(e){
    console.error('free-picks error', e.stack || e.message || e);
    res.status(500).json({ error:'failed_to_load_picks', detail:e?.message || String(e) });
  }
});
// ====== Pro Board helper =====================================================
function logistic(p, k=1.2){ return 1/(1+Math.exp(-k*p)); }

function pickFromModelForFixture(f, h, a, m){
  const out=[];
  const sOver = scoreOver25(h,a), sUnder = scoreUnder25(h,a);
  let side = 'Over 2.5', raw = sOver.confidence;
  if (sUnder.confidence > sOver.confidence){ side='Under 2.5'; raw = sUnder.confidence; }
  const cal = calibrate('OU25', /under/i.test(side)? 'Under':'Over', raw);
  out.push({ market:'OU25', selection: side, confidenceRaw: asPct(raw), confidence: asPct(cal), reason:`ExpG ${m.expGoals.toFixed(2)}` });

  const pBTTS = m.pBTTS, sideB = (pBTTS>=0.5)?'Yes':'No', cBraw = Math.round(50+Math.abs(pBTTS-0.5)*80);
  const cBcal = calibrate('BTTS', sideB, cBraw);
  out.push({ market:'BTTS', selection: sideB, confidenceRaw: asPct(cBraw), confidence: asPct(cBcal), reason:`BTTS ${Math.round(pBTTS*100)}%` });

  const side1 = (m.pH >= m.pA) ? 'Home':'Away', p1 = side1==='Home'? m.pH : m.pA;
  const c1raw = Math.round(50+Math.abs(p1-0.5)*80), c1cal = calibrate('ONE_X_TWO', side1, c1raw);
  out.push({ market:'ONE_X_TWO', selection: side1, confidenceRaw: asPct(c1raw), confidence: asPct(c1cal), reason:`1X2 H ${Math.round(m.pH*100)} / D ${Math.round(m.pD*100)} / A ${Math.round(m.pA*100)}` });

  // simple UI chips for cards / corners
  const PRIOR_CARDS_AVG= Number(process.env.PRIOR_CARDS_AVG||4.6);
  const CARDS_OU_LINE  = Number(process.env.CARDS_OU_LINE  || 4.5);
  const CORNERS_OU_LINE= Number(process.env.CORNERS_OU_LINE|| 9.5);
  const CORNERS_BASE   = Number(process.env.CORNERS_BASE   || 8.5);
  const CORNERS_PACE_K = Number(process.env.CORNERS_PACE_K || 0.60);

  const cardsAvg = ((h.cardsAvg || PRIOR_CARDS_AVG/2)+(a.cardsAvg || PRIOR_CARDS_AVG/2))/2;
  const pCardsOver = logistic(cardsAvg - CARDS_OU_LINE, 1.4);
  const pace = h.avgGF+h.avgGA + a.avgGF+a.avgGA;
  const cornersEst = CORNERS_BASE + CORNERS_PACE_K * (pace - PRIOR_EXP_GOALS);
  const pCornersOver = logistic(cornersEst - CORNERS_OU_LINE, 1.2);

  out.push({ market:'CARDS',   selection: pCardsOver>=0.5?`Over ${CARDS_OU_LINE}`:`Under ${CARDS_OU_LINE}`,   confidence: asPct(50 + Math.abs(pCardsOver-0.5)*90), reason:`Cards avg ${cardsAvg.toFixed(2)} vs ${CARDS_OU_LINE}` });
  out.push({ market:'CORNERS', selection: pCornersOver>=0.5?`Over ${CORNERS_OU_LINE}`:`Under ${CORNERS_OU_LINE}`, confidence: asPct(50 + Math.abs(pCornersOver-0.5)*85), reason:`Corners pace ${cornersEst.toFixed(2)} vs ${CORNERS_OU_LINE}` });

  return out;
}

// ====== /api/pro-board (model-only) =========================================
app.get('/api/pro-board', requireAuth, requirePro, async (req,res)=>{
  try {
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const fixtures = (await fetchAllEuropeFixturesFast(date)).slice(0, MAX_FIXTURES_TO_SCORE);

    const items=[];
    for (const f of fixtures){
      try{
        const L=f.league?.id, hId=f.teams?.home?.id, aId=f.teams?.away?.id;
        if (!L||!hId||!aId) continue;
        const [h,a] = await Promise.all([ getTeamStatsBlended(L, season, hId), getTeamStatsBlended(L, season, aId) ]);
        if (!h||!a) continue;
        const m = estimateLambdasFromTeamStats(h,a);

        const picks = pickFromModelForFixture(f,h,a,m)
          .filter(p => PRO_MARKETS.includes(p.market))
          .sort((x,y)=> y.confidence - x.confidence);

        const topBets = picks.map(p=>{
          let market = p.market, pick = p.selection, reason = p.reason || '';
          if (market==='OU25')      market='Goals Over/Under';
          if (market==='ONE_X_TWO'){ market='1X2'; pick = (pick==='Home'?'1':'2'); }
          return { market, pick, confidence: p.confidence, reason };
        });

        items.push({
          fixtureId: f.fixture.id,
          kickoff: f.fixture.date,
          league: { name: f.league.name },
          competition: f.league.name,
          home: f.teams.home.name, away: f.teams.away.name,
          market: 'Goals Over/Under',
          topBets,
          model: {
            lambdaHome: m.lambdaHome, lambdaAway: m.lambdaAway, expGoals: m.expGoals,
            pOver25: m.pO25, pBTTS: m.pBTTS, pHome: m.pH, pDraw: m.pD, pAway: m.pA, n: m.n
          }
        });
      }catch(_){ /* skip */ }
    }

    items.sort((a,b)=>{
      const ac=a.topBets?.[0]?.confidence||0, bc=b.topBets?.[0]?.confidence||0;
      if (bc!==ac) return bc-ac;
      return new Date(a.kickoff) - new Date(b.kickoff);
    });

    const payloadItems = items.slice(0, PRO_MAX_ROWS);
    res.json({ dateUsed: date, items: payloadItems, totals:{ fixtures: fixtures.length, rows: payloadItems.length }, computedAt: new Date().toISOString() });
  } catch (e) {
    console.error('pro-board error', e.message);
    res.status(500).json({ error:'failed_to_load_pro_board', detail:e.message });
  }
});

// ====== /api/hero-bet (model-only, OU window not enforced) ===================
app.get('/api/hero-bet', requireAuth, requirePro, async (req,res)=>{
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });
    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const fixtures = (await fetchAllEuropeFixturesFast(date)).slice(0, MAX_FIXTURES_TO_SCORE);

    let best=null;
    for (const f of fixtures){
      try{
        const L=f.league?.id, hId=f.teams?.home?.id, aId=f.teams?.away?.id;
        if (!L||!hId||!aId) continue;
        const [h,a] = await Promise.all([ getTeamStatsBlended(L, season, hId), getTeamStatsBlended(L, season, aId) ]);
        if (!h||!a) continue;
        const m = estimateLambdasFromTeamStats(h,a);
        const so = scoreOver25(h,a), su = scoreUnder25(h,a);
        const side = (so.confidence >= su.confidence) ? 'Over 2.5' : 'Under 2.5';
        const confRaw = Math.max(so.confidence, su.confidence);
        const confCal = calibrate('OU25', /under/i.test(side)? 'Under':'Over', confRaw);

        const hero = {
          match: `${f.teams.home.name} vs ${f.teams.away.name}`,
          league: f.league.name,
          kickoff: f.fixture.date,
          market: 'Over/Under 2.5 Goals',
          prediction: side,
          odds: '—',
          confidence: asPct(confCal),
          confidenceRaw: asPct(confRaw),
          reasoning: `ExpG ${m.expGoals.toFixed(2)} (λH ${m.lambdaHome.toFixed(2)} | λA ${m.lambdaAway.toFixed(2)})`
        };
        if (!best || hero.confidence > best.confidence) best = hero;
      }catch(_){}
    }
    if (!best) return res.status(404).json({ error:'no_hero_pick', date });
    res.json({ dateUsed: date, hero: best, computedAt: new Date().toISOString() });
  }catch(e){
    console.error('hero-bet error', e.message);
    res.status(500).json({ error:'failed_to_load_hero_bet', detail:e.message });
  }
});

// ====== STATIC (local dev) ===================================================
if (require.main === module) {
  const STATIC_DIR = path.join(__dirname, '..', 'overedge-web');
  app.use(express.static(STATIC_DIR));
  app.get('/', (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
  app.get(/^(?!\/api\/).+/, (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
}

// ====== EXPORT / START =======================================================
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  (async () => { try { await ensureDataFiles(); CAL = await loadJSON(CAL_FILE, defaultCalibration()); await loadDailyCacheIntoMap(); } catch {} })();
  app.listen(PORT, ()=> console.log(`🟢 http://localhost:${PORT}`));
}
