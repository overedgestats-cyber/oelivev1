// /api/subscription/status.js
module.exports.config = { runtime: "nodejs20.x" };

const admin = require("firebase-admin");

function getAdmin() {
  try {
    if (admin.apps.length) return admin;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    const svc = JSON.parse(raw);
    if (svc.private_key && svc.private_key.includes("\\n")) {
      svc.private_key = svc.private_key.replace(/\\n/g, "\n");
    }
    admin.initializeApp({ credential: admin.credential.cert(svc) });
    return admin;
  } catch (e) {
    console.error("firebase admin init error:", e);
    return null;
  }
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end();

  const adm = getAdmin();
  if (!adm) {
    return res.status(500).json({
      error: "firebase_admin_unconfigured",
      message: "Set FIREBASE_SERVICE_ACCOUNT_JSON in Vercel and redeploy."
    });
  }

  try {
    const authz = req.headers.authorization || "";
    const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "not_authenticated" });

    const decoded = await adm.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email || null;

    const snap = await adm.firestore().collection("customers").doc(uid).get();
    const d = snap.exists ? snap.data() : {};

    let active = !!d?.proActive;
    let proUntil = d?.proUntil || null;
    let source = "firestore";

    if (!active && decoded?.pro) {
      active = true;
      proUntil = decoded.proUntil || proUntil || null;
      source = "claims";
    }

    if (proUntil && typeof proUntil?.toDate === "function") proUntil = proUntil.toDate();
    if (proUntil instanceof Date) proUntil = proUntil.toISOString();

    return res.json({ active, proUntil, uid, email, source });
  } catch (e) {
    console.error("status error:", e);
    return res.status(500).json({ error: "status_error", message: e.message });
  }
};
