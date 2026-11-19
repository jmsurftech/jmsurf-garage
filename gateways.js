// ---------------------------------------------------------------------------
// Company-owned gateways handled by the app container:
//
//   Daraja   -> the company's own Safaricom app; money lands on its own
//               Paybill/Till. Shortcode, type and environment are in
//               business_settings; consumer key, secret and passkey are in
//               integration_secrets (daraja_*), encrypted (integrations-core.js).
//               STK push for sales (POS) and invoices (staff, portal, pay links),
//               STK query, C2B URL registration (garage-integrations.js receives
//               the confirmations and matches them to invoices).
//   Paystack -> the company's own Paystack secret key (card and mobile money).
//
// Each shop has exactly one active gateway (business_settings.payment_provider)
// and these routes refuse to run unless it is the one selected. A sale is only
// marked completed after the provider itself confirms the payment and the
// amount; stock then follows automatically (database trigger apply_sale_stock).
// ---------------------------------------------------------------------------
import { isDemoTenant } from "./demo.js";
import { decryptSecret, darajaTimestamp, darajaPassword as stkPassword, darajaBase, darajaOutcome, darajaReference, kenyaMsisdn } from "./integrations-core.js";

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

/**
 * The company's gateway settings. Daraja keys come from integration_secrets (encrypted);
 * keys saved by older screens in business_settings still work until they are saved again.
 */
async function shopSettings(tenantId) {
  const [s, secrets] = await Promise.all([
    one(
      `business_settings?tenant_id=eq.${tenantId}&select=payment_provider,mpesa_consumer_key,mpesa_consumer_secret,mpesa_passkey,` +
        `mpesa_shortcode,mpesa_till_number,mpesa_environment,mpesa_account_reference,mpesa_transaction_type,business_name,` +
        `paystack_secret_key,business_email&limit=1`,
    ),
    db(`integration_secrets?tenant_id=eq.${tenantId}&name=in.(daraja_consumer_key,daraja_consumer_secret,daraja_passkey)&select=name,value`).catch(() => []),
  ]);
  if (!s) return s;
  const sec = Object.fromEntries((secrets || []).map((r) => [r.name, decryptSecret(r.value)]));
  return {
    ...s,
    mpesa_consumer_key: sec.daraja_consumer_key || decryptSecret(s.mpesa_consumer_key),
    mpesa_consumer_secret: sec.daraja_consumer_secret || decryptSecret(s.mpesa_consumer_secret),
    mpesa_passkey: sec.daraja_passkey || decryptSecret(s.mpesa_passkey),
  };
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

/**
 * Daraja settings of a company. Paybill: shortcode = the paybill. Till (Buy Goods): shortcode =
 * the store (head office) number the passkey belongs to, partyB = the till customers pay; a till
 * without a separate store number uses the till for both.
 */
export function darajaKeys(settings) {
  const till = str(settings?.mpesa_till_number);
  const paybill = str(settings?.mpesa_shortcode);
  const transactionType = str(settings?.mpesa_transaction_type) || (till ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline");
  const isTill = transactionType === "CustomerBuyGoodsOnline";
  const shortcode = isTill ? (paybill || till) : (paybill || till);
  return {
    consumerKey: str(settings?.mpesa_consumer_key),
    consumerSecret: str(settings?.mpesa_consumer_secret),
    passkey: str(settings?.mpesa_passkey),
    shortcode,
    partyB: isTill ? (till || shortcode) : shortcode,
    isTill,
    transactionType,
    accountReference: str(settings?.mpesa_account_reference),
    environment: str(settings?.mpesa_environment) === "sandbox" ? "sandbox" : "live",
    baseUrl: darajaBase(settings?.mpesa_environment),
  };
}
const keysComplete = (k) => !!(k.consumerKey && k.consumerSecret && k.passkey && /^\d{5,7}$/.test(k.shortcode) && /^\d{5,7}$/.test(k.partyB));

const darajaTokens = new Map();
export async function darajaToken(keys) {
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
  const timestamp = darajaTimestamp(); // Safaricom expects Nairobi time
  return { timestamp, password: stkPassword(keys.shortcode, keys.passkey, timestamp) };
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
  // While the customer has not answered, Safaricom replies with an errorCode and no ResultCode.
  const status = darajaOutcome(payload?.ResultCode);
  if (status === "pending") return { status };
  if (status === "completed") return { status, payload };
  return { status, payload: { message: str(payload?.ResultDesc), code: str(payload?.ResultCode) } };
}

/** Sends one STK prompt with the company's own keys. Returns { checkoutId } or { error }. */
async function darajaStk(keys, { phone, amount, reference, description, callbackUrl }) {
  const token = await darajaToken(keys);
  const { timestamp, password } = darajaPassword(keys);
  let result;
  try {
    const response = await fetch(`${keys.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: keys.shortcode, Password: password, Timestamp: timestamp, TransactionType: keys.transactionType,
        Amount: amount, PartyA: phone, PartyB: keys.partyB, PhoneNumber: phone, CallBackURL: callbackUrl,
        AccountReference: keys.isTill ? keys.partyB : reference, TransactionDesc: str(description).slice(0, 13) || "Payment",
      }),
      signal: AbortSignal.timeout(15000),
    });
    result = await response.json().catch(() => ({}));
  } catch {
    return { unknown: true, error: "Payment request outcome is unknown. Check before charging again." };
  }
  const checkoutId = str(result?.CheckoutRequestID);
  if (str(result?.ResponseCode) !== "0" || !checkoutId) return { error: str(result?.errorMessage || result?.ResponseDescription || result?.CustomerMessage) || "M-Pesa did not accept this payment." };
  return { checkoutId };
}

/** True when the company's own Daraja app is the active gateway and complete. */
export async function darajaReady(tenantId) {
  const s = await shopSettings(tenantId).catch(() => null);
  return str(s?.payment_provider) === "daraja" && keysComplete(darajaKeys(s));
}

/** Checks a company's Daraja keys with Safaricom (OAuth only: nothing is charged). */
export async function darajaCheckKeys(tenantId) {
  const keys = darajaKeys(await shopSettings(tenantId));
  if (!keysComplete(keys)) return { ok: false, error: "Save the shortcode, consumer key, consumer secret and passkey first." };
  darajaTokens.delete(`${keys.baseUrl}|${keys.consumerKey}`);
  try { await darajaToken(keys); return { ok: true, environment: keys.environment }; }
  catch (e) { return { ok: false, error: str(e?.message) }; }
}

/**
 * Registers the C2B confirmation / validation addresses for the company's shortcode, so
 * payments customers make themselves (paybill + invoice number as account) reach the app.
 */
export async function darajaRegisterC2b(tenantId, { confirmUrl, validateUrl }) {
  const keys = darajaKeys(await shopSettings(tenantId));
  if (!keysComplete(keys)) return { ok: false, error: "Save the Daraja keys first." };
  const token = await darajaToken(keys);
  const response = await fetch(`${keys.baseUrl}/mpesa/c2b/v2/registerurl`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ShortCode: keys.partyB, ResponseType: "Completed", ConfirmationURL: confirmUrl, ValidationURL: validateUrl }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  const desc = str(payload?.ResponseDescription || payload?.errorMessage);
  const ok = str(payload?.ResponseCode) === "0" || /success/i.test(desc);
  return { ok, already: !ok && /already/i.test(desc), description: desc || (response ? `Safaricom replied ${response.status}` : "No answer from Safaricom"), shortcode: keys.partyB, type: keys.isTill ? "till" : "paybill" };
}

// ------------------------------------------------- invoices through the company's own Daraja

/**
 * M-Pesa prompt for what a customer owes on an invoice, with the company's own Daraja app.
 * Same contract as sendmoney.pushInvoiceForShop (which hands Daraja companies over to this):
 * the request is kept in invoice_mpesa_requests (checkout id "daraja:<id>") and the payment
 * is recorded by settle_invoice_mpesa once Safaricom confirms it.
 */
export async function pushInvoiceDaraja(tenantId, invoiceId, rawPhone, amountWanted, requestedBy = "portal") {
  if (!UUID.test(str(invoiceId))) return { error: "Invalid invoice", status: 400 };
  if (await isDemoTenant(tenantId)) return { error: "Payments are switched off in the demo company.", status: 403 };
  const phone = kenyaMsisdn(rawPhone);
  if (!phone) return { error: "Enter a valid Kenyan M-Pesa number", status: 400 };
  const [settings, inv, open] = await Promise.all([
    shopSettings(tenantId),
    one(`invoices?id=eq.${invoiceId}&tenant_id=eq.${tenantId}&select=id,invoice_number,total,amount_paid,status,customer_id&limit=1`),
    one(`invoice_mpesa_requests?invoice_id=eq.${invoiceId}&status=in.(initiating,pending)&created_at=gt.${new Date(Date.now() - 120000).toISOString()}&select=id&limit=1`),
  ]);
  const keys = darajaKeys(settings);
  if (str(settings?.payment_provider) !== "daraja" || !keysComplete(keys)) return { error: "M-Pesa prompts are not switched on. Pay using the details shown.", status: 409 };
  if (!inv || ["draft", "void", "paid"].includes(inv.status)) return { error: "This invoice cannot be paid online", status: 409 };
  if (open) return { success: true, request_id: open.id, resumed: true };
  const due = Math.floor(Number(inv.total) - Number(inv.amount_paid));
  const amount = Math.floor(Number(amountWanted) || due);
  if (amount < 1 || amount > due || amount > 150000) return { error: `Pay between KES 1 and ${Math.min(due, 150000).toLocaleString()}`, status: 400 };
  const [req] = await db("invoice_mpesa_requests", { method: "POST", prefer: "return=representation", body: { tenant_id: tenantId, invoice_id: inv.id, customer_id: inv.customer_id, phone, amount, requested_by: requestedBy } });
  const search = new URLSearchParams({ r: req.id });
  if (CALLBACK_TOKEN) search.set("token", CALLBACK_TOKEN);
  const r = await darajaStk(keys, {
    phone, amount, reference: darajaReference(keys.accountReference, inv.invoice_number), description: `Inv ${str(inv.invoice_number)}`,
    callbackUrl: `${PUBLIC_ORIGIN}/api/payments/daraja/invoice-callback?${search}`,
  }).catch((e) => ({ error: str(e?.message) }));
  if (!r.checkoutId) {
    // An interrupted request may still have reached the phone: keep it open for the reconciler, never resend.
    await db(`invoice_mpesa_requests?id=eq.${req.id}`, { method: "PATCH", body: r.unknown ? { provider_status: { error: r.error } } : { status: "failed", provider_status: { error: str(r.error).slice(0, 300) } } }).catch(() => {});
    return { error: r.error || "M-Pesa did not answer. Try again.", status: 502 };
  }
  await db(`invoice_mpesa_requests?id=eq.${req.id}`, { method: "PATCH", body: { checkout_request_id: `daraja:${r.checkoutId}`, status: "pending", checked_at: new Date().toISOString() } });
  return { success: true, request_id: req.id };
}

/** Settles one Daraja invoice prompt from Safaricom's answer (callback receipt when there is one). */
export async function reconcileInvoiceDaraja(request, receiptHint = "") {
  const checkoutId = str(request.checkout_request_id).replace(/^daraja:/, "");
  if (!checkoutId) return "pending";
  const keys = darajaKeys(await shopSettings(request.tenant_id));
  if (!keysComplete(keys)) return "pending";
  const outcome = await darajaQuery(keys, checkoutId).catch(() => ({ status: "pending" }));
  if (outcome.status === "pending") {
    if (Date.now() - Date.parse(request.created_at) > 600000) {
      await db("rpc/settle_invoice_mpesa", { method: "POST", body: { p_request: request.id, p_status: "failed", p_receipt: null, p_provider: { timeout: true } } });
      return "failed";
    }
    return "pending";
  }
  const receipt = outcome.status === "completed" ? (str(receiptHint) || `DARAJA-${checkoutId}`).slice(0, 60) : null;
  await db("rpc/settle_invoice_mpesa", { method: "POST", body: { p_request: request.id, p_status: outcome.status, p_receipt: receipt, p_provider: outcome.payload || {} } });
  return outcome.status;
}

/** Safaricom's invoice callback: the receipt number is taken from it, the outcome is re-read from Safaricom. */
async function darajaInvoiceCallback(query, body) {
  if (CALLBACK_TOKEN && query.get("token") !== CALLBACK_TOKEN) return { error: "Forbidden", status: 401 };
  const id = str(query.get("r"));
  if (UUID.test(id)) {
    const r = await one(`invoice_mpesa_requests?id=eq.${id}&select=*&limit=1`);
    if (r?.status === "pending" && str(r.checkout_request_id).startsWith("daraja:")) {
      const items = body?.Body?.stkCallback?.CallbackMetadata?.Item || [];
      const receipt = str((items.find((x) => x?.Name === "MpesaReceiptNumber") || {}).Value);
      await reconcileInvoiceDaraja(r, /^[A-Z0-9]{8,12}$/.test(receipt) ? receipt : "").catch(() => {});
    }
  }
  return { ResultCode: 0, ResultDesc: "Accepted" };
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
  if (!keysComplete(keys)) {
    return { error: "Daraja credentials are not configured. Open System → Connections → M-Pesa.", status: 400 };
  }

  // Reserve first so a retry can never send a second prompt for this sale.
  await db(`transactions?id=eq.${sale.id}&status=eq.pending`, { method: "PATCH", body: { mpesa_ref: "daraja:initiating" } });

  const search = new URLSearchParams({ sale: sale.id });
  if (CALLBACK_TOKEN) search.set("token", CALLBACK_TOKEN);
  const result = await darajaStk(keys, {
    phone, amount, reference: darajaReference(keys.accountReference, settings?.business_name, "GARAGE"), description: `Sale ${sale.id.slice(0, 8)}`,
    callbackUrl: `${PUBLIC_ORIGIN}/api/payments/daraja/callback?${search}`,
  });
  if (result.unknown) return { error: "Payment request outcome is unknown. Check this sale before charging again.", status: 503, prompt_sent: null };
  const checkoutId = str(result.checkoutId);
  if (!checkoutId) {
    await settleSale(sale.id, "failed", null, { message: str(result.error || "M-Pesa rejected the request") });
    return { error: result.error || "M-Pesa did not accept this payment.", status: 400, prompt_sent: false };
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
  const callback = /^https:\/\/([a-z0-9-]+\.)*garage\.jmsurf\.co\.ke(\/|$)/i.test(str(body.callback_url))
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
  "/api/payments/daraja/invoice-callback": (req, body, query) => darajaInvoiceCallback(query, body),
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
      // Invoice prompts sent with a company's own Daraja app (nobody may be watching the screen).
      const prompts = await db(
        `invoice_mpesa_requests?status=eq.pending&checkout_request_id=like.daraja:*&select=*&order=created_at.asc&limit=30`,
      ).catch(() => []);
      for (const r of prompts || []) {
        try { await reconcileInvoiceDaraja(r); } catch (error) { console.error("[gateways] invoice prompt", r.id, error?.message); }
      }
    } catch (error) {
      console.error("[gateways] reconciliation batch failed", error?.message);
    } finally {
      busy = false;
    }
  }, 15000).unref();
}
