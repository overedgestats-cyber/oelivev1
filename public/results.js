// /public/results.js
// Results page logic: manual seed + Firestore merge (via /api/results), KPIs, simulator, ROI by market, monthly renderer.

(function(){
  // ----- Footer year (safe no-op if element missing)
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();

  // ======== MANUAL SEED (seed/fallback) ========
  // You can add 'closing' for CLV calc on a per-pick basis.
  const MANUAL_RESULTS = [
    // 2025-09-28
{ date:"2025-09-28", home:"SC Freiburg",  away:"1899 Hoffenheim",   market:"Over 2.5", odds:1.62, status:"lose" },
{ date:"2025-09-28", home:"Rosengård W",  away:"Brommapojkarna W", market:"Over 2.5", odds:1.53, status:"win" },

    // 2025-09-27 (new)
    { date:"2025-09-27", home:"Ogre United",       away:"Smiltene",            market:"Over 2.5",  odds:1.40, status:"lose" },
    { date:"2025-09-27", home:"Piast Gliwice",     away:"Nieciecza",           market:"Under 2.5", odds:1.90, status:"lose" },

    // 2025-09-26
    { date:"2025-09-26", home:"Fanalamanga", away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
    { date:"2025-09-26", home:"Tukums II",   away:"Riga Mariners",      market:"Over 2.5",  odds:1.33, status:"win" },

    // 2025-09-25
    { date:"2025-09-25", home:"Johor Darul Takzim FC", away:"Bangkok United", market:"Over 2.5", odds:1.44, status:"win" },
    { date:"2025-09-25", home:"Nam Dinh",              away:"Svay Rieng",     market:"Over 2.5", odds:1.90, status:"win" },

    // 2025-09-24
    { date:"2025-09-24", home:"VfL Wolfsburg W", away:"Werder Bremen W",   market:"Over 2.5",  odds:1.57, status:"win" },
    { date:"2025-09-24", home:"Kabel Novi Sad",  away:"Semendrija 1924",   market:"Under 2.5", odds:1.44, status:"lose" },

    // 2025-09-23
    { date:"2025-09-23", home:"Miedź Legnica II", away:"Świt Skolwin",     market:"Over 2.5",  odds:1.55, status:"win" },
    { date:"2025-09-23", home:"Cagliari",         away:"Frosinone",        market:"Under 2.5", odds:1.80, status:"lose" },

    // 2025-09-22
    { date:"2025-09-22", home:"Barcelona Atlètic", away:"Castellón B",     market:"Over 2.5",  odds:1.60, status:"win" },

    // 2025-09-21
    { date:"2025-09-21", home:"Rēzekne FA",       away:"Skanste",          market:"Over 2.5",  odds:1.45, status:"win" },
    { date:"2025-09-21", home:"Häcken W",         away:"Rosengård W",      market:"Over 2.5",  odds:1.73, status:"win" },

    // 2025-09-20
    { date:"2025-09-20", home:"1899 Hoffenheim",  away:"Bayern München",   market:"Over 2.5",  odds:1.35, status:"win" },
    { date:"2025-09-20", home:"Ogre United",      away:"Riga Mariners",    market:"Over 2.5",  odds:1.65, status:"win" },

    // 2025-09-17
    { date:"2025-09-17", home:"Cham",             away:"Vevey Sports",     market:"Over 2.5",  odds:1.54, status:"win" },
    { date:"2025-09-17", home:"Rothis",           away:"Sturm Graz",       market:"Over 2.5",  odds:1.20, status:"lose" },

    // 2025-09-16
    { date:"2025-09-16", home:"Tonbridge Angels", away:"Steyning Town",    market:"Over 2.5",  odds:1.67, status:"win" },
    { date:"2025-09-16", home:"Rylands",          away:"Ashton United",    market:"Under 2.5", odds:1.80, status:"win" },
    { date:"2025-09-16", home:"Sharjah FC",       away:"Al-Gharafa",       market:"Over 2.5",  odds:1.70, status:"win" },

    // 2025-09-14
    { date:"2025-09-14", home:"Pitea W",          away:"Brommapojkarna W", market:"Over 2.5",  odds:1.69, status:"win" },
    { date:"2025-09-14", home:"Marupe",           away:"JDFS Alberts",     market:"Over 2.5",  odds:1.47, status:"win" },
  ];

  // ---------- Helpers ----------
  const el = id => document.getElementById(id);
  const fmtPct = n => (n==null ? '—' : `${n.toFixed(1)}%`);
  function wlPill(status){
    const s = String(status||'').toLowerCase();
    if (s === 'win') return '<span class="wl-pill wl-win">WIN</span>';
    if (s === 'loss' || s === 'lose') return '<span class="wl-pill wl-lose">LOSE</span>';
    return '—';
  }
  function monthKey(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleDateString(undefined, { year:'numeric', month:'long' });
  }
  function monthLabel(key){ return key; } // we already pass "YYYY MMM" style
  function computeStats(picks){
    let wins=0, losses=0, stake=0, pnl=0; // (count of p picks)
    for (const p of picks){
      const s = String(p.status||'').toLowerCase();
      if      (s === 'win')  wins++;
      else if (s === 'lose' || s === 'loss') losses++;
      if (typeof p.odds === 'number'){
        stake += 1;
        if (s === 'win') pnl += (p.odds - 1);
        else if (s === 'lose' || s === 'loss') pnl -= 1;
      }
    }
    const settled = wins + losses;
    const winRate = settled ? (wins/settled*100) : null;
    const roiPct  = stake ? (pnl/stake*100) : null;
    return { wins, losses, settled, winRate, roiPct, stake, pnl };
  }
  function streaks(picks){ // oldest->newest
    let best=0, cur=0;
    for (const p of picks){
      const s = String(p.status||'').toLowerCase();
      if (s==='win'){ cur+=1; best=Math.max(best,cur); }
      else if (s==='lose' || s==='loss'){ cur=0; }
    }
    // current streak from newest back
    let curFromEnd=0;
    for (let i=picks.length-1;i>=0;i--){
      const s=String(picks[i].status||'').toLowerCase();
      if(s==='win'){ if(curFromEnd>=0) curFromEnd+=1; else break; }
      else if(s==='lose' || s==='loss'){ if(curFromEnd<=0) curFromEnd-=1; else break; }
      else break;
    }
    return { best, current: curFromEnd };
  }
  function clvAvg(picks){ // Average CLV (closing / open - 1) * 100
    const xs = [];
    for (const p of picks){
      if (typeof p.odds === 'number' && typeof p.closing === 'number' && p.odds>0){
        xs.push( (p.closing / p.odds - 1) * 100 );
      }
    }
    if (!xs.length) return null;
    const m = xs.reduce((a,b)=>a+b,0)/xs.length;
    return m;
  }
  function daysAgo(n){ const d = new Date(); d.setDate(d.getDate()-n); return d; }
  function toDate(s){ const [y,m,d]=String(s).split('-').map(Number); return new Date(y,m-1,d); }
  function inLastNDays(p, n){ return toDate(p.date) >= daysAgo(n); }

  // ---------- Fetch remote (/api/results) then merge ----------
  async function fetchRemote(days=180) {
    try {
      const r = await fetch(`/api/results?kind=free&days=${encodeURIComponent(days)}`, { cache:'no-store' });
      if(!r.ok) throw new Error('net');
      const data = await r.json();
      // data: {picks:[...], days:[...], summary:{...}}
      return data.picks || [];
    } catch (e) { return []; }
  }
  function dedupeMerge(manual, remote){
    const map = new Map();
    const keyOf = p => `${p.date}#${p.home}#${p.away}#${String(p.market||'').toLowerCase()}`;
    manual.forEach(p => map.set(keyOf(p), p));
    remote.forEach(p => map.set(keyOf(p), p)); // prefer remote
    return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
  }

  // ---- Render once everything is ready ----
  (async function init(){
    const remote = await fetchRemote(180);
    const MERGED = dedupeMerge(MANUAL_RESULTS, remote);

    const MIN_MONTH = '2025-09';
    const ALLOWED_RESULTS = MERGED.filter(r => (r.date||'') >= MIN_MONTH);

    // ===== Summary KPIs =====
    const allStats = computeStats(ALLOWED_RESULTS);
    el('s-total').textContent   = ALLOWED_RESULTS.length;
    el('s-wins').textContent    = allStats.wins;
    el('s-losses').textContent  = allStats.losses;
    el('s-winrate').textContent = fmtPct(allStats.winRate);
    el('s-roi').textContent     = fmtPct(allStats.roiPct);

    // Yearly (current calendar year)
    const year = new Date().getFullYear();
    const yearPicks = ALLOWED_RESULTS.filter(r => String(r.date||'').startsWith(String(year)));
    const yStats = computeStats(yearPicks.length ? yearPicks : ALLOWED_RESULTS);
    el('s-ywin').textContent = fmtPct(yStats.winRate);
    el('s-yroi').textContent = fmtPct(yStats.roiPct);

    // ===== Extras KPIs =====
    const st = streaks(ALLOWED_RESULTS);
    el('k-streak').textContent = st.current>0 ? `${st.current}W` : st.current<0 ? `${-st.current}L` : '—';
    el('k-best').textContent   = st.best ? `${st.best}W` : '—';
    const last7  = ALLOWED_RESULTS.filter(p => inLastNDays(p,7));
    const s7     = computeStats(last7);
    el('k-7d').textContent     = fmtPct(s7.winRate);
    const last30 = ALLOWED_RESULTS.filter(p => inLastNDays(p,30));
    const s30    = computeStats(last30);
    el('k-30roi').textContent  = fmtPct(s30.roiPct);
    const clv    = clvAvg(ALLOWED_RESULTS);
    el('k-clv').textContent    = (clv==null ? '—' : `${clv>=0?'+':''}${clv.toFixed(1)}%`);

    // ===== Historical ROI by Market =====
    function computeMarketRows(picks){
      const m = new Map();
      for (const p of picks) {
        const key = p.market || '—';
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(p);
      }
      const rows = [];
      for (const [market, arr] of m.entries()){
        const s = computeStats(arr);
        rows.push({ market, picks: s.settled, win: s.winRate, roi: s.roiPct });
      }
      rows.sort((a,b)=> (b.roi??-1) - (a.roi??-1));
      return rows;
    }
    (function renderMarketTable(){
      const tb = document.querySelector('#roiMarketTbl tbody');
      if (!tb) return;
      tb.innerHTML = computeMarketRows(ALLOWED_RESULTS).map(r=>`
        <tr>
          <td><strong>${r.market}</strong></td>
          <td>${r.picks}</td>
          <td>${r.win!=null? r.win.toFixed(1)+'%':'—'}</td>
          <td>${r.roi!=null? r.roi.toFixed(1)+'%':'—'}</td>
        </tr>
      `).join('');
    })();

    // ===== Simulator =====
    function filterRange(range){
      if(range==='all') return ALLOWED_RESULTS;
      const n = Number(range)||30;
      return ALLOWED_RESULTS.filter(p => inLastNDays(p, n));
    }
    function runSimulator(){
      const stake = Math.max(0, Number(el('simStake').value)||0);
      const range = el('simRange').value;
      const picks = filterRange(range).filter(p => typeof p.odds==='number');
      let wins=0, losses=0, st=0, pnl=0;
      for(const p of picks){
        const s = String(p.status||'').toLowerCase();
        st += stake;
        if(s==='win'){ wins++; pnl += stake*(p.odds-1); }
        else if(s==='lose' || s==='loss'){ losses++; pnl -= stake; }
      }
      const settled = wins+losses;
      const winrate = settled? (wins/settled*100): null;
      const roi = st? (pnl/st*100): null;

      el('simPicks').textContent    = settled;
      el('simWins').textContent     = wins;
      el('simLosses').textContent   = losses;
      el('simWinrate').textContent  = fmtPct(winrate);
      el('simStakeSum').textContent = st.toFixed(2);
      el('simPnL').textContent      = pnl.toFixed(2);
      el('simROI').textContent      = fmtPct(roi);

      window.__simLast = { picks, stake };
    }
    function exportCSV(){
      const data  = window.__simLast || { picks: [], stake: 1 };
      const stake = data.stake||1;
      const rows = [
        ['Date','Home','Away','Market','Odds','Result','Stake','Return']
      ];
      for(const p of data.picks){
        const s = String(p.status||'').toLowerCase();
        const ret = s==='win' ? stake*p.odds : s==='lose'||s==='loss' ? 0 : '';
        rows.push([p.date, p.home, p.away, p.market, (typeof p.odds==='number'? p.odds.toFixed(2):''), s.toUpperCase(), stake, ret]);
      }
      const csv = rows.map(r=> r.map(v=>{
        const x = v==null ? '' : String(v);
        return /[",\n]/.test(x) ? `"${x.replace(/"/g,'""')}"` : x;
      }).join(',')).join('\n');

      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'overedge_bet_slip.csv';
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    }

    const simRunBtn    = el('simRun');
    const simExportBtn = el('simExport');
    if (simRunBtn)    simRunBtn.addEventListener('click', runSimulator);
    if (simExportBtn) simExportBtn.addEventListener('click', exportCSV);
    runSimulator();

    // ===== Month dropdown + list =====
    const byMonth = new Map();
    ALLOWED_RESULTS.forEach(p => {
      const d = new Date(p.date);
      const key = d.toLocaleDateString(undefined, { year:'numeric', month:'long' }); // e.g., "September 2025"
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(p);
    });

    const monthSelect = el('monthSelect');
    if (monthSelect){
      // build options
      const keys = Array.from(byMonth.keys()).sort((a,b)=>{
        // sort by date desc by reconstructing a Date
        const pa = new Date(a); const pb = new Date(b);
        return pb - pa;
      });
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = 'All months';
      monthSelect.appendChild(allOpt);
      keys.forEach(k=>{
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = k;
        monthSelect.appendChild(opt);
      });
      monthSelect.value = keys[0] || 'all';
    }

    function showMonthStats(key){
      let picks;
      if (key==='all' || !key) picks = ALLOWED_RESULTS;
      else picks = byMonth.get(key) || [];
      const s = computeStats(picks);
      const target = el('monthStats');
      if (target) {
        target.innerHTML =
          picks.length
            ? `Picks: <strong>${s.settled}</strong> · Win%: <strong>${fmtPct(s.winRate)}</strong> · ROI: <strong>${fmtPct(s.roiPct)}</strong>`
            : 'No data';
      }
    }
    if (monthSelect){
      showMonthStats(monthSelect.value);
      monthSelect.addEventListener('change', e=> showMonthStats(e.target.value));
    }

    function renderAllMonths(){
      const host = el('list');
      if (!host) return;
      host.innerHTML = '';

      const keys = Array.from(byMonth.keys()).sort((a,b)=>{
        const pa = new Date(a); const pb = new Date(b);
        return pb - pa;
      });

      keys.forEach(k=>{
        const list = byMonth.get(k) || [];
        // group by date
        const byDate = {};
        list.forEach(p => { (byDate[p.date] ||= []).push(p); });
        const dates = Object.keys(byDate).sort((a,b)=> b.localeCompare(a));

        const mStats = computeStats(list);
        const wrap = document.createElement('section');
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

        dates.forEach(d=>{
          const picks = byDate[d];
          const block = document.createElement('div');
          block.innerHTML = `
            <div class="muted-sm" style="margin:.35rem 0 .2rem;"><strong>${d}</strong></div>
            <table class="tbl">
              <thead>
                <tr><th>Match</th><th>Market</th><th>Odds</th><th>Result</th></tr>
              </thead>
              <tbody>
                ${picks.map(p=>`
                  <tr>
                    <td><strong>${p.home}</strong> vs <strong>${p.away}</strong></td>
                    <td><strong>${p.market || (p.selection? p.selection : '')}</strong></td>
                    <td>${typeof p.odds==='number'? p.odds.toFixed(2) : '—'}</td>
                    <td>${wlPill(p.status)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
          wrap.appendChild(block);
        });

        host.appendChild(wrap);
      });
    }
    renderAllMonths();
  })();
})();
