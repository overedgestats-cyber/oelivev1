// /public/winrate.js
// Fill each .win30 card with W/L and accuracy for the last 30 calendar days.
// Supports endpoints:
//   - /api/results?kind=free|hero|pro&days=60   (preferred)
//   - /api/rpc?action=free-picks-results&limit=60
//   - /api/rpc?action=hero-bet-results&limit=60
//   - /api/rpc?action=pro-board-results&limit=60

(function () {
  const cards = Array.from(document.querySelectorAll('.win30'));
  if (!cards.length) return;

  // [today-29 .. today] inclusive window
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const ymd = d => d.toISOString().slice(0, 10);
  const startYMD = ymd(start);
  const endYMD   = ymd(today);

  function normalizeEndpoint(raw) {
    // Pass-through for already-correct endpoints or empty.
    if (!raw) return raw;
    try {
      const u = new URL(raw, location.origin);
      if (!u.pathname.startsWith('/api/rpc')) return raw; // already /api/results or something else

      const action = u.searchParams.get('action') || '';
      const limit  = u.searchParams.get('limit')  || '60';
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

  function countFromPicksDays(days) {
    // Shape: [{ date:'YYYY-MM-DD', picks:[{status,...}] }]
    let wins = 0, losses = 0;
    const recent = days.filter(d =>
      typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
    );
    for (const d of recent) {
      const picks = Array.isArray(d.picks) ? d.picks : [];
      for (const p of picks) {
        const st = String(p.status || '').toLowerCase();
        if (st === 'win') wins += 1;
        else if (st === 'loss' || st === 'lose') losses += 1;
      }
    }
    return { wins, losses };
  }

  function countFromProTotals(days) {
    // Legacy Pro Board shape:
    // [{ date, combined:{wins,losses,push} } OR { date, totals:{ market:{wins,losses,...} } }]
    let wins = 0, losses = 0;
    const recent = days.filter(d =>
      typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
    );
    for (const d of recent) {
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
    return { wins, losses };
  }

  async function fillCard(card) {
    const raw = card.getAttribute('data-endpoint');
    const url = normalizeEndpoint(raw);
    const accEl   = card.querySelector('.w-pill') || card.querySelector('#win30-accuracy');
    const statsEl = card.querySelector('.w-sub')  || card.querySelector('#win30-stats');
    if (!url || !accEl || !statsEl) return;

    try {
      const data = await fetchJSON(url);

      let wins = 0, losses = 0;

      // Preferred: /api/results -> { days:[{date,picks:[...] }], summary:{...} }
      if (data && Array.isArray(data.days)) {
        // If the items have "picks" arrays, use those (free/hero/pro unified output)
        const hasPicksArrays = data.days.some(d => Array.isArray(d?.picks));
        if (hasPicksArrays) {
          const c = countFromPicksDays(data.days);
          wins = c.wins; losses = c.losses;
        } else {
          // Legacy Pro-Board aggregate shape
          const c = countFromProTotals(data.days);
          wins = c.wins; losses = c.losses;
        }
      }
      // Fallback: a summary object with wins/losses
      else if (data && data.summary && (data.summary.wins != null)) {
        wins   = Number(data.summary.wins   || 0);
        losses = Number(data.summary.losses || 0);
      }

      const total = wins + losses;
      const acc = total ? Math.round((wins / total) * 100) : 0;
      accEl.textContent   = `${acc}%`;
      statsEl.textContent = total
        ? `${wins} wins / ${losses} losses (${total} picks)`
        : 'No recent data';
    } catch {
      if (accEl)   accEl.textContent = '—';
      if (statsEl) statsEl.textContent = 'No recent data';
    }
  }

  cards.forEach(fillCard);
})();
