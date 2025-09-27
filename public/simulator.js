/* ===== helpers ===== */
async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// If your endpoint returns { days:[ { date, picks:[...] } ] } like winrate.js,
// turn it into a flat array of picks with date on each.
function flattenDays(payload){
  const out = [];
  const days = Array.isArray(payload?.days) ? payload.days : [];
  for (const d of days){
    const picks = Array.isArray(d?.picks) ? d.picks : [];
    for (const p of picks){
      out.push({ date: d.date, ...p });
    }
  }
  return out;
}

function pct(x){ return (x != null ? `${(x*100).toFixed(1)}%` : "—"); }

/* ===== ROI by market ===== */
function statsByMarket(picks){
  // computes { market, picks, winrate, roi }
  const map = new Map();
  for (const p of picks){
    if (typeof p.odds !== "number") continue; // need odds for ROI
    const key = p.market || "—";
    const arr = map.get(key) || [];
    arr.push(p);
    map.set(key, arr);
  }
  const rows = [];
  for (const [market, arr] of map.entries()){
    let wins=0, losses=0, stake=0, pnl=0;
    for (const p of arr){
      const s = String(p.status||"").toLowerCase();
      if (s === "win") wins++;
      else if (s === "loss" || s === "lose") losses++;
      stake += 1;
      if (s === "win") pnl += (p.odds - 1);
      else if (s === "loss" || s === "lose") pnl -= 1;
    }
    const settled = wins + losses;
    const winrate = settled ? wins/settled : null;
    const roi = stake ? pnl/stake : null;
    rows.push({ market, picks: settled, winrate, roi });
  }
  rows.sort((a,b)=> (b.roi ?? -1) - (a.roi ?? -1));
  return rows;
}

async function initROIByMarket(lastNDaysEndpoint, hostId){
  try{
    const data = await fetchJSON(lastNDaysEndpoint);
    const picks = flattenDays(data);
    const rows = statsByMarket(picks);

    const host = document.getElementById(hostId);
    if (!host) return;

    host.innerHTML = `
      <div class="card" style="padding:1rem">
        <strong>Historical ROI by Market (last 30 days)</strong>
        <table class="tbl" style="width:100%;margin-top:.5rem">
          <thead>
            <tr><th>Market</th><th>Picks</th><th>Win%</th><th>ROI</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${r.market}</strong></td>
                <td>${r.picks}</td>
                <td>${r.winrate!=null ? (r.winrate*100).toFixed(1) + "%" : "—"}</td>
                <td>${r.roi!=null ? (r.roi*100).toFixed(1) + "%" : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="muted-sm" style="margin-top:.6rem">Computed from settled picks only; pushes excluded.</div>
      </div>
    `;
  } catch(e){
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = `<div class="card" style="padding:1rem">No market history yet.</div>`;
  }
}

/* ===== CLV (Closing Line Value) =====
   Requires open odds (odds) and closing odds (closing) on each pick.
   Aggregates how often your open price beat the close and average edges.
*/
function clvStats(picks){
  let samples=0, beat=0, tie=0, worse=0;
  let sumCLV=0;       // (closing - open) / open
  let sumEdge=0;      // (open - closing) / closing  (positive means you beat close)
  for (const p of picks){
    const open = Number(p.odds);
    const close = Number(p.closing);
    if (!isFinite(open) || !isFinite(close) || open<=0 || close<=0) continue;

    samples += 1;
    const diff = close - open;
    if (diff > 1e-9) worse += 1;     // close > open => we got worse than close
    else if (diff < -1e-9) beat += 1; // close < open => we beat close
    else tie += 1;

    sumCLV  += (close - open) / open;
    sumEdge += (open - close) / close;
  }
  const clvPct     = samples ? (sumCLV / samples) : null;   // avg % change vs open (positive = close higher)
  const avgEdgePct = samples ? (sumEdge / samples) : null;  // avg % edge vs close (positive = beat close)
  return { samples, beat, tie, worse, clvPct, avgEdgePct };
}

async function initCLV(lastNDaysEndpoint, hostId){
  try{
    const data = await fetchJSON(lastNDaysEndpoint);
    const picks = flattenDays(data);
    const stats = clvStats(picks);

    const host = document.getElementById(hostId);
    if (!host) return;

    host.innerHTML = `
      <div class="card" style="padding:1rem">
        <strong>Closing Line Value (CLV)</strong>
        <div class="muted-sm" style="margin-top:.25rem">How often our advised odds beat the market close.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-top:.6rem">
          <div class="card" style="padding:.7rem"><div>Samples</div><div style="font-weight:900">${stats.samples}</div></div>
          <div class="card" style="padding:.7rem"><div>Beat Close</div><div style="font-weight:900">${stats.beat}</div></div>
          <div class="card" style="padding:.7rem"><div>Tied</div><div style="font-weight:900">${stats.tie}</div></div>
          <div class="card" style="padding:.7rem"><div>Worse</div><div style="font-weight:900">${stats.worse}</div></div>
          <div class="card" style="padding:.7rem"><div>Avg CLV vs Open</div><div style="font-weight:900">${pct(stats.clvPct)}</div></div>
          <div class="card" style="padding:.7rem"><div>Avg Edge vs Close</div><div style="font-weight:900">${pct(stats.avgEdgePct)}</div></div>
        </div>
        <div class="muted-sm" style="margin-top:.5rem">Requires posted open odds and closing odds; rows without both are skipped.</div>
      </div>
    `;
  } catch(e){
    const host = document.getElementById(hostId);
    if (host) host.innerHTML = `<div class="card" style="padding:1rem">CLV stats unavailable.</div>`;
  }
}
