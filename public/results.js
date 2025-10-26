// public/results.js — Minimal monthly renderer (no KPIs, no simulator, no market table)

(function () {
  const y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  // ======== MANUAL SEED (keep editing this daily) ========
  const MANUAL_RESULTS = [
    // 2025-10-16
    { date:"2025-10-16", home:"PSG W",           away:"Real Madrid W",     market:"Over 2.5",  odds:1.53, status:"win" },
    { date:"2025-10-16", home:"Ferencvaros W",   away:"Sparta Praha W",    market:"Over 2.5",  odds:1.73, status:"win" },

    // 2025-10-15
    { date:"2025-10-15", home:"Vålerenga W",     away:"VfL Wolfsburg W",   market:"Over 2.5",  odds:1.36, status:"win" },
    { date:"2025-10-15", home:"Älvsjö AIK W",    away:"Brommapojkarna W",  market:"Over 2.5",  odds:1.45, status:"win" },

    // 2025-10-14
    { date:"2025-10-14", home:"Ivory Coast",     away:"Kenya",             market:"Under 2.5", odds:1.82, status:"lose" },
    { date:"2025-10-14", home:"Senegal",         away:"Mauritania",        market:"Under 2.5", odds:2.00, status:"lose" },

    // 2025-10-12
    { date:"2025-10-12", home:"Växjö",              away:"Piteå W",            market:"Over 2.5",  odds:1.67, status:"win" },
    { date:"2025-10-12", home:"La Unión Atlético",  away:"Linares Deportivo",  market:"Under 2.5", odds:1.44, status:"lose" },

    // 2025-10-13
    { date:"2025-10-13", home:"Deportivo Cali W",   away:"Sao Paulo W",        market:"Under 2.5", odds:1.65, status:"win" },
    { date:"2025-10-13", home:"Carshalton Athletic",away:"Burgess",            market:"Over 2.5",  odds:1.65, status:"win" },

    // 2025-10-11
    { date:"2025-10-11", home:"Gresford Athletic", away:"Buckley Town", market:"Over 2.5", odds:1.36, status:"win" },
    { date:"2025-10-11", home:"Zürich II", away:"Cham", market:"Over 2.5", odds:1.44, status:"lose" },

    // 2025-10-10
    { date:"2025-10-10", home:"Sudan",   away:"Mauritania",       market:"Under 2.5", odds:1.40, status:"win" },
    { date:"2025-10-10", home:"Clyde",   away:"Kilmarnock II",    market:"Over 2.5",  odds:1.40, status:"win" },

    // 2025-10-09
    { date:"2025-10-09", home:"Burundi", away:"Kenya",             market:"Under 2.5", odds:1.45, status:"win" },
    { date:"2025-10-09", home:"Malawi",  away:"Equatorial Guinea", market:"Under 2.5", odds:1.54, status:"void" },

    // 2025-10-08
    { date:"2025-10-08", home:"Rada W",          away:"Linköping W",     market:"Over 2.5", odds:1.55, status:"win" },
    { date:"2025-10-08", home:"Sparta Praha W",  away:"Ferencváros W",   market:"Over 2.5", odds:1.44, status:"win" },

    // 2025-10-07
    { date:"2025-10-07", home:"Arsenal W",       away:"Lyon W",          market:"Over 2.5", odds:1.44, status:"win" },
    { date:"2025-10-07", home:"Caernarfon",      away:"TNS",             market:"Over 2.5", odds:1.44, status:"win" },

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
  const $ = (id) => document.getElementById(id);
  const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);
  const toDate = (s) => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
  const monthKey = (s) => s.slice(0, 7); // YYYY-MM
  const monthLabel = (s) => new Date(s + "-01").toLocaleString(undefined, { month: "long", year: "numeric" });

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
    return { settled, wins, losses, winPct, roiPct };
  }

  (function init() {
    // Only show from Sep 2025 onward (your seed)
    const MIN_MONTH = "2025-09";
    const ALL = MANUAL_RESULTS
      .filter(r => (r.date || "") >= MIN_MONTH)
      .sort((a,b) => a.date.localeCompare(b.date));

    // Group by month
    const byMonth = new Map();
    for (const p of ALL) {
      const k = monthKey(p.date);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(p);
    }

    const keys = Array.from(byMonth.keys()).sort().reverse(); // newest first

    // Populate dropdown
    const selectEl = $("monthSelect");
    const statsEl  = $("monthStats");
    const listEl   = $("list");
    if (listEl) listEl.classList.add("months");

    if (selectEl) {
      selectEl.innerHTML =
        `<option value="all">All months</option>` +
        keys.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
      // default "All months"
      selectEl.value = "all";
    }

    function headerLine(picks) {
      const s = computeStats(picks);
      return `Picks: ${s.settled} · Win%: ${fmtPct(s.winPct)} · ROI: ${fmtPct(s.roiPct)}`;
    }

    function render(filterKey = "all") {
      // update short line
      if (statsEl) {
        const picks = (filterKey === "all")
          ? ALL
          : (byMonth.get(filterKey) || []);
        statsEl.textContent = headerLine(picks);
      }

      // render accordions
      if (!listEl) return;
      const showKeys = (filterKey === "all") ? keys : keys.filter(k => k === filterKey);
      listEl.innerHTML = showKeys.map((k, idx) => {
        const picks = byMonth.get(k) || [];

        // group by exact date
        const dayGroups = {};
        picks.forEach(p => { (dayGroups[p.date] ||= []).push(p); });
        const days = Object.keys(dayGroups).sort((a,b) => b.localeCompare(a));

        return `
          <details ${filterKey === "all" ? (idx === 0 ? "open" : "") : "open"}>
            <summary>
              <span class="m-title">${monthLabel(k)}</span>
              <span class="m-stats">Picks: <strong>${computeStats(picks).settled}</strong> ·
                Win%: <strong>${fmtPct(computeStats(picks).winPct)}</strong> ·
                ROI: <strong>${fmtPct(computeStats(picks).roiPct)}</strong>
              </span>
            </summary>
            <div class="m-inner">
              <table class="tbl">
                <thead><tr><th style="width:110px">Date</th><th>Picks</th></tr></thead>
                <tbody>
                  ${days.map(d => {
                    const arr = dayGroups[d];
                    const lines = arr.map(p => {
                      const s = String(p.status || "").toLowerCase();
                      const wl = s === "win" ? '<span class="wl-pill wl-win">WIN</span>'
                               : (s === "lose" || s === "loss") ? '<span class="wl-pill wl-lose">LOSE</span>'
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
    if (selectEl) {
      selectEl.addEventListener("change", e => render(e.target.value || "all"));
    }
  })();
})();
