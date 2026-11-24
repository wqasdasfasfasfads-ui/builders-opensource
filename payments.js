// payments.js - coin packages + the PayPal REST API (Orders v2).
// Flow: create order -> buyer approves on paypal.com -> we CAPTURE the order
// on the server -> only then coins are added. The price always comes from
// PACKAGES below, never from the browser.

const PACKAGES = [
  { id: "c500", coins: 500, price: "0.50" },
  { id: "c1000", coins: 1000, price: "0.99" },
  { id: "c2000", coins: 2000, price: "2.00" },
  { id: "c3000", coins: 3000, price: "3.00" },
  { id: "c5000", coins: 5000, price: "5.00" },
  { id: "c10000", coins: 10000, price: "10.00" },
];
const CURRENCY = "USD";

// Pluse subscription (one 30-day pass per payment, extends if already Pluse).
// Also payable with coins: SUPER.coinPrice coins = SUPER.coinDays days.
const SUPER = { id: "super_month", price: "5.00", days: 30, coinPrice: 4000, coinDays: 7 };
const SUPER_PLAN = { id: SUPER.id, kind: "super", price: SUPER.price, days: SUPER.days, coins: 0, description: "Builders Pluse - 30 days" };

function getSuperPlan(id) {
  return id === SUPER_PLAN.id ? SUPER_PLAN : null;
}

function getPackage(id) {
  return PACKAGES.find((p) => p.id === id) || null;
}

function realValue(v) {
  return !!v && !/^PASTE_/i.test(v.trim());
}

function configured() {
  return realValue(process.env.PAYPAL_CLIENT_ID) && realValue(process.env.PAYPAL_SECRET);
}

function apiBase() {
  return "https://api-m.paypal.com"; // real PayPal (no sandbox)
}

async function accessToken() {
  const basic = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET).toString("base64");
  const r = await fetch(apiBase() + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error("PayPal login failed (" + r.status + "): check PAYPAL_CLIENT_ID / PAYPAL_SECRET / PAYPAL_MODE");
  }
  return j.access_token;
}

async function paypal(method, path, token, body) {
  const r = await fetch(apiBase() + path, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// Returns { orderId, approveUrl }
async function createOrder(pkg, userId, returnUrl, cancelUrl) {
  const token = await accessToken();
  const res = await paypal("POST", "/v2/checkout/orders", token, {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: pkg.id,
        custom_id: userId,
        description: pkg.description || pkg.coins + " Builders coins",
        amount: { currency_code: CURRENCY, value: pkg.price },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Builders",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  });
  if (!res.ok) throw new Error("PayPal could not create the order (" + res.status + "): " + JSON.stringify(res.json));
  const links = res.json.links || [];
  const link = links.find((l) => l.rel === "payer-action") || links.find((l) => l.rel === "approve");
  if (!link) throw new Error("PayPal did not return an approval link");
  return { orderId: res.json.id, approveUrl: link.href };
}

// Captures the order and checks that the money really arrived for the right
// amount. Returns true only for a completed payment of the exact price.
async function captureOrder(orderId, pkg) {
  const token = await accessToken();
  let res = await paypal("POST", "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", token, {});
  if (!res.ok) {
    // maybe it was already captured (e.g. page refreshed) - look at the order itself
    res = await paypal("GET", "/v2/checkout/orders/" + encodeURIComponent(orderId), token);
    if (!res.ok) throw new Error("PayPal capture failed (" + res.status + ")");
  }
  const order = res.json;
  if (order.status !== "COMPLETED") return false;
  const unit = (order.purchase_units || [])[0] || {};
  const cap = ((unit.payments || {}).captures || [])[0];
  if (!cap || cap.status !== "COMPLETED") return false;
  return cap.amount && cap.amount.currency_code === CURRENCY && cap.amount.value === pkg.price;
}

module.exports = { PACKAGES, CURRENCY, SUPER, SUPER_PLAN, getSuperPlan, getPackage, configured, createOrder, captureOrder };
