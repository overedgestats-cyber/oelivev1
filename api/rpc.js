// /api/rpc.js
// One endpoint, multiple actions via ?action=...
// Actions:
//  - health
//  - public-config
//  - free-picks
//  - pro-pick
//  - verify-sub
//  - register-ref
//  - attach-referral
//  - [optional analytics] ref-hit, ref-stats

const API_BASE = "https://v3.football.api-sports.io";

/* --------------------------- Generic Helpers --------------------------- */
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
    return new Date(iso).toISOString().substring(11, 16); // HH:MM
  } catch {
    return "";
  }
}

/* ---------------------- Upstash (Redis) helpers ----------------------- */
const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "";
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";

async function kvGet(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvSet(key, value, ttlSec = null) {
  if (!UP_URL || !UP_TOKEN) return null;
  let url = `${UP_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  if (ttlSec) url += `?EX=${ttlSec}`;
  const r = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvIncr(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/incr/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvDel(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}

/* -------- European scope (1st/2nd tiers + national cups + UEFA) ------- */
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
const CUP_TOKENS = [
  "cup","pokal","beker","taça","taca","kup","kupa","cupa","coppa",
  "copa","karik","knvb","dfb","scottish cup"
];
const DENY_TIER_TOKENS = [
  "oberliga","regionalliga","3. liga","iii liga","liga 3","third division",
  "liga 4","fourth","fifth","amateur","county","ykkönen","2. divisjon avd",
  "reserve","reserves"," ii"," b team"," b-team"," b-team"
];
const TIER1_PATTERNS = [
  /premier/i, /super\s?lig(?![ae])/i, /super\s?league(?!\s?2)/i,
  /bundesliga(?!.*2)/i, /la\s?liga(?!\s?2)/i, /serie\s?a/i, /ligue\s?1/i,
  /eredivisie/i, /ekstraklasa/i, /allsvenskan/i, /eliteserien/i,
  /superliga(?!\s?2)/i, /pro\s?league/i, /hnl/i
];
const TIER2_PATTERNS = [
  /championship/i, /2\.\s?bundesliga/i, /bundesliga\s?2/i, /la\s?liga\s?2/i,
  /segunda/i, /segund/i, /serie\s?b/i, /ligue\s?2/i, /eerste\s?divisie/i,
  /liga\s?portugal\s?2/i, /challenger\s?pro\s?league/i, /challenge\s?league/i,
  /1\.\s?lig/i, /2\.\s?liga/i, /superettan/i, /obos/i, /i\s?liga(?!\s?2)/i,
  /prva\s?liga/i, /super\s?league\s?2/i
];
function isEuroCountry(c = "") { return EURO_COUNTRIES.includes(c); }
function hasToken(name = "", tokens = []) {
  const s = (name || "").toLowerCase();
  return tokens.some(t => s.includes(t));
}
function matchAny(rxList, name = "") { return rxList.some(rx => rx.test(name || "")); }
function isCup(league = {}) {
  const type = (league?.type || "").toLowerCase();
  const name = league?.name || "";
  return type === "cup" || hasToken(name, CUP_TOKENS);
}
function isUEFAComp(league = {}) {
  const country = league?.country || "";
  const name = (league?.name || "").toLowerCase();
  return country === "World" || country === "Europe" || hasToken(name, ["uefa","champions","europa","conference"]);
}
function isEuropeanTier12OrCup(league = {}) {
  const country = league?.country || "";
  const name = league?.name || "";
  if (hasToken(name, DENY_TIER_TOKENS)) return false;
  if (isUEFAComp(league)) return true;
  if (!isEuroCountry(country)) return false;
  if (isCup(league)) return true;
  if (matchAny(TIER1_PATTERNS, name)) return true;
  if (matchAny(TIER2_PATTERNS, name)) return true;
  return false;
}

/* -------------------- Youth exclusion (Free Picks) -------------------- */
const YOUTH_REGEXES = [
  /\bu-?\s?(14|15|16|17|18|19|20|21|22|23)\b/i,
  /\bu(?:14|15|16|17|18|19|20|21|22|23)\b/i,
  /\byouth\b/i, /\bprimavera\b/i, /\bjunioren\b/i,
  /\bsub-?\s?(20|21)\b/i, /\bacademy\b/i
];
function isYouthFixture(fx = {}) {
  const ln = fx.league?.name || "";
  const h  = fx.teams?.home?.name || "";
  const a  = fx.teams?.away?.name || "";
  const hit = (s) => YOUTH_REGEXES.some(rx => rx.test(String(s)));
  return hit(ln) || hit(h) || hit(a);
}

/* -------------------- Team stats + odds utilities -------------------- */
async function teamLastN(teamId, n = 12) {
  const rows = await apiGet("/fixtures", { team: teamId, last: n });
  let gp = 0, goalsFor = 0, goalsAg = 0, over25 = 0, under25 = 0, btts = 0;
  for (const r of rows) {
    const gh = r?.goals?.home ?? 0, ga = r?.goals?.away ?? 0, total = gh + ga;
    const isHome = r?.teams?.home?.id === teamId;
    const tf = isHome ? gh : ga, ta = isHome ? ga : gh;
    gp += 1; goalsFor += tf; goalsAg += ta;
    if (total >= 3) over25 += 1;
    if (total <= 2) under25 += 1;
    if (gh > 0 && ga > 0) btts += 1;
  }
  return {
    games: gp,
    avgFor: gp ? goalsFor / gp : 0,
    avgAg: gp ? goalsAg / gp : 0,
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
        // Over/Under
        if (name.includes("over/under") || name.includes("goals over/under")) {
          for (const v of bet.values || []) {
            const val = (v?.value || "").toLowerCase();
            if (val.includes("over 2.5")) out.over25 = Number(v.odd);
            if (val.includes("under 2.5")) out.under25 = Number(v.odd);
          }
          if (!out.bookmaker) out.bookmaker = b.name;
        }
        // BTTS
        if (name.includes("both teams to score")) {
          for (const v of bet.values || []) {
            const val = (v?.value || "").toLowerCase();
            if (val === "yes") out.bttsYes = Number(v.odd);
            if (val === "no") out.bttsNo = Number(v.odd);
          }
          if (!out.bookmaker) out.bookmaker = b.name;
        }
        // 1X2
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
    return null; // Odds may be unavailable
  }
}

/* ------------------------ Free Picks (OU 2.5) ------------------------ */
async function scoreFixtureForOU25(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return null;
  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);

  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;

  const market = overP >= underP ? "Over 2.5" : "Under 2.5";
  const conf   = overP >= underP ? overP : underP;

  const time   = clockFromISO(fx?.fixture?.date);
  const odds   = await getOddsMap(fx?.fixture?.id);

  return {
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
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

// In-memory daily cache (sticky for the day unless refresh=1)
const FREEPICKS_CACHE = new Map(); // key -> { payload, exp }
function cacheKey(date, tz, minConf) { return `fp|${date}|${tz}|${minConf}`; }
function getCached(key) {
  const e = FREEPICKS_CACHE.get(key);
  if (e && e.exp > Date.now()) return e.payload;
  if (e) FREEPICKS_CACHE.delete(key);
  return null;
}
function putCached(key, payload) {
  const ttlMs = 22 * 60 * 60 * 1000; // ~22h
  FREEPICKS_CACHE.set(key, { payload, exp: Date.now() + ttlMs });
}

async function pickFreePicks({ date, tz, minConf = 75 }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));            // exclude youth
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league)); // scope

  const out = [];
  for (const fx of fixtures.slice(0, 50)) {
    try {
      const s = await scoreFixtureForOU25(fx);
      if (s && s.confidencePct >= minConf) out.push(s);
    } catch {}
  }

  // deterministic: highest confidence, then fixtureId asc
  out.sort((a, b) => (b.confidencePct - a.confidencePct) || ((a.fixtureId || 0) - (b.fixtureId || 0)));
  return { date, timezone: tz, picks: out.slice(0, 2) };
}

/* ------------------------- Hero Bet (value) -------------------------- */
async function scoreHeroCandidates(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return [];
  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const odds = await getOddsMap(fx?.fixture?.id);

  const time = clockFromISO(fx?.fixture?.date);
  const candidates = [];

  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const withinBand = (p) => p >= 0.62 && p <= 0.80;

  if (odds?.over25 && odds.over25 >= 2.0 && withinBand(overP)) {
    candidates.push({
      selection: "Over 2.5", market: "Over 2.5", conf: overP, odds: odds.over25,
      reasoning: reasoningOU(home, away, "Over 2.5")
    });
  }
  if (odds?.under25 && odds.under25 >= 2.0 && withinBand(underP)) {
    candidates.push({
      selection: "Under 2.5", market: "Under 2.5", conf: underP, odds: odds.under25,
      reasoning: reasoningOU(home, away, "Under 2.5")
    });
  }
  const bttsP = home.bttsRate * 0.5 + away.bttsRate * 0.5;
  if (odds?.bttsYes && odds.bttsYes >= 2.0 && withinBand(bttsP)) {
    candidates.push({
      selection: "BTTS: Yes", market: "BTTS", conf: bttsP, odds: odds.bttsYes,
      reasoning: reasoningBTTS(home, away)
    });
  }

  return candidates.map(c => ({
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    matchTime: time,
    home: fx?.teams?.home?.name || "",
    away: fx?.teams?.away?.name || "",
    selection: c.selection,
    market: c.market,
    confidencePct: pct(c.conf),
    odds: c.odds,
    valueScore: Number((c.conf * c.odds).toFixed(4)),
    reasoning: c.reasoning,
  }));
}
async function pickHeroBet({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league));
  let candidates = [];
  for (const fx of fixtures.slice(0, 50)) {
    try { candidates = candidates.concat(await scoreHeroCandidates(fx)); }
    catch {}
  }
  if (!candidates.length) return { heroBet: null, note: "No qualifying value pick found yet." };
  candidates.sort((a, b) => b.valueScore - a.valueScore);
  return { heroBet: candidates[0] };
}

/* ----------------- Stripe verify + Pro override merge ---------------- */
async function verifyStripeByEmail(email) {
  const key = process.env.STRIPE_SECRET || "";
  if (!key) throw new Error("Missing STRIPE_SECRET");

  const custResp = await fetch(`https://api.stripe.com/v1/customers?${qs({ email, limit: 3 })}`, {
    headers: { Authorization: `Bearer ${key}` }, cache: "no-store",
  });
  if (!custResp.ok) throw new Error(`Stripe customers ${custResp.status}`);
  const custData = await custResp.json();
  const customers = custData?.data || [];
  if (!customers.length) return { pro: false, plan: null, status: "none" };

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

  const item = best.items?.data?.[0] || {};
  const price = item.price || {};
  const nickname = price.nickname || null;
  const interval = price.recurring?.interval || null;
  const amount = typeof price.unit_amount === "number" ? (price.unit_amount / 100).toFixed(2) : null;
  const currency = price.currency ? price.currency.toUpperCase() : null;

  const plan = nickname || (interval ? `${interval}${amount ? ` ${amount} ${currency}` : ""}` : price.id || null);
  return { pro: isPro, plan, status: best.status };
}

async function getProOverride(email) {
  const v = await kvGet(`pro:override:${email}`);
  const sec = v && typeof v.result === "string" ? Number(v.result) : 0;
  return Number.isFinite(sec) ? sec : 0;
}

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req, res) {
  try {
    const { action = "health" } = req.query;

    /* -- health -- */
    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    /* -- public Firebase config -- */
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

    /* -- free picks -- */
    if (action === "free-picks") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());

      const key = cacheKey(date, tz, minConf);
      if (!refresh) {
        const cached = getCached(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickFreePicks({ date, tz, minConf });
      putCached(key, payload);
      return res.status(200).json(payload);
    }

    /* -- hero bet -- */
    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const payload = await pickHeroBet({ date, tz });
      return res.status(200).json(payload);
    }

    /* -- verify subscription (+ dev bypass + override) -- */
    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      // Dev bypass
      const devs = (process.env.OE_DEV_EMAILS || "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      if (devs.includes(email)) {
        return res.status(200).json({
          pro: true, plan: "DEV", status: "override", overrideUntil: "9999-12-31"
        });
      }

      let base = { pro: false, plan: null, status: "none" };
      try { base = await verifyStripeByEmail(email); } catch {}

      let overrideSec = 0;
      try { overrideSec = await getProOverride(email); } catch {}
      const nowSec = Math.floor(Date.now() / 1000);
      const hasOverride = overrideSec > nowSec;

      return res.status(200).json({
        pro: base.pro || hasOverride,
        plan: base.plan,
        status: base.pro ? base.status : (hasOverride ? "override" : base.status),
        overrideUntil: hasOverride ? new Date(overrideSec * 1000).toISOString() : null,
      });
    }

    /* --------------------- Referral endpoints --------------------- */

    // Register a user's referral code (call once after sign-in)
    if (action === "register-ref") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      const uid   = (req.query.uid || "").toString().trim();
      if (!email || !uid) return res.status(400).json({ ok: false, error: "missing email or uid" });
      const code = uid.slice(-10);
      await kvSet(`ref:code:${code}`, email);
      await kvSet(`ref:owner:${email}`, code);
      return res.status(200).json({ ok: true, code });
    }

    // Attach a referral to the friend before redirecting to Stripe
    if (action === "attach-referral") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      const code  = (req.query.code  || "").toString().trim();
      if (!email || !code) return res.status(400).json({ ok: false, error: "missing email or code" });
      // Store for 35 days; webhook will grant reward after first paid monthly invoice
      await kvSet(`ref:pending:${email}`, code, 35 * 24 * 60 * 60);
      return res.status(200).json({ ok: true });
    }

    // Optional: simple click analytics
    if (action === "ref-hit") {
      const code = (req.query.code || "").toString().slice(0, 64);
      const path = (req.query.path || "/").toString().slice(0, 64);
      if (!code) return res.status(400).json({ ok: false, error: "missing code" });
      const day = ymd();
      try {
        await kvIncr(`ref:${code}:hits:${day}`);
        await kvIncr(`ref:${code}:hits:total`);
      } catch {}
      return res.status(200).json({ ok: true });
    }

    if (action === "ref-stats") {
      const code = (req.query.code || "").toString().slice(0, 64);
      if (!code) return res.status(400).json({ ok: false, error: "missing code" });
      let total = 0;
      try {
        const v = await kvGet(`ref:${code}:hits:total`);
        total = typeof v?.result === "string" ? Number(v.result) : 0;
      } catch {}
      return res.status(200).json({ ok: true, code, total });
    }

    /* -- fallback -- */
    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
