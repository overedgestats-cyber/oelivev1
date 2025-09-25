// /api/rpc.js
// One endpoint, multiple actions via ?action=...
// Actions:
//  - health
//  - public-config
//  - free-picks
//  - pro-pick            (Hero Bet; supports market=auto|ou_goals|btts|one_x_two)
//  - pro-board           (flat list; strict allowed comps)
//  - pro-board-grouped   (grouped by country with flag; strict allowed comps)
//  - verify-sub
//  - free-picks-results  (read Free Picks outcomes from Firestore)
//  - hero-bet-results    (read Hero Bet outcomes from Firestore)
//  - pro-board-results   (read Pro Board daily summaries from Firestore)

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

/* --------------------------- Generic Helpers --------------------------- */
function ymd(d = new Date()) { return new Date(d).toISOString().slice(0, 10); }
function pct(n) { return Math.round(Math.max(1, Math.min(99, n * 100))); }
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
  return data.response || [];
}
function clockFromISO(iso) {
  try { return new Date(iso).toISOString().substring(11, 16); } catch { return ""; }
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function stableSortFixtures(fixtures = []) {
  return [...fixtures].sort((a,b) => {
    const ai = a?.fixture?.id ?? 0;
    const bi = b?.fixture?.id ?? 0;
    if (ai !== bi) return ai - bi;
    const ad = a?.fixture?.date || "";
    const bd = b?.fixture?.date || "";
    return ad.localeCompare(bd);
  });
}

/* ---- NEW: ensure no CDN/edge caching of API responses (avoid stale by region) --- */
function setNoEdgeCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
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

/* -------- European scope (Free Picks only; keep broad) ------- */
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
const DENY_TIER_TOKENS = ["oberliga","regionalliga","3. liga","iii liga","liga 3","third division","liga 4","fourth","fifth","amateur","county","ykkönen","2. divisjon avd","reserve","reserves"," ii"," b team"," b-team"," b-team"];
const TIER1_PATTERNS = [/premier/i, /super\s?lig(?![ae])/i, /super\s?league(?!\s?2)/i, /bundesliga(?!.*2)/i, /la\s?liga(?!\s?2)/i, /serie\s?a/i, /ligue\s?1/i, /eredivisie/i, /ekstraklasa/i, /allsvenskan/i, /eliteserien/i, /superliga(?!\s?2)/i, /pro\s?league/i, /hnl/i];
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

/* ---------------- Narrative helpers (legacy + rich) --------------- */
function seededPick(seed, n) { const s = Number(seed || 0); const x = (s * 9301 + 49297) % 233280; return Math.abs(Math.floor((x / 233280) * n)); }
function narrativeOU(h, a, pick, seed = 0) {
  const overs = [
    "Front-foot styles on both sides should create volume: width, runners beyond, and set-piece threat point to an open game. Over 2.5 appeals.",
    "Neither team is inclined to sit; pressing and transitions can stretch the lines. An early goal would turbo-charge it. Over 2.5 is the value angle.",
    "Attacks look sharper than the back lines right now. With multiple scoring outlets, three or more feels live. Over 2.5 preferred."
  ];
  const unders = [
    "Both coaches prioritise structure; expect compact shapes and fewer clean looks. Without a quick breakthrough this stays cagey. Under 2.5 fits.",
    "Territory should be controlled rather than chaotic. Midfield traffic and low blocks limit clear chances. Under 2.5 is sensible.",
    "Defensive match-ups favour containment over chaos. Set-pieces may decide it, but volume should be capped. Under 2.5 appeals."
  ];
  const pool = pick === "Over 2.5" ? overs : unders;
  return pool[seededPick(seed, pool.length)];
}
function narrativeBTTS() {
  const temps = [
    "Both create enough to trouble each other and neither is flawless at the back. If one scores, the game should open. BTTS live.",
    "Hosts push at home while visitors counter with pace — both defences can be exposed in transition. BTTS makes sense."
  ];
  return temps[seededPick(0, temps.length)];
}
function narrative1X2(label) {
  const h = [
    "Home side carry the better recent differential and enjoy the venue edge. Narrow home lean.",
    "Support tilts to the hosts: stronger forward output and decent control phases suggest 1."
  ];
  const d = [
    "Margins look thin and risk profiles align; a chessy, low-variance script can land a stalemate.",
    "Neither side convincingly outpunches the other. A level game feels on script."
  ];
  const a = [
    "Visitors profile well on the break and can exploit space behind. Away lean with price support.",
    "Form tilt and chance quality favour the travellers. 2 is live."
  ];
  const pool = label === "Home" ? h : label === "Draw" ? d : a;
  return pool[seededPick(0, pool.length)];
}
function narrativeCards() {
  return "Discipline trends + derby intensity and referee profile drive card volume. Consider common lines around 4.5–5.5; late-game tactical fouls can inflate counts.";
}
function narrativeCorners() {
  return "Wide play, crossing volume, and shot pressure correlate with corners. Teams that attack the byline or fire from range often push totals near the 9.5–10.5 band.";
}

/* ===== Rich, data-forward reasoning blocks ===== */
const CARDS_BASELINE = 4.8;
const CORNERS_BASELINE = 9.7;
const fmtN = (x, d = 1) => (Number.isFinite(x) ? Number(x).toFixed(d) : "-");
const pctS = (p) => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
const BR = "<br/>";

/* OU Goals (Over/Under 2.5) */
function reasonOURich(fx, H, A, pick, confPct) {
  const hN = fx.teams?.home?.name || "Home";
  const aN = fx.teams?.away?.name || "Away";
  const lines = [
    `${pick} — Confidence ${confPct}%`,
    `${hN}: O2.5 ${pct(H.over25Rate)} (For ${fmtN(H.avgFor)}/Ag ${fmtN(H.avgAg)}) · ${aN}: O2.5 ${pct(A.over25Rate)} (For ${fmtN(A.avgFor)}/Ag ${fmtN(A.avgAg)})`,
    `${hN} home O2.5 ${pct(H.o25HomeRate || 0)} · ${aN} away O2.5 ${pct(A.o25AwayRate || 0)}`,
    `Form context: PPG ${fmtN(H.ppg,2)} vs ${fmtN(A.ppg,2)} · Clean-sheets ${pctS(H.cleanSheetRate)} / ${pctS(A.cleanSheetRate)}`
  ];
  const tail = pick.startsWith("Over")
    ? "Proactive shapes and repeat entries keep 3+ live."
    : "Controlled tempo + compact lines point to 0–2 goals more often.";
  return `${lines.join(BR)}${BR}${tail}`;
}

/* BTTS */
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

/* 1X2 */
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

/* OU Cards */
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

/* OU Corners */
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

/* ---- NEW: explicit lean calculators for Cards & Corners (with line) --- */
function computeCardsLean(H, A) {
  const avg = (H.avgAg + A.avgAg + H.avgFor + A.avgFor) / 4;
  const baseline = 4.8;
  const conf = Math.min(0.8, Math.max(0.55, 0.55 + Math.abs(avg - baseline) * 0.06));
  const line = avg >= baseline ? 5.5 : 4.5;
  return { pick: avg >= baseline ? `Over ${line}` : `Under ${line}`, confidencePct: pct(conf) };
}
function computeCornersLean(H, A) {
  const avg = (H.avgFor + A.avgFor) * 2.2 + (H.avgAg + A.avgAg) * 0.6;
  const baseline = 9.7;
  const conf = Math.min(0.8, Math.max(0.55, 0.55 + Math.abs(avg - baseline) * 0.05));
  const line = avg >= baseline ? 10.5 : 9.5;
  return { pick: avg >= baseline ? `Over ${line}` : `Under ${line}`, confidencePct: pct(conf) };
}

/* -------------------- Team stats + odds utilities -------------------- */
async function teamLastN(teamId, n = 12) {
  const rows = await apiGet("/fixtures", { team: teamId, last: n });
  let gp = 0, goalsFor = 0, goalsAg = 0, over25 = 0, under25 = 0, btts = 0;
  let wins = 0, draws = 0, losses = 0, cs = 0, fts = 0;

  let homeG = 0, awayG = 0, o25Home = 0, o25Away = 0;

  for (const r of rows) {
    const gh = r?.goals?.home ?? 0, ga = r?.goals?.away ?? 0, total = gh + ga;
    const isHome = r?.teams?.home?.id === teamId;
    const tf = isHome ? gh : ga;
    const ta = isHome ? ga : gh;

    gp += 1;
    goalsFor += tf;
    goalsAg  += ta;

    if (total >= 3) over25 += 1;
    if (total <= 2) under25 += 1;
    if (gh > 0 && ga > 0) btts += 1;

    if (tf > ta) { wins += 1; }
    else if (tf === ta) { draws += 1; }
    else { losses += 1; }

    if (ta === 0) cs += 1;
    if (tf === 0) fts += 1;

    if (isHome) { homeG += 1; if (total >= 3) o25Home += 1; }
    else { awayG += 1; if (total >= 3) o25Away += 1; }
  }

  const ppg = gp ? (wins * 3 + draws * 1) / gp : 0;

  return {
    games: gp,
    avgFor: gp ? goalsFor / gp : 0,
    avgAg: gp ? goalsAg / gp : 0,
    over25Rate: gp ? over25 / gp : 0,
    under25Rate: gp ? under25 / gp : 0,
    bttsRate: gp ? btts / gp : 0,

    ppg,
    winRate:   gp ? wins  / gp : 0,
    drawRate:  gp ? draws / gp : 0,
    lossRate:  gp ? losses/ gp : 0,
    cleanSheetRate:  gp ? cs  / gp : 0,
    failToScoreRate: gp ? fts / gp : 0,

    o25HomeRate: homeG ? o25Home / homeG : 0,
    o25AwayRate: awayG ? o25Away / awayG : 0,
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
  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const overP  = home.over25Rate  * 0.5 + away.over25Rate  * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const pick   = overP >= underP ? "Over 2.5" : "Under 2.5";
  const conf   = overP >= underP ? overP : underP;
  const time   = clockFromISO(fx?.fixture?.date);
  const odds   = await getOddsMap(fx?.fixture?.id);
  const confPct = pct(conf);

  return {
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    leagueRound: fx?.league?.round || "",
    matchTime: time,
    home: fx?.teams?.home?.name,
    away: fx?.teams?.away?.name,
    market: pick,
    confidencePct: confPct,
    odds: odds ? odds[pick === "Over 2.5" ? "over25" : "under25"] : null,
    reasoning: reasonOURich(fx, home, away, pick, confPct),
  };
}

const FREEPICKS_CACHE = new Map();
function cacheKey(date, tz, minConf) { return `fp|${date}|${tz}|${minConf}`; }
function getCached(key) { const e = FREEPICKS_CACHE.get(key); if (e && e.exp > Date.now()) return e.payload; if (e) FREEPICKS_CACHE.delete(e); return null; }
function putCached(key, payload) { const ttlMs = 22 * 60 * 60 * 1000; FREEPICKS_CACHE.set(key, { payload, exp: Date.now() + ttlMs }); }

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
function onex2Lean(home, away) {
  const ha = 0.20;
  const score = (home.avgFor - home.avgAg + ha) - (away.avgFor - away.avgAg);
  if (score > 0.35) return { pick: "Home", conf: clamp01(0.55 + (score - 0.35) * 0.25) };
  if (score < -0.35) return { pick: "Away", conf: clamp01(0.55 + (-score - 0.35) * 0.25) };
  return { pick: "Draw", conf: 0.50 };
}

async function scoreHeroCandidates(fx) {
  const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
  if (!homeId || !awayId) return [];
  const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);
  const odds = await getOddsMap(fx?.fixture?.id);
  const time = clockFromISO(fx?.fixture?.date);
  const candidates = [];

  const overP  = home.over25Rate  * 0.5 + away.over25Rate  * 0.5;
  const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
  const withinBand = (p, lo = 0.58, hi = 0.80) => p >= lo && p <= hi;

  if (odds?.over25 && odds.over25 >= 2.0 && withinBand(overP)) {
    const confPct = pct(overP);
    candidates.push({
      selection: "Over 2.5", market: "Over 2.5", conf: overP,
      valueScore: overP * odds.over25,
      reasoning: reasonOURich(fx, home, away, "Over 2.5", confPct),
    });
  }
  if (odds?.under25 && odds.under25 >= 2.0 && withinBand(underP)) {
    const confPct = pct(underP);
    candidates.push({
      selection: "Under 2.5", market: "Under 2.5", conf: underP,
      valueScore: underP * odds.under25,
      reasoning: reasonOURich(fx, home, away, "Under 2.5", confPct),
    });
  }
  const bttsP = home.bttsRate * 0.5 + away.bttsRate * 0.5;
  if (odds?.bttsYes && odds.bttsYes >= 2.0 && withinBand(bttsP)) {
    const confPct = pct(bttsP);
    candidates.push({
      selection: "BTTS: Yes", market: "BTTS", conf: bttsP,
      valueScore: bttsP * odds.bttsYes,
      reasoning: reasonBTTSRich(fx, home, away, "BTTS: Yes", confPct),
    });
  }

  const one = onex2Lean(home, away);
  if (odds) {
    const choose = one.pick === "Home" ? odds.homeWin : one.pick === "Away" ? odds.awayWin : odds.draw;
    if (choose && choose >= 2.0 && withinBand(one.conf, 0.55, 0.72)) {
      const confPct = pct(one.conf);
      candidates.push({
        selection: one.pick, market: "1X2", conf: one.conf,
        valueScore: one.conf * choose,
        reasoning: reason1X2Rich(fx, home, away, one.pick, confPct),
      });
    }
  }

  return candidates.map(c => ({
    fixtureId: fx?.fixture?.id,
    league: fx?.league?.name || "",
    country: fx?.league?.country || "",
    matchTime: time,
    home: fx?.teams?.home?.name || "",
    away: fx?.teams?.away?.name || "",
    selection: c.selection,
    market: c.market,
    confidencePct: pct(c.conf),
    valueScore: Number((c.valueScore || 0).toFixed(4)),
    reasoning: c.reasoning,
  }));
}

async function pickHeroBet({ date, tz, market = "auto" }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  let candidates = [];
  for (const fx of fixtures.slice(0, 100)) {
    try {
      const c = await scoreHeroCandidates(fx);
      const filtered = (market === "auto")
        ? c
        : c.filter(x =>
            (market === "ou_goals" && (x.market === "Over 2.5" || x.market === "Under 2.5")) ||
            (market === "btts" && x.market === "BTTS") ||
            (market === "one_x_two" && x.market === "1X2")
          );
      candidates = candidates.concat(filtered);
    } catch {}
  }
  if (!candidates.length) return { heroBet: null, note: "No qualifying value pick found yet." };
  candidates.sort((a, b) => b.valueScore - a.valueScore);
  return { heroBet: candidates[0] };
}

/* --------------------------- Pro Board data --------------------------- */
const PRO_ALLOWED = {
  England: [/^Premier League$/i, /^Championship$/i, /^FA Cup$/i],
  Germany: [/^Bundesliga$/i, /^2\.?\s*Bundesliga$/i, /^DFB[ -]?Pokal$/i],
  Spain: [/^La ?Liga$/i, /^(Segunda( División)?|La ?Liga 2)$/i, /^Copa del Rey$/i],
  Italy: [/^Serie ?A$/i, [/^Serie ?B$/i][0], /^Coppa Italia$/i],
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

/** Build classic (flat) Pro Board; markets: OU Goals, BTTS, 1X2 (NO odds) */
async function buildProBoard({ date, tz }) {
  let fixtures = await apiGet("/fixtures", { date, timezone: tz });
  fixtures = fixtures.filter(fx => !isYouthFixture(fx));
  fixtures = fixtures.filter(fx => allowedForProBoard(fx.league));

  const rows = [];
  for (const fx of fixtures.slice(0, 160)) {
    try {
      const homeId = fx?.teams?.home?.id, awayId = fx?.teams?.away?.id;
      if (!homeId || !awayId) continue;
      const [home, away] = await Promise.all([teamLastN(homeId), teamLastN(awayId)]);

      const overP  = home.over25Rate  * 0.5 + away.over25Rate  * 0.5;
      const underP = home.under25Rate * 0.5 + away.under25Rate * 0.5;
      const ouPick = overP >= underP ? "Over 2.5" : "Under 2.5";
      const ouConf = overP >= underP ? overP : underP;
      const ouConfPct = pct(ouConf);
      const ou = {
        recommendation: ouPick,
        confidencePct: ouConfPct,
        reasoning: reasonOURich(fx, home, away, ouPick, ouConfPct),
      };

      const bttsP  = home.bttsRate * 0.5 + away.bttsRate * 0.5;
      const bttsPick = bttsP >= 0.5 ? "BTTS: Yes" : "BTTS: No";
      const bttsConf = bttsP >= 0.5 ? bttsP : 1 - bttsP;
      const bttsConfPct = pct(bttsConf);
      const btts = {
        recommendation: bttsPick,
        confidencePct: bttsConfPct,
        reasoning: reasonBTTSRich(fx, home, away, bttsPick, bttsConfPct),
      };

      const onex2 = onex2Lean(home, away);
      const onex2ConfPct = pct(onex2.conf);
      const onex2Rec = {
        recommendation: onex2.pick,
        confidencePct: onex2ConfPct,
        reasoning: reason1X2Rich(fx, home, away, onex2.pick, onex2ConfPct),
      };

      const cands = [
        { market: "ou25", conf: ouConf },
        { market: "btts", conf: bttsConf },
        { market: "onex2", conf: onex2.conf },
      ];
      cands.sort((a,b)=> (b.conf - a.conf));

      rows.push({
        fixtureId: fx?.fixture?.id,
        competition: (fx?.league?.country ? `${fx.league.country} — ` : "") + (fx?.league?.name || "League"),
        matchTime: clockFromISO(fx?.fixture?.date),
        home: fx?.teams?.home?.name || "",
        away: fx?.teams?.away?.name || "",
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

/* --------------- Pro Board grouped by country (flags) ---------------- */
async function buildProBoardGrouped({ date, tz, market = "ou_goals" }) {
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

      if (!byCountry.has(country)) byCountry.set(country, { country, flag, leagues: new Map() });
      const c = byCountry.get(country);
      if (!c.leagues.has(leagueId)) c.leagues.set(leagueId, { leagueId, leagueName, fixtures: [] });
      const L = c.leagues.get(leagueId);

      const hId = fx?.teams?.home?.id, aId = fx?.teams?.away?.id;
      let rec = null, why = "";
      if (hId && aId) {
        const [H, A] = await Promise.all([teamLastN(hId), teamLastN(aId)]);
        if (market === "ou_goals") {
          const overP = H.over25Rate*0.5 + A.over25Rate*0.5;
          const underP = H.under25Rate*0.5 + A.under25Rate*0.5;
          const pick = overP >= underP ? "Over 2.5" : "Under 2.5";
          const conf = overP >= underP ? overP : underP;
          const confPct = pct(conf);
          rec = { market: "OU Goals", pick, confidencePct: confPct };
          why = reasonOURich(fx, H, A, pick, confPct);
        } else if (market === "btts") {
          const b = H.bttsRate*0.5 + A.bttsRate*0.5;
          const pick = b >= 0.5 ? "BTTS: Yes" : "BTTS: No";
          const conf = b >= 0.5 ? b : 1 - b;
          const confPct = pct(conf);
          rec = { market: "BTTS", pick, confidencePct: confPct };
          why = reasonBTTSRich(fx, H, A, pick, confPct);
        } else if (market === "one_x_two") {
          const ox = onex2Lean(H, A);
          const confPct = pct(ox.conf);
          rec = { market: "1X2", pick: ox.pick, confidencePct: confPct };
          why = reason1X2Rich(fx, H, A, ox.pick, confPct);
        } else if (market === "ou_cards") {
          const lean = computeCardsLean(H, A);
          rec = { market: "OU Cards", pick: lean.pick, confidencePct: lean.confidencePct };
          why = reasonCardsRich(fx, H, A, lean.pick, lean.confidencePct);
        } else if (market === "ou_corners") {
          const lean = computeCornersLean(H, A);
          rec = { market: "OU Corners", pick: lean.pick, confidencePct: lean.confidencePct };
          why = reasonCornersRich(fx, H, A, lean.pick, lean.confidencePct);
        }
      }

      L.fixtures.push({
        fixtureId: fx.fixture?.id,
        time: clockFromISO(fx.fixture?.date),
        leagueId, leagueName, country, flag,
        home: { id: fx.teams?.home?.id, name: fx.teams?.home?.name, logo: fx.teams?.home?.logo },
        away: { id: fx.teams?.away?.id, name: fx.teams?.away?.name, logo: fx.teams?.away?.logo },
        recommendation: rec,
        reasoning: why
      });
    } catch {}
  }

  const groups = Array.from(byCountry.values())
    .sort((a,b)=> a.country.localeCompare(b.country))
    .map(c => ({
      country: c.country, flag: c.flag,
      leagues: Array.from(c.leagues.values()).sort((a,b)=> (a.leagueName || "").localeCompare(b.leagueName || ""))}
    ));

  return { date, timezone: tz, groups };
}

/* ----------------- Stripe verify + Pro override merge ---------------- */
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
      `https://api.stripe.com/v1/subscriptions?${qs({ customer: c.id, status: "all", limit: 10 })}`,
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

/* --- In-memory day caches for Pro endpoints (22h TTL) --- */
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

// Cache keys
function ppCacheKey(date, tz, market){ return `pp|${date}|${tz}|${market}`; }
function pbCacheKey(date, tz){ return `pb|${date}|${tz}`; }
function pbgCacheKey(date, tz, market){ return `pbg|${date}|${tz}|${market}`; }

/* ----- Pro pick / board persistent caches (Redis) ----- */
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

function pbgRedisKey(date, tz, market){ return `proboardg:${date}:${tz}:${market}`; }
async function pbgGet(date, tz, market){
  try { const v = await kvGet(pbgRedisKey(date, tz, market)); 
    if  (v && typeof v.result === "string" && v.result) return JSON.parse(v.result);
} catch {} return null;
}
async function pbgSet(date, tz, market, payload){
  try { await kvSet(pbgRedisKey(date, tz, market), JSON.stringify(payload), 22 * 60 * 60); } catch {}
}

/* ------------------------------ Handler ------------------------------ */
export default async function handler(req, res) {
  try {
    setNoEdgeCache(res); // <-- prevent CDN caching differences by region
    const { action = "health" } = req.query;

    if (action === "health") {
      return res.status(200).json({ ok: true, env: process.env.NODE_ENV || "unknown" });
    }

    // FREE PICKS — RESULTS (read from Firestore)
    if (action === "free-picks-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listFreePickResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("free-picks-results error:", e);
        return res.status(500).json({ error: "Results read error" });
      }
    }

    // HERO BET — RESULTS (read from Firestore)
    if (action === "hero-bet-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
        const to    = (req.query.to    || "").toString().slice(0, 10) || null;
        const limit = Number(req.query.limit || 60);
        const payload = await listHeroBetResults({ from, to, limit });
        return res.status(200).json(payload);
      } catch (e) {
        console.error("hero-bet-results error:", e);
        return res.status(500).json({ error: "Hero results read error" });
      }
    }

    // PRO BOARD — DAILY SUMMARIES (read from Firestore; aggregates by market)
    if (action === "pro-board-results") {
      try {
        const from  = (req.query.from  || "").toString().slice(0, 10) || null; // YYYY-MM-DD
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
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
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
      putCached(key, payload);
      await fpSet(date, tz, minConf, payload);
      return res.status(200).json(payload);
    }

    // HERO BET (Pro pick) — pinned by date/tz/market unless refresh=1 (no odds exposed)
    if (action === "pro-pick") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "auto").toString().toLowerCase();
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = ppCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await ppGet(date, tz, market);
        if (persisted) { putCachedPP(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPP(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await pickHeroBet({ date, tz, market });
      putCachedPP(key, payload);
      await ppSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // PRO BOARD (flat) — NO odds
    if (action === "pro-board") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
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

    // PRO BOARD GROUPED — NO odds
    if (action === "pro-board-grouped") {
      if (!process.env.API_FOOTBALL_KEY) {
        return res.status(500).json({ error: "Missing API_FOOTBALL_KEY in environment." });
      }
      const tz = req.query.tz || "Europe/Sofia";
      const date = req.query.date || ymd();
      const market = (req.query.market || "ou_goals").toString().toLowerCase(); // ou_goals|ou_cards|ou_corners|one_x_two|btts
      const refresh = ["1","true","yes"].includes((req.query.refresh || "").toString().toLowerCase());
      const key = pbgCacheKey(date, tz, market);

      if (!refresh) {
        const persisted = await pbgGet(date, tz, market);
        if (persisted) { putCachedPBG(key, persisted); return res.status(200).json(persisted); }
        const cached = getCachedPBG(key);
        if (cached) return res.status(200).json(cached);
      }

      const payload = await buildProBoardGrouped({ date, tz, market });
      putCachedPBG(key, payload);
      await pbgSet(date, tz, market, payload);
      return res.status(200).json(payload);
    }

    // VERIFY SUB
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

    return res.status(404).json({ error: "Unknown action" });
  } catch (err) {
    console.error("RPC error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* ===================== READ: Hero Bet results ====================== */
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
    const p = {
      home: d.home, away: d.away,
      market: d.market || d.selection || "",
      odds: (typeof d.odds === "number" ? d.odds : null),
      status: d.status || "pending",
      finalScore: d.finalScore || null
    };

    const st = (p.status || "").toLowerCase();
    if (st && st !== "pending") {
      if (st === "win") wins += 1;
      else if (st === "loss" || st === "lose") losses += 1;
      else push += 1;

      if (typeof p.odds === "number" && p.odds > 1) {
        staked += 1;
        pnl += (st === "win") ? (p.odds - 1) : -1; // 1u staking
      }
    }

    days.push({ date: d.date, picks: [p] }); // one hero pick per day
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;
  const total   = days.length;

  return { days, summary: { total, wins, losses, push, winRate, roiPct } };
}

/* ===================== READ: Pro Board daily summaries ====================== */
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
    const T = d.totals || {};
    const markets = Object.keys(T);

    let dayWins = 0, dayLosses = 0, dayPush = 0;

    markets.forEach(m => {
      const row = T[m] || {};
      const w = Number(row.wins  || 0);
      const l = Number(row.losses|| 0);
      const p = Number(row.push  || 0);
      dayWins   += w; dayLosses += l; dayPush += p;
    });

    Gwins  += dayWins;
    Glosses+= dayLosses;
    Gpush  += dayPush;

    days.push({
      date: d.date,
      totals: T,
      combined: { wins: dayWins, losses: dayLosses, push: dayPush }
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
    roiPct: null
  };

  return { days, summary };
}

/* ===================== READ: Free Picks results ====================== */
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
        else if (st === "loss") losses += 1;
        else push += 1;

        const o = Number(p.odds);
        if (Number.isFinite(o) && o > 1) {
          staked += 1;
          pnl += (st === "win") ? (o - 1) : -1; // 1u ROI calc
        }
      }
    });

    days.push({
      date: d.date,
      picks: picks.map(p => ({
        home: p.home, away: p.away, market: p.market,
        odds: p.odds ?? null, status: p.status || "pending",
        finalScore: p.finalScore || null
      }))
    });
  });

  const settled = wins + losses;
  const winRate = settled ? Math.round((wins / settled) * 100) : null;
  const roiPct  = staked ? Math.round((pnl / staked) * 100) : null;

  const total = days.reduce((acc, d) => acc + (d.picks?.length || 0), 0);

  return {
    days,
    summary: { total, wins, losses, push, winRate, roiPct }
  };
}
