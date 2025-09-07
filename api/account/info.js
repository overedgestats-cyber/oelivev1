// /api/account/info.js
module.exports.config = { runtime: "nodejs20.x" };

const admin = require("firebase-admin");
const Stripe = require("stripe");

function getAdmin() {
  try {
    if (admin.apps.length) return admin;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
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

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

function priceNameFromEnv(priceId) {
  const map = {
    [process.env.STRIPE_PRICE_WEEKLY || ""]: "Weekly",
    [process.env.STRIPE_PRICE_MONTHLY || ""]: "Monthly",
    [process.env.STRIPE_PRICE_QUARTERLY || ""]: "Quarterly",
    [process.env.STRIPE_PRICE_YEARLY || ""]: "Yearly",
  };
  return map[priceId] || null;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const adm = getAdmin();
  if (!adm) return res.status(500).json({ error: "firebase_admin_unconfigured" });

  try {
    const authz = req.headers.authorization || "";
    const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "not_authenticated" });

    const decoded = await adm.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;

    const userRec = await adm.auth().getUser(uid);
    const email = userRec.email || null;
    const lastLogin = userRec.metadata?.lastSignInTime || null;
    const createdAt = userRec.metadata?.creationTime || null;

    const db = adm.firestore();
    const custDoc = await db.collection("customers").doc(uid).get();
    const cust = custDoc.exists ? custDoc.data() : {};

    let sub = null;
    const subsSnap = await db.collection("customers").doc(uid)
      .collection("subscriptions").orderBy("current_period_end","desc").limit(1).get();
    if (!subsSnap.empty) sub = { id: subsSnap.docs[0].id, ...subsSnap.docs[0].data() };

    let planTier = "Free";
    let status = "none";
    let nextRenewal = null;
    let priceId = null;

    if (sub) {
      status = sub.status || "unknown";
      priceId = sub.priceId || null;
      if (sub.current_period_end) {
        const d = typeof sub.current_period_end === "number"
          ? new Date(sub.current_period_end * 1000)
          : sub.current_period_end?.toDate
          ? sub.current_period_end.toDate()
          : new Date(sub.current_period_end);
        nextRenewal = d.toISOString();
      }
      planTier = priceNameFromEnv(priceId) || planTier;

      if (!planTier && process.env.STRIPE_SECRET_KEY && priceId) {
        try {
          const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
          const price = await stripe.prices.retrieve(priceId);
          planTier =
            price.nickname ||
            (price.product && typeof price.product === "string"
              ? (await stripe.products.retrieve(price.product)).name
              : "Subscription");
        } catch { planTier = "Subscription"; }
      }

      if (cust?.proActive && ["canceled","incomplete","unpaid"].includes(status)) {
        status = "active";
      }
    } else if (cust?.proActive) {
      status = "active";
      planTier = "Pro";
      nextRenewal = cust?.proUntil?.toDate ? cust.proUntil.toDate().toISOString() : cust?.proUntil || null;
    }

    res.json({
      uid,
      email,
      createdAt,
      lastLogin,
      plan: { tier: planTier, status, priceId, stripeCustomerId: cust?.stripeCustomerId || null },
      nextRenewal,
      proActive: !!cust?.proActive,
    });
  } catch (e) {
    console.error("account/info error:", e);
    res.status(500).json({ error: "account_info_error", message: e.message });
  }
};
