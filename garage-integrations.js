// ---------------------------------------------------------------------------
// JMSURF Garage server area: integrations. Mounted by garage.js under /api/garage/i/.
// handle(req, res, subpath, { sendJson, readJsonBody }) answers one request; startJobs() starts background jobs.
//
// Company (signed-in staff; "manager" = admin or manager):
//   POST status                       every connection with its state (M-Pesa, SMS, WhatsApp, eTIMS, Call Centre)
//   POST daraja/save        manager   own Daraja app: type, shortcode, till, environment, keys (encrypted)
//   POST daraja/test        manager   checks the keys with Safaricom (nothing is charged)
//   POST daraja/register-c2b manager  registers the paybill / till confirmation address
//   POST c2b/apply          manager   { id, invoice_id } applies an unmatched paybill payment
//   POST pay/invoice                  { invoice_id, phone, amount? } M-Pesa prompt (JMSURF PAY or own Daraja)
//   POST pay/status                   { request_id }
//   POST whatsapp/connect   manager   WhatsApp Cloud API number (phone number id, WABA id, token, app secret)
//   POST whatsapp/disconnect manager
//   POST whatsapp/send                { conversation_id | phone, text } session message (template outside 24 h)
//   POST whatsapp/template            { conversation_id, name, lang?, params[] }
//   POST whatsapp/read                { conversation_id } marks the thread read
//   POST whatsapp/context             { conversation_id } customer, vehicles, open jobs and invoices
//   POST whatsapp/link                { conversation_id, kind: invoice|estimate|tracking, id?, url? } sends a link
//   GET  whatsapp/media?id=           an inbound photo / document (staff only)
//   POST callcentre/open              mirrors the company + this user into the Call Centre, returns the sign-in link
//   POST callcentre/settings manager  { missed_sms, missed_text, rotate_key }
//   POST callcentre/callback          { id, done } or { phone, note } (add)
// Public (signed or tokened):
//   POST c2b/<token>/validate | confirm   Safaricom C2B (own paybill / till)
//   POST pay/webhook                      JMSURF PAY event, X-Webhook-Signature (HMAC-SHA256)
//   GET/POST whatsapp/webhook[?c=<company>]  Meta verify + inbound, X-Hub-Signature-256
//   GET  callcentre/lookup?phone=         screen pop (Call Centre key)
//   POST callcentre/missed                missed call → callback task (+ SMS)
// Platform owner (super admin address):
//   POST platform/status | platform/save | platform/test
//
// Helpers for the other areas (see docs/garage-integrations.md):
//   requestInvoicePayment, invoicePaymentStatus, sendCustomerMessage, customerContext,
//   waSendForCompany, waCloudConnected, signDocument (re-exported from etims.js)
// ---------------------------------------------------------------------------
import {
  credential, credentialSource, setSavedCredentials, PLATFORM_CREDENTIALS, encryptSecret, decryptSecret,
  payWebhookValid, whatsappSignatureValid, randomToken, sha256, kenyaMsisdn, internationalPhone, phoneVariants,
  maskPhone, matchInvoiceRef, ipInRanges, SAFARICOM_RANGES, clientIp, darajaUrlAllowed, secretsKey,
} from "./integrations-core.js";
import { createHmac } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY || "";
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://garage.jmsurf.co.ke").replace(/\/+$/, "");
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;
const CC_APP = (process.env.CALLCENTRE_APP_URL || "https://app.jmsurfcallcentre.co.ke").replace(/\/+$/, "");
const MAIL_URL = (process.env.JMSURF_MAIL_URL || "https://api.jmsurfmail.co.ke").replace(/\/+$/, "");
const STAFF_ROLES = ["admin", "manager", "cashier", "stock_manager", "sales_person", "rider", "packaging", "mechanic", "service_advisor", "technician"];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ------------------------------------------------------------------ database

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(503, "The server is not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" && data?.message ? data.message : `Database replied ${res.status}`);
  return data;
}
const rows = async (path) => { const d = await db(path); return Array.isArray(d) ? d : []; };
const one = async (path) => (await rows(path))[0] || null;
const inList = (values) => `(${values.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",")})`;

async function caller(req) {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(401, "Sign in first");
  const user = await r.json().catch(() => null);
  if (!UUID.test(str(user?.id))) throw new HttpError(401, "Sign in first");
  const [profile, roleRows] = await Promise.all([
    one(`profiles?user_id=eq.${user.id}&select=tenant_id,display_name&limit=1`),
    rows(`user_roles?user_id=eq.${user.id}&select=role`),
  ]);
  const { withPlatformRole } = await import("./platform.js");
  const roles = await withPlatformRole(roleRows.map((x) => str(x.role)), user.id, req);
  return {
    user, roles, tenantId: profile?.tenant_id || null, name: str(profile?.display_name) || str(user.email),
    manager: roles.some((x) => ["admin", "manager"].includes(x)), admin: roles.includes("admin"), superAdmin: roles.includes("super_admin"),
  };
}
async function staff(req) {
  const who = await caller(req);
  if (!who.tenantId) throw new HttpError(403, "This login is not linked to a company");
  return who;
}
async function manager(req) {
  const who = await staff(req);
  if (!who.manager) throw new HttpError(403, "Only the company owner or a manager can change connections");
  return who;
}

// ------------------------------------------------------------------ per-company secrets and connection row

/** Saves a company key encrypted ("enc:v1:…"); an empty value removes it. */
export async function saveCompanySecret(tenantId, name, value, userId = null) {
  if (!str(value)) return db(`integration_secrets?tenant_id=eq.${tenantId}&name=eq.${enc(name)}`, { method: "DELETE", prefer: "return=minimal" });
  return db("integration_secrets?on_conflict=tenant_id,name", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { tenant_id: tenantId, name, value: encryptSecret(str(value)), updated_by: userId, updated_at: new Date().toISOString() },
  });
}
export async function readCompanySecret(tenantId, name) {
  const r = await one(`integration_secrets?tenant_id=eq.${tenantId}&name=eq.${enc(name)}&select=value&limit=1`).catch(() => null);
  return decryptSecret(r?.value || "");
}
async function secretNames(tenantId) {
  return new Set((await rows(`integration_secrets?tenant_id=eq.${tenantId}&select=name`).catch(() => [])).map((r) => r.name));
}

async function connection(tenantId) {
  const row = await one(`garage_connections?tenant_id=eq.${tenantId}&select=*`).catch(() => null);
  if (row) return row;
  await db("garage_connections?on_conflict=tenant_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { tenant_id: tenantId } }).catch(() => {});
  return (await one(`garage_connections?tenant_id=eq.${tenantId}&select=*`).catch(() => null)) || { tenant_id: tenantId };
}
const patchConnection = (tenantId, patch) =>
  db(`garage_connections?tenant_id=eq.${tenantId}`, { method: "PATCH", prefer: "return=minimal", body: { ...patch, updated_at: new Date().toISOString() } });

async function readRaw(req, max = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, "Too large"); chunks.push(c); }
  return Buffer.concat(chunks);
}
const parseJson = (buf) => { try { return JSON.parse(buf.toString("utf8") || "{}"); } catch { return {}; } };

// ------------------------------------------------------------------ platform credentials (super admin)

const PLATFORM_KEY = "garage_integrations";
async function loadPlatformCredentials() {
  const row = await one(`platform_settings?key=eq.${PLATFORM_KEY}&select=value&limit=1`).catch(() => null);
  const saved = row?.value?.creds || {};
  const plain = {};
  for (const [k, v] of Object.entries(saved)) if (PLATFORM_CREDENTIALS[k]) plain[k] = decryptSecret(v);
  setSavedCredentials(plain);
  return row?.value || {};
}

async function platformStatus() {
  const value = await loadPlatformCredentials();
  const list = Object.entries(PLATFORM_CREDENTIALS).map(([name, d]) => ({
    name, label: d.label, issuer: d.issuer, secret: d.secret, source: credentialSource(name),
    // Non-secret values (IDs, URLs, sender) may be shown; secrets never leave the server.
    value: d.secret ? null : credential(name) || null,
  }));
  const billing = await one("platform_settings?key=eq.subscription_billing&select=value&limit=1").catch(() => null);
  return {
    credentials: list,
    encryption: process.env.GARAGE_SECRETS_KEY ? "GARAGE_SECRETS_KEY" : "derived from the database service key",
    pay_platform: billing?.value?.jmsurf ? { linked: true, destination_type: billing.value.jmsurf.destination_type, account_number: billing.value.jmsurf.account_number, business_number: billing.value.jmsurf.business_number } : { linked: false },
    urls: platformUrls(),
    saved_at: value?.updated_at || null,
  };
}

function platformUrls() {
  return {
    pay_webhook: `${PUBLIC_ORIGIN}/api/garage/i/pay/webhook`,
    whatsapp_webhook: `${PUBLIC_ORIGIN}/api/garage/i/whatsapp/webhook`,
    callcentre_lookup: `${PUBLIC_ORIGIN}/api/garage/i/callcentre/lookup?phone=`,
    callcentre_missed: `${PUBLIC_ORIGIN}/api/garage/i/callcentre/missed`,
    daraja_c2b_example: `${PUBLIC_ORIGIN}/api/garage/i/c2b/<company token>/confirm`,
  };
}

async function platformSave(who, b) {
  const values = b?.values && typeof b.values === "object" ? b.values : {};
  const row = await one(`platform_settings?key=eq.${PLATFORM_KEY}&select=id,value&limit=1`).catch(() => null);
  const creds = { ...(row?.value?.creds || {}) };
  for (const [name, raw] of Object.entries(values)) {
    if (!PLATFORM_CREDENTIALS[name]) continue;
    const v = str(raw);
    if (v === "") delete creds[name];
    else creds[name] = encryptSecret(v);
  }
  const value = { ...(row?.value || {}), creds, updated_at: new Date().toISOString(), updated_by: who.user.id };
  if (row?.id) await db(`platform_settings?key=eq.${PLATFORM_KEY}`, { method: "PATCH", prefer: "return=minimal", body: { value, updated_at: new Date().toISOString() } });
  else await db("platform_settings", { method: "POST", prefer: "return=minimal", body: { key: PLATFORM_KEY, value } });
  return platformStatus();
}

async function platformTest(b) {
  await loadPlatformCredentials();
  const what = str(b.what);
  const to = str(b.to);
  try {
    if (what === "pay") {
      const key = credential("JMSURFPAY_API_KEY");
      if (!key) return { ok: false, error: "Enter the JMSURF PAY API key first" };
      const billing = await one("platform_settings?key=eq.subscription_billing&select=value&limit=1").catch(() => null);
      const code = str(billing?.value?.jmsurf?.tenant_code);
      const { sendMoneyApi } = await import("./sendmoney.js");
      if (!code) return { ok: true, message: "Key saved. Link the platform settlement account (Payments tab) to finish." };
      const t = await sendMoneyApi(`/api/saas/tenant/${enc(code)}`);
      return t?.isActive === false ? { ok: false, error: "JMSURF PAY says the platform settlement account is inactive" } : { ok: true, message: "JMSURF PAY accepted the key; the platform settlement account is active." };
    }
    if (what === "sms") {
      const key = credential("JMSURF_SMS_API_KEY");
      if (!key) return { ok: false, error: "Enter the JMSURF SMS API key first" };
      const { jmsBalance, jmsSend } = await import("./jmsurfsms.js");
      const bal = await jmsBalance(key);
      if (!bal.ok) return { ok: false, error: bal.error };
      if (!to) return { ok: true, message: `JMSURF SMS accepted the key. Balance: ${bal.sms_remaining ?? "?"} SMS.` };
      const phone = kenyaMsisdn(to);
      if (!phone) return { ok: false, error: "Enter a Kenyan mobile number for the test" };
      const r = await jmsSend(key, phone, "JMSURF Garage: platform SMS test. SMS is working.", credential("JMSURF_SMS_SENDER") || undefined);
      return r.ok ? { ok: true, message: `Test SMS sent to ${maskPhone(phone)}.` } : { ok: false, error: r.error };
    }
    if (what === "mail") {
      const key = credential("JMSURF_MAIL_KEY");
      if (!key) return { ok: false, error: "Enter the JMSURF MAIL API key first" };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "Enter the email address to send the test to" };
      const from = process.env.JMSURF_MAIL_FROM || "JMSURF Garage <noreply@jmsurf.co.ke>";
      const r = await fetch(`${MAIL_URL}/api/v1/emails`, {
        method: "POST", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: "JMSURF Garage: mail test", text: "This test came through JMSURF MAIL. Platform email is working.", tags: ["garage"] }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, message: `JMSURF MAIL accepted the test (id ${j?.id || "?"}).` } : { ok: false, error: str(j?.error?.message || j?.error || j?.message) || `JMSURF MAIL replied ${r.status}` };
    }
    if (what === "whatsapp") {
      if (!waPlatformConfigured()) return { ok: false, error: "Enter the platform phone number ID and token first" };
      const info = await graph(`/${credential("WHATSAPP_PHONE_NUMBER_ID")}?fields=display_phone_number,verified_name,quality_rating`, { token: credential("WHATSAPP_TOKEN") });
      if (!to) return { ok: true, message: `Meta knows this number: ${info.display_phone_number} (${info.verified_name || "name pending"}).` };
      const r = await waSendPlatform(internationalPhone(to), "JMSURF Garage: platform WhatsApp test.");
      return r.ok ? { ok: true, message: "Test sent (it only arrives if that number wrote to you in the last 24 hours)." } : r;
    }
    if (what === "etims") {
      const key = credential("ETIMS_PARTNER_KEY");
      if (!key) return { ok: false, error: "Enter the JMSURF TAX partner key first" };
      const r = await fetch(`${(process.env.ETIMS_HUB_URL || "https://etims.jmsurf.co.ke").replace(/\/+$/, "")}/partner/v1/tenants?limit=1`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      return r.ok ? { ok: true, message: "The eTIMS hub accepted the partner key." } : { ok: false, error: `The eTIMS hub replied ${r.status}` };
    }
    if (what === "callcentre") {
      const cc = ccConfig();
      if (!cc.ready) return { ok: false, error: "Enter the Call Centre database URL and service key first" };
      const r = await ccRest("tenants?select=id&limit=1");
      return Array.isArray(r) ? { ok: true, message: "Reached the Call Centre database." } : { ok: false, error: "The Call Centre database did not answer" };
    }
    if (what === "daraja") {
      const keys = { consumerKey: credential("MPESA_CONSUMER_KEY"), consumerSecret: credential("MPESA_CONSUMER_SECRET") };
      if (!keys.consumerKey || !keys.consumerSecret) return { ok: false, error: "Enter the platform consumer key and secret first" };
      const base = credential("MPESA_ENVIRONMENT") === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
      const r = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${Buffer.from(`${keys.consumerKey}:${keys.consumerSecret}`).toString("base64")}` }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      return j?.access_token ? { ok: true, message: "Safaricom accepted the platform Daraja keys." } : { ok: false, error: "Safaricom did not accept the platform consumer key and secret" };
    }
    return { ok: false, error: "Unknown test" };
  } catch (e) {
    return { ok: false, error: str(e?.message) || "The test failed" };
  }
}

// ------------------------------------------------------------------ status (company → System → Connections)

async function companyStatus(who) {
  const t = who.tenantId;
  const [bs, conn, names, smsRow, pay] = await Promise.all([
    one(`business_settings?tenant_id=eq.${t}&select=payment_provider,mpesa_shortcode,mpesa_till_number,mpesa_environment,mpesa_transaction_type,mpesa_account_reference&limit=1`).catch(() => null),
    connection(t),
    secretNames(t),
    one(`tenant_messaging?tenant_id=eq.${t}&select=sms_mode,sms_sender_id,wa_mode&limit=1`).catch(() => null),
    one(`sendmoney_tenants?tenant_id=eq.${t}&select=destination_type,business_number,account_number,account_name&limit=1`).catch(() => null),
  ]);
  const { etimsConnected } = await import("./etims.js");
  const etims = await etimsConnected(t).catch(() => ({ connected: false }));
  const darajaKeysSaved = names.has("daraja_consumer_key") && names.has("daraja_consumer_secret") && names.has("daraja_passkey");
  const isTill = str(bs?.mpesa_transaction_type) === "CustomerBuyGoodsOnline" || (!!str(bs?.mpesa_till_number) && !str(bs?.mpesa_shortcode));
  const c2bToken = conn.daraja_c2b_token || "";
  const unmatched = await rows(`garage_mpesa_c2b?tenant_id=eq.${t}&status=in.(unmatched,review)&select=id`).catch(() => []);
  const openCallbacks = await rows(`garage_callbacks?tenant_id=eq.${t}&status=eq.open&select=id`).catch(() => []);
  return {
    mpesa: {
      provider: str(bs?.payment_provider) || "jmsurf",
      jmsurf: pay ? { connected: true, ...pay } : { connected: false },
      daraja: {
        connected: str(bs?.payment_provider) === "daraja" && darajaKeysSaved,
        keys_saved: darajaKeysSaved,
        type: isTill ? "till" : "paybill",
        shortcode: str(bs?.mpesa_shortcode) || null,
        till_number: str(bs?.mpesa_till_number) || null,
        environment: str(bs?.mpesa_environment) === "sandbox" ? "sandbox" : "live",
        account_reference: str(bs?.mpesa_account_reference) || null,
        c2b_registered_at: conn.daraja_c2b_registered_at || null,
        c2b_note: conn.daraja_c2b_note || null,
        c2b_validation: conn.daraja_c2b_validation || "all",
        c2b_urls: c2bToken ? c2bUrls(c2bToken) : null,
        b2c_enabled: false,
      },
      unmatched_payments: unmatched.length,
    },
    sms: {
      jmsurf_key_saved: names.has("jmsurf_sms_key"),
      platform_available: !!credential("JMSURF_SMS_API_KEY"),
      mode: smsRow?.sms_mode || "off",
      sender_id: smsRow?.sms_sender_id || null,
    },
    whatsapp: {
      cloud: {
        connected: !!(conn.wa_enabled && conn.wa_phone_number_id && names.has("wa_cloud_token")),
        phone_number_id: conn.wa_phone_number_id || null, waba_id: conn.wa_waba_id || null, display_phone: conn.wa_display_phone || null,
        token_saved: names.has("wa_cloud_token"), app_secret_saved: names.has("wa_cloud_app_secret"),
        default_template: conn.wa_default_template || null, template_lang: conn.wa_template_lang || "en",
        webhook_url: `${PUBLIC_ORIGIN}/api/garage/i/whatsapp/webhook?c=${t}`,
        verify_token: who.manager ? waVerifyToken(t) : null,
      },
      apiwap_mode: smsRow?.wa_mode || "off",
    },
    etims,
    callcentre: {
      available: ccConfig().ready,
      linked: !!conn.cc_tenant_id, linked_at: conn.cc_linked_at || null,
      missed_sms: conn.cc_missed_sms !== false, missed_text: conn.cc_missed_text || null,
      lookup_key_set: !!conn.cc_lookup_key_hash,
      open_callbacks: openCallbacks.length,
      lookup_url: `${PUBLIC_ORIGIN}/api/garage/i/callcentre/lookup?phone=`,
      missed_url: `${PUBLIC_ORIGIN}/api/garage/i/callcentre/missed`,
    },
  };
}

// ------------------------------------------------------------------ Daraja (own app) + C2B

const c2bUrls = (token) => ({
  confirm: `${PUBLIC_ORIGIN}/api/garage/i/c2b/${token}/confirm`,
  validate: `${PUBLIC_ORIGIN}/api/garage/i/c2b/${token}/validate`,
});

async function darajaSave(who, b) {
  const t = who.tenantId;
  const type = str(b.type) === "till" ? "till" : "paybill";
  const shortcode = str(b.shortcode).replace(/\D/g, "");
  const till = str(b.till_number).replace(/\D/g, "");
  const environment = str(b.environment) === "sandbox" ? "sandbox" : "live";
  if (type === "paybill" && !/^\d{5,7}$/.test(shortcode)) throw new HttpError(400, "Enter your 5 to 7 digit paybill number");
  if (type === "till" && !/^\d{5,7}$/.test(till)) throw new HttpError(400, "Enter your 5 to 7 digit till number");
  if (type === "till" && shortcode && !/^\d{5,7}$/.test(shortcode)) throw new HttpError(400, "The store (head office) number has 5 to 7 digits");
  const names = await secretNames(t);
  for (const [field, name, label] of [["consumer_key", "daraja_consumer_key", "consumer key"], ["consumer_secret", "daraja_consumer_secret", "consumer secret"], ["passkey", "daraja_passkey", "passkey"]]) {
    if (!str(b[field]) && !names.has(name)) throw new HttpError(400, `Enter the Daraja ${label}`);
  }
  if (str(b.passkey) && str(b.passkey).length < 32) throw new HttpError(400, "That passkey looks too short. Daraja passkeys are usually 64 characters.");
  if (str(b.consumer_key)) await saveCompanySecret(t, "daraja_consumer_key", b.consumer_key, who.user.id);
  if (str(b.consumer_secret)) await saveCompanySecret(t, "daraja_consumer_secret", b.consumer_secret, who.user.id);
  if (str(b.passkey)) await saveCompanySecret(t, "daraja_passkey", b.passkey, who.user.id);
  const patch = {
    mpesa_shortcode: type === "paybill" ? shortcode : (shortcode || null),
    mpesa_till_number: type === "till" ? till : "",
    mpesa_environment: environment,
    mpesa_transaction_type: type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    mpesa_account_reference: type === "paybill" ? str(b.account_reference).replace(/[^A-Za-z0-9]/g, "").slice(0, 12) : "",
    use_platform_mpesa: false,
    // Keys never stay in business_settings (staff screens read that table).
    mpesa_consumer_key: "", mpesa_consumer_secret: "", mpesa_passkey: "",
    ...(b.activate === false ? {} : { payment_provider: "daraja" }),
    updated_by: who.user.id,
  };
  const existing = await one(`business_settings?tenant_id=eq.${t}&select=id&limit=1`);
  if (existing) await db(`business_settings?id=eq.${existing.id}`, { method: "PATCH", prefer: "return=minimal", body: patch });
  else await db("business_settings", { method: "POST", prefer: "return=minimal", body: { tenant_id: t, business_name: "My Company", ...patch } });
  const { darajaCheckKeys } = await import("./gateways.js");
  const check = await darajaCheckKeys(t).catch((e) => ({ ok: false, error: e.message }));
  return { ok: true, keys_ok: check.ok, check_error: check.ok ? null : check.error };
}

async function darajaRegister(who, b) {
  const t = who.tenantId;
  const conn = await connection(t);
  const token = conn.daraja_c2b_token || randomToken(16);
  const urls = c2bUrls(token);
  if (!darajaUrlAllowed(urls.confirm)) throw new HttpError(500, "The server address cannot be registered with Safaricom");
  const { darajaRegisterC2b } = await import("./gateways.js");
  const r = await darajaRegisterC2b(t, { confirmUrl: urls.confirm, validateUrl: urls.validate });
  const validation = str(b?.validation) === "strict" ? "strict" : (conn.daraja_c2b_validation || "all");
  if (r.ok) {
    await patchConnection(t, { daraja_c2b_token: token, daraja_c2b_shortcode: r.shortcode, daraja_c2b_type: r.type, daraja_c2b_registered_at: new Date().toISOString(), daraja_c2b_note: null, daraja_c2b_validation: validation });
    return { ok: true, message: r.description, urls };
  }
  // "Already registered": Safaricom answers this too when ANOTHER system's addresses are on the shortcode.
  const note = r.already
    ? `Safaricom already has payment addresses on ${r.shortcode}. If they are not these, ask Safaricom M-Pesa API support to remove the registered URLs, then register again.`
    : `Safaricom did not register the address: ${r.description}`;
  await patchConnection(t, { daraja_c2b_token: token, daraja_c2b_shortcode: r.shortcode, daraja_c2b_type: r.type, daraja_c2b_note: note, daraja_c2b_validation: validation });
  return { ok: false, error: note, urls };
}

/** Safaricom C2B validation: strict companies refuse account numbers that are not open invoices. */
async function c2bValidate(token, p) {
  const accept = { ResultCode: 0, ResultDesc: "Accepted" };
  try {
    const conn = await one(`garage_connections?daraja_c2b_token=eq.${enc(token)}&select=tenant_id,daraja_c2b_validation,daraja_c2b_type`);
    if (!conn || conn.daraja_c2b_validation !== "strict" || conn.daraja_c2b_type === "till") return accept;
    const invoices = await rows(`invoices?tenant_id=eq.${conn.tenant_id}&status=not.in.(draft,void,paid)&select=id,invoice_number,total,amount_paid,status&order=created_at.desc&limit=1000`);
    return matchInvoiceRef(p?.BillRefNumber, invoices) ? accept : { ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" };
  } catch { return accept; } // our own fault must never turn a customer's payment away
}

/** Safaricom C2B confirmation: recorded once by transaction id, then matched to an invoice. */
export async function c2bReceive(token, p, { ip = "", force = false } = {}) {
  const conn = await one(`garage_connections?daraja_c2b_token=eq.${enc(token)}&select=tenant_id`).catch(() => null);
  if (!conn) return { status: "unknown_token" };
  const t = conn.tenant_id;
  const trans = str(p?.TransID).replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  const amount = Math.round(Number(p?.TransAmount || 0) * 100) / 100;
  if (!trans || !(amount > 0)) return { status: "ignored" };
  const bs = await one(`business_settings?tenant_id=eq.${t}&select=mpesa_environment&limit=1`).catch(() => null);
  const ranges = str(process.env.DARAJA_TRUSTED_IPS) ? str(process.env.DARAJA_TRUSTED_IPS).split(/[\s,]+/) : SAFARICOM_RANGES;
  const trusted = force || str(bs?.mpesa_environment) === "sandbox" || ipInRanges(ip, ranges);
  const tt = str(p?.TransTime);
  const time = /^\d{14}$/.test(tt) ? new Date(Date.UTC(+tt.slice(0, 4), +tt.slice(4, 6) - 1, +tt.slice(6, 8), +tt.slice(8, 10) - 3, +tt.slice(10, 12), +tt.slice(12, 14))).toISOString() : new Date().toISOString();
  const inserted = await db("garage_mpesa_c2b?on_conflict=tenant_id,trans_id", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: {
      tenant_id: t, trans_id: trans, amount, account_ref: str(p?.BillRefNumber).slice(0, 60) || null, msisdn: str(p?.MSISDN).slice(0, 40) || null,
      payer_name: [p?.FirstName, p?.MiddleName, p?.LastName].map(str).filter(Boolean).join(" ").slice(0, 120) || null,
      shortcode: str(p?.BusinessShortCode).slice(0, 20) || null, trans_time: time, trusted,
      status: trusted ? "received" : "review", note: trusted ? null : `Not sent from Safaricom's addresses (${ip || "unknown"}): check your M-Pesa statement for ${trans} before applying it.`,
      raw: p || {},
    },
  });
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (!row) return { status: "duplicate" };
  if (!trusted) return { status: "review" };
  return matchC2b(row);
}

async function matchC2b(row, invoiceId = null) {
  let target = invoiceId;
  if (!target) {
    const invoices = await rows(`invoices?tenant_id=eq.${row.tenant_id}&status=not.in.(draft,void,paid)&select=id,invoice_number,total,amount_paid,status&order=created_at.desc&limit=1000`).catch(() => []);
    target = matchInvoiceRef(row.account_ref, invoices)?.id || null;
  }
  if (!target) {
    // A till / POS sale paid through a Daraja prompt is announced here too: it is already recorded on the sale.
    const since = new Date(Date.parse(row.trans_time || row.created_at || new Date().toISOString()) - 15 * 60_000).toISOString();
    const sale = await one(`transactions?tenant_id=eq.${row.tenant_id}&payment_method=eq.mpesa&mpesa_ref=like.daraja:*&total=eq.${Number(row.amount)}&created_at=gte.${enc(since)}&select=id&order=created_at.desc&limit=1`).catch(() => null);
    if (sale) {
      await db(`garage_mpesa_c2b?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "matched", note: "Paid at the till through the M-Pesa prompt" } });
      return { status: "matched", sale_id: sale.id };
    }
    const note = row.account_ref ? `No open invoice ${row.account_ref} was found. Apply it to the right invoice.` : "No account number was entered. Apply it to the right invoice.";
    await db(`garage_mpesa_c2b?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "unmatched", note } });
    await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: row.tenant_id, kind: "payment", title: "Paybill payment to match", role: "admin",
      body: `${row.payer_name || "A customer"} paid KES ${row.amount} (${row.trans_id}). ${note}`, link: "/settings?tab=connections",
    } }).catch(() => {});
    return { status: "unmatched" };
  }
  try {
    await db("rpc/garage_settle_c2b", { method: "POST", body: { p_c2b: row.id, p_invoice: target } });
    return { status: "matched", invoice_id: target };
  } catch (e) {
    await db(`garage_mpesa_c2b?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", note: str(e.message).slice(0, 240) } }).catch(() => {});
    return { status: "failed" };
  }
}

async function c2bApply(who, b) {
  if (!UUID.test(str(b.id)) || !UUID.test(str(b.invoice_id))) throw new HttpError(400, "Choose the payment and the invoice");
  const row = await one(`garage_mpesa_c2b?id=eq.${b.id}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!row) throw new HttpError(404, "Payment not found");
  if (row.status === "matched") return { ok: true, status: "matched" };
  const inv = await one(`invoices?id=eq.${b.invoice_id}&tenant_id=eq.${who.tenantId}&select=id`);
  if (!inv) throw new HttpError(404, "Invoice not found");
  const r = await matchC2b(row, inv.id);
  return { ok: r.status === "matched", ...r };
}

// ------------------------------------------------------------------ invoice payment helpers (used by other areas)

/**
 * M-Pesa prompt for an invoice, whichever gateway the company uses (JMSURF PAY or its own Daraja).
 * Returns { success, request_id } or { error, status }. requestedBy: "staff" | "portal" | "link" | …
 */
export async function requestInvoicePayment({ tenantId, invoiceId, phone, amount, requestedBy = "staff" }) {
  const { pushInvoiceForShop } = await import("./sendmoney.js");
  try { return await pushInvoiceForShop(tenantId, invoiceId, phone, amount, requestedBy); }
  catch (e) { return { error: str(e?.message) || "M-Pesa is not available right now", status: 503 }; }
}
/** { status: initiating|pending|completed|failed|cancelled|unknown, mpesa_receipt, amount } */
export async function invoicePaymentStatus(tenantId, requestId) {
  if (!UUID.test(str(requestId))) return { status: "unknown" };
  const { invoicePromptStatus } = await import("./sendmoney.js");
  return invoicePromptStatus(tenantId, requestId);
}
/** The invoice's public payment link (made when missing), or null for draft / void invoices. */
export async function invoicePayLink(tenantId, invoiceId) {
  const { payLinkUrl } = await import("./paylinks.js");
  return payLinkUrl(tenantId, invoiceId);
}
/**
 * Sends one SMS or WhatsApp to a customer for a company (the company's "What uses SMS" choices apply;
 * WhatsApp goes through the company's Cloud API number when connected, else APIWAP).
 * event: job_status | estimate | payment_request | service_reminder | booking | missed_call | manual …
 */
export async function sendCustomerMessage({ tenantId, channel = "sms", to, text, event = "manual", userId = null, reference }) {
  const { sendForShop } = await import("./messaging.js");
  return sendForShop({ tenantId, channel: channel === "whatsapp" ? "whatsapp" : "sms", to, text, userId, reference, event });
}
/** Signs an invoice / credit note with KRA now (see etims.js). */
export async function signDocument(tenantId, kind, id) {
  const m = await import("./etims.js");
  return m.signDocument(tenantId, kind, id);
}

// ------------------------------------------------------------------ JMSURF PAY webhook

async function payWebhook(req, raw) {
  const secret = credential("SENDMONEY_WEBHOOK_SECRET") || str(process.env.PAYMENT_CALLBACK_TOKEN);
  if (!secret) throw new HttpError(503, "Webhook secret is not set");
  if (!payWebhookValid(raw, req.headers, secret)) throw new HttpError(401, "Bad signature");
  const p = parseJson(raw);
  const d = p?.data && typeof p.data === "object" ? p.data : p;
  const checkout = str(d?.checkoutRequestId || d?.CheckoutRequestID || d?.checkout_request_id || d?.reference);
  if (!checkout) return { ok: true, ignored: true };
  const { settleFromWebhook } = await import("./sendmoney.js");
  const r = await settleFromWebhook(checkout).catch((e) => ({ error: e.message }));
  return { ok: true, matched: r?.matched || false };
}

// ------------------------------------------------------------------ WhatsApp Cloud API

/** Per-company verify token for the Meta webhook (derived, so nothing more to store). */
function waVerifyToken(tenantId) {
  const key = secretsKey();
  return key ? createHmac("sha256", key).update(`wa-verify:${tenantId}`).digest("hex").slice(0, 32) : "";
}

async function graph(path, { token, method = "GET", body } = {}) {
  const r = await fetch(`${GRAPH}${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new HttpError(r.status === 401 ? 400 : 502, str(j?.error?.error_user_msg || j?.error?.message) || `Meta replied ${r.status}`);
    e.code = j?.error?.code;
    throw e;
  }
  return j;
}

const waCache = new Map();
/** The company's Cloud API connection { phoneNumberId, token, appSecret, template, lang } or null (cached 60 s). */
async function waCompany(tenantId) {
  const hit = waCache.get(tenantId);
  if (hit && hit.until > Date.now()) return hit.value;
  const conn = await one(`garage_connections?tenant_id=eq.${tenantId}&select=wa_enabled,wa_phone_number_id,wa_default_template,wa_template_lang`).catch(() => null);
  let value = null;
  if (conn?.wa_enabled && conn.wa_phone_number_id) {
    const token = await readCompanySecret(tenantId, "wa_cloud_token");
    if (token) value = { phoneNumberId: conn.wa_phone_number_id, token, template: str(conn.wa_default_template), lang: str(conn.wa_template_lang) || "en" };
  }
  waCache.set(tenantId, { value, until: Date.now() + 60_000 });
  return value;
}
export async function waCloudConnected(tenantId) { return !!(await waCompany(tenantId)); }
export function waPlatformConfigured() { return !!(credential("WHATSAPP_PHONE_NUMBER_ID") && credential("WHATSAPP_TOKEN")); }

/** Template parameters may not hold new lines or long runs of spaces. */
const templateParam = (text) => str(text).replace(/\s*\n+\s*/g, " · ").replace(/\s{4,}/g, "   ").slice(0, 1000);

async function conversationFor(tenantId, phone, { name = null } = {}) {
  let conv = await one(`garage_wa_conversations?tenant_id=eq.${tenantId}&phone=eq.${phone}&select=*`).catch(() => null);
  if (conv) return conv;
  const variants = phoneVariants(phone);
  const cust = variants.length ? await one(`customers?tenant_id=eq.${tenantId}&phone=in.${enc(inList(variants))}&select=id,name&limit=1`).catch(() => null) : null;
  await db("garage_wa_conversations?on_conflict=tenant_id,phone", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
    body: { tenant_id: tenantId, phone, display_name: cust?.name || name || null, customer_id: cust?.id || null },
  }).catch(() => {});
  return one(`garage_wa_conversations?tenant_id=eq.${tenantId}&phone=eq.${phone}&select=*`);
}

async function recordMessage(tenantId, conv, m) {
  const now = new Date().toISOString();
  await db("garage_wa_messages", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, conversation_id: conv.id, ...m } }).catch((e) => {
    if (!/duplicate|unique/i.test(e.message)) throw e;
  });
  const preview = str(m.body || (m.kind !== "text" ? `[${m.kind}]` : "")).slice(0, 140);
  const patch = m.direction === "in"
    ? { last_message_at: now, last_inbound_at: now, last_preview: preview, unread: Number(conv.unread || 0) + 1, status: "open" }
    : { last_message_at: now, last_preview: preview };
  await db(`garage_wa_conversations?id=eq.${conv.id}`, { method: "PATCH", prefer: "return=minimal", body: patch }).catch(() => {});
}

/**
 * Sends a WhatsApp message from the company's Cloud API number and keeps it in the inbox.
 * Inside the 24-hour window: a normal message. Outside: the company's default template with the
 * text as its one parameter; with no template it answers { ok:false, windowClosed:true }.
 */
export async function waSendForCompany(tenantId, phoneRaw, text, { userId = null, template = null, lang = null, params = null } = {}) {
  const wa = await waCompany(tenantId);
  if (!wa) return { ok: false, error: "WhatsApp Cloud API is not connected" };
  const phone = internationalPhone(phoneRaw);
  if (!phone) return { ok: false, error: "Enter a valid phone number" };
  const conv = await conversationFor(tenantId, phone);
  const open = conv?.last_inbound_at && Date.now() - Date.parse(conv.last_inbound_at) < 24 * 3600_000;
  const tpl = template || (!open ? wa.template : "");
  if (!open && !tpl) return { ok: false, windowClosed: true, error: "This customer has not written in the last 24 hours. Set a WhatsApp template in System → Connections to message them first." };
  const body = tpl
    ? { messaging_product: "whatsapp", to: phone, type: "template", template: { name: tpl, language: { code: lang || wa.lang || "en" }, components: [{ type: "body", parameters: (params || [text]).map((x) => ({ type: "text", text: templateParam(x) })) }] } }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: phone, type: "text", text: { preview_url: true, body: str(text).slice(0, 4096) } };
  try {
    const r = await graph(`/${wa.phoneNumberId}/messages`, { token: wa.token, method: "POST", body });
    const id = str(r?.messages?.[0]?.id);
    if (conv) await recordMessage(tenantId, conv, { direction: "out", wa_message_id: id || null, kind: tpl ? "template" : "text", body: str(text), template_name: tpl || null, status: "sent", via: "cloud", sent_by: userId });
    return { ok: true, id, template: tpl || null, conversation_id: conv?.id || null };
  } catch (e) {
    if (conv) await recordMessage(tenantId, conv, { direction: "out", kind: tpl ? "template" : "text", body: str(text), template_name: tpl || null, status: "failed", error: str(e.message).slice(0, 300), via: "cloud", sent_by: userId }).catch(() => {});
    // 131047: re-engagement message (outside the window) — a template is needed.
    return { ok: false, error: str(e.message), windowClosed: e.code === 131047 };
  }
}

/** Platform notices from JMSURF's own WhatsApp Cloud API number (session text). */
export async function waSendPlatform(phone, text) {
  if (!waPlatformConfigured() || !phone) return { ok: false, error: "The platform WhatsApp number is not set" };
  try {
    const r = await graph(`/${credential("WHATSAPP_PHONE_NUMBER_ID")}/messages`, { token: credential("WHATSAPP_TOKEN"), method: "POST", body: { messaging_product: "whatsapp", to: phone, type: "text", text: { body: str(text).slice(0, 4096) } } });
    return { ok: true, id: str(r?.messages?.[0]?.id) };
  } catch (e) { return { ok: false, error: str(e.message) }; }
}

async function waConnect(who, b) {
  const t = who.tenantId;
  const phoneNumberId = str(b.phone_number_id).replace(/\D/g, "");
  const waba = str(b.waba_id).replace(/\D/g, "");
  if (!/^\d{6,30}$/.test(phoneNumberId)) throw new HttpError(400, "Enter the phone number ID from Meta (WhatsApp → API setup)");
  const token = str(b.token) || await readCompanySecret(t, "wa_cloud_token");
  if (!token) throw new HttpError(400, "Enter the permanent access token (a system user token from Meta Business settings)");
  const other = await one(`garage_connections?wa_phone_number_id=eq.${phoneNumberId}&tenant_id=neq.${t}&select=tenant_id`).catch(() => null);
  if (other) throw new HttpError(409, "This WhatsApp number is already connected to another company");
  const info = await graph(`/${phoneNumberId}?fields=display_phone_number,verified_name`, { token });
  if (str(b.token)) await saveCompanySecret(t, "wa_cloud_token", b.token, who.user.id);
  if (str(b.app_secret)) await saveCompanySecret(t, "wa_cloud_app_secret", b.app_secret, who.user.id);
  const tpl = str(b.default_template).replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 120);
  await connection(t);
  await patchConnection(t, {
    wa_phone_number_id: phoneNumberId, wa_waba_id: waba || null, wa_display_phone: str(info?.display_phone_number) || null, wa_enabled: true,
    wa_default_template: tpl || null, wa_template_lang: str(b.template_lang).replace(/[^A-Za-z_]/g, "").slice(0, 10) || "en", wa_connected_at: new Date().toISOString(),
  });
  // Subscribe the app to the business account so inbound messages reach the webhook.
  if (waba) await graph(`/${waba}/subscribed_apps`, { token, method: "POST" }).catch(() => null);
  waCache.delete(t);
  return { ok: true, display_phone: info?.display_phone_number || null, verified_name: info?.verified_name || null };
}

async function waDisconnect(who) {
  await patchConnection(who.tenantId, { wa_enabled: false });
  await saveCompanySecret(who.tenantId, "wa_cloud_token", "");
  await saveCompanySecret(who.tenantId, "wa_cloud_app_secret", "");
  waCache.delete(who.tenantId);
  return { ok: true };
}

/** Meta webhook verification (GET): hub.verify_token must be the company's (or the platform's). */
function waVerify(query) {
  const mode = query.get("hub.mode"), token = str(query.get("hub.verify_token")), challenge = str(query.get("hub.challenge"));
  const c = str(query.get("c"));
  const expected = UUID.test(c) ? waVerifyToken(c) : credential("WHATSAPP_VERIFY_TOKEN");
  if (mode === "subscribe" && expected && token === expected && /^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return challenge;
  return null;
}

/** Meta webhook (POST): inbound messages and delivery statuses. The signature is checked before anything is stored. */
async function waInbound(query, raw, signature) {
  const p = parseJson(raw);
  const c = str(query.get("c"));
  const entries = Array.isArray(p?.entry) ? p.entry : [];
  for (const entry of entries) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {};
      const pnid = str(v?.metadata?.phone_number_id);
      if (!pnid) continue;
      const conn = await one(`garage_connections?wa_phone_number_id=eq.${enc(pnid)}&wa_enabled=is.true&select=tenant_id`).catch(() => null);
      if (!conn) continue;
      const t = conn.tenant_id;
      // The company's own Meta app (?c=<company>), else the platform's app.
      const secret = UUID.test(c) ? (c === t ? await readCompanySecret(t, "wa_cloud_app_secret") : "") : credential("WHATSAPP_APP_SECRET");
      if (!secret || !whatsappSignatureValid(raw, signature, secret)) { console.warn("[garage/wa] bad signature for", pnid); continue; }
      const names = Object.fromEntries((v.contacts || []).map((x) => [str(x?.wa_id), str(x?.profile?.name)]));
      for (const m of v.messages || []) {
        const phone = internationalPhone(m?.from);
        if (!phone) continue;
        const conv = await conversationFor(t, phone, { name: names[str(m.from)] || null });
        if (!conv) continue;
        const kind = ["text", "image", "document", "audio", "video", "location", "sticker", "button", "interactive"].includes(m.type) ? m.type : "other";
        const media = m[m.type] && typeof m[m.type] === "object" ? m[m.type] : {};
        const body = m.type === "text" ? str(m.text?.body)
          : m.type === "button" ? str(m.button?.text)
          : m.type === "interactive" ? str(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)
          : m.type === "location" ? `Location: ${m.location?.latitude},${m.location?.longitude}${m.location?.name ? ` (${m.location.name})` : ""}`
          : str(media.caption || media.filename);
        await recordMessage(t, conv, { direction: "in", wa_message_id: str(m.id) || null, kind, body: body.slice(0, 4096), media_id: str(media.id) || null, media_mime: str(media.mime_type) || null, status: "received", via: "cloud" });
        if (!conv.display_name && names[str(m.from)]) await db(`garage_wa_conversations?id=eq.${conv.id}`, { method: "PATCH", prefer: "return=minimal", body: { display_name: names[str(m.from)] } }).catch(() => {});
      }
      for (const s of v.statuses || []) {
        const status = ["sent", "delivered", "read", "failed"].includes(s?.status) ? s.status : null;
        if (!status || !s.id) continue;
        await db(`garage_wa_messages?tenant_id=eq.${t}&wa_message_id=eq.${enc(s.id)}`, { method: "PATCH", prefer: "return=minimal", body: { status, ...(status === "failed" ? { error: str(s.errors?.[0]?.title || s.errors?.[0]?.message).slice(0, 300) } : {}) } }).catch(() => {});
      }
    }
  }
  return { ok: true };
}

async function ownConversation(who, id) {
  if (!UUID.test(str(id))) throw new HttpError(400, "Choose a conversation");
  const conv = await one(`garage_wa_conversations?id=eq.${id}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!conv) throw new HttpError(404, "Conversation not found");
  return conv;
}

async function waSendRoute(who, b) {
  const text = str(b.text);
  if (!text) throw new HttpError(400, "Write the message");
  if (text.length > 4096) throw new HttpError(400, "The message is too long");
  const phone = b.conversation_id ? (await ownConversation(who, b.conversation_id)).phone : internationalPhone(b.phone);
  if (!phone) throw new HttpError(400, "Enter a valid phone number");
  if (await waCloudConnected(who.tenantId)) return waSendForCompany(who.tenantId, phone, text, { userId: who.user.id });
  // Not on the Cloud API: send through APIWAP (sendForShop) and keep a copy in the inbox.
  const r = await sendCustomerMessage({ tenantId: who.tenantId, channel: "whatsapp", to: phone, text, event: "manual", userId: who.user.id });
  // The company's "What uses SMS" choices may have sent it as an SMS instead: only WhatsApp goes in the inbox.
  if (r?.channel && r.channel !== "whatsapp") return r;
  const conv = await conversationFor(who.tenantId, phone);
  if (conv) await recordMessage(who.tenantId, conv, { direction: "out", kind: "text", body: text, status: r.ok ? "sent" : "failed", error: r.ok ? null : str(r.error).slice(0, 300), via: "apiwap", sent_by: who.user.id }).catch(() => {});
  return r;
}

async function waTemplateRoute(who, b) {
  const conv = await ownConversation(who, b.conversation_id);
  const name = str(b.name).replace(/[^a-z0-9_]/gi, "").toLowerCase();
  if (!name) throw new HttpError(400, "Enter the approved template name");
  const params = (Array.isArray(b.params) ? b.params : []).map(str).filter(Boolean).slice(0, 10);
  return waSendForCompany(who.tenantId, conv.phone, params.join(" · ") || name, { userId: who.user.id, template: name, lang: str(b.lang) || null, params });
}

async function waMedia(who, id, res) {
  if (!/^\d{5,40}$/.test(str(id))) throw new HttpError(400, "Unknown file");
  const msg = await one(`garage_wa_messages?tenant_id=eq.${who.tenantId}&media_id=eq.${id}&select=media_mime&limit=1`);
  if (!msg) throw new HttpError(404, "File not found");
  const wa = await waCompany(who.tenantId);
  if (!wa) throw new HttpError(409, "WhatsApp is not connected");
  const meta = await graph(`/${id}`, { token: wa.token });
  if (!/^https:\/\/[^/]*(fbcdn|facebook|whatsapp)\.(net|com)\//.test(str(meta?.url))) throw new HttpError(502, "Meta did not return the file");
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${wa.token}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new HttpError(502, "Could not download the file");
  const buf = Buffer.from(await r.arrayBuffer());
  res.writeHead(200, { "Content-Type": str(meta.mime_type || msg.media_mime) || "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Length": buf.length });
  res.end(buf);
  return null;
}

// ------------------------------------------------------------------ customer context (inbox side panel, screen pop)

/**
 * A customer's Garage picture for a phone number or customer id: the customer, their vehicles,
 * open jobs and unpaid invoices. Vehicles and jobs come from the workshop area: garage-workshop.js
 * may export customerContext(tenantId, { customerId, phone }) → { vehicles: [...], jobs: [...] }.
 */
export async function customerContext(tenantId, { phone = "", customerId = "" } = {}) {
  let customer = null;
  if (UUID.test(str(customerId))) customer = await one(`customers?id=eq.${customerId}&tenant_id=eq.${tenantId}&select=id,name,phone,email`).catch(() => null);
  if (!customer && phone) {
    const variants = phoneVariants(phone);
    if (variants.length) customer = await one(`customers?tenant_id=eq.${tenantId}&phone=in.${enc(inList(variants))}&select=id,name,phone,email&limit=1`).catch(() => null);
  }
  let vehicles = [], jobs = [];
  try {
    const ws = await import("./garage-workshop.js");
    if (typeof ws.customerContext === "function") {
      const x = await ws.customerContext(tenantId, { customerId: customer?.id || null, phone: internationalPhone(phone) || phone });
      vehicles = Array.isArray(x?.vehicles) ? x.vehicles.slice(0, 20) : [];
      jobs = Array.isArray(x?.jobs) ? x.jobs.slice(0, 20) : [];
    }
  } catch (e) { console.error("[garage/i] workshop context", e.message); }
  const invoices = customer
    ? await rows(`invoices?tenant_id=eq.${tenantId}&customer_id=eq.${customer.id}&status=not.in.(draft,void,paid)&select=id,invoice_number,total,amount_paid,due_date,status&order=created_at.desc&limit=10`).catch(() => [])
    : [];
  return {
    customer,
    vehicles, jobs,
    invoices: invoices.map((i) => ({ ...i, balance: Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)) })),
  };
}

async function waLink(who, b) {
  const conv = await ownConversation(who, b.conversation_id);
  const kind = str(b.kind);
  let url = "", text = "";
  const [bs] = await Promise.all([one(`business_settings?tenant_id=eq.${who.tenantId}&select=business_name&limit=1`).catch(() => null)]);
  const company = str(bs?.business_name) || "us";
  if (kind === "invoice") {
    const inv = await one(`invoices?id=eq.${str(b.id)}&tenant_id=eq.${who.tenantId}&select=id,invoice_number,total,amount_paid`);
    if (!inv) throw new HttpError(404, "Invoice not found");
    url = await invoicePayLink(who.tenantId, inv.id);
    if (!url) throw new HttpError(409, "This invoice has no payment link (draft or void)");
    text = `Invoice ${inv.invoice_number} from ${company}: KES ${Math.max(0, Number(inv.total) - Number(inv.amount_paid || 0)).toLocaleString("en-KE")} due. View and pay: ${url}`;
  } else if (["estimate", "tracking"].includes(kind)) {
    // Links made by the workshop area (estimate approval /e/…, job tracking …) on this company's address.
    url = str(b.url);
    const { companyOrigin } = await import("./paylinks.js");
    const origin = await companyOrigin(who.tenantId);
    if (!url.startsWith(`${origin}/`) && !url.startsWith(`${PUBLIC_ORIGIN}/`)) throw new HttpError(400, "That link is not on your company's address");
    text = kind === "estimate" ? `Your estimate from ${company} is ready. View and approve: ${url}` : `Follow your vehicle's progress at ${company}: ${url}`;
  } else throw new HttpError(400, "Choose what to send");
  if (str(b.text)) text = `${str(b.text)} ${url}`.trim();
  return waSendRoute(who, { conversation_id: conv.id, text });
}

// ------------------------------------------------------------------ JMSURF Call Centre link (dash-db)

function ccConfig() {
  const url = credential("CALLCENTRE_DB_URL").replace(/\/+$/, "");
  const key = credential("CALLCENTRE_SERVICE_KEY");
  return { url, key, ready: !!(url && key && /^https?:\/\//.test(url)) };
}
async function ccFetch(path, { method = "GET", body, prefer } = {}) {
  const cc = ccConfig();
  if (!cc.ready) throw new HttpError(503, "The Call Centre link is not set up on the platform yet");
  const r = await fetch(`${cc.url}${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { apikey: cc.key, Authorization: `Bearer ${cc.key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, data: j };
}
async function ccRest(path, opts) {
  const r = await ccFetch(`/rest/v1/${path}`, opts);
  if (!r.ok) throw new HttpError(502, `Call Centre database: ${str(r.data?.message || r.status)}`);
  return r.data;
}
const ccPassword = () => `${randomToken(18)}Aa1!`;

/** The Call Centre login for an email: created when missing; returns its id. */
async function ccUser(email, meta) {
  const created = await ccFetch("/auth/v1/admin/users", { method: "POST", body: { email, password: ccPassword(), email_confirm: true, user_metadata: meta } });
  if (created.ok && UUID.test(str(created.data?.id))) return created.data.id;
  // Already a JMSURF login there (e.g. the person also uses DASH): find it through a sign-in link.
  const link = await ccFetch("/auth/v1/admin/generate_link", { method: "POST", body: { type: "magiclink", email } });
  const id = str(link.data?.id || link.data?.user?.id);
  if (link.ok && UUID.test(id)) return id;
  throw new HttpError(502, "Could not create the Call Centre login");
}

/**
 * The Garage company's twin in the Call Centre database. Created once, owned by a service login
 * (never used by a person) and marked erp_settings.garage_mirror + slug "garage-<slug>" + signup
 * source "garage", so it is never taken for a DASH company.
 */
async function ccCompany(tenantId) {
  const conn = await connection(tenantId);
  if (conn.cc_tenant_id) {
    const live = await ccRest(`tenants?id=eq.${conn.cc_tenant_id}&select=id,is_active,deleted_at`).catch(() => []);
    if (live?.[0] && live[0].is_active !== false && !live[0].deleted_at) return conn.cc_tenant_id;
  }
  const [t, bs] = await Promise.all([
    one(`tenants?id=eq.${tenantId}&select=id,slug,business_name`),
    one(`business_settings?tenant_id=eq.${tenantId}&select=business_name,business_email,business_phone,country,currency&limit=1`).catch(() => null),
  ]);
  if (!t) throw new HttpError(404, "Company not found");
  const name = str(bs?.business_name || t.business_name) || "Garage";
  const ownerEmail = `cc-${tenantId}@garage.jmsurf.co.ke`;
  const ownerId = await ccUser(ownerEmail, {
    registration_type: "tenant", full_name: `${name} (JMSURF Garage)`, business_name: name,
    business_email: str(bs?.business_email) || null, business_phone: str(bs?.business_phone) || null,
    contact_name: name, store_slug: `garage-${t.slug}`.slice(0, 50), industry: "Motor vehicle repair", business_type: "general",
    country: str(bs?.country) || "KE", currency: str(bs?.currency) || "KES", billing_cycle: "monthly",
    start_apps: ["callcentre"], focus_app: "callcentre", signup_source: "garage",
    garage_tenant_id: tenantId, garage_slug: t.slug, terms_accepted: true, terms_version: "2026-11-14", terms_source: "jmsurf-garage",
  });
  let ccTenant = "";
  for (let i = 0; i < 6 && !ccTenant; i++) {
    const p = await ccRest(`profiles?user_id=eq.${ownerId}&select=tenant_id&limit=1`).catch(() => []);
    ccTenant = str(p?.[0]?.tenant_id);
    if (!ccTenant) await new Promise((r) => setTimeout(r, 500));
  }
  if (!UUID.test(ccTenant)) throw new HttpError(502, "The Call Centre did not create the company. Contact JMSURF support.");
  const s = await ccRest(`business_settings?tenant_id=eq.${ccTenant}&select=id,erp_settings&limit=1`).catch(() => []);
  if (s?.[0]?.id) {
    await ccRest(`business_settings?id=eq.${s[0].id}`, { method: "PATCH", prefer: "return=minimal", body: { erp_settings: { ...(s[0].erp_settings || {}), garage_mirror: { tenant_id: tenantId, slug: t.slug, origin: PUBLIC_ORIGIN, linked_at: new Date().toISOString() } } } }).catch(() => {});
  }
  await patchConnection(tenantId, { cc_tenant_id: ccTenant, cc_owner_user_id: ownerId, cc_linked_at: new Date().toISOString() });
  return ccTenant;
}

/** Opens the Call Centre for this staff member: company + member mirrored, then a one-time sign-in link. */
async function ccOpen(who, b) {
  const email = str(who.user.email).toLowerCase();
  if (!email) throw new HttpError(400, "Your login has no email address");
  const ccTenant = await ccCompany(who.tenantId);
  const linked = await one(`garage_cc_users?tenant_id=eq.${who.tenantId}&user_id=eq.${who.user.id}&select=cc_user_id`).catch(() => null);
  const ccUserId = linked?.cc_user_id || await ccUser(email, { full_name: who.name, registration_type: "member", signup_source: "garage", garage_tenant_id: who.tenantId });
  const role = who.admin ? "admin" : who.manager ? "manager" : "cashier";
  await ccRest("tenant_members?on_conflict=tenant_id,user_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { tenant_id: ccTenant, user_id: ccUserId, role, status: "active" } });
  // The Call Centre works in the person's current company: make it this Garage company's twin.
  await ccRest("rpc/switch_company_for", { method: "POST", body: { p_user: ccUserId, p_tenant: ccTenant } });
  if (!linked) await db("garage_cc_users?on_conflict=tenant_id,user_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { tenant_id: who.tenantId, user_id: who.user.id, cc_user_id: ccUserId } });
  const link = await ccFetch("/auth/v1/admin/generate_link", { method: "POST", body: { type: "magiclink", email } });
  const th = str(link.data?.hashed_token || link.data?.properties?.hashed_token);
  if (!link.ok || !th) throw new HttpError(502, "Could not open the Call Centre. Try again.");
  const next = str(b?.next).startsWith("/") ? str(b.next).slice(0, 200) : "/";
  return { url: `${CC_APP}/auth/handoff#th=${enc(th)}&next=${enc(next)}` };
}

/** Which Garage company a screen-pop / missed-call request is for (per-company key, or platform key + cc_tenant). */
async function ccRequestTenant(req, query, body) {
  const key = str(req.headers.authorization).replace(/^Bearer\s+/i, "") || str(req.headers["x-garage-key"]);
  if (!key) throw new HttpError(401, "Missing key");
  if (key.startsWith("gcl_")) {
    const conn = await one(`garage_connections?cc_lookup_key_hash=eq.${sha256(key)}&select=tenant_id,cc_missed_sms,cc_missed_text`);
    if (!conn) throw new HttpError(401, "Unknown key");
    return conn;
  }
  const platformKey = credential("CALLCENTRE_LOOKUP_KEY");
  if (!platformKey || sha256(key) !== sha256(platformKey)) throw new HttpError(401, "Unknown key");
  const ccTenant = str(query.get("cc_tenant") || body?.cc_tenant);
  const tenant = str(query.get("tenant") || body?.tenant);
  const conn = UUID.test(ccTenant) ? await one(`garage_connections?cc_tenant_id=eq.${ccTenant}&select=tenant_id,cc_missed_sms,cc_missed_text`)
    : UUID.test(tenant) ? await one(`garage_connections?tenant_id=eq.${tenant}&select=tenant_id,cc_missed_sms,cc_missed_text`) : null;
  if (!conn) throw new HttpError(404, "No Garage company for that Call Centre company");
  return conn;
}

async function ccLookup(req, query) {
  const conn = await ccRequestTenant(req, query, null);
  const phone = str(query.get("phone"));
  if (!internationalPhone(phone)) throw new HttpError(400, "Give the caller's phone number");
  const ctx = await customerContext(conn.tenant_id, { phone });
  const { companyOrigin } = await import("./paylinks.js");
  const origin = await companyOrigin(conn.tenant_id);
  return { ...ctx, links: { customer: ctx.customer ? `${origin}/customers/${ctx.customer.id}` : null, inbox: `${origin}/garage/whatsapp` } };
}

const missedThrottle = new Map();
async function ccMissed(req, query, body) {
  const conn = await ccRequestTenant(req, query, body);
  const phone = internationalPhone(body?.phone || query.get("phone"));
  if (!phone) throw new HttpError(400, "Give the caller's phone number");
  const key = `${conn.tenant_id}:${phone}`;
  if (Date.now() - (missedThrottle.get(key) || 0) < 30 * 60_000) return { ok: true, repeated: true };
  missedThrottle.set(key, Date.now());
  if (missedThrottle.size > 20000) missedThrottle.clear();
  const ctx = await customerContext(conn.tenant_id, { phone });
  const calledAt = Date.parse(str(body?.called_at)) ? new Date(str(body.called_at)).toISOString() : new Date().toISOString();
  const [cb] = await db("garage_callbacks", { method: "POST", body: { tenant_id: conn.tenant_id, phone, customer_id: ctx.customer?.id || null, customer_name: ctx.customer?.name || null, source: "callcentre", called_at: calledAt, note: str(body?.note).slice(0, 300) || null } });
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: {
    tenant_id: conn.tenant_id, kind: "callback", title: "Missed call to call back", link: "/garage/callcentre",
    body: `${ctx.customer?.name || maskPhone(phone)} called and nobody answered.`,
  } }).catch(() => {});
  let sms = false;
  if (conn.cc_missed_sms !== false) {
    const bs = await one(`business_settings?tenant_id=eq.${conn.tenant_id}&select=business_name&limit=1`).catch(() => null);
    const text = str(conn.cc_missed_text) || `Sorry we missed your call. We will call you back shortly. ${str(bs?.business_name)}`.trim();
    const r = await sendCustomerMessage({ tenantId: conn.tenant_id, channel: "sms", to: phone, text, event: "missed_call" }).catch(() => ({ ok: false }));
    sms = !!r?.ok;
    if (sms && cb?.id) await db(`garage_callbacks?id=eq.${cb.id}`, { method: "PATCH", prefer: "return=minimal", body: { sms_sent: true } }).catch(() => {});
  }
  return { ok: true, callback_id: cb?.id || null, sms_sent: sms };
}

async function ccSettings(who, b) {
  await connection(who.tenantId);
  const patch = {};
  if (typeof b.missed_sms === "boolean") patch.cc_missed_sms = b.missed_sms;
  if (b.missed_text !== undefined) patch.cc_missed_text = str(b.missed_text).slice(0, 300) || null;
  let key = null;
  if (b.rotate_key) { key = `gcl_${randomToken(24)}`; patch.cc_lookup_key_hash = sha256(key); }
  if (Object.keys(patch).length) await patchConnection(who.tenantId, patch);
  // The key is shown once; only its hash is kept.
  return { ok: true, lookup_key: key };
}

async function ccCallback(who, b) {
  if (b.id) {
    if (!UUID.test(str(b.id))) throw new HttpError(400, "Unknown callback");
    await db(`garage_callbacks?id=eq.${b.id}&tenant_id=eq.${who.tenantId}`, { method: "PATCH", prefer: "return=minimal", body: b.done === false ? { status: "open", done_at: null, done_by: null } : { status: "done", done_at: new Date().toISOString(), done_by: who.user.id, ...(str(b.note) ? { note: str(b.note).slice(0, 300) } : {}) } });
    return { ok: true };
  }
  const phone = internationalPhone(b.phone);
  if (!phone) throw new HttpError(400, "Enter the phone number to call back");
  const ctx = await customerContext(who.tenantId, { phone });
  await db("garage_callbacks", { method: "POST", prefer: "return=minimal", body: { tenant_id: who.tenantId, phone, customer_id: ctx.customer?.id || null, customer_name: ctx.customer?.name || null, source: "manual", note: str(b.note).slice(0, 300) || null } });
  return { ok: true };
}

// ------------------------------------------------------------------ routing

const limits = new Map();
function limited(key, max, windowMs = 60_000) {
  const now = Date.now();
  const list = (limits.get(key) || []).filter((x) => now - x < windowMs);
  if (list.length >= max) return true;
  list.push(now); limits.set(key, list);
  if (limits.size > 20000) limits.clear();
  return false;
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-garage-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

export async function handle(req, res, subpath, { sendJson, readJsonBody }) {
  const url = new URL(req.url || "/", "http://local");
  const query = url.searchParams;
  const path = subpath.replace(/^\/+|\/+$/g, "");
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    // ---- public: Safaricom C2B
    const c2b = path.match(/^c2b\/([a-f0-9]{32})\/(confirm|validate)$/);
    if (c2b) {
      const p = parseJson(await readRaw(req, 64_000));
      if (c2b[2] === "validate") return sendJson(res, 200, await c2bValidate(c2b[1], p));
      await c2bReceive(c2b[1], p, { ip: clientIp(req) }).catch((e) => console.error("[garage/c2b]", e.message));
      return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }
    // ---- public: JMSURF PAY webhook
    if (path === "pay/webhook" && req.method === "POST") return sendJson(res, 200, await payWebhook(req, await readRaw(req, 256_000)));
    // ---- public: WhatsApp webhook
    if (path === "whatsapp/webhook") {
      if (req.method === "GET") {
        const challenge = waVerify(query);
        res.writeHead(challenge ? 200 : 403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end(challenge || "Forbidden");
        return;
      }
      const raw = await readRaw(req, 2_000_000);
      // Meta needs a fast 200; the work runs after the answer.
      sendJson(res, 200, { ok: true });
      void waInbound(query, raw, str(req.headers["x-hub-signature-256"])).catch((e) => console.error("[garage/wa] inbound", e.message));
      return;
    }
    // ---- key-protected: Call Centre screen pop and missed calls
    if (path === "callcentre/lookup" && req.method === "GET") {
      if (limited(`cc-lookup:${clientIp(req)}`, 120)) throw new HttpError(429, "Too many requests");
      return sendJson(res, 200, await ccLookup(req, query));
    }
    if (path === "callcentre/missed" && req.method === "POST") {
      if (limited(`cc-missed:${clientIp(req)}`, 60)) throw new HttpError(429, "Too many requests");
      return sendJson(res, 200, await ccMissed(req, query, await readJsonBody(req, 20_000).catch(() => ({}))));
    }
    // ---- signed-in staff
    if (path === "whatsapp/media" && req.method === "GET") { await waMedia(await staff(req), query.get("id"), res); return; }
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const b = await readJsonBody(req, 200_000).catch(() => ({}));
    switch (path) {
      case "status": return sendJson(res, 200, await companyStatus(await staff(req)));
      case "daraja/save": return sendJson(res, 200, await darajaSave(await manager(req), b));
      case "daraja/test": { const who = await manager(req); const { darajaCheckKeys } = await import("./gateways.js"); return sendJson(res, 200, await darajaCheckKeys(who.tenantId)); }
      case "daraja/register-c2b": return sendJson(res, 200, await darajaRegister(await manager(req), b));
      case "c2b/apply": return sendJson(res, 200, await c2bApply(await manager(req), b));
      case "pay/invoice": {
        const who = await staff(req);
        if (limited(`pay:${who.user.id}`, 10)) throw new HttpError(429, "Wait a moment before another prompt");
        const r = await requestInvoicePayment({ tenantId: who.tenantId, invoiceId: str(b.invoice_id), phone: b.phone, amount: b.amount, requestedBy: "staff" });
        return sendJson(res, r.error ? r.status || 400 : 200, r);
      }
      case "pay/status": { const who = await staff(req); return sendJson(res, 200, await invoicePaymentStatus(who.tenantId, str(b.request_id))); }
      case "whatsapp/connect": return sendJson(res, 200, await waConnect(await manager(req), b));
      case "whatsapp/disconnect": return sendJson(res, 200, await waDisconnect(await manager(req)));
      case "whatsapp/send": {
        const who = await staff(req);
        if (limited(`wa:${who.user.id}`, 30)) throw new HttpError(429, "Slow down a little");
        return sendJson(res, 200, await waSendRoute(who, b));
      }
      case "whatsapp/template": return sendJson(res, 200, await waTemplateRoute(await staff(req), b));
      case "whatsapp/read": {
        const who = await staff(req); const conv = await ownConversation(who, b.conversation_id);
        await db(`garage_wa_conversations?id=eq.${conv.id}`, { method: "PATCH", prefer: "return=minimal", body: { unread: 0, ...(b.status === "closed" || b.status === "open" ? { status: b.status } : {}) } });
        return sendJson(res, 200, { ok: true });
      }
      case "whatsapp/context": {
        const who = await staff(req); const conv = await ownConversation(who, b.conversation_id);
        return sendJson(res, 200, await customerContext(who.tenantId, { phone: conv.phone, customerId: conv.customer_id }));
      }
      case "whatsapp/link": return sendJson(res, 200, await waLink(await staff(req), b));
      case "callcentre/open": {
        const who = await staff(req);
        if (limited(`cc-open:${who.user.id}`, 10)) throw new HttpError(429, "Wait a moment and try again");
        return sendJson(res, 200, await ccOpen(who, b));
      }
      case "callcentre/settings": return sendJson(res, 200, await ccSettings(await manager(req), b));
      case "callcentre/callback": return sendJson(res, 200, await ccCallback(await staff(req), b));
      case "platform/status":
      case "platform/save":
      case "platform/test": {
        const who = await caller(req);
        if (!who.superAdmin) throw new HttpError(403, "Only the platform owner can do this (from the super admin address)");
        if (path === "platform/status") return sendJson(res, 200, await platformStatus());
        if (path === "platform/save") return sendJson(res, 200, await platformSave(who, b));
        if (limited(`ptest:${who.user.id}`, 20)) throw new HttpError(429, "Wait a moment");
        return sendJson(res, 200, await platformTest(b));
      }
      default: throw new HttpError(404, "Not found");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error("[garage/i]", path, e?.message);
    if (res.headersSent) return;
    return sendJson(res, status, { ok: false, error: status === 500 ? "Something went wrong. Try again." : str(e?.message) });
  }
}

export function startJobs() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  // Platform credentials saved in the super admin, refreshed every minute.
  void loadPlatformCredentials().catch((e) => console.error("[garage/i] credentials", e.message));
  setInterval(() => void loadPlatformCredentials().catch(() => {}), 60_000).unref?.();
}
