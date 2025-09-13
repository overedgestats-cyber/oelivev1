// /api/stripe-webhook.js
// Awards 1 free month to the referrer AFTER the friend's first MONTHLY payment.
// We verify the event by fetching it from Stripe using STRIPE_SECRET (no raw signature needed).

const STRIPE_KEY = process.env.STRIPE_SECRET || "";
const UP_URL     = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "";
const UP_TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";

/* ---------- tiny helpers ---------- */
function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.append(k, v);
  });
  return u.toString();
}
function days(n) { return n * 24 * 60 * 60; }

async function stripeGet(path, params) {
  const url = `https://api.stripe.com/v1${path}${params ? `?${qs(params)}` : ""}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${STRIPE_KEY}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Stripe GET ${path} ${r.status}`);
  return await r.json();
}

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
  const r = await fetch(url, {
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

/* ---------- core award flow ---------- */
async function awardIfEligible({ friendEmail, subscriptionId }) {
  // 1) Was this email attached to a referral code?
  const pend = await kvGet(`ref:pending:${friendEmail}`);
  const code = pend && typeof pend.result === "string" ? pend.result : null;
  if (!code) return;

  // 2) Resolve code -> referrer email
  const owner = await kvGet(`ref:code:${code}`);
  const refEmail = owner && typeof owner.result === "string" ? owner.result.toLowerCase() : null;
  if (!refEmail) return;
  if (refEmail === friendEmail) return; // ignore self-referrals

  // 3) Ensure we haven't already rewarded this pair
  const lockKey = `ref:rewarded:${refEmail}:${friendEmail}`;
  const already = await kvGet(lockKey);
  if (already && already.result) return;

  // 4) Ensure the friend’s subscription is MONTHLY
  let isMonthly = true;
  try {
    const sub = await stripeGet(`/subscriptions/${subscriptionId}`);
    const price = sub?.items?.data?.[0]?.price;
    const interval = price?.recurring?.interval || null;
    isMonthly = interval === "month";
  } catch {}
  if (!isMonthly) return;

  // 5) Referrer must have an ACTIVE sub created >= 30 days ago (any plan)
  let refOk = false;
  let refSubEndSec = 0;
  try {
    const custs = await stripeGet("/customers", { email: refEmail, limit: 3 });
    for (const c of (custs?.data || [])) {
      const subs = await stripeGet("/subscriptions", { customer: c.id, status: "active", limit: 10 });
      for (const s of (subs?.data || [])) {
        if ((s.created || 0) <= Math.floor(Date.now()/1000) - days(30)) refOk = true;
        refSubEndSec = Math.max(refSubEndSec, s.current_period_end || 0);
      }
    }
  } catch {}
  if (!refOk) return;

  // 6) Extend referrer's pro override by +30 days, starting after their current paid period (or current override)
  let overrideSec = 0;
  try {
    const v2 = await kvGet(`pro:override:${refEmail}`);
    overrideSec = v2 && typeof v2.result === "string" ? Number(v2.result) : 0;
  } catch {}
  const nowSec  = Math.floor(Date.now()/1000);
  const baseSec = Math.max(overrideSec || 0, refSubEndSec || 0, nowSec);
  const untilSec = baseSec + days(30);

  await kvSet(`pro:override:${refEmail}`, String(untilSec)); // no TTL, absolute timestamp
  await kvSet(lockKey, "1");                                 // mark as rewarded (no TTL)
  await kvDel(`ref:pending:${friendEmail}`);                 // clean up
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  if (!STRIPE_KEY) return res.status(500).json({ error: "STRIPE_SECRET not configured" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Try to read JSON body (Vercel usually provides req.body). Fallback to manual parse.
  let body = req.body;
  if (!body) {
    try {
      body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => { data += chunk; });
        req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
        req.on("error", reject);
      });
    } catch {
      body = {};
    }
  }

  const id = body?.id;
  if (!id) return res.status(400).json({ error: "Missing event id" });

  // Securely fetch the real event from Stripe using the id
  let event;
  try { event = await stripeGet(`/events/${id}`); }
  catch { return res.status(400).json({ error: "Invalid event" }); }

  try {
    const type = event.type;

    if (type === "invoice.payment_succeeded") {
      const inv = event.data?.object || {};
      const customerId = inv.customer;
      const friendSub  = inv.subscription;
      let friendEmail = null;
      if (customerId) {
        const cust = await stripeGet(`/customers/${customerId}`);
        friendEmail = cust?.email?.toLowerCase() || null;
      }
      if (friendEmail && friendSub) {
        await awardIfEligible({ friendEmail, subscriptionId: friendSub });
      }
    }

    if (type === "checkout.session.completed") {
      const s = event.data?.object || {};
      const friendEmail = (s.customer_details?.email || s.customer_email || "").toLowerCase();
      const subId = s.subscription || null;
      if (friendEmail && subId) {
        await awardIfEligible({ friendEmail, subscriptionId: subId });
      }
    }

    if (type === "customer.subscription.created") {
      const sub = event.data?.object || {};
      const customerId = sub.customer;
      let friendEmail = null;
      if (customerId) {
        const cust = await stripeGet(`/customers/${customerId}`);
        friendEmail = cust?.email?.toLowerCase() || null;
      }
      if (friendEmail && sub.id) {
        await awardIfEligible({ friendEmail, subscriptionId: sub.id });
      }
    }
  } catch (e) {
    console.error("stripe webhook error:", e);
    // always 200 to avoid Stripe retries storm; we keep log for debugging
    return res.status(200).json({ received: true, note: "error handled" });
  }

  return res.status(200).json({ received: true });
}
