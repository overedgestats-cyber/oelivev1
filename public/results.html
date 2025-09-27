// /public/results.js
// Results page logic: manual seed + Firestore merge, KPIs, simulator, ROI by market, monthly renderer.

(function(){
  // Footer year (safe no-op if element missing)
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();

  // ===== MANUAL RESULTS (seed/fallback) =====
  // You can add 'closing' for CLV calc on a per-pick basis.
  const MANUAL_RESULTS = [
    // 2025-09-26
    { date:"2025-09-26", home:"Fanalamanga", away:"Ferroviário Maputo", market:"Under 2.5", odds:1.53, status:"lose" },
    { date:"2025-09-26", home:"Tukums II",   away:"Riga Mariners",      market:"Over 2.5",  odds:1.33, status:"win" },

    // 2025-09-25 (both picks WON)
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
  function wlPill(status){
    const s = String(status||'').toLowerCase();
    if (s === 'win') return '<span class="wl-pill wl-win">WIN</span>';
    if (s === 'loss' || s === 'lose') return '<span class="wl-pill wl-lose">LOSE</span>';
    return '—';
  }
  function monthKey(dateStr){ return (dateStr||'').slice(0,7); } // "YYYY-MM"
  function monthLabel(key){
    const [y,m] = key.split('-').map(Number);
    const d = new Date(y, m-1, 1);
    return d.toLocaleDateString(undefined, { year:'numeric', month:'long' });
  }
  function computeStats(picks){
    let wins=0, losses=0, stake=0, pnl=0;
    for (const p of picks){
      const s = String(p.status||'').toLowerCase();
      if (s === 'win') wins++;
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
  function streaks(picks){ // oldest->newest for best; newest tail for current
    let best=0, cur=0;
    for(const p of picks){
      const w = String(p.status||'').toLowerCase()==='win';
      if(w){ cur+=1; best=Math.max(best,cur); } else if(String(p.status||'').toLowerCase()==='lose'){ cur=0; }
    }
    let curFromEnd=0;
    for(let i=picks.length-1;i>=0;i--){
      const s=String(picks[i].status||'').toLowerCase();
      if(s==='win'){ if(curFromEnd>=0) curFromEnd+=1; else break; }
      else if(s==='lose'){ if(curFromEnd<=0) curFromEnd-=1; else break; }
      else break;
    }
    return { best, current: curFromEnd };
  }
  // Average CLV = mean((closing - open) / open) * 100
  function clvAvg(picks){
    const xs = [];
    for (const p of picks){
      if (typeof p.odds === 'number' && typeof p.closing === 'number' && p.odds>0){
        xs.push( (p.closing - p.odds) / p.odds );
      }
    }
    if (!xs.length) return null;
    const m = xs.reduce((a,b)=>a+b,0)/xs.length;
    return m*100;
  }
  function daysAgo(n){ const d = new Date(); d.setDate(d.getDate()-n); return d; }
  function toDate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function inLastNDays(p, n){ return toDate(p.date) >= daysAgo(n); }

  // ---------- Remote fetch + merge with manual seed ----------
  async function fetchRemote(days=180){
    try{
      const r = await fetch(`/api/results?kind=free&days=${encodeURIComponent(days)}`, { cache:'no-store' });
      if(!r.ok) throw new Error('net');
      const data = await r.json(); // {days:[{date,picks:[...] }], summary:...}
      const out = [];
      for(const d of (data.days||[])){
        const date = d.date;
        for(const p of (d.picks||[])){
          out.push({
            date,
            home: p.home, away: p.away,
            market: p.market || p.selection || p.pick || '',
            odds: (typeof p.odds==='number'? p.odds : null),
            closing: (typeof p.closing==='number'? p.closing : null),
            status: (p.status||'').toLowerCase() // 'win' | 'lose' | 'push' | ...
          });
        }
      }
      return out;
    }catch{
      return []; // fallback to manual only
    }
  }

  function dedupeMerge(manual, remote){
    const map = new Map();
    const keyOf = p => `${p.date}|${p.home}|${p.away}|${p.market}`.toLowerCase();
    for(const p of manual){ map.set(keyOf(p), p); }
    for(const r of remote){
      const k = keyOf(r);
      const cur = map.get(k);
      if(!cur){ map.set(k, r); }
      else{
        map.set(k, {
          ...cur,
          status: r.status || cur.status,
          odds: (typeof r.odds==='number'? r.odds : cur.odds),
          closing: (typeof r.closing==='number'? r.closing : cur.closing),
          market: r.market || cur.market
        });
      }
    }
    return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date)); // oldest->newest
  }

  // ---------- Boot: merge, then render everything ----------
  (async function boot(){
    const remote = await fetchRemote(180);
    const MERGED = dedupeMerge(MANUAL_RESULTS, remote);

    const MIN_MONTH = '2025-09';
    const ALLOWED_RESULTS = MERGED.filter(r => monthKey(r.date) >= MIN_MONTH);

    // Build month groups
    const byMonth = new Map();
    ALLOWED_RESULTS.forEach(r => {
      const k = monthKey(r.date);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(r);
    });

    // Month dropdown
    const monthSelect = el('monthSelect');
    const months = Array.from(byMonth.keys()).filter(k => k >= MIN_MONTH).sort((a,b)=> b.localeCompare(a));
    if (monthSelect){
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = 'All months';
      monthSelect.appendChild(allOpt);
      months.forEach(k=>{
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = monthLabel(k);
        monthSelect.appendChild(opt);
      });
      monthSelect.value = months[0] || 'all';
    }

    // Top summaries (overall)
    const allStats = computeStats(ALLOWED_RESULTS);
    setText('s-total',   ALLOWED_RESULTS.length);
    setText('s-wins',    allStats.wins);
    setText('s-losses',  allStats.losses);
    setText('s-winrate', (allStats.winRate!=null? allStats.winRate.toFixed(1)+'%':'—'));
    setText('s-roi',     (allStats.roiPct!=null? allStats.roiPct.toFixed(1)+'%':'—'));

    // Yearly summaries (current calendar year)
    const currentYear = new Date().getFullYear();
    const yearPicks = ALLOWED_RESULTS.filter(r => (r.date||'').startsWith(String(currentYear)));
    const yStats = computeStats(yearPicks.length ? yearPicks : ALLOWED_RESULTS);
    setText('s-ywin', (yStats.winRate!=null? yStats.winRate.toFixed(1)+'%':'—'));
    setText('s-yroi', (yStats.roiPct!=null? yStats.roiPct.toFixed(1)+'%':'—'));

    // ===== Extras KPIs =====
    const st = streaks(ALLOWED_RESULTS);
    setText('k-streak', st.current>0 ? `${st.current}W` : st.current<0 ? `${-st.current}L` : '—');
    setText('k-best',   st.best ? `${st.best}W` : '—');

    const last7  = ALLOWED_RESULTS.filter(p => inLastNDays(p,7));
    const s7     = computeStats(last7);
    setText('k-7d', (s7.winRate!=null? s7.winRate.toFixed(1)+'%':'—'));

    const last30 = ALLOWED_RESULTS.filter(p => inLastNDays(p,30));
    const s30    = computeStats(last30);
    setText('k-30roi', (s30.roiPct!=null? s30.roiPct.toFixed(1)+'%':'—'));

    const clv = clvAvg(ALLOWED_RESULTS);
    setText('k-clv', (clv!=null? (clv>=0? '+' : '') + clv.toFixed(1) + '%' : '—'));

    // ===== Historical ROI by Market =====
    function computeMarketRows(picks){
      const m = new Map();
      for(const p of picks){
        const key = p.market || '—';
        if(!m.has(key)) m.set(key, []);
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
    renderMarketTable();

    function renderMarketTable(){
      const tbWrap = document.querySelector('#roiMarketTbl tbody');
      if (!tbWrap) return;
      const rows = computeMarketRows(ALLOWED_RESULTS).map(r=>`
        <tr>
          <td><strong>${escapeHTML(r.market)}</strong></td>
          <td>${r.picks}</td>
          <td>${r.win!=null? r.win.toFixed(1)+'%':'—'}</td>
          <td>${r.roi!=null? r.roi.toFixed(1)+'%':'—'}</td>
        </tr>
      `).join('');
      tbWrap.innerHTML = rows;
    }

    // ===== Simulator =====
    const simRunBtn = el('simRun');
    const simExportBtn = el('simExport');
    if (simRunBtn) simRunBtn.addEventListener('click', runSimulator);
    if (simExportBtn) simExportBtn.addEventListener('click', exportCSV);
    runSimulator();

    function filterRange(range){
      if(range==='all') return ALLOWED_RESULTS;
      const n = Number(range)||30;
      return ALLOWED_RESULTS.filter(p => inLastNDays(p, n));
    }
    function runSimulator(){
      const stakeInput = el('simStake');
      const rangeSel   = el('simRange');
      const stake = Math.max(0, Number(stakeInput && stakeInput.value || 0) || 0);
      const range = rangeSel ? rangeSel.value : '30';
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

      setText('simPicks', settled);
      setText('simWins', wins);
      setText('simLosses', losses);
      setText('simWinrate', (winrate!=null? winrate.toFixed(1)+'%':'—'));
      setText('simStakeSum', st.toFixed(2));
      setText('simPnL', pnl.toFixed(2));
      setText('simROI', (roi!=null? roi.toFixed(1)+'%':'—'));

      window.__simLast = { picks, stake };
    }
    function exportCSV(){
      const data = window.__simLast || { picks: [], stake: 1 };
      const stake = data.stake||1;
      const rows = [['Date','Home','Away','Market','Odds','Result','Stake','Return']];
      for(const p of data.picks){
        const s = String(p.status||'').toLowerCase();
        const ret = s==='win' ? stake*p.odds : s==='lose'||s==='loss' ? 0 : '';
        rows.push([p.date, p.home, p.away, p.market, (typeof p.odds==='number'? p.odds.toFixed(2):''), s.toUpperCase(), stake, ret]);
      }
      const csv = rows.map(r=> r.map(x=>{
        const v = (x==null? '' : String(x));
        return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
      }).join(',')).join('\n');

      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'overedge_bet_slip.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    }

    // Monthly stats line next to dropdown
    if (monthSelect){
      showMonthStats(monthSelect.value);
      monthSelect.addEventListener('change', e=> showMonthStats(e.target.value));
    }
    function showMonthStats(key){
      let picks;
      if (key==='all') picks = ALLOWED_RESULTS;
      else picks = byMonth.get(key) || [];
      const s = computeStats(picks);
      const host = el('monthStats');
      if (!host) return;
      host.innerHTML =
        picks.length
          ? `Picks: <strong>${s.settled}</strong> · Win%: <strong>${s.winRate!=null?s.winRate.toFixed(1)+'%':'—'}</strong> · ROI: <strong>${s.roiPct!=null?s.roiPct.toFixed(1)+'%':'—'}</strong>`
          : 'No data';
    }

    // Render full list grouped by date within each (allowed) month (desc)
    renderAllMonths();
    function renderAllMonths(){
      const host = el('list');
      if (!host) return;
      host.innerHTML = '';

      const monthKeys = Array.from(byMonth.keys())
        .filter(k => k >= MIN_MONTH)
        .sort((a,b)=> b.localeCompare(a));

      monthKeys.forEach(k=>{
        const list = byMonth.get(k) || [];
        const byDate = {};
        list.forEach(p => { (byDate[p.date] ||= []).push(p); });
        const dates = Object.keys(byDate).sort((a,b)=> b.localeCompare(a));

        const mStats = computeStats(list);
        const wrap = document.createElement('section');
        wrap.innerHTML = `
          <div class="date-head" style="display:flex;justify-content:space-between;align-items:baseline">
            <span>${escapeHTML(monthLabel(k))}</span>
            <span class="muted-sm">
              Picks: <strong>${mStats.settled}</strong> ·
              Win%: <strong>${mStats.winRate!=null?mStats.winRate.toFixed(1)+'%':'—'}</strong> ·
              ROI: <strong>${mStats.roiPct!=null?mStats.roiPct.toFixed(1)+'%':'—'}</strong>
            </span>
          </div>
        `;

        dates.forEach(d=>{
          const picks = byDate[d];
          const rows = picks.map(p=>`
            <tr>
              <td><strong>${escapeHTML(p.home)}</strong> vs <strong>${escapeHTML(p.away)}</strong></td>
              <td><strong>${escapeHTML(p.market||'')}</strong></td>
              <td>${typeof p.odds==='number'? p.odds.toFixed(2) : '—'}</td>
              <td>${wlPill(p.status)}</td>
            </tr>
          `).join('');

          const block = document.createElement('div');
          block.innerHTML = `
            <div class="muted-sm" style="margin:.35rem 0 .2rem;"><strong>${escapeHTML(d)}</strong></div>
            <table class="tbl">
              <thead>
                <tr><th>Match</th><th>Market</th><th>Odds</th><th>Result</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          `;
          wrap.appendChild(block);
        });

        host.appendChild(wrap);
      });
    }

    // ---- utils
    function setText(id, val){
      const t = el(id);
      if (t) t.textContent = (val==null? '—' : String(val));
    }
    function escapeHTML(s){
      return String(s==null?'':s)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
    }
  })();
})();
