// public/js/betslip.js
(() => {
  const LS_KEY = "oe.pro.selected";      // stores array of selection keys
  const BOARD_ID = "board";              // container where rows render
  const CHECK_CLS = "oe-fx-check";
  const ROW_SEL = ".fixture-row";

  // ---------- utils ----------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (s) => {
    const m = String(s || "").match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };
  const pctToProb = (pct) => clamp((Number(pct) || 0) / 100, 0.01, 0.99);
  const probToFair = (p) => (p > 0 ? (1 / p) : NaN);

  const readLS = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
  };
  const writeLS = (arr) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch {}
  };

  // ---------- parse one row from DOM ----------
  function parseFixtureRow(row) {
    try {
      // Country + League: find nearest league title above the row
      let league = "";
      let leagueShort = "";
      let country = "";
      // country-block wrapper
      const block = row.closest(".country-block");
      if (block) {
        const ch = block.querySelector(".country-header span");
        country = (ch ? ch.textContent.trim() : "") || "";
      }
      // league title = closest previous sibling with .league-title
      let seek = row.previousElementSibling;
      while (seek && !seek.classList.contains("league-title")) seek = seek.previousElementSibling;
      if (!seek && block) {
        // if row isn't immediately after title, scan from block start
        const titles = [...block.querySelectorAll(".league-title")];
        league = (titles.length ? titles[titles.length - 1].textContent.trim() : "");
      } else {
        league = seek ? seek.textContent.trim() : "";
      }
      leagueShort = league.replace(/\s*\(Regular Season\)\s*/i, "").replace(/\s*Group\s+[A-Z]\s*$/i, "");

      // Home/Away
      const names = [...row.querySelectorAll(".teams .team")].map((n) => n.textContent.trim());
      const home = names[0] || "";
      const away = names[1] || "";

      // Time
      const timeEl = row.querySelector(".fixture-meta .muted-sm");
      const matchTime = (timeEl ? timeEl.textContent.trim() : "") || "";

      // Market & pick (badge-pick)
      const pickEl = row.querySelector(".badge-pick");
      let market = "", selection = "";
      if (pickEl) {
        const t = pickEl.textContent.trim();
        // Formats our render uses: "OU Goals — Over 2.5", "BTTS — Yes", "1X2 — Home", etc.
        if (t.includes("—")) {
          const [m, s] = t.split("—").map((x) => x.trim());
          market = m; selection = s;
        } else {
          market = t;
        }
      }

      // Model & Confidence chips
      const modelChip = row.querySelector(".badge-chip.badge-model");
      const confChip  = row.querySelector(".badge-chip.badge-conf");
      const modelPct = modelChip ? num(modelChip.textContent) : NaN;
      const confPct  = confChip  ? num(confChip.textContent)  : NaN;

      // Optional odds if you later inject them (we’ll read if present)
      const oddsAttr = row.getAttribute("data-odds");
      const odds = oddsAttr ? Number(oddsAttr) : NaN;

      // Key for selection (stable-ish)
      const key = [
        country, leagueShort || league, matchTime, home, away, market, selection
      ].map((s) => (s || "").toLowerCase()).join("|");

      return {
        key, country, league, leagueShort,
        home, away, matchTime,
        market, selection,
        modelPct, confPct, odds
      };
    } catch {
      return null;
    }
  }

  // ---------- stake guide ----------
  function stakeGuide(pProb, decOdds = NaN) {
    const p = clamp(pProb, 0.01, 0.99);
    if (Number.isFinite(decOdds) && decOdds > 1.01) {
      // Kelly fraction: f* = (b*p - q)/b where b = d-1
      const b = decOdds - 1;
      const q = 1 - p;
      const k = (b * p - q) / b;     // full Kelly
      const f = clamp(k, 0, 0.25);   // cap at 25% to be conservative
      const h = clamp(f * 0.5, 0, 0.15); // half-Kelly suggestion
      return { type: "kelly", kelly: f, half: h };
    }
    // No market odds → tier by confidence bands
    // 0.55→0.6: 0.5u, 0.6→0.65: 0.75u, 0.65→0.7: 1u, 0.7→0.8: 1.25u, >0.8: 1.5u
    let units =
      p < 0.60 ? 0.5 :
      p < 0.65 ? 0.75 :
      p < 0.70 ? 1.0 :
      p < 0.80 ? 1.25 : 1.5;
    return { type: "tier", units };
  }

  function edgePct(pProb, decOdds) {
    if (!Number.isFinite(decOdds) || decOdds <= 1.01) return NaN;
    const p = clamp(pProb, 0.01, 0.99);
    return (p * decOdds - 1) * 100; // % edge
  }

  // ---------- slip line builders ----------
  function pickLineBasic(p = {}) {
    const when = (p.date || p.matchTime || "").trim();
    const comp = [p.country, p.league].filter(Boolean).join(" — ");
    const market = (p.market || "").trim();
    const selection = (p.selection || "").trim();
    const showSel = selection && !market.toLowerCase().includes(selection.toLowerCase());
    const mktSel = showSel ? `${market} — ${selection}` : market;
    const odds =
      typeof p.odds === "number" && isFinite(p.odds) ? ` @ ${p.odds.toFixed(2)}` : "";
    const vs = `${p.home || ""} vs ${p.away || ""}`.trim();
    const left = when ? `${when} — ${vs}` : vs;
    const bracket = comp ? ` (${comp})` : "";
    return `${left} — ${mktSel}${odds}${bracket}`;
  }

  function pickLineEnriched(p = {}) {
    const base = pickLineBasic(p);
    const pModel = pctToProb(p.modelPct);
    const pConf  = pctToProb(p.confPct);
    const fair = probToFair(pModel);
    const edge = edgePct(pModel, p.odds);
    const sg = stakeGuide(pModel, p.odds);

    const bits = [];
    if (Number.isFinite(p.modelPct)) bits.push(`Model ${p.modelPct}%`);
    if (Number.isFinite(p.confPct))  bits.push(`Confidence ${p.confPct}%`);
    if (Number.isFinite(fair))       bits.push(`Fair ${fair.toFixed(2)}`);
    if (Number.isFinite(p.odds))     bits.push(`Odds ${p.odds.toFixed(2)}`);
    if (Number.isFinite(edge))       bits.push(`Edge ${edge.toFixed(1)}%`);

    let stakeTxt = "";
    if (sg.type === "kelly") {
      stakeTxt = `Stake ~${(sg.half * 100).toFixed(1)}% bankroll (½-Kelly)`;
    } else {
      stakeTxt = `Stake ${sg.units.toFixed(2)}u`;
    }
    bits.push(stakeTxt);

    return `${base}\n  · ${bits.join("  · ")}`;
  }

  // ---------- Selections manager ----------
  function keyFromRow(row) {
    const parsed = parseFixtureRow(row);
    return parsed ? parsed.key : null;
  }

  function isSelected(key) {
    return readLS().includes(key);
  }

  function toggleSelection(key, on) {
    const cur = readLS();
    const has = cur.includes(key);
    if (on && !has) cur.push(key);
    if (!on && has) cur.splice(cur.indexOf(key), 1);
    writeLS(cur);
  }

  function ensureCheckbox(row) {
    if (!row || row.querySelector(`input.${CHECK_CLS}`)) return;
    const parsed = parseFixtureRow(row);
    if (!parsed) return;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = CHECK_CLS;
    cb.title = "Add to bet slip";
    cb.style.marginRight = ".4rem";

    // pre-check if selected
    cb.checked = isSelected(parsed.key);

    cb.addEventListener("change", () => {
      toggleSelection(parsed.key, cb.checked);
    });

    // Insert checkbox as the very first element in row (before teams)
    row.insertBefore(cb, row.firstChild);
  }

  function enhanceBoardOnce(root) {
    const rows = root.querySelectorAll(ROW_SEL);
    rows.forEach(ensureCheckbox);
  }

  // Observe dynamic renders (when market dropdown changes)
  function observeBoard(root) {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (!(n instanceof Element)) return;
            if (n.matches && n.matches(ROW_SEL)) ensureCheckbox(n);
            // also scan descendants in case rows got inserted within wrappers
            n.querySelectorAll && n.querySelectorAll(ROW_SEL).forEach(ensureCheckbox);
          });
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  // ---------- Collect selected picks from DOM ----------
  function collectSelectedFromDOM() {
    const root = document.getElementById(BOARD_ID);
    if (!root) return [];

    const out = [];
    const rows = root.querySelectorAll(ROW_SEL);
    rows.forEach((row) => {
      const parsed = parseFixtureRow(row);
      if (!parsed) return;
      const cb = row.querySelector(`input.${CHECK_CLS}`);
      if (cb && cb.checked) {
        // build enriched pick object
        out.push({
          date: parsed.matchTime || "",
          country: parsed.country,
          league: parsed.league,
          home: parsed.home,
          away: parsed.away,
          market: parsed.market,
          selection: parsed.selection,
          odds: Number.isFinite(parsed.odds) ? parsed.odds : undefined,
          modelPct: parsed.modelPct,
          confidencePct: parsed.confPct,
        });
      }
    });
    return out;
  }

  // ---------- Public API ----------
  const OE_BetSlip = {
    // Build simple text from plain pick objects
    fromPicks(picks = [], enriched = true) {
      const lines = picks.map((p) => (enriched ? pickLineEnriched(p) : pickLineBasic(p)));
      const title = `OverEdge Bet Slip — ${new Date().toISOString().slice(0, 10)}`;
      return [title, ...lines].join("\n");
    },

    // Builder for the grouped Pro Board payload (groups → leagues → fixtures)
    // NOTE: If the user has selected any rows via checkboxes, we ignore the payload
    // and export only the selected rows parsed from the DOM.
    fromProBoard(groupsPayload = {}) {
      const selected = collectSelectedFromDOM();
      if (selected.length) {
        return OE_BetSlip.fromPicks(selected, true);
      }
      // Fallback: build from payload (basic info only; no chips to parse)
      const all = [];
      (groupsPayload?.groups || []).forEach((g) => {
        (g.leagues || []).forEach((L) => {
          (L.fixtures || []).forEach((fx) => {
            const rec = fx?.recommendation || {};
            all.push({
              date: fx.time || fx.kickoff || "",
              country: g.country || "",
              league: L.leagueName || "",
              home: fx.home?.name || "",
              away: fx.away?.name || "",
              market: rec.market || "",
              selection: rec.pick || rec.selection || "",
              odds: rec.odds,
              modelPct: rec.modelProbPct,
              confidencePct: rec.confidencePct,
            });
          });
        });
      });
      return OE_BetSlip.fromPicks(all, true);
    },

    // Clipboard helpers
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        alert("Bet slip copied ✓");
      } catch {
        OE_BetSlip.download(text);
      }
    },

    download(text, filename) {
      const name =
        filename ||
        `overedge-betslip-${new Date().toISOString().slice(0, 10)}.txt`;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: name,
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    // Force (re)scan to inject checkboxes (exposed in case you need to call after a manual rerender)
    rescan() {
      const root = document.getElementById(BOARD_ID);
      if (root) enhanceBoardOnce(root);
    }
  };

  // Expose globally
  window.OE_BetSlip = OE_BetSlip;

  // ---------- Boot: enhance board + hook Export button ----------
  function boot() {
    const root = document.getElementById(BOARD_ID);
    if (root) {
      enhanceBoardOnce(root);
      observeBoard(root);
    }

    // Hijack/augment Export button so it uses selections when present
    const btn = document.getElementById("exportPro");
    if (btn) {
      // Let existing listener run too; our logic lives in fromProBoard()
      // so the existing pro.html call still works.
      // Optionally, add a tooltip to hint at the new behavior:
      btn.title = "Copies only selected games (if any are checked).";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
