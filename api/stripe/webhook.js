// /api/stripe/webhook.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const getRawBody = require('raw-body');

const admin = require('firebase-admin');
if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}
const db = admin.firestore();

function isActiveStatus(s) {
  return s === 'active' || s === 'trialing' || s === 'past_due'; // treat past_due as active for access
}

async function setUserPro(uid, active, periodEndSec = null, stripeCustomer = null) {
  const proUntil = periodEndSec ? new Date(periodEndSec * 1000) : null;

  await db.collection('customers').doc(uid).set({
    stripeCustomerId: stripeCustomer || admin.firestore.FieldValue.delete(),
    proActive: !!active,
    proUntil: proUntil || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Optional: set custom claims so client can read quickly (requires token refresh)
  await admin.auth().setCustomUserClaims(uid, {
    pro: !!active,
    proUntil: periodEndSec || null
  });
}

module.exports = async (req, res) => {
  // Stripe requires raw body to verify signature
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object; // CheckoutSession
        const uid = s.client_reference_id || (s.metadata && s.metadata.firebaseUID);
        if (!uid) break;

        if (s.mode === 'subscription' && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          const status = sub.status;
          const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id;
          const priceId = sub.items?.data?.[0]?.price?.id || null;

          // Write a subscription doc under this user
          const subRef = db.collection('customers').doc(uid).collection('subscriptions').doc(sub.id);
          await subRef.set({
            status,
            priceId,
            current_period_end: sub.current_period_end,
            cancel_at_period_end: sub.cancel_at_period_end || false,
            created: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          await setUserPro(uid, isActiveStatus(status), sub.current_period_end, customer);
        } else if (s.mode === 'payment') {
          // one-time "lifetime" style purchase (optional)
          const uid2 = s.client_reference_id || (s.metadata && s.metadata.firebaseUID);
          if (uid2) await setUserPro(uid2, true, null, s.customer);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;

        // Find the owning user by the sub doc id (we save sub.id as doc id on checkout)
        const qs = await db
          .collectionGroup('subscriptions')
          .where(admin.firestore.FieldPath.documentId(), '==', sub.id)
          .get();

        if (!qs.empty) {
          const doc = qs.docs[0];
          const uid = doc.ref.parent.parent.id;

          await doc.ref.set({
            status: sub.status,
            current_period_end: sub.current_period_end,
            cancel_at_period_end: sub.cancel_at_period_end || false,
            updated: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          await setUserPro(uid, isActiveStatus(sub.status), sub.current_period_end);
        }
        break;
      }

      default:
        // ignore the rest
        break;
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handling error:', e);
    res.status(500).send('webhook_handler_error');
  }
};

module.exports.config = { runtime: 'nodejs20.x' };
