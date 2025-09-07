// /api/subscription/status.js
module.exports.config = { runtime: "nodejs20.x" };

const admin = require("firebase-admin");

// --- Init Firebase Admin (handles \n in private_key) ---
(function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  const svc = JSON.parse(raw);
  if (svc.private_key && svc.private_key.includes("\\n")) {
    svc.private_key = svc.private_key.replace(/\\n/g, "\n");
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
})();

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end();

  try {
    // Require Firebase ID token (Bearer)
    const authz = req.headers.authorization || "";
    const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "not_authenticated" });

    // Verify token (force refresh so custom claims are fresh)
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email || null;

    // Source of truth: Firestore doc written by your Stripe webhook
    const doc = await admin.firestore().collection("customers").doc(uid).get();
    const d = doc.exists ? doc.data() : {};

    // Decide access: prefer Firestore; fallback to custom claims
    let active = !!d?.proActive;
    let proUntil = d?.proUntil || null;
    let source = "firestore";

    if (!active && decoded?.pro) {
      active = true;
      proUntil = decoded.proUntil || proUntil || null;
      source = "claims";
    }
    // Normalize date to ISO string (if Firestore Timestamp or Date)
    if (proUntil && typeof proUntil?.toDate === "function") {
      proUntil = proUntil.toDate();
    }
    if (proUntil instanceof Date) {
      proUntil = proUntil.toISOString();
    }

    return res.json({
      active,
      proUntil,         // ISO string or null
      uid,
      email,
      source            // "firestore" | "claims"
    });
  } catch (e) {
    console.error("status error:", e);
    return res.status(500).json({ error: "status_error", message: e.message });
  }
};
