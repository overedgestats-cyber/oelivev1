// public/script.js
(() => {
  "use strict";

  // Safe GA helper (no PII)
  function ga(event, params = {}) {
    try { window.gtag && window.gtag("event", event, params); } catch {}
  }

  // 1) Capture UTM params (once per session) and fallback referrer domain
  function captureUtm() {
    const p = new URLSearchParams(location.search);
    const keys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term"];
    let found = false;
    const utm = {};
    for (const k of keys) {
      const v = p.get(k);
      if (v) { utm[k] = v; found = true; }
    }
    if (found) sessionStorage.setItem("utm_params", JSON.stringify(utm));
    if (!found && document.referrer && !sessionStorage.getItem("referrer_domain")) {
      try { sessionStorage.setItem("referrer_domain", new URL(document.referrer).hostname); } catch {}
    }
  }

  // 2) Mark active nav link
  function markActiveNav() {
    const here = location.pathname.replace(/\/+$/, "");
    document.querySelectorAll("nav a[href]").forEach(a => {
      try {
        const href = new URL(a.href, location.origin).pathname.replace(/\/+$/, "");
        if (href === here) {
          a.setAttribute("aria-current", "page");
          a.classList.add("active");
        }
      } catch {}
    });
  }

  // 3) External link hardening + GA outbound click
  function externalLinkHardening() {
    const origin = location.origin;
    document.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href") || "";
      if (/^(mailto:|tel:|#)/i.test(href)) return;
      try {
        const u = new URL(href, origin);
        if (u.origin !== origin) {
          if (!a.hasAttribute("target")) a.setAttribute("target", "_blank");
          const rel = (a.getAttribute("rel") || "").split(/\s+/);
          if (!rel.includes("noopener")) rel.push("noopener");
          if (!rel.includes("noreferrer")) rel.push("noreferrer");
          a.setAttribute("rel", rel.join(" ").trim());
          a.addEventListener("click", () => ga("click_outbound", { destination: u.hostname }));
        }
      } catch {}
    });
  }

  // 4) Smooth scroll for in-page anchors
  function smoothHashScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener("click", e => {
        const id = a.getAttribute("href").slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", "#" + id);
      });
    });
  }

  // 5) Optional year auto-fill
  function setYear() {
    const el = document.getElementById("year");
    if (el) el.textContent = String(new Date().getFullYear());
  }

  // Expose tiny helpers for other scripts if needed
  window.__overedge = window.__overedge || {};
  window.__overedge.getUtmParams = () => {
    try { return JSON.parse(sessionStorage.getItem("utm_params") || "{}"); } catch { return {}; }
  };
  window.__overedge.getReferrerDomain = () => sessionStorage.getItem("referrer_domain") || "";

  document.addEventListener("DOMContentLoaded", () => {
    captureUtm();
    markActiveNav();
    externalLinkHardening();
    smoothHashScroll();
    setYear();
  });
})();
