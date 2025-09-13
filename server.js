// server.js
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_FOOTBALL_KEY || "";
const AXIOS = { headers: { "x-apisports-key": API_KEY } };

// --- Helpers ---
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
// Public config for frontend (Firebase, Stripe, etc.)
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

// --- Basic team stats from last 15 matches ---
async function getTeamStats(teamId) {
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=15`;
  try {
    const r = await axios.get(url, AXIOS);
    const games = r.data.response || [];

    let gf = 0,
      ga = 0,
      over25 = 0,
      btts = 0,
      cards = 0,
      corners = 0,
      played = 0;

    for (const g of games) {
      const hs = g.goals?.home ?? g.score?.fulltime?.home;
      const as = g.goals?.away ?? g.score?.fulltime?.away;
      if (g.fixture?.status?.short !== "FT") continue;

      const isHome = g.teams?.home?.id === teamId;
      const goalsFor = isHome ? hs : as;
      const goalsAgainst = isHome ? as : hs;

      gf += goalsFor;
      ga += goalsAgainst;

      if (hs + as >= 3) over25++;
      if (hs > 0 && as > 0) btts++;

      // Simplified: API-Football stats are more detailed, but we approximate
      if (g.statistics) {
        const teamStats = g.statistics.find((s) => s.team?.id === teamId);
        if (teamStats) {
          cards += (teamStats.cards?.yellow || 0) + (teamStats.cards?.red || 0);
          corners += teamStats.corners || 0;
        }
      }

      played++;
    }

    return {
      played,
      avgGF: played ? gf / played : 0,
      avgGA: played ? ga / played : 0,
      ou25: played ? over25 / played : 0,
      btts: played ? btts / played : 0,
      avgCards: played ? cards / played : 0,
      avgCorners: played ? corners / played : 0,
    };
  } catch (e) {
    console.error("getTeamStats error:", e.message);
    return { played: 0, avgGF: 0, avgGA: 0, ou25: 0, btts: 0, avgCards: 0, avgCorners: 0 };
  }
}

// --- Pro Board endpoint ---
app.get("/api/pro-board", async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const date = (req.query.date || todayYMD()).slice(0, 10);
    const season = seasonFromDate(date);

    // EPL only (league 39) for now
    const url = `https://v3.football.api-sports.io/fixtures?league=39&season=${season}&date=${date}`;
    const r = await axios.get(url, AXIOS);
    const fixtures = r.data.response || [];

    const items = [];
    for (const f of fixtures) {
      const hId = f.teams?.home?.id;
      const aId = f.teams?.away?.id;
      if (!hId || !aId) continue;

      const [hStats, aStats] = await Promise.all([getTeamStats(hId), getTeamStats(aId)]);

      // --- Market analysis ---
      const ouConf = toPct((hStats.ou25 + aStats.ou25) / 2);
      const bttsConf = toPct((hStats.btts + aStats.btts) / 2);

      const oneX2Pick = hStats.avgGF > aStats.avgGF ? "Home" : "Away";
      const oneX2Conf = toPct(Math.abs(hStats.avgGF - aStats.avgGF) / 3);

      const cardsPick = hStats.avgCards + aStats.avgCards > 4 ? "Over 4.5" : "Under 4.5";
      const cardsConf = toPct((hStats.avgCards + aStats.avgCards) / 10);

      const cornersPick = hStats.avgCorners + aStats.avgCorners > 8 ? "Over 8.5" : "Under 8.5";
      const cornersConf = toPct((hStats.avgCorners + aStats.avgCorners) / 12);

      items.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: f.league.name,
        kickoff: f.fixture.date,
        topBets: [
          { market: "OU 2.5", pick: ouConf >= 50 ? "Over" : "Under", confidence: ouConf, reason: "OU2.5 frequency in last 15 games" },
          { market: "BTTS", pick: bttsConf >= 50 ? "Yes" : "No", confidence: bttsConf, reason: "BTTS frequency in last 15 games" },
          { market: "1X2", pick: oneX2Pick, confidence: oneX2Conf, reason: "Comparing goals for per game" },
          { market: "Cards", pick: cardsPick, confidence: cardsConf, reason: "Average team cards per game" },
          { market: "Corners", pick: cornersPick, confidence: cornersConf, reason: "Average team corners per game" },
        ],
      });
    }

    res.json({ date, season, count: items.length, items });
  } catch (e) {
    console.error("pro-board error:", e.message);
    res.status(500).json({ error: "pro_board_failed", detail: e.message });
  }
});

// --- Hero Bet endpoint ---
app.get("/api/hero-bet", async (req, res) => {
  try {
    const date = (req.query.date || todayYMD()).slice(0, 10);
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${PORT}`;

    const r = await axios.get(`${baseUrl}/api/pro-board?date=${date}`);
    const items = r.data.items || [];
    if (!items.length) return res.json({ hero: null });

    // Pick bet with highest confidence
    let best = null;
    for (const match of items) {
      for (const bet of match.topBets) {
        if (!best || bet.confidence > best.confidence) {
          best = { ...bet, match: `${match.home} vs ${match.away}`, league: match.league, kickoff: match.kickoff };
        }
      }
    }

    res.json({ hero: best });
  } catch (e) {
    console.error("hero-bet error:", e.message);
    res.status(500).json({ error: "hero_bet_failed", detail: e.message });
  }
});

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
