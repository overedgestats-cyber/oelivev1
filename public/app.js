// public/app.js
import { auth, signIn, signOutUser, watchAuth, getToken } from "./firebase-init.js";

const apiBase = location.origin;

function setHidden(el, state) {
  if (!el) return;
  if (state) {
    el.setAttribute("hidden", "");
    el.style.display = "none";
  } else {
    el.removeAttribute("hidden");
    el.style.display = "";
  }
}
function setHiddenAll(els, state) {
  els.forEach((el) => setHidden(el, state));
}

document.addEventListener("DOMContentLoaded", () => {
  // Support duplicates just in case (should be unique, but this is defensive)
  const loginBtns  = Array.from(document.querySelectorAll("#loginBtn"));
  const logoutBtns = Array.from(document.querySelectorAll("#logoutBtn"));
  const userSpan   = document.getElementById("userEmail");

  loginBtns.forEach((btn)  => btn.addEventListener("click", (e) => { e.preventDefault(); signIn(); }));
  logoutBtns.forEach((btn) => btn.addEventListener("click", (e) => { e.preventDefault(); signOutUser(); }));

  // Re-run UI + Pro gate on every auth change
  watchAuth(async (user) => {
    if (userSpan) userSpan.textContent = user ? (user.email || user.uid) : "";

    // Hide "Sign in" when signed-in; show "Sign out"
    setHiddenAll(loginBtns,  !!user);
    setHiddenAll(logoutBtns, !user);

    const proGuard = document.getElementById("requirePro");
    if (proGuard) await enforcePro(proGuard);
  });

  // Free Picks auto-load
  const freePicksEl = document.getElementById("freePicks");
  if (freePicksEl) loadFreePicks(freePicksEl);

  // First run of Pro guard
  const proGuard = document.getElementById("requirePro");
  if (proGuard) enforcePro(proGuard);
});

async function loadFreePicks(container){
  container.innerHTML = "Loading…";
  try {
    const res = await fetch(`${apiBase}/api/free-picks`);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("application/json")) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText} — ${text.slice(0,120)}`);
    }
    const data = await res.json();
    const picks = data.picks || [];
    container.innerHTML = picks.length
      ? picks.map(p => `
          <div class="card">
            <strong>${p.match}</strong><br/>
            <small>${p.league} · ${new Date(p.kickoff).toLocaleString()}</small><br/>
            <div><b>${p.market}</b>: ${p.prediction} — <b>${p.confidence}%</b> (odds: ${p.odds})</div>
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
    const token = await getToken();
    if (!token){ container.textContent = "Please sign in to view Pro content."; return; }

    const r = await fetch(`${apiBase}/api/subscription/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json();
    if (!j.active){ container.textContent = "No active subscription."; return; }

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
              <strong>${row.home} vs ${row.away}</strong> — ${row.league.name}<br/>
              Top: ${row.topBets.map(b=>`${b.market}:${b.pick} (${b.confidence}%)`).join(" · ")}
            </div>
          `).join("")
        : "No Pro rows right now.";
    });
  } catch (e){
    container.textContent = `Error: ${e.message}`;
  }
}
