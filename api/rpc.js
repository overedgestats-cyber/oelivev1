// /api/rpc.js
// One endpoint, multiple actions via ?action=...
// Actions: health, public-config, free-picks, pro-pick, verify-sub

// If you ever need to force Node runtime on Vercel (recommended for Stripe):
export const config = { runtime: "nodejs20.x" };

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
    // API-Football requires server-side calls; do NOT expose your key client-side.
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`API ${path} ${resp.status}`);
  const data = await resp.json();
  return data.response || [];
}

const TOP5_COUNTRIES = ["England", "Spain", "Italy", "Germany", "France"];
const UEFA_NAMES = ["UEFA", "Champions League", "Europa League", "Conference League"];
const FALLBACK_COUNTRIES = ["Netherlands", "Portugal", "Belgium", "USA"]; // MLS in USA

function isTop5OrUEFA(league) {
  const name = (league?.name || "").toLowerCase();
  const country = league?.country || "";
  const uefa =
    UEFA_NAMES.some((k) => name.includes(k.toLowerCase())) ||
    country === "World" ||
    country === "Europe";
  return TOP5_COUNTRIES.includes(country) || uefa;
}
function isFallback(league) {
  return FALLBACK_COUNTRIES.includes(league?.country || "");
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
  let gp = 0,
    goalsFor = 0,
    goalsAg = 0,
    over25 = 0,
    under25 = 0,
    btts = 0;

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
    return `High-scoring trends: Home O2.5 ${pct(h.over25Rate)}%, Away O2.5 ${pct(a.over25Rate)}%. Avg GF (H) ${h.avgFor.toFixed(
      2
    )} vs (A) ${a.avgFor.toFixed(2)}.`;
  }
  return `Low-scoring trends: Home U2.5 ${pct(h.under25Rate)}%, Away U2.5 ${pct(a.under25Rate)}%. Avg GA (H) ${h.avgAg.toFixed(
    2
  )} vs (A) ${a.avgAg.toFixed(2)}.`;
}
function reasoningBTTS(h, a) {
  return `BTTS form: Home ${pct(h.bttsRate)}% & Away ${pct(a.bttsRate)}%. Attack outputs (GF): H ${h.avgFor.toFixed(
    2
  )} / A ${a.avgFor.toFixed(2)}.`;
}

// Odds helper — tries to extract OU 2.5, BTTS, and 1X2 odds if available
async function getOddsMap(fixtureId) {
  try {
    const rows = await apiGet("/odds", { fixture: fixtureId });
    const out = {
      over25: null,
      under25: null,
      bttsYes: null,
      bttsNo: null,
      homeWin: null,
      draw: null,
      awayWin: null,
      bookmaker: null,
    };
    const bms = rows?.[0]?.bookmakers || [];
    for (const b of bms) {
      for (const bet of b?.bets || []) {
        const name = (bet?.name || "").toLowerCase();
        // Over/Under lines
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
    return null; // Odds may be unavailable on your plan
  }
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
  if (overP >= underP) {
    market = "Over 2.5";
    conf = overP;
  } else {
    market = "Under 2.5";
    conf = underP;
  }

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
  const fixtures = await apiGet("/fixtures", { date, timezone: tz });

  const primary = fixtures.filter((fx) => isTop5OrUEFA(fx.league));
  const fallback = fixtures.filter((fx) => isFallback(fx.league));

  async function evaluate(list, limit = 20) {
    const out = [];
    for (const fx of list.slice(0, limit)) {
      try {
        const scored = await scoreFixtureForOU25(fx);
        if (scored && scored.confidencePct >= minConf) out.push(scored);
        if (out.length >= 2) break;
      } catch {}
    }
    return out;
  }

  let picks = await evaluate(primary);
  let fallbackUsed = false;

  if (picks.length < 2) {
    const need = 2 - picks.length;
    const extra = await evaluate(fallback, 20);
    fallbackUsed = extra.length > 0;
    picks = picks.concat(extra.slice(0, need));
  }

  if (fallbackUsed) {
    picks = picks.map((p) => {
      if (!isTop5OrUEFA({ country: p.country, name: p.league })) {
        return { ...p, league: `⚠️ Alternative Pick (Fallback League) — ${p.league}` };
      }
      return p;
    });
  }

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

  // OU 2.5 signals
  const overP = home.over25Rate * 0.5 + away.over25Rate * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const overOdds = odds?.over25 ?? null;
  const underOdds = odds?.under25 ?? null;

  // target ~65–75% confidence and odds >= 2.0 (guide band, not strict)
  function withinBand(p) { return p >= 0.62 && p <= 0.80; }

  if (overOdds && overOdds >= 2.0 && withinBand(overP)) {
    candidates.push({
      market: "Over 2.5",
      selection: "Over 2.5",
      conf: overP,
      odds: overOdds,
      reasoning: reasoningOU(home, away, "Over 2.5"),
    });
  }
  if (underOdds && underOdds >= 2.0 && withinBand(underP)) {
    candidates.push({
      market: "Under 2.5",
      selection: "Under 2.5",
      conf: underP,
      odds: underOdds,
      reasoning: reasoningOU(home, away, "Under 2.5"),
    });
  }

  // BTTS: Yes
  const bttsP = home.bttsRate * 0.5 + away.bttsRate * 0.5;
  const bttsYesOdds = odds?.bttsYes ?? null;
  if (bttsYesOdds && bttsYesOdds >= 2.0 && withinBand(bttsP)) {
    candidates.push({
      market: "BTTS",
      selection: "BTTS: Yes",
      conf: bttsP,
      odds: bttsYesOdds,
      reasoning: reasoningBTTS(home, away),
    });
  }

  // Shape candidates with display details
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
  const primary = fixtures.filter((fx) => isTop5OrUEFA(fx.league));
  const fallback = fixtures.filter((fx) => isFallback(fx.league));

  async function evaluate(list, limit = 25) {
    let all = [];
    for (const fx of list.slice(0, limit)) {
      try {
        const cands = await scoreHeroCandidates(fx);
        all = all.concat(cands);
      } catch {}
    }
    return all;
  }

  // Try primary, then fallback
  let candidates = await evaluate(primary);
  if (candidates.length === 0) {
    candidates = await evaluate(fallback);
  }

  // Pick best by valueScore; if none, return soft "coming soon"
  if (candidates.length === 0) {
    return { heroBet: null, note: "No qualifying value pick (odds≥2 & conf in band) found yet." };
  }

  candidates.sort((a, b) => b.valueScore - a.valueScore);
  const best = candidates[0];
  return { heroBet: best };
}

// ---------- Stripe verify by email ----------
async function verifyStripeByEmail(email) {
  const key = process.env.STRIPE_SECRET || "";
  if (!key) throw new Error("Missing STRIPE_SECRET");

  // Find customer by email
  const custResp = await fetch(`https://api.stripe.com/v1/customers?${qs({ email, limit: 3 })}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!custResp.ok) throw new Error(`Stripe customers ${custResp.status}`);
  const custData = await custResp.json();
  const customers = custData?.data || [];
  if (customers.length === 0) {
    return { pro: false, plan: null, status: "none" };
  }

  // Check subscriptions for any matching customer, prefer most recent active/trialing
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

  // Derive a human plan label
  const item = best.items?.data?.[0];
  const price = item?.price || {};
  const nickname = price.nickname || null;
  const interval = price.recurring?.interval || null;
  const amount = typeof price.unit_amount === "number" ? (price.unit_amount / 100).toFixed(2) : null;
  const currency = price.currency ? price.currency.toUpperCase() : null;

  const plan =
    nickname ||
    (interval ? `${interval}${amount ? ` ${amount} ${currency}` : ""}` : price.id || null);

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

      const payload = await pickFreePicks({ date, tz, minConf });
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
