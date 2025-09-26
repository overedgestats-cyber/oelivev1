/* OverEdge — GDPR-gated Meta Pixel (auto banner) */
(function () {
  const PIXEL_ID = "1852795272253731";
  const LS_KEY = "oe_consent_ads"; // "granted" | "denied"
  const dnt = (navigator.doNotTrack == "1" || window.doNotTrack == "1");

  function loadMetaPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s){
      if (f.fbq) return;
      n=f.fbq=function(){ n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments) };
      if (!f._fbq) f._fbq=n; n.push=n; n.loaded=!0; n.version='2.0'; n.queue=[];
      t=b.createElement(e); t.async=!0; t.src=v; s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s);
    }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');

    // Flush any queued events
    if (Array.isArray(window._oe_fbqQueue)) {
      window._oe_fbqQueue.forEach(args => fbq.apply(null, args));
      window._oe_fbqQueue.length = 0;
    }
  }

  // Queue-safe wrapper (use this everywhere instead of fbq)
  window.oeFbq = function() {
    const ok = localStorage.getItem(LS_KEY) === "granted" && !dnt && typeof window.fbq === "function";
    if (ok) return window.fbq.apply(null, arguments);
    (window._oe_fbqQueue = window._oe_fbqQueue || []).push([].slice.call(arguments));
  };

  // Minimal styles + banner injected once
  function injectStyles() {
    if (document.getElementById("oe-consent-style")) return;
    const css = `
.show-consent .oe-consent{display:flex}
.oe-consent{position:fixed;inset:auto 0 0 0;z-index:9999;background:#0b0f1a;color:#fff;padding:14px 16px;display:none;gap:10px;align-items:center;box-shadow:0 -4px 16px rgba(0,0,0,.25);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.oe-consent p{margin:0;flex:1;opacity:.9}
.oe-consent a{color:#8ec5ff;text-decoration:underline}
.oe-consent .btn{border:0;padding:8px 12px;cursor:pointer;border-radius:8px}
.oe-consent .btn-accept{background:#34c759;color:#0b0f1a;font-weight:600}
.oe-consent .btn-deny{background:#242a38;color:#fff}`;
    const style = document.createElement("style");
    style.id = "oe-consent-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectBanner() {
    if (document.getElementById("oe-consent")) return;
    const div = document.createElement("div");
    div.className = "oe-consent";
    div.id = "oe-consent";
    div.setAttribute("role", "dialog");
    div.setAttribute("aria-live", "polite");
    div.innerHTML = `
      <p>
        We use cookies for analytics and advertising. Click “Accept” to enable Meta Pixel.
        See our <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
      </p>
      <button class="btn btn-deny"   id="oe-deny">Deny</button>
      <button class="btn btn-accept" id="oe-accept">Accept</button>
    `;
    document.body.appendChild(div);
    document.getElementById("oe-deny").addEventListener("click", () => window.oeConsent.deny());
    document.getElementById("oe-accept").addEventListener("click", () => window.oeConsent.accept());
  }

  // Public consent helpers
  window.oeConsent = {
    accept() {
      localStorage.setItem(LS_KEY, "granted");
      if (!dnt) loadMetaPixel();
      document.documentElement.classList.remove('show-consent');
    },
    deny() {
      localStorage.setItem(LS_KEY, "denied");
      document.documentElement.classList.remove('show-consent');
      window._oe_fbqQueue = [];
    },
    revoke() {
      localStorage.removeItem(LS_KEY);
      document.documentElement.classList.add('show-consent');
    }
  };

  // Boot
  document.addEventListener("DOMContentLoaded", function() {
    injectStyles();
    const choice = localStorage.getItem(LS_KEY);
    if (!choice) {
      injectBanner();
      document.documentElement.classList.add('show-consent');
    } else if (choice === "granted" && !dnt) {
      loadMetaPixel();
    }
  });
})();
