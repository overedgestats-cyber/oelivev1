// scripts/backfill-free-picks.mjs
import fs from "fs";
import admin from "firebase-admin";

// ---- load service account (ENV JSON or file path) ----
function loadServiceAccount() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson && envJson.trim().startsWith("{")) {
    return JSON.parse(envJson);
  }
  const file = process.env.SERVICE_ACCOUNT_FILE || "./serviceAccountKey.json";
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ymd(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

// ---------- EDIT THESE DATES IF NEEDED ----------
const TODAY = process.env.BACKFILL_TODAY || ymd();                       // e.g. "2025-09-20"
const PREV_DATE = process.env.BACKFILL_PREV_DATE || ymd(Date.now() - 86400000); // yesterday by default

// ---------- YOUR DATA ----------
const todaysPicks = [
  { home: "Ogre United",        away: "Riga Mariners",      market: "Over 2.5", odds: 1.65, status: "win" },
  { home: "1899 Hoffenheim",    away: "Bayern München",     market: "Over 2.5", odds: 1.35, status: "win" },
];

const previousPicks = [
  { home: "Tonbridge Angels",   away: "Steyning Town",         market: "Over 2.5", odds: 1.67, status: "win" },
  { home: "Rylands",            away: "Ashton United",         market: "Under 2.5", odds: 1.80, status: "win" },
  { home: "Sharjah FC",         away: "Al-Gharafa",            market: "Over 2.5", odds: 1.70, status: "win" },
  { home: "Pitea W",            away: "Brommapojkarna W",      market: "Over 2.5", odds: 1.69, status: "win" },
  { home: "Marupe",             away: "JDFS Alberts",          market: "Over 2.5", odds: 1.47, status: "win" },
  { home: "Cham",               away: "Vevey Sports",          market: "Over 2.5", odds: 1.54, status: "win" },
  { home: "Rothis",             away: "Sturm Graz",            market: "Over 2.5", odds: 1.20, status: "loss" },
];

// ---------- Firestore write (idempotent merge) ----------
function keyOf(x) {
  return (x.fixtureId ? `fx#${x.fixtureId}` :
    `${(x.home||"").toLowerCase()}#${(x.away||"").toLowerCase()}#${(x.market||"").toLowerCase()}`);
}

async function upsertDay(db, dateISO, picks) {
  if (!picks?.length) return { dateISO, added: 0 };
  const docRef = db.collection("free_picks_results").doc(dateISO);
  const snap = await docRef.get();
  const incoming = picks.map(p => ({
    fixtureId: p.fixtureId || null,
    home: p.home, away: p.away,
    market: p.market,
    odds: typeof p.odds === "number" ? p.odds : null,
    status: String(p.status || "pending").toLowerCase(),
  }));

  if (!snap.exists) {
    await docRef.set({ date: dateISO, picks: incoming });
    return { dateISO, added: incoming.length };
  }

  const current = Array.isArray(snap.data().picks) ? snap.data().picks : [];
  const have = new Set(current.map(keyOf));
  const toAdd = incoming.filter(p => !have.has(keyOf(p)));
  if (toAdd.length) {
    await docRef.update({ picks: current.concat(toAdd) });
  }
  return { dateISO, added: toAdd.length };
}

async function main() {
  const svc = loadServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
  const db = admin.firestore();

  const r1 = await upsertDay(db, TODAY, todaysPicks);
  const r2 = await upsertDay(db, PREV_DATE, previousPicks);

  console.log("Backfill done:", r1, r2);
  process.exit(0);
}

main().catch(err => {
  console.error("Backfill error:", err);
  process.exit(1);
});
