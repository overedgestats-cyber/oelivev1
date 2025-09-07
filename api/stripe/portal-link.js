// /api/stripe/portal-link.js
module.exports.config = { runtime: "nodejs20.x" };

const Stripe = require("stripe");
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  const svc = JSON.parse(raw);
  if (svc.private_key && svc.private_key.includes("\\n")) {
    svc.private_key = svc.private_key.replace(/\\n/g, "\n");
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  return admin;
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const adminSDK = initAdmin();
    const authz = req.headers.authorization || "";
    const idToken = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: "not_authenticated" });
    const decoded = await adminSDK.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email;

    const db = adminSDK.firestore();
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    let customerId = (await db.collection("customers").doc(uid).get()).data()?.stripeCustomerId;

    if (!customerId && email) {
      let customers = [];
      try { customers = (await stripe.customers.search({ query: `email:"${email}"`, limit: 1 })).data; }
      catch { customers = (await stripe.customers.list({ email, limit: 1 })).data; }
      customerId = customers[0]?.id || (await stripe.customers.create({ email })).id;
      await db.collection("customers").doc(uid).set({ stripeCustomerId: customerId }, { merge: true });
      await db.collection("stripe_customers").doc(customerId).set({ uid }, { merge: true });
    }

    const returnUrl = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${returnUrl}/account.html`
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("portal-link error:", e);
    res.status(500).json({ error: "portal_error", message: e.message });
  }
};
