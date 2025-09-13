// /api/rpc.js
// One endpoint, multiple actions via ?action=...
// Actions: health, public-config, free-picks, pro-pick, verify-sub

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

// Odds helper — tries to extract OU 2.5, BTTS, and 1X2 odds if available
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
    return null; // Odds may be unavailable on your plan
  }
}

// ---------- European coverage (1st/2nd tiers + national cups + UEFA) ----------
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

// ---------- Free Picks (2x OU 2.5) ----------
async function scoreFixtureForOU25(fx) {
  const homeId = fx?.teams?.home?.id;
  const awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return null;

  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);

  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;

  let market, conf;
  if (overP >= underP) { market = "Over 2.5"; conf = overP; }
  else { market = "Under 2.5"; conf = underP; }

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

// ---- in-memory daily cache for Free Picks (stable all day) ----
const FREEPICKS_CACHE = new Map(); // key -> { payload, exp }

function cacheKey(date, tz, minConf) {
  return `fp|${date}|${tz}|${minConf}`;
}
function getCached(key) {
  const e = FREEPICKS_CACHE.get(key);
  if (e && e.exp > Date.now()) return e.payload;
  if (e) FREEPICKS_CACHE.delete(key);
  return null;
}
function putCached(key, payload) {
  const ttlMs = 22 * 60 * 60 * 1000; // ~22h (stable all day)
  FREEPICKS_CACHE.set(key, { payload, exp: Date.now() + ttlMs });
}

async function pickFreePicks({ date, tz, minConf = 75 }) {
  // Filter to European 1st/2nd tiers + national cups + UEFA
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league));

  // Evaluate up to 50 fixtures, collect all that meet threshold
  const out = [];
  for (const fx of fixtures.slice(0, 50)) {
    try {
      const s = await scoreFixtureForOU25(fx);
      if (s && s.confidencePct >= minConf) out.push(s);
    } catch {}
  }

  // Deterministic selection: sort by confidence desc, then fixtureId asc
  out.sort((a, b) => (b.confidencePct - a.confidencePct) || ((a.fixtureId || 0) - (b.fixtureId || 0)));
  const picks = out.slice(0, 2);
  return { date, timezone: tz, picks };
}

// ---------- Hero Bet (value pick, odds ≥ 2.00) ----------
async function scoreHeroCandidates(fx) {
  const homeId = fx?.teams?.home?.id;
  const awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return [];

  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const odds = await getOddsMap(fx?.fixture?.id);

  const time = clockFromISO(fx?.fixture?.date);
  const leagueName = fx?.league?.name || "";
  const country = fx?.league?.country || "";
  const homeName = fx?.teams?.home?.name || "";
  const awayName = fx?.teams?.away?.name || "";

  const candidates = [];

  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const overOdds = odds?.over25 ?? null;
  const underOdds = odds?.under25 ?? null;

  function withinBand(p) { return p >= 0.62 && p <= 0.80; }

  if (overOdds && overOdds >= 2.0 && withinBand(overP)) {
    candidates.push({
      market: "Over 2.5", selection: "Over 2.5", conf: overP, odds: overOdds,
      reasoning: reasoningOU(home, away, "Over 2.5"),
    });
  }
  if (underOdds && underOdds >= 2.0 && withinBand(underP)) {
    candidates.push({
      market: "Under 2.5", selection: "Under 2.5", conf: underP, odds: underOdds,
      reasoning: reasoningOU(home, away, "Under 2.5"),
    });
  }

  const bttsP = home.bttsRate * 0.5 + away.bttsRate * 0.5;
  const bttsYesOdds = odds?.bttsYes ?? null;
  if (bttsYesOdds && bttsYesOdds >= 2.0 && withinBand(bttsP)) {
    candidates.push({
      market: "BTTS", selection: "BTTS: Yes", conf: bttsP, odds: bttsYesOdds,
      reasoning: reasoningBTTS(home, away),
    });
  }

  return candidates.map((c) => ({
    fixtureId: fx?.fixture?.id,
    league: leagueName,
    country,
    matchTime: time,
    home: homeName,
    away: awayName,
    selection: c.selection,
    market: c.market,
    confidencePct: pct(c.conf),
    odds: c.odds,
    valueScore: Number((c.conf * c.odds).toFixed(4)),
    reasoning: c.reasoning,
  }));
}

async function pickHeroBet({ date, tz }) {
  const fixtures = await apiGet("/fixtures", { date, timezone: tz });
  const primary = fixtures.filter((fx) => isEuropeanTier12OrCup(fx.league));
  let candidates = [];
  for (const fx of primary.slice(0, 50)) {
    try { candidates = candidates.concat(await scoreHeroCandidates(fx)); }
    catch {}
  }
  if (candidates.length === 0) {
    return { heroBet: null, note: "No qualifying value pick (odds≥2 & conf in band) found yet." };
  }
  candidates.sort((a, b) => b.valueScore - a.valueScore);
  return { heroBet: candidates[0] };
}

// ---------- Stripe verify by email ----------
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

      // daily cache: first result sticks for the day (unless refresh=1)
      const key = cacheKey(date, tz, minConf);
      if (!refresh) {
        const cached = getCached(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickFreePicks({ date, tz, minConf });
      putCached(key, payload);
      return res.status(200).json(payload);
    }

    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const payload = await pickHeroBet({ date, tz });
      return res.status(200).json(payload);
    }

    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });
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
