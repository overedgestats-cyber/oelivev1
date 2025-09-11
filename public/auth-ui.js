// Shows email/account on every page + provides sign in/out buttons
import { watchAuth, signIn, signOutUser, getToken } from './firebase-init.js';

function $(sel){ return document.querySelector(sel); }

function mountHeader() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  // Right side controls area
  let box = $('#authControls');
  if (!box) {
    box = document.createElement('span');
    box.id = 'authControls';
    nav.appendChild(Object.assign(document.createElement('span'), { className: 'spacer' }));
    nav.appendChild(box);
  }

  box.innerHTML = `
    <button id="loginBtn" class="btn">Sign in</button>
    <span id="userBox" style="display:none">
      <small id="userEmail" class="mono"></small>
      &nbsp;&middot;&nbsp;
      <a id="accountLink" href="/account.html">Account</a>
      &nbsp;&nbsp;<button id="logoutBtn" class="btn">Sign out</button>
    </span>
  `;

  $('#loginBtn').onclick = () => signIn().catch(console.error);
  $('#logoutBtn').onclick = () => signOutUser().catch(console.error);

  watchAuth(async (user) => {
    if (user) {
      $('#loginBtn').style.display = 'none';
      $('#userBox').style.display = '';
      $('#userEmail').textContent = user.email || user.uid;

      // If page has a #proBoardApp container, auto-gate & load board
      if ($('#proBoardApp')) await maybeLoadProBoard();
    } else {
      $('#loginBtn').style.display = '';
      $('#userBox').style.display = 'none';
    }
  });
}

async function maybeLoadProBoard() {
  const statusBox = $('#proGateMsg');
  const list = $('#proList');
  if (!statusBox || !list) return;

  statusBox.textContent = 'Checking your subscription…';

  try {
    const t = await getToken();
    const s = await fetch('/api/subscription/status?t='+Date.now(), {
      headers: { Authorization: 'Bearer ' + t }
    });
    const sj = await s.json();

    if (!s.ok || !sj.ok) throw new Error((sj && sj.detail) || 'status_failed');

    if (!sj.active) {
      statusBox.textContent = 'No active subscription.';
      list.innerHTML = '';
      return;
    }

    statusBox.textContent = 'Loading Pro Board…';
    const r = await fetch('/api/pro-board', {
      headers: { Authorization: 'Bearer ' + t }
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error((j && j.error) || 'pro_board_failed');

    statusBox.style.display = 'none';
    list.innerHTML = (j.items||[]).map(it => `
      <div class="card">
        <div><small>${new Date(it.kickoff).toLocaleString()}</small></div>
        <div><b>${it.home}</b> vs <b>${it.away}</b></div>
        <div><small>${it.competition || ''}</small></div>
        ${it.topBets?.length ? `<div style="margin-top:6px">${it.topBets[0].market}: <b>${it.topBets[0].pick}</b> · ${it.topBets[0].confidence}%</div>`:''}
      </div>
    `).join('');
  } catch (e) {
    statusBox.textContent = 'Server error: ' + (e.message || String(e));
    list.innerHTML = '';
  }
}

mountHeader();
