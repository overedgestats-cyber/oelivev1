// /api/rpc.js
// One endpoint, multiple actions via ?action=...
// Actions: health, public-config, free-picks, pro-pick, pro-board, verify-sub

const API_BASE = "https://v3.football.api-sports.io";

// ---------- Helpers ----------
function ymd(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}
function pct(n) {
  return Math.round(Math.max(1, Math.min(99, n * 100)));
}
function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.append(k, v);
  });
  return u.toString();
}
async function apiGet(path, params = {}) {
  const url = `${API_BASE}${path}?${qs(params)}`;
  const resp = await fetch(url, {
    headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY || "" },
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`API ${path} ${resp.status}`);
  const data = await resp.json();
  return data.response || [];
}

function clockFromISO(iso) {
  try {
    const d = new Date(iso);
    return d.toISOString().substring(11, 16); // HH:MM
  } catch {
    return "";
  }
}

// recent-form aggregation (last N)
async function teamLastN(teamId, n = 12) {
  const rows = await apiGet("/fixtures", { team: teamId, last: n });
  let gp = 0, goalsFor = 0, goalsAg = 0, over25 = 0, under25 = 0, btts = 0;

  for (const r of rows) {
    const gh = r?.goals?.home ?? 0;
    const ga = r?.goals?.away ?? 0;
    const total = gh + ga;

    const isHome = r?.teams?.home?.id === teamId;
    const tf = isHome ? gh : ga;
    const ta = isHome ? ga : gh;

    gp += 1;
    goalsFor += tf;
    goalsAg += ta;
    if (total >= 3) over25 += 1;
    if (total <= 2) under25 += 1;
    if (gh > 0 && ga > 0) btts += 1;
  }

  const avgFor = gp ? goalsFor / gp : 0;
  const avgAg = gp ? goalsAg / gp : 0;

  return {
    games: gp,
    avgFor,
    avgAg,
    over25Rate: gp ? over25 / gp : 0,
    under25Rate: gp ? under25 / gp : 0,
    bttsRate: gp ? btts / gp : 0,
  };
}

function reasoningOU(h, a, market) {
  if (market === "Over 2.5") {
    return `High-scoring trends: Home O2.5 ${pct(h.over25Rate)}%, Away O2.5 ${pct(a.over25Rate)}%. Avg GF (H) ${h.avgFor.toFixed(2)} vs (A) ${a.avgFor.toFixed(2)}.`;
  }
  return `Low-scoring trends: Home U2.5 ${pct(h.under25Rate)}%, Away U2.5 ${pct(a.under25Rate)}%. Avg GA (H) ${h.avgAg.toFixed(2)} vs (A) ${a.avgAg.toFixed(2)}.`;
}
function reasoningBTTS(h, a) {
  return `BTTS form: Home ${pct(h.bttsRate)}% & Away ${pct(a.bttsRate)}%. Attack outputs (GF): H ${h.avgFor.toFixed(2)} / A ${a.avgFor.toFixed(2)}.`;
}
function impliedProbs1x2(odds) {
  const { homeWin, draw, awayWin } = odds || {};
  if (!homeWin || !draw || !awayWin) return null;
  const invH = 1 / homeWin, invD = 1 / draw, invA = 1 / awayWin;
  const sum = invH + invD + invA;
  return { ph: invH / sum, pd: invD / sum, pa: invA / sum };
}

// Odds helper — OU 2.5, BTTS, 1X2
async function getOddsMap(fixtureId) {
  try {
    const rows = await apiGet("/odds", { fixture: fixtureId });
    const out = {
      over25: null, under25: null, bttsYes: null, bttsNo: null,
      homeWin: null, draw: null, awayWin: null, bookmaker: null,
    };
    const bms = rows?.[0]?.bookmakers || [];
    for (const b of bms) {
      for (const bet of b?.bets || []) {
        const name = (bet?.name || "").toLowerCase();
        if (name.includes("over/under") || name.includes("goals over/under")) {
          for (const v of bet.values || []) {
            const val = (v?.value || "").toLowerCase();
            if (val.includes("over 2.5")) out.over25 = Number(v.odd);
            if (val.includes("under 2.5")) out.under25 = Number(v.odd);
          }
          if (!out.bookmaker) out.bookmaker = b.name;
        }
        if (name.includes("both teams to score")) {
          for (const v of bet.values || []) {
            const val = (v?.value || "").toLowerCase();
            if (val === "yes") out.bttsYes = Number(v.odd);
            if (val === "no") out.bttsNo = Number(v.odd);
          }
          if (!out.bookmaker) out.bookmaker = b.name;
        }
        if (name.includes("match winner") || name.includes("1x2")) {
          for (const v of bet.values || []) {
            const val = (v?.value || "").toLowerCase();
            if (val === "home" || val === "1") out.homeWin = Number(v.odd);
            if (val === "draw" || val === "x") out.draw = Number(v.odd);
            if (val === "away" || val === "2") out.awayWin = Number(v.odd);
          }
          if (!out.bookmaker) out.bookmaker = b.name;
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ---------- DEV allowlist (bypass Stripe) ----------
function getDevAllowlist() {
  const raw = process.env.OE_DEV_EMAILS || "";
  return raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function isDevEmail(email) {
  return getDevAllowlist().includes(String(email || "").toLowerCase());
}

// ---------- Competition filters ----------
const TOP5 = ["England", "Spain", "Italy", "Germany", "France"];
const CUP_TOKENS = [
  "cup","fa cup","copa","coppa","coupe","pokal","taça","taca","kup","kupa","cupa","knvb","dfb","scottish cup"
];
const TIER1_PATTERNS = [
  /premier/i, /la\s?liga(?!\s?2)/i, /serie\s?a/i, /bundesliga(?!.*2)/i, /ligue\s?1/i
];
const TIER2_PATTERNS = [
  /championship/i, /la\s?liga\s?2/i, /serie\s?b/i, /bundesliga\s?2/i, /2\.\s?bundesliga/i, /ligue\s?2/i
];
const UEFA_TOKENS = ["uefa","champions","europa","conference","nations league","euro"];
const FIFA_TOKENS = ["fifa","world cup","world cup qualification","wc qualification","world cup qualifiers","friendlies","friendly"];

// Youth exclusion
const YOUTH_REGEXES = [
  /\bu-?\s?(14|15|16|17|18|19|20|21|22|23)\b/i,
  /\bu(?:14|15|16|17|18|19|20|21|22|23)\b/i,
  /\byouth\b/i, /\bprimavera\b/i, /\bjunioren\b/i, /\bsub-?\s?(20|21)\b/i, /\bacademy\b/i
];
function isYouthFixture(fx = {}) {
  const ln = fx.league?.name || "";
  const h  = fx.teams?.home?.name || "";
  const a  = fx.teams?.away?.name || "";
  const hit = (s) => YOUTH_REGEXES.some(rx => rx.test(String(s)));
  return hit(ln) || hit(h) || hit(a);
}
function hasToken(name = "", tokens = []) {
  const s = (name || "").toLowerCase();
  return tokens.some(t => s.includes(t));
}
function matchAny(rxList, name = "") { return rxList.some(rx => rx.test(name || "")); }
function isUEFAComp(league = {}) {
  const name = (league?.name || "").toLowerCase();
  const country = league?.country || "";
  return country === "World" || country === "Europe" || hasToken(name, UEFA_TOKENS);
}
function isFIFAComp(league = {}) {
  const name = (league?.name || "").toLowerCase();
  const country = league?.country || "";
  return country === "World" || hasToken(name, FIFA_TOKENS);
}
function isTop5Tier12OrCup(league = {}) {
  const country = league?.country || "";
  const name = league?.name || "";
  if (!TOP5.includes(country)) return false;
  if (matchAny(TIER1_PATTERNS, name)) return true;
  if (matchAny(TIER2_PATTERNS, name)) return true;
  if (hasToken(name, CUP_TOKENS)) return true;
  if (/\b(iii|3\.?\s?liga|liga 3|regionalliga|oberliga|reserves?)\b/i.test(name)) return false;
  return false;
}
function inHeroScope(league = {}) {
  // Top5 tier1/2 or their cups, plus UEFA/FIFA
  return isTop5Tier12OrCup(league) || isUEFAComp(league) || isFIFAComp(league);
}

// ---------- Persistent daily cache (Vercel KV or Upstash Redis) + in-memory fallback ----------
let FREEPICKS_CACHE = new Map(); // fallback
function cacheKeyFP(date, tz, minConf) { return `fp|${date}|${tz}|${minConf}`; }
function cacheKeyHB(date, tz) { return `hb|${date}|${tz}`; }
function cacheKeyPB(date, tz) { return `pb|${date}|${tz}`; }

let _store = null;
async function getStore() {
  if (_store) return _store;

  // 1) Vercel KV
  try {
    const { kv } = await import("@vercel/kv");
    _store = {
      get: (k) => kv.get(k),
      set: (k, v, ttlSec) => kv.set(k, v, { ex: ttlSec }),
      del: (k) => kv.del(k),
    };
    return _store;
  } catch {}

  // 2) Upstash Redis
  try {
    const { Redis } = await import("@upstash/redis");
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (url && token) {
      const redis = new Redis({ url, token });
      _store = {
        get: (k) => redis.get(k),
        set: (k, v, ttlSec) => redis.set(k, v, { ex: ttlSec }),
        del: (k) => redis.del(k),
      };
      return _store;
    }
  } catch {}

  _store = null;
  return null;
}
async function kvGet(key) {
  const s = await getStore();
  if (!s) {
    const e = FREEPICKS_CACHE.get(key);
    if (e && e.exp > Date.now()) return e.payload;
    if (e) FREEPICKS_CACHE.delete(key);
    return null;
  }
  try { return await s.get(key); } catch { return null; }
}
async function kvSet(key, value, ttlSec) {
  const s = await getStore();
  if (!s) {
    FREEPICKS_CACHE.set(key, { payload: value, exp: Date.now() + ttlSec * 1000 });
    return true;
  }
  try { await s.set(key, value, ttlSec); return true; } catch { return false; }
}
async function kvDel(key) {
  const s = await getStore();
  if (!s) { FREEPICKS_CACHE.delete(key); return true; }
  try { await s.del(key); return true; } catch { return false; }
}

// ---------- Free Picks (OU 2.5; EU 1st/2nd + cups + UEFA; youth excluded) ----------
async function scoreFixtureForOU25(fx) {
  const homeId = fx?.teams?.home?.id;
  const awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return null;

  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;

  const market = overP >= underP ? "Over 2.5" : "Under 2.5";
  const conf = overP >= underP ? overP : underP;

  const time = clockFromISO(fx?.fixture?.date);
  const leagueName = fx?.league?.name || "";
  const leagueCountry = fx?.league?.country || "";
  const odds = await getOddsMap(fx?.fixture?.id);

  return {
    fixtureId: fx?.fixture?.id,
    league: leagueName,
    country: leagueCountry,
    leagueRound: fx?.league?.round || "",
    matchTime: time,
    home: fx?.teams?.home?.name,
    away: fx?.teams?.away?.name,
    market,
    confidencePct: pct(conf),
    odds: odds ? odds[market === "Over 2.5" ? "over25" : "under25"] : null,
    reasoning: reasoningOU(home, away, market),
  };
}

async function pickFreePicks({ date, tz, minConf = 75 }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  // broader European coverage you had before
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league));

  const out = [];
  for (const fx of fixtures.slice(0, 50)) {
    try {
      const s = await scoreFixtureForOU25(fx);
      if (s && s.confidencePct >= minConf) out.push(s);
    } catch {}
  }
  out.sort((a, b) => (b.confidencePct - a.confidencePct) || ((a.fixtureId || 0) - (b.fixtureId || 0)));
  const picks = out.slice(0, 2);
  return { date, timezone: tz, picks };
}

// ---------- Hero Bet (exactly one OU 2.5 from Top5 tier1/2 + cups + UEFA/FIFA; youth excluded) ----------
async function pickHeroBet({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => inHeroScope(fx.league));

  const candidates = [];
  for (const fx of fixtures.slice(0, 80)) {
    try {
      const s = await scoreFixtureForOU25(fx);
      if (s) candidates.push(s);
    } catch {}
  }
  if (candidates.length === 0) return { heroBet: null, note: "No qualifying OU 2.5 match found in scope." };

  // Highest confidence wins; tie-break by fixtureId
  candidates.sort((a, b) => (b.confidencePct - a.confidencePct) || ((a.fixtureId || 0) - (b.fixtureId || 0)));
  return { heroBet: candidates[0] };
}

// ---------- Pro Board (same scope as Hero Bet; per-fixture markets + best pick) ----------
async function scoreMarketsForFixture(fx) {
  const homeId = fx?.teams?.home?.id;
  const awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return null;

  const [home, away, odds] = await Promise.all([
    teamLastN(homeId),
    teamLastN(awayId),
    getOddsMap(fx?.fixture?.id)
  ]);

  // OU 2.5
  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const ouRec = overP >= underP ? "Over 2.5" : "Under 2.5";
  const ouConf = overP >= underP ? overP : underP;

  // BTTS
  const bttsP = home.bttsRate * 0.5 + away.bttsRate * 0.5;
  const bttsRec = bttsP >= 0.5 ? "Yes" : "No";
  const bttsConf = Math.max(bttsP, 1 - bttsP);

  // 1X2 from odds (if present)
  let oneRec = null, oneConf = null, oneExplain = null;
  const probs = impliedProbs1x2(odds);
  if (probs) {
    const arr = [
      { k: "Home", v: probs.ph },
      { k: "Draw", v: probs.pd },
      { k: "Away", v: probs.pa },
    ].sort((a, b) => b.v - a.v);
    oneRec = arr[0].k;
    oneConf = arr[0].v;
    oneExplain = `Market-implied probs: H ${pct(probs.ph)}% / D ${pct(probs.pd)}% / A ${pct(probs.pa)}%.`;
  }

  const markets = {
    ou25: {
      recommendation: ouRec,
      confidencePct: pct(ouConf),
      odds: ouRec === "Over 2.5" ? (odds?.over25 ?? null) : (odds?.under25 ?? null),
      reasoning: reasoningOU(home, away, ouRec)
    },
    btts: {
      recommendation: `BTTS: ${bttsRec}`,
      confidencePct: pct(bttsConf),
      odds: bttsRec === "Yes" ? (odds?.bttsYes ?? null) : (odds?.bttsNo ?? null),
      reasoning: reasoningBTTS(home, away)
    },
    onex2: {
      recommendation: oneRec,
      confidencePct: oneConf != null ? pct(oneConf) : null,
      odds: { home: odds?.homeWin ?? null, draw: odds?.draw ?? null, away: odds?.awayWin ?? null },
      reasoning: oneExplain || "Insufficient odds to derive probabilities."
    },
    cards: { comingSoon: true },
    corners: { comingSoon: true }
  };

  // Choose best by confidence among available (ou25, btts, onex2 with conf)
  const options = [
    { market: "ou25", conf: markets.ou25.confidencePct, rec: markets.ou25.recommendation },
    { market: "btts", conf: markets.btts.confidencePct, rec: markets.btts.recommendation },
  ];
  if (markets.onex2.confidencePct != null) options.push({ market: "onex2", conf: markets.onex2.confidencePct, rec: markets.onex2.recommendation });
  options.sort((a, b) => (b.conf - a.conf));

  const best = options[0];

  return {
    fixtureId: fx?.fixture?.id,
    leagueId: fx?.league?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    matchTime: clockFromISO(fx?.fixture?.date),
    home: fx?.teams?.home?.name,
    away: fx?.teams?.away?.name,
    markets,
    best
  };
}

async function pickProBoard({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => inHeroScope(fx.league)); // same scope as Hero Bet

  const items = [];
  for (const fx of fixtures.slice(0, 120)) {
    try {
      const scored = await scoreMarketsForFixture(fx);
      if (scored) items.push(scored);
    } catch {}
  }
  // group by competition
  const groups = {};
  for (const it of items) {
    const key = `${it.country} — ${it.league}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }
  // sort inside each group by time
  Object.values(groups).forEach(arr => arr.sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || "")));
  return { date, timezone: tz, groups };
}

// ---------- Stripe verify by email (with DEV bypass) ----------
async function verifyStripeByEmail(email) {
  const key = process.env.STRIPE_SECRET || "";
  if (!key) throw new Error("Missing STRIPE_SECRET");

  const custResp = await fetch(`https://api.stripe.com/v1/customers?${qs({ email, limit: 3 })}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!custResp.ok) throw new Error(`Stripe customers ${custResp.status}`);
  const custData = await custResp.json();
  const customers = custData?.data || [];
  if (customers.length === 0) return { pro: false, plan: null, status: "none" };

  let best = null;
  for (const c of customers) {
    const subResp = await fetch(
      `https://api.stripe.com/v1/subscriptions?${qs({ customer: c.id, status: "all", limit: 10 })}`,
      { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!subResp.ok) continue;
    const subData = await subResp.json();
    for (const s of subData?.data || []) {
      if (!best || (s.created || 0) > (best.created || 0)) best = s;
    }
  }

  if (!best) return { pro: false, plan: null, status: "none" };
  const activeStatuses = new Set(["active", "trialing"]);
  const isPro = activeStatuses.has(best.status);

  const item = best.items?.data?.[0];
  const price = item?.price || {};
  const nickname = price.nickname || null;
  const interval = price.recurring?.interval || null;
  const amount = typeof price.unit_amount === "number" ? (price.unit_amount / 100).toFixed(2) : null;
  const currency = price.currency ? price.currency.toUpperCase() : null;

  const plan =
    nickname || (interval ? `${interval}${amount ? ` ${amount} ${currency}` : ""}` : price.id || null);

  return { pro: isPro, plan, status: best.status };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const { action = "health" } = req.query;

    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    if (action === "public-config") {
      return res.status(200).json({
        firebase: {
          apiKey: process.env.FB_API_KEY || "",
          authDomain: process.env.FB_AUTH_DOMAIN || "",
          projectId: process.env.FB_PROJECT_ID || "",
          appId: process.env.FB_APP_ID || "",
          measurementId: process.env.FB_MEASUREMENT_ID || "",
        },
      });
    }

    if (action === "free-picks") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());

      const key = cacheKeyFP(date, tz, minConf);
      if (!refresh) {
        const cached = await kvGet(key);
        if (cached) return res.status(200).json(cached);
      }
      const payload = await pickFreePicks({ date, tz, minConf });
      await kvSet(key, payload, 22 * 60 * 60);
      return res.status(200).json(payload);
    }

    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());

      const key = cacheKeyHB(date, tz);
      if (!refresh) {
        const cached = await kvGet(key);
        if (cached) return res.status(200).json(cached);
      }
      const payload = await pickHeroBet({ date, tz });
      await kvSet(key, payload, 22 * 60 * 60);
      return res.status(200).json(payload);
    }

    if (action === "pro-board") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());

      const key = cacheKeyPB(date, tz);
      if (!refresh) {
        const cached = await kvGet(key);
        if (cached) return res.status(200).json(cached);
      }
      const payload = await pickProBoard({ date, tz });
      await kvSet(key, payload, 22 * 60 * 60);
      return res.status(200).json(payload);
    }

    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      // DEV bypass
      if (isDevEmail(email)) {
        return res.status(200).json({ pro: true, plan: "DEV", status: "active-dev" });
      }

      try {
        const result = await verifyStripeByEmail(email);
        return res.status(200).json(result);
      } catch (e) {
        console.error("verify-sub error:", e.message);
        return res.status(500).json({ error: "Stripe verification failed" });
      }
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* ---------- Legacy helper you referenced earlier (kept for Free Picks scope) ---------- */
const EURO_COUNTRIES = [
  "England","Scotland","Wales","Northern Ireland","Ireland",
  "Spain","Italy","Germany","France","Portugal","Netherlands","Belgium",
  "Turkey","Greece","Austria","Switzerland","Denmark","Norway","Sweden",
  "Poland","Czech Republic","Slovakia","Slovenia","Croatia","Serbia",
  "Romania","Bulgaria","Hungary","Bosnia and Herzegovina","North Macedonia",
  "Albania","Kosovo","Montenegro","Moldova","Ukraine","Belarus",
  "Finland","Iceland","Estonia","Latvia","Lithuania",
  "Luxembourg","Malta","Cyprus","Georgia","Armenia","Azerbaijan",
  "Faroe Islands","Andorra","San Marino","Gibraltar"
];
const DENY_TIER_TOKENS = [
  "oberliga","regionalliga","3. liga","iii liga","liga 3","third division",
  "liga 4","fourth","fifth","amateur","county","ykkönen","2. divisjon avd",
  "reserve","reserves"," ii"," b team"," b-team"," b-team"
];
const TIER1_PATTERNS_EU = [
  /premier/i, /super\s?lig(?![ae])/i, /super\s?league(?!\s?2)/i,
  /bundesliga(?!.*2)/i, /la\s?liga(?!\s?2)/i, /serie\s?a/i, /ligue\s?1/i,
  /eredivisie/i, /ekstraklasa/i, /allsvenskan/i, /eliteserien/i,
  /superliga(?!\s?2)/i, /pro\s?league/i, /hnl/i
];
const TIER2_PATTERNS_EU = [
  /championship/i, /2\.\s?bundesliga/i, /bundesliga\s?2/i, /la\s?liga\s?2/i,
  /segunda/i, /segund/i, /serie\s?b/i, /ligue\s?2/i, /eerste\s?divisie/i,
  /liga\s?portugal\s?2/i, /challenger\s?pro\s?league/i, /challenge\s?league/i,
  /1\.\s?lig/i, /2\.\s?liga/i, /superettan/i, /obos/i, /i\s?liga(?!\s?2)/i,
  /prva\s?liga/i, /super\s?league\s?2/i
];
function isEuroCountry(c = "") { return EURO_COUNTRIES.includes(c); }
function isCup(league = {}) {
  const type = (league?.type || "").toLowerCase();
  const name = league?.name || "";
  return type === "cup" || hasToken(name, CUP_TOKENS);
}
function isEuropeanTier12OrCup(league = {}) {
  const country = league?.country || "";
  const name = league?.name || "";
  if (hasToken(name, DENY_TIER_TOKENS)) return false;
  if (isUEFAComp(league)) return true;
  if (!isEuroCountry(country)) return false;
  if (isCup(league)) return true;
  if (matchAny(TIER1_PATTERNS_EU, name)) return true;
  if (matchAny(TIER2_PATTERNS_EU, name)) return true;
  return false;
}
