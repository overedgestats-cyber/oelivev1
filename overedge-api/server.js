// overedge-api/server.js
// OverEdge API: Free Picks + Pro Board + Hero Pick (+ Stripe, Firebase auth)

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
// Make API-Football "date=" match what you see locally (Flashscore)
const API_TZ = process.env.API_FOOTBALL_TZ || 'Europe/Sofia';

// ---------------- App / basic setup ----------------
const app = express();
app.set('trust proxy', 1);

// ---------------- CORS ----------------
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

// ---------------- Firebase Admin (auth + subs) ----------------
const admin = require('firebase-admin');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || null;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const svc = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...(FIREBASE_PROJECT_ID ? { projectId: FIREBASE_PROJECT_ID } : {})
    });
  }
  console.log('🔐 Firebase initialized', FIREBASE_PROJECT_ID ? `(project: ${FIREBASE_PROJECT_ID})` : '');
} catch (e) {
  console.log('⚠️ Firebase init:', e.message);
}

const db = (() => { try { return admin.firestore(); } catch { return null; } })();
const OK_STATUSES = (process.env.SUB_OK_STATUSES || 'active,trialing').split(',').map(s => s.trim().toLowerCase());

function decodeJwtNoVerify(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
  } catch { return null; }
}

async function hasActiveSub(uid) {
  if (!db) return false;
  try {
    const q = await db.collection(`customers/${uid}/subscriptions`)
      .where('status', 'in', OK_STATUSES).limit(1).get();
    return !q.empty;
  } catch (e) { console.log('sub check:', e.message); return false; }
}

async function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = await admin.auth().verifyIdToken(m[1]);
    next();
  } catch (e) {
    const claims = decodeJwtNoVerify(m[1]) || {};
    return res.status(401).json({
      error: 'invalid_token',
      detail: e.errorInfo?.message || e.message || String(e),
      aud: claims.aud, iss: claims.iss, expectedProject: FIREBASE_PROJECT_ID || null
    });
  }
}

async function requirePro(req, res, next) {
  if (!req.user?.uid) return res.status(401).json({ error: 'missing_auth' });
  const ok = await hasActiveSub(req.user.uid);
  if (!ok) return res.status(401).json({ error: 'no_subscription' });
  next();
}

// ---------------- Stripe (optional) ----------------
let stripe = null;
if (process.env.STRIPE_SECRET) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET); }
  catch (e) { console.log('Stripe init error:', e.message); }
}

// Stripe webhook MUST get the raw body, and MUST be before express.json()
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
          id: sub.id,
          status: sub.status,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          price: sub.items?.data?.[0]?.price?.id || null,
          product: sub.items?.data?.[0]?.price?.product || null,
          mode: 'subscription',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`✅ wrote sub ${sub.id} for uid ${uid} (${sub.status})`);
      } catch (e) {
        console.log('❌ Firestore write failed', e.message);
      }
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object;
        const uid = sess.metadata?.firebaseUID || '';
        if (uid && sess.subscription) {
          const sub = await stripe.subscriptions.retrieve(sess.subscription);
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
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.log('⚠️ Webhook signature failed', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// AFTER webhook: parse JSON for all other routes
app.use(express.json());

// ---------------- Health / debug ----------------
const API_KEY = process.env.API_FOOTBALL_KEY || '';
if (!API_KEY) console.error('⚠️ Missing API_FOOTBALL_KEY');

app.get('/api/health', (_req, res) => res.json({ ok: true, hasKey: !!API_KEY }));
app.get('/__debug/whoami', requireAuth, (req, res) => {
  const { uid, email, aud, iss } = req.user || {};
  res.json({ ok: true, uid, email, aud, iss });
});

// ---------------- Helpers / model ----------------
function todayYMD(){ return new Date().toISOString().slice(0,10); }
function seasonFromDate(dateStr){
  const d = new Date(dateStr);
  const y = d.getUTCFullYear(), m = d.getUTCMonth()+1;
  return (m >= 7) ? y : y - 1; // EU season rollover ~Aug
}

const AXIOS = { headers: { 'x-apisports-key': API_KEY }, timeout: 15000 };

const EURO_COUNTRIES = new Set([
  'England','Spain','Italy','Germany','France','Scotland','Wales','Northern Ireland','Ireland',
  'Norway','Sweden','Denmark','Finland','Iceland','Estonia','Latvia','Lithuania',
  'Netherlands','Belgium','Luxembourg','Austria','Switzerland','Liechtenstein',
  'Croatia','Serbia','Bosnia and Herzegovina','Slovenia','North Macedonia','Montenegro','Albania','Kosovo',
  'Bulgaria','Romania','Hungary','Czech Republic','Slovakia','Poland',
  'Portugal','Greece','Turkey','Cyprus','Malta',
  'Ukraine','Belarus','Moldova','Georgia','Armenia','Azerbaijan','Russia',
  'Andorra','San Marino','Gibraltar','Faroe Islands','Europe','World'
]);
const UEFA_IDS = new Set([2,3,848,4,15,16]); // UCL, UEL, UECL, Super Cup, Euros, Euro Qual

const DEFAULT_ALLOWED_LEAGUES = [39,40,45,46,78,79,81,61,62,66,140,141,143,135,136,137,157,158,2,3,848,4,15,16,9,26,7];
let ALLOWED_LEAGUES = (process.env.PRO_ALLOWED_LEAGUES || '')
  .split(',').map(s => Number(s.trim())).filter(Boolean);
if (!ALLOWED_LEAGUES.length) ALLOWED_LEAGUES = DEFAULT_ALLOWED_LEAGUES;
const ALLOWED_SET = new Set(ALLOWED_LEAGUES);

// ---- Try to load whitelist of EU top-2 tier leagues for Free Picks ----
let FREE_PICKS_COMP_IDS = new Set();
try {
  const cmp = require('./lib/competitions');
  if (cmp && cmp.FREE_PICKS_COMP_IDS) {
    FREE_PICKS_COMP_IDS = new Set(
      Array.from(cmp.FREE_PICKS_COMP_IDS).map(x => {
        const n = Number(x);
        return Number.isFinite(n) ? n : x;
      })
    );
  }
} catch (_) {
  // optional file; fallback handled below
}

const HERO_TIER1_SET = new Set(
  (process.env.HERO_FIRST_TIER_LEAGUES || '39,78,61,140,135,88,94,144,203,197,218,207,103,113')
    .split(',').map(n => Number(n.trim())).filter(Boolean)
);

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
  } catch (e) { console.error('stats err', leagueId, season, teamId, e.message); return null; }
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

// Poisson / probabilities
const PRIOR_EXP_GOALS  = Number(process.env.PRIOR_EXP_GOALS  || 2.6);
const PRIOR_HOME_SHARE = Number(process.env.PRIOR_HOME_SHARE || 0.55);
const PRIOR_MATCHES    = Number(process.env.PRIOR_MATCHES    || 20);
const LAMBDA_MIN       = Number(process.env.LAMBDA_MIN       || 0.50);
const LAMBDA_MAX       = Number(process.env.LAMBDA_MAX       || 2.20);

function _logFact(n){ let s=0; for(let i=1;i<=n;i++) s+=Math.log(i); return s; }
function poissonP(lambda,k){ return Math.exp(-lambda + k*Math.log(lambda) - _logFact(k)); }
function probTotalsAtLeast(lambdaH, lambdaA, minGoals=3, maxK=10){
  let p=0;
  for(let h=0;h<=maxK;h++){
    const ph = poissonP(lambdaH,h);
    for(let a=0;a<=maxK;a++){ if (h+a>=minGoals) p += ph*poissonP(lambdaA,a); }
  }
  return Math.min(Math.max(p,0),1);
}
function probHomeWin(lambdaH, lambdaA, maxK=10){
  let p=0;
  for(let h=0;h<=maxK;h++){
    const ph = poissonP(lambdaH,h);
    for(let a=0;a<=maxK;a++){ if (h>a) p += ph*poissonP(lambdaA,a); }
  }
  return Math.min(Math.max(p,0),1);
}
function probDraw(lambdaH, lambdaA, maxK=10){
  let p=0;
  for(let k=0;k<=maxK;k++){ p += poissonP(lambdaH,k)*poissonP(lambdaA,k); }
  return Math.min(Math.max(p,0),1);
}
function probBTTS_lambda(lambdaH, lambdaA){
  const p0h = Math.exp(-lambdaH), p0a = Math.exp(-lambdaA);
  return Math.min(Math.max(1 - p0h - p0a + p0h*p0a, 0), 1);
}
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
    n, w
  };
}

// Scoring heuristics for OU  — OPTION A (re-centered confidence)
function asPct(n){ return Math.max(1, Math.min(99, Math.round(Number(n)||0))); }

function scoreOver25(h, a, odds){
  const paceTotal = ((h.avgGF + h.avgGA) + (a.avgGF + a.avgGA)) / 2; // expected total pace
  const hist = (h.o25pct + a.o25pct) / 2; // 0–100
  let boost = 0;
  if (typeof odds === 'number'){
    if (odds >= 1.60 && odds <= 2.20) boost = 6;
    else if (odds > 2.20 && odds <= 2.60) boost = 3;
    else if (odds < 1.45 || odds > 3.20)  boost = -6;
  }
  let raw = 50;
  raw += (hist - 50) * 0.50;                 // historical O2.5 tilt
  raw += (paceTotal - PRIOR_EXP_GOALS) * 20; // pace vs 2.6 baseline
  raw += boost;
  return { score: raw, confidence: asPct(raw) };
}

function scoreUnder25(h, a, odds){
  const paceTotal = ((h.avgGF + h.avgGA) + (a.avgGF + a.avgGA)) / 2;
  const hist = (h.o25pct + a.o25pct) / 2; // 0–100
  let boost = 0;
  if (typeof odds === 'number'){
    if (odds >= 1.50 && odds <= 2.10) boost = 5;
    else if (odds > 2.10 && odds <= 2.50) boost = 2;
    else if (odds < 1.40 || odds > 3.00)  boost = -5;
  }
  let raw = 50;
  raw += (50 - hist) * 0.50;                 // lower O2.5 history favors Under
  raw += (PRIOR_EXP_GOALS - paceTotal) * 22; // slower than baseline favors Under
  raw += boost;
  return { score: raw, confidence: asPct(raw) };
}

// Paginated fixtures fetch for Europe / UEFA (TZ-aware + fallback)
async function fetchAllEuropeFixturesFast(date){
  const tryFetch = async (query) => {
    const out = [];
    let page = 1, total = 1;
    do {
      const url = `https://v3.football.api-sports.io/fixtures?${query}&page=${page}&timezone=${encodeURIComponent(API_TZ)}`;
      try {
        const r = await axios.get(url, AXIOS);
        const resp = r.data || {};
        total = resp?.paging?.total || 1;

        const arr = resp?.response || [];
        for (const f of arr) {
          const c = f.league?.country;
          const lid = f.league?.id;
          if (EURO_COUNTRIES.has(c) || UEFA_IDS.has(lid)) out.push(f);
        }
      } catch (e) {
        console.error('fixtures err', { date, query, tz: API_TZ, status: e?.response?.status, detail: e?.response?.data || e.message });
        break;
      }

      page += 1;
      if (page <= total) await new Promise(r => setTimeout(r, 120));
    } while (page <= total);
    return out;
  };

  // Single-day query first
  const a = await tryFetch(`date=${date}`);
  if (a.length) return a;

  // Fallback to from/to (same day) to avoid TZ edge empties
  const b = await tryFetch(`from=${date}&to=${date}`);
  if (b.length) return b;

  console.warn('⚠️ fixtures empty after both queries', { date, tz: API_TZ });
  return [];
}

function isYouthFixture(f){
  const s = [f?.teams?.home?.name, f?.teams?.away?.name, f?.league?.name].filter(Boolean).join(' ').toLowerCase();
  return /\b(u1[6-9]|u2[0-3]|under\s?(1[6-9]|2[0-3])|youth|academy|women|ladies|fem(?:en|in)|reserve|reserves|b[\s-]?team)\b/.test(s);
}
function allowedFixture(f){
  return ALLOWED_SET.has(f?.league?.id) && !isYouthFixture(f);
}
function inProScope(f){
  const lid = f?.league?.id, c = f?.league?.country;
  return !isYouthFixture(f) && (EURO_COUNTRIES.has(c) || UEFA_IDS.has(lid));
}

// Data / calibration (Vercel => /tmp)
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = process.env.DATA_DIR || (IS_VERCEL ? '/tmp/overedge-data' : path.join(__dirname, '..', 'data'));
const PREDS_FILE = path.join(DATA_DIR, 'preds.json');
const CAL_FILE   = path.join(DATA_DIR, 'calibration.json');
const DAILY_FILE = path.join(DATA_DIR, 'daily_cache.json');

function defaultCalibration(){
  return {
    updatedAt: null, horizonDays: 0,
    markets: {
      OU25: { Over:{bins:[],mapping:[]}, Under:{bins:[],mapping:[]} },
      BTTS: { Yes:{bins:[],mapping:[]},   No:   {bins:[],mapping:[]} },
      ONE_X_TWO: { Home:{bins:[],mapping:[]}, Draw:{bins:[],mapping:[]}, Away:{bins:[],mapping:[]} }
    },
    note: 'Identity mapping (until enough data).'
  };
}
async function ensureDataFiles(){
  try { fs.mkdirSync(DATA_DIR, { recursive:true }); } catch {}
  if (!fs.existsSync(PREDS_FILE)) await fsp.writeFile(PREDS_FILE, '[]');
  if (!fs.existsSync(CAL_FILE))   await fsp.writeFile(CAL_FILE, JSON.stringify(defaultCalibration(), null, 2));
  if (!fs.existsSync(DAILY_FILE)) await fsp.writeFile(DAILY_FILE, '{}');
}
async function loadJSON(f, fb){ try { return JSON.parse(await fsp.readFile(f,'utf-8')); } catch { return fb; } }
async function saveJSON(f, obj){ await fsp.writeFile(f, JSON.stringify(obj, null, 2)); }

let CAL = defaultCalibration();
const dailyPicksCache = new Map();
async function loadDailyCacheIntoMap(){
  const obj = await loadJSON(DAILY_FILE, {});
  dailyPicksCache.clear();
  for (const [k,v] of Object.entries(obj)) dailyPicksCache.set(k,v);
}
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
  for (let i=1;i<mapping.length;i++){
    const a=mapping[i-1], b=mapping[i];
    if (x <= b.x){
      const t = (x-a.x)/(b.x-a.x || 1);
      return a.y + t*(b.y-a.y);
    }
  }
  return x;
}
function calibrate(market, side, confRaw){
  const m = CAL.markets?.[market];
  const map = m?.[side]?.mapping;
  return asPct(interp(map, confRaw));
}

// ---- Reasoning text for Free Picks ----
function buildFreeReason(f, h, a, m, side) {
  const home = f.teams?.home?.name || 'Home';
  const away = f.teams?.away?.name || 'Away';
  const league = f.league?.name || 'this league';

  if (/under/i.test(side)) {
    return [
      `${home} and ${away} trend toward controlled phases without many clean looks at goal.`,
      `The midfield profiles point to slower progression and fewer high-value chances.`,
      `Set-piece volatility is limited and the matchup rewards compact shapes over risk.`,
      `We project around ${m.expGoals.toFixed(2)} goals.`
    ].join(' ');
  } else {
    return [
      `${home} and ${away} both carry attacking intent and can be stretched when pressed.`,
      `Transitions should appear and finishing volume builds as the game opens up.`,
      `Market pricing doesn't fully reflect the style clash that favors goals.`,
      `We project around ${m.expGoals.toFixed(2)} goals.`
    ].join(' ');
  }
}

// ---------------- FREE PICKS ----------------
async function pickEuropeTwo({ date, season, minConf, minOdds, strictOnly=false, wantDebug=false }){
  const fixtures = await fetchAllEuropeFixturesFast(date);
  const fixturesTotal = fixtures.length;

  // primary pool: domestic top-2 excluding Pro set
  const pool = fixtures.filter(f=>{
    const c=f.league?.country, id=f.league?.id, t=(f.league?.type||'').toLowerCase();
    if (isYouthFixture(f)) return false;
    if (UEFA_IDS.has(id)) return false;                 // no international comps
    if (!EURO_COUNTRIES.has(c)) return false;           // only Europe
    if (t!=='league') return false;                     // no cups
    if (ALLOWED_SET.has(id)) return false;              // exclude Pro pool
    if (FREE_PICKS_COMP_IDS && FREE_PICKS_COMP_IDS.size) {
      return FREE_PICKS_COMP_IDS.has(id);
    }
    return true;
  });

  const cand = [];
  const list = pool.length
    ? pool
    : fixtures.filter(f =>
        !isYouthFixture(f) &&
        (UEFA_IDS.has(f.league?.id) || ['cup'].includes((f.league?.type || '').toLowerCase()))
      );
  const listUsed = list.length;

  for (const f of list) {
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

      // optional odds (median) — used ONLY for free picks screening
      let over = null, under = null;
      try {
        const r = await axios.get(
          `https://v3.football.api-sports.io/odds?fixture=${f.fixture?.id}`,
          AXIOS
        );
        const rows = r.data?.response || [];
        const overArr = [], underArr = [];
        for (const row of rows) {
          for (const bm of (row.bookmakers || [])) {
            for (const bet of (bm.bets || [])) {
              const name = (bet?.name || '').toLowerCase();
              if (!/over\/under|total|totals|goals over\/under/.test(name)) continue;
              for (const v of (bet.values || [])) {
                const sel = (v?.value || v?.label || '').toLowerCase();
                const o   = Number(v?.odd);
                if (!isFinite(o)) continue;
                if (/\bover\s*2\.5\b/.test(sel))   overArr.push(o);
                if (/\bunder\s*2\.5\b/.test(sel)) underArr.push(o);
              }
            }
          }
        }
        const med = arr => arr.sort((x, y) => x - y)[Math.floor(arr.length / 2)];
        if (overArr.length)  over  = Math.round(med(overArr)  * 100) / 100;
        if (underArr.length) under = Math.round(med(underArr) * 100) / 100;
      } catch { /* odds optional */ }

      const so = scoreOver25(h, a, over);
      const su = scoreUnder25(h, a, under);

      let side, confRaw, price;
      if (so.confidence >= su.confidence) { side = 'Over 2.5';  confRaw = so.confidence; price = over; }
      else                                 { side = 'Under 2.5'; confRaw = su.confidence; price = under; }

      if (confRaw < minConf) continue;
      if (typeof price === 'number' && price < minOdds) continue;
      if (strictOnly && price == null) continue;

      const confCal = calibrate('OU25', /under/i.test(side) ? 'Under' : 'Over', confRaw);

      cand.push({
        f, h, a, model,
        side,
        confidenceRaw: asPct(confRaw),
        confidence:    asPct(confCal),
        odds: price
      });
    } catch (e) {
      console.log('free cand err', f?.fixture?.id, e.message);
    }
  }

  const poolSize = list.length;
  const dbg = wantDebug ? {
    fixturesTotal,
    poolPrimary: pool.length,
    listUsed,
    leaguesSample: Array.from(new Set(list.map(x => x.league?.id))).slice(0, 20),
    countriesSample: Array.from(new Set(list.map(x => x.league?.country))).slice(0, 12),
  } : undefined;

  return { cand, poolSize, dbg };
}

app.get('/api/free-picks', async (req,res)=>{
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const minConf = Number(req.query.minConf || 65);
    const minOdds = Number(req.query.minOdds || 1.50);
    const strictOnly = req.query.strict === '1';
    const force = req.query.refresh === '1';
    const wantDebug = req.query.debug === '1';

    await ensureDataFiles();
    CAL = await loadJSON(CAL_FILE, defaultCalibration());
    if (!force && dailyPicksCache.size === 0) await loadDailyCacheIntoMap();

    const cacheKey = `${date}|${minConf}|${minOdds}|${strictOnly}`;
    if (!force && dailyPicksCache.has(cacheKey)){
      const cachedPayload = { ...(dailyPicksCache.get(cacheKey)), cached:true };
      if (!wantDebug) return res.json(cachedPayload);
    }

    const { cand, poolSize, dbg } = await pickEuropeTwo({ date, season, minConf, minOdds, strictOnly, wantDebug });

    const picks = cand.slice(0,2).map(x => ({
      match: `${x.f.teams.home.name} vs ${x.f.teams.away.name}`,
      league: x.f.league.name,
      kickoff: x.f.fixture.date,
      market: 'Over/Under 2.5 Goals',
      prediction: x.side,
      odds: (typeof x.odds==='number') ? x.odds.toFixed(2) : '—',
      confidence: x.confidence,
      confidenceRaw: x.confidenceRaw,
      reasoning: buildFreeReason(x.f, x.h, x.a, x.model, x.side)
    }));

    const payload = {
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf, minOdds, strictOnly },
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
    console.error('free-picks error', e.message);
    res.status(500).json({ error:'failed_to_load_picks', detail:e.message });
  }
});

/* ======================= ADDED: League ID helpers ======================= */

// Single-date leagues list for Free pool
app.get('/api/free-picks/leagues', async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });
    const date = req.query.date || todayYMD();
    const fixtures = await fetchAllEuropeFixturesFast(date);

    const pool = fixtures.filter(f => {
      const c = f.league?.country, id = f.league?.id, t = (f.league?.type || '').toLowerCase();
      if (isYouthFixture(f)) return false;
      if (UEFA_IDS.has(id)) return false;
      if (!EURO_COUNTRIES.has(c)) return false;
      if (t !== 'league') return false;
      if (ALLOWED_SET.has(id)) return false;
      return true;
    });

    const leagues = Array.from(
      new Map(pool.map(f => [f.league.id, {
        id: f.league.id,
        name: f.league.name,
        country: f.league.country,
        type: f.league.type
      }])).values()
    ).sort((a,b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

    res.json({ date, count: leagues.length, leagues });
  } catch (e) {
    console.error('free-picks/leagues error', e);
    res.status(500).json({ error: 'leagues_failed', detail: e?.message || String(e) });
  }
});

// Date-range scan → paste-ready competitions.js snippet with numeric IDs
app.get('/api/free-picks/scan-leagues', async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    const ymd = (d) => d.toISOString().slice(0,10);
    let dates = [];

    if (req.query.from && req.query.to) {
      const start = new Date(req.query.from + 'T00:00:00Z');
      const end   = new Date(req.query.to   + 'T00:00:00Z');
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate()+1)) dates.push(ymd(d));
    } else {
      const days = Math.max(1, Math.min(90, parseInt(req.query.days || '14', 10)));
      const end = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
        dates.push(ymd(d));
      }
    }

    const leagues = new Map(); // id -> {id,name,country,type,fixtures}
    for (const date of dates) {
      const fixtures = await fetchAllEuropeFixturesFast(date);
      for (const f of fixtures) {
        const c = f.league?.country, id = f.league?.id, t = (f.league?.type || '').toLowerCase();
        if (!id || !c) continue;
        if (isYouthFixture(f)) continue;
        if (!EURO_COUNTRIES.has(c)) continue;
        if (UEFA_IDS.has(id)) continue;
        if (t !== 'league') continue;
        if (ALLOWED_SET.has(id)) continue; // Pro pool excluded
        if (!leagues.has(id)) {
          leagues.set(id, { id, name: f.league.name || '', country: c, type: f.league.type || '', fixtures: 0 });
        }
        leagues.get(id).fixtures += 1;
      }
      await new Promise(r => setTimeout(r, 100)); // gentle on rate limit
    }

    const list = Array.from(leagues.values())
      .sort((a,b) => (b.fixtures - a.fixtures) || a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '150', 10)));
    const top = list.slice(0, limit);

    const competitionsJs = `
/**
 * Curated Free Picks leagues — numeric API-Football league IDs.
 * Generated ${new Date().toISOString()}
 */
const FREE_PICKS_COMP_IDS = new Set([
  ${top.map(x => x.id).join(', ')}
]);
module.exports = { FREE_PICKS_COMP_IDS };
`.trim();

    res.json({
      scannedDates: { from: dates[0], to: dates[dates.length-1], count: dates.length },
      totals: { leagues: list.length, fixtures: list.reduce((s,x)=>s+x.fixtures,0) },
      leagues: list,
      snippetCount: top.length,
      competitionsJs
    });
  } catch (e) {
    console.error('scan-leagues error', e);
    res.status(500).json({ error: 'scan_failed', detail: e?.message || String(e) });
  }
});

/* ===================== END ADDED HELPERS ===================== */

// ---------------- Pro Board + Hero ----------------
const THRESH_OU      = Number(process.env.THRESH_OU      || 0.58);
const THRESH_BTTS    = Number(process.env.THRESH_BTTS    || 0.57);
const THRESH_1X2     = Number(process.env.THRESH_1X2     || 0.60);
const PRIOR_CARDS_AVG= Number(process.env.PRIOR_CARDS_AVG|| 4.6);
const CARDS_OU_LINE  = Number(process.env.CARDS_OU_LINE  || 4.5);
const CORNERS_OU_LINE= Number(process.env.CORNERS_OU_LINE|| 9.5);
const CORNERS_BASE   = Number(process.env.CORNERS_BASE   || 8.5);
const CORNERS_PACE_K = Number(process.env.CORNERS_PACE_K || 0.60);
function logistic(p, k=1.2){ return 1/(1+Math.exp(-k*p)); }

function pickFromModelForFixture(f, h, a, m){
  const out=[];
  const sOver = scoreOver25(h,a,null), sUnder = scoreUnder25(h,a,null);
  let side = 'Over 2.5', raw = sOver.confidence;
  if (sUnder.confidence > sOver.confidence){ side='Under 2.5'; raw = sUnder.confidence; }
  const cal = calibrate('OU25', /under/i.test(side)? 'Under':'Over', raw);
  if ((cal/100) >= THRESH_OU){
    out.push({ market:'OU25', selection: side, confidenceRaw: asPct(raw), confidence: asPct(cal),
      probability: cal/100, reason:`ExpG ${m.expGoals.toFixed(2)} (λH ${m.lambdaHome.toFixed(2)} | λA ${m.lambdaAway.toFixed(2)})` });
  }
  const pBTTS = m.pBTTS, sideB = (pBTTS>=0.5)?'Yes':'No', cBraw = Math.round(50+Math.abs(pBTTS-0.5)*80);
  const cBcal = calibrate('BTTS', sideB, cBraw);
  if ((cBcal/100) >= THRESH_BTTS){
    out.push({ market:'BTTS', selection: sideB, confidenceRaw: asPct(cBraw), confidence: asPct(cBcal),
      probability: sideB==='Yes'? pBTTS : (1-pBTTS), reason:`BTTS model ${Math.round(pBTTS*100)}%` });
  }
  const side1 = (m.pH >= m.pA) ? 'Home':'Away', p1 = side1==='Home'? m.pH : m.pA;
  const c1raw = Math.round(50+Math.abs(p1-0.5)*80), c1cal = calibrate('ONE_X_TWO', side1, c1raw);
  if ((c1cal/100) >= THRESH_1X2){
    out.push({ market:'ONE_X_TWO', selection: side1, confidenceRaw: asPct(c1raw), confidence: asPct(c1cal),
      probability: p1, reason:`1X2 H ${Math.round(m.pH*100)} / D ${Math.round(m.pD*100)} / A ${Math.round(m.pA*100)}` });
  }
  // cards / corners heuristics for UI chips
  const cardsAvg = ((h.cardsAvg || PRIOR_CARDS_AVG/2)+(a.cardsAvg || PRIOR_CARDS_AVG/2))/2;
  const pCardsOver = logistic(cardsAvg - CARDS_OU_LINE, 1.4);
  const pace = h.avgGF+h.avgGA + a.avgGF+a.avgGA;
  const cornersEst = CORNERS_BASE + CORNERS_PACE_K * (pace - PRIOR_EXP_GOALS);
  const pCornersOver = logistic(cornersEst - CORNERS_OU_LINE, 1.2);
  out.push({ market:'CARDS',   selection: pCardsOver>=0.5?`Over ${CARDS_OU_LINE}`:`Under ${CARDS_OU_LINE}`,
    confidenceRaw: asPct(50 + Math.abs(pCardsOver-0.5)*90), confidence: asPct(50 + Math.abs(pCardsOver-0.5)*90) });
  out.push({ market:'CORNERS', selection: pCornersOver>=0.5?`Over ${CORNERS_OU_LINE}`:`Under ${CORNERS_OU_LINE}`,
    confidenceRaw: asPct(50 + Math.abs(pCornersOver-0.5)*85), confidence: asPct(50 + Math.abs(pCornersOver-0.5)*85) });
  return out;
}

app.get('/api/pro-board', requireAuth, requirePro, async (req,res)=>{
  try {
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });
    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const fixtures = (await fetchAllEuropeFixturesFast(date)).filter(f => inProScope(f) && allowedFixture(f));

    const items=[];
    for (const f of fixtures){
      try{
        const L=f.league?.id, hId=f.teams?.home?.id, aId=f.teams?.away?.id;
        if (!L||!hId||!aId) continue;
        const [h,a] = await Promise.all([
          getTeamStatsBlended(L, season, hId),
          getTeamStatsBlended(L, season, aId)
        ]);
        if (!h||!a) continue;
        const m = estimateLambdasFromTeamStats(h,a);
        const picks = pickFromModelForFixture(f,h,a,m).sort((x,y)=> y.confidence - x.confidence);
        const topBets = picks.map(p=>{
          let market = p.market, pick = p.selection;
          if (market==='OU25') market='Goals Over/Under';
          if (market==='ONE_X_TWO'){ market='1X2'; pick = (pick==='Home'?'1':'2'); }
          if (market==='BTTS') market='BTTS';
          if (market==='CARDS') market='Cards Over/Under';
          if (market==='CORNERS') market='Corners Over/Under';
          return { market, pick, confidence: p.confidence };
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
      }catch(e){ console.log('pro row', f?.fixture?.id, e.message); }
    }

    items.sort((a,b)=>{
      const ac=a.topBets?.[0]?.confidence||0, bc=b.topBets?.[0]?.confidence||0;
      if (bc!==ac) return bc-ac;
      return new Date(a.kickoff) - new Date(b.kickoff);
    });

    res.json({ dateUsed: date, items, totals:{ fixtures: fixtures.length, rows: items.length }, computedAt: new Date().toISOString() });
  } catch (e) {
    console.error('pro-board error', e.message);
    res.status(500).json({ error:'failed_to_load_pro_board', detail:e.message });
  }
});

async function selectHero(date){
  const season = seasonFromDate(date);
  const fixtures = (await fetchAllEuropeFixturesFast(date)).filter(f=> inProScope(f) && HERO_TIER1_SET.has(f.league?.id));
  let best=null;
  for (const f of fixtures){
    try{
      const L=f.league?.id, hId=f.teams?.home?.id, aId=f.teams?.away?.id;
      if (!L||!hId||!aId) continue;
      const [h,a] = await Promise.all([
        getTeamStatsBlended(L, season, hId),
        getTeamStatsBlended(L, season, aId)
      ]);
      if (!h||!a) continue;
      const m = estimateLambdasFromTeamStats(h,a);
      const sOver = scoreOver25(h,a,null), sUnder = scoreUnder25(h,a,null);
      const ouSide = (sOver.confidence >= sUnder.confidence) ? 'Over 2.5' : 'Under 2.5';
      const ouRaw  = Math.max(sOver.confidence, sUnder.confidence);
      const ouCal  = calibrate('OU25', /under/i.test(ouSide)?'Under':'Over', ouRaw);
      const side1  = (m.pH >= m.pA)? 'Home':'Away';
      const p1     = side1==='Home'? m.pH : m.pA;
      const c1raw  = Math.round(50+Math.abs(p1-0.5)*80);
      const c1cal  = calibrate('ONE_X_TWO', side1, c1raw);
      const sideB  = (m.pBTTS>=0.5)?'Yes':'No';
      const cBraw  = Math.round(50+Math.abs(m.pBTTS-0.5)*80);
      const cBcal  = calibrate('BTTS', sideB, cBraw);

      const candidates = [
        { market:'OU25',    selection: ouSide, confidence: ouCal, raw: ouRaw },
        { market:'ONE_X_TWO', selection: side1, confidence: c1cal, raw: c1raw },
        { market:'BTTS',    selection: sideB, confidence: cBcal, raw: cBraw }
      ].sort((a,b)=> b.confidence - a.confidence);

      const top = candidates[0];
      let marketLabel = top.market, prediction = top.selection;
      if (top.market==='OU25') marketLabel='Over/Under 2.5 Goals';
      if (top.market==='ONE_X_TWO'){ marketLabel='1X2'; prediction = (prediction==='Home'?'1':'2'); }

      const hero = {
        match: `${f.teams.home.name} vs ${f.teams.away.name}`,
        league: f.league.name,
        kickoff: f.fixture.date,
        market: marketLabel,
        prediction,
        confidence: asPct(top.confidence),
        confidenceRaw: asPct(top.raw),
        reasoning: `ExpG ${m.expGoals.toFixed(2)} (λH ${m.lambdaHome.toFixed(2)} | λA ${m.lambdaAway.toFixed(2)})`
      };
      if (!best || hero.confidence > best.confidence) best = hero;
    }catch(e){ console.log('hero err', f?.fixture?.id, e.message); }
  }
  return best;
}

app.get('/api/pro-pick', requireAuth, requirePro, async (req,res)=>{
  if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });
  const date = req.query.date || todayYMD();
  const hero = await selectHero(date);
  if (!hero) return res.status(404).json({ error:'no_hero_pick', date });
  res.json(hero);
});

app.get('/api/hero-bet', requireAuth, requirePro, async (req,res)=>{
  if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });
  const date = req.query.date || todayYMD();
  const hero = await selectHero(date);
  if (!hero) return res.status(404).json({ error:'no_hero_pick', date });
  res.json({ dateUsed: date, hero, computedAt: new Date().toISOString() });
});

// ---------------- Calibration read ----------------
app.get('/api/calibration', async (_req,res)=>{
  try { await ensureDataFiles(); const cal = await loadJSON(CAL_FILE, defaultCalibration()); res.json(cal); }
  catch(e){ res.status(500).json({ error:'calibration_read_failed', detail:e.message }); }
});

// ---------------- Stripe checkout (optional) ----------------
app.post('/api/stripe/create-checkout-session', requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(501).json({ error: 'stripe_not_configured' });
    const { priceId, successUrl, cancelUrl, mode='subscription' } = req.body || {};
    if (!priceId || !successUrl || !cancelUrl) return res.status(400).json({ error: 'missing_params' });

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: req.user?.email || undefined,
      metadata: { firebaseUID: req.user?.uid || '' },
      subscription_data: { metadata: { firebaseUID: req.user?.uid || '' } }
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: 'stripe_error', detail: e.message });
  }
});

// ---------------- Local static hosting (dev only) ----------------
if (require.main === module) {
  const STATIC_DIR = path.join(__dirname, '..', 'overedge-web');
  app.use(express.static(STATIC_DIR));
  app.get('/', (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
  app.get(/^(?!\/api\/).+/, (_req,res)=> res.sendFile(path.join(STATIC_DIR, 'index.html')));
}

// Export for Vercel serverless handler
module.exports = app;

// Local run
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  (async () => { try { await ensureDataFiles(); CAL = await loadJSON(CAL_FILE, defaultCalibration()); await loadDailyCacheIntoMap(); } catch {} })();
  app.listen(PORT, ()=> console.log(`🟢 http://localhost:${PORT}`));
}
