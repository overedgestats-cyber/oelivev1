import { auth, signIn, signOutUser, watchAuth, getToken } from "./firebase-init.js";

const apiBase = location.origin;

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn  = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userSpan  = document.getElementById("userEmail");

  if (loginBtn)  loginBtn.addEventListener("click", signIn);
  if (logoutBtn) logoutBtn.addEventListener("click", signOutUser);

  // рџ”Ѓ rerun UI + pro guard on every auth change
  watchAuth(async (user) => {
    if (userSpan)  userSpan.textContent = user ? (user.email || user.uid) : "";
    if (loginBtn)  loginBtn.hidden  = !!user;
    if (logoutBtn) logoutBtn.hidden = !user;

    const proGuard = document.getElementById("requirePro");
    if (proGuard) await enforcePro(proGuard);   // <вЂ” rerun after login/logout
  });

  // Free Picks auto-load
  const freePicksEl = document.getElementById("freePicks");
  if (freePicksEl) loadFreePicks(freePicksEl);

  // First run of Pro guard (will show вЂњsign inвЂќ until auth callback fires)
  const proGuard = document.getElementById("requirePro");
  if (proGuard) enforcePro(proGuard);
});

async function loadFreePicks(container){
  container.innerHTML = "LoadingвЂ¦";
  try {
    const res = await fetch(`${apiBase}/api/free-picks`);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("application/json")) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText} вЂ” ${text.slice(0,120)}`);
    }
    const data = await res.json();
    const picks = data.picks || [];
    container.innerHTML = picks.length
      ? picks.map(p => `
          <div class="card">
            <strong>${p.match}</strong><br/>
            <small>${p.league} В· ${new Date(p.kickoff).toLocaleString()}</small><br/>
            <div><b>${p.market}</b>: ${p.prediction} вЂ” <b>${p.confidence}%</b> (odds: ${p.odds})</div>
            <div>${p.reasoning}</div>
          </div>
        `).join("")
      : "No picks yet. Try later.";
  } catch (e){
    container.innerHTML = `<div class="card">Couldn't load picks: ${e.message}</div>`;
  }
}

async function enforcePro(container){
  try {
    const token = await getToken();              // from firebase-init.js
    if (!token){ container.textContent = "Please sign in to view Pro content."; return; }

    // check subscription
    const r = await fetch(`${apiBase}/api/subscription/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    if (!j.active){ container.textContent = "No active subscription."; return; }

    // show a loader + button and fetch the board
    container.innerHTML = '<a class="btn" href="#" id="loadPro">Load Pro Board</a><div id="proBoard"></div>';
    document.getElementById("loadPro").addEventListener("click", async (e)=>{
      e.preventDefault();
      const pr = await fetch(`${apiBase}/api/pro-board`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await pr.json();
      const list = data.items || [];
      document.getElementById("proBoard").innerHTML = list.length
        ? list.slice(0,10).map(row => `
            <div class="card">
              <strong>${row.home} vs ${row.away}</strong> вЂ” ${row.league.name}<br/>
              Top: ${row.topBets.map(b=>`${b.market}:${b.pick} (${b.confidence}%)`).join(" В· ")}
            </div>
          `).join("")
        : "No Pro rows right now.";
    });
  } catch (e){
    container.textContent = `Error: ${e.message}`;
  }
}
