/* OverEdge — global social follow bar (FB + IG) */
(function () {
  const LS_KEY = "oe_social_dismissed_until";
  const now = Date.now();
  const until = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
  if (until > now) return; // user dismissed recently

  const LINKS = {
    facebook: "https://www.facebook.com/overedgefootball",
    instagram: "https://www.instagram.com/overedgefootball"
  };

  const css = `
.oe-social-bar{position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;
  background:#0b0f1a; color:#fff; border-radius:14px; padding:12px 14px;
  box-shadow:0 10px 25px rgba(0,0,0,.35); display:flex; align-items:center; gap:10px}
.oe-social-bar .txt{flex:1; font:600 15px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.oe-social-bar .btn{display:inline-flex; align-items:center; gap:8px; padding:10px 14px;
  border:0; border-radius:12px; cursor:pointer; text-decoration:none; color:#0b0f1a; font-weight:700}
.oe-social-bar .fb{background:#1877F2; color:#fff}
.oe-social-bar .ig{background:#fff}
.oe-social-bar .x{margin-left:6px; background:#222a39; color:#fff; padding:8px 10px; border-radius:10px}
.oe-social-bar svg{width:18px;height:18px}
@media (min-width:900px){ .oe-social-bar{left:50%; right:auto; transform:translateX(-50%); width:min(760px,92vw)} }
@media (max-width:480px){ .oe-social-bar .txt{display:none} }
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "oe-social-bar";
  bar.innerHTML = `
    <div class="txt">Follow OverEdge for daily picks & updates:</div>
    <a class="btn fb" href="${LINKS.facebook}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12.07C22 6.48 17.52 2 11.93 2S2 6.48 2 12.07c0 5.02 3.66 9.19 8.44 9.93v-7.02H7.9v-2.9h2.54V9.41c0-2.5 1.5-3.88 3.79-3.88 1.1 0 2.25.2 2.25.2v2.47h-1.27c-1.25 0-1.64.78-1.64 1.58v1.9h2.79l-.45 2.9h-2.34V22c4.78-.74 8.44-4.91 8.44-9.93z"/></svg>
      Facebook
    </a>
    <a class="btn ig" href="${LINKS.instagram}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A5.5 5.5 0 1 1 6.5 13 5.5 5.5 0 0 1 12 7.5Zm0 2A3.5 3.5 0 1 0 15.5 13 3.5 3.5 0 0 0 12 9.5Zm5.75-3.25a.75.75 0 1 1-.75.75.75.75 0 0 1 .75-.75Z"/></svg>
      Instagram
    </a>
    <button class="x" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(bar);

  bar.querySelector(".x").addEventListener("click", () => {
    // hide for 7 days
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem(LS_KEY, String(Date.now() + sevenDays));
    bar.remove();
  });
})();

/* --- Consent shim so footer "Cookie settings" works everywhere --- */
window.oeConsent = window.oeConsent || {};
if (typeof window.oeConsent.revoke !== 'function') {
  window.oeConsent.revoke = function () {
    alert('Cookie settings coming soon.');
  };
}
