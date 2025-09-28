// /public/simulator.js
// Widgets for Pro Board results (reads /api/rpc?action=pro-board-results&limit=60)

(function () {
  const el = (id) => document.getElementById(id);
  const fmtPct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
  const hasNum = (x) => typeof x === "number" && Number.isFinite(x);

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

  /* ========= helpers to compute from days when summary missing ========= */
  function sumFromDays(days = []) {
    let wins = 0, losses = 0, push = 0;
    for (const d of days) {
      const T = d?.totals || {};
      for (const k of Object.keys(T)) {
        wins   += Number(T[k]?.wins   || 0);
        losses += Number(T[k]?.losses || 0);
        push   += Number(T[k]?.push   || 0);
      }
    }
    const settled = wins + losses;
    const winRate = settled ? Math.round((wins / settled) * 100) : null;
    return { totalDays: days.length, wins, losses, push, winRate, roiPct: null };
  }

  /* ========= Overall ROI / Win% (from summary; fallback compute) ========= */
  async function initROI(url, hostId) {
    const host = el(hostId);
    if (!host) return;
    host.innerHTML = "Loading…";

    const data = await getJSON(url);
    const s = data?.summary || null;

    if (!s && (!data || !Array.isArray(data.days) || !data.days.length)) {
      host.innerHTML = card("ROI (last 60 days)", `<p class="muted">No data yet.</p>`);
      return;
    }

    const S = s || sumFromDays(data.days || []);
    const html = `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span class="pill">Days: <strong>${S.totalDays ?? "—"}</strong></span>
        <span class="pill">Wins: <strong>${S.wins ?? 0}</strong></span>
        <span class="pill">Losses: <strong>${S.losses ?? 0}</strong></span>
        <span class="pill">Push: <strong>${S.push ?? 0}</strong></span>
        <span class="pill">Win%: <strong>${fmtPct(S.winRate)}</strong></span>
        <span class="pill">ROI: <strong>${fmtPct(S.roiPct)}</strong></span>
      </div>
      <style>.pill{display:inline-block;padding:.22rem .55rem;border:1px solid #e5e7eb;border-radius:999px;font-weight:800}</style>
      <div class="muted-sm" style="margin-top:.5rem">
        Pro Board storage doesn’t include odds yet, so ROI may show “—”. Win% excludes pushes.
      </div>
    `;
    host.innerHTML = card("ROI (last 60 days)", html);
  }

  /* ========= ROI by Market (Win% only — board has no odds) ========= */
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
        a.wins   += Number(row?.wins   || 0);
        a.losses += Number(row?.losses || 0);
        a.push   += Number(row?.push   || 0);
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
        Pro Board storage doesn’t include odds yet, so per-market ROI is shown as Win% only.
      </div>
    `;
    host.innerHTML = card("ROI by Market", table);
  }

  /* ========= CLV (placeholder until closing odds exist) ========= */
  async function initCLV(_url, hostId) {
    const host = el(hostId);
    if (!host) return;
    host.innerHTML = card(
      "CLV (Closing Line Value)",
      `<p class="muted">No closing-odds data yet. Once picks include <code>odds</code> and <code>closing</code>, we’ll compute average edge and beat-close rate here.</p>`
    );
  }

  // Expose to pro.html
  window.OE_Sim = { initROI, initROIByMarket, initCLV };
})();
