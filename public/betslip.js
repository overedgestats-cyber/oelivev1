// public/js/betslip.js
(() => {
  // ---- Build one textual line for a pick ----
  // Supported fields: date/matchTime, country, league, home, away, market, selection, odds
  function pickLine(p = {}) {
    const when = (p.date || p.matchTime || "").trim();
    const comp = [p.country, p.league].filter(Boolean).join(" — ");
    const market = (p.market || "").trim();
    const selection = (p.selection || "").trim();
    const showSel = selection && !market.toLowerCase().includes(selection.toLowerCase());
    const mktSel = showSel ? `${market} ${selection}` : market;
    const odds =
      typeof p.odds === "number" && isFinite(p.odds) ? ` @ ${p.odds.toFixed(2)}` : "";
    const vs = `${p.home || ""} vs ${p.away || ""}`.trim();
    const left = when ? `${when} — ${vs}` : vs;
    const right = [mktSel || "", odds].join("").trim();
    const bracket = comp ? ` (${comp})` : "";
    return `${left} — ${right}${bracket}`;
  }

  // ---- Public API ----
  const OE_BetSlip = {
    // Simple: pass an array of plain pick objects (same shape the Free/Pro pages use)
    fromPicks(picks = []) {
      const lines = picks.map(pickLine);
      const title = `OverEdge Bet Slip — ${new Date().toISOString().slice(0, 10)}`;
      return [title, ...lines].join("\n");
    },

    // Builder for the grouped Pro Board payload (groups → leagues → fixtures)
    fromProBoard(groups = {}) {
      const all = [];
      (groups?.groups || []).forEach((g) => {
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
            });
          });
        });
      });
      return OE_BetSlip.fromPicks(all);
    },

    // Utilities
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        alert("Bet slip copied ✓");
      } catch {
        // Fallback: trigger download if clipboard not available
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
  };

  // Expose globally
  window.OE_BetSlip = OE_BetSlip;

  // Optional convenience helpers if you want to wire buttons directly:
  window.copyBetSlipFromPicks = (picks) =>
    OE_BetSlip.copyToClipboard(OE_BetSlip.fromPicks(picks));
  window.downloadBetSlipFromPicks = (picks) =>
    OE_BetSlip.download(OE_BetSlip.fromPicks(picks));
  window.copyBetSlipFromProBoard = (groupsPayload) =>
    OE_BetSlip.copyToClipboard(OE_BetSlip.fromProBoard(groupsPayload));
  window.downloadBetSlipFromProBoard = (groupsPayload) =>
    OE_BetSlip.download(OE_BetSlip.fromProBoard(groupsPayload));
})();
