// /public/results.js
// Results page logic: manual seed + optional API merge, safe DOM updates.

(function () {
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // ----- SAFE DOM HELPERS -----
  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => {
    const n = $(id);
    if (n) n.textContent = val;
  };

  // ======== MANUAL SEED ========
  // ======== MANUAL SEED ========
const MANUAL_RESULTS = [
  // 2025-10-06
  { date:"2025-10-06", home:"Dragonas IDV W", away:"Santa Fe W",           market:"Under 2.5", odds:1.55, status:"win" },

  // 2025-10-05
  { date:"2025-10-05", home:"Linköping",            away:"Brommapojkarna W", market:"Over 2.5", odds:1.57, status:"win" },
  { date:"2025-10-05", home:"Go Ahead Eagles",      away:"NEC Nijmegen",     market:"Over 2.5", odds:1.44, status:"lose" },

  // 2025-10-04
  { date:"2025-10-04", home:"Eintracht Frankfurt",  away:"Bayern München",   market:"Over 2.5", odds:1.25, status:"win" },
  { date:"2025-10-04", home:"Skanste",              away:"Leevon / PPK",     market:"Over 2.5", odds:1.79, status:"lose" },

  // 2025-10-03
  { date:"2025-10-03", home:"1899 Hoffenheim",      away:"1.FC Köln",        market:"Over 2.5", odds:1.57, status:"lose" },
  { date:"2025-10-03", home:"Buckley Town",         away:"Newtown AFC",      market:"Over 2.5", odds:1.44, status:"win" },

  // 2025-10-02
  { date:"2025-10-02", home:"Tampines (Sgp)",       away:"Pathum United (Tha)", market:"Over 2.5", odds:1.60, status:"win" },
  { date:"2025-10-02", home:"Panathinaikos",        away:"G.A. Eagles",         market:"Over 2.5", odds:1.57, status:"win" },

  // 2025-10-01
  { date:"2025-10-01", home:"FC Schaffhausen",      away:"Zürich II",        market:"Over 2.5", odds:1.40, status:"lose" },
  { date:"2025-10-01", home:"Bayer Leverkusen",     away:"PSV Eindhoven",    market:"Over 2.5", odds:1.53, status:"lose" },

  // 2025-09-30
  { date:"2025-09-30", home:"Galatasaray",          away:"Liverpool",        market:"Over 2.5", odds:1.40, status:"lose" },
  { date:"2025-09-30", home:"Iskra",                away:"Congaz",           market:"Over 2.5", odds:1.60, status:"win" },

  // 2025-09-29
  { date:"2025-09-29", home:"Dortmund W",           away:"Bayern Munich W",  market:"Over 2.5", odds:2.00, status:"lose" },
  { date:"2025-09-29", home:"Utsikten",             away:"IK Brage",         market:"Over 2.5", odds:1.67, status:"win" },

  // keep seed
  { date:"2025-09-28", home:"SC Freiburg",          away:"1899 Hoffenheim",  market:"Over 2.5", odds:1.62, status:"lose" },
  { date:"2025-09-28", home:"Rosengård W",          away:"Brommapojkarna W", market:"Over 2.5", odds:1.53, status:"win" },
  { date:"2025-09-27", home:"Ogre United",          away:"Smiltene",         market:"Over 2.5", odds:1.40, status:"lose" },
  { date:"2025-09-27", home:"Piast Gliwice",        away:"Nieciecza",        market:"Under 2.5", odds:1.90, status:"lose" },
  { date:"2025-09-26", home:"Fanalamanga",          away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
  { date:"2025-09-26", home:"Tukums II",            away:"Riga Mariners",    market:"Over 2.5", odds:1.33, status:"win" },
  { date:"2025-09-25", home:"Johor Darul Takzim FC", away:"Bangkok United",  market:"Over 2.5", odds:1.44, status:"win" },
  { date:"2025-09-25", home:"Nam Dinh",             away:"Svay Rieng",       market:"Over 2.5", odds:1.90, status:"win" },
  { date:"2025-09-24", home:"VfL Wolfsburg W",      away:"Werder Bremen W",  market:"Over 2.5", odds:1.57, status:"win" },
  { date:"2025-09-24", home:"Kabel Novi Sad",       away:"Semendrija 1924",  market:"Under 2.5", odds:1.44, status:"lose" },
  { date:"2025-09-23", home:"Miedź Legnica II",     away:"Świt Skolwin",     market:"Over 2.5", odds:1.55, status:"win" },
  { date:"2025-09-23", home:"Cagliari",             away:"Frosinone",        market:"Under 2.5", odds:1.80, status:"lose" },
  { date:"2025-09-22", home:"Barcelona Atlètic",    away:"Castellón B",      market:"Over 2.5", odds:1.60, status:"win" },
  { date:"2025-09-21", home:"Rēzekne FA",           away:"Skanste",          market:"Over 2.5", odds:1.45, status:"win" },
  { date:"2025-09-21", home:"Häcken W",             away:"Rosengård W",      market:"Over 2.5", odds:1.73, status:"win" },
  { date:"2025-09-20", home:"1899 Hoffenheim",      away:"Bayern München",   market:"Over 2.5", odds:1.35, status:"win" },
  { date:"2025-09-20", home:"Ogre United",          away:"Riga Mariners",    market:"Over 2.5", odds:1.65, status:"win" },
  { date:"2025-09-17", home:"Cham",                 away:"Vevey Sports",     market:"Over 2.5", odds:1.54, status:"win" },
  { date:"2025-09-17", home:"Rothis",               away:"Sturm Graz",       market:"Over 2.5", odds:1.20, status:"lose" },
  { date:"2025-09-16", home:"Tonbridge Angels",     away:"Steyning Town",    market:"Over 2.5", odds:1.67, status:"win" },
  { date:"2025-09-16", home:"Rylands",              away:"Ashton United",    market:"Under 2.5", odds:1.80, status:"win" },
  { date:"2025-09-16", home:"Sharjah FC",           away:"Al-Gharafa",       market:"Over 2.5", odds:1.70, status:"win" },
  { date:"2025-09-14", home:"Pitea W",              away:"Brommapojkarna W", market:"Over 2.5", odds:1.69, status:"win" },
  { date:"2025-09-14", home:"Marupe",               away:"JDFS Alberts",     market:"Over 2.5", odds:1.47, status:"win" }
];


  // ---------- Helpers ----------
  const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);

  function computeStats(picks) {
    let wins = 0,
      losses = 0,
      stake = 0,
      pnl = 0;
    for (const p of picks) {
      const s = String(p.status || "").toLowerCase();
      if (s === "win") wins++;
      else if (s === "lose" || s === "loss") losses++;
      if (typeof p.odds === "number") {
        stake += 1;
        if (s === "win") pnl += p.odds - 1;
        else if (s === "lose" || s === "loss") pnl -= 1;
      }
    }
    const settled = wins + losses;
    const winRate = settled ? (wins / settled) * 100 : null;
    const roiPct = stake ? (pnl / stake) * 100 : null;
    return { wins, losses, settled, winRate, roiPct, stake, pnl };
  }

  function streaks(picks) {
    // best W streak (oldest->newest)
    let best = 0,
      cur = 0;
    for (const p of picks) {
      const s = String(p.status || "").toLowerCase();
      if (s === "win") {
        cur += 1;
        best = Math.max(best, cur);
      } else if (s === "lose" || s === "loss") {
        cur = 0;
      }
    }
    // current streak from newest back (W as +, L as -)
    let current = 0;
    for (let i = picks.length - 1; i >= 0; i--) {
      const s = String(picks[i].status || "").toLowerCase();
      if (s === "win") {
        if (current >= 0) current += 1;
        else break;
      } else if (s === "lose" || s === "loss") {
        if (current <= 0) current -= 1;
        else break;
      } else break;
    }
    return { best, current };
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }
  function toDate(s) {
    const [y, m, d] = String(s).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function inLastNDays(p, n) {
    return toDate(p.date) >= daysAgo(n);
  }

  // ---------- Fetch remote (/api/results) then merge (safe) ----------
  async function fetchRemote(days = 180) {
    try {
      const r = await fetch(`/api/results?kind=free&days=${encodeURIComponent(days)}`, {
        cache: "no-store"
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return Array.isArray(data?.picks) ? data.picks : [];
    } catch {
      return [];
    }
  }

  function dedupeMerge(manual, remote) {
    const map = new Map();
    const keyOf = (p) => `${p.date}#${p.home}#${p.away}#${String(p.market || "").toLowerCase()}`;
    manual.forEach((p) => map.set(keyOf(p), p));
    remote.forEach((p) => map.set(keyOf(p), p));
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  (async function init() {
    const remote = await fetchRemote(180); // [] if API 500s
    const MERGED = dedupeMerge(MANUAL_RESULTS, remote);

    // Only show from Sep 2025 onward (your seed)
    const MIN_MONTH = "2025-09";
    const ALLOWED_RESULTS = MERGED.filter((r) => (r.date || "") >= MIN_MONTH);

    // ===== Summary KPIs =====
    const allStats = computeStats(ALLOWED_RESULTS);
    setText("s-total", String(ALLOWED_RESULTS.length));
    setText("s-wins", String(allStats.wins));
    setText("s-losses", String(allStats.losses));

    // Monthly (last 30d)
    const last30 = ALLOWED_RESULTS.filter((p) => inLastNDays(p, 30));
    const s30 = computeStats(last30);
    setText("s-mwin", fmtPct(s30.winRate)); // FIXED ID
    setText("s-mroi", fmtPct(s30.roiPct));  // FIXED ID

    // YTD
    const year = new Date().getFullYear();
    const yearPicks = ALLOWED_RESULTS.filter((r) => String(r.date || "").startsWith(String(year)));
    const yStats = computeStats(yearPicks.length ? yearPicks : ALLOWED_RESULTS);
    setText("s-ywin", fmtPct(yStats.winRate)); // FIXED ID
    setText("s-yroi", fmtPct(yStats.roiPct));  // FIXED ID

    // ===== Secondary KPIs =====
    const st = streaks(ALLOWED_RESULTS);
    setText("k-streak", st.current > 0 ? `${st.current}W` : st.current < 0 ? `${-st.current}L` : "—");
    setText("k-best", st.best ? `${st.best}W` : "—");
    const last7 = ALLOWED_RESULTS.filter((p) => inLastNDays(p, 7));
    const s7 = computeStats(last7);
    setText("k-7d", fmtPct(s7.winRate));
    setText("k-30roi", fmtPct(s30.roiPct));
    // CLV (k-clv) left as '—' unless you add closing odds

    // ===== Historical ROI by Market =====
    const tb = document.querySelector("#roiMarketTbl tbody");
    if (tb) {
      const m = new Map();
      for (const p of ALLOWED_RESULTS) {
        const key = p.market || "—";
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(p);
      }
      const rows = [];
      for (const [market, arr] of m.entries()) {
        const s = computeStats(arr);
        rows.push({ market, picks: s.settled, win: s.winRate, roi: s.roiPct });
      }
      rows.sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1));
      tb.innerHTML = rows
        .map(
          (r) => `
        <tr>
          <td><strong>${r.market}</strong></td>
          <td>${r.picks}</td>
          <td>${r.win != null ? r.win.toFixed(1) + "%" : "—"}</td>
          <td>${r.roi != null ? r.roi.toFixed(1) + "%" : "—"}</td>
        </tr>`
        )
        .join("");
    }

    // ===== ROI Simulator =====
    const elStake = $("simStake");
    const elRange = $("simRange");
    const simRunBtn = $("simRun");
    const simExport = $("simExport");

    function filterRange(range) {
      if (range === "all") return ALLOWED_RESULTS;
      const n = Number(range) || 30;
      return ALLOWED_RESULTS.filter((p) => inLastNDays(p, n));
    }
    function runSimulator() {
      if (!elStake || !elRange) return;
      const stake = Math.max(0, Number(elStake.value) || 0);
      const range = elRange.value;
      const picks = filterRange(range).filter((p) => typeof p.odds === "number");
      let wins = 0,
        losses = 0,
        stTot = 0,
        pnl = 0;
      for (const p of picks) {
        const s = String(p.status || "").toLowerCase();
        stTot += stake;
        if (s === "win") {
          wins++;
          pnl += stake * (p.odds - 1);
        } else if (s === "lose" || s === "loss") {
          losses++;
          pnl -= stake;
        }
      }
      const settled = wins + losses;
      const winrate = settled ? (wins / settled) * 100 : null;
      const roi = stTot ? (pnl / stTot) * 100 : null;

      setText("simPicks", String(settled));
      setText("simWins", String(wins));
      setText("simLosses", String(losses));
      setText("simWinrate", fmtPct(winrate));
      setText("simStakeSum", stTot.toFixed(2));
      setText("simPnL", pnl.toFixed(2));
      setText("simROI", fmtPct(roi));

      window.__simLast = { picks, stake };
    }
    function exportCSV() {
      const data = window.__simLast || { picks: [], stake: 1 };
      const stake = data.stake || 1;
      const rows = [["Date", "Home", "Away", "Market", "Odds", "Result", "Stake", "Return"]];
      for (const p of data.picks) {
        const s = String(p.status || "").toLowerCase();
        const ret = s === "win" ? stake * p.odds : s === "lose" || s === "loss" ? 0 : "";
        rows.push([
          p.date,
          p.home,
          p.away,
          p.market,
          typeof p.odds === "number" ? p.odds.toFixed(2) : "",
          s.toUpperCase(),
          stake,
          ret
        ]);
      }
      const csv = rows
        .map((r) =>
          r
            .map((v) => {
              const x = v == null ? "" : String(v);
              return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
            })
            .join(",")
        )
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "overedge_bet_slip.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
    }

    if (simRunBtn) simRunBtn.addEventListener("click", runSimulator);
    if (simExport) simExport.addEventListener("click", exportCSV);
    runSimulator();

    // ===== Month dropdown + list =====
    const byMonth = new Map();
    ALLOWED_RESULTS.forEach((p) => {
      const d = new Date(p.date);
      const key = d.toLocaleDateString(undefined, { year: "numeric", month: "long" }); // e.g., "September 2025"
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(p);
    });

    const monthSelect = $("monthSelect");
    if (monthSelect) {
      const keys = Array.from(byMonth.keys()).sort((a, b) => new Date(b) - new Date(a));
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = "All months";
      monthSelect.appendChild(allOpt);
      keys.forEach((k) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = k;
        monthSelect.appendChild(opt);
      });
      monthSelect.value = keys[0] || "all";
    }

    function computeMonthStats(picks) {
      const s = computeStats(picks);
      return `Picks: <strong>${s.settled}</strong> · Win%: <strong>${fmtPct(s.winRate)}</strong> · ROI: <strong>${fmtPct(
        s.roiPct
      )}</strong>`;
    }

    function showMonthStats(key) {
      let picks;
      if (key === "all" || !key) picks = ALLOWED_RESULTS;
      else picks = byMonth.get(key) || [];
      const target = $("monthStats");
      if (target) target.innerHTML = picks.length ? computeMonthStats(picks) : "No data";
    }

    function renderAllMonths() {
      const host = $("list");
      if (!host) return;
      host.innerHTML = "";

      const keys = Array.from(byMonth.keys()).sort((a, b) => new Date(b) - new Date(a));
      keys.forEach((k) => {
        const list = byMonth.get(k) || [];

        // group by date
        const byDate = {};
        list.forEach((p) => {
          (byDate[p.date] ||= []).push(p);
        });
        const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

        // month header with stats
        const mStats = computeStats(list);
        const wrap = document.createElement("section");
        wrap.innerHTML = `
          <div class="date-head" style="display:flex;justify-content:space-between;align-items:baseline">
            <span>${k}</span>
            <span class="muted-sm">
              Picks: <strong>${mStats.settled}</strong> ·
              Win%: <strong>${fmtPct(mStats.winRate)}</strong> ·
              ROI: <strong>${fmtPct(mStats.roiPct)}</strong>
            </span>
          </div>
        `;

        dates.forEach((d) => {
          const picks = byDate[d];
          const block = document.createElement("div");
          block.innerHTML = `
            <div class="muted-sm" style="margin:.35rem 0 .2rem;"><strong>${d}</strong></div>
            <table class="tbl">
              <thead>
                <tr><th>Match</th><th>Market</th><th>Odds</th><th>Result</th></tr>
              </thead>
              <tbody>
                ${picks
                  .map(
                    (p) => `
                  <tr>
                    <td><strong>${p.home}</strong> vs <strong>${p.away}</strong></td>
                    <td><strong>${p.market || (p.selection ? p.selection : "")}</strong></td>
                    <td>${typeof p.odds === "number" ? p.odds.toFixed(2) : "—"}</td>
                    <td>${(function (status) {
                      const s = String(status || "").toLowerCase();
                      if (s === "win") return '<span class="wl-pill wl-win">WIN</span>';
                      if (s === "loss" || s === "lose") return '<span class="wl-pill wl-lose">LOSE</span>';
                      return "—";
                    })(p.status)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          `;
          wrap.appendChild(block);
        });

        host.appendChild(wrap);
      });
    }

    if (monthSelect) {
      showMonthStats(monthSelect.value);
      monthSelect.addEventListener("change", (e) => showMonthStats(e.target.value));
    }
    renderAllMonths();
  })();
})();
