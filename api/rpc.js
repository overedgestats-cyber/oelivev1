// ===================== rpc.js — PART 1/3 =====================
// /api/rpc.js  (single file)
// One endpoint, multiple actions via ?action=...

const API_BASE = "https://v3.football.api-sports.io";

/* --------------------- Firestore (Admin) init --------------------- */
let db = null;
try {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const pk = (process.env.FB_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FB_PROJECT_ID,
        clientEmail: process.env.FB_CLIENT_EMAIL,
        privateKey: pk,
      }),
    });
  }
  db = require("firebase-admin").firestore();
} catch (e) {
  console.error("Firestore init error:", e?.message || e);
  db = null;
}

/* ----------------- Firestore writer helpers ----------------- */
async function writeDailyPicks(kind, date, picks) {
  if (!db) return;
  if (!Array.isArray(picks) || !picks.length) return;

  const normKey = (s) => String(s || "").trim().toLowerCase();

  const colName =
    kind === "free-picks" ? "free_picks_results" :
    kind === "hero-bet"   ? "hero_bet_results"   :
    kind === "pro-board"  ? "pro_board_results"  : null;

  if (!colName) return;

  const col = db.collection(colName);
  const docRef = col.doc(date);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const existing = (snap.exists ? (snap.data()?.picks || []) : []);
    const merged = upsertPicks(existing, picks, (a, b) =>
      normKey(a.home) === normKey(b.home) &&
      normKey(a.away) === normKey(b.away) &&
      normKey(a.market) === normKey(b.market) &&
      normKey(a.selection || a.market) === normKey(b.selection || b.market)
    );
    tx.set(docRef, { date, picks: merged }, { merge: true });
  });
}

function upsertPicks(existing, incoming, eq) {
  const out = existing.slice();
  for (const p of incoming) {
    const idx = out.findIndex((x) => eq(x, p));
    const base = { status: "pending" };
    if (idx === -1) out.push({ ...base, ...cleanMerge(p) });
    else {
      out[idx] = { ...out[idx], ...cleanMerge(p) };
      if (!out[idx].status) out[idx].status = "pending";
    }
  }
  return out;
}
function cleanMerge(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    o[k] = v;
  }
  return o;
}

async function settlePick(kind, key, patch) {
  if (!db) throw new Error("No Firestore");
  const { date, home, away, market, selection } = key || {};
  if (!date || !home || !away) throw new Error("Missing date/home/away");

  const col = kind === "free-picks" ? "free_picks_results"
            : kind === "hero-bet"  ? "hero_bet_results"
            : kind === "pro-board" ? "pro_board_results"
            : null;
  if (!col) throw new Error("Unknown kind");

  const docRef = db.collection(col).doc(date);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new Error("Day doc not found");
    const data = snap.data() || {};
    const picks = Array.isArray(data.picks) ? data.picks : [];
    const norm = (s) => String(s || "").trim().toLowerCase();

    const idx = picks.findIndex((p) =>
      norm(p.home) === norm(home) &&
      norm(p.away) === norm(away) &&
      (!market || norm(p.market) === norm(market)) &&
      (!selection || norm(p.selection || p.market) === norm(selection))
    );
    if (idx === -1) throw new Error("Pick not found for day");

    const next = { ...picks[idx] };
    if (patch.status) next.status = String(patch.status).toLowerCase();
    if (patch.closing !== undefined) {
      const c = Number(patch.closing);
      if (Number.isFinite(c)) next.closing = c;
    }
    if (patch.finalScore !== undefined) next.finalScore = String(patch.finalScore);

    picks[idx] = next;
    tx.set(docRef, { picks }, { merge: true });
  });
}

/* --------------------------- Generic Helpers --------------------------- */
function ymd(d = new Date()) { return new Date(d).toISOString().slice(0, 10); }
function pct(n) { return Math.round(Math.max(1, Math.min(99, n * 100))); }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function clampRange(x, lo = 0.51, hi = 0.95){ return Math.max(lo, Math.min(hi, x)); }

function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.append(k, v);
  });
  return u.toString();
}
async function apiGet(path, params = {}) {
  const url = `${API_BASE}${path}?${qs(params)}`;
  const resp = await fetch(url, {
    headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY || "" },
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`API ${path} ${resp.status}`);
  const data = await resp.json();
  return (data && data.response) || [];
}
function clockFromISO(iso) {
  try { const m = String(iso||"").match(/T(\d{2}:\d{2})/); return m?m[1]:""; }
  catch { return ""; }
}
function stableSortFixtures(fixtures = []) {
  return [...fixtures].sort((a, b) => {
    const ai = a?.fixture?.id ?? 0;
    const bi = b?.fixture?.id ?? 0;
    if (ai !== bi) return ai - bi;
    const ad = a?.fixture?.date || "";
    const bd = b?.fixture?.date || "";
    return ad.localeCompare(bd);
  });
}
function setNoEdgeCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

// --- NEW: Month helpers + unit P/L (calendar month metrics) ---
function ymdStr(d){ return new Date(d).toISOString().slice(0,10); }
function monthRangeYYYYMMDD(now = new Date()){
  const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate   = new Date(now.getFullYear(), now.getMonth()+1, 0);
  return { from: ymdStr(fromDate), to: ymdStr(toDate) };
}
function unitPL(status, odds){
  const st = String(status || "").toLowerCase();
  const o  = Number(odds);
  if (!Number.isFinite(o) || o <= 1) return { staked: 0, pl: 0 };
  if (st === "win")  return { staked: 1, pl: (o - 1) };
  if (st === "loss" || st === "lose") return { staked: 1, pl: -1 };
  return { staked: 0, pl: 0 };
}

// --- Calibrated pick confidence (distinct from raw model prob)
function calibratedConfidence(sideProb, H, A) {
  const vol =
    0.50 * Math.abs(H.avgFor - A.avgFor) +
    0.20 * Math.abs(H.ppg - A.ppg) +
    0.10 * Math.abs(H.cleanSheetRate - A.cleanSheetRate) +
    0.10 * Math.abs(H.failToScoreRate - A.failToScoreRate);

  const base = 0.50 + (sideProb - 0.50) * 1.35 - 0.10 * vol;
  return Math.max(0.53, Math.min(0.90, base));
}

/* ---------------------------- Flags helper ---------------------------- */
const COUNTRY_CODE_MAP = {
  "England":"gb","Scotland":"gb","Wales":"gb","Northern Ireland":"gb","Ireland":"ie",
  "Spain":"es","Italy":"it","Germany":"de","France":"fr","Portugal":"pt","Netherlands":"nl","Belgium":"be",
  "Turkey":"tr","Greece":"gr","Austria":"at","Switzerland":"ch","Denmark":"dk","Norway":"no","Sweden":"se",
  "Poland":"pl","Czech Republic":"cz","Slovakia":"sk","Slovenia":"si","Croatia":"hr","Serbia":"rs",
  "Romania":"ro","Bulgaria":"bg","Hungary":"hu","Bosnia and Herzegovina":"ba","North Macedonia":"mk",
  "Albania":"al","Kosovo":"xk","Montenegro":"me","Moldova":"md","Ukraine":"ua","Belarus":"by",
  "Finland":"fi","Iceland":"is","Estonia":"ee","Latvia":"lv","Lithuania":"lt",
  "Luxembourg":"lu","Malta":"mt","Cyprus":"cy","Georgia":"ge","Armenia":"am","Azerbaijan":"az",
  "Faroe Islands":"fo","Andorra":"ad","San Marino":"sm","Gibraltar":"gi"
};
function flagURLFromCountryName(country) {
  const code = COUNTRY_CODE_MAP[country] || null;
  return code ? `https://flagcdn.com/24x18/${code}.png` : null;
}
function getLeagueFlag(league = {}) {
  return league?.flag || flagURLFromCountryName(league?.country || "");
}

/* -------- European scope (Free Picks only) ------- */
const EURO_COUNTRIES = [
  "England","Scotland","Wales","Northern Ireland","Ireland",
  "Spain","Italy","Germany","France","Portugal","Netherlands","Belgium",
  "Turkey","Greece","Austria","Switzerland","Denmark","Norway","Sweden",
  "Poland","Czech Republic","Slovakia","Slovenia","Croatia","Serbia",
  "Romania","Bulgaria","Hungary","Bosnia and Herzegovina","North Macedonia",
  "Albania","Kosovo","Montenegro","Moldova","Ukraine","Belarus",
  "Finland","Iceland","Estonia","Latvia","Lithuania",
  "Luxembourg","Malta","Cyprus","Georgia","Armenia","Azerbaijan",
  "Faroe Islands","Andorra","San Marino","Gibraltar"
];
const CUP_TOKENS = ["cup","pokal","beker","taça","taca","kup","kupa","cupa","coppa","copa","karik","knvb","dfb","scottish cup"];
const DENY_TIER_TOKENS = ["oberliga","regionalliga","3. liga","iii liga","liga 3","third division","liga 4","fourth","fifth","amateur","county","ykkönen","2. divisjon avd","reserve","reserves"," ii"," b team"," b-team"," b-team"," b-team"," b-team"];
const TIER1_PATTERNS = [/premier/i, /super\s?lig(?![ae])/i, /super\s?league(?!\s?2)/i, /bundesliga(?!.*2)/i, /la\s?liga(?!\s?2)/i, /serie\s?a/i, /ligue\s?1/i, /eredivisie/i, /ekstraklasa/i, /allsvenskan/i, /eliteserien/i, /superliga(?!\s?2)/i];
const TIER2_PATTERNS = [/championship/i, /2\.\s?bundesliga/i, /bundesliga\s?2/i, /la\s?liga\s?2/i, /segunda/i, /segund/i, /serie\s?b/i, /ligue\s?2/i, /eerste\s?divisie/i, /liga\s?portugal\s?2/i, /challenger\s?pro\s?league/i, /challenge\s?league/i, /1\.\s?lig/i, /2\.\s?liga/i, /superettan/i, /obos/i, /i\s?liga(?!\s?2)/i, /prva\s?liga/i, /super\s?league\s?2/i];
function isEuroCountry(c = "") { return EURO_COUNTRIES.includes(c); }
function hasToken(name = "", tokens = []) { const s = (name || "").toLowerCase(); return tokens.some(t => s.includes(t)); }
function matchAny(rxList, name = "") { return rxList.some(rx => rx.test(name || "")); }
function isCup(league = {}) { const type = (league?.type || "").toLowerCase(); const name = league?.name || ""; return type === "cup" || hasToken(name, CUP_TOKENS); }
function isUEFAComp(league = {}) {
  const country = league?.country || "";
  const name = (league?.name || "").toLowerCase();
  return country === "World" || country === "Europe" || hasToken(name, ["uefa","champions","europa","conference"]);
}
function isEuropeanTier12OrCup(league = {}) {
  const country = league?.country || "";
  const name = league?.name || "";
  if (hasToken(name, DENY_TIER_TOKENS)) return false;
  if (isUEFAComp(league)) return true;
  if (!isEuroCountry(country)) return false;
  if (isCup(league)) return true;
  if (matchAny(TIER1_PATTERNS, name)) return true;
  if (matchAny(TIER2_PATTERNS, name)) return true;
  return false;
}

/* -------------------- Youth exclusion -------------------- */
const YOUTH_REGEXES = [
  /\bu-?\s?(14|15|16|17|18|19|20|21|22|23)\b/i,
  /\bu(?:14|15|16|17|18|19|20|21|22|23)\b/i,
  /\byouth\b/i, /\bprimavera\b/i, /\bjunioren\b/i,
  /\bsub-?\s?(20|21)\b/i, /\bacademy\b/i
];
function isYouthFixture(fx = {}) {
  const ln = fx.league?.name || "";
  const h  = fx.teams?.home?.name || "";
  const a  = fx.teams?.away?.name || "";
  const hit = (s) => YOUTH_REGEXES.some(rx => rx.test(String(s)));
  return hit(ln) || hit(h) || hit(a);
}

/* ===== Rich reasoning text (kept for Free Picks / Hero) ===== */
const CARDS_BASELINE = 4.8;
const CORNERS_BASELINE = 9.7;
const fmtN = (x, d = 1) => (Number.isFinite(x) ? Number(x).toFixed(d) : "-");
const pctS = (p) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
const BR = "<br/>";

function reasonOURich(fx, H, A, pick, confPct, modelProbPct) {
  const h = fx.teams?.home?.name || "Home";
  const a = fx.teams?.away?.name || "Away";

  const over = (H.over25Rate + A.over25Rate) / 2;
  const btts = (H.bttsRate + A.bttsRate) / 2;
  const pace = (H.avgFor + A.avgFor + H.avgAg + A.avgAg) / 2;
  const parity = Math.abs(H.ppg - A.ppg) <= 0.30 ? "evenly matched"
                  : (H.ppg > A.ppg ? `${h} edge` : `${a} edge`);
  const csBoth = (H.cleanSheetRate + A.cleanSheetRate) / 2;
  const ftsBoth = (H.failToScoreRate + A.failToScoreRate) / 2;

  const tag = (label, val) => `<span class="pill" style="margin-right:.35rem">${label}: <strong>${val}</strong></span>`;
  const pctStr = (x)=> `${Math.round(x*100)}%`;
  const n1  = (x)=> Number.isFinite(x) ? x.toFixed(1) : "-";

  const snapshot = [
    tag("O2.5", pctStr(over)),
    tag("BTTS", pctStr(btts)),
    tag("Tempo (GF+GA/side)", n1(pace)),
    tag("Clean sheets", pctStr(csBoth)),
    tag("FTS", pctStr(ftsBoth)),
    tag("Parity", parity)
  ].join(" ");

  const headline = `${pick} — Confidence ${confPct}% · Model ${modelProbPct}%`;

  const why = pick.startsWith("Over")
    ? `${h} & ${a} create enough entries (tempo ${n1(pace)}). Elevated BTTS/O2.5 profile supports 3+ goals if early score arrives.`
    : `Compact phases + clean-sheet/FTS profile suppress totals. ${parity} matchup reduces end-to-end trading spells.`;

  const risks = [
    (csBoth >= 0.35 || ftsBoth >= 0.25) && pick.startsWith("Over") ? "High CS/FTS rates can die the total." : null,
    (Math.abs(H.ppg - A.ppg) <= 0.15) && !pick.startsWith("Over") ? "Very tight parity may still produce late chaos." : null,
  ].filter(Boolean);

  return [
    `<div style="margin:.15rem 0 .45rem; font-weight:700">${headline}</div>`,
    `<div class="muted-sm" style="margin:.2rem 0 .5rem">${snapshot}</div>`,
    `<div><strong>Why we like it:</strong> ${why}</div>`,
    risks.length ? `<div style="margin-top:.15rem"><strong>Risk flags:</strong> ${risks.join(" · ")}</div>` : ""
  ].join("");
}
function reasonBTTSRich(fx, H, A, pick, confPct) {
  const hN = fx.teams?.home?.name || "Home";
  const aN = fx.teams?.away?.name || "Away";
  const lines = [
    `${pick} — Confidence ${confPct}%`,
    `${hN}: BTTS ${pct(H.bttsRate)} · FTS ${pct(H.failToScoreRate)} · CS ${pct(H.cleanSheetRate)}`,
    `${aN}: BTTS ${pct(A.bttsRate)} · FTS ${pct(A.failToScoreRate)} · CS ${pct(A.cleanSheetRate)}`,
    `GF/GA (per match): ${hN} ${fmtN(H.avgFor)}/${fmtN(H.avgAg)} · ${aN} ${fmtN(A.avgFor)}/${fmtN(A.avgAg)}`
  ];
  const tail = pick.includes("Yes")
    ? "Both sides create enough to break each other; first goal should open the game."
    : "At least one side profiles for a clean sheet or low xG creation; BTTS fades.";
  return `${lines.join(BR)}${BR}${tail}`;
}
function reason1X2Rich(fx, H, A, pick, confPct) {
  const hN = fx.teams?.home?.name || "Home";
  const aN = fx.teams?.away?.name || "Away";
  const hGD = (H.avgFor - H.avgAg);
  const aGD = (A.avgFor - A.avgAg);
  const lines = [
    `${pick} — Confidence ${confPct}%`,
    `${hN}: PPG ${fmtN(H.ppg,2)} · GD/Match ${fmtN(hGD,2)} · W-D-L ${pct(H.winRate)}/${pct(H.drawRate)}/${pct(H.lossRate)}`,
    `${aN}: PPG ${fmtN(A.ppg,2)} · GD/Match ${fmtN(aGD,2)} · W-D-L ${pct(A.winRate)}/${pct(A.drawRate)}/${pct(A.lossRate)}`,
    `Edge drivers: venue boost (+0.20), recent differential, and GF/GA balance.`
  ];
  const tail = pick === "Home"
    ? "Hosts carry form + venue edge."
    : pick === "Away"
      ? "Visitors’ differential + transition threat travel well."
      : "Margins tight; risk profiles align toward a stalemate.";
  return `${lines.join(BR)}${BR}${tail}`;
}
function reasonCardsRich(fx, H, A, pick, confPct) {
  const avg = (H.avgAg + A.avgAg + H.avgFor + A.avgFor) / 4;
  const line = avg >= CARDS_BASELINE ? 5.5 : 4.5;
  const hName = fx.teams.home.name, aName = fx.teams.away.name;
  const homeTot = H.avgFor + H.avgAg, awayTot = A.avgFor + A.avgAg;
  const top = [
    `Model line: ${line} · Pick: ${pick} · Confidence ${confPct}%`,
    `${hName}: For ${fmtN(H.avgFor)}/Ag ${fmtN(H.avgAg)} · ${aName}: For ${fmtN(A.avgFor)}/Ag ${fmtN(A.avgAg)}`,
    `Clean sheets ${pctS(H.cleanSheetRate)} / ${pctS(A.cleanSheetRate)} · Failed-to-score ${pctS(H.failToScoreRate)} / ${pctS(A.failToScoreRate)}`
  ].join(BR);
  const parity = Math.abs(H.ppg - A.ppg) <= 0.30 ? "evenly matched" : (H.ppg > A.ppg ? "home-favoured" : "away-favoured");
  const overview = [
    `Tempo proxy: match totals run ${fmtN(homeTot)} (home) and ${fmtN(awayTot)} (away),`,
    `${avg >= CARDS_BASELINE ? "above" : "near/below"} baseline ${CARDS_BASELINE}.`,
    `Game looks ${parity}.`,
    pick.startsWith("Over")
      ? "Transitions + tactical fouls can lift count; late game management adds upside."
      : "Controlled phases and lower disruption can suppress bookings."
  ].join(" ");
  const verdict = `Pick: <strong>${pick}</strong> · Confidence ${confPct}%`;
  return `${top}${BR}${overview}${BR}${verdict}`;
}
function reasonCornersRich(fx, H, A, pick, confPct) {
  const pressure = (H.avgFor + A.avgFor) * 2.2 + (H.avgAg + A.avgAg) * 0.6;
  const line = pressure >= CORNERS_BASELINE ? 10.5 : 9.5;
  const hName = fx.teams.home.name, aName = fx.teams.away.name;
  const top = [
    `Model line: ${line} · Pick: ${pick} · Confidence ${confPct}%`,
    `Pressure proxy (GF/GA weighted): ${fmtN(pressure,1)} vs baseline ${CORNERS_BASELINE}`,
    `${hName} For ${fmtN(H.avgFor)} / Ag ${fmtN(H.avgAg)} · ${aName} For ${fmtN(A.avgFor)} / Ag ${fmtN(A.avgAg)}`
  ].join(BR);
  const balance = Math.abs(H.avgFor - A.avgFor) <= 0.2 ? "balanced supply from both flanks" : "attacking bias may tilt restarts";
  const overview = [
    `Sustained entries + shot pressure point to ${line === 10.5 ? "an above" : "a sub"}-baseline corner environment;`,
    balance + ".",
    pick.startsWith("Over")
      ? "Repeat entries/blocks favour volume; late leads can add defensive corners."
      : "If tempo compresses, entries drop and totals undershoot."
  ].join(" ");
  const verdict = `Pick: <strong>${pick}</strong> · Confidence ${confPct}%`;
  return `${top}${BR}${overview}${BR}${verdict}`;
}

/* ---- separate model probability vs adjusted confidence ---- */
function computeOUModelProb(H, A) {
  const overP  = H.over25Rate * 0.5 + A.over25Rate * 0.5;
  const underP = H.under25Rate * 0.5 + A.under25Rate * 0.5;
  const pick = overP >= underP ? "Over 2.5" : "Under 2.5";
  const model = pick === "Over 2.5" ? overP : underP;
  return { pick, modelProb: clampRange(model, 0.51, 0.95), overP, underP };
}
function adjustOUConfidence(pick, modelProb, H, A) {
  let adj = modelProb;
  const csGap = Math.abs(H.cleanSheetRate - A.cleanSheetRate);
  const ftsAvg = (H.failToScoreRate + A.failToScoreRate) / 2;
  const o25Venue = (H.o25HomeRate + A.o25AwayRate) / 2;
  const ppgGap = Math.abs(H.ppg - A.ppg);

  if (pick.startsWith("Over")) {
    adj += (o25Venue - 0.5) * 0.12;
    adj += (ppgGap) * 0.05;
    adj -= (csGap) * 0.05;
    adj -= (ftsAvg - 0.3) * 0.06;
  } else {
    adj += (csGap) * 0.06;
    adj += (ftsAvg - 0.3) * 0.07;
    adj -= (o25Venue - 0.5) * 0.10;
    adj -= (ppgGap) * 0.04;
  }
  return pct(clampRange(adj, 0.52, 0.97));
}

function computeBTTSModelProb(H, A) {
  const bttsP = H.bttsRate * 0.5 + A.bttsRate * 0.5;
  const pick = bttsP >= 0.5 ? "BTTS: Yes" : "BTTS: No";
  const model = pick === "BTTS: Yes" ? bttsP : (1 - bttsP);
  return { pick, modelProb: clampRange(model, 0.51, 0.95), bttsP };
}
function adjustBTTSConfidence(pick, modelProb, H, A) {
  let adj = modelProb;
  const csAvg  = (H.cleanSheetRate + A.cleanSheetRate) / 2;
  const ftsAvg = (H.failToScoreRate + A.failToScoreRate) / 2;
  if (pick.endsWith("Yes")) {
    adj -= (csAvg - 0.25) * 0.10;
    adj -= (ftsAvg - 0.25) * 0.10;
  } else {
    adj += (csAvg - 0.25) * 0.10;
    adj += (ftsAvg - 0.25) * 0.10;
  }
  return pct(clampRange(adj, 0.52, 0.97));
}

/* -------------------- Team stats + odds utilities -------------------- */
async function teamLastN(teamId, n = 12) {
  const rows = await apiGet("/fixtures", { team: teamId, last: n });

  let gp = 0, goalsFor = 0, goalsAg = 0, over25 = 0, under25 = 0, btts = 0;
  let wins = 0, draws = 0, losses = 0, cs = 0, fts = 0;
  let homeG = 0, awayG = 0, o25Home = 0, o25Away = 0;

  // split home / away detail
  let homeGF = 0, homeGA = 0, awayGF = 0, awayGA = 0;
  let homeCS = 0, homeFTS = 0, awayCS = 0, awayFTS = 0;
  let homePoints = 0, awayPoints = 0;

  for (const r of rows) {
    const gh = r?.goals?.home ?? 0;
    const ga = r?.goals?.away ?? 0;
    const total = gh + ga;

    const isHome = r?.teams?.home?.id === teamId;
    const tf = isHome ? gh : ga; // team goals for
    const ta = isHome ? ga : gh; // team goals against

    gp += 1;
    goalsFor += tf;
    goalsAg += ta;

    if (total >= 3) over25 += 1;
    if (total <= 2) under25 += 1;
    if (gh > 0 && ga > 0) btts += 1;

    if (tf > ta)      wins  += 1;
    else if (tf === ta) draws += 1;
    else              losses += 1;

    if (ta === 0) cs  += 1;
    if (tf === 0) fts += 1;

    if (isHome) {
      homeG += 1;
      homeGF += tf;
      homeGA += ta;
      if (total >= 3) o25Home += 1;
      if (ta === 0)   homeCS  += 1;
      if (tf === 0)   homeFTS += 1;
      if (tf > ta) homePoints += 3;
      else if (tf === ta) homePoints += 1;
    } else {
      awayG += 1;
      awayGF += tf;
      awayGA += ta;
      if (total >= 3) o25Away += 1;
      if (ta === 0)   awayCS  += 1;
      if (tf === 0)   awayFTS += 1;
      if (tf > ta) awayPoints += 3;
      else if (tf === ta) awayPoints += 1;
    }
  }

  const avgFor = gp ? goalsFor / gp : 0;
  const avgAg  = gp ? goalsAg  / gp : 0;
  const ppg    = gp ? (wins * 3 + draws) / gp : 0;

  const avgForHome = homeG ? homeGF / homeG : avgFor;
  const avgAgHome  = homeG ? homeGA / homeG : avgAg;
  const avgForAway = awayG ? awayGF / awayG : avgFor;
  const avgAgAway  = awayG ? awayGA / awayG : avgAg;

  const cleanSheetRate     = gp     ? cs  / gp     : 0;
  const failToScoreRate    = gp     ? fts / gp     : 0;
  const cleanSheetRateHome = homeG  ? homeCS / homeG : 0;
  const cleanSheetRateAway = awayG  ? awayCS / awayG : 0;
  const failToScoreRateHome = homeG ? homeFTS / homeG : 0;
  const failToScoreRateAway = awayG ? awayFTS / awayG : 0;
  const ppgHome            = homeG  ? homePoints / homeG : 0;
  const ppgAway            = awayG  ? awayPoints / awayG : 0;

  return {
    games: gp,
    avgFor,
    avgAg,
    over25Rate: gp ? over25 / gp : 0,
    under25Rate: gp ? under25 / gp : 0,
    bttsRate: gp ? btts / gp : 0,

    ppg,
    winRate:   gp ? wins  / gp : 0,
    drawRate:  gp ? draws / gp : 0,
    lossRate:  gp ? losses/ gp : 0,
    cleanSheetRate,
    failToScoreRate,

    o25HomeRate: homeG ? o25Home / homeG : 0,
    o25AwayRate: awayG ? o25Away / awayG : 0,

    homeGames: homeG,
    awayGames: awayG,

    goalsForHome: homeGF,
    goalsAgainstHome: homeGA,
    goalsForAway: awayGF,
    goalsAgainstAway: awayGA,

    avgForHome,
    avgAgHome,
    avgForAway,
    avgAgAway,

    cleanSheetRateHome,
    cleanSheetRateAway,
    failToScoreRateHome,
    failToScoreRateAway,

    ppgHome,
    ppgAway,
  };
}

const PREFERRED_BOOKMAKER_ID = Number(process.env.PREFERRED_BOOKMAKER_ID || 8) || null;

async function getOddsMap(fixtureId) {
  try {
    const rows = await apiGet("/odds", { fixture: fixtureId });
    const first = rows?.[0] || {};
    let bookies = Array.isArray(first.bookmakers) ? first.bookmakers.slice() : [];
    if (PREFERRED_BOOKMAKER_ID) {
      bookies.sort((a, b) => {
        const ap = Number(a?.id) === PREFERRED_BOOKMAKER_ID ? -1 : 0;
        const bp = Number(b?.id) === PREFERRED_BOOKMAKER_ID ? -1 : 0;
        return ap - bp;
      });
    }
    const out = {
      over25: null, under25: null, bttsYes: null, bttsNo: null,
      homeWin: null, draw: null, awayWin: null,
    };
    const fill = (k, v) => { if (out[k] == null && v != null && !isNaN(Number(v))) out[k] = Number(v); };

    for (const b of bookies) {
      for (const bet of (b?.bets || [])) {
        const name = (bet?.name || "").toLowerCase();
        if (name.includes("over/under") || name.includes("goals over/under")) {
          for (const v of (bet.values || [])) {
            const val = (v?.value || "").toLowerCase();
            if (val.includes("over 2.5"))  fill("over25",  v.odd);
            if (val.includes("under 2.5")) fill("under25", v.odd);
          }
        }
        if (name.includes("both teams to score")) {
          for (const v of (bet.values || [])) {
            const val = (v?.value || "").toLowerCase();
            if (val === "yes") fill("bttsYes", v.odd);
            if (val === "no")  fill("bttsNo",  v.odd);
          }
        }
        if (name.includes("match winner") || name.includes("1x2")) {
          for (const v of (bet.values || [])) {
            const val = (v?.value || "").toLowerCase();
            if (val === "home" || val === "1") fill("homeWin", v.odd);
            if (val === "draw" || val === "x") fill("draw",    v.odd);
            if (val === "away" || val === "2") fill("awayWin", v.odd);
          }
        }
      }
    }
    return out;
  } catch { return null; }
}

/* ------------------------ Free Picks (OU 2.5) ------------------------ */
async function scoreFixtureForOU25(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return null;
  const [H, A] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);

  const m = computeOUModelProb(H, A);
  const sideProb = m.pick === "Over 2.5" ? m.overP : m.underP;
  const modelProbPct = pct(sideProb);
  const confPct = pct(calibratedConfidence(sideProb, H, A));

  const time   = clockFromISO(fx?.fixture?.date);
  const odds   = await getOddsMap(fx?.fixture?.id);

  return {
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    leagueRound: fx?.league?.round || "",
    matchTime: time,
    home: fx?.teams?.home?.name,
    away: fx?.teams?.away?.name,
    market: m.pick,
    confidencePct: confPct,
    modelProbPct,
    odds: odds ? odds[m.pick === "Over 2.5" ? "over25" : "under25"] : null,
    reasoning: reasonOURich(fx, H, A, m.pick, confPct, modelProbPct),
  };
}

const FREEPICKS_CACHE = new Map();
function cacheKey(date, tz, minConf) { return `fp|${date}|${tz}|${minConf}`; }
function getCached(key) {
  const e = FREEPICKS_CACHE.get(key);
  if (e && e.exp > Date.now()) return e.payload;
  if (e) FREEPICKS_CACHE.delete(key);
  return null;
}
function putCached(key, payload) {
  const ttlMs = 22 * 60 * 60 * 1000;
  FREEPICKS_CACHE.set(key, { payload, exp: Date.now() + ttlMs });
}

async function pickFreePicks({ date, tz, minConf = 75 }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => isEuropeanTier12OrCup(fx.league));
  fixtures = stableSortFixtures(fixtures);
  const out = [];
  for (const fx of fixtures.slice(0, 80)) {
    try {
      const s = await scoreFixtureForOU25(fx);
      if (s && s.confidencePct >= minConf) out.push(s);
    } catch {}
  }
  out.sort((a, b) => (b.confidencePct - a.confidencePct) || ((a.fixtureId || 0) - (b.fixtureId || 0)));
  return { date, timezone: tz, picks: out.slice(0, 2) };
}

/* ------------------------- Hero Bet (value) -------------------------- */

// Hero tuning knobs (safe defaults)
const HERO_ODDS_MIN = Number(process.env.HERO_ODDS_MIN || 2.0);
const HERO_ODDS_MAX = Number(process.env.HERO_ODDS_MAX || 3.0);
const HERO_PROB_LO  = Number(process.env.HERO_PROB_LO  || 0.62);
const HERO_PROB_HI  = Number(process.env.HERO_PROB_HI  || 0.78);
const HERO_MIN_EDGE = Number(process.env.HERO_MIN_EDGE || 0.05); // 5pp edge vs implied

function onex2Lean(home, away) {
  const ha = 0.20;
  const score = (home.avgFor - home.avgAg + ha) - (away.avgFor - away.avgAg);
  if (score > 0.35) return { pick: "Home", conf: clamp01(0.55 + (score - 0.35) * 0.25) };
  if (score < -0.35) return { pick: "Away", conf: clamp01(0.55 + (-score - 0.35) * 0.25) };
  return { pick: "Draw", conf: 0.50 };
}

function heroMeta(prob, odds) {
  const o = Number(odds);
  const p = clamp01(Number(prob));
  if (!Number.isFinite(o) || o <= 1) return null;

  const implied = 1 / o;
  const edge = p - implied;            // + means value vs book
  const ev = p * o - 1;                // expected profit per 1u stake
  const fairOdds = p > 0 ? (1 / p) : null;

  return {
    impliedProb: implied,
    edge,
    ev,
    fairOdds,
  };
}

function inBand(p) {
  return p >= HERO_PROB_LO && p <= HERO_PROB_HI;
}

function oddsOk(o) {
  return Number.isFinite(o) && o >= HERO_ODDS_MIN && o <= HERO_ODDS_MAX;
}

// OU + BTTS + 1X2
async function scoreHeroCandidates(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return [];

  const [H, A] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const odds = await getOddsMap(fx?.fixture?.id);
  const time = clockFromISO(fx?.fixture?.date);

  const base = {
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    matchTime: time,
    home: fx?.teams?.home?.name || "",
    away: fx?.teams?.away?.name || "",
  };

  const candidates = [];

  /* -------- OU 2.5 -------- */
  const mOU = computeOUModelProb(H, A);

  // Over
  if (oddsOk(odds?.over25) && inBand(mOU.overP)) {
    const meta = heroMeta(mOU.overP, odds.over25);
    if (meta && meta.edge >= HERO_MIN_EDGE) {
      const confPct = pct(calibratedConfidence(mOU.overP, H, A));
      candidates.push({
        ...base,
        selection: "Over 2.5",
        market: "Over 2.5",
        confidencePct: confPct,
        modelProbPct: pct(mOU.overP),
        odds: Number(odds.over25),

        // value metrics
        impliedProbPct: pct(meta.impliedProb),
        edgePct: Math.round(meta.edge * 1000) / 10,     // e.g. 6.4 (% points)
        fairOdds: meta.fairOdds ? Number(meta.fairOdds.toFixed(2)) : null,
        ev: Number(meta.ev.toFixed(4)),

        valueScore: Number(meta.ev.toFixed(4)), // sort key
        reasoning: reasonOURich(fx, H, A, "Over 2.5", confPct, pct(mOU.overP)),
      });
    }
  }

  // Under
  if (oddsOk(odds?.under25) && inBand(mOU.underP)) {
    const meta = heroMeta(mOU.underP, odds.under25);
    if (meta && meta.edge >= HERO_MIN_EDGE) {
      const confPct = pct(calibratedConfidence(mOU.underP, H, A));
      candidates.push({
        ...base,
        selection: "Under 2.5",
        market: "Under 2.5",
        confidencePct: confPct,
        modelProbPct: pct(mOU.underP),
        odds: Number(odds.under25),

        impliedProbPct: pct(meta.impliedProb),
        edgePct: Math.round(meta.edge * 1000) / 10,
        fairOdds: meta.fairOdds ? Number(meta.fairOdds.toFixed(2)) : null,
        ev: Number(meta.ev.toFixed(4)),

        valueScore: Number(meta.ev.toFixed(4)),
        reasoning: reasonOURich(fx, H, A, "Under 2.5", confPct, pct(mOU.underP)),
      });
    }
  }

  /* -------- BTTS -------- */
  const mBT = computeBTTSModelProb(H, A);

  // Yes
  if (oddsOk(odds?.bttsYes) && inBand(mBT.bttsP)) {
    const meta = heroMeta(mBT.bttsP, odds.bttsYes);
    if (meta && meta.edge >= HERO_MIN_EDGE) {
      const confPct = pct(calibratedConfidence(mBT.bttsP, H, A));
      candidates.push({
        ...base,
        selection: "BTTS: Yes",
        market: "BTTS",
        confidencePct: confPct,
        modelProbPct: pct(mBT.bttsP),
        odds: Number(odds.bttsYes),

        impliedProbPct: pct(meta.impliedProb),
        edgePct: Math.round(meta.edge * 1000) / 10,
        fairOdds: meta.fairOdds ? Number(meta.fairOdds.toFixed(2)) : null,
        ev: Number(meta.ev.toFixed(4)),

        valueScore: Number(meta.ev.toFixed(4)),
        reasoning: reasonBTTSRich(fx, H, A, "BTTS: Yes", confPct),
      });
    }
  }

  // No (prob = 1 - bttsP)
  const pNo = 1 - mBT.bttsP;
  if (oddsOk(odds?.bttsNo) && inBand(pNo)) {
    const meta = heroMeta(pNo, odds.bttsNo);
    if (meta && meta.edge >= HERO_MIN_EDGE) {
      const confPct = pct(calibratedConfidence(pNo, H, A));
      candidates.push({
        ...base,
        selection: "BTTS: No",
        market: "BTTS",
        confidencePct: confPct,
        modelProbPct: pct(pNo),
        odds: Number(odds.bttsNo),

        impliedProbPct: pct(meta.impliedProb),
        edgePct: Math.round(meta.edge * 1000) / 10,
        fairOdds: meta.fairOdds ? Number(meta.fairOdds.toFixed(2)) : null,
        ev: Number(meta.ev.toFixed(4)),

        valueScore: Number(meta.ev.toFixed(4)),
        reasoning: reasonBTTSRich(fx, H, A, "BTTS: No", confPct),
      });
    }
  }

  /* -------- 1X2 -------- */
  const ox = onex2Lean(H, A);
  // Treat ox.conf as model probability (simple but consistent)
  const p1x2 = clampRange(ox.conf, 0.51, 0.90);

  const oddsKey =
    ox.pick === "Home" ? "homeWin" :
    ox.pick === "Away" ? "awayWin" :
    "draw";

  const o1x2 = odds?.[oddsKey];

  if (oddsOk(o1x2) && inBand(p1x2)) {
    const meta = heroMeta(p1x2, o1x2);
    if (meta && meta.edge >= HERO_MIN_EDGE) {
      const confPct = pct(calibratedConfidence(p1x2, H, A));
      candidates.push({
        ...base,
        selection: ox.pick,
        market: "1X2",
        confidencePct: confPct,
        modelProbPct: pct(p1x2),
        odds: Number(o1x2),

        impliedProbPct: pct(meta.impliedProb),
        edgePct: Math.round(meta.edge * 1000) / 10,
        fairOdds: meta.fairOdds ? Number(meta.fairOdds.toFixed(2)) : null,
        ev: Number(meta.ev.toFixed(4)),

        valueScore: Number(meta.ev.toFixed(4)),
        reasoning: reason1X2Rich(fx, H, A, ox.pick, confPct),
      });
    }
  }

  return candidates;
}

async function pickHeroBet({ date, tz, market = "auto" }) {
  const m0 = (market || "auto").toString().toLowerCase();
  const m  = (m0 === "ou_goals" || m0 === "btts" || m0 === "one_x_two" || m0 === "auto") ? m0 : "auto";

  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  let candidates = [];
  for (const fx of fixtures.slice(0, 110)) {
    try {
      const c = await scoreHeroCandidates(fx);
      const filtered = (m === "auto")
        ? c
        : c.filter(x =>
            (m === "ou_goals"  && (x.market === "Over 2.5" || x.market === "Under 2.5")) ||
            (m === "btts"      && x.market === "BTTS") ||
            (m === "one_x_two" && x.market === "1X2")
          );
      candidates = candidates.concat(filtered);
    } catch {}
  }

  if (!candidates.length) {
    return { heroBet: null, note: "No qualifying value pick found yet." };
  }

  // Sort by EV (valueScore), then by edge, then by confidence
  candidates.sort((a, b) =>
    (b.valueScore - a.valueScore) ||
    ((b.edgePct || 0) - (a.edgePct || 0)) ||
    ((b.confidencePct || 0) - (a.confidencePct || 0))
  );

  return { heroBet: candidates[0] };
}


async function pickHeroBet({ date, tz, market = "auto" }) {
  const m0 = (market || "auto").toString().toLowerCase();
  const m  = (m0 === "ou_goals" || m0 === "btts" || m0 === "auto") ? m0 : "auto";

  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  let candidates = [];
  for (const fx of fixtures.slice(0, 100)) {
    try {
      const c = await scoreHeroCandidates(fx);
      const filtered = (m === "auto")
        ? c
        : c.filter(x =>
            (m === "ou_goals" && (x.market === "Over 2.5" || x.market === "Under 2.5")) ||
            (m === "btts"     && x.market === "BTTS")
          );
      candidates = candidates.concat(filtered);
    } catch {}
  }
  if (!candidates.length) return { heroBet: null, note: "No qualifying value pick found yet." };
  candidates.sort((a, b) => b.valueScore - a.valueScore);
  return { heroBet: candidates[0] };
}
// ===================== rpc.js — PART 2/3 =====================

/* --------------------------- Pro Board data --------------------------- */
const PRO_ALLOWED = {
  England: [/^Premier League$/i, /^Championship$/i, /^FA Cup$/i],
  Germany: [/^Bundesliga$/i, /^2\.?\s*Bundesliga$/i, /^DFB[ -]?Pokal$/i],
  Spain: [/^La ?Liga$/i, /^(Segunda( División)?|La ?Liga 2)$/i, /^Copa del Rey$/i],
  Italy: [/^Serie ?A$/i, /^Serie ?B$/i, /^Coppa Italia$/i],
  France: [/^Ligue ?1$/i, /^Ligue ?2$/i, /^Coupe de France$/i],
};
const PRO_GLOBALS = [
  /FIFA Club World Cup/i,
  /UEFA Champions League/i,
  /UEFA Europa League/i,
  /UEFA Europa Conference League/i,
  /FIFA World Cup/i,
  /(UEFA )?European Championship|EURO\b/i,
  /Africa Cup of Nations|AFCON/i,
  /CONCACAF/i,
  /(UEFA )?Nations League/i,
];
function allowedForProBoard(league = {}) {
  const name = league?.name || "";
  const country = league?.country || "";
  if (PRO_GLOBALS.some(rx => rx.test(name))) return true;
  const rx = PRO_ALLOWED[country];
  if (!rx) return false;
  return rx.some(r => r.test(name));
}

/** Build classic (flat) Pro Board; markets: OU Goals, BTTS, 1X2 (NO odds) + xG */
async function buildProBoard({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  const rows = [];
  for (const fx of fixtures.slice(0, 160)) {
    try {
      const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
      if (!homeId || !awayId) continue;
      const [H, A] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);

      // xG proxy from scoring rates
      const xgHome  = Number(H.avgFor.toFixed(2));
      const xgAway  = Number(A.avgFor.toFixed(2));
      const xgTotal = Number((H.avgFor + A.avgFor).toFixed(2));

      const mOU = computeOUModelProb(H, A);
      const ouConfPct = adjustOUConfidence(mOU.pick, mOU.modelProb, H, A);
      const ou = {
        recommendation: mOU.pick,
        confidencePct: ouConfPct,
        modelProbPct: pct(mOU.modelProb),
        reasoning: reasonOURich(fx, H, A, mOU.pick, ouConfPct, pct(mOU.modelProb)),
      };

      const mBT = computeBTTSModelProb(H, A);
      const bttsConfPct = adjustBTTSConfidence(mBT.pick, mBT.modelProb, H, A);
      const btts = {
        recommendation: mBT.pick,
        confidencePct: bttsConfPct,
        modelProbPct: pct(mBT.modelProb),
        reasoning: reasonBTTSRich(fx, H, A, mBT.pick, bttsConfPct),
      };

      const onex2 = onex2Lean(H, A);
      const onex2ConfPct = pct(onex2.conf);
      const onex2Rec = {
        recommendation: onex2.pick,
        confidencePct: onex2ConfPct,
        modelProbPct: onex2ConfPct,
        reasoning: reason1X2Rich(fx, H, A, onex2.pick, onex2ConfPct),
      };

      const cands = [
        { market: "ou25", conf: mOU.modelProb },
        { market: "btts", conf: mBT.modelProb },
        { market: "onex2", conf: onex2.conf },
      ].sort((a,b)=> b.conf - a.conf);

      rows.push({
        fixtureId: fx?.fixture?.id,
        competition: (fx?.league?.country ? `${fx.league.country} — ` : "") + (fx?.league?.name || "League"),
        matchTime: clockFromISO(fx?.fixture?.date),
        home: fx?.teams?.home?.name || "",
        away: fx?.teams?.away?.name || "",
        xg: { home: xgHome, away: xgAway, total: xgTotal },
        markets: { ou25: ou, btts: btts, onex2: onex2Rec },
        best: { market: cands[0]?.market || "ou25" }
      });
    } catch {}
  }

  const groups = {};
  rows.forEach(r => {
    groups[r.competition] = groups[r.competition] || [];
    groups[r.competition].push(r);
  });
  Object.keys(groups).forEach(k => {
    groups[k].sort((a,b)=> (a.matchTime || "").localeCompare(b.matchTime || "")); 
  });
  return { date, timezone: tz, groups };
}

/* --------------- Pro Board grouped by country (flags + xG + stats) ---------------- */
/**
 * UPDATED:
 * - supports n=5|10|15 window
 * - returns fx.recommendations (what pro.html expects)
 * - keeps fx.recos for backward compatibility
 * - stats include ppg alias + pointsPerGame
 */
async function buildProBoardGrouped({ date, tz, market = "ou_goals", n = 15 }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));
  fixtures = stableSortFixtures(fixtures);

  const byCountry = new Map();

  for (const fx of fixtures.slice(0, 220)) {
    try {
      const country = fx.league?.country || "International";
      const flag = getLeagueFlag(fx.league) || flagURLFromCountryName(country);
      const leagueId = fx.league?.id;
      const leagueName = fx.league?.name || "League";
      const leagueShort = (fx.league?.name || "League")
        .replace(/\s*\(Regular Season\)\s*/i, "")
        .replace(/\s*Group\s+[A-Z]\s*$/i, "");

      if (!byCountry.has(country)) {
        byCountry.set(country, { country, flag, leagues: new Map() });
      }
      const c = byCountry.get(country);
      if (!c.leagues.has(leagueId)) {
        c.leagues.set(leagueId, { leagueId, leagueName, leagueShort, fixtures: [] });
      }
      const L = c.leagues.get(leagueId);

      const hId = fx?.teams?.home?.id;
      const aId = fx?.teams?.away?.id;

      let rec = null;
      let recos = null;          // backward compat
      let recommendations = null; // pro.html expects this
      let stats = null;
      let xgHome = null;
      let xgAway = null;

      if (hId && aId) {
        const N = [5,10,15].includes(Number(n)) ? Number(n) : 15;
        const [H, A] = await Promise.all([teamLastN(hId, N), teamLastN(aId, N)]);

        // xG proxy (per game)
        xgHome = Number((H.avgFor || 0).toFixed(2));
        xgAway = Number((A.avgFor || 0).toFixed(2));
        const xgTotal = Number((xgHome + xgAway).toFixed(2));

        // Always compute all 3 picks
        const mOU = computeOUModelProb(H, A);
        const mBT = computeBTTSModelProb(H, A);
        const ox  = onex2Lean(H, A);

        recommendations = {
          ou_goals:  { market: "ou_goals",  pick: mOU.pick },
          btts:      { market: "btts",      pick: mBT.pick },
          one_x_two: { market: "one_x_two", pick: ox.pick },
        };

        // keep alias
        recos = recommendations;

        // selected market pick
        rec = recommendations[market] || recommendations.ou_goals;

        stats = {
          sampleSize: N,
          home: {
            xg: xgHome,
            avgGoalsFor: H.avgForHome ?? H.avgFor ?? 0,
            avgGoalsAgainst: H.avgAgHome ?? H.avgAg ?? 0,
            cleanSheetRate: H.cleanSheetRateHome ?? H.cleanSheetRate ?? 0,
            failToScoreRate: H.failToScoreRateHome ?? H.failToScoreRate ?? 0,

            // aliases
            ppg: H.ppgHome ?? H.ppg ?? 0,
            pointsPerGame: H.ppgHome ?? H.ppg ?? 0,

            goalsFor: H.goalsForHome ?? 0,
            goalsAgainst: H.goalsAgainstHome ?? 0,
            over25Rate: H.o25HomeRate ?? 0,
            bttsRate: H.bttsRate ?? 0,
          },
          away: {
            xg: xgAway,
            avgGoalsFor: A.avgForAway ?? A.avgFor ?? 0,
            avgGoalsAgainst: A.avgAgAway ?? A.avgAg ?? 0,
            cleanSheetRate: A.cleanSheetRateAway ?? A.cleanSheetRate ?? 0,
            failToScoreRate: A.failToScoreRateAway ?? A.failToScoreRate ?? 0,

            // aliases
            ppg: A.ppgAway ?? A.ppg ?? 0,
            pointsPerGame: A.ppgAway ?? A.ppg ?? 0,

            goalsFor: A.goalsForAway ?? 0,
            goalsAgainst: A.goalsAgainstAway ?? 0,
            over25Rate: A.o25AwayRate ?? 0,
            bttsRate: A.bttsRate ?? 0,
          },
          matchup: {
            xgTotal,
            bttsLikelihood: clamp01(((H.bttsRate || 0) + (A.bttsRate || 0)) / 2),
            over25Likelihood: clamp01(((H.over25Rate || 0) + (A.over25Rate || 0)) / 2),
          },
        };
      }

      L.fixtures.push({
        fixtureId: fx.fixture?.id,
        time: clockFromISO(fx.fixture?.date),
        leagueId,
        leagueName,
        leagueShort,
        country,
        flag,
        home: {
          id: fx.teams?.home?.id,
          name: fx.teams?.home?.name,
          logo: fx.teams?.home?.logo,
        },
        away: {
          id: fx.teams?.away?.id,
          name: fx.teams?.away?.name,
          logo: fx.teams?.away?.logo,
        },
        xgHome,
        xgAway,
        stats,

        // ✅ new + compat
        recommendations,
        recos,

        // selected market pick
        recommendation: rec,
      });
    } catch {
      // ignore individual fixture errors
    }
  }

  const groups = Array.from(byCountry.values())
    .sort((a, b) => a.country.localeCompare(b.country))
    .map((c) => ([
      c.country,
      c.flag,
      Array.from(c.leagues.values())
        .sort((a, b) => (a.leagueName || "").localeCompare(b.leagueName || "")),
    ]))
    .map(([country, flag, leagues]) => ({ country, flag, leagues }));

  return { date, timezone: tz, groups };
}

/* ---------------------- Upstash (Redis) helpers ----------------------- */
const UP_URL   = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "";
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";
async function kvGet(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvSet(key, value, ttlSec = null) {
  if (!UP_URL || !UP_TOKEN) return null;
  let url = `${UP_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  if (ttlSec) url += `?EX=${ttlSec}`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store" });
  try { return await r.json(); } catch { return null; }
}
async function kvIncr(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/incr/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}
async function kvDel(key) {
  if (!UP_URL || !UP_TOKEN) return null;
  const r = await fetch(`${UP_URL}/del/${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${UP_TOKEN}` }, cache: "no-store",
  });
  try { return await r.json(); } catch { return null; }
}

/* ----- Free Picks persistent cache (Redis) ----- */
function fpRedisKey(date, tz, minConf){ return `freepicks:${date}:${tz}:${minConf}`; }
async function fpGet(date, tz, minConf){ try {
  const v = await kvGet(fpRedisKey(date, tz, minConf));
  if (v && typeof v.result === "string" && v.result) { return JSON.parse(v.result); }
} catch {} return null; }
async function fpSet(date, tz, minConf, payload){ try { await kvSet(fpRedisKey(date, tz, minConf), JSON.stringify(payload), 22 * 60 * 60); } catch {} }

/* --- In-memory day caches (22h TTL) --- */
const DAY_TTL_MS = 22 * 60 * 60 * 1000;
const PROPICK_CACHE   = new Map();
const PROBOARD_CACHE  = new Map();
const PROBOARDG_CACHE = new Map();
function getCachedPP(key){ const e = PROPICK_CACHE.get(key);   if (e && e.exp > Date.now()) return e.payload;   if (e) PROPICK_CACHE.delete(key);   return null; }
function putCachedPP(key, payload){ PROPICK_CACHE.set(key,   { payload, exp: Date.now() + DAY_TTL_MS }); }
function getCachedPB(key){ const e = PROBOARD_CACHE.get(key);  if (e && e.exp > Date.now()) return e.payload;   if (e) PROBOARD_CACHE.delete(key);  return null; }
function putCachedPB(key, payload){ PROBOARD_CACHE.set(key,  { payload, exp: Date.now() + DAY_TTL_MS }); }
function getCachedPBG(key){ const e = PROBOARDG_CACHE.get(key); if (e && e.exp > Date.now()) return e.payload; if (e) PROBOARDG_CACHE.delete(key); return null; }
function putCachedPBG(key, payload){ PROBOARDG_CACHE.set(key, { payload, exp: Date.now() + DAY_TTL_MS }); }

function ppCacheKey(date, tz, market){ return `pp|${date}|${tz}|${market}`; }
function pbCacheKey(date, tz){ return `pb|${date}|${tz}`; }
function pbgCacheKey(date, tz, market, n){ return `pbg|${date}|${tz}|${market}|n${n}`; }

function ppRedisKey(date, tz, market){ return `propick:${date}:${tz}:${market}`; }
async function ppGet(date, tz, market){
  try { const v = await kvGet(ppRedisKey(date, tz, market)); if (v && typeof v.result === "string" && v.result) return JSON.parse(v.result); }
  catch {} return null;
}
async function ppSet(date, tz, market, payload){
  try { await kvSet(ppRedisKey(date, tz, market), JSON.stringify(payload), 22 * 60 * 60); } catch {}
}
function pbRedisKey(date, tz){ return `proboard:${date}:${tz}`; }
async function pbGet(date, tz){
  try { const v = await kvGet(pbRedisKey(date, tz)); if (v && typeof v.result === "string" && v.result) return JSON.parse(v.result); }
  catch {} return null;
}
async function pbSet(date, tz, payload){
  try { await kvSet(pbRedisKey(date, tz), JSON.stringify(payload), 22 * 60 * 60); } catch {}
}

function pbgRedisKey(date, tz, market, n){ return `proboardg:${date}:${tz}:${market}:n${n}`; }
async function pbgGet(date, tz, market, n){
  try {
    const v = await kvGet(pbgRedisKey(date, tz, market, n)); 
    if (v && typeof v.result === "string" && v.result) return JSON.parse(v.result);
  } catch {} 
  return null;
}
async function pbgSet(date, tz, market, n, payload){
  try { await kvSet(pbgRedisKey(date, tz, market, n), JSON.stringify(payload), 22 * 60 * 60); } catch {}
}

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req, res) {
  try {
    setNoEdgeCache(res);
    const { action = "health" } = req.query;

    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    /* ======== CRON-FRIENDLY CAPTURE ======== */
    if (action === "capture-free-picks") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const payload = await pickFreePicks({ date, tz, minConf });

      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home, away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: (payload?.picks || []).length });
    }

    if (action === "capture-hero-bet") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "auto").toString().toLowerCase(); // auto|ou_goals|btts
      const payload = await pickHeroBet({ date, tz, market });

      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home,
            away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, stored: payload?.heroBet ? 1 : 0 });
    }

    if (action === "capture-proboard") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      const markets = ["ou_goals", "btts", "one_x_two"];
      let stored = 0;

      for (const m of markets) {
        const payload = await buildProBoardGrouped({ date, tz, market: m, n: 15 });
        try {
          const recs = [];
          for (const g of (payload?.groups || [])) {
            for (const L of (g.leagues || [])) {
              for (const fx of (L.fixtures || [])) {
                const r = fx?.recommendation;
                if (!r || !fx?.home?.name || !fx?.away?.name) continue;
                recs.push({
                  date,
                  matchTime: fx.time || null,
                  country: g.country || null,
                  league: L.leagueName || null,
                  home: fx.home.name,
                  away: fx.away.name,
                  market: r.market || null,
                  selection: r.pick || null,
                  odds: null,
                  fixtureId: fx.fixtureId || null,
                  source: "pro-board",
                  status: "pending"
                });
              }
            }
          }
          if (recs.length) {
            await writeDailyPicks("pro-board", date, recs);
            stored += recs.length;
          }
        } catch (e) {}
      }
      return res.status(200).json({ ok: true, stored });
    }

    /* ======== READERS FOR WIDGETS ======== */

    if (action === "current-month-free-picks") {
      try {
        if (!db) return res.status(200).json({ ok:true, month:null, picks:0, wins:0, winPct:0, roiPct:0, pl:0 });

        const { from, to } = monthRangeYYYYMMDD(new Date());
        let q = db.collection("free_picks_results")
          .where("date", ">=", from)
          .where("date", "<=", to)
          .orderBy("date", "asc");
        const snap = await q.get();

        let picks = 0, wins = 0;
        let staked = 0, pl = 0;

        snap.forEach((doc) => {
          const d = doc.data() || {};
          const arr = Array.isArray(d.picks) ? d.picks : [];
          for (const p of arr) {
            const st = String(p.status || "").toLowerCase();
            if (!st || st === "pending") continue;

            if (st === "win" || st === "loss" || st === "lose") {
              picks += 1;
              if (st === "win") wins += 1;
            }

            const r = unitPL(st, p.odds);
            staked += r.staked;
            pl     += r.pl;
          }
        });

        const winPct = picks ? Math.round((wins / picks) * 1000) / 10 : 0;
        const roiPct = staked ? Math.round((pl / staked) * 1000) / 10 : 0;

        const monthLabel = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });

        return res.status(200).json({
          ok: true,
          month: monthLabel,
          picks,
          wins,
          winPct,
          roiPct,
          pl: Math.round(pl * 100) / 100
        });
      } catch (e) {
        console.error("current-month-free-picks error:", e?.message || e);
        return res.status(200).json({ ok:false, error:"aggregation_failed" });
      }
    }

    if (action === "free-picks-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null;
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listFreePickResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("free-picks-results error:", e);
        return res.status(500).json({ error: "Results read error" });
      }
    }

    if (action === "hero-bet-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null;
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listHeroBetResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("hero-bet-results error:", e);
        return res.status(500).json({ error: "Hero results read error" });
      }
    }

    if (action === "pro-board-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null;
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listProBoardSummaries({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("pro-board-results error:", e);
        return res.status(500).json({ error: "Pro board results read error" });
      }
    }

    if (action === "public-config") {
      return res.status(200).json({
        firebase: {
          apiKey: process.env.FB_API_KEY || "",
          authDomain: process.env.FB_AUTH_DOMAIN || "",
          projectId: process.env.FB_PROJECT_ID || "",
          appId: process.env.FB_APP_ID || "",
          measurementId: process.env.FB_MEASUREMENT_ID || "",
        },
      });
    }

    if (action === "free-picks") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const minConf = Number(req.query.minConf || 75);
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = cacheKey(date, tz, minConf);

      if (!refresh) {
        const persisted = await fpGet(date, tz, minConf);
        if (persisted) { putCached(key, persisted); return res.status(200).json(persisted); }
        const cached = getCached(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickFreePicks({ date, tz, minConf });

      try {
        const toStore = (payload?.picks || []).map(p => ({
          date,
          matchTime: p.matchTime || null,
          country: p.country || null,
          league: p.league || null,
          home: p.home,
          away: p.away,
          market: p.market || "OU 2.5",
          selection: p.market || null,
          odds: (typeof p.odds === "number" ? p.odds : null),
          fixtureId: p.fixtureId || null,
          source: "free-picks",
          status: "pending"
        }));
        if (toStore.length) await writeDailyPicks("free-picks", date, toStore);
      } catch (e) {}

      putCached(key, payload);
      await fpSet(date, tz, minConf, payload);
      return res.status(200).json(payload);
    }

    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();

      const m0 = (req.query.market || "auto").toString().toLowerCase();
      const market = (m0 === "ou_goals" || m0 === "btts" || m0 === "auto") ? m0 : "auto";

      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = ppCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await ppGet(date, tz, market);
        if (persisted) { putCachedPP(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPP(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickHeroBet({ date, tz, market });

      try {
        const h = payload?.heroBet;
        if (h && h.home && h.away) {
          const toStore = [{
            date,
            matchTime: h.matchTime || null,
            country: h.country || null,
            league: h.league || null,
            home: h.home,
            away: h.away,
            market: h.market || null,
            selection: h.selection || h.market,
            odds: (typeof h.odds === "number" ? h.odds : null),
            fixtureId: h.fixtureId || null,
            source: "hero-bet",
            status: "pending"
          }];
          await writeDailyPicks("hero-bet", date, toStore);
        }
      } catch (e) {}

      putCachedPP(key, payload);
      await ppSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    if (action === "pro-board") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbCacheKey(date, tz);

      if (!refresh) {
        const persisted = await pbGet(date, tz);
        if (persisted) { putCachedPB(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPB(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoard({ date, tz });
      putCachedPB(key, payload);
      await pbSet(date, tz, payload);
      return res.status(200).json(payload);
    }

    if (action === "pro-board-grouped") {
      if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: "Missing API_FOOTBALL_KEY" });
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "ou_goals").toString().toLowerCase(); // ou_goals | btts | one_x_two

      const nRaw = Number(req.query.n || 15);
      const n = [5,10,15].includes(nRaw) ? nRaw : 15;

      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbgCacheKey(date, tz, market, n);

      if (!refresh) {
        const persisted = await pbgGet(date, tz, market, n);
        if (persisted) { putCachedPBG(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPBG(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoardGrouped({ date, tz, market, n });

      try {
        const recs = [];
        for (const g of (payload?.groups || [])) {
          for (const L of (g.leagues || [])) {
            for (const fx of (L.fixtures || [])) {
              const r = fx?.recommendation;
              if (!r || !fx?.home?.name || !fx?.away?.name) continue;
              recs.push({
                date,
                matchTime: fx.time || null,
                country: g.country || null,
                league: L.leagueName || null,
                home: fx.home.name,
                away: fx.away.name,
                market: r.market || null,
                selection: r.pick || null,
                odds: null,
                fixtureId: fx.fixtureId || null,
                source: "pro-board",
                status: "pending"
              });
            }
          }
        }
        if (recs.length) await writeDailyPicks("pro-board", date, recs);
      } catch (e) {}

      putCachedPBG(key, payload);
      await pbgSet(date, tz, market, n, payload);
      return res.status(200).json(payload);
    }

    /* ======== VERIFY SUB ======== */
    if (action === "verify-sub") {
      const email = (req.query.email || "").toString().trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const devs = (process.env.OE_DEV_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      if (devs.includes(email)) {
        return res.status(200).json({ pro: true, plan: "DEV", status: "override", overrideUntil: "9999-12-31" });
      }

      let base = { pro: false, plan: null, status: "none" };
      try { base = await verifyStripeByEmail(email); } catch {}

      let overrideSec = 0;
      try { overrideSec = await getProOverride(email); } catch {}
      const nowSec = Math.floor(Date.now() / 1000);
      const hasOverride = overrideSec > nowSec;

      return res.status(200).json({
        pro: base.pro || hasOverride,
        plan: base.plan,
        status: base.pro ? base.status : (hasOverride ? "override" : base.status),
        overrideUntil: hasOverride ? new Date(overrideSec * 1000).toISOString() : null,
      });
    }

    if (action === "settle") {
      const { kind = "free-picks", date, home, away, market = "", selection = "", status = "", closing = "", finalScore = "" } = req.query || {};
      if (!date || !home || !away) return res.status(400).json({ ok:false, error:"Missing date/home/away" });

      try {
        const patch = {};
        if (status)  patch.status = String(status).toLowerCase();
        if (closing !== "") patch.closing = Number(closing);
        if (finalScore !== "") patch.finalScore = String(finalScore);
        await settlePick(kind, { date, home, away, market, selection }, patch);
        return res.status(200).json({ ok:true });
      } catch (e) {
        return res.status(500).json({ ok:false, error: e?.message || "settle failed" });
      }
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
// ===================== rpc.js — PART 3/3 =====================

/* ================= Stripe Verify + Pro override merge ================= */
async function verifyStripeByEmail(email) {
  const key = process.env.STRIPE_SECRET || "";
  if (!key) throw new Error("Missing STRIPE_SECRET");

  const custResp = await fetch(`https://api.stripe.com/v1/customers?${qs({ email, limit: 3 })}`, {
    headers: { Authorization: `Bearer ${key}` }, cache: "no-store",
  });
  if (!custResp.ok) throw new Error(`Stripe customers ${custResp.status}`);
  const custData = await custResp.json();
  const customers = custData?.data || [];
  if (!customers.length) return { pro: false, plan: null, status: "none" };

  let best = null;
  for (const c of customers) {
    const subResp = await fetch(
      `https://api.stripe.com/v1/subscriptions?${qs({ customer: c.id, status: "all", limit: 10 })}` ,
      { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!subResp.ok) continue;
    const subData = await subResp.json();
    for (const s of (subData?.data || [])) {
      if (!best || (s.created || 0) > (best.created || 0)) best = s;
    }
  }
  if (!best) return { pro: false, plan: null, status: "none" };

  const activeStatuses = new Set(["active", "trialing"]);
  const isPro = activeStatuses.has(best.status);

  const item = best.items?.data?.[0] || {};
  const price = item.price || {};
  const nickname = price.nickname || null;
  const interval = price.recurring?.interval || null;
  const amount = typeof price.unit_amount === "number" ? (price.unit_amount / 100).toFixed(2) : null;
  const currency = price.currency ? price.currency.toUpperCase() : null;

  const plan = nickname || (interval ? `${interval}${amount ? ` ${amount} ${currency}` : ""}` : price.id || null);
  return { pro: isPro, plan, status: best.status };
}

async function getProOverride(email) {
  const v = await kvGet(`pro:override:${email}`);
  const sec = v && typeof v.result === "string" ? Number(v.result) : 0;
  return Number.isFinite(sec) ? sec : 0;
}

/* ===================== READERS ====================== */
async function listHeroBetResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("hero_bet_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];
    let dayPick = null;
    if (picks.length) {
      const p = { ...picks[0] };
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;
        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1;
        }
      }
      dayPick = {
        home: p.home, away: p.away,
        market: p.market || p.selection || "",
        odds: (typeof p.odds === "number" ? p.odds : null),
        status: p.status || "pending",
        finalScore: p.finalScore || null
      };
    }
    if (dayPick) days.push({ date: d.date, picks: [dayPick] });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;
  const total   = days.length;

  return { days, summary: { total, wins, losses, push, winRate, roiPct } };
}

async function listProBoardSummaries({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("pro_board_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let Gwins = 0, Glosses = 0, Gpush = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    let T = d.totals || {};

    if ((!T || !Object.keys(T).length) && Array.isArray(d.picks)) {
      const acc = {};
      for (const p of d.picks) {
        const st = String(p.status || "").toLowerCase();
        if (!st || st === "pending") continue;
        const m = String(p.market || p.selection || "Other");
        if (!acc[m]) acc[m] = { wins: 0, losses: 0, push: 0 };
        if (st === "win") acc[m].wins += 1;
        else if (st === "loss" || st === "lose") acc[m].losses += 1;
        else acc[m].push += 1;
      }
      T = acc;
    }

    const markets = Object.keys(T || {});
    let dayWinsCount = 0, dayLossesCount = 0, dayPushCount = 0;

    markets.forEach((m) => {
      const row = T[m] || {};
      const w = Number(row.wins   || 0);
      const l = Number(row.losses || 0);
      const p = Number(row.push   || 0);
      dayWinsCount   += w;
      dayLossesCount += l;
      dayPushCount   += p;
    });

    Gwins   += dayWinsCount;
    Glosses += dayLossesCount;
    Gpush   += dayPushCount;

    days.push({
      date: d.date,
      totals: T,
      combined: { wins: dayWinsCount, losses: dayLossesCount, push: dayPushCount },
    });
  });

  const settled = Gwins + Glosses;
  const winRate = settled ? Math.round((Gwins / settled) * 100) : null;

  const summary = {
    totalDays: days.length,
    wins: Gwins,
    losses: Glosses,
    push: Gpush,
    winRate,
    roiPct: null,
  };

  return { days, summary };
}

async function listFreePickResults({ from = null, to = null, limit = 60 } = {}) {
  if (typeof db === "undefined" || !db) return { days: [], summary: null };

  let q = db.collection("free_picks_results");
  if (from) q = q.where("date", ">=", from);
  if (to)   q = q.where("date", "<=", to);
  q = q.orderBy("date", "desc").limit(limit);

  const snap = await q.get();

  const days = [];
  let wins = 0, losses = 0, push = 0;
  let staked = 0, pnl = 0;

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const picks = Array.isArray(d.picks) ? d.picks : [];

    picks.forEach((p) => {
      const st = (p.status || "").toLowerCase();
      if (st && st !== "pending") {
        if (st === "win") wins += 1;
        else if (st === "loss" || st === "lose") losses += 1;
        else push += 1;

        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += st === "win" ? (o - 1) : -1;
        }
      }
    });

    days.push({
      date: d.date,
      picks: picks.map((p) => ({
        home: p.home,
        away: p.away,
        market: p.market,
        odds: (typeof p.odds === "number" ? p.odds : null),
        status: p.status || "pending",
        finalScore: p.finalScore || null,
      })),
    });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;

  const total = days.reduce((acc, d) => acc + (d.picks?.length || 0), 0);

  return {
    days,
    summary: { total, wins, losses, push, winRate, roiPct },
  };
}
