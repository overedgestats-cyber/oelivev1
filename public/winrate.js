// /public/winrate.js  (MTD version)
// Fills each .win30 card with *current-month* (calendar MTD) stats.
// Supported endpoints (same as before):
//   - /api/results?kind=free|hero|pro&days=200
//   - /api/rpc?action=free-picks-results&limit=200
//   - /api/rpc?action=hero-bet-results&limit=200
//   - /api/rpc?action=pro-board-results&limit=200
//
// HOW TO USE IN HTML:
//   <div class="win30" data-endpoint="/api/rpc?action=free-picks-results&limit=200">...</div>       // Win%
//   <div class="win30" data-endpoint="/api/rpc?action=free-picks-results&limit=200" data-metric="roi">...</div>  // ROI
//
// Win% = all settled picks (win/lose). Push/void ignored.
// ROI  = flat 1u, only on picks that have numeric odds (decimal). Push/void ignored.

(function () {
  const cards = Array.from(document.querySelectorAll('.win30'));
  if (!cards.length) return;

  // Current month window (UTC, so YYYY-MM-DD string compares are safe)
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const ymd   = d => d.toISOString().slice(0, 10);
  const startYMD = ymd(start);
  const endYMD   = ymd(now);

  function normalizeEndpoint(raw) {
    // Convert old /api/rpc?action=... to /api/results?kind=... when possible.
    if (!raw) return raw;
    try {
      const u = new URL(raw, location.origin);
      if (!u.pathname.startsWith('/api/rpc')) return raw; // already /api/results or other custom route
      const action = u.searchParams.get('action') || '';
      const limit  = u.searchParams.get('limit')  || '200';
      let kind = null;
      if (action === 'free-picks-results') kind = 'free';
      else if (action === 'hero-bet-results') kind = 'hero';
      else if (action === 'pro-board-results') kind = 'pro';
      return kind
        ? `/api/results?kind=${encodeURIComponent(kind)}&days=${encodeURIComponent(limit)}`
        : raw;
    } catch {
      return raw;
    }
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('net');
    return r.json();
  }

  // From unified days:[{date, picks:[...]}]
  function aggregateFromPicksDays(days) {
    let wins = 0, losses = 0;

    // ROI (1u) only on picks that have numeric odds
    let roiStakePicks = 0;
    let profit = 0; // in units

    const month = days.filter(d =>
      typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
    );

    for (const d of month) {
      const picks = Array.isArray(d.picks) ? d.picks : [];
      for (const p of picks) {
        const st   = String(p.status || '').toLowerCase(); // "win" | "lose"|"loss" | "push"
        const odds = Number(p.odds);

        // Win%
        if (st === 'win') wins += 1;
        else if (st === 'lose' || st === 'loss') losses += 1;

        // ROI: only when odds is a finite number
        if (Number.isFinite(odds)) {
          if (st === 'win') { profit += Math.max(0, odds - 1); roiStakePicks += 1; }
          else if (st === 'lose' || st === 'loss') { profit -= 1; roiStakePicks += 1; }
          // push/void ignored
        }
      }
    }

    const settled = wins + losses;                      // for Win%
    const winRate = settled ? (wins / settled) * 100 : 0;
    const roi     = roiStakePicks ? (profit / roiStakePicks) * 100 : 0;

    return { wins, losses, settled, winRate, roi, roiStakePicks };
  }

  // Legacy Pro-Board aggregate shapes:
  // [{ date, combined:{wins,losses,push} } OR { date, totals:{ market:{wins,losses,...} } }]
  function aggregateFromProTotals(days) {
    let wins = 0, losses = 0;

    // NOTE: Legacy days don’t carry odds per pick, so ROI cannot be derived reliably.
    // We compute Win% only here; ROI will show "—" if no pick-level odds exist.
    const month = days.filter(d =>
      typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
    );
    for (const d of month) {
      if (d.combined && (d.combined.wins != null)) {
        wins   += Number(d.combined.wins   || 0);
        losses += Number(d.combined.losses || 0);
      } else if (d.totals) {
        for (const k of Object.keys(d.totals || {})) {
          const row = d.totals[k] || {};
          wins   += Number(row.wins   || 0);
          losses += Number(row.losses || 0);
        }
      }
    }
    const settled = wins + losses;
    const winRate = settled ? (wins / settled) * 100 : 0;
    return { wins, losses, settled, winRate, roi: NaN, roiStakePicks: 0 };
  }

  async function fillCard(card) {
    const raw = card.getAttribute('data-endpoint');
    const url = normalizeEndpoint(raw);
    const metric = (card.getAttribute('data-metric') || '').toLowerCase(); // '' | 'roi'
    const pill   = card.querySelector('.w-pill') || card.querySelector('#win30-accuracy');
    const sub    = card.querySelector('.w-sub')  || card.querySelector('#win30-stats');
    if (!url || !pill || !sub) return;

    try {
      const data = await fetchJSON(url);

      // Prefer unified shape with pick arrays so ROI is possible
      let agg;
      if (data && Array.isArray(data.days)) {
        const hasPicksArrays = data.days.some(d => Array.isArray(d?.picks));
        agg = hasPicksArrays
          ? aggregateFromPicksDays(data.days)
          : aggregateFromProTotals(data.days);
      } else if (data && data.summary && (data.summary.wins != null)) {
        // Bare summary fallback (Win% only; no ROI)
        const wins = Number(data.summary.wins   || 0);
        const losses = Number(data.summary.losses || 0);
        const settled = wins + losses;
        const winRate = settled ? (wins / settled) * 100 : 0;
        agg = { wins, losses, settled, winRate, roi: NaN, roiStakePicks: 0 };
      } else {
        agg = { wins: 0, losses: 0, settled: 0, winRate: 0, roi: NaN, roiStakePicks: 0 };
      }

      if (metric === 'roi') {
        // ROI card
        const val = Number.isFinite(agg.roi) ? agg.roi : NaN;
        pill.textContent = Number.isFinite(val)
          ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`
          : '—';
        sub.textContent  = `Picks: ${agg.roiStakePicks || agg.settled} · Current month`;
      } else {
        // Win% card (default)
        pill.textContent = `${agg.winRate.toFixed(1)}%`;
        sub.textContent  = `Picks: ${agg.settled} · Current month`;
      }
    } catch {
      pill.textContent = '—';
      sub.textContent  = 'Monthly stats unavailable';
    }
  }

  cards.forEach(fillCard);
})();
