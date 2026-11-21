import { startSendMoneyPrompt } from "./sendmoney.js";
import { PUBLIC_ORIGIN, APP_ORIGIN, SHOP_ORIGIN } from "./hosts.js";
import { shopCyclePrice, planPrice } from "./planPricing.js";
import { isPlatformAdmin } from "./platform.js";
import { credential } from "./integrations-core.js";

/**
 * JMSURF Garage modules on the bill: every switched-on module (active, on trial
 * or payment due) is added to each renewal at its monthly price. A plan that
 * includes every module (All-in-One) or lists a module has nothing extra.
 */
export async function billableModules(tenantId, plan, token) {
  if (plan?.all_modules) return [];
  const rows = await db(`tenant_modules?tenant_id=eq.${encodeURIComponent(tenantId)}&or=(status.in.(active,past_due),and(status.eq.trial,trial_ends_at.gt.${new Date().toISOString()}))&select=module_key,price_monthly,status`, { token }).catch(() => []);
  const included = new Set(plan?.included_modules || []);
  return (Array.isArray(rows) ? rows : []).filter((m) => !included.has(m.module_key));
}
const modulesMonthly = (mods) => mods.reduce((a, m) => a + Math.max(0, Number(m.price_monthly) || 0), 0);

// Owner rule: a year costs 10 months (2 months free), for the package AND every module line
// (extra branches and pro-rata rows included). Other cycles pay their number of months.
export const ANNUAL_PAID_MONTHS = 10;
const CYCLE_LABEL = { monthly: "1 month", quarterly: "3 months", semi_annually: "6 months", annually: "1 year (10 months paid)" };
const MODULE_LABEL = { extra_branch: "Extra branch", prorata: "Pro-rata charge", sms: "SMS" };
export function chargeMonths(cycle) { return cycle === "annually" ? ANNUAL_PAID_MONTHS : cycleMonths(cycle); }
/** The package part of one cycle: a year is 10 x the (agreed) monthly price. */
export function planCharge(plan, cycle, businessType, subscription) {
  return cycle === "annually"
    ? shopCyclePrice(plan, "monthly", businessType, subscription) * ANNUAL_PAID_MONTHS
    : shopCyclePrice(plan, cycle, businessType, subscription);
}
/**
 * What a renewal charges, one line per item (package, each module, extra branches, pro-rata,
 * SMS): the amount asked is their sum, and the subscription invoice lists the same lines.
 */
export function subscriptionLines({ plan, cycle, businessType, subscription, mods = [] }) {
  const months = chargeMonths(cycle);
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const base = r2(planCharge(plan, cycle, businessType, subscription));
  const lines = [{ kind: "plan", key: str(plan?.id), name: `${str(plan?.name) || "Package"} package (${CYCLE_LABEL[cycle] || "1 month"})`, quantity: 1, rate: base, amount: base }];
  for (const m of mods) {
    const monthly = Math.max(0, Number(m.price_monthly) || 0);
    if (!monthly) continue;
    const key = str(m.module_key);
    const name = MODULE_LABEL[key] || str(m.name) || key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    lines.push({ kind: "module", key, name: `${name} (${CYCLE_LABEL[cycle] || "1 month"})`, quantity: months, rate: monthly, amount: r2(monthly * months) });
  }
  return lines;
}
export const linesTotal = (lines) => Math.round(lines.reduce((a, l) => a + Number(l.amount || 0), 0));

// ---------------------------------------------------------------------------
// Payments handled directly by the app container.
//
// These routes replace the Edge Functions for money movement, because the
// self-hosted Edge Runtime is not refreshed by a normal Coolify deploy.
// Everything here ships with the app image, so a git push is enough.
//
//   Customer payments (POS)  -> PayHero, using the platform API credentials.
//                               Money lands on the shop's own Till/Paybill.
//   Subscription payments    -> Safaricom Daraja, using the platform keys.
//                               Money lands on the JMSURF Paybill.
// ---------------------------------------------------------------------------

const PAYHERO_BASE = "https://backend.payhero.co.ke/api/v2";

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/+$/, "");
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.JMSURF_SUPABASE_SERVICE_KEY ||
  "";

// The bare domain redirects to www at Cloudflare, and payment providers do not
// follow redirects, so callbacks must point straight at the www address.

const CALLBACK_TOKEN = process.env.PAYMENT_CALLBACK_TOKEN || "";

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pick = (...values) => {
  for (const v of values) {
    const s = str(v);
    if (s) return s;
  }
  return "";
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------- REST helpers

function restHeaders(token, extra = {}) {
  return {
    apikey: SERVICE_KEY || SUPABASE_ANON_KEY,
    Authorization: token || `Bearer ${SERVICE_KEY || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Service-role REST call. Falls back to the caller's token when no key is set. */
async function db(pathAndQuery, { method = "GET", body, token, prefer } = {}) {
  if (!SUPABASE_URL) throw new Error("The server is missing its backend address");
  const useServiceRole = Boolean(SERVICE_KEY);
  const auth = useServiceRole ? `Bearer ${SERVICE_KEY}` : token || "";
  const headers = restHeaders(auth, prefer ? { Prefer: prefer } : {});
  const options = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...options, signal: AbortSignal.timeout(8000) });
  } catch (error) {
    if (method !== "GET") throw error;
    await wait(100);
    response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...options, signal: AbortSignal.timeout(8000) });
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, data: parsed, raw: text };
}

async function dbRow(pathAndQuery, options) {
  const result = await db(pathAndQuery, options);
  if (!result.ok || !Array.isArray(result.data)) return null;
  return result.data[0] || null;
}

async function dbRequired(pathAndQuery, options) {
  const result = await db(pathAndQuery, options);
  if (!result.ok) {
    throw new Error(`Payment database error (${result.status}): ${str(result.data?.message || result.data?.code || result.raw).slice(0, 200)}`);
  }
  return result.data;
}

// ------------------------------------------------------------ authentication

async function authenticate(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Sign in first", status: 401 };
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { error: "The server is missing its backend address", status: 500 };
  }
  const authOptions = { headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY } };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { ...authOptions, signal: AbortSignal.timeout(8000) });
  } catch {
    await wait(100);
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { ...authOptions, signal: AbortSignal.timeout(8000) });
  }
  if (!response.ok) return { error: "Sign in first", status: 401 };
  const user = await response.json();
  if (!user?.id) return { error: "Sign in first", status: 401 };
  return { user, token: authHeader };
}

async function isSuperAdmin(_token, userId) {
  // The platform owner, and only from the super admin address (platform.js).
  return isPlatformAdmin(userId);
}

/** True for shop admins, managers and the platform owner. */
async function canManagePayouts(ctx) {
  const rows = await db(`user_roles?user_id=eq.${encodeURIComponent(ctx.user.id)}&select=role`, { token: ctx.token });
  const roles = Array.isArray(rows.data) ? rows.data.map((r) => str(r.role)) : [];
  return roles.some((role) => ["admin", "manager", "super_admin"].includes(role));
}

// ------------------------------------------------------------- saved settings

let settingsCache = { value: null, at: 0 };

async function paymentSettings() {
  if (settingsCache.value && Date.now() - settingsCache.at < 30_000) return settingsCache.value;
  const row = await dbRow("platform_settings?key=eq.payment&select=value&limit=1");
  const value = row?.value || {};
  settingsCache = { value, at: Date.now() };
  return value;
}

function invalidateSettingsCache() {
  settingsCache = { value: null, at: 0 };
}

/**
 * Platform PayHero credentials: saved settings first, then container env.
 * Credentials are never stored in the source code.
 */
async function payheroCredentials() {
  const saved = (await paymentSettings())?.payhero || {};
  const username = pick(saved.api_username, process.env.PAYHERO_API_USERNAME);
  const password = pick(saved.api_password, process.env.PAYHERO_API_PASSWORD);
  const accountId = pick(saved.account_id, process.env.PAYHERO_ACCOUNT_ID);
  const rawToken = pick(saved.basic_auth_token, process.env.PAYHERO_BASIC_AUTH_TOKEN);

  let authHeader = "";
  if (username && password) {
    authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  } else if (rawToken) {
    authHeader = rawToken.toLowerCase().startsWith("basic ") ? rawToken : `Basic ${rawToken}`;
  }

  return { username, password, accountId, authHeader, configured: Boolean(authHeader) };
}

// JMSURF Technologies Paybill — subscription and renewal money lands here.
// Keys come from the saved settings or the container environment only.
const DARAJA_DEFAULT_SHORTCODE = "4022819";
/** The platform's own JMSURF PAY settlement channel (package fees), separate from every company. */
const PLATFORM_EXTERNAL_ID = "jmsurf-garage-platform";

/** Daraja rejects references with spaces or symbols; max 12 characters. */
function safeAccountReference(...candidates) {
  for (const candidate of candidates) {
    const cleaned = str(candidate).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (cleaned) return cleaned.slice(0, 12);
  }
  return "JMSURFGARAGE";
}

/** Platform Daraja keys used for subscription and renewal payments only. */
async function darajaCredentials() {
  const settings = await paymentSettings();
  const daraja = { ...(settings?.mpesa || {}), ...(settings?.daraja || {}) };

  const till = pick(daraja.till_number, daraja.buy_goods_number);
  const paybill = pick(daraja.paybill_number, daraja.shortcode);
  const shortcode = pick(daraja.shortcode, daraja.paybill_number, till, credential("MPESA_SHORTCODE"), DARAJA_DEFAULT_SHORTCODE);

  // A paybill needs CustomerPayBillOnline; only a till uses CustomerBuyGoodsOnline.
  // Getting this wrong makes Safaricom accept the request but never deliver the PIN prompt.
  let transactionType = pick(daraja.transaction_type);
  if (!transactionType) {
    const looksLikeTill = Boolean(till) && !paybill;
    transactionType = looksLikeTill ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline";
  }

  return {
    consumerKey: pick(daraja.consumer_key, credential("MPESA_CONSUMER_KEY")),
    consumerSecret: pick(daraja.consumer_secret, credential("MPESA_CONSUMER_SECRET")),
    passkey: pick(daraja.passkey, credential("MPESA_PASSKEY")),
    shortcode,
    accountReference: pick(daraja.account_reference),
    environment: pick(daraja.environment, credential("MPESA_ENVIRONMENT"), "live"),
    transactionType,
  };
}

// ------------------------------------------------------------------- helpers

function normalizePhone(raw) {
  let digits = str(raw).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  if (digits.startsWith("7") || digits.startsWith("1")) digits = "254" + digits;
  return digits;
}

function validPhone(phone) {
  return /^254(7|1)\d{8}$/.test(phone);
}

function labelSafe(value) {
  return str(value).replace(/[^A-Za-z0-9 \-_.]/g, "").trim().slice(0, 20);
}

function callbackUrl(pathname, params = {}) {
  const search = new URLSearchParams(params);
  if (CALLBACK_TOKEN) search.set("token", CALLBACK_TOKEN);
  const query = search.toString();
  return `${PUBLIC_ORIGIN}${pathname}${query ? `?${query}` : ""}`;
}

/** Resolves the shop the caller is acting for and checks they belong to it. */
async function resolveTenant(ctx, { tenantId, tenantSlug }) {
  const id = str(tenantId);
  const slug = str(tenantSlug).toLowerCase();
  if (!id && !slug) return { error: "Shop details are missing. Open the page from your shop address." };

  const query = id
    ? `tenants?id=eq.${encodeURIComponent(id)}&select=id,slug,business_name,business_type&limit=1`
    : `tenants?slug=eq.${encodeURIComponent(slug)}&select=id,slug,business_name,business_type&limit=1`;
  const [tenant, profile] = await Promise.all([
    dbRow(query, { token: ctx.token }),
    dbRow(
      `profiles?user_id=eq.${encodeURIComponent(ctx.user.id)}&select=tenant_id&limit=1`,
      { token: ctx.token },
    ),
  ]);
  if (!tenant) return { error: "That shop could not be found." };
  // The public demo never sends real payment prompts (anyone can open it).
  if (tenant.slug === "demo") return { error: "Payments are switched off in the demo. Create your own free company to take real payments." };
  if (profile?.tenant_id !== tenant.id) {
    const superAdmin = await isSuperAdmin(ctx.token, ctx.user.id);
    if (!superAdmin) return { error: "You are not allowed to take payments for this shop." };
  }
  return { tenant };
}

// --------------------------------------------------- PayHero channel handling

/** Finds an existing active PayHero channel for a number, so we never duplicate. */
async function findPayheroChannel(creds, { channelType, shortCode, accountNumber }) {
  for (let page = 1; page <= 10; page++) {
    let response;
    try {
      response = await fetch(`${PAYHERO_BASE}/payment_channels?page=${page}`, {
        headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const rows = Array.isArray(payload)
      ? payload
      : payload?.payment_channels || payload?.data || [];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const match = rows.find(
      (c) =>
        str(c?.short_code) === str(shortCode) &&
        str(c?.channel_type).toLowerCase() === channelType &&
        c?.is_active !== false &&
        (!accountNumber || str(c?.account_number) === str(accountNumber)),
    );
    if (match) return match;
    if (!payload?.pagination?.next_page) return null;
  }
  return null;
}

/** Creates (or reuses) the PayHero channel and stores it against the shop. */
async function ensurePayheroChannel(ctx, creds, tenant, { channelType, shortCode, accountNumber, description }) {
  if (!creds.configured) {
    return { error: "Card and M-Pesa collection is not set up on the platform yet. Contact support." };
  }
  if (!creds.accountId) {
    return { error: "The platform payment account number is missing. Add it in Admin, Settings, Payment Gateways." };
  }

  let channel = await findPayheroChannel(creds, { channelType, shortCode, accountNumber });

  if (!channel) {
    const body = {
      channel_type: channelType,
      account_id: Number(creds.accountId),
      short_code: str(shortCode),
      description: description || `${tenant.business_name || tenant.slug} - ${channelType}`,
    };
    if (accountNumber) body.account_number = str(accountNumber);

    const response = await fetch(`${PAYHERO_BASE}/payment_channels`, {
      method: "POST",
      headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        error:
          payload?.error_message ||
          payload?.message ||
          payload?.error ||
          "The payment network did not accept this number.",
        details: payload,
      };
    }
    channel = payload;
  }

  const payheroChannelId = str(channel?.id ?? channel?.channel_id ?? channel?.data?.id);
  if (!payheroChannelId) {
    return { error: "The payment network did not return a channel number.", details: channel };
  }

  // Keep exactly one default channel per shop.
  await db(`tenant_payout_channels?tenant_id=eq.${encodeURIComponent(tenant.id)}`, {
    method: "PATCH",
    body: { is_default: false },
    token: ctx.token,
  });

  const existingRow = await dbRow(
    `tenant_payout_channels?tenant_id=eq.${encodeURIComponent(tenant.id)}` +
      `&payhero_channel_id=eq.${encodeURIComponent(payheroChannelId)}&select=id&limit=1`,
    { token: ctx.token },
  );

  const row = {
    tenant_id: tenant.id,
    channel_type: channelType,
    short_code: str(shortCode),
    account_number: str(accountNumber),
    description: description || `${tenant.business_name || tenant.slug} - ${channelType}`,
    payhero_channel_id: payheroChannelId,
    is_default: true,
    is_active: true,
    registered_at: new Date().toISOString(),
  };

  const saved = existingRow?.id
    ? await db(`tenant_payout_channels?id=eq.${encodeURIComponent(existingRow.id)}`, {
        method: "PATCH",
        body: row,
        token: ctx.token,
        prefer: "return=representation",
      })
    : await db("tenant_payout_channels", {
        method: "POST",
        body: row,
        token: ctx.token,
        prefer: "return=representation",
      });

  if (!saved.ok) {
    return { error: "The number was linked but could not be saved. Try saving again.", details: saved.data };
  }

  return {
    channel: Array.isArray(saved.data) ? saved.data[0] : saved.data,
    payheroChannelId,
    channelType,
    shortCode: str(shortCode),
  };
}

// ---------------------------------------------------------------- API: routes

/** Links a shop's Till, Paybill or Bank account with the payment network. */
async function handleRegisterChannel(req, res, body) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });

  const channelType = str(body.channel_type).toLowerCase();
  const shortCode = str(body.short_code);
  const accountNumber = str(body.account_number);

  if (!["till", "paybill", "bank"].includes(channelType)) {
    return sendJson(res, 400, { error: "Choose Till, Paybill or Bank before saving." });
  }
  if (channelType !== "bank" && !/^\d{5,7}$/.test(shortCode)) {
    return sendJson(res, 400, { error: "The Till or Paybill number must be 5 to 7 digits." });
  }
  if (channelType === "bank" && !accountNumber) {
    return sendJson(res, 400, { error: "Enter the bank account number." });
  }

  const resolved = await resolveTenant(ctx, { tenantId: body.tenant_id, tenantSlug: body.tenant_slug });
  if (resolved.error) return sendJson(res, 400, { error: resolved.error });

  // Changing where the shop's money lands is an owner/manager decision.
  if (!(await canManagePayouts(ctx))) {
    return sendJson(res, 403, { error: "Only the shop owner or a manager can change the payout number." });
  }

  const creds = await payheroCredentials();
  const result = await ensurePayheroChannel(ctx, creds, resolved.tenant, {
    channelType,
    shortCode,
    accountNumber,
    description: str(body.description),
  });
  if (result.error) return sendJson(res, 200, { success: false, error: result.error, details: result.details });

  return sendJson(res, 200, {
    success: true,
    channel: result.channel,
    payhero_channel_id: result.payheroChannelId,
  });
}

/** Sends the customer an M-Pesa prompt for a sale. Money goes to the shop. */
async function handlePosStkPush(req, res, body) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  const rejectBeforePrompt = (status, error) => sendJson(res, status, { success: false, error, prompt_sent: false });

  const phone = normalizePhone(body.phone);
  if (!validPhone(phone)) {
    return rejectBeforePrompt(400, "That phone number is not valid. Use 07XXXXXXXX.");
  }

  const resolved = await resolveTenant(ctx, { tenantId: body.tenant_id, tenantSlug: body.tenant_slug });
  if (resolved.error) return rejectBeforePrompt(403, resolved.error);
  const tenant = resolved.tenant;
  const saleId = str(body.pos_transaction_id);
  if (!UUID.test(saleId)) return rejectBeforePrompt(400, "Invalid sale identifier.");

  // Everything the prompt needs is read at once so the STK leaves quickly.
  const [sale, settings, old, creds, linkedChannel] = await Promise.all([
    dbRow(`transactions?id=eq.${encodeURIComponent(saleId)}&select=id,tenant_id,total,status,payment_method&limit=1`, { token: ctx.token }),
    dbRow(
      `business_settings?tenant_id=eq.${encodeURIComponent(tenant.id)}` +
      `&select=payment_provider,mpesa_shortcode,mpesa_till_number,business_name,stk_label_mode,stk_label_override&limit=1`,
      { token: ctx.token },
    ),
    dbRow(`payhero_transactions?pos_transaction_id=eq.${encodeURIComponent(saleId)}&select=id,status,payhero_payment_id,external_reference&order=created_at.desc&limit=1`, { token: ctx.token }),
    payheroCredentials(),
    dbRow(
      `tenant_payout_channels?tenant_id=eq.${encodeURIComponent(tenant.id)}&is_active=eq.true` +
        `&is_default=eq.true&select=id,payhero_channel_id,channel_type,short_code&limit=1`,
      { token: ctx.token },
    ),
  ]);
  if (!sale || sale.tenant_id !== tenant.id || sale.payment_method !== "mpesa" || sale.status !== "pending") {
    return rejectBeforePrompt(409, "This sale is not eligible for an M-Pesa prompt.");
  }
  // The shop's saved gateway decides, not the till. A till that could not
  // read the setting (or runs an older cached build) still reaches JMSURF.
  if (str(settings?.payment_provider) === "jmsurf") {
    let started;
    try {
      started = await startSendMoneyPrompt(req, { tenant_id: tenant.id, pos_transaction_id: saleId, phone });
    } catch (error) {
      // The request may have reached M-Pesa; never mark the sale failed here.
      return sendJson(res, 200, {
        success: false,
        prompt_sent: null,
        error: str(error?.message) || "JMSURF did not confirm the prompt. Check this sale before charging again.",
      });
    }
    if (started?.error) return rejectBeforePrompt(started.status || 409, started.error);
    return sendJson(res, 200, { success: true, checkout_request_id: started.checkout_request_id, provider: "jmsurf", resumed: !!started.resumed });
  }
  // PayHero collects for shops settling to their Till/Paybill ("mpesa") or
  // to a bank account through PayHero ("bank").
  if (!["mpesa", "payhero", "bank"].includes(str(settings?.payment_provider))) {
    return rejectBeforePrompt(409, "This shop changed payment gateways. Refresh the POS before taking payment.");
  }
  const amount = Number(sale.total);
  if (!Number.isInteger(amount) || amount < 1 || amount > 150000 || Number(body.amount) !== amount) {
    return rejectBeforePrompt(422, "M-Pesa requires a whole-shilling amount between KES 1 and 150,000.");
  }
  if (old) {
    if (old.payhero_payment_id && ["initiating", "pending"].includes(old.status)) {
      return sendJson(res, 200, { success: true, checkout_request_id: old.payhero_payment_id, provider: "payhero", resumed: true });
    }
    return sendJson(res, 409, { success: false, error: "This sale already has a payment request. Check its status before charging again.", prompt_sent: null });
  }

  if (!creds.configured) {
    return sendJson(res, 200, {
      success: false,
      error: "M-Pesa collection is not set up on the platform yet. Contact support on 0712 504 593.",
      prompt_sent: false,
    });
  }

  // Use the linked channel, or link it now from the number saved in Settings.
  let channelRow = linkedChannel;

  if (!channelRow?.payhero_channel_id) {
    const till = str(settings?.mpesa_till_number);
    const paybill = str(settings?.mpesa_shortcode);
    const shortCode = till || paybill;
    if (!/^\d{5,7}$/.test(shortCode)) {
      return sendJson(res, 200, {
        success: false,
        error: "Your Till or Paybill number is not saved yet. Open Settings, Payment Gateways and save it.",
        prompt_sent: false,
      });
    }
    const repaired = await ensurePayheroChannel(ctx, creds, tenant, {
      channelType: till ? "till" : "paybill",
      shortCode,
      accountNumber: "",
      description: `${tenant.business_name || tenant.slug} - ${till ? "till" : "paybill"}`,
    });
    if (repaired.error) return rejectBeforePrompt(400, repaired.error);
    channelRow = {
      id: repaired.channel?.id || null,
      payhero_channel_id: repaired.payheroChannelId,
      channel_type: repaired.channelType,
      short_code: repaired.shortCode,
    };
  }

  const externalRef = `POS-${tenant.slug}-${saleId}`;
  const mode = str(settings?.stk_label_mode) || "tenant";
  const tenantName = labelSafe(tenant.business_name || settings?.business_name);
  const overrideName = labelSafe(settings?.stk_label_override);
  const merchantLabel =
    str(body.prompt_label) === "jmsurf" || mode === "jmsurf"
      ? "JMSURF TECHNOLOGIES"
      : mode === "custom"
        ? overrideName || tenantName || "JMSURF Garage"
        : tenantName || "JMSURF Garage";

  const channelId = Number(channelRow.payhero_channel_id);
  const payload = {
    amount,
    phone_number: phone,
    channel_id: Number.isFinite(channelId) ? channelId : channelRow.payhero_channel_id,
    provider: "m-pesa",
    external_reference: externalRef,
    customer_name: merchantLabel,
    account_reference: str(body.account_ref) || tenant.slug,
    callback_url: callbackUrl("/api/payments/payhero/callback", { ref: externalRef }),
  };

  let localId;
  try {
    const inserted = await dbRequired("payhero_transactions", {
      method: "POST",
      body: {
        tenant_id: tenant.id,
        pos_transaction_id: saleId,
        payout_channel_id: channelRow.id || null,
        external_reference: externalRef,
        amount,
        customer_phone: phone,
        status: "initiating",
      },
      prefer: "return=representation",
    });
    localId = inserted?.[0]?.id;
    if (!localId) throw new Error("Payment reservation was not saved");
  } catch (error) {
    console.error("[payments] could not reserve PayHero sale", saleId, error);
    return rejectBeforePrompt(503, "Could not reserve this payment safely. Check the sale before retrying.");
  }

  let response;
  let result = {};
  try {
    response = await fetch(`${PAYHERO_BASE}/payments`, {
      method: "POST",
      headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    result = await response.json().catch(() => ({}));
  } catch (error) {
    // The request may have reached M-Pesa. Keep the reservation; never send
    // another prompt automatically for the same sale.
    console.error("[payments] PayHero request outcome unknown", saleId, error);
    return sendJson(res, 503, {
      success: false,
      error: "Payment request outcome is unknown. Check this sale before charging again.",
      prompt_sent: null,
    });
  }

  if (!response.ok) {
    console.error("[payments] payhero stk failed", response.status, result);
    await dbRequired(`payhero_transactions?id=eq.${encodeURIComponent(localId)}`, {
      method: "PATCH", body: { status: "failed", result_desc: str(result?.message || result?.error || response.status).slice(0, 500) },
    });
    await dbRequired(`transactions?id=eq.${encodeURIComponent(saleId)}&status=eq.pending`, {
      method: "PATCH", body: { status: "failed", mpesa_error_message: str(result?.message || result?.error || "M-Pesa rejected the request").slice(0, 500) },
    });
    return sendJson(res, 200, {
      success: false,
      error: result?.error_message || result?.message || result?.error || "M-Pesa did not accept this payment.",
      details: result,
      prompt_sent: false,
    });
  }

  const paymentId = str(result?.reference || result?.id || result?.CheckoutRequestID);
  if (!paymentId) {
    console.error("[payments] PayHero did not return a transaction reference", saleId);
    return sendJson(res, 503, { success: false, prompt_sent: null,
      error: "M-Pesa did not confirm a request reference. Check this sale before charging again." });
  }
  await Promise.all([
    dbRequired(`payhero_transactions?id=eq.${encodeURIComponent(localId)}`, {
      method: "PATCH", body: { payhero_payment_id: paymentId, status: "pending" },
    }),
    dbRequired(`transactions?id=eq.${encodeURIComponent(saleId)}&status=eq.pending`, {
      method: "PATCH", body: { mpesa_ref: `payhero:${paymentId}` },
    }),
  ]);

  return sendJson(res, 200, {
    success: true,
    transaction_id: localId,
    checkout_request_id: paymentId || externalRef,
    external_reference: externalRef,
    provider: "payhero",
  });
}

function resolvePayheroStatus(raw) {
  const value = str(raw).toUpperCase();
  if (["SUCCESS", "COMPLETED", "PAID", "COMPLETE"].includes(value)) return "completed";
  if (["CANCELLED", "CANCELED", "USER_CANCELLED"].includes(value)) return "cancelled";
  if (["FAILED", "EXPIRED", "REJECTED", "TIMEOUT", "ERROR"].includes(value)) return "failed";
  return "pending";
}

/**
 * PayHero answers in several shapes. Look everywhere the outcome can hide —
 * nested objects and the Safaricom result code — so an approval or a
 * cancellation on the phone is recognised immediately.
 */
function resolveDeepStatus(payload) {
  const nodes = [
    payload,
    payload?.data,
    payload?.transaction,
    payload?.response,
    payload?.data?.transaction,
    payload?.data?.response,
  ].filter((n) => n && typeof n === "object");

  for (const node of nodes) {
    const direct = resolvePayheroStatus(node.status || node.Status || node.transaction_status);
    if (direct === "failed" && /cancel/i.test(str(node.message || node.result_desc || node.ResultDesc))) return "cancelled";
    if (direct !== "pending") return direct;
  }

  for (const node of nodes) {
    const codeRaw = node.ResultCode ?? node.result_code ?? node.resultCode;
    if (codeRaw === undefined || codeRaw === null || codeRaw === "") continue;
    const code = Number(codeRaw);
    if (!Number.isFinite(code)) continue;
    if (code === 0) return "completed";
    if (code === 1032) return "cancelled";
    return "failed";
  }

  return "pending";
}

function extractReceipt(payload) {
  const nodes = [payload, payload?.data, payload?.transaction, payload?.response, payload?.data?.transaction];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const ref =
      node.provider_reference ||
      node.third_party_reference ||
      node.MpesaReceiptNumber ||
      node.mpesa_receipt_number ||
      node.receipt ||
      null;
    if (ref) return ref;
  }
  return null;
}


async function verifyPayheroPayment(local, callbackReference = "") {
  const reference = str(local?.payhero_payment_id || callbackReference);
  if (!reference) return { resolved_status: "pending" };
  const creds = await payheroCredentials();
  if (!creds.configured) throw new Error("PayHero is not configured");
  const response = await fetch(
    `${PAYHERO_BASE}/transaction-status?reference=${encodeURIComponent(reference)}`,
    { headers: { Authorization: creds.authHeader }, signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new Error(`PayHero status request failed (${response.status})`);
  const payload = await response.json().catch(() => ({}));
  if (str(payload?.external_reference) !== str(local.external_reference)) {
    throw new Error("PayHero sale reference does not match");
  }
  if (!local.payhero_payment_id) {
    await dbRequired(`payhero_transactions?id=eq.${encodeURIComponent(local.id)}`, {
      method: "PATCH", body: { payhero_payment_id: reference, status: "pending" },
    });
  }
  const resolved = resolveDeepStatus(payload);
  if (resolved === "pending") return { resolved_status: "pending" };
  const receipt = str(extractReceipt(payload));
  if (resolved === "completed" && !receipt) return { resolved_status: "pending" };
  const reportedAmount = Number(payload?.amount ?? payload?.data?.amount ?? payload?.transaction?.amount);
  if (Number.isFinite(reportedAmount) && reportedAmount > 0 && reportedAmount !== Number(local.amount)) {
    throw new Error("PayHero amount does not match the sale");
  }
  const settled = await dbRequired("rpc/settle_payhero_payment", {
    method: "POST",
    body: {
      p_pos_transaction_id: local.pos_transaction_id,
      p_status: resolved,
      p_receipt: receipt || null,
      p_provider_status: payload,
    },
  });
  return { resolved_status: str(settled) || resolved, mpesa_receipt: receipt || null };
}

/** Check the saved sale's provider reference; never trust a browser-supplied reference. */
async function handlePosStatus(req, res, body) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  const saleId = str(body.pos_transaction_id);
  if (!UUID.test(saleId)) return sendJson(res, 400, { error: "Invalid sale identifier" });
  const [sale, local] = await Promise.all([
    dbRow(`transactions?id=eq.${encodeURIComponent(saleId)}&select=id,tenant_id,status&limit=1`),
    dbRow(`payhero_transactions?pos_transaction_id=eq.${encodeURIComponent(saleId)}&select=id,tenant_id,pos_transaction_id,payhero_payment_id,external_reference,amount,status,mpesa_receipt&order=created_at.desc&limit=1`),
  ]);
  if (!sale) return sendJson(res, 404, { error: "Sale not found" });
  const allowed = await resolveTenant(ctx, { tenantId: sale.tenant_id });
  if (allowed.error) return sendJson(res, 403, { error: allowed.error });
  if (!local || local.tenant_id !== sale.tenant_id) return sendJson(res, 404, { error: "PayHero payment record not found" });
  if (local.status === "completed" && sale.status === "completed") {
    return sendJson(res, 200, { resolved_status: "completed", mpesa_receipt: local.mpesa_receipt });
  }
  if (["failed", "cancelled"].includes(local.status) && sale.status === local.status) {
    return sendJson(res, 200, { resolved_status: local.status });
  }
  const result = await verifyPayheroPayment(local);
  return sendJson(res, 200, result);
}

/** A callback only triggers a fresh authenticated provider status check. */
async function handlePayheroCallback(req, res, body, query) {
  if (CALLBACK_TOKEN && query.get("token") !== CALLBACK_TOKEN) {
    return sendJson(res, 401, { ok: false });
  }
  const response = body?.response || body?.data || body || {};
  const reference = str(
    query.get("ref") || response.external_reference || response.ExternalReference || response.reference,
  );
  if (!reference) return sendJson(res, 200, { ok: true });

  const local = await dbRow(
    `payhero_transactions?or=(external_reference.eq.${encodeURIComponent(reference)},payhero_payment_id.eq.${encodeURIComponent(reference)})` +
      `&select=id,tenant_id,pos_transaction_id,payhero_payment_id,external_reference,amount,status,mpesa_receipt&order=created_at.desc&limit=1`,
  );
  if (local?.pos_transaction_id) await verifyPayheroPayment(local, str(response.reference || response.payment_reference));

  return sendJson(res, 200, { ok: true });
}

// ------------------------------------------------- Subscriptions via Daraja

function cycleMonths(cycle) {
  if (cycle === "quarterly") return 3;
  if (cycle === "semi_annually") return 6;
  if (cycle === "annually") return 12;
  return 1;
}

function priceFor(plan, cycle, businessType) {
  return planPrice(plan, cycle, businessType);
}

function periodEnd(cycle, from) {
  const base = from && new Date(from) > new Date() ? new Date(from) : new Date();
  base.setMonth(base.getMonth() + cycleMonths(cycle));
  return base.toISOString();
}

async function darajaToken(creds) {
  const baseUrl =
    creds.environment === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
  const basic = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  const payload = await response.json().catch(() => ({}));
  return { baseUrl, accessToken: payload?.access_token || "", status: response.status };
}

function darajaTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Asks Safaricom for the outcome of an STK request. Returns null when M-Pesa
 * cannot be reached; resultCode is "" while the prompt is still open.
 */
async function darajaQuery(creds, checkoutId) {
  const { baseUrl, accessToken } = await darajaToken(creds);
  if (!accessToken) return null;
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${creds.shortcode}${creds.passkey}${timestamp}`).toString("base64");
  try {
    const queryResponse = await fetch(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutId,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const queryBody = await queryResponse.json().catch(() => ({}));
    return { resultCode: str(queryBody?.ResultCode), resultDesc: str(queryBody?.ResultDesc) || null };
  } catch {
    return null;
  }
}

// ------------------------------------------ Platform billing (package fees)
//
// The platform owner picks ONE gateway in /admin (subscription_billing.provider)
// to collect package, domain and upgrade fees: JMSURF PAY, PayHero,
// Paystack or Daraja. Each payment is confirmed with the provider itself
// before a package is activated.

async function billingSettings() {
  const row = await dbRow("platform_settings?key=eq.subscription_billing&select=value&limit=1");
  return row?.value || {};
}

async function saveBillingSettings(value) {
  const existing = await dbRow("platform_settings?key=eq.subscription_billing&select=id&limit=1");
  if (existing?.id) {
    await dbRequired(`platform_settings?key=eq.subscription_billing`, { method: "PATCH", body: { value, updated_at: new Date().toISOString() } });
  } else {
    await dbRequired("platform_settings", { method: "POST", body: { key: "subscription_billing", value } });
  }
}

/** Currency rates against the US dollar (open exchange data, cached 6 h). */
let fxCache = { at: 0, rates: null, date: null };
export async function usdRates() {
  if (fxCache.rates && Date.now() - fxCache.at < 6 * 3600e3) return fxCache;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j?.result === "success" && j.rates?.KES) fxCache = { at: Date.now(), rates: j.rates, date: j.time_last_update_utc || null };
  } catch { /* keep the last rates */ }
  if (!fxCache.rates) {
    const billing = await billingSettings().catch(() => ({}));
    fxCache = { at: Date.now() - 5 * 3600e3, rates: { USD: 1, KES: Number(billing?.usd_rate) || 129 }, date: null };
  }
  return fxCache;
}
/** Companies outside Kenya pay their package in US dollars by card (Paystack). */
async function tenantCountry(tenantId) {
  const row = await dbRow(`business_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=country,currency&limit=1`);
  return { country: str(row?.country || "KE").toUpperCase(), currency: str(row?.currency || "KES").toUpperCase() };
}

/** Normalised collection gateway: jmsurf | payhero | paystack | daraja. */
function billingProvider(billing) {
  const p = str(billing?.provider).toLowerCase();
  if (p === "mpesa" || p === "bank" || p === "payhero") return "payhero";
  if (p === "jmsurf" || p === "paystack") return p;
  return "daraja";
}

async function platformPaystackSecret() {
  const settings = await paymentSettings();
  return pick(settings?.paystack?.secret_key, process.env.PAYSTACK_SECRET_KEY);
}

/** Sends the prompt / checkout for a package payment through the chosen gateway. */
async function startPlatformCollection(provider, billing, { tenant, phone, amount, plan, cycle, subscription, email, usd, lines = null }) {
  const ref = `SUB-${tenant.slug || "shop"}-${Date.now().toString(36)}`.slice(0, 40);
  const base = {
    tenant_id: tenant.id,
    subscription_id: subscription?.id || null,
    amount,
    status: "pending",
    phone,
    metadata: { plan_id: plan.id, plan_name: plan.name, cycle, type: "subscription", provider, ...(lines ? { lines } : {}), ...(usd ?{ currency: "USD", usd_amount: usd.amount, usd_rate: usd.rate } : {}) },
  };

  if (provider === "jmsurf") {
    const tenantCode = str(billing?.jmsurf?.tenant_code);
    if (!tenantCode) return { error: "JMSURF collection is not linked yet. Save the settlement account in Admin, Settings, Payment Gateways." };
    const { sendMoneyApi } = await import("./sendmoney.js");
    const result = await sendMoneyApi("/api/payments/stkpush", {
      method: "POST",
      body: { phoneNumber: phone, amount, accountReference: ref.slice(0, 12), transactionDesc: `${plan.name} package`, tenantCode },
    });
    const checkout = str(result?.checkoutRequestId);
    if (!checkout) return { error: "M-Pesa did not accept the payment request." };
    await db("subscription_payments", { method: "POST", body: { ...base, gateway: "jmsurf", reference: checkout } });
    return { ok: true, checkout_request_id: checkout, amount, plan: plan.name };
  }

  if (provider === "payhero") {
    const creds = await payheroCredentials();
    const channelId = pick(billing?.payhero?.channel_id, (await paymentSettings())?.payhero?.channel_id);
    if (!creds.configured || !channelId) return { error: "PayHero collection is not linked yet. Save the settlement account in Admin, Settings, Payment Gateways." };
    const response = await fetch(`${PAYHERO_BASE}/payments`, {
      method: "POST",
      headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount, phone_number: phone, channel_id: Number(channelId) || channelId, provider: "m-pesa",
        external_reference: ref, customer_name: "JMSURF TECHNOLOGIES",
        callback_url: callbackUrl("/api/payments/subscription/payhero-callback", { ref }),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    const paymentId = str(result?.reference || result?.id || result?.CheckoutRequestID);
    if (!response.ok || !paymentId) return { error: str(result?.error_message || result?.message) || "M-Pesa did not accept the payment request." };
    await db("subscription_payments", {
      method: "POST",
      body: { ...base, gateway: "payhero", reference: paymentId, metadata: { ...base.metadata, external_reference: ref } },
    });
    return { ok: true, checkout_request_id: paymentId, amount, plan: plan.name };
  }

  if (provider === "paystack") {
    const secret = await platformPaystackSecret();
    if (!/^sk_(live|test)_/.test(secret)) return { error: "Paystack is not set up yet. Add the secret key in Admin, Settings, Payment Gateways." };
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(email)) ? email : "billing@jmsurf.co.ke",
        amount: Math.round((usd ? usd.amount : amount) * 100), currency: usd ? "USD" : "KES", reference: ref,
        callback_url: `${SHOP_ORIGIN || APP_ORIGIN}/billing`,
        metadata: { tenant_id: tenant.id, plan_id: plan.id, cycle },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    const url = str(result?.data?.authorization_url);
    if (!response.ok || !url) return { error: str(result?.message) || "Paystack could not start the payment." };
    await db("subscription_payments", { method: "POST", body: { ...base, gateway: "paystack", reference: ref } });
    return { ok: true, checkout_request_id: ref, authorization_url: url, amount, plan: plan.name };
  }

  return { error: "Unknown payment gateway." };
}

/** Asks the gateway that took a package payment what happened to it. */
async function platformCollectionStatus(payment, billing) {
  const gateway = str(payment.gateway);
  if (gateway === "jmsurf") {
    const { sendMoneyApi } = await import("./sendmoney.js");
    const result = await sendMoneyApi(`/api/payments/status/${encodeURIComponent(payment.reference)}`);
    const s = str(result?.status).toLowerCase();
    if (s === "completed" && str(result?.mpesaReceiptNumber || result?.mpesaReceipt || result?.receipt)) return { status: "completed" };
    if (s === "failed" && (String(result?.resultCode) === "1032" || /cancel/i.test(str(result?.resultDesc)))) return { status: "cancelled", message: str(result?.resultDesc) };
    if (s === "failed" || s === "canceled" || s === "cancelled") return { status: s === "failed" ? "failed" : "cancelled", message: str(result?.resultDesc) };
    return { status: "pending" };
  }
  if (gateway === "payhero") {
    const creds = await payheroCredentials();
    const response = await fetch(`${PAYHERO_BASE}/transaction-status?reference=${encodeURIComponent(payment.reference)}`, {
      headers: { Authorization: creds.authHeader }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { status: "pending" };
    const payload = await response.json().catch(() => ({}));
    if (str(payload?.external_reference) && str(payload.external_reference) !== str(payment?.metadata?.external_reference)) return { status: "pending" };
    const resolved = resolveDeepStatus(payload);
    if (resolved === "completed" && !extractReceipt(payload)) return { status: "pending" };
    const paid = Number(payload?.amount);
    if (resolved === "completed" && Number.isFinite(paid) && paid > 0 && paid !== Number(payment.amount)) return { status: "pending" };
    return { status: resolved };
  }
  if (gateway === "paystack") {
    const secret = await platformPaystackSecret();
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    const data = payload?.data || {};
    const charged = payment?.metadata?.currency === "USD" ? Number(payment.metadata.usd_amount) : Number(payment.amount);
    if (data.status === "success" && Number(data.amount) === Math.round(charged * 100) && (!payment?.metadata?.currency || str(data.currency).toUpperCase() === payment.metadata.currency)) return { status: "completed" };
    if (["failed", "abandoned", "reversed"].includes(str(data.status))) return { status: "failed", message: str(data.gateway_response) };
    return { status: "pending" };
  }
  return null;
}

/**
 * Links the platform's own settlement account (owner only) for JMSURF or
 * PayHero collection and stores the result in subscription_billing.
 */
async function handlePlatformBillingRegister(req, res, body) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!(await isSuperAdmin(ctx.token, ctx.user.id))) return sendJson(res, 403, { error: "Only the platform owner can do this." });

  const provider = str(body.provider);
  const type = str(body.destination_type);
  const businessNumber = str(body.business_number);
  const accountNumber = str(body.account_number);
  const accountName = str(body.account_name);
  if (!["till", "paybill", "bank"].includes(type)) return sendJson(res, 400, { error: "Choose Till, Paybill or Bank." });
  if (type === "till" && !/^\d{5,7}$/.test(accountNumber)) return sendJson(res, 400, { error: "Enter a valid 5–7 digit Till." });
  if (type !== "till" && !/^\d{5,7}$/.test(businessNumber)) return sendJson(res, 400, { error: "Enter a valid 5–7 digit Paybill." });
  if (type !== "till" && !accountNumber) return sendJson(res, 400, { error: "Enter the account number." });

  const billing = await billingSettings();
  if (provider === "jmsurf") {
    const { sendMoneyApi } = await import("./sendmoney.js");
    const provisioned = await sendMoneyApi("/api/saas/provision-tenant", {
      method: "POST",
      body: {
        name: "JMSURF Technologies", description: "JMSURF Garage subscription fees", source: "jmsurf-garage", externalId: PLATFORM_EXTERNAL_ID,
        accountType: type === "till" ? "till" : "paybill", accountNumber, accountName: accountName || "JMSURF Technologies",
        ...(type === "till" ? {} : { businessNumber }),
      },
    });
    if (!/^tnnt_[A-Za-z0-9_-]+$/.test(str(provisioned?.tenantCode))) return sendJson(res, 502, { error: "JMSURF PAY did not confirm the settlement account." });
    await saveBillingSettings({
      ...billing, provider: "jmsurf",
      jmsurf: { tenant_code: provisioned.tenantCode, destination_type: type, business_number: businessNumber, account_number: accountNumber, account_name: accountName },
    });
    return sendJson(res, 200, { success: true });
  }
  if (provider === "payhero") {
    const creds = await payheroCredentials();
    if (!creds.configured || !creds.accountId) return sendJson(res, 400, { error: "Save the PayHero platform credentials first." });
    const channelType = type === "bank" ? "bank" : type;
    const shortCode = type === "till" ? accountNumber : businessNumber;
    let channel = await findPayheroChannel(creds, { channelType, shortCode, accountNumber: type === "till" ? "" : accountNumber });
    if (!channel) {
      const response = await fetch(`${PAYHERO_BASE}/payment_channels`, {
        method: "POST",
        headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_type: channelType, account_id: Number(creds.accountId), short_code: shortCode,
          description: "JMSURF Garage subscription fees", ...(type === "till" ? {} : { account_number: accountNumber }),
        }),
      });
      channel = await response.json().catch(() => ({}));
      if (!response.ok) return sendJson(res, 502, { error: str(channel?.error_message || channel?.message) || "PayHero did not accept this account." });
    }
    const channelId = str(channel?.id ?? channel?.channel_id ?? channel?.data?.id);
    if (!channelId) return sendJson(res, 502, { error: "PayHero did not return a channel number." });
    await saveBillingSettings({
      ...billing, provider: "payhero",
      payhero: { channel_id: channelId, destination_type: type, business_number: businessNumber, account_number: accountNumber, account_name: accountName },
    });
    return sendJson(res, 200, { success: true });
  }
  return sendJson(res, 400, { error: "Unknown gateway." });
}

/** PayHero's callback for package payments: re-checks the payment with PayHero. */
async function handleSubscriptionPayheroCallback(req, res, body, query) {
  if (CALLBACK_TOKEN && query.get("token") !== CALLBACK_TOKEN) return sendJson(res, 401, { ok: false });
  const ref = str(query.get("ref"));
  if (ref) {
    const payment = await dbRow(`subscription_payments?gateway=eq.payhero&status=eq.pending&metadata->>external_reference=eq.${encodeURIComponent(ref)}&select=*&limit=1`);
    if (payment) {
      const outcome = await platformCollectionStatus(payment, await billingSettings()).catch(() => null);
      if (outcome?.status === "completed") {
        const tenant = await dbRow(`tenants?id=eq.${encodeURIComponent(payment.tenant_id)}&select=id,slug,business_name&limit=1`);
        if (tenant) await activateSubscription({ token: "" }, tenant, payment);
      } else if (outcome && outcome.status !== "pending") {
        await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.pending`, { method: "PATCH", body: { status: outcome.status } });
      }
    }
  }
  return sendJson(res, 200, { ok: true });
}

/** What the platform collects with (owner only; no secrets). */
async function handlePlatformBillingInfo(req, res) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!(await isSuperAdmin(ctx.token, ctx.user.id))) return sendJson(res, 403, { error: "Only the platform owner can view this." });
  const billing = await billingSettings();
  const strip = (x) => (x ? { destination_type: x.destination_type, business_number: x.business_number, account_number: x.account_number, account_name: x.account_name, linked: true } : null);
  return sendJson(res, 200, { provider: billingProvider(billing), jmsurf: strip(billing.jmsurf), payhero: strip(billing.payhero) });
}

/** Starts or checks a package payment through the gateway chosen in /admin. */
async function handleSubscription(req, res, body) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });

  const resolved = await resolveTenant(ctx, { tenantId: body.tenant_id, tenantSlug: body.tenant_slug });
  if (resolved.error) return sendJson(res, 400, { error: resolved.error });
  const tenant = resolved.tenant;

  const creds = await darajaCredentials();
  const action = str(body.action) || "start";

  if (action === "start") {
    const where = await tenantCountry(tenant.id);
    const foreign = where.country !== "KE";
    const phone = normalizePhone(body.phone);
    if (!foreign && !validPhone(phone)) {
      return sendJson(res, 400, { error: "That phone number is not valid. Use 07XXXXXXXX." });
    }
    const billing = await billingSettings();
    const provider = foreign ? "paystack" : billingProvider(billing);
    if (provider === "daraja" && (!creds.consumerKey || !creds.consumerSecret || !creds.passkey || !creds.shortcode)) {
      return sendJson(res, 400, {
        error: "Package payments are not set up yet. Add the M-Pesa keys in Admin, Settings, Payment Gateways.",
      });
    }

    const plan = await dbRow(
      `plans?id=eq.${encodeURIComponent(str(body.plan_id))}&is_active=eq.true&select=*&limit=1`,
      { token: ctx.token },
    );
    if (!plan) return sendJson(res, 400, { error: "That package is not available." });

    const cycle = str(body.cycle) || "monthly";
    const subscription = await dbRow(
      `subscriptions?tenant_id=eq.${encodeURIComponent(tenant.id)}` +
        `&select=id,plan_id,price,current_period_end&order=created_at.desc&limit=1`,
      { token: ctx.token },
    );
    const mods = await billableModules(tenant.id, plan, ctx.token);
    const lines = subscriptionLines({ plan, cycle, businessType: tenant.business_type, subscription, mods });
    const amount = Math.max(1, linesTotal(lines));

    if (provider !== "daraja") {
      let usd = null;
      if (foreign) {
        const fx = await usdRates();
        const rate = Number(fx.rates.KES) || 129;
        usd = { amount: Math.max(1, Math.ceil((amount / rate) * 100) / 100), rate };
      }
      const started = await startPlatformCollection(provider, billing, {
        tenant, phone, amount, plan, cycle, subscription, email: ctx.user?.email, usd, lines,
      });
      return sendJson(res, started.error ? 400 : 200, started);
    }

    const { baseUrl, accessToken, status } = await darajaToken(creds);
    if (!accessToken) {
      return sendJson(res, 400, {
        error:
          status === 400 || status === 401
            ? "M-Pesa rejected the platform keys. Re-enter them in Admin, Settings, Payment Gateways."
            : "Could not reach M-Pesa just now. Please try again.",
      });
    }

    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${creds.shortcode}${creds.passkey}${timestamp}`).toString("base64");

    const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: creds.transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: creds.shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl("/api/payments/subscription/callback"),
        AccountReference: safeAccountReference(creds.accountReference, tenant.slug, "SUBSCRIPTION"),
        TransactionDesc: `${plan.name} package`,
      }),
    });
    const stk = await stkResponse.json().catch(() => ({}));
    const checkoutId = str(stk?.CheckoutRequestID);

    if (!stkResponse.ok || str(stk?.ResponseCode) !== "0" || !checkoutId) {
      return sendJson(res, 400, {
        error: stk?.errorMessage || stk?.ResponseDescription || "M-Pesa did not accept the payment request.",
      });
    }

    await db("subscription_payments", {
      method: "POST",
      body: {
        tenant_id: tenant.id,
        subscription_id: subscription?.id || null,
        amount,
        gateway: "mpesa",
        status: "pending",
        phone,
        reference: checkoutId,
        metadata: { plan_id: plan.id, plan_name: plan.name, cycle, type: "subscription", lines },
      },
      token: ctx.token,
    });

    return sendJson(res, 200, { ok: true, checkout_request_id: checkoutId, amount, plan: plan.name });
  }

  if (action === "status") {
    const checkoutId = str(body.checkout_request_id);
    if (!checkoutId) return sendJson(res, 400, { error: "The payment reference is missing." });

    const payment = await dbRow(
      `subscription_payments?reference=eq.${encodeURIComponent(checkoutId)}` +
        `&tenant_id=eq.${encodeURIComponent(tenant.id)}&select=*&order=created_at.desc&limit=1`,
      { token: ctx.token },
    );
    if (!payment) return sendJson(res, 400, { error: "That payment could not be found." });
    if (payment.status === "completed") return sendJson(res, 200, { status: "completed" });
    if (["failed", "cancelled"].includes(str(payment.status))) {
      return sendJson(res, 200, {
        status: payment.status,
        message: payment?.metadata?.result_desc || "The M-Pesa payment was not completed.",
      });
    }

    if (["jmsurf", "payhero", "paystack"].includes(str(payment.gateway))) {
      const outcome = await platformCollectionStatus(payment, await billingSettings()).catch(() => ({ status: "pending" }));
      if (outcome?.status === "completed") {
        const activated = await activateSubscription(ctx, tenant, payment);
        if (activated.error) return sendJson(res, 400, { error: activated.error });
        return sendJson(res, 200, { status: "completed", plan: activated.planName });
      }
      if (outcome && ["failed", "cancelled"].includes(outcome.status)) {
        await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.pending`, {
          method: "PATCH", body: { status: outcome.status, metadata: { ...(payment.metadata || {}), result_desc: outcome.message || null } },
        });
        return sendJson(res, 200, {
          status: outcome.status,
          message: outcome.status === "cancelled" ? "You cancelled the M-Pesa prompt on your phone." : outcome.message || "The payment was not completed.",
        });
      }
      return sendJson(res, 200, { status: "pending" });
    }

    const query = await darajaQuery(creds, checkoutId);
    if (!query) return sendJson(res, 200, { status: "pending" });
    const { resultCode, resultDesc } = query;

    // While the PIN prompt is still on the phone Safaricom answers with no
    // ResultCode at all (just a "being processed" errorCode). Any ResultCode
    // that comes back is final: 0 paid, 1032 cancelled, anything else failed.
    let status = "pending";
    if (resultCode === "0") status = "completed";
    else if (resultCode === "1032") status = "cancelled";
    else if (resultCode) status = "failed";

    const friendly = {
      "1": "There was not enough money in the M-Pesa account.",
      "1037": "The M-Pesa prompt was not answered in time. Please try again.",
      "1001": "An earlier M-Pesa prompt is still open on that phone. Close it or wait about a minute, then try again. No money was taken.",
      "4999": "An earlier M-Pesa prompt is still open on that phone. Close it or wait about a minute, then try again. No money was taken.",
      "2001": "The M-Pesa PIN entered was wrong. Please try again.",
    };

    if (status === "pending") {
      // Safaricom leaves abandoned prompts pending forever, so close them out ourselves.
      const startedAt = Date.parse(payment.created_at || "");
      if (Number.isFinite(startedAt) && Date.now() - startedAt > 150000) {
        await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}`, {
          method: "PATCH",
          body: {
            status: "failed",
            metadata: { ...(payment.metadata || {}), result_code: resultCode || "timeout", result_desc: resultDesc },
          },
          token: ctx.token,
        });
        return sendJson(res, 200, {
          status: "failed",
          message: "The M-Pesa prompt expired. Please try again.",
        });
      }
      return sendJson(res, 200, { status: "pending" });
    }

    if (status !== "completed") {
      await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: {
          status,
          metadata: { ...(payment.metadata || {}), result_code: resultCode, result_desc: resultDesc },
        },
        token: ctx.token,
      });
      return sendJson(res, 200, {
        status,
        message:
          status === "cancelled"
            ? "You cancelled the M-Pesa prompt on your phone."
            : friendly[resultCode] || resultDesc || "The M-Pesa payment was not completed.",
      });
    }

    const activated = await activateSubscription(ctx, tenant, payment);
    if (activated.error) return sendJson(res, 400, { error: activated.error });
    return sendJson(res, 200, { status: "completed", plan: activated.planName });
  }

  return sendJson(res, 400, { error: "Unknown request." });
}

/** Turns a completed package payment into an active subscription. */
async function activateSubscription(ctx, tenant, payment) {
  const meta = payment.metadata || {};
  const cycle = str(meta.cycle) || "monthly";
  const plan = await dbRow(`plans?id=eq.${encodeURIComponent(str(meta.plan_id))}&select=*&limit=1`, {
    token: ctx.token,
  });
  if (!plan) return { error: "That package no longer exists." };

  const subscription = await dbRow(
    `subscriptions?tenant_id=eq.${encodeURIComponent(tenant.id)}` +
      `&select=id,plan_id,price,max_users,max_locations,current_period_end&order=created_at.desc&limit=1`,
    { token: ctx.token },
  );

  const samePlan = subscription?.plan_id === plan.id;
  const existingMonthly = Number(subscription?.price);
  const existingUsers = Number(subscription?.max_users);
  const existingLocations = Number(subscription?.max_locations);

  const fields = {
    plan_id: plan.id,
    plan_name: plan.name,
    billing_cycle: cycle,
    max_users: samePlan && Number.isFinite(existingUsers) ? existingUsers : plan.max_users,
    max_locations:
      samePlan && Number.isFinite(existingLocations) ? existingLocations : plan.max_locations,
    price:
      samePlan && Number.isFinite(existingMonthly) && existingMonthly >= 0
        ? existingMonthly
        : Number(plan.price_monthly),
    status: "active",
    trial_ends_at: null,
    current_period_start: new Date().toISOString(),
    current_period_end: periodEnd(cycle, subscription?.current_period_end),
  };

  if (subscription?.id) {
    await db(`subscriptions?id=eq.${encodeURIComponent(subscription.id)}`, {
      method: "PATCH",
      body: fields,
      token: ctx.token,
    });
  } else {
    await db("subscriptions", { method: "POST", body: { tenant_id: tenant.id, ...fields }, token: ctx.token });
  }
  // The modules paid for with this renewal run until the same date.
  const paidModules = await billableModules(tenant.id, plan, ctx.token);
  for (const m of paidModules) {
    await db(`tenant_modules?tenant_id=eq.${encodeURIComponent(tenant.id)}&module_key=eq.${encodeURIComponent(m.module_key)}`, {
      method: "PATCH", body: { status: "active", current_period_end: fields.current_period_end, updated_at: new Date().toISOString() }, token: ctx.token,
    }).catch((e) => console.error("[billing] module renew failed", m.module_key, e?.message));
  }

  await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}`, {
    method: "PATCH",
    body: { status: "completed" },
    token: ctx.token,
  });

  // The paid subscription invoice (one line per item), signed with KRA by the platform's own company.
  await issueSubscriptionInvoice(tenant, payment, plan, cycle, paidModules).catch((e) => console.error("[billing] subscription invoice", payment.id, e?.message));

  return { planName: plan.name };
}

/**
 * Subscription invoice: when PLATFORM_BILLING_TENANT_ID names JMSURF TECHNOLOGIES' own company in
 * this database, every paid renewal becomes a paid invoice there, listing the package, each module,
 * extra branches, pro-rata charges and SMS as separate lines (prices include 16% VAT), and is signed
 * with KRA eTIMS through that company's connection. Once per payment (metadata.invoice_id).
 */
async function issueSubscriptionInvoice(tenant, payment, plan, cycle, mods) {
  const issuer = str(process.env.PLATFORM_BILLING_TENANT_ID);
  if (!UUID.test(issuer) || payment?.metadata?.invoice_id) return null;
  const meta = payment.metadata || {};
  const sub = await dbRow(`subscriptions?tenant_id=eq.${encodeURIComponent(tenant.id)}&select=plan_id,price&order=created_at.desc&limit=1`);
  let lines = Array.isArray(meta.lines) && meta.lines.length ? meta.lines
    : subscriptionLines({ plan, cycle, businessType: tenant.business_type, subscription: sub, mods });
  // The invoice must equal what was paid: any difference (rounding, older payments) goes on the package line.
  const paid = Number(payment.amount) || linesTotal(lines);
  const diff = Math.round((paid - lines.reduce((a, l) => a + Number(l.amount || 0), 0)) * 100) / 100;
  if (diff) lines = lines.map((l, i) => (i === 0 ? { ...l, rate: l.rate + diff, amount: l.amount + diff } : l));
  const bs = await dbRow(`business_settings?tenant_id=eq.${encodeURIComponent(tenant.id)}&select=business_name,business_email,business_phone,tax_pin&limit=1`);
  const name = str(bs?.business_name || tenant.business_name) || tenant.slug;
  let cust = await dbRow(`customers?tenant_id=eq.${issuer}&name=eq.${encodeURIComponent(name)}&select=id&limit=1`);
  if (!cust) {
    const made = await dbRequired("customers", { method: "POST", prefer: "return=representation", body: { tenant_id: issuer, name, phone: str(bs?.business_phone), email: str(bs?.business_email) || null, ...(str(bs?.tax_pin) ? { kra_pin: str(bs.tax_pin).toUpperCase() } : {}) } });
    cust = made?.[0];
  }
  const today = new Date().toISOString().slice(0, 10);
  const number = (await dbRequired("rpc/next_doc_number", { method: "POST", body: { p_kind: "invoice", p_tenant: issuer } }).catch(() => null)) || `SUB-${Date.now().toString(36).toUpperCase()}`;
  const total = Math.round(lines.reduce((a, l) => a + Number(l.amount), 0) * 100) / 100;
  const subtotal = Math.round((total / 1.16) * 100) / 100;
  const items = lines.map((l) => ({ name: l.name, description: l.kind === "plan" ? `JMSURF Garage${tenant.business_name ? ` · ${tenant.business_name}` : ""}` : "", quantity: Number(l.quantity) || 1, rate: Number(l.rate), price: Number(l.rate), amount: Number(l.amount), tax_rate: 16 }));
  const [inv] = await dbRequired("invoices", { method: "POST", prefer: "return=representation", body: {
    tenant_id: issuer, invoice_number: number, customer_id: cust?.id || null, customer_name: name, customer_email: str(bs?.business_email) || null,
    items, subtotal, tax: Math.round((total - subtotal) * 100) / 100, discount: 0, total, prices_include_tax: true, status: "sent", source: "subscription",
    issue_date: today, due_date: today, notes: `JMSURF Garage subscription, ${str(plan.name)} (${cycle.replace("_", " ")}). Paid: ${str(payment.reference)}`,
  } });
  if (!inv?.id) return null;
  const payNo = await dbRequired("rpc/next_doc_number", { method: "POST", body: { p_kind: "payment", p_tenant: issuer } }).catch(() => null);
  const [pr] = await dbRequired("payments_received", { method: "POST", prefer: "return=representation", body: {
    tenant_id: issuer, payment_number: payNo || `PAY-${Date.now().toString(36).toUpperCase()}`, customer_id: cust?.id || null, customer_name: name, payment_date: today,
    amount: total, method: payment.gateway === "paystack" ? "card" : "mpesa", reference: str(payment.reference).slice(0, 80), notes: `Subscription ${number}`, received_by_name: "JMSURF Garage billing",
  } });
  if (pr?.id) await db("payment_allocations", { method: "POST", body: { tenant_id: issuer, payment_id: pr.id, invoice_id: inv.id, amount: total } });
  await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}`, { method: "PATCH", body: { metadata: { ...meta, lines, invoice_id: inv.id, invoice_number: number } } });
  const { signDocument } = await import("./etims.js");
  await signDocument(issuer, "invoice", inv.id).catch(() => null); // not connected / KRA slow: the eTIMS job retries
  return inv.id;
}

/** Safaricom calls this when a package payment finishes. */
async function handleSubscriptionCallback(req, res, body, query) {
  if (CALLBACK_TOKEN && query.get("token") !== CALLBACK_TOKEN) {
    return sendJson(res, 401, { ok: false });
  }
  try {
    const callback = body?.Body?.stkCallback || {};
    const checkoutId = str(callback.CheckoutRequestID);
    if (!checkoutId) return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });

    const payment = await dbRow(
      `subscription_payments?reference=eq.${encodeURIComponent(checkoutId)}&select=*&order=created_at.desc&limit=1`,
    );
    if (!payment || payment.status === "completed") {
      return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }

    // Anyone can reach this address, so the callback body is only a hint:
    // the outcome is always taken from Safaricom itself.
    const confirmed = await darajaQuery(await darajaCredentials(), checkoutId);
    const resultCode = str(confirmed?.resultCode);
    if (!resultCode) {
      // Not final yet (or M-Pesa unreachable); the status check will finish it.
      return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }

    if (resultCode !== "0") {
      await db(`subscription_payments?id=eq.${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: {
          status: resultCode === "1032" ? "cancelled" : "failed",
          metadata: {
            ...(payment.metadata || {}),
            result_code: resultCode,
            result_desc: confirmed?.resultDesc || null,
          },
        },
      });
      return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }

    const tenant = await dbRow(
      `tenants?id=eq.${encodeURIComponent(payment.tenant_id)}&select=id,slug,business_name&limit=1`,
    );
    if (tenant) await activateSubscription({ token: "" }, tenant, payment);
  } catch (error) {
    console.error("[payments] subscription callback failed", error);
  }
  return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
}

/** Lets the admin portal confirm the payment settings the server can see. */
async function handleDiagnostics(req, res) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error });
  if (!(await isSuperAdmin(ctx.token, ctx.user.id))) {
    return sendJson(res, 403, { error: "Only the platform owner can view this." });
  }
  invalidateSettingsCache();
  const payhero = await payheroCredentials();
  const daraja = await darajaCredentials();

  let payheroReachable = false;
  if (payhero.configured) {
    try {
      const response = await fetch(`${PAYHERO_BASE}/payment_channels?page=1`, {
        headers: { Authorization: payhero.authHeader },
      });
      payheroReachable = response.ok;
    } catch {
      payheroReachable = false;
    }
  }

  return sendJson(res, 200, {
    ok: true,
    service_key_present: Boolean(SERVICE_KEY),
    public_origin: PUBLIC_ORIGIN,
    payhero: {
      configured: payhero.configured,
      account_id_present: Boolean(payhero.accountId),
      reachable: payheroReachable,
    },
    subscriptions_mpesa: {
      keys_present: Boolean(daraja.consumerKey && daraja.consumerSecret && daraja.passkey),
      shortcode: daraja.shortcode || null,
      environment: daraja.environment,
    },
  });
}

const BUILTIN_BANKS = [
  { name: "Equity Bank", paybill: "247247" },
  { name: "KCB Bank", paybill: "522522" },
  { name: "Co-operative Bank", paybill: "400200" },
  { name: "Absa Bank", paybill: "303030" },
  { name: "NCBA Bank", paybill: "880100" },
  { name: "Stanbic Bank", paybill: "600100" },
  { name: "DTB Bank", paybill: "516600" },
  { name: "Family Bank", paybill: "222111" },
  { name: "I&M Bank", paybill: "542542" },
  { name: "Standard Chartered", paybill: "329329" },
  { name: "Gulf African Bank", paybill: "985050" },
  { name: "Sidian Bank", paybill: "111999" },
  { name: "Rafiki Micro Finance", paybill: "802200" },
  { name: "Citi Bank", paybill: "100229" },
];

/** Bank paybill list for the payout destination picker. */
async function handleBanks(req, res) {
  const ctx = await authenticate(req);
  if (ctx.error) return sendJson(res, ctx.status, { error: ctx.error, banks: BUILTIN_BANKS });

  const creds = await payheroCredentials();
  let live = [];
  if (creds.configured) {
    try {
      const response = await fetch(`${PAYHERO_BASE}/bank_paybills`, {
        headers: { Authorization: creds.authHeader, "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      const rows = payload?.bank_paybills || payload?.data || [];
      if (response.ok && Array.isArray(rows)) {
        live = rows
          .map((b) => ({ id: str(b?.id), name: str(b?.name), paybill: str(b?.paybill) }))
          .filter((b) => b.name && b.paybill);
      }
    } catch {
      live = [];
    }
  }

  const byName = new Map();
  for (const b of BUILTIN_BANKS) byName.set(b.name.toLowerCase(), { id: b.paybill, ...b });
  for (const b of live) byName.set(b.name.toLowerCase(), b);
  const banks = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return sendJson(res, 200, { banks, source: live.length ? "payhero" : "builtin" });
}

// ------------------------------------------------------------------- routing

let sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
};

export function configurePayments({ sendJson: sender }) {
  if (sender) sendJson = sender;
}

export function startPayheroReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const recent = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const rows = await dbRequired(
        `payhero_transactions?status=in.(initiating,pending)&created_at=gte.${encodeURIComponent(recent)}` +
        `&pos_transaction_id=not.is.null&select=id,tenant_id,pos_transaction_id,payhero_payment_id,external_reference,amount,status,mpesa_receipt` +
        `&order=created_at.desc&limit=30`,
      );
      for (const local of rows || []) {
        try { await verifyPayheroPayment(local); }
        catch (error) { console.error("[payments] PayHero reconciliation failed", local.id, error); }
      }
    } catch (error) { console.error("[payments] PayHero reconciliation batch failed", error); }
    finally { busy = false; }
  }, 10000).unref();
}

const PUBLIC_ROUTES = new Set([
  "/api/payments/payhero/callback",
  "/api/payments/subscription/callback",
]);

export function isPaymentsRoute(pathname) {
  return pathname.startsWith("/api/payments/");
}

export async function handlePaymentsRequest(req, res, pathname, search, body) {
  const query = new URLSearchParams(search || "");

  try {
    switch (pathname) {
      case "/api/payments/payhero/register-channel":
        return await handleRegisterChannel(req, res, body);
      case "/api/payments/payhero/stk-push":
        return await handlePosStkPush(req, res, body);
      case "/api/payments/payhero/status":
        return await handlePosStatus(req, res, body);
      case "/api/payments/payhero/callback":
        return await handlePayheroCallback(req, res, body, query);
      case "/api/payments/subscription":
        return await handleSubscription(req, res, body);
      case "/api/payments/fx": {
        const fx = await usdRates();
        return sendJson(res, 200, { base: "USD", rates: fx.rates, date: fx.date });
      }
      case "/api/payments/subscription/callback":
        return await handleSubscriptionCallback(req, res, body, query);
      case "/api/payments/subscription/payhero-callback":
        return await handleSubscriptionPayheroCallback(req, res, body, query);
      case "/api/payments/platform/register":
        return await handlePlatformBillingRegister(req, res, body);
      case "/api/payments/platform/billing":
        return await handlePlatformBillingInfo(req, res);
      case "/api/payments/payhero/banks":
        return await handleBanks(req, res);
      case "/api/payments/diagnostics":
        return await handleDiagnostics(req, res);
      default:
        return sendJson(res, 404, { error: "Unknown payment route" });
    }
  } catch (error) {
    console.error("[payments] route failed", pathname, error);
    return sendJson(res, 500, { error: "The payment service hit a problem. Please try again." });
  }
}

export { PUBLIC_ROUTES };

// Used by hub.js for package payments through the extra gateways.
export { activateSubscription, priceFor, cycleMonths };
