// /api/stripe/create-checkout-session.js
module.exports.config = { runtime: "nodejs20.x" };

const Stripe = require("stripe");
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null; // we'll error gracefully below
  let svc;
  try {
    svc = JSON.parse(raw);
    if (svc.private_key && svc.private_key.includes("\\n")) {
      svc.private_key = svc.private_key.replace(/\\n/g, "\n");
    }
  } catch (e) {
    return null;
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  return admin;
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

const PRICE_MAP = {
  weekly:    process.env.STRIPE_PRICE_WEEKLY,
  monthly:   process.env.STRIPE_PRICE_MONTHLY,
  quarterly: process.env.STRIPE_PRICE_QUARTERLY,
  yearly:    process.env.STRIPE_PRICE_YEARLY,
};

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Ensure Stripe configured
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: "missing_stripe_secret" });
  const stripe = Stripe(secret);

  // Require Firebase login
  try {
    const adminSDK = initAdmin();
    if (!adminSDK) {
      return res.status(500).json({
        error: "firebase_admin_unconfigured",
        message: "Set FIREBASE_SERVICE_ACCOUNT_JSON in Vercel (paste full JSON).",
      });
    }
    const authz = req.headers.authorization || "";
    const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "not_authenticated" });

    const decoded = await adminSDK.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || undefined;

    // Resolve price
    const { plan, priceId } = req.body || {};
    const price = priceId || PRICE_MAP[plan];
    if (!price) return res.status(400).json({ error: "missing_price" });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const base = process.env.PUBLIC_BASE_URL || origin;
    const mode = plan === "lifetime" ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: email,
      client_reference_id: uid,
      metadata: { firebaseUID: uid, email: email || "" },
      success_url: `${base}/pricing.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing.html?cancelled=1`,
    });

    return res.status(200).json({ id: session.id });
  } catch (e) {
    console.error("create-checkout-session error:", e);
    const code = /auth|token/i.test(e.message) ? 401 : 500;
    return res.status(code).json({ error: "stripe_or_auth_error", message: e.message });
  }
};
