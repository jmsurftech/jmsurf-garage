// ---------------------------------------------------------------------------
// Payment gateways beyond M-Pesa/PayHero/Paystack, used both by shops (to be
// paid for sales) and by the platform (to be paid for packages).
//
// Every provider has:
//   start(cfg, p)  -> { providerRef, url? }       sends a prompt or opens a checkout
//   check(cfg, p)  -> { status, paidAmount?, paidCurrency?, receipt?, message? }
//   verify(cfg)    -> true or throws               checks the keys work
// p = { ref, amount, currency, phone, email, name, description, returnUrl, callbackUrl, providerRef }
//
// A payment is only treated as paid when the provider itself says so when we
// ask it (callbacks only trigger that check), and the amount and currency match.
// ---------------------------------------------------------------------------

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const T = (ms) => AbortSignal.timeout(ms);

async function json(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}
function fail(msg) { throw new Error(msg); }

/** Digits only, in international form (no +). Local numbers use the country's code. */
export function msisdn(raw, dialCode = "254") {
  let d = str(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = dialCode + d.slice(1);
  return /^\d{9,15}$/.test(d) ? d : "";
}

const tokenCache = new Map();
async function cachedToken(key, fetcher) {
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.token;
  const { token, ttl } = await fetcher();
  tokenCache.set(key, { token, expires: Date.now() + Math.max(60, (ttl || 3000) - 120) * 1000 });
  return token;
}

// Currencies Stripe charges in whole units (no cents).
const STRIPE_ZERO = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

// ------------------------------------------------------------- Flutterwave
const flutterwave = {
  label: "Flutterwave",
  kind: "redirect",
  countries: "Nigeria, Ghana, Kenya, Uganda, Tanzania, Rwanda, Zambia, South Africa, Côte d'Ivoire, Cameroon and more: cards, mobile money, bank",
  fields: [{ key: "secret_key", label: "Secret key", secret: true, placeholder: "FLWSECK-…" }],
  async start(cfg, p) {
    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST", signal: T(20000),
      headers: { Authorization: `Bearer ${cfg.secret_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: p.ref, amount: p.amount, currency: p.currency, redirect_url: p.returnUrl,
        customer: { email: p.email, phonenumber: p.phone || undefined, name: p.name || "Customer" },
        customizations: { title: p.title || "Payment", description: p.description },
      }),
    });
    const data = await json(res);
    const url = str(data?.data?.link);
    if (!res.ok || !url) fail(str(data?.message) || `Flutterwave replied ${res.status}`);
    return { providerRef: p.ref, url };
  },
  async check(cfg, p) {
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(p.ref)}`, {
      headers: { Authorization: `Bearer ${cfg.secret_key}` }, signal: T(15000),
    });
    const data = await json(res);
    const d = data?.data || {};
    if (res.status === 404 || /no transaction/i.test(str(data?.message))) return { status: "pending" };
    if (str(d.status) === "successful") return { status: "completed", paidAmount: Number(d.amount), paidCurrency: str(d.currency), receipt: str(d.flw_ref || d.id) };
    if (str(d.status) === "failed") return { status: "failed", message: str(d.processor_response) || "Payment failed" };
    return { status: "pending" };
  },
  async verify(cfg) {
    const res = await fetch("https://api.flutterwave.com/v3/balances", { headers: { Authorization: `Bearer ${cfg.secret_key}` }, signal: T(15000) });
    if (res.status === 401) fail("Flutterwave did not accept the secret key");
    return true;
  },
};

// ------------------------------------------------------------------ Stripe
async function stripe(cfg, path, { method = "GET", form } = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method, signal: T(20000),
    headers: { Authorization: `Bearer ${cfg.secret_key}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await json(res);
  if (!res.ok) fail(str(data?.error?.message) || `Stripe replied ${res.status}`);
  return data;
}
const stripeProvider = {
  label: "Stripe",
  kind: "redirect",
  countries: "Cards worldwide (Visa, Mastercard, Apple Pay, Google Pay). Payouts in 40+ countries incl. South Africa, Nigeria, Ghana, Kenya",
  fields: [{ key: "secret_key", label: "Secret key", secret: true, placeholder: "sk_live_…" }],
  async start(cfg, p) {
    const cur = p.currency.toUpperCase();
    const unit = STRIPE_ZERO.has(cur) ? Math.round(p.amount) : Math.round(p.amount * 100);
    const s = await stripe(cfg, "/checkout/sessions", {
      method: "POST",
      form: {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": cur.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(unit),
        "line_items[0][price_data][product_data][name]": p.description || "Payment",
        success_url: p.returnUrl, cancel_url: p.returnUrl,
        client_reference_id: p.ref, "metadata[ref]": p.ref,
        ...(p.email ? { customer_email: p.email } : {}),
      },
    });
    if (!s?.url) fail("Stripe did not return a checkout page");
    return { providerRef: s.id, url: s.url };
  },
  async check(cfg, p) {
    const s = await stripe(cfg, `/checkout/sessions/${encodeURIComponent(p.providerRef)}`);
    const cur = str(s.currency).toUpperCase();
    const paid = STRIPE_ZERO.has(cur) ? Number(s.amount_total) : Number(s.amount_total) / 100;
    if (s.payment_status === "paid") return { status: "completed", paidAmount: paid, paidCurrency: cur, receipt: str(s.payment_intent || s.id) };
    if (s.status === "expired") return { status: "cancelled", message: "The checkout expired" };
    return { status: "pending" };
  },
  async verify(cfg) { await stripe(cfg, "/balance"); return true; },
};

// ------------------------------------------------------------------ PayPal
function paypalBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com"; }
async function paypalToken(cfg) {
  return cachedToken(`paypal|${paypalBase(cfg)}|${cfg.client_id}`, async () => {
    const res = await fetch(`${paypalBase(cfg)}/v1/oauth2/token`, {
      method: "POST", signal: T(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = await json(res);
    if (!data?.access_token) fail("PayPal did not accept the client ID and secret");
    return { token: data.access_token, ttl: Number(data.expires_in) };
  });
}
const paypal = {
  label: "PayPal",
  kind: "redirect",
  countries: "PayPal balance and cards worldwide. Charges in USD, EUR, GBP and other PayPal currencies (set a rate if your shop uses another currency)",
  fields: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client secret", secret: true },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  needsRate: true,
  async start(cfg, p) {
    const token = await paypalToken(cfg);
    const res = await fetch(`${paypalBase(cfg)}/v2/checkout/orders`, {
      method: "POST", signal: T(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": p.ref },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ reference_id: p.ref, custom_id: p.ref, description: p.description, amount: { currency_code: p.currency, value: p.amount.toFixed(2) } }],
        application_context: { return_url: p.returnUrl, cancel_url: p.returnUrl, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" },
      }),
    });
    const data = await json(res);
    const url = str((data?.links || []).find((l) => l.rel === "approve" || l.rel === "payer-action")?.href);
    if (!res.ok || !url) fail(str(data?.details?.[0]?.description || data?.message) || `PayPal replied ${res.status}`);
    return { providerRef: data.id, url };
  },
  async check(cfg, p) {
    const token = await paypalToken(cfg);
    const get = await fetch(`${paypalBase(cfg)}/v2/checkout/orders/${encodeURIComponent(p.providerRef)}`, { headers: { Authorization: `Bearer ${token}` }, signal: T(15000) });
    let order = await json(get);
    // The buyer approved: take the money now.
    if (order?.status === "APPROVED") {
      const cap = await fetch(`${paypalBase(cfg)}/v2/checkout/orders/${encodeURIComponent(p.providerRef)}/capture`, {
        method: "POST", signal: T(20000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `${p.ref}-capture` },
      });
      order = await json(cap);
    }
    if (order?.status === "COMPLETED") {
      const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
      const amt = capture?.amount || order?.purchase_units?.[0]?.amount || {};
      return { status: "completed", paidAmount: Number(amt.value), paidCurrency: str(amt.currency_code), receipt: str(capture?.id || order.id) };
    }
    if (order?.status === "VOIDED") return { status: "cancelled", message: "The PayPal order was cancelled" };
    return { status: "pending" };
  },
  async verify(cfg) { await paypalToken(cfg); return true; },
};

// --------------------------------------------------------------- Kopo Kopo
function kopoBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://sandbox.kopokopo.com" : "https://api.kopokopo.com"; }
async function kopoToken(cfg) {
  return cachedToken(`kopo|${kopoBase(cfg)}|${cfg.client_id}`, async () => {
    const res = await fetch(`${kopoBase(cfg)}/oauth/token`, {
      method: "POST", signal: T(15000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, grant_type: "client_credentials" }),
    });
    const data = await json(res);
    if (!data?.access_token) fail("Kopo Kopo did not accept the client ID and secret");
    return { token: data.access_token, ttl: Number(data.expires_in) };
  });
}
const kopokopo = {
  label: "Kopo Kopo",
  kind: "push",
  countries: "Kenya: M-Pesa prompt, paid to your Kopo Kopo till",
  fields: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client secret", secret: true },
    { key: "till_number", label: "Online payments till", placeholder: "K123456" },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  currencies: ["KES"],
  async start(cfg, p) {
    const token = await kopoToken(cfg);
    const phone = msisdn(p.phone, "254");
    if (!/^254[17]\d{8}$/.test(phone)) fail("Enter a Kenyan M-Pesa number");
    const res = await fetch(`${kopoBase(cfg)}/api/v2/incoming_payments`, {
      method: "POST", signal: T(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        payment_channel: "M-PESA STK Push", till_number: str(cfg.till_number),
        subscriber: { first_name: p.name || "Customer", last_name: "-", phone_number: `+${phone}`, email: p.email || undefined },
        amount: { currency: "KES", value: Math.round(p.amount) },
        metadata: { reference: p.ref, notes: p.description },
        _links: { callback_url: p.callbackUrl },
      }),
    });
    const location = str(res.headers.get("location"));
    if (res.status !== 201 || !location) { const d = await json(res); fail(str(d?.error_message || d?.message) || `Kopo Kopo replied ${res.status}`); }
    return { providerRef: location.split("/").pop() };
  },
  async check(cfg, p) {
    const token = await kopoToken(cfg);
    const res = await fetch(`${kopoBase(cfg)}/api/v2/incoming_payments/${encodeURIComponent(p.providerRef)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: T(15000),
    });
    const data = await json(res);
    const a = data?.data?.attributes || {};
    const s = str(a.status).toLowerCase();
    if (s === "success") {
      const r = a.event?.resource || {};
      return { status: "completed", paidAmount: Number(r.amount ?? p.amount), paidCurrency: str(r.currency || "KES"), receipt: str(r.reference || r.id) };
    }
    if (s === "failed") return { status: "failed", message: str(a.event?.errors) || "The M-Pesa payment failed" };
    return { status: "pending" };
  },
  async verify(cfg) { await kopoToken(cfg); return true; },
};

// ---------------------------------------------------------------- IntaSend
function intaBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://sandbox.intasend.com" : "https://payment.intasend.com"; }
const intasend = {
  label: "IntaSend",
  kind: "push",
  countries: "Kenya: M-Pesa prompt, paid to your IntaSend wallet",
  fields: [
    { key: "public_key", label: "Publishable key", placeholder: "ISPubKey_live_…" },
    { key: "secret_key", label: "Secret key", secret: true, placeholder: "ISSecretKey_live_…" },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  currencies: ["KES"],
  async start(cfg, p) {
    const phone = msisdn(p.phone, "254");
    if (!/^254[17]\d{8}$/.test(phone)) fail("Enter a Kenyan M-Pesa number");
    const res = await fetch(`${intaBase(cfg)}/api/v1/payment/mpesa-stk-push/`, {
      method: "POST", signal: T(25000),
      headers: { Authorization: `Bearer ${cfg.secret_key}`, INTASEND_PUBLIC_API_KEY: str(cfg.public_key), "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: str(cfg.public_key), amount: Math.round(p.amount), phone_number: phone, api_ref: p.ref, narrative: p.description, currency: "KES", method: "M-PESA", email: p.email || undefined }),
    });
    const data = await json(res);
    const invoice = str(data?.invoice?.invoice_id);
    if (!res.ok || !invoice) fail(str(data?.errors?.[0]?.detail || data?.detail || data?.message) || `IntaSend replied ${res.status}`);
    return { providerRef: invoice };
  },
  async check(cfg, p) {
    const res = await fetch(`${intaBase(cfg)}/api/v1/payment/status/`, {
      method: "POST", signal: T(15000),
      headers: { INTASEND_PUBLIC_API_KEY: str(cfg.public_key), "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: str(cfg.public_key), invoice_id: p.providerRef }),
    });
    const data = await json(res);
    const inv = data?.invoice || {};
    const s = str(inv.state).toUpperCase();
    if (s === "COMPLETE") return { status: "completed", paidAmount: Number(inv.value), paidCurrency: str(inv.currency || "KES"), receipt: str(inv.mpesa_reference || inv.invoice_id) };
    if (s === "FAILED") return { status: "failed", message: str(inv.failed_reason) || "The M-Pesa payment failed" };
    return { status: "pending" };
  },
  async verify(cfg) {
    if (!str(cfg.public_key) || !str(cfg.secret_key)) fail("Add both IntaSend keys");
    return true;
  },
};

// ----------------------------------------------------------------- Pesapal
function pesapalBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://cybqa.pesapal.com/pesapalv3" : "https://pay.pesapal.com/v3"; }
async function pesapalToken(cfg) {
  return cachedToken(`pesapal|${pesapalBase(cfg)}|${cfg.consumer_key}`, async () => {
    const res = await fetch(`${pesapalBase(cfg)}/api/Auth/RequestToken`, {
      method: "POST", signal: T(15000), headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret }),
    });
    const data = await json(res);
    if (!data?.token) fail(str(data?.error?.message) || "Pesapal did not accept the consumer key and secret");
    return { token: data.token, ttl: 280 };
  });
}
const ipnIds = new Map();
async function pesapalIpn(cfg, token, url) {
  const key = `${pesapalBase(cfg)}|${cfg.consumer_key}|${url}`;
  if (ipnIds.has(key)) return ipnIds.get(key);
  const res = await fetch(`${pesapalBase(cfg)}/api/URLSetup/RegisterIPN`, {
    method: "POST", signal: T(15000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, ipn_notification_type: "GET" }),
  });
  const data = await json(res);
  if (!data?.ipn_id) fail("Pesapal did not register the notification address");
  ipnIds.set(key, data.ipn_id);
  return data.ipn_id;
}
const pesapal = {
  label: "Pesapal",
  kind: "redirect",
  countries: "Kenya, Uganda, Tanzania, Rwanda, Malawi, Zambia, Zimbabwe: M-Pesa, Airtel Money, MTN, cards",
  fields: [
    { key: "consumer_key", label: "Consumer key", secret: true },
    { key: "consumer_secret", label: "Consumer secret", secret: true },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  async start(cfg, p) {
    const token = await pesapalToken(cfg);
    const ipn = await pesapalIpn(cfg, token, p.ipnUrl);
    const res = await fetch(`${pesapalBase(cfg)}/api/Transactions/SubmitOrderRequest`, {
      method: "POST", signal: T(20000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        id: p.ref, currency: p.currency, amount: p.amount, description: str(p.description).slice(0, 100),
        callback_url: p.returnUrl, notification_id: ipn,
        billing_address: { email_address: p.email || undefined, phone_number: p.phone || undefined, first_name: p.name || "Customer" },
      }),
    });
    const data = await json(res);
    if (!data?.redirect_url || !data?.order_tracking_id) fail(str(data?.error?.message) || `Pesapal replied ${res.status}`);
    return { providerRef: data.order_tracking_id, url: data.redirect_url };
  },
  async check(cfg, p) {
    const token = await pesapalToken(cfg);
    const res = await fetch(`${pesapalBase(cfg)}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(p.providerRef)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: T(15000),
    });
    const d = await json(res);
    const code = Number(d?.status_code);
    if (code === 1) return { status: "completed", paidAmount: Number(d.amount), paidCurrency: str(d.currency), receipt: str(d.confirmation_code) };
    if (code === 2) return { status: "failed", message: str(d.description || d.payment_status_description) || "Payment failed" };
    if (code === 3) return { status: "failed", message: "The payment was reversed" };
    return { status: "pending" };
  },
  async verify(cfg) { await pesapalToken(cfg); return true; },
};

// ---------------------------------------------------------------- MTN MoMo
function momoBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://sandbox.momodeveloper.mtn.com" : "https://proxy.momoapi.mtn.com"; }
async function momoToken(cfg) {
  return cachedToken(`momo|${momoBase(cfg)}|${cfg.api_user}`, async () => {
    const res = await fetch(`${momoBase(cfg)}/collection/token/`, {
      method: "POST", signal: T(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.api_user}:${cfg.api_key}`).toString("base64")}`, "Ocp-Apim-Subscription-Key": str(cfg.subscription_key) },
    });
    const data = await json(res);
    if (!data?.access_token) fail("MTN MoMo did not accept the API user, API key or subscription key");
    return { token: data.access_token, ttl: Number(data.expires_in) };
  });
}
const mtn_momo = {
  label: "MTN Mobile Money",
  kind: "push",
  countries: "Uganda, Ghana, Rwanda, Zambia, Cameroon, Côte d'Ivoire, Benin, Congo, Guinea, Liberia and more",
  fields: [
    { key: "subscription_key", label: "Collections subscription key", secret: true },
    { key: "api_user", label: "API user (UUID)" },
    { key: "api_key", label: "API key", secret: true },
    { key: "target_environment", label: "Target environment", placeholder: "mtnuganda, mtnghana, mtnrwanda, mtnzambia… (sandbox for testing)" },
    { key: "dial_code", label: "Country dialling code", placeholder: "256" },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  async start(cfg, p) {
    const token = await momoToken(cfg);
    const phone = msisdn(p.phone, str(cfg.dial_code) || "256");
    if (!phone) fail("Enter the customer's MTN number");
    const refId = crypto.randomUUID();
    const res = await fetch(`${momoBase(cfg)}/collection/v1_0/requesttopay`, {
      method: "POST", signal: T(20000),
      headers: {
        Authorization: `Bearer ${token}`, "X-Reference-Id": refId, "X-Target-Environment": str(cfg.target_environment) || "sandbox",
        "Ocp-Apim-Subscription-Key": str(cfg.subscription_key), "Content-Type": "application/json",
        ...(p.callbackUrl && str(cfg.environment) !== "sandbox" ? { "X-Callback-Url": p.callbackUrl } : {}),
      },
      body: JSON.stringify({
        amount: String(Math.round(p.amount)), currency: p.currency, externalId: p.ref,
        payer: { partyIdType: "MSISDN", partyId: phone }, payerMessage: str(p.description).slice(0, 80), payeeNote: p.ref,
      }),
    });
    if (res.status !== 202) { const d = await json(res); fail(str(d?.message || d?.code) || `MTN MoMo replied ${res.status}`); }
    return { providerRef: refId };
  },
  async check(cfg, p) {
    const token = await momoToken(cfg);
    const res = await fetch(`${momoBase(cfg)}/collection/v1_0/requesttopay/${encodeURIComponent(p.providerRef)}`, {
      headers: { Authorization: `Bearer ${token}`, "X-Target-Environment": str(cfg.target_environment) || "sandbox", "Ocp-Apim-Subscription-Key": str(cfg.subscription_key) },
      signal: T(15000),
    });
    const d = await json(res);
    const s = str(d?.status).toUpperCase();
    if (s === "SUCCESSFUL") return { status: "completed", paidAmount: Number(d.amount), paidCurrency: str(d.currency), receipt: str(d.financialTransactionId) };
    if (s === "FAILED" || s === "REJECTED" || s === "TIMEOUT") return { status: "failed", message: str(d?.reason?.message || d?.reason || s) };
    return { status: "pending" };
  },
  async verify(cfg) { await momoToken(cfg); return true; },
};

// ------------------------------------------------------------- Airtel Money
function airtelBase(cfg) { return str(cfg.environment) === "sandbox" ? "https://openapiuat.airtel.africa" : "https://openapi.airtel.africa"; }
async function airtelToken(cfg) {
  return cachedToken(`airtel|${airtelBase(cfg)}|${cfg.client_id}`, async () => {
    const res = await fetch(`${airtelBase(cfg)}/auth/oauth2/token`, {
      method: "POST", signal: T(15000), headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, grant_type: "client_credentials" }),
    });
    const data = await json(res);
    if (!data?.access_token) fail("Airtel Money did not accept the client ID and secret");
    return { token: data.access_token, ttl: Number(data.expires_in) };
  });
}
const AIRTEL_DIAL = { UG: "256", TZ: "255", KE: "254", ZM: "260", MW: "265", RW: "250", CD: "243", CG: "242", GA: "241", NE: "227", TD: "235", MG: "261", SC: "248", NG: "234" };
const airtel = {
  label: "Airtel Money",
  kind: "push",
  countries: "Uganda, Tanzania, Kenya, Zambia, Malawi, Rwanda, Congo DRC, Congo, Gabon, Niger, Chad, Madagascar, Seychelles, Nigeria",
  fields: [
    { key: "client_id", label: "Client ID" },
    { key: "client_secret", label: "Client secret", secret: true },
    { key: "country", label: "Country", options: Object.keys(AIRTEL_DIAL).map((c) => [c, c]) },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  async start(cfg, p) {
    const token = await airtelToken(cfg);
    const country = str(cfg.country) || "UG";
    const dial = AIRTEL_DIAL[country] || "256";
    const full = msisdn(p.phone, dial);
    if (!full.startsWith(dial)) fail(`Enter an Airtel number from ${country}`);
    const res = await fetch(`${airtelBase(cfg)}/merchant/v1/payments/`, {
      method: "POST", signal: T(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "*/*", "X-Country": country, "X-Currency": p.currency },
      body: JSON.stringify({
        reference: str(p.description).slice(0, 60) || p.ref,
        subscriber: { country, currency: p.currency, msisdn: full.slice(dial.length) },
        transaction: { amount: Math.round(p.amount), country, currency: p.currency, id: p.ref },
      }),
    });
    const d = await json(res);
    if (!res.ok || d?.status?.success === false) fail(str(d?.status?.message) || `Airtel Money replied ${res.status}`);
    return { providerRef: p.ref };
  },
  async check(cfg, p) {
    const token = await airtelToken(cfg);
    const country = str(cfg.country) || "UG";
    const res = await fetch(`${airtelBase(cfg)}/standard/v1/payments/${encodeURIComponent(p.providerRef)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "*/*", "X-Country": country, "X-Currency": p.currency }, signal: T(15000),
    });
    const d = await json(res);
    const s = str(d?.data?.transaction?.status).toUpperCase();
    if (s === "TS") return { status: "completed", paidAmount: p.amount, paidCurrency: p.currency, receipt: str(d.data.transaction.airtel_money_id || d.data.transaction.id) };
    if (s === "TF" || s === "TE") return { status: "failed", message: str(d?.data?.transaction?.message) || "The Airtel Money payment failed" };
    return { status: "pending" };
  },
  async verify(cfg) { await airtelToken(cfg); return true; },
};

// ---------------------------------------------------- WaafiPay (Somalia)
// API_PURCHASE waits until the customer approves on their phone, so the
// hub runs it in the background and records the result.
const waafipay = {
  label: "WaafiPay (EVC Plus, Zaad, Sahal)",
  kind: "push",
  background: true,
  countries: "Somalia and Somaliland: EVC Plus, Zaad, Sahal, WAAFI",
  fields: [
    { key: "merchant_uid", label: "Merchant UID" },
    { key: "api_user_id", label: "API user ID" },
    { key: "api_key", label: "API key", secret: true },
    { key: "environment", label: "Mode", options: [["live", "Live"], ["sandbox", "Sandbox (testing)"]] },
  ],
  currencies: ["USD", "SOS"],
  async start(cfg, p) {
    const phone = msisdn(p.phone, "252");
    if (!phone) fail("Enter the customer's wallet number");
    const base = str(cfg.environment) === "sandbox" ? "https://sandbox.waafipay.net/asm" : "https://api.waafipay.net/asm";
    const res = await fetch(base, {
      method: "POST", signal: T(150000), headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "1.0", requestId: p.ref, timestamp: new Date().toISOString(), channelName: "WEB", serviceName: "API_PURCHASE",
        serviceParams: {
          merchantUid: str(cfg.merchant_uid), apiUserId: str(cfg.api_user_id), apiKey: str(cfg.api_key), paymentMethod: "MWALLET_ACCOUNT",
          payerInfo: { accountNo: phone },
          transactionInfo: { referenceId: p.ref, invoiceId: p.ref.slice(0, 30), amount: Number(p.amount).toFixed(2), currency: p.currency, description: str(p.description).slice(0, 60) },
        },
      }),
    });
    const d = await json(res);
    const ok = str(d?.responseCode) === "2001" && /APPROVED|RCS_SUCCESS/i.test(`${str(d?.params?.state)} ${str(d?.responseMsg)}`);
    if (ok) return { providerRef: str(d?.params?.transactionId || p.ref), final: { status: "completed", paidAmount: Number(d?.params?.txAmount || p.amount), paidCurrency: p.currency, receipt: str(d?.params?.transactionId) } };
    return { providerRef: p.ref, final: { status: "failed", message: str(d?.responseMsg) || "The wallet payment was not approved" } };
  },
  async check() { return { status: "pending" }; },
  async verify(cfg) {
    if (!str(cfg.merchant_uid) || !str(cfg.api_user_id) || !str(cfg.api_key)) fail("Add the merchant UID, API user ID and API key");
    return true;
  },
};

// ---------------------------------------------------------- Chapa (Ethiopia)
const chapa = {
  label: "Chapa",
  kind: "redirect",
  countries: "Ethiopia: telebirr, CBE Birr, M-Pesa Ethiopia, cards",
  fields: [{ key: "secret_key", label: "Secret key", secret: true, placeholder: "CHASECK-…" }],
  async start(cfg, p) {
    const res = await fetch("https://api.chapa.co/v1/transaction/initialize", {
      method: "POST", signal: T(20000), headers: { Authorization: `Bearer ${cfg.secret_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: String(p.amount), currency: p.currency, email: p.email, first_name: p.name || "Customer", tx_ref: p.ref, callback_url: p.callbackUrl, return_url: p.returnUrl, customization: { title: str(p.title).slice(0, 16) || "Payment" } }),
    });
    const d = await json(res);
    const url = str(d?.data?.checkout_url);
    if (!res.ok || !url) fail(str(typeof d?.message === "string" ? d.message : JSON.stringify(d?.message || "")) || `Chapa replied ${res.status}`);
    return { providerRef: p.ref, url };
  },
  async check(cfg, p) {
    const res = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(p.ref)}`, { headers: { Authorization: `Bearer ${cfg.secret_key}` }, signal: T(15000) });
    const d = await json(res);
    const s = str(d?.data?.status).toLowerCase();
    if (s === "success") return { status: "completed", paidAmount: Number(d.data.amount), paidCurrency: str(d.data.currency), receipt: str(d.data.reference) };
    if (s === "failed") return { status: "failed", message: "Payment failed" };
    return { status: "pending" };
  },
  async verify(cfg) {
    const res = await fetch("https://api.chapa.co/v1/banks", { headers: { Authorization: `Bearer ${cfg.secret_key}` }, signal: T(15000) });
    if (res.status === 401) fail("Chapa did not accept the secret key");
    return true;
  },
};

export const PROVIDERS = { flutterwave, stripe: stripeProvider, paypal, kopokopo, intasend, pesapal, mtn_momo, airtel, waafipay, chapa };

/** Public description of each provider for the settings screens (no functions, no secrets). */
export function providerCatalog() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, label: p.label, kind: p.kind, countries: p.countries, fields: p.fields, currencies: p.currencies || null, needsRate: !!p.needsRate,
  }));
}
