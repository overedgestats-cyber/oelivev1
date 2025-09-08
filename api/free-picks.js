// api/free-picks.js

/**
 * DEFAULT: thin proxy to the monolithic app in /overedge-api/server
 * so you keep all current behavior.
 *
 * OPTIONAL: If you set env USE_DIRECT_FREE_PICKS=1, this file will serve
 * the Free Picks directly using the "serious reasoning" templates below.
 */

const app = require("../overedge-api/server");

module.exports = async (req, res) => {
  try {
    if (process.env.USE_DIRECT_FREE_PICKS === "1") {
      const payload = await buildFreePicksPayload();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.status(200).send(JSON.stringify(payload));
      return;
    }

    // Default: behave exactly like before (proxy to the app)
    return app(req, res);
  } catch (err) {
    console.error("free-picks error:", err);
    res
      .status(500)
      .json({ error: "free_picks_failed", message: err?.message || String(err) });
  }
};

module.exports.config = { runtime: "nodejs20.x" };

/* =========================
   Direct Free Picks (optional)
   ========================= */

/**
 * Build the response payload:
 * {
 *   picks: [{
 *     match, league, kickoff, market, prediction, confidence, odds, reasoning
 *   }, ... up to 2]
 * }
 */
async function buildFreePicksPayload() {
  // 1) Get candidate fixtures (European 1st/2nd tiers, excluding your Pro allow-list).
  // Replace this with your real data source.
  const candidates = await fetchCandidateFixtures();

  // 2) Score each fixture for O/U 2.5 and decide the stronger side.
  const scored = candidates
    .map(scoreFixtureOU25)
    // keep only fixtures where we have a clear side
    .filter((r) => r && r.prediction);

  // 3) Sort by confidence and take top 2
  scored.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const top2 = scored.slice(0, 2);

  // 4) Shape into the payload model expected by /public/app.js
  const picks = top2.map((r) => ({
    match: `${r.home} vs ${r.away}`,
    league: r.league,
    kickoff: new Date(r.kickoff).toISOString(),
    market: "Over/Under 2.5 Goals",
    prediction: r.prediction, // "Over 2.5" or "Under 2.5"
    confidence: Math.round(r.confidence),
    odds: r.odds ?? "—",
    reasoning: buildReasoning(r),
  }));

  return { picks };
}

/**
 * Replace this stub with your real feed:
 * - Filter to European 1st and 2nd tiers
 * - Exclude leagues already in your Pro Board allow-list
 * - Include basic per-fixture context needed to form a decision
 */
async function fetchCandidateFixtures() {
  // --- STUB EXAMPLE DATA (so the handler works if enabled) ---
  // Fields used downstream: home, away, league, kickoff, oddsOver25, oddsUnder25,
  // gfHome, gaHome, gfAway, gaAway, recentOverBias, recentUnderBias, tempoIndex
  const now = Date.now() + 3600 * 1000; // +1h
  return [
    {
      home: "Odense",
      away: "Randers",
      league: "Denmark Superliga",
      kickoff: new Date(now + 2 * 3600 * 1000),
      oddsOver25: 1.85,
      oddsUnder25: 2.00,
      gfHome: 1.7,
      gaHome: 1.4,
      gfAway: 1.5,
      gaAway: 1.6,
      recentOverBias: 0.12, // + means trend to overs
      recentUnderBias: -0.12,
      tempoIndex: 1.08,
    },
    {
      home: "Karlsruhe",
      away: "Fortuna Düsseldorf",
      league: "Germany 2. Bundesliga",
      kickoff: new Date(now + 3 * 3600 * 1000),
      oddsOver25: 1.95,
      oddsUnder25: 1.90,
      gfHome: 1.2,
      gaHome: 0.9,
      gfAway: 1.0,
      gaAway: 1.0,
      recentOverBias: -0.08,
      recentUnderBias: 0.08,
      tempoIndex: 0.94,
    },
    // Add more candidates as needed…
  ];
}

/**
 * Light‐weight, deterministic scorer for O/U 2.5 using common signals.
 * This does NOT require sensitive model details and is safe to adjust.
 */
function scoreFixtureOU25(fx) {
  // Baseline expected goals (very rough):
  const baseXg =
    0.5 * (fx.gfHome + fx.gaAway) + 0.5 * (fx.gfAway + fx.gaHome);

  // Tempo nudges: >1 favors overs, <1 favors unders
  const tempoAdj = (fx.tempoIndex ?? 1) - 1;

  // Recent form nudges (small):
  const formAdj = (fx.recentOverBias ?? 0) - (fx.recentUnderBias ?? 0);

  // Book line sanity nudges (if you have them):
  let bookAdj = 0;
  if (fx.oddsOver25 && fx.oddsUnder25) {
    const pOver = 1 / fx.oddsOver25;
    const pUnder = 1 / fx.oddsUnder25;
    bookAdj = (pOver - pUnder) * 0.4; // small
  }

  // Estimated goals around 2.5 line
  const estGoals = clamp(baseXg + tempoAdj * 0.6 + formAdj * 0.5 + bookAdj, 0.4, 4.0);

  // Confidence is distance from 2.5 with safety scaling
  const dist = Math.abs(estGoals - 2.5);
  const confidence = clamp(45 + dist * 28, 50, 78); // keep it realistic for free picks

  const pickOver = estGoals >= 2.52;
  const pickUnder = estGoals <= 2.48;

  const prediction = pickOver ? "Over 2.5" : pickUnder ? "Under 2.5" : null;

  return {
    ...fx,
    xg: estGoals,
    prediction,
    confidence,
    odds: pickOver ? fx.oddsOver25 : pickUnder ? fx.oddsUnder25 : undefined,
  };
}

/**
 * Compose “serious reasoning” (3–4 sentences) + a final expected-goals line.
 * Uses slightly different language for Over vs Under.
 */
function buildReasoning(r) {
  const roundedXg = r.xg.toFixed(2);

  if (r.prediction === "Over 2.5") {
    const options = [
      // Express pace/defence weaknesses
      `${r.home} and ${r.away} both trend positive for chance creation, and neither profile as a park-the-bus side. The tempo and spacing these two play with tends to produce more open phases and second-ball opportunities. Defensive sequences on both sides have shown gaps when pressed in transition, which correlates with multi-goal matches. We project a game that breaks open rather than stalls.`,
      // Attack vs defence matchup
      `The attacking profiles on each side match up well against the defensive tendencies they’ll face. Wide overloads and late box runs are areas where both teams concede looks, and these are precisely the patterns the opposition likes to exploit. Open-play xThreat zones overlap in dangerous channels, which usually lifts shot volume. Overall this points toward goals rather than control.`,
      // Momentum/finishing angle (no raw numbers)
      `Recent match states for both teams skew toward run-and-respond rather than long control phases. When the first goal arrives, these sides rarely downshift — they chase the next action quickly. That dynamic generally sustains chance count through the 90. It’s the kind of profile that produces three or more.`,
    ];
    const body = options[Math.floor(Math.random() * options.length)];
    return `${body} In this matchup we expect around ${roundedXg} total goals.`;
  }

  // Under 2.5
  const options = [
    `Both teams trend toward compact mid-blocks rather than extended end-to-end phases. Entry passes into the most dangerous zones are typically funneled wide or delayed, which tamps down high-quality looks. Neither side is built to force a chaotic tempo on its own. That profile supports a lower-scoring game.`,
    `The matchup projects as structured rather than expansive. Defensive spacing and recovery angles on both sides have been consistent, limiting unmarked shots. Without a true chaos generator in either XI, sustained fast-break sequences are less likely. That combination usually keeps totals below the 3-goal mark.`,
    `Build-up patterns here don’t naturally create repeat high-value chances. Expect more recycling phases and contested second balls than clean through-ball finishes. The game state is unlikely to spiral. That leans toward a tighter scoreline.`,
  ];
  const body = options[Math.floor(Math.random() * options.length)];
  return `${body} In this matchup we expect around ${roundedXg} total goals.`;
}

/* Utils */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
