// public/winrate.js
(async function () {
  const box = document.querySelector('.win30');
  if (!box) return;

  const url = box.getAttribute('data-endpoint');
  const accEl = document.getElementById('win30-accuracy');
  const statsEl = document.getElementById('win30-stats');

  // Inclusive [today-29 .. today] window in YYYY-MM-DD
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const ymd = d => d.toISOString().slice(0, 10);
  const startYMD = ymd(start);
  const endYMD = ymd(today);

  try {
    const r = await fetch(url, { cache: 'no-store' });
    const data = await r.json();

    let wins = 0, losses = 0;

    if (Array.isArray(data)) {
      // Fallback: array of { result: 'win'|'loss'|'pending' }
      const settled = data.filter(x => /win|loss/i.test(String(x.result)));
      wins = settled.filter(x => /win/i.test(String(x.result))).length;
      losses = settled.length - wins;
    } else if (data && Array.isArray(data.days)) {
      // Preferred: { days: [{ date: 'YYYY-MM-DD', picks: [...] }], ... }
      const recent = data.days.filter(
        d => typeof d.date === 'string' && d.date >= startYMD && d.date <= endYMD
      );
      for (const d of recent) {
        const picks = Array.isArray(d.picks) ? d.picks : [];
        for (const p of picks) {
          const st = String(p.status || '').toLowerCase();
          if (st === 'win') wins += 1;
          else if (st === 'loss' || st === 'lose') losses += 1;
        }
      }
    } else {
      // Fallback: { wins, total }
      const total = Number(data?.total || 0);
      wins = Number(data?.wins || 0);
      losses = Math.max(0, total - wins);
    }

    const total = wins + losses;
    const acc = total ? Math.round((wins / total) * 100) : 0;

    accEl.textContent = `${acc}%`;
    statsEl.textContent = `${wins} wins / ${losses} losses (${total} picks)`;
  } catch (e) {
    accEl.textContent = '—';
    statsEl.textContent = 'No recent data';
  }
})();
