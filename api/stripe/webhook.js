// /api/stripe/webhook.js
module.exports.config = { runtime: "nodejs20.x" };

const Stripe = require("stripe");
const getRawBody = require("raw-body");
const admin = require("firebase-admin");

// ----- Init Stripe -----
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ----- Init Firebase Admin (newline fix for private key) -----
function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  const svc = JSON.parse(raw);
  if (svc.private_key && svc.private_key.includes("\\n")) {
    svc.private_key = svc.private_key.replace(/\\n/g, "\n");
  }
  admin.initializeApp({ credential: admin.credential.cert(svc) });
}
initAdmin();
const db = admin.firestore();

// ----- Helpers -----
function isActiveStatus(s) {
  // treat past_due as active for access (optional)
  return s === "active" || s === "trialing" || s === "past_due";
}

async function setUserPro(uid, active, periodEndSec = null, stripeCustomer = null) {
  const proUntil = periodEndSec ? new Date(periodEndSec * 1000) : null;

  // customers/{uid}
  await db.collection("customers").doc(uid).set(
    {
      proActive: !!active,
      proUntil: proUntil || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(stripeCustomer ? { stripeCustomerId: stripeCustomer } : {}),
    },
    { merge: true }
  );

  // optional: quick checks via custom claims
  await admin.auth().setCustomUserClaims(uid, {
    pro: !!active,
    proUntil: periodEndSec || null,
  });

  // mapping: stripe_customers/{customerId} -> { uid }
  if (stripeCustomer) {
    await db.collection("stripe_customers").doc(stripeCustomer).set(
      {
        uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

async function writeSubscriptionDoc(uid, sub) {
  const ref = db
    .collection("customers")
    .doc(uid)
    .collection("subscriptions")
    .doc(sub.id);

  const priceId = sub.items?.data?.[0]?.price?.id || null;

  await ref.set(
    {
      status: sub.status,
      priceId,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function resolveUidFromSession(session) {
  // 1) explicit from API-created session
  let uid =
    session.client_reference_id ||
    (session.metadata && session.metadata.firebaseUID) ||
    null;

  // 2) mapping by Stripe customer id (if we have it)
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;
  if (!uid && customerId) {
    const mapDoc = await db.collection("stripe_customers").doc(customerId).get();
    if (mapDoc.exists && mapDoc.data()?.uid) uid = mapDoc.data().uid;
  }

  // 3) fallback by email (Payment Links path)
  if (!uid) {
    const email = session.customer_details?.email || session.customer_email || null;
    if (email) {
      try {
        const user = await admin.auth().getUserByEmail(email);
        uid = user.uid;
      } catch {
        // leave uid null
      }
    }
  }
  return uid;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  // Verify Stripe signature with RAW body
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const buf = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object; // CheckoutSession
        const customerId =
          typeof s.customer === "string" ? s.customer : s.customer?.id || null;

        const uid = await resolveUidFromSession(s);
        if (!uid) {
          // store a breadcrumb so you can reconcile later
          await db.collection("webhook_unmatched").add({
            type: "checkout.session.completed",
            sessionId: s.id,
            email: s.customer_details?.email || s.customer_email || null,
            customerId,
            created: admin.firestore.FieldValue.serverTimestamp(),
          });
          break;
        }

        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription);
          await writeSubscriptionDoc(uid, sub);
          await setUserPro(uid, isActiveStatus(sub.status), sub.current_period_end, customerId);
        } else if (s.mode === "payment") {
          // one-time (e.g., "lifetime")
          await setUserPro(uid, true, null, customerId);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object; // Subscription
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null;

        // Find uid: prefer mapping, else look up subscription doc
        let uid = null;
        if (customerId) {
          const mapDoc = await db.collection("stripe_customers").doc(customerId).get();
          if (mapDoc.exists && mapDoc.data()?.uid) uid = mapDoc.data().uid;
        }
        if (!uid) {
          const qs = await db
            .collectionGroup("subscriptions")
            .where(admin.firestore.FieldPath.documentId(), "==", sub.id)
            .get();
          if (!qs.empty) uid = qs.docs[0].ref.parent.parent.id;
        }

        if (uid) {
          await writeSubscriptionDoc(uid, sub);
          await setUserPro(uid, isActiveStatus(sub.status), sub.current_period_end, customerId);
        } else {
          await db.collection("webhook_unmatched").add({
            type: event.type,
            subId: sub.id,
            customerId,
            status: sub.status,
            created: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        break;
      }

      default:
        // ignore others; they still count as received
        break;
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Webhook handling error:", e);
    res.status(500).send("webhook_handler_error");
  }
};
