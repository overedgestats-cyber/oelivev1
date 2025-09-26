// /public/winrate.js
// Finds every .win30 card and fills accuracy + W/L for the last 30 calendar days.
// Supports endpoints:
//   - /api/rpc?action=free-picks-results
//   - /api/rpc?action=hero-bet-results
//   - /api/rpc?action=pro-board-results

(async function () {
  const cards = Array.from(document.querySelectorAll('.win30'));
  if (!cards.length) return;

  // [today-29 .. today] inclusive window; string compare on YYYY-MM-DD is OK
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const ymd = d => d.toISOString().slice(0, 10);
  const startYMD = ymd(start);
  const endYMD   = ymd(today);

  for (const card of cards) {
    const url = card.getAttribute('data-endpoint');
    const accEl   = card.querySelector('.w-pill') || card.querySelector('#win30-accuracy');
    const statsEl = card.querySelector('.w-sub')  || card.querySelector('#win30-stats');

    if (!url || !accEl || !statsEl) continue;

    try {
      const r = await fetch(url, { cache: 'no-store' });
      const data = await r.json();

      let wins = 0, losses = 0;

      if (data && Array.isArray(data.days)) {
        // Shape A: { days: [{ date:'YYYY-MM-DD', picks:[{status,...},...] }], summary: {...} }
        // (Free Picks, Hero Bet)
        const recent = data.days.filter(d =>
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
      } else if (data && Array.isArray(data.days) === false && data.summary && data.summary.wins != null) {
        // Fallback (not used by our RPCs but kept for safety)
        wins   = Number(data.summary.wins   || 0);
        losses = Number(data.summary.losses || 0);
      } else if (data && data.days && Array.isArray(data.days)) {
        // (Not hit; both Free/Hero above)
      } else if (data && data.days === undefined && data.length) {
        // Legacy arrays (not used here)
      } else if (data && data.days) {
        // Shouldn’t occur; defensive
      }

      // Pro Board endpoint: { days:[{ date, totals:{ market:{wins,losses,push}... }, combined:{wins,losses,push}}] }
      if (data && Array.isArray(data.days) && /pro-board-results/i.test(url)) {
        wins = 0; losses = 0;
        const recent = data.days.filter(d =>
          typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
        );
        for (const d of recent) {
          if (d.combined && (d.combined.wins != null)) {
            wins   += Number(d.combined.wins   || 0);
            losses += Number(d.combined.losses || 0);
          } else if (d.totals) {
            // Sum every market = “all bets for each game”
            for (const k of Object.keys(d.totals)) {
              const row = d.totals[k] || {};
              wins   += Number(row.wins   || 0);
              losses += Number(row.losses || 0);
            }
          }
        }
      }

      const total = wins + losses;
      const acc = total ? Math.round((wins / total) * 100) : 0;

      accEl.textContent   = `${acc}%`;
      statsEl.textContent = total
        ? `${wins} wins / ${losses} losses (${total} picks)`
        : 'No recent data';
    } catch (e) {
      accEl.textContent   = '—';
      statsEl.textContent = 'No recent data';
    }
  }
})();
