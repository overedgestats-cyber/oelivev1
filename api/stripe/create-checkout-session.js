// /api/stripe/create-checkout-session.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const admin = require('firebase-admin');
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}

const PRICE_MAP = {
  weekly:    process.env.STRIPE_PRICE_WEEKLY,
  monthly:   process.env.STRIPE_PRICE_MONTHLY,
  quarterly: process.env.STRIPE_PRICE_QUARTERLY,
  yearly:    process.env.STRIPE_PRICE_YEARLY,
};

module.exports = async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    // 1) Require Firebase login
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'not_authenticated' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || undefined;

    // 2) Resolve price
    const { plan, priceId } = req.body || {};
    const price = priceId || PRICE_MAP[plan];
    if (!price) return res.status(400).json({ error: 'missing_price' });

    // 3) Create checkout session
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const base = process.env.PUBLIC_BASE_URL || origin;
    const mode = plan === 'lifetime' ? 'payment' : 'subscription';

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: email,
      client_reference_id: uid,                 // link Stripe session -> Firebase user
      metadata: { firebaseUID: uid, email: email || '' },
      success_url: `${base}/pricing.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing.html?cancelled=1`
    });

    return res.status(200).json({ id: session.id });
  } catch (e) {
    console.error('create-checkout-session error:', e);
    const code = /auth|token/i.test(e.message) ? 401 : 500;
    return res.status(code).json({ error: 'stripe_or_auth_error', message: e.message });
  }
};

module.exports.config = { runtime: 'nodejs20.x' };
