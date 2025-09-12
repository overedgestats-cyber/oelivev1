app.get('/api/free-picks', async (req,res)=>{
  try{
    if (!API_KEY) return res.status(500).json({ error:'missing_api_key' });

    const date = req.query.date || todayYMD();
    const season = seasonFromDate(date);
    const minConf    = Number(req.query.minConf ?? FREEPICKS_MIN_CONF);
    const force      = req.query.refresh === '1';
    const wantDebug  = req.query.debug === '1';

    await ensureDataFiles();
    CAL = await loadJSON(CAL_FILE, defaultCalibration());
    if (!force && dailyPicksCache.size === 0) await loadDailyCacheIntoMap();

    // cache key is now just date + minConf (odds removed)
    const cacheKey = `${date}|${minConf}`;
    if (!force && dailyPicksCache.has(cacheKey)){
      const cachedPayload = { ...(dailyPicksCache.get(cacheKey)), cached:true };
      if (!wantDebug) return res.json(cachedPayload);
    }

    const { cand, poolSize, dbg } = await pickEuropeTwo({ date, season, minConf, wantDebug });

    const picks = cand
      .sort((a,b)=> b.confidence - a.confidence)
      .slice(0,2)
      .map(x => ({
        match: `${x.f.teams.home.name} vs ${x.f.teams.away.name}`,
        league: x.f.league.name,
        kickoff: x.f.fixture.date,
        market: 'Over/Under 2.5 Goals',
        prediction: x.side,
        odds: '—', // no odds in Free Picks (model-only)
        confidence: x.confidence,
        confidenceRaw: x.confidenceRaw,
        reasoning: buildFreeReason(x.f, x.h, x.a, x.model, x.side)
      }));

    const payload = {
      dateRequested: date,
      dateUsed: date,
      thresholds: { minConf },
      meta: { poolSize, candidates: cand.length, ...(wantDebug ? { debug: dbg } : {}) },
      picks,
      computedAt: new Date().toISOString(),
      cached:false
    };

    if (!wantDebug) {
      dailyPicksCache.set(cacheKey, payload);
      await persistDailyCache();
    }

    res.json(payload);
  }catch(e){
    console.error('free-picks error', e.stack || e.message || e);
    res.status(500).json({ error:'failed_to_load_picks', detail:e?.message || String(e) });
  }
});
