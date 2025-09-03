import { auth, signIn, signOutUser, watchAuth, getToken } from "./firebase-init.js";

const apiBase = location.origin;

document.addEventListener("DOMContentLoaded", () => {
  const loginBtn  = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userSpan  = document.getElementById("userEmail");

  if (loginBtn)  loginBtn.addEventListener("click", signIn);
  if (logoutBtn) logoutBtn.addEventListener("click", signOutUser);

  watchAuth((user) => {
    if (userSpan)  userSpan.textContent = user ? (user.email || user.uid) : "";
    if (loginBtn)  loginBtn.hidden  = !!user;
    if (logoutBtn) logoutBtn.hidden = !user;
  });

  // Free Picks auto-load if the container exists
  const freePicksEl = document.getElementById("freePicks");
  if (freePicksEl) loadFreePicks(freePicksEl);

  // Pro page guard
  const proGuard = document.getElementById("requirePro");
  if (proGuard) enforcePro(proGuard);
});

async function loadFreePicks(container){
  container.innerHTML = "Loading…";
  try {
    const r = await fetch(`${apiBase}/api/free-picks`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    const picks = data.picks || [];
    if (!picks.length){ container.innerHTML = "No picks yet. Try later."; return; }

    container.innerHTML = picks.map(p => `
      <div class="card">
        <strong>${p.match}</strong><br/>
        <small>${p.league} · ${new Date(p.kickoff).toLocaleString()}</small><br/>
        <div><b>${p.market}</b>: ${p.prediction} — <b>${p.confidence}%</b> (odds: ${p.odds})</div>
        <div>${p.reasoning}</div>
      </div>
    `).join("");
  } catch (e){
    container.innerHTML = `<div class="card">Couldn't load picks: ${e.message}</div>`;
  }
}

async function enforcePro(container){
  container.innerHTML = "Checking subscription…";
  try {
    const token = await getToken();
    if (!token){ container.innerHTML = "Please sign in to view Pro content."; return; }

    const r = await fetch(`${apiBase}/api/subscription/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { active } = await r.json();
    if (!active){ container.innerHTML = "No active subscription."; return; }

    container.innerHTML = '<a class="btn" href="#" id="loadPro">Load Pro Board</a><div id="proBoard"></div>';
    document.getElementById("loadPro").addEventListener("click", async (e)=>{
      e.preventDefault();
      const pr = await fetch(`${apiBase}/api/pro-board`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await pr.json();
      const list = data.items || [];
      document.getElementById("proBoard").innerHTML = list.slice(0,10).map(row => `
        <div class="card">
          <strong>${row.home} vs ${row.away}</strong> — ${row.league.name}<br/>
          Top: ${row.topBets.map(b=>`${b.market}:${b.pick} (${b.confidence}%)`).join(" · ")}
        </div>
      `).join("");
    });
  } catch (e){
    container.innerHTML = `Error: ${e.message}`;
  }
}
