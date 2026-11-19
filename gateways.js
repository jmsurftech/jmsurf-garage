// ---------------------------------------------------------------------------
// Shop-owned gateways handled by the app container:
//
//   Daraja   -> the shop's own Safaricom app keys; money lands on the shop's
//               own Paybill/Till. Saved in business_settings.
//   Paystack -> the shop's own Paystack secret key (card and mobile money).
//
// Each shop has exactly one active gateway (business_settings.payment_provider)
// and these routes refuse to run unless it is the one selected. A sale is only
// marked completed after the provider itself confirms the payment and the
// amount; stock then follows automatically (database trigger apply_sale_stock).
// ---------------------------------------------------------------------------
import { isDemoTenant } from "./demo.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.JMSURF_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://garage.jmsurf.co.ke").replace(/\/+$/, "");
const CALLBACK_TOKEN = process.env.PAYMENT_CALLBACK_TOKEN || "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

async function db(path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    signal: AbortSignal.timeout(8000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${str(data?.message || data?.code)}`);
  return data;
}
const one = async (path) => (await db(path))?.[0] || null;

/** Signed-in shop staff acting for their own shop. */
async function staffContext(req) {
  const authorization = str(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) return { error: "Sign in first", status: 401 };
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: ANON_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { error: "Sign in first", status: 401 };
  const user = await response.json().catch(() => null);
  if (!UUID.test(str(user?.id))) return { error: "Sign in first", status: 401 };
  const [profile, roles] = await Promise.all([
    one(`profiles?user_id=eq.${user.id}&select=tenant_id&limit=1`),
    db(`user_roles?user_id=eq.${user.id}&select=role`),
  ]);
  const roleSet = new Set((roles || []).map((r) => str(r.role)));
  if (!profile?.tenant_id) return { error: "This account is not linked to a shop", status: 403 };
  // The public demo never sends real payment prompts (anyone can open it).
  if (await isDemoTenant(profile.tenant_id)) return { error: "Payments are switched off in the demo. Create your own free company to take real payments.", status: 403 };
  return { user, tenantId: profile.tenant_id, roles: roleSet };
}

/** Loads a pending sale of the caller's shop, paid by the given method. */
async function pendingSale(ctx, saleId, methods) {
  if (!UUID.test(saleId)) return { error: "Invalid sale identifier", status: 400 };
  const sale = await one(`transactions?id=eq.${saleId}&select=id,tenant_id,total,status,payment_method,mpesa_ref,customer_name&limit=1`);
  if (!sale || sale.tenant_id !== ctx.tenantId) return { error: "Sale not found", status: 404 };
  if (!methods.includes(sale.payment_method)) return { error: "This sale is not eligible for this payment", status: 409 };
  return { sale };
}

async function shopSettings(tenantId) {
  return one(
    `business_settings?tenant_id=eq.${tenantId}&select=payment_provider,mpesa_consumer_key,mpesa_consumer_secret,mpesa_passkey,` +
      `mpesa_shortcode,mpesa_till_number,mpesa_environment,mpesa_account_reference,mpesa_transaction_type,business_name,` +
      `paystack_secret_key,business_email&limit=1`,
  );
}

/** Marks a sale paid or failed; only a pending sale changes. */
async function settleSale(saleId, status, reference, detail) {
  const body = status === "completed"
    ? { status, mpesa_ref: reference, mpesa_error_message: null, mpesa_error_payload: null }
    : { status, mpesa_error_message: str(detail?.message || status).slice(0, 500), mpesa_error_payload: detail || null };
  await db(`transactions?id=eq.${saleId}&status=eq.pending`, { method: "PATCH", body });
}

function normalizePhone(raw) {
  let digits = str(raw).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  if (digits.startsWith("7") || digits.startsWith("1")) digits = "254" + digits;
  return /^254(7|1)\d{8}$/.test(digits) ? digits : "";
}

// ------------------------------------------------------------------ Daraja

function darajaKeys(settings) {
  const till = str(settings?.mpesa_till_number);
  const paybill = str(settings?.mpesa_shortcode);
  const shortcode = till || paybill;
  return {
    consumerKey: str(settings?.mpesa_consumer_key),
    consumerSecret: str(settings?.mpesa_consumer_secret),
    passkey: str(settings?.mpesa_passkey),
    shortcode,
    transactionType: str(settings?.mpesa_transaction_type) || (till ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline"),
    accountReference: str(settings?.mpesa_account_reference),
    baseUrl: str(settings?.mpesa_environment) === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke",
  };
}

const darajaTokens = new Map();
async function darajaToken(keys) {
  const cacheKey = `${keys.baseUrl}|${keys.consumerKey}`;
  const cached = darajaTokens.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.token;
  const basic = Buffer.from(`${keys.consumerKey}:${keys.consumerSecret}`).toString("base64");
  const response = await fetch(`${keys.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload?.access_token) throw new Error("M-Pesa rejected the shop's Daraja keys. Check them in Settings, Payment Gateways.");
  // Tokens last an hour; reuse them so each prompt leaves faster.
  darajaTokens.set(cacheKey, { token: payload.access_token, expires: Date.now() + 50 * 60_000 });
  return payload.access_token;
}

function darajaPassword(keys) {
  const now = new Date(Date.now() + 3 * 3600_000); // Safaricom expects Nairobi time
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return { timestamp, password: Buffer.from(`${keys.shortcode}${keys.passkey}${timestamp}`).toString("base64") };
}

async function darajaQuery(keys, checkoutId) {
  const token = await darajaToken(keys);
  const { timestamp, password } = darajaPassword(keys);
  const response = await fetch(`${keys.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: keys.shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutId }),
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  const code = str(payload?.ResultCode);
  if (!code) return { status: "pending" };
  if (code === "0") return { status: "completed", payload };
  return { status: code === "1032" ? "cancelled" : "failed", payload: { message: str(payload?.ResultDesc), code } };
}

async function darajaPush(req, body) {
  const ctx = await staffContext(req);
  if (ctx.error) return ctx;
  const found = await pendingSale(ctx, str(body.pos_transaction_id || body.transaction_id), ["mpesa"]);
  if (found.error) return found;
  const { sale } = found;
  if (sale.status !== "pending") return { error: "This sale is not waiting for payment", status: 409 };
  if (str(sale.mpesa_ref).startsWith("daraja:")) {
    return { success: true, checkout_request_id: str(sale.mpesa_ref).slice(7), resumed: true };
  }
  const phone = normalizePhone(body.phone);
  if (!phone) return { error: "That phone number is not valid. Use 07XXXXXXXX.", status: 400 };
  const amount = Number(sale.total);
  if (!Number.isInteger(amount) || amount < 1 || amount > 150000) {
    return { error: "M-Pesa requires a whole-shilling amount between KES 1 and 150,000.", status: 422 };
  }
  const settings = await shopSettings(ctx.tenantId);
  if (str(settings?.payment_provider) !== "daraja") {
    return { error: "This shop changed payment gateways. Refresh the POS before taking payment.", status: 409 };
  }
  const keys = darajaKeys(settings);
  if (!keys.consumerKey || !keys.consumerSecret || !keys.passkey || !/^\d{5,7}$/.test(keys.shortcode)) {
    return { error: "Daraja credentials are not configured. Open Settings, Payment Gateways.", status: 400 };
  }

  // Reserve first so a retry can never send a second prompt for this sale.
  await db(`transactions?id=eq.${sale.id}&status=eq.pending`, { method: "PATCH", body: { mpesa_ref: "daraja:initiating" } });

  const token = await darajaToken(keys);
  const { timestamp, password } = darajaPassword(keys);
  const search = new URLSearchParams({ sale: sale.id });
  if (CALLBACK_TOKEN) search.set("token", CALLBACK_TOKEN);
  const isTill = keys.transactionType === "CustomerBuyGoodsOnline";
  const reference = (keys.accountReference || settings?.business_name || "POS").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "POS";
  let result;
  try {
    const response = await fetch(`${keys.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: keys.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: keys.transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: keys.shortcode,
        PhoneNumber: phone,
        CallBackURL: `${PUBLIC_ORIGIN}/api/payments/daraja/callback?${search}`,
        AccountReference: isTill ? keys.shortcode : reference,
        TransactionDesc: `Sale ${sale.id.slice(0, 8)}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    result = await response.json().catch(() => ({}));
  } catch {
    return { error: "Payment request outcome is unknown. Check this sale before charging again.", status: 503, prompt_sent: null };
  }
  const checkoutId = str(result?.CheckoutRequestID);
  if (str(result?.ResponseCode) !== "0" || !checkoutId) {
    await settleSale(sale.id, "failed", null, { message: str(result?.errorMessage || result?.ResponseDescription || "M-Pesa rejected the request") });
    return { error: str(result?.errorMessage || result?.ResponseDescription) || "M-Pesa did not accept this payment.", status: 400, prompt_sent: false };
  }
  await db(`transactions?id=eq.${sale.id}&status=eq.pending`, { method: "PATCH", body: { mpesa_ref: `daraja:${checkoutId}` } });
  return { success: true, checkout_request_id: checkoutId, provider: "daraja" };
}

/** Checks a Daraja sale with Safaricom and settles it when final. */
async function reconcileDaraja(sale) {
  const checkoutId = str(sale.mpesa_ref).startsWith("daraja:") ? str(sale.mpesa_ref).slice(7) : "";
  if (!checkoutId || checkoutId === "initiating") return { resolved_status: "pending" };
  const keys = darajaKeys(await shopSettings(sale.tenant_id));
  if (!keys.consumerKey || !keys.passkey) return { resolved_status: "pending" };
  const outcome = await darajaQuery(keys, checkoutId);
  if (outcome.status === "completed") {
    // The query does not carry the receipt; keep the checkout reference.
    await settleSale(sale.id, "completed", `daraja:${checkoutId}`);
  } else if (outcome.status !== "pending") {
    await settleSale(sale.id, outcome.status, null, outcome.payload);
  }
  return { resolved_status: outcome.status };
}

async function darajaStatus(req, body) {
  const ctx = await staffContext(req);
  if (ctx.error) return ctx;
  const found = await pendingSale(ctx, str(body.pos_transaction_id || body.transaction_id), ["mpesa"]);
  if (found.error) return found;
  if (found.sale.status !== "pending") return { resolved_status: found.sale.status };
  return reconcileDaraja({ ...found.sale, tenant_id: ctx.tenantId });
}

/** Safaricom's callback is only a hint: the outcome is re-read from Safaricom. */
async function darajaCallback(query) {
  if (CALLBACK_TOKEN && query.get("token") !== CALLBACK_TOKEN) return { error: "Forbidden", status: 401 };
  const saleId = str(query.get("sale"));
  if (UUID.test(saleId)) {
    const sale = await one(`transactions?id=eq.${saleId}&select=id,tenant_id,status,mpesa_ref&limit=1`);
    if (sale?.status === "pending") await reconcileDaraja(sale).catch(() => {});
  }
  return { ResultCode: 0, ResultDesc: "Accepted" };
}

// ---------------------------------------------------------------- Paystack

async function paystack(secret, path, options = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === false) throw new Error(str(payload?.message) || `Paystack replied ${response.status}`);
  return payload;
}

async function paystackInitialize(req, body) {
  const ctx = await staffContext(req);
  if (ctx.error) return ctx;
  const found = await pendingSale(ctx, str(body.transaction_id || body.pos_transaction_id), ["card", "mpesa"]);
  if (found.error) return found;
  const { sale } = found;
  if (sale.status !== "pending") return { error: "This sale is not waiting for payment", status: 409 };
  const settings = await shopSettings(ctx.tenantId);
  if (str(settings?.payment_provider) !== "paystack") {
    return { error: "This shop changed payment gateways. Refresh the POS before taking payment.", status: 409 };
  }
  const secret = str(settings?.paystack_secret_key);
  if (!/^sk_(live|test)_/.test(secret)) {
    return { error: "Paystack is not set up. Save your secret key in Settings, Payment Gateways.", status: 400 };
  }
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(body.email)) ? str(body.email)
    : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(settings?.business_email)) ? str(settings.business_email)
    : "customer@jmsurf.co.ke";
  const callback = /^https:\/\/([a-z0-9-]+\.)*jmsurfgarage\.co\.ke(\/|$)/i.test(str(body.callback_url))
    ? str(body.callback_url) : `${PUBLIC_ORIGIN}/`;
  const channels = Array.isArray(body.channels) ? body.channels.filter((c) => ["card", "mobile_money", "bank"].includes(c)) : undefined;
  const payload = await paystack(secret, "/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email,
      amount: Math.round(Number(sale.total) * 100),
      currency: "KES",
      reference: sale.id,
      callback_url: callback,
      ...(channels?.length ? { channels } : {}),
      metadata: { tenant_id: ctx.tenantId, pos_transaction_id: sale.id },
    }),
  });
  return { status: true, data: payload.data };
}

async function reconcilePaystack(sale) {
  const settings = await shopSettings(sale.tenant_id);
  const secret = str(settings?.paystack_secret_key);
  if (!secret) return { success: false, status: "pending" };
  let payload;
  try {
    payload = await paystack(secret, `/transaction/verify/${encodeURIComponent(sale.id)}`);
  } catch {
    return { success: false, status: "pending" };
  }
  const data = payload?.data || {};
  const paidKobo = Number(data.amount);
  if (data.status === "success") {
    if (paidKobo !== Math.round(Number(sale.total) * 100) || str(data.currency).toUpperCase() !== "KES") {
      return { success: false, status: "pending", error: "Paystack amount does not match the sale" };
    }
    await settleSale(sale.id, "completed", `paystack:${str(data.reference)}`);
    return { success: true, status: "completed" };
  }
  if (["failed", "abandoned", "reversed"].includes(str(data.status))) {
    await settleSale(sale.id, "failed", null, { message: `Paystack: ${data.gateway_response || data.status}` });
    return { success: false, status: "failed" };
  }
  return { success: false, status: "pending" };
}

async function paystackVerify(req, body) {
  const ctx = await staffContext(req);
  if (ctx.error) return ctx;
  const found = await pendingSale(ctx, str(body.reference || body.transaction_id), ["card", "mpesa"]);
  if (found.error) return found;
  if (found.sale.status === "completed") return { success: true, status: "completed" };
  if (found.sale.status !== "pending") return { success: false, status: found.sale.status };
  return reconcilePaystack({ ...found.sale, tenant_id: ctx.tenantId });
}

// ------------------------------------------------------------------ routing

const ROUTES = {
  "/api/payments/daraja/stk-push": (req, body) => darajaPush(req, body),
  "/api/payments/daraja/status": (req, body) => darajaStatus(req, body),
  "/api/payments/daraja/callback": (req, body, query) => darajaCallback(query),
  "/api/payments/paystack/initialize": (req, body) => paystackInitialize(req, body),
  "/api/payments/paystack/verify": (req, body) => paystackVerify(req, body),
};

export function isGatewayRoute(pathname) {
  return Object.prototype.hasOwnProperty.call(ROUTES, pathname);
}

export async function handleGatewayRequest(req, res, pathname, query, body, sendJson) {
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("The payment server is not configured. Contact support.");
    const result = await ROUTES[pathname](req, body, query);
    return sendJson(res, result?.error ? result.status || 400 : 200, result);
  } catch (error) {
    console.error("[gateways] request failed", pathname, error);
    return sendJson(res, 503, { error: str(error?.message) || "The payment service hit a problem. Please try again." });
  }
}

/** Finishes Daraja and Paystack sales even when no till is watching. */
export function startGatewayReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const rows = await db(
        `transactions?status=eq.pending&created_at=gte.${encodeURIComponent(since)}` +
          `&or=(mpesa_ref.like.daraja:*,mpesa_ref.is.null)&payment_method=in.(mpesa,card)` +
          `&select=id,tenant_id,total,status,mpesa_ref,payment_method&order=created_at.desc&limit=30`,
      );
      for (const sale of rows || []) {
        try {
          if (str(sale.mpesa_ref).startsWith("daraja:")) await reconcileDaraja(sale);
          else {
            const settings = await shopSettings(sale.tenant_id);
            if (str(settings?.payment_provider) === "paystack") await reconcilePaystack(sale);
          }
        } catch (error) {
          console.error("[gateways] reconciliation failed", sale.id, error?.message);
        }
      }
    } catch (error) {
      console.error("[gateways] reconciliation batch failed", error?.message);
    } finally {
      busy = false;
    }
  }, 15000).unref();
}
