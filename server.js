// server.js
const express = require("express");
const axios = require("axios");

const app = express();

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const AXIOS = { headers: { "x-apisports-key": API_KEY } };

/* -------------------- Helpers -------------------- */
function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}
function seasonFromDate(date) {
  const d = new Date(date);
  return d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}
function toPct(n) {
  return Math.round(Math.max(1, Math.min(99, n * 100)));
}
function abs(n) {
  return Math.abs(Number(n) || 0);
}

/* -------------------- Public config (Firebase/Stripe) -------------------- */
app.get("/api/public-config", (req, res) => {
  res.json({
    firebase: {
      apiKey: process.env.FB_API_KEY || "",
      authDomain: process.env.FB_AUTH_DOMAIN || "",
      projectId: process.env.FB_PROJECT_ID || "",
      appId: process.env.FB_APP_ID || "",
      measurementId: process.env.FB_MEASUREMENT_ID || ""
    },
    stripe: {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ""
    }
  });
});

/* -------------------- Team stats (last 15) -------------------- */
async function getTeamStats(teamId) {
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=15`;
  try {
    const r = await axios.get(url, AXIOS);
    const games = r.data?.response || [];

    let gf = 0, ga = 0, over25 = 0, btts = 0, cards = 0, corners = 0, played = 0;

    for (const g of games) {
      const hs = g.score?.fulltime?.home ?? g.goals?.home;
      const as = g.score?.fulltime?.away ?? g.goals?.away;
      if (g?.fixture?.status?.short !== "FT") continue;
      if (typeof hs !== "number" || typeof as !== "number") continue;

      const isHome = g?.teams?.home?.id === teamId;
      const goalsFor = isHome ? hs : as;
      const goalsAgainst = isHome ? as : hs;

      gf += goalsFor;
      ga += goalsAgainst;

      if (hs + as >= 3) over25 += 1;
      if (hs > 0 && as > 0) btts += 1;

      // Stats (often not embedded; we keep this light)
      if (Array.isArray(g.statistics)) {
        const mine = g.statistics.find(s => s?.team?.id === teamId) || {};
        const st = mine.statistics || [];
        const get = (type) => {
          const entry = st.find(x => (x?.type || "").toLowerCase() === type);
          return typeof entry?.value === "number" ? entry.value : 0;
        };
        const yc = get("yellow cards");
        const rc = get("red cards");
        const cs = get("corners");
        cards += (yc + rc) || 0;
        corners += cs || 0;
      }

      played += 1;
    }

    return {
      played,
      avgGF: played ? gf / played : 0,
      avgGA: played ? ga / played : 0,
      ou25: played ? over25 / played : 0,
      btts: played ? btts / played : 0,
      avgCards: played ? cards / played : 0,
      avgCorners: played ? corners / played : 0
    };
  } catch (e) {
    console.error("getTeamStats error:", e?.message || e);
    return { played: 0, avgGF: 0, avgGA: 0, ou25: 0, btts: 0, avgCards: 0, avgCorners: 0 };
  }
}

/* -------------------- Pro Board (EPL-only for now) -------------------- */
app.get("/api/pro-board", async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const date = (req.query.date || todayYMD()).slice(0, 10);
    const season = seasonFromDate(date);

    // EPL (league 39)
    const url = `https://v3.football.api-sports.io/fixtures?league=39&season=${season}&date=${date}`;
    const r = await axios.get(url, AXIOS);
    const fixtures = r.data?.response || [];

    const items = [];
    for (const f of fixtures) {
      const hId = f?.teams?.home?.id;
      const aId = f?.teams?.away?.id;
      if (!hId || !aId) continue;

      const [hStats, aStats] = await Promise.all([getTeamStats(hId), getTeamStats(aId)]);

      // Markets (simple, transparent formulas)
      const ouConf = toPct((hStats.ou25 + aStats.ou25) / 2);
      const bttsConf = toPct((hStats.btts + aStats.btts) / 2);

      const oneX2Pick = (hStats.avgGF - aStats.avgGF) >= 0 ? "Home" : "Away";
      const oneX2Conf = toPct(Math.min(1, abs(hStats.avgGF - aStats.avgGF) / 3)); // scale gap into 0..1

      const totalCards = (hStats.avgCards + aStats.avgCards);
      const cardsPick = totalCards > 4.5 ? "Over 4.5" : "Under 4.5";
      const cardsConf = toPct(Math.min(1, totalCards / 10)); // rough confidence scaler

      const totalCorners = (hStats.avgCorners + aStats.avgCorners);
      const cornersPick = totalCorners > 9.5 ? "Over 9.5" : "Under 9.5";
      const cornersConf = toPct(Math.min(1, totalCorners / 14)); // rough confidence scaler

      items.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: f.league.name,
        kickoff: f.fixture.date,
        topBets: [
          { market: "OU 2.5", pick: ouConf >= 50 ? "Over" : "Under", confidence: ouConf, reason: "OU2.5 frequency over last 15 matches (both teams)" },
          { market: "BTTS", pick: bttsConf >= 50 ? "Yes" : "No", confidence: bttsConf, reason: "BTTS frequency over last 15 matches (both teams)" },
          { market: "1X2", pick: oneX2Pick, confidence: oneX2Conf, reason: "Relative GF per match over last 15" },
          { market: "Cards", pick: cardsPick, confidence: cardsConf, reason: "Average cards per match (last 15)" },
          { market: "Corners", pick: cornersPick, confidence: cornersConf, reason: "Average corners per match (last 15)" }
        ]
      });
    }

    res.json({ date, season, count: items.length, items });
  } catch (e) {
    console.error("pro-board error:", e?.message || e);
    res.status(500).json({ error: "pro_board_failed", detail: e?.message || String(e) });
  }
});

/* -------------------- Hero Bet -------------------- */
app.get("/api/hero-bet", async (req, res) => {
  try {
    const date = (req.query.date || todayYMD()).slice(0, 10);

    // Build base URL robustly (works on custom domains too)
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : (req?.headers?.host ? `https://${req.headers.host}` : "http://localhost:3000");

    const r = await axios.get(`${baseUrl}/api/pro-board?date=${encodeURIComponent(date)}`);
    const items = r.data?.items || [];
    if (!items.length) return res.json({ hero: null });

    let best = null;
    for (const match of items) {
      for (const bet of match.topBets || []) {
        if (!best || (bet.confidence || 0) > (best.confidence || 0)) {
          best = {
            ...bet,
            match: `${match.home} vs ${match.away}`,
            league: match.league,
            kickoff: match.kickoff
          };
        }
      }
    }
    res.json({ hero: best });
  } catch (e) {
    console.error("hero-bet error:", e?.message || e);
    res.status(500).json({ error: "hero_bet_failed", detail: e?.message || String(e) });
  }
});

/* -------------------- Health -------------------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

/* -------------------- Export for Vercel -------------------- */
module.exports = app;
