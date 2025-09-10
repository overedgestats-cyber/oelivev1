// overedge-api/lib/competitions.js
// Free Picks whitelist — NUMERIC league IDs from API-Football (v3).
// Leave empty to allow all EU domestic leagues (excluding Pro pool).

const FREE_PICKS_COMP_IDS = new Set([
  // Example: 88, 94, 203, 197, ...
  // 👉 Replace with the numbers from /api/free-picks/scan-leagues (see below).
]);

module.exports = { FREE_PICKS_COMP_IDS };
