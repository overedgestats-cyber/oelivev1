// api/hero-bet.js
// Simplified Hero Bet: pick the best from Pro Board

const proBoard = require("./pro-board");

module.exports = async (req, res) => {
  try {
    // Call our Pro Board function to get today’s picks
    const fakeRes = { json: (d) => d };
    const data = await proBoard(req, fakeRes);

    const items = data.items || [];
    if (!items.length) return res.json({ hero: null });

    // Pick highest confidence OU2.5
    const hero = items.sort((a, b) => b.topBets[0].confidence - a.topBets[0].confidence)[0];
    res.json({ hero });
  } catch (e) {
    console.error("hero-bet error:", e.message);
    res.status(500).json({ error: "hero_bet_failed", detail: e.message });
  }
};
