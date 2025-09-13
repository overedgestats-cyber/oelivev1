// api/free-picks.js
const axios = require('axios');

const API_KEY  = process.env.API_FOOTBALL_KEY || '';
const API_TZ   = process.env.API_FOOTBALL_TZ || 'Europe/London';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
const MAX_PAGES = Number(process.env.MAX_FIXTURE_PAGES || 2);

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

    if (!API_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: 'missing_api_key', hint: 'Set API_FOOTBALL_KEY in Vercel env' });
    }

    const http = axios.create({
      headers: { 'x-apisports-key': API_KEY },
      timeout: REQUEST_TIMEOUT_MS,
    });

    async function fetchFixtures() {
      let out = [];
      let page = 1;
      let total = 1;
      while (page <= total && page <= MAX_PAGES) {
        const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=${encodeURIComponent(
          API_TZ
        )}&page=${page}`;
        const r = await http.get(url);
        total = r.data?.paging?.total || 1;
        (r.data?.response || []).forEach((f) => out.push(f));
        page += 1;
      }
      return out;
    }

    const fixtures = await fetchFixtures();

    // TODO: run your scoring/model here. For now return empty picks but prove the route works.
    return res.status(200).json({
      ok: true,
      dateRequested: date,
      meta: { fixtures: fixtures.length },
      picks: [],
      computedAt: new Date().toISOString(),
    });
  } catch (e) {
    // Always return JSON on errors so the front end doesn’t choke on plain text
    return res
      .status(500)
      .json({ ok: false, error: 'failed_to_load_picks', detail: e?.message || String(e) });
  }
};
