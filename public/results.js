// public/results.js — Cards + ROI calc + market table + monthly accordion (manual data only)

(function () {
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // ======== MANUAL SEED (edit daily) ========
  const MANUAL_RESULTS = [
    // 2025-10-21
    { date:"2025-10-21", home:"Tesla Stropkov",     away:"Liptovsky Mikulas", market:"Over 2.5", odds:1.50, status:"win" },
    { date:"2025-10-21", home:"Malecnik",           away:"Kamnik",            market:"Over 2.5", odds:1.44, status:"win" },

    // 2025-10-19
    { date:"2025-10-19", home:"Freiburg",           away:"Eintracht Frankfurt", market:"Over 2.5", odds:1.62, status:"win" },
    { date:"2025-10-19", home:"Brommapojkarna W",   away:"Häcken W",            market:"Over 2.5", odds:1.36, status:"win" },

    // 2025-10-18
    { date:"2025-10-18", home:"AFA Olaine", away:"Skanste",            market:"Over 2.5", odds:1.36, status:"win" },
    { date:"2025-10-18", home:"Sarpsborg 08 FF", away:"Bodo/Glimt",    market:"Over 2.5", odds:1.33, status:"win" },

    // 2025-10-17
    { date:"2025-10-17", home:"Wests APIA", away:"Sydney United", market:"Under 2.5", odds:2.03, status:"lose" },
    { date:"2025-10-17", home:"Linköping",  away:"AIK",            market:"Over 2.5", odds:1.61, status:"win" },

    // 2025-10-06
    { date:"2025-10-06", home:"Dragonas IDV W", away:"Santa Fe W",           market:"Under 2.5", odds:1.55, status:"win" },

    // 2025-10-05
    { date:"2025-10-05", home:"Linköping",       away:"Brommapojkarna W", market:"Over 2.5", odds:1.57, status:"win" },
    { date:"2025-10-05", home:"Go Ahead Eagles", away:"NEC Nijmegen",     market:"Over 2.5", odds:1.44, status:"lose" },

    // 2025-10-04
    { date:"2025-10-04", home:"Eintracht Frankfurt", away:"Bayern München",   market:"Over 2.5", odds:1.25, status:"win" },
    { date:"2025-10-04", home:"Skanste",             away:"Leevon / PPK",     market:"Over 2.5", odds:1.79, status:"lose" },

    // 2025-10-03
    { date:"2025-10-03", home:"1899 Hoffenheim", away:"1.FC Köln",   market:"Over 2.5", odds:1.57, status:"lose" },
    { date:"2025-10-03", home:"Buckley Town",    away:"Newtown AFC", market:"Over 2.5", odds:1.44, status:"win" },

    // 2025-10-02
    { date:"2025-10-02", home:"Tampines (Sgp)", away:"Pathum United (Tha)", market:"Over 2.5", odds:1.60, status:"win" },
    { date:"2025-10-02", home:"Panathinaikos",  away:"G.A. Eagles",         market:"Over 2.5", odds:1.57, status:"win" },

    // 2025-10-01
    { date:"2025-10-01", home:"FC Schaffhausen", away:"Zürich II",     market:"Over 2.5", odds:1.40, status:"lose" },
    { date:"2025-10-01", home:"Bayer Leverkusen", away:"PSV Eindhoven", market:"Over 2.5", odds:1.53, status:"lose" },

    // 2025-09-30
    { date:"2025-09-30", home:"Galatasaray", away:"Liverpool", market:"Over 2.5", odds:1.40, status:"lose" },
    { date:"2025-09-30", home:"Iskra",       away:"Congaz",    market:"Over 2.5", odds:1.60, status:"win" },

    // 2025-09-29
    { date:"2025-09-29", home:"Dortmund W", away:"Bayern Munich W", market:"Over 2.5", odds:2.00, status:"lose" },
    { date:"2025-09-29", home:"Utsikten",   away:"IK Brage",        market:"Over 2.5", odds:1.67, status:"win" },

    // 2025-09-28
    { date:"2025-09-28", home:"SC Freiburg", away:"1899 Hoffenheim",  market:"Over 2.5", odds:1.62, status:"lose" },
    { date:"2025-09-28", home:"Rosengård W", away:"Brommapojkarna W", market:"Over 2.5", odds:1.53, status:"win" },

    // 2025-09-27
    { date:"2025-09-27", home:"Ogre United",   away:"Smiltene",  market:"Over 2.5",  odds:1.40, status:"lose" },
    { date:"2025-09-27", home:"Piast Gliwice", away:"Nieciecza", market:"Under 2.5", odds:1.90, status:"lose" },

    // 2025-09-26
    { date:"2025-09-26", home:"Fanalamanga", away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
    { date:"2025-09-26", home:"Tukums II",   away:"Riga Mariners",     market:"Over 2.5",  odds:1.33, status:"win" },

    // 2025-09-25
    { date:"2025-09-25", home:"Johor Darul Takzim FC", away:"Bangkok United", market:"Over 2.5", odds:1.44, status:"win" },
    { date:"2025-09-25", home:"Nam Dinh",              away:"Svay Rieng",     market:"Over 2.5", odds:1.90, status:"win" },

    // 2025-09-24
    { date:"2025-09-24", home:"VfL Wolfsburg W", away:"Werder Bremen W",  market:"Over 2.5",  odds:1.57, status:"win" },
    { date:"2025-09-24", home:"Kabel Novi Sad",  away:"Semendrija 1924",  market:"Under 2.5", odds:1.44, status:"lose" },

    // 2025-09-23
    { date:"2025-09-23", home:"Miedź Legnica II", away:"Świt Skolwin",     market:"Over 2.5",  odds:1.55, status:"win" },
    { date:"2025-09-23", home:"Cagliari",         away:"Frosinone",        market:"Under 2.5", odds:1.80, status:"lose" },

    // 2025-09-22
    { date:"2025-09-22", home:"Barcelona Atlètic", away:"Castellón B",      market:"Over 2.5",  odds:1.60, status:"win" },

    // 2025-09-21
    { date:"2025-09-21", home:"Rēzekne FA", away:"Skanste",     market:"Over 2.5",  odds:1.45, status:"win" },
    { date:"2025-09-21", home:"Häcken W",   away:"Rosengård W", market:"Over 2.5",  odds:1.73, status:"win" },

    // 2025-09-20
    { date:"2025-09-20", home:"1899 Hoffenheim", away:"Bayern München",   market:"Over 2.5",  odds:1.35, status:"win" },
    { date:"2025-09-20", home:"Ogre United",     away:"Riga Mariners",    market:"Over 2.5",  odds:1.65, status:"win" },

    // 2025-09-17
    { date:"2025-09-17", home:"Cham",   away:"Vevey Sports", market:"Over 2.5",  odds:1.54, status:"win" },
    { date:"2025-09-17", home:"Rothis", away:"Sturm Graz",   market:"Over 2.5",  odds:1.20, status:"lose" },

    // 2025-09-16
    { date:"2025-09-16", home:"Tonbridge Angels", away:"Steyning Town",    market:"Over 2.5",  odds:1.67, status:"win" },
    { date:"2025-09-16", home:"Rylands",          away:"Ashton United",    market:"Under 2.5", odds:1.80, status:"win" },
    { date:"2025-09-16", home:"Sharjah FC",       away:"Al-Gharafa",       market:"Over 2.5",  odds:1.70, status:"win" },

    // 2025-09-14
    { date:"2025-09-14", home:"Pitea W", away:"Brommapojkarna W", market:"Over 2.5",  odds:1.69, status:"win" },
    { date:"2025-09-14", home:"Marupe",  away:"JDFS Alberts",     market:"Over 2.5",  odds:1.47, status:"win" }
  ];

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const n = $(id); if (n) n.textContent = val; };
  const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);
  const toDate = (s) => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
  const monthKey = (s) => s.slice(0, 7); // YYYY-MM
  const monthLabel = (s) => new Date(s + "-01").toLocaleString(undefined, { month: "long", year: "numeric" });
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const inLastNDays = (p, n) => toDate(p.date) >= daysAgo(n);

  // stats: ignore push/void in win% and ROI; flat 1u where odds is numeric
  function computeStats(picks) {
    let wins = 0, losses = 0, stake = 0, pnl = 0;
    for (const p of picks) {
      const st = String(p.status || "").toLowerCase();
      if (st === "win") {
        wins++; if (typeof p.odds === "number") { stake += 1; pnl += (p.odds - 1); }
      } else if (st === "lose" || st === "loss") {
        losses++; if (typeof p.odds === "number") { stake += 1; pnl -= 1; }
      }
      // push/void ignored
    }
    const settled = wins + losses;
    const winPct = settled ? (wins / settled) * 100 : null;
    const roiPct = stake ? (pnl / stake) * 100 : null;
    return { settled, wins, losses, winPct, roiPct, stake, pnl };
  }

  (function init() {
    // show from Sep 2025 onward (seed start)
    const MIN_MONTH = "2025-09";
    const ALL = MANUAL_RESULTS
      .filter(r => (r.date || "") >= MIN_MONTH)
      .sort((a,b) => a.date.localeCompare(b.date));

    // ===== Headline cards =====
    // YTD
    const year = new Date().getFullYear();
    const ytd = ALL.filter(r => String(r.date || "").startsWith(String(year)));
    const yStats = computeStats(ytd.length ? ytd : ALL);
    setText("y-win", fmtPct(yStats.winPct));
    setText("y-roi", fmtPct(yStats.roiPct));

    // Current calendar month
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const thisMonth = ALL.filter(r => String(r.date || "").startsWith(ym));
    const mStats = computeStats(thisMonth);
    setText("m-win", fmtPct(mStats.winPct));
    setText("m-roi", fmtPct(mStats.roiPct));

    // ===== ROI Calculator =====
    const elStake = $("simStake");
    const elRange = $("simRange");
    const simRunBtn = $("simRun");
    const simExport = $("simExport");

    function filterRange(range) {
      if (range === "all") return ALL;
      const n = Number(range) || 30;
      return ALL.filter((p) => inLastNDays(p, n));
    }

    function runSimulator() {
      if (!elStake || !elRange) return;
      const stake = Math.max(0, Number(elStake.value) || 0);
      const range = elRange.value;
      const picks = filterRange(range).filter((p) => typeof p.odds === "number");

      let wins = 0, losses = 0, stTot = 0, pnl = 0;
      for (const p of picks) {
        const s = String(p.status || "").toLowerCase();
        if (s === "win") { wins++; stTot += stake; pnl += stake * (p.odds - 1); }
        else if (s === "lose" || s === "loss") { losses++; stTot += stake; pnl -= stake; }
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
      const rows = [["Date","Home","Away","Market","Odds","Result","Stake","Return"]];
      for (const p of data.picks) {
        const s = String(p.status || "").toLowerCase();
        const ret = s === "win" ? stake * p.odds : (s === "lose" || s === "loss") ? 0 : "";
        rows.push([p.date,p.home,p.away,p.market, typeof p.odds==="number"?p.odds.toFixed(2):"", s.toUpperCase(), stake, ret]);
      }
      const csv = rows.map(r=>r.map(v=>{
        const x = v==null? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g,'""')}"` : x;
      }).join(",")).join("\n");
      const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download="overedge_bet_slip.csv"; document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    }

    if (simRunBtn) simRunBtn.addEventListener("click", runSimulator);
    if (simExport) simExport.addEventListener("click", exportCSV);
    runSimulator();

    // ===== Historical Win% & ROI by Market =====
    const tb = document.querySelector("#roiMarketTbl tbody");
    if (tb) {
      const m = new Map();
      for (const p of ALL) {
        const key = p.market || "—";
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(p);
      }
      const rows = [];
      for (const [market, arr] of m.entries()) {
        const s = computeStats(arr);
        rows.push({ market, picks:s.settled, win:s.winPct, roi:s.roiPct });
      }
      rows.sort((a,b) => (b.roi ?? -1) - (a.roi ?? -1));
      tb.innerHTML = rows.map(r=>`
        <tr>
          <td><strong>${r.market}</strong></td>
          <td>${r.picks}</td>
          <td>${r.win != null ? r.win.toFixed(1) + "%" : "—"}</td>
          <td>${r.roi != null ? r.roi.toFixed(1) + "%" : "—"}</td>
        </tr>
      `).join("");
    }

    // ===== Monthly dropdown + accordion (kept) =====
    const byMonth = new Map();
    for (const p of ALL) {
      const k = monthKey(p.date);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(p);
    }
    const keys = Array.from(byMonth.keys()).sort().reverse();

    const selectEl = $("monthSelect");
    const statsEl  = $("monthStats");
    const listEl   = $("list");
    if (listEl) listEl.classList.add("months");

    if (selectEl) {
      selectEl.innerHTML =
        `<option value="all">All months</option>` +
        keys.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
      selectEl.value = "all";
    }

    const headerLine = (picks) => {
      const s = computeStats(picks);
      return `Picks: ${s.settled} · Win%: ${fmtPct(s.winPct)} · ROI: ${fmtPct(s.roiPct)}`;
    };

    function render(filterKey = "all") {
      if (statsEl) {
        const picks = (filterKey === "all") ? ALL : (byMonth.get(filterKey) || []);
        statsEl.textContent = headerLine(picks);
      }
      if (!listEl) return;
      const showKeys = (filterKey === "all") ? keys : keys.filter(k => k === filterKey);
      listEl.innerHTML = showKeys.map((k, idx) => {
        const picks = byMonth.get(k) || [];
        const s = computeStats(picks);
        const dayGroups = {};
        picks.forEach(p => { (dayGroups[p.date] ||= []).push(p); });
        const days = Object.keys(dayGroups).sort((a,b) => b.localeCompare(a));

        return `
          <details ${filterKey === "all" ? (idx === 0 ? "open" : "") : "open"}>
            <summary>
              <span class="m-title">${monthLabel(k)}</span>
              <span class="m-stats">Picks: <strong>${s.settled}</strong> ·
                Win%: <strong>${fmtPct(s.winPct)}</strong> ·
                ROI: <strong>${fmtPct(s.roiPct)}</strong>
              </span>
            </summary>
            <div class="m-inner">
              <table class="tbl">
                <thead><tr><th style="width:110px">Date</th><th>Picks</th></tr></thead>
                <tbody>
                  ${days.map(d => {
                    const arr = dayGroups[d];
                    const lines = arr.map(p => {
                      const st = String(p.status || "").toLowerCase();
                      const wl = st === "win" ? '<span class="wl-pill wl-win">WIN</span>'
                               : (st === "lose" || st === "loss") ? '<span class="wl-pill wl-lose">LOSE</span>'
                               : '<span class="wl-pill">PUSH</span>';
                      const odds = (typeof p.odds === "number") ? ` @ ${p.odds}` : "";
                      return `${wl} ${p.market || ""} — <strong>${p.home}</strong> vs <strong>${p.away}</strong>${odds}`;
                    }).join("<br/>");
                    return `<tr><td>${d}</td><td>${lines}</td></tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </details>
        `;
      }).join('');
    }

    render("all");
    if (selectEl) selectEl.addEventListener("change", e => render(e.target.value || "all"));
  })();
})();
