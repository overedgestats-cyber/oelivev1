// api/hero-bet.js
const axios = require("axios");

module.exports = async (req, res) => {
  try {
    const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

    // Build base URL dynamically
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:3000`;

    const url = `${baseUrl}/api/pro-board?date=${date}`;
    const r = await axios.get(url);
    const items = r.data.items || [];

    if (!items.length) {
      return res.json({ hero: null });
    }

    // Pick the highest confidence pick
    const hero = items.sort(
      (a, b) => (b.topBets?.[0]?.confidence || 0) - (a.topBets?.[0]?.confidence || 0)
    )[0];

    res.json({ hero });
  } catch (e) {
    console.error("hero-bet error:", e.message);
    res.status(500).json({ error: "hero_bet_failed", detail: e.message });
  }
};
