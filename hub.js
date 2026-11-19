// ---------------------------------------------------------------------------
// Payment hub for the extra gateways in providers.js.
//
// Shops: a sale is saved as pending with payment method "online", then
//   POST /api/pay/sale/start   { sale_id, provider, phone?, email? }
//   POST /api/pay/sale/status  { sale_id }
// Platform (package fees), using the gateways switched on in Admin:
//   POST /api/pay/subscription/options
//   POST /api/pay/subscription/start  { plan_id, cycle, provider, phone?, email? }
//   POST /api/pay/subscription/status { payment_id }
// Both:
//   POST /api/pay/catalog      what each gateway needs (public)
//   POST /api/pay/test         { provider, scope: "shop" | "platform" } checks saved keys
//   GET  /api/pay/return?p=…   page the customer lands on after a checkout
//   ANY  /api/pay/notify?p=…   provider callbacks (only trigger a re-check)
//
// A payment counts only when the provider confirms it when asked, for the
// expected amount and currency. A background check finishes payments even
// when nobody is watching the screen.
// ---------------------------------------------------------------------------
import { PROVIDERS, providerCatalog } from "./providers.js";
import { activateSubscription, priceFor, cycleMonths } from "./payments.js";
import { shopCyclePrice } from "./planPricing.js";
import { withPlatformRole } from "./platform.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://garage.jmsurf.co.ke").replace(/\/+$/, "");

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const isHubRoute = (pathname) => pathname.startsWith("/api/pay/");

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(10000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(`Database error (${res.status}): ${str(data?.message || data?.code)}`);
  return data;
}
const one = async (path) => (await db(path))?.[0] || null;

async function caller(req) {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) return { error: "Sign in first", status: 401 };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return { error: "Sign in first", status: 401 };
  const user = await r.json().catch(() => null);
  if (!UUID.test(str(user?.id))) return { error: "Sign in first", status: 401 };
  const [profile, roles] = await Promise.all([
    one(`profiles?user_id=eq.${user.id}&select=tenant_id,display_name&limit=1`),
    db(`user_roles?user_id=eq.${user.id}&select=role`),
  ]);
  return { user, tenantId: profile?.tenant_id || null, roles: new Set(await withPlatformRole((roles || []).map((x) => str(x.role)), user.id, req)) };
}

// ------------------------------------------------------------ configuration

async function shopGateway(tenantId, provider) {
  const row = await one(`tenant_gateways?tenant_id=eq.${tenantId}&provider=eq.${encodeURIComponent(provider)}&select=enabled,config&limit=1`);
  return row ? { enabled: !!row.enabled, config: row.config || {} } : null;
}

async function platformGateways() {
  const row = await one(`platform_settings?key=eq.gateways&select=value&limit=1`);
  return row?.value || {};
}

/**
 * What to ask the gateway for. When the gateway charges in another currency
 * (for example PayPal in USD for a KES shop), `rate` says how many units of
 * the shop's currency one unit of the gateway currency is worth.
 */
function chargeFor(provider, config, amount, baseCurrency) {
  const p = PROVIDERS[provider];
  const base = str(baseCurrency).toUpperCase() || "KES";
  let currency = str(config.currency).toUpperCase() || base;
  if (p.currencies && !p.currencies.includes(currency)) currency = p.currencies[0];
  if (currency === base) return { amount: round2(amount), currency };
  const rate = Number(config.rate);
  if (!(rate > 0)) throw new Error(`${p.label} charges in ${currency}. Set how many ${base} one ${currency} is worth in the gateway settings.`);
  return { amount: round2(amount / rate), currency };
}

function missingFields(provider, config) {
  return PROVIDERS[provider].fields.filter((f) => !f.options && !str(config[f.key])).map((f) => f.label);
}

// ----------------------------------------------------------------- settling

async function settle(gp, outcome) {
  if (outcome.status === "pending") return "pending";
  let status = outcome.status;
  let message = outcome.message || null;
  if (status === "completed") {
    const amountOk = !(outcome.paidAmount > 0) || outcome.paidAmount + 0.01 >= Number(gp.charge_amount);
    const currencyOk = !outcome.paidCurrency || outcome.paidCurrency.toUpperCase() === str(gp.charge_currency).toUpperCase();
    if (!amountOk || !currencyOk) {
      status = "failed";
      message = `Paid ${outcome.paidAmount} ${outcome.paidCurrency || ""} but ${gp.charge_amount} ${gp.charge_currency} was due`;
    }
  }
  const updated = await db(`gateway_payments?id=eq.${gp.id}&status=eq.pending`, {
    method: "PATCH", prefer: "return=representation",
    body: { status, updated_at: new Date().toISOString(), detail: { ...(gp.detail || {}), receipt: outcome.receipt || null, message } },
  });
  if (!updated?.length) return status; // already settled elsewhere

  if (gp.scope === "sale") {
    // A failed attempt leaves the sale open so the cashier can try again or
    // use another method; only a confirmed payment completes it.
    const patch = status === "completed"
      ? { status: "completed", mpesa_ref: `${gp.provider}:${outcome.receipt || gp.provider_ref}`.slice(0, 120), mpesa_error_message: null }
      : { mpesa_error_message: str(message || status).slice(0, 500) };
    await db(`transactions?id=eq.${gp.target_id}&status=eq.pending`, { method: "PATCH", body: patch });
  } else {
    const payment = await one(`subscription_payments?id=eq.${gp.target_id}&select=*&limit=1`);
    if (payment && payment.status === "pending") {
      if (status === "completed") {
        const tenant = await one(`tenants?id=eq.${payment.tenant_id}&select=id,slug,business_name&limit=1`);
        if (tenant) await activateSubscription({ token: "" }, tenant, payment);
      } else {
        await db(`subscription_payments?id=eq.${payment.id}&status=eq.pending`, {
          method: "PATCH", body: { status, metadata: { ...(payment.metadata || {}), result_desc: message } },
        });
      }
    }
  }
  return status;
}

async function configFor(gp) {
  if (gp.scope === "sale") return (await shopGateway(gp.tenant_id, gp.provider))?.config || null;
  return (await platformGateways())?.[gp.provider] || null;
}

/** Asks the gateway about one payment and settles it when final. */
async function recheck(gp) {
  if (gp.status !== "pending") return gp.status;
  const provider = PROVIDERS[gp.provider];
  if (!provider) return "pending";
  if (provider.background) {
    // Answer arrives from the running request; give up after 5 minutes.
    if (Date.now() - Date.parse(gp.created_at) > 5 * 60_000 && !running.has(gp.id)) {
      return settle(gp, { status: "failed", message: "No answer from the wallet in time" });
    }
    return "pending";
  }
  const config = await configFor(gp);
  if (!config) return "pending";
  const outcome = await provider.check(config, {
    ref: gp.id, providerRef: gp.provider_ref, amount: Number(gp.charge_amount), currency: gp.charge_currency,
  }).catch((e) => { console.error("[hub] check failed", gp.provider, gp.id, e.message); return { status: "pending" }; });
  return settle(gp, outcome);
}

const running = new Set();

/** Starts a payment with a gateway and records it. */
async function begin({ scope, tenantId, targetId, provider, config, amount, baseCurrency, phone, email, name, description, title }) {
  const p = PROVIDERS[provider];
  if (!p) return { error: "Unknown payment gateway", status: 400 };
  const missing = missingFields(provider, config);
  if (missing.length) return { error: `${p.label} is missing: ${missing.join(", ")}`, status: 400 };
  let charge;
  try { charge = chargeFor(provider, config, amount, baseCurrency); } catch (e) { return { error: e.message, status: 400 }; }
  if (!(charge.amount > 0)) return { error: "Nothing to pay", status: 400 };
  if (p.kind === "push" && !str(phone)) return { error: "Enter the customer's phone number", status: 400 };

  const [gp] = await db("gateway_payments", {
    method: "POST", prefer: "return=representation",
    body: { scope, tenant_id: tenantId, target_id: targetId, provider, charge_amount: charge.amount, charge_currency: charge.currency, status: "pending" },
  });
  const params = {
    ref: gp.id, amount: charge.amount, currency: charge.currency, phone: str(phone), email: EMAIL.test(str(email)) ? str(email) : "payments@jmsurf.co.ke",
    name: str(name), description: str(description).slice(0, 120), title: str(title),
    returnUrl: `${ORIGIN}/api/pay/return?p=${gp.id}`, callbackUrl: `${ORIGIN}/api/pay/notify?p=${gp.id}`, ipnUrl: `${ORIGIN}/api/pay/notify`,
  };

  if (p.background) {
    running.add(gp.id);
    p.start(config, params)
      .then(async (r) => {
        await db(`gateway_payments?id=eq.${gp.id}`, { method: "PATCH", body: { provider_ref: r.providerRef } }).catch(() => {});
        if (r.final) await settle({ ...gp, provider_ref: r.providerRef }, r.final);
      })
      .catch((e) => settle(gp, { status: "failed", message: e.message }))
      .finally(() => running.delete(gp.id));
    return { ok: true, payment_id: gp.id, kind: "push", amount: charge.amount, currency: charge.currency };
  }

  try {
    const r = await p.start(config, params);
    await db(`gateway_payments?id=eq.${gp.id}`, { method: "PATCH", body: { provider_ref: r.providerRef, checkout_url: r.url || null } });
    return { ok: true, payment_id: gp.id, kind: p.kind, url: r.url || null, amount: charge.amount, currency: charge.currency };
  } catch (e) {
    await settle(gp, { status: "failed", message: e.message });
    return { error: e.message || `${p.label} did not accept the payment`, status: 400 };
  }
}

// -------------------------------------------------------------------- shops

async function saleStart(req, body) {
  const who = await caller(req);
  if (who.error) return who;
  if (!who.tenantId) return { error: "This account is not linked to a shop", status: 403 };
  const saleId = str(body.sale_id);
  if (!UUID.test(saleId)) return { error: "Invalid sale", status: 400 };
  const sale = await one(`transactions?id=eq.${saleId}&select=id,tenant_id,total,status,payment_method,customer_name&limit=1`);
  if (!sale || sale.tenant_id !== who.tenantId) return { error: "Sale not found", status: 404 };
  if (sale.status !== "pending" || sale.payment_method !== "online") return { error: "This sale is not waiting for an online payment", status: 409 };
  const provider = str(body.provider);
  const gw = await shopGateway(who.tenantId, provider);
  if (!gw?.enabled) return { error: "That payment gateway is not switched on for this shop", status: 400 };
  const open = await one(`gateway_payments?target_id=eq.${saleId}&status=eq.pending&select=*&limit=1`);
  if (open) {
    const state = await recheck(open);
    if (state === "completed") return { error: "This sale is already paid", status: 409 };
    if (state === "pending") {
      const age = Date.now() - Date.parse(open.created_at);
      if (age < 3 * 60_000) return { error: `The last payment request is still waiting. Try again in ${Math.ceil((3 * 60_000 - age) / 1000)} seconds.`, status: 409 };
      await settle(open, { status: "cancelled", message: "Replaced by a new attempt" });
    }
  }
  const settings = await one(`business_settings?tenant_id=eq.${who.tenantId}&select=business_name,currency&limit=1`);
  return begin({
    scope: "sale", tenantId: who.tenantId, targetId: saleId, provider, config: gw.config,
    amount: Number(sale.total), baseCurrency: settings?.currency || "KES",
    phone: body.phone, email: body.email, name: sale.customer_name,
    description: `${settings?.business_name || "Shop"} sale ${saleId.slice(0, 8).toUpperCase()}`, title: settings?.business_name,
  });
}

async function saleStatus(req, body) {
  const who = await caller(req);
  if (who.error) return who;
  const saleId = str(body.sale_id);
  if (!UUID.test(saleId)) return { error: "Invalid sale", status: 400 };
  const gp = await one(`gateway_payments?target_id=eq.${saleId}&tenant_id=eq.${who.tenantId}&select=*&order=created_at.desc&limit=1`);
  if (!gp) return { error: "No online payment for this sale", status: 404 };
  const status = await recheck(gp);
  const fresh = status === gp.status ? gp : await one(`gateway_payments?id=eq.${gp.id}&select=*&limit=1`);
  return { status, message: fresh?.detail?.message || null, url: gp.checkout_url };
}

// ----------------------------------------------------------------- platform

async function subscriptionOptions(req) {
  const who = await caller(req);
  if (who.error) return who;
  const all = await platformGateways();
  return {
    options: Object.entries(all)
      .filter(([id, c]) => PROVIDERS[id] && c?.enabled)
      .map(([id]) => ({ id, label: PROVIDERS[id].label, kind: PROVIDERS[id].kind, countries: PROVIDERS[id].countries })),
  };
}

async function subscriptionStart(req, body) {
  const who = await caller(req);
  if (who.error) return who;
  if (!who.tenantId || !(who.roles.has("admin") || who.roles.has("manager"))) return { error: "Only the shop owner or a manager can pay for the package", status: 403 };
  const provider = str(body.provider);
  const config = (await platformGateways())?.[provider];
  if (!config?.enabled || !PROVIDERS[provider]) return { error: "That payment option is not available", status: 400 };
  const plan = await one(`plans?id=eq.${encodeURIComponent(str(body.plan_id))}&is_active=eq.true&select=*&limit=1`);
  if (!plan) return { error: "That package is not available", status: 400 };
  const cycle = ["monthly", "quarterly", "semi_annually", "annually"].includes(str(body.cycle)) ? str(body.cycle) : "monthly";
  const subscription = await one(`subscriptions?tenant_id=eq.${who.tenantId}&select=id,plan_id,price&order=created_at.desc&limit=1`);
  const tenant = await one(`tenants?id=eq.${who.tenantId}&select=id,slug,business_name,business_type&limit=1`);
  const amount = Math.max(1, Math.round(shopCyclePrice(plan, cycle, tenant?.business_type, subscription)));
  const [payment] = await db("subscription_payments", {
    method: "POST", prefer: "return=representation",
    body: {
      tenant_id: who.tenantId, subscription_id: subscription?.id || null, amount, gateway: provider, status: "pending", phone: str(body.phone) || null,
      metadata: { plan_id: plan.id, plan_name: plan.name, cycle, type: "subscription", provider },
    },
  });
  const started = await begin({
    scope: "subscription", tenantId: who.tenantId, targetId: payment.id, provider, config, amount, baseCurrency: "KES",
    phone: body.phone, email: body.email || who.user.email, name: tenant?.business_name,
    description: `JMSURF Garage ${plan.name} package (${cycle.replace("_", " ")})`, title: "JMSURF Garage",
  });
  if (started.error) return started;
  await db(`subscription_payments?id=eq.${payment.id}`, { method: "PATCH", body: { reference: started.payment_id } });
  return { ...started, subscription_payment_id: payment.id, plan: plan.name };
}

async function subscriptionStatus(req, body) {
  const who = await caller(req);
  if (who.error) return who;
  const id = str(body.payment_id);
  if (!UUID.test(id)) return { error: "Invalid payment", status: 400 };
  const gp = await one(`gateway_payments?id=eq.${id}&tenant_id=eq.${who.tenantId}&scope=eq.subscription&select=*&limit=1`);
  if (!gp) return { error: "Payment not found", status: 404 };
  const status = await recheck(gp);
  const fresh = await one(`gateway_payments?id=eq.${gp.id}&select=detail&limit=1`);
  return { status, message: fresh?.detail?.message || null };
}

// --------------------------------------------------------------- key tests

async function testKeys(req, body) {
  const who = await caller(req);
  if (who.error) return who;
  const provider = str(body.provider);
  const p = PROVIDERS[provider];
  if (!p) return { error: "Unknown gateway", status: 400 };
  let config;
  if (str(body.scope) === "platform") {
    if (!who.roles.has("super_admin")) return { error: "Only the platform owner can do this", status: 403 };
    config = (await platformGateways())?.[provider];
  } else {
    if (!(who.roles.has("admin") || who.roles.has("manager"))) return { error: "Only the shop owner or a manager can do this", status: 403 };
    config = (await shopGateway(who.tenantId, provider))?.config;
  }
  if (!config) return { ok: false, error: "Save the keys first" };
  const missing = missingFields(provider, config);
  if (missing.length) return { ok: false, error: `Missing: ${missing.join(", ")}` };
  try { await p.verify(config); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------ return / notify

async function byIdOrTracking(query) {
  const id = str(query.get("p"));
  if (UUID.test(id)) return one(`gateway_payments?id=eq.${id}&select=*&limit=1`);
  const tracking = str(query.get("OrderTrackingId") || query.get("orderTrackingId"));
  if (tracking) return one(`gateway_payments?provider_ref=eq.${encodeURIComponent(tracking)}&select=*&limit=1`);
  const merchantRef = str(query.get("OrderMerchantReference"));
  if (UUID.test(merchantRef)) return one(`gateway_payments?id=eq.${merchantRef}&select=*&limit=1`);
  return null;
}

function returnPage(status) {
  const done = status === "completed";
  const title = done ? "Payment received" : status === "pending" ? "Payment is being confirmed" : "Payment not completed";
  const text = done ? "Thank you. You can close this window." : status === "pending" ? "This can take a few seconds. You can close this window; the shop's screen updates by itself." : "No money was taken. You can close this window and try again.";
  const color = done ? "#16a34a" : status === "pending" ? "#f97316" : "#dc2626";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;margin:0;display:grid;place-items:center;min-height:100vh;color:#0f172a}
.c{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:32px;max-width:360px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
.d{width:56px;height:56px;border-radius:50%;background:${color};margin:0 auto 16px;display:grid;place-items:center;color:#fff;font-size:28px}
h1{font-size:20px;margin:0 0 8px}p{color:#475569;font-size:14px;margin:0}</style></head>
<body><div class="c"><div class="d">${done ? "✓" : status === "pending" ? "…" : "!"}</div><h1>${title}</h1><p>${text}</p><p style="margin-top:18px;font-size:12px;color:#94a3b8">JMSURF Garage</p></div>
${status === "pending" ? "<script>setTimeout(()=>location.reload(),4000)</script>" : ""}</body></html>`;
}

// ------------------------------------------------------------------ routing

const POST_ROUTES = {
  "/api/pay/catalog": async () => ({ providers: providerCatalog() }),
  "/api/pay/sale/start": saleStart,
  "/api/pay/sale/status": saleStatus,
  "/api/pay/subscription/options": subscriptionOptions,
  "/api/pay/subscription/start": subscriptionStart,
  "/api/pay/subscription/status": subscriptionStatus,
  "/api/pay/test": testKeys,
};

export async function handleHubRequest(req, res, pathname, query, body, sendJson) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 500, { error: "Payments are not configured on the server" });
  try {
    if (pathname === "/api/pay/return") {
      const gp = await byIdOrTracking(query);
      const status = gp ? await recheck(gp).catch(() => "pending") : "failed";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(returnPage(status));
      return;
    }
    if (pathname === "/api/pay/notify") {
      const gp = await byIdOrTracking(query);
      if (gp) await recheck(gp).catch(() => {});
      // Pesapal expects this acknowledgement shape; others ignore the body.
      return sendJson(res, 200, {
        orderNotificationType: str(query.get("OrderNotificationType")) || "IPNCHANGE",
        orderTrackingId: str(query.get("OrderTrackingId")), orderMerchantReference: str(query.get("OrderMerchantReference")), status: 200,
      });
    }
    const handler = POST_ROUTES[pathname];
    if (!handler || req.method !== "POST") return sendJson(res, 404, { error: "Unknown payment route" });
    const result = await handler(req, body || {});
    return sendJson(res, result?.error ? result.status || 400 : 200, result);
  } catch (error) {
    console.error("[hub] request failed", pathname, error);
    return sendJson(res, 503, { error: "The payment service hit a problem. Please try again." });
  }
}

const ago = (ms) => encodeURIComponent(new Date(Date.now() - ms).toISOString());
const MIN = 60_000;

/**
 * Nothing stays pending for long. The provider checks (here, in gateways.js,
 * sendmoney.js and payments.js) settle payments within seconds; anything they
 * could not settle is closed here:
 *   - a prompt that never went out ("initiating" / no reference): 10 minutes
 *   - an M-Pesa or card prompt with no confirmation: 30 minutes (M-Pesa
 *     prompts expire after about 2 minutes, so it can no longer be paid)
 *   - an online gateway payment: 30 minutes for a phone prompt, 2 hours for a checkout page
 *   - an online sale with nothing waiting: 30 minutes
 *   - a package payment: 1 hour
 */
async function sweepStale() {
  // Sales whose prompt never left.
  const neverSent = await db(
    `transactions?status=eq.pending&payment_method=in.(mpesa,card)&created_at=lt.${ago(10 * MIN)}` +
      `&or=(mpesa_ref.is.null,mpesa_ref.like.*initiating)&select=id,payment_method&limit=100`,
  );
  for (const t of neverSent || []) {
    await closeSale(t.id, "cancelled", "The payment prompt did not go out, so no money was taken");
  }
  // Prompts nobody confirmed.
  const unanswered = await db(
    `transactions?status=eq.pending&payment_method=in.(mpesa,card)&created_at=lt.${ago(30 * MIN)}&select=id&limit=100`,
  );
  for (const t of unanswered || []) {
    await closeSale(t.id, "failed", "No payment confirmation within 30 minutes");
  }
  // Online gateway payments.
  const gws = await db(`gateway_payments?status=eq.pending&created_at=lt.${ago(30 * MIN)}&select=*&limit=100`);
  for (const gp of gws || []) {
    const redirect = PROVIDERS[gp.provider]?.kind === "redirect";
    if (redirect && Date.now() - Date.parse(gp.created_at) < 120 * MIN) continue;
    const state = await recheck(gp).catch(() => "pending");
    if (state === "pending") await settle(gp, { status: "failed", message: redirect ? "Checkout not completed within 2 hours" : "Not approved within 30 minutes" });
  }
  const online = await db(`transactions?payment_method=eq.online&status=eq.pending&created_at=lt.${ago(30 * MIN)}&select=id&limit=100`);
  for (const t of online || []) {
    const waiting = await one(`gateway_payments?target_id=eq.${t.id}&status=eq.pending&select=id&limit=1`);
    if (!waiting) await closeSale(t.id, "cancelled", "Online payment not completed");
  }
  // Package payments (M-Pesa, JMSURF, PayHero, Paystack, Daraja).
  const subs = await db(`subscription_payments?status=eq.pending&created_at=lt.${ago(60 * MIN)}&select=id,metadata,gateway&limit=100`);
  for (const p of subs || []) {
    if (PROVIDERS[p.gateway]) continue; // extra gateways close through gateway_payments above
    await db(`subscription_payments?id=eq.${p.id}&status=eq.pending`, {
      method: "PATCH", body: { status: "failed", metadata: { ...(p.metadata || {}), result_desc: "Not confirmed within an hour" } },
    });
  }
}

/** Closes a pending sale and the provider rows that were tracking it. */
async function closeSale(id, status, message) {
  const done = await db(`transactions?id=eq.${id}&status=eq.pending`, {
    method: "PATCH", prefer: "return=representation", body: { status, mpesa_error_message: message },
  });
  if (!done?.length) return;
  await Promise.all([
    db(`sendmoney_payments?pos_transaction_id=eq.${id}&status=in.(initiating,pending)`, {
      method: "PATCH", body: { status: status === "cancelled" ? "cancelled" : "failed", checked_at: new Date().toISOString() },
    }).catch(() => {}),
    db(`payhero_transactions?pos_transaction_id=eq.${id}&status=in.(initiating,pending)`, {
      method: "PATCH", body: { status: "failed", result_desc: message },
    }).catch(() => {}),
  ]);
  console.log("[hub] closed stale sale", id, status);
}

/** Finishes gateway payments nobody is watching and closes anything left pending too long. */
export function startHubReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = await db(`gateway_payments?status=eq.pending&select=*&order=created_at.asc&limit=25`);
      for (const gp of rows || []) {
        try { await recheck(gp); } catch (e) { console.error("[hub] reconcile failed", gp.id, e.message); }
      }
      await sweepStale();
    } catch (e) { console.error("[hub] reconcile batch failed", e.message); }
    finally { busy = false; }
  }, 20000).unref();
}
