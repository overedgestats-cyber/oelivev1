// api/pro-board.js
const axios = require("axios");
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const AXIOS = { headers: { "x-apisports-key": API_KEY } };

const LEAGUE_ID = 39; // EPL only for now

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}
function seasonFromDate(date) {
  const d = new Date(date);
  return d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}
function toPct(n) {
  return Math.round(n * 100);
}

// --- quick stats from last 15 games
async function getTeamStats(teamId) {
  const url = `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=15`;
  const r = await axios.get(url, AXIOS);
  const games = r.data.response || [];

  let gf = 0, ga = 0, over25 = 0, btts = 0, cards = 0, corners = 0, played = 0;
  for (const g of games) {
    const hs = g.goals?.home ?? g.score?.fulltime?.home;
    const as = g.goals?.away ?? g.score?.fulltime?.away;
    if (g.fixture?.status?.short !== "FT") continue;

    const isHome = g.teams?.home?.id === teamId;
    const goalsFor = isHome ? hs : as;
    const goalsAgainst = isHome ? as : hs;

    gf += goalsFor; ga += goalsAgainst;
    if (hs + as >= 3) over25++;
    if (hs > 0 && as > 0) btts++;
    cards += (g.statistics?.[0]?.cards?.yellow || 0) + (g.statistics?.[0]?.cards?.red || 0);
    corners += g.statistics?.[0]?.corners || 0;
    played++;
  }

  return {
    played,
    avgGF: played ? gf / played : 0,
    avgGA: played ? ga / played : 0,
    ou25: played ? over25 / played : 0,
    btts: played ? btts / played : 0,
    cards: played ? cards / played : 0,
    corners: played ? corners / played : 0,
  };
}

module.exports = async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const date = (req.query.date || todayYMD()).slice(0, 10);
    const season = seasonFromDate(date);

    // get EPL fixtures
    const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE_ID}&season=${season}&date=${date}`;
    const r = await axios.get(url, AXIOS);
    const fixtures = r.data.response || [];

    const items = [];
    for (const f of fixtures) {
      const hId = f.teams?.home?.id;
      const aId = f.teams?.away?.id;
      if (!hId || !aId) continue;

      const [hStats, aStats] = await Promise.all([
        getTeamStats(hId),
        getTeamStats(aId),
      ]);

      // confidence formulas (very simple for now)
      const ouConf = toPct((hStats.ou25 + aStats.ou25) / 2);
      const bttsConf = toPct((hStats.btts + aStats.btts) / 2);
      const oneX2Pick = hStats.avgGF > aStats.avgGF ? "Home" : "Away";
      const oneX2Conf = toPct(Math.abs(hStats.avgGF - aStats.avgGF) / 3);

      items.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: f.league.name,
        kickoff: f.fixture.date,
        topBets: [
          { market: "OU 2.5", pick: ouConf >= 50 ? "Over" : "Under", confidence: ouConf, reason: "Based on last 15 matches OU2.5 rates" },
          { market: "BTTS", pick: bttsConf >= 50 ? "Yes" : "No", confidence: bttsConf, reason: "Both teams scoring frequency" },
          { market: "1X2", pick: oneX2Pick, confidence: oneX2Conf, reason: "Average goals for comparison" },
        ]
      });
    }

    res.json({ date, season, count: items.length, items });
  } catch (e) {
    console.error("pro-board error:", e.message);
    res.status(500).json({ error: "pro_board_failed", detail: e.message });
  }
};
