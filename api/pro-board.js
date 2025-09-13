// api/pro-board.js
// Simplified Pro Board: hardcoded league IDs, flat response

const axios = require("axios");
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const AXIOS = { headers: { "x-apisports-key": API_KEY } };

if (!API_KEY) console.error("⚠️ Missing API_FOOTBALL_KEY");

// --- Hardcoded leagues we care about ---
const LEAGUE_IDS = [
  39, 40,        // England EPL + Championship
  135, 136,      // Italy Serie A + B
  78, 79,        // Germany Bundesliga + 2
  140, 141,      // Spain La Liga 1 + 2
  61, 62,        // France Ligue 1 + 2
  2, 3, 848,     // UCL, UEL, UECL
  1, 4, 5, 6,    // FIFA World Cup, UEFA Supercup, AFCON, Asian Cup
];

// --- Utils ---
function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}
function toPct(n) {
  return Math.max(1, Math.min(99, Math.round(n * 100)));
}

// Simple Poisson for OU2.5
function poissonP(lambda, k) {
  let logFact = 0; for (let i = 1; i <= k; i++) logFact += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logFact);
}
function probTotalsAtLeast(lambdaH, lambdaA, minGoals = 3) {
  let p = 0;
  for (let h = 0; h <= 10; h++) {
    const ph = poissonP(lambdaH, h);
    for (let a = 0; a <= 10; a++) {
      if (h + a >= minGoals) p += ph * poissonP(lambdaA, a);
    }
  }
  return Math.min(Math.max(p, 0), 1);
}

// --- Main handler ---
module.exports = async (req, res) => {
  try {
    const date = (req.query.date || todayYMD()).slice(0, 10);
    const season = new Date(date).getUTCFullYear();

    const fixtures = [];
    for (const lid of LEAGUE_IDS) {
      const url = `https://v3.football.api-sports.io/fixtures?league=${lid}&season=${season}&date=${date}`;
      try {
        const r = await axios.get(url, AXIOS);
        fixtures.push(...(r.data.response || []));
      } catch (e) {
        console.error("Fixture fetch error:", lid, e.message);
      }
    }

    const items = [];
    for (const f of fixtures) {
      const home = f.teams?.home?.name;
      const away = f.teams?.away?.name;
      const kickoff = f.fixture?.date;
      const league = f.league?.name;

      // Dummy team stats → later plug in last-15 logic
      const lambdaHome = 1.4;
      const lambdaAway = 1.2;
      const expGoals = lambdaHome + lambdaAway;

      const pOver = probTotalsAtLeast(lambdaHome, lambdaAway, 3);
      const pUnder = 1 - pOver;
      const ouPick = pOver >= pUnder ? "Over 2.5" : "Under 2.5";
      const ouConf = toPct(Math.max(pOver, pUnder));

      items.push({
        home, away, kickoff, league,
        topBets: [
          { market: "OU 2.5", pick: ouPick, confidence: ouConf, reason: `Expected goals ~${expGoals.toFixed(2)}` }
        ]
      });
    }

    res.json({ date, count: items.length, items });
  } catch (e) {
    console.error("pro-board error:", e.message);
    res.status(500).json({ error: "pro_board_failed", detail: e.message });
  }
};
