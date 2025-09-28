// /public/simulator.js
// Widgets for Pro Board results (reads /api/rpc?action=pro-board-results&limit=60)

(function () {
  const el = (id) => document.getElementById(id);
  const fmtPct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

  async function getJSON(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  function card(title, inner) {
    return `
      <div class="card" style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:14px 16px;box-shadow:0 6px 18px rgba(17,24,39,.06);">
        <h3 style="margin:0 0 .35rem">${title}</h3>
        ${inner}
      </div>
    `;
  }

  /* ========= Overall ROI (from summary) ========= */
  async function initROI(url, hostId) {
    const host = el(hostId);
    if (!host) return;
    host.innerHTML = "Loading…";

    const data = await getJSON(url);
    const s = data?.summary || null;

    if (!s) {
      host.innerHTML = card("ROI (last 60 days)", `<p class="muted">No data yet.</p>`);
      return;
    }

    const html = `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span class="pill">Days: <strong>${s.totalDays ?? "—"}</strong></span>
        <span class="pill">Wins: <strong>${s.wins ?? 0}</strong></span>
        <span class="pill">Losses: <strong>${s.losses ?? 0}</strong></span>
        <span class="pill">Push: <strong>${s.push ?? 0}</strong></span>
        <span class="pill">Win%: <strong>${fmtPct(s.winRate)}</strong></span>
        <span class="pill">ROI: <strong>${fmtPct(s.roiPct)}</strong></span>
      </div>
      <style>.pill{display:inline-block;padding:.22rem .55rem;border:1px solid #e5e7eb;border-radius:999px;font-weight:800}</style>
    `;
    host.innerHTML = card("ROI (last 60 days)", html);
  }

  /* ========= ROI by Market (wins only — board has no odds) ========= */
  async function initROIByMarket(url, hostId) {
    const host = el(hostId);
    if (!host) return;
    host.innerHTML = "Loading…";

    const data = await getJSON(url);
    const days = Array.isArray(data?.days) ? data.days : [];

    if (!days.length) {
      host.innerHTML = card("ROI by Market", `<p class="muted">No data yet.</p>`);
      return;
    }

    // Aggregate wins/losses by market from day.totals
    const agg = new Map(); // market -> {wins, losses, push}
    for (const d of days) {
      const T = d.totals || {};
      for (const [m, row] of Object.entries(T)) {
        if (!agg.has(m)) agg.set(m, { wins: 0, losses: 0, push: 0 });
        const a = agg.get(m);
        a.wins += Number(row?.wins || 0);
        a.losses += Number(row?.losses || 0);
        a.push += Number(row?.push || 0);
      }
    }

    const rows = [];
    for (const [market, a] of agg.entries()) {
      const settled = a.wins + a.losses;
      const win = settled ? (a.wins / settled) * 100 : null;
      rows.push({ market, picks: settled, win });
    }
    rows.sort((A, B) => (B.win ?? -1) - (A.win ?? -1));

    const table = `
      <table class="tbl" style="width:100%;border-collapse:separate;border-spacing:0">
        <thead><tr><th>Market</th><th>Picks</th><th>Win%</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td><strong>${r.market}</strong></td>
              <td>${r.picks}</td>
              <td>${r.win != null ? r.win.toFixed(1) + "%" : "—"}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="muted-sm" style="margin-top:.5rem">
        Pro Board storage doesn’t include odds yet, so ROI per market is shown as Win% only.
      </div>
    `;
    host.innerHTML = card("ROI by Market", table);
  }

  /* ========= CLV (placeholder until closing odds exist) ========= */
  async function initCLV(url, hostId) {
    const host = el(hostId);
    if (!host) return;
    host.innerHTML = "Loading…";

    // Pro Board results currently don’t store opening/closing odds → show placeholder.
    host.innerHTML = card(
      "CLV (Closing Line Value)",
      `<p class="muted">No closing-odds data yet. Once picks include <code>odds</code> and <code>closing</code>, we’ll compute average edge and beat-close rate here.</p>`
    );
  }

  // Expose to pro.html
  window.OE_Sim = { initROI, initROIByMarket, initCLV };
})();
