/* ------------------------------ Handler ------------------------------ */
export default async function handler(req, res) {
  try {
    setNoEdgeCache(res); // prevent CDN caching differences by region
    const { action = "health" } = req.query;

    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    // ======== NEW: CRON-FRIENDLY CAPTURE ACTIONS ========

    if (action === "capture-free-picks") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const payload = await pickFreePicks({ date, tz, minConf });

      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home, away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: (payload?.picks || []).length });
    }

    if (action === "capture-hero-bet") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "auto").toString().toLowerCase(); // auto|ou_goals|btts
      const payload = await pickHeroBet({ date, tz, market });

      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home, away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: payload?.heroBet ? 1 : 0 });
    }

    if (action === "capture-proboard") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      const markets = ["ou_goals", "btts", "one_x_two", "ou_cards", "ou_corners"];
      let stored = 0;

      for (const m of markets) {
        const payload = await buildProBoardGrouped({ date, tz, market: m });
        try {
          const recs = [];
          for (const g of (payload?.groups || [])) {
            for (const L of (g.leagues || [])) {
              for (const fx of (L.fixtures || [])) {
                const r = fx?.recommendation;
                if (!r || !fx?.home?.name || !fx?.away?.name) continue;
                recs.push({
                  date,
                  matchTime: fx.time || null,
                  country: g.country || null,
                  league: L.leagueName || null,
                  home: fx.home.name,
                  away: fx.away.name,
                  market: r.market || null,
                  selection: r.pick || null,
                  odds: null,
                  fixtureId: fx.fixtureId || null,
                  source: "pro-board",
                  status: "pending"
                });
              }
            }
          }
          if (recs.length) {
            await writeDailyPicks("pro-board", date, recs);
            stored += recs.length;
          }
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, stored });
    }

    // ======== READERS FOR WIDGETS ========

    // FREE PICKS — RESULTS (read from Firestore)
    if (action === "free-picks-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listFreePickResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("free-picks-results error:", e);
        return res.status(500).json({ error: "Results read error" });
      }
    }

    // HERO BET — RESULTS (read from Firestore)
    if (action === "hero-bet-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listHeroBetResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("hero-bet-results error:", e);
        return res.status(500).json({ error: "Hero results read error" });
      }
    }

    // PRO BOARD — DAILY SUMMARIES (read from Firestore; aggregates by market)
    if (action === "pro-board-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listProBoardSummaries({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("pro-board-results error:", e);
        return res.status(500).json({ error: "Pro board results read error" });
      }
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
      const key = cacheKey(date, tz, minConf);

      if (!refresh) {
        const persisted = await fpGet(date, tz, minConf);
        if (persisted) { putCached(key, persisted); return res.status(200).json(persisted); }
        const cached = getCached(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickFreePicks({ date, tz, minConf });

      // Persist to Firestore (idempotent)
      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home,
          away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}

      putCached(key, payload);
      await fpSet(date, tz, minConf, payload);
      return res.status(200).json(payload);
    }

    // HERO BET (Pro pick) — restricted to OU 2.5 and BTTS; pinned by date/tz/market unless refresh=1
    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      // normalize market to auto|ou_goals|btts only
      const m0 = (req.query.market || "auto").toString().toLowerCase();
      const market = (m0 === "ou_goals" || m0 === "btts" || m0 === "auto") ? m0 : "auto";

      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = ppCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await ppGet(date, tz, market);
        if (persisted) { putCachedPP(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPP(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickHeroBet({ date, tz, market });

      // Persist hero bet (idempotent)
      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home,
            away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}

      putCachedPP(key, payload);
      await ppSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // PRO BOARD (flat) — NO odds
    if (action === "pro-board") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbCacheKey(date, tz);

      if (!refresh) {
        const persisted = await pbGet(date, tz);
        if (persisted) { putCachedPB(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPB(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoard({ date, tz });
      putCachedPB(key, payload);
      await pbSet(date, tz, payload);
      return res.status(200).json(payload);
    }

    // PRO BOARD GROUPED — also persists recs to Firestore
    if (action === "pro-board-grouped") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "ou_goals").toString().toLowerCase(); // ou_goals|ou_cards|ou_corners|one_x_two|btts
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbgCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await pbgGet(date, tz, market);
        if (persisted) { putCachedPBG(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPBG(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoardGrouped({ date, tz, market });

      // Persist pro-board recommendations (idempotent)
      try {
        const recs = [];
        for (const g of (payload?.groups || [])) {
          for (const L of (g.leagues || [])) {
            for (const fx of (L.fixtures || [])) {
              const r = fx?.recommendation;
              if (!r || !fx?.home?.name || !fx?.away?.name) continue;
              recs.push({
                date,
                matchTime: fx.time || null,
                country: g.country || null,
                league: L.leagueName || null,
                home: fx.home.name,
                away: fx.away.name,
                market: r.market || null,
                selection: r.pick || null,
                odds: null,
                fixtureId: fx.fixtureId || null,
                source: "pro-board",
                status: "pending"
              });
            }
          }
        }
        if (recs.length) await writeDailyPicks("pro-board", date, recs);
      } catch (e) {}

      putCachedPBG(key, payload);
      await pbgSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // VERIFY SUB
    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const devs = (process.env.OE_DEV_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      if (devs.includes(email)) {
        return res.status(200).json({ pro: true, plan: "DEV", status: "override", overrideUntil: "9999-12-31" });
      }

      let base = { pro: false, plan: null, status: "none" };
      try { base = await verifyStripeByEmail(email); } catch {}

      let overrideSec = 0;
      try { overrideSec = await getProOverride(email); } catch {}
      const nowSec = Math.floor(Date.now() / 1000);
      const hasOverride = overrideSec > nowSec;

      return res.status(200).json({
        pro: base.pro || hasOverride,
        plan: base.plan,
        status: base.pro ? base.status : (hasOverride ? "override" : base.status),
        overrideUntil: hasOverride ? new Date(overrideSec * 1000).toISOString() : null,
      });
    }

    // (OPTIONAL) ADMIN settle endpoint — protect with your own auth in production!
    if (action === "settle") {
      const { kind = "free-picks", date, home, away, market = "", selection = "", status = "", closing = "", finalScore = "" } = req.query || {};
      if (!date || !home || !away) return res.status(400).json({ ok:false, error:"Missing date/home/away" });

      try {
        const patch = {};
        if (status)  patch.status = String(status).toLowerCase(); // win|lose|loss|push|pending
        if (closing !== "") patch.closing = Number(closing);
        if (finalScore !== "") patch.finalScore = String(finalScore);
        await settlePick(kind, { date, home, away, market, selection }, patch);
        return res.status(200).json({ ok:true });
      } catch (e) {
        return res.status(500).json({ ok:false, error: e?.message || "settle failed" });
      }
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* ===================== READ: Hero Bet results ====================== */
async function listHeroBetResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("hero_bet_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];
    let dayPick = null;
    if (picks.length) {
      const p = { ...picks[0] };
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;
        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1;
        }
      }
      dayPick = {
        home: p.home, away: p.away,
        market: p.market || p.selection || "",
        odds: (typeof p.odds === "number" ? p.odds : null),
        status: p.status || "pending",
        finalScore: p.finalScore || null
      };
    }
    if (dayPick) days.push({ date: d.date, picks: [dayPick] });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;
  const total   = days.length;

  return { days, summary: { total, wins, losses, push, winRate, roiPct } };
}

/* ===================== READ: Pro Board daily summaries ====================== */
async function listProBoardSummaries({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("pro_board_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let Gwins = 0, Glosses = 0, Gpush = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    let T = d.totals || {};

    // If totals missing, build from picks (status != pending)
    if ((!T || !Object.keys(T).length) && Array.isArray(d.picks)) {
      const acc = {};
      for (const p of d.picks) {
        const st = String(p.status || "").toLowerCase();
        if (!st || st === "pending") continue;
        const m = String(p.market || p.selection || "Other");
        acc[m] = acc[m] || { wins: 0, losses: 0, push: 0 };
        if (st === "win") acc[m].wins += 1;
        else if (st === "loss" || st === "lose") acc[m].losses += 1;
        else acc[m].push += 1;
      }
      T = acc;
    }

    const markets = Object.keys(T || {});
    let dayWins = 0, dayLosses = 0, dayPush = 0;

    markets.forEach(m => {
      const row = T[m] || {};
      const w = Number(row.wins  || 0);
      const l = Number(row.losses|| 0);
      const p = Number(row.push  || 0);
      dayWins   += w; dayLosses += l; dayPush += p;
    });

    Gwins  += dayWins;
    Glosses+= dayLosses;
    Gpush  += dayPush;

    days.push({
      date: d.date,
      totals: T,
      combined: { wins: dayWins, losses: dayLosses, push: dayPush }
    });
  });

  const settled = Gwins + Glosses;
  const winRate = settled ? Math.round((Gwins / settled) * 100) : null;

  const summary = {
    totalDays: days.length,
    wins: Gwins,
    losses: Glosses,
    push: Gpush,
    winRate,
    roiPct: null
  };

  return { days, summary };
}

/* ===================== READ: Free Picks results ====================== */
async function listFreePickResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("free_picks_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];

    picks.forEach((p) => {
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;

        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1; // 1u ROI calc
        }
      }
    });

    days.push({
      date: d.date,
      picks: picks.map(p => ({
        home: p.home, away: p.away, market: p.market,
        odds: p.odds ?? null, status: p.status || "pending",
        finalScore: p.finalScore || null
      }))
    });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;

  const total = days.reduce((acc, d) => acc + (d.picks?.length || 0), 0);

  return {
    days,
    summary: { total, wins, losses, push, winRate, roiPct }
  };
}
/* ------------------------------ Handler ------------------------------ */
export default async function handler(req, res) {
  try {
    setNoEdgeCache(res); // prevent CDN caching differences by region
    const { action = "health" } = req.query;

    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    // ======== NEW: CRON-FRIENDLY CAPTURE ACTIONS ========

    if (action === "capture-free-picks") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const payload = await pickFreePicks({ date, tz, minConf });

      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home, away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: (payload?.picks || []).length });
    }

    if (action === "capture-hero-bet") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "auto").toString().toLowerCase(); // auto|ou_goals|btts
      const payload = await pickHeroBet({ date, tz, market });

      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home, away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: payload?.heroBet ? 1 : 0 });
    }

    if (action === "capture-proboard") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      const markets = ["ou_goals", "btts", "one_x_two", "ou_cards", "ou_corners"];
      let stored = 0;

      for (const m of markets) {
        const payload = await buildProBoardGrouped({ date, tz, market: m });
        try {
          const recs = [];
          for (const g of (payload?.groups || [])) {
            for (const L of (g.leagues || [])) {
              for (const fx of (L.fixtures || [])) {
                const r = fx?.recommendation;
                if (!r || !fx?.home?.name || !fx?.away?.name) continue;
                recs.push({
                  date,
                  matchTime: fx.time || null,
                  country: g.country || null,
                  league: L.leagueName || null,
                  home: fx.home.name,
                  away: fx.away.name,
                  market: r.market || null,
                  selection: r.pick || null,
                  odds: null,
                  fixtureId: fx.fixtureId || null,
                  source: "pro-board",
                  status: "pending"
                });
              }
            }
          }
          if (recs.length) {
            await writeDailyPicks("pro-board", date, recs);
            stored += recs.length;
          }
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, stored });
    }

    // ======== READERS FOR WIDGETS ========

    // FREE PICKS — RESULTS (read from Firestore)
    if (action === "free-picks-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listFreePickResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("free-picks-results error:", e);
        return res.status(500).json({ error: "Results read error" });
      }
    }

    // HERO BET — RESULTS (read from Firestore)
    if (action === "hero-bet-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listHeroBetResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("hero-bet-results error:", e);
        return res.status(500).json({ error: "Hero results read error" });
      }
    }

    // PRO BOARD — DAILY SUMMARIES (read from Firestore; aggregates by market)
    if (action === "pro-board-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listProBoardSummaries({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("pro-board-results error:", e);
        return res.status(500).json({ error: "Pro board results read error" });
      }
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
      const key = cacheKey(date, tz, minConf);

      if (!refresh) {
        const persisted = await fpGet(date, tz, minConf);
        if (persisted) { putCached(key, persisted); return res.status(200).json(persisted); }
        const cached = getCached(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickFreePicks({ date, tz, minConf });

      // Persist to Firestore (idempotent)
      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home,
          away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}

      putCached(key, payload);
      await fpSet(date, tz, minConf, payload);
      return res.status(200).json(payload);
    }

    // HERO BET (Pro pick) — restricted to OU 2.5 and BTTS; pinned by date/tz/market unless refresh=1
    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      // normalize market to auto|ou_goals|btts only
      const m0 = (req.query.market || "auto").toString().toLowerCase();
      const market = (m0 === "ou_goals" || m0 === "btts" || m0 === "auto") ? m0 : "auto";

      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = ppCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await ppGet(date, tz, market);
        if (persisted) { putCachedPP(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPP(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickHeroBet({ date, tz, market });

      // Persist hero bet (idempotent)
      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home,
            away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}

      putCachedPP(key, payload);
      await ppSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // PRO BOARD (flat) — NO odds
    if (action === "pro-board") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbCacheKey(date, tz);

      if (!refresh) {
        const persisted = await pbGet(date, tz);
        if (persisted) { putCachedPB(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPB(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoard({ date, tz });
      putCachedPB(key, payload);
      await pbSet(date, tz, payload);
      return res.status(200).json(payload);
    }

    // PRO BOARD GROUPED — also persists recs to Firestore
    if (action === "pro-board-grouped") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "ou_goals").toString().toLowerCase(); // ou_goals|ou_cards|ou_corners|one_x_two|btts
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbgCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await pbgGet(date, tz, market);
        if (persisted) { putCachedPBG(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPBG(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoardGrouped({ date, tz, market });

      // Persist pro-board recommendations (idempotent)
      try {
        const recs = [];
        for (const g of (payload?.groups || [])) {
          for (const L of (g.leagues || [])) {
            for (const fx of (L.fixtures || [])) {
              const r = fx?.recommendation;
              if (!r || !fx?.home?.name || !fx?.away?.name) continue;
              recs.push({
                date,
                matchTime: fx.time || null,
                country: g.country || null,
                league: L.leagueName || null,
                home: fx.home.name,
                away: fx.away.name,
                market: r.market || null,
                selection: r.pick || null,
                odds: null,
                fixtureId: fx.fixtureId || null,
                source: "pro-board",
                status: "pending"
              });
            }
          }
        }
        if (recs.length) await writeDailyPicks("pro-board", date, recs);
      } catch (e) {}

      putCachedPBG(key, payload);
      await pbgSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // VERIFY SUB
    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const devs = (process.env.OE_DEV_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      if (devs.includes(email)) {
        return res.status(200).json({ pro: true, plan: "DEV", status: "override", overrideUntil: "9999-12-31" });
      }

      let base = { pro: false, plan: null, status: "none" };
      try { base = await verifyStripeByEmail(email); } catch {}

      let overrideSec = 0;
      try { overrideSec = await getProOverride(email); } catch {}
      const nowSec = Math.floor(Date.now() / 1000);
      const hasOverride = overrideSec > nowSec;

      return res.status(200).json({
        pro: base.pro || hasOverride,
        plan: base.plan,
        status: base.pro ? base.status : (hasOverride ? "override" : base.status),
        overrideUntil: hasOverride ? new Date(overrideSec * 1000).toISOString() : null,
      });
    }

    // (OPTIONAL) ADMIN settle endpoint — protect with your own auth in production!
    if (action === "settle") {
      const { kind = "free-picks", date, home, away, market = "", selection = "", status = "", closing = "", finalScore = "" } = req.query || {};
      if (!date || !home || !away) return res.status(400).json({ ok:false, error:"Missing date/home/away" });

      try {
        const patch = {};
        if (status)  patch.status = String(status).toLowerCase(); // win|lose|loss|push|pending
        if (closing !== "") patch.closing = Number(closing);
        if (finalScore !== "") patch.finalScore = String(finalScore);
        await settlePick(kind, { date, home, away, market, selection }, patch);
        return res.status(200).json({ ok:true });
      } catch (e) {
        return res.status(500).json({ ok:false, error: e?.message || "settle failed" });
      }
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* ===================== READ: Hero Bet results ====================== */
async function listHeroBetResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("hero_bet_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];
    let dayPick = null;
    if (picks.length) {
      const p = { ...picks[0] };
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;
        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1;
        }
      }
      dayPick = {
        home: p.home, away: p.away,
        market: p.market || p.selection || "",
        odds: (typeof p.odds === "number" ? p.odds : null),
        status: p.status || "pending",
        finalScore: p.finalScore || null
      };
    }
    if (dayPick) days.push({ date: d.date, picks: [dayPick] });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;
  const total   = days.length;

  return { days, summary: { total, wins, losses, push, winRate, roiPct } };
}

/* ===================== READ: Pro Board daily summaries ====================== */
async function listProBoardSummaries({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("pro_board_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let Gwins = 0, Glosses = 0, Gpush = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    let T = d.totals || {};

    // If totals missing, build from picks (status != pending)
    if ((!T || !Object.keys(T).length) && Array.isArray(d.picks)) {
      const acc = {};
      for (const p of d.picks) {
        const st = String(p.status || "").toLowerCase();
        if (!st || st === "pending") continue;
        const m = String(p.market || p.selection || "Other");
        acc[m] = acc[m] || { wins: 0, losses: 0, push: 0 };
        if (st === "win") acc[m].wins += 1;
        else if (st === "loss" || st === "lose") acc[m].losses += 1;
        else acc[m].push += 1;
      }
      T = acc;
    }

    const markets = Object.keys(T || {});
    let dayWins = 0, dayLosses = 0, dayPush = 0;

    markets.forEach(m => {
      const row = T[m] || {};
      const w = Number(row.wins  || 0);
      const l = Number(row.losses|| 0);
      const p = Number(row.push  || 0);
      dayWins   += w; dayLosses += l; dayPush += p;
    });

    Gwins  += dayWins;
    Glosses+= dayLosses;
    Gpush  += dayPush;

    days.push({
      date: d.date,
      totals: T,
      combined: { wins: dayWins, losses: dayLosses, push: dayPush }
    });
  });

  const settled = Gwins + Glosses;
  const winRate = settled ? Math.round((Gwins / settled) * 100) : null;

  const summary = {
    totalDays: days.length,
    wins: Gwins,
    losses: Glosses,
    push: Gpush,
    winRate,
    roiPct: null
  };

  return { days, summary };
}

/* ===================== READ: Free Picks results ====================== */
async function listFreePickResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("free_picks_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];

    picks.forEach((p) => {
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;

        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1; // 1u ROI calc
        }
      }
    });

    days.push({
      date: d.date,
      picks: picks.map(p => ({
        home: p.home, away: p.away, market: p.market,
        odds: p.odds ?? null, status: p.status || "pending",
        finalScore: p.finalScore || null
      }))
    });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;

  const total = days.reduce((acc, d) => acc + (d.picks?.length || 0), 0);

  return {
    days,
    summary: { total, wins, losses, push, winRate, roiPct }
  };
}
