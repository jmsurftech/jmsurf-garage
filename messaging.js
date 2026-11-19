// ---------------------------------------------------------------------------
// SMS (SendBulkSMS) and WhatsApp (APIWAP) sending for shops.
//
// POST /api/messages/send      staff of a shop: { channel, to, text, kind }
// POST /api/messages/test      shop owner/manager: { channel, to }
// POST /api/messages/balance   shop owner/manager: SMS balance on the shop's own key
// POST /api/messages/admin     platform owner: { action: "test" | "balance", channel, to, keys? }
// POST /api/messages/sms-overview  owner/manager: usage log, month totals, top-up history
// POST /api/messages/jmsurf/*  owner/manager: balance, topup, topup-status, bulk
//
// Every message has an event (MESSAGE_EVENTS). The company chooses, per event,
// whether it may go by SMS and/or WhatsApp (System → SMS → What uses SMS).
//
// A shop sends with its own provider key, or with JMSURF's account when the
// platform owner has switched that on. JMSURF SMS uses the shop's prepaid
// units (one per SMS part). Every send is written to email_logs (channel
// "sms" / "whatsapp") so it shows in Message Logs.
// ---------------------------------------------------------------------------

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

import { jmsSend, jmsBulk, jmsBalance, jmsTopup, jmsTopupStatus } from "./jmsurfsms.js";
import { withPlatformRole } from "./platform.js";
import { isDemoTenant } from "./demo.js";
import { credential, fitOneSms } from "./integrations-core.js";

// WhatsApp Cloud API (Meta) lives in garage-integrations.js; loaded when first needed
// (that file also uses this one, so a static import would be circular).
const cloud = () => import("./garage-integrations.js");

const SENDBULKSMS_URL = "https://api.sendbulksms.co.ke/v1";
const APIWAP_URL = "https://api.apiwap.com/api/v1";
const STAFF_ROLES = ["admin", "manager", "cashier", "stock_manager", "sales_person", "rider", "packaging"];

export const isMessagingRoute = (pathname) => pathname.startsWith("/api/messages/");

async function db(path, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" && data?.message ? data.message : `Database replied ${res.status}`);
  return data;
}
const rows = async (path) => { try { const d = await db(path); return Array.isArray(d) ? d : []; } catch { return []; } };
const rpc = (fn, args) => db(`rpc/${fn}`, { method: "POST", body: args });

async function caller(req) {
  const auth = String(req.headers["authorization"] || "");
  if (!auth.startsWith("Bearer ")) return { error: "Sign in first", status: 401 };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return { error: "Sign in first", status: 401 };
  const user = await r.json();
  if (!user?.id) return { error: "Sign in first", status: 401 };
  const [profile] = await rows(`profiles?user_id=eq.${encodeURIComponent(user.id)}&select=tenant_id,display_name&limit=1`);
  const roles = await withPlatformRole((await rows(`user_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role`)).map((x) => String(x.role)), user.id, req);
  return { user, profile, roles, tenantId: profile?.tenant_id || null };
}

const recent = new Map();
function throttled(key, ms) {
  const now = Date.now();
  if (now - (recent.get(key) || 0) < ms) return true;
  recent.set(key, now);
  if (recent.size > 5000) recent.clear();
  return false;
}

// --- Phone numbers and message size -------------------------------------------

/** Digits in international form. Local numbers starting with 0 are taken as Kenyan. */
export function internationalDigits(raw, defaultCountry = "254") {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) d = defaultCountry + d;
  return /^\d{9,15}$/.test(d) ? d : null;
}

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
export function smsParts(text) {
  const chars = Array.from(String(text || ""));
  const gsm = chars.every((c) => GSM.includes(c));
  const len = gsm ? chars.reduce((n, c) => n + ("^{}\\[~]|€".includes(c) ? 2 : 1), 0) : chars.length;
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  return len <= single ? 1 : Math.ceil(len / multi);
}

// --- Providers ------------------------------------------------------------------

async function sendBulkSms({ apiKey, senderId }, phone, text, reference) {
  const body = { to: [phone], message: text };
  if (senderId) body.sender_id = senderId;
  if (reference) body.reference = String(reference).slice(0, 128);
  let res, data = {};
  try {
    res = await fetch(`${SENDBULKSMS_URL}/api-send-sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: "Could not reach SendBulkSMS. Try again." };
  }
  if (!res.ok || data.success !== true) {
    const reason = data?.error?.message || data?.message || data?.error || `SendBulkSMS replied ${res.status}`;
    const friendly = res.status === 401 ? "The SendBulkSMS API key was not accepted"
      : res.status === 402 ? "The SendBulkSMS account has no SMS balance left"
      : res.status === 429 ? "Too many messages at once. Wait a moment and try again."
      : String(reason);
    return { ok: false, error: friendly, status: res.status };
  }
  const rejected = Array.isArray(data.rejected) && data.rejected.length > 0;
  return {
    ok: !rejected,
    error: rejected ? "SendBulkSMS rejected this number" : undefined,
    id: data.message_id, sandbox: data.sandbox === true || String(apiKey).startsWith("bsms_test_"),
    units: data.total_units, balance: data.balance_after,
  };
}

async function sendBulkSmsBalance(apiKey) {
  try {
    const res = await fetch(`${SENDBULKSMS_URL}/api-balance`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: res.status === 401 ? "The SendBulkSMS API key was not accepted" : data?.message || `SendBulkSMS replied ${res.status}` };
    return { ok: true, balance: Number(data.balance), sandbox: data.sandbox === true || String(apiKey).startsWith("bsms_test_") };
  } catch {
    return { ok: false, error: "Could not reach SendBulkSMS" };
  }
}

async function sendApiWap({ apiKey }, phone, text) {
  let res, data = {};
  try {
    res = await fetch(`${APIWAP_URL}/whatsapp/send-message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: `+${phone}`, message: text, type: "text" }),
      signal: AbortSignal.timeout(25000),
    });
    // APIWAP answers errors as a bare JSON string, e.g. "no active subscription plan".
    data = await res.json().catch(() => ({}));
  } catch {
    return { ok: false, error: "Could not reach APIWAP. Try again." };
  }
  const msg = String(typeof data === "string" ? data : data?.message || data?.error || "");
  if (!res.ok || (msg && !/sent|success|queued/i.test(msg))) {
    const friendly = /subscription|plan/i.test(msg) ? "APIWAP says the account has no active plan. Renew or activate the plan on apiwap.com."
      : /api key not found|authentication/i.test(msg) ? "APIWAP did not recognise this API key"
      : /disconnect|not connected|instance/i.test(msg) ? "The WhatsApp number is disconnected in APIWAP. Scan the QR code again on apiwap.com."
      : /not registered/i.test(msg) ? "This number is not on WhatsApp"
      : msg ? `APIWAP: ${msg}` : `APIWAP replied ${res.status}`;
    return { ok: false, error: friendly, status: res.status };
  }
  return { ok: true, id: data?.id || data?.messageId || null };
}

// Other gateways a company can use with its own account (JMSURF SMS stays the default).
export const SMS_PROVIDERS = { sendbulksms: "SendBulkSMS", africastalking: "Africa's Talking", twilio: "Twilio", infobip: "Infobip", advanta: "Advanta", celcom: "Celcom Africa" };

async function postForm(url, headers, fields) {
  const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(20000) });
  return { res, data: await res.json().catch(() => ({})) };
}
async function postJson(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  return { res, data: await res.json().catch(() => ({})) };
}

/** Sends through Africa's Talking, Twilio, Infobip, Advanta or Celcom Africa with the company's own account. */
async function sendOtherSms({ provider, account, apiKey, senderId }, phone, text) {
  const name = SMS_PROVIDERS[provider] || provider;
  try {
    if (provider === "africastalking") {
      const host = account === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
      const { res, data } = await postForm(`${host}/version1/messaging`, { apiKey }, { username: account, to: `+${phone}`, message: text, ...(senderId ? { from: senderId } : {}) });
      const rec = data?.SMSMessageData?.Recipients?.[0];
      if (!res.ok || !rec || !/success|sent|queued/i.test(rec.status || "")) {
        return { ok: false, error: res.status === 401 ? "Africa's Talking did not accept the username or API key" : rec?.status || data?.SMSMessageData?.Message || `Africa's Talking replied ${res.status}` };
      }
      return { ok: true, id: rec.messageId, sandbox: account === "sandbox" };
    }
    if (provider === "twilio") {
      const from = senderId?.startsWith("MG") ? { MessagingServiceSid: senderId } : { From: senderId || "" };
      const auth = Buffer.from(`${account}:${apiKey}`).toString("base64");
      const { res, data } = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`, { Authorization: `Basic ${auth}` }, { To: `+${phone}`, Body: text, ...from });
      if (!res.ok) return { ok: false, error: res.status === 401 ? "Twilio did not accept the Account SID or Auth Token" : data?.message || `Twilio replied ${res.status}` };
      return { ok: true, id: data.sid };
    }
    if (provider === "infobip") {
      const base = String(account || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const { res, data } = await postJson(`https://${base}/sms/2/text/advanced`, { Authorization: `App ${apiKey}` }, { messages: [{ destinations: [{ to: phone }], ...(senderId ? { from: senderId } : {}), text }] });
      const m = data?.messages?.[0];
      if (!res.ok || !m || /REJECTED/i.test(m.status?.groupName || "")) return { ok: false, error: m?.status?.description || data?.requestError?.serviceException?.text || `Infobip replied ${res.status}` };
      return { ok: true, id: m.messageId };
    }
    if (provider === "advanta" || provider === "celcom") {
      const url = provider === "advanta" ? "https://quicksms.advantasms.com/api/services/sendsms/" : "https://isms.celcomafrica.com/api/services/sendsms/";
      const { res, data } = await postJson(url, {}, { apikey: apiKey, partnerID: account, message: text, shortcode: senderId || "", mobile: phone });
      const m = data?.responses?.[0] || {};
      const code = Number(m["response-code"] ?? m["respose-code"] ?? 0);
      if (!res.ok || code !== 200) return { ok: false, error: m["response-description"] || `${name} replied ${res.status}` };
      return { ok: true, id: m.messageid };
    }
  } catch {
    return { ok: false, error: `Could not reach ${name}. Try again.` };
  }
  return { ok: false, error: "Unknown SMS gateway" };
}

// --- What uses SMS (System → SMS → What uses SMS) ---------------------------------
//
// Every message a company sends has an event. The company picks, per event,
// which channels it may use (erp_settings.sms_uses.events[key] = { sms, whatsapp }).
// The requested channel goes out when it is allowed; when it is switched off and
// the other one is on, the message goes out on the other one instead; when both
// are off, nothing is sent. Same list as src/lib/smsUses.ts.

export const MESSAGE_EVENTS = {
  // Customers
  debt_reminder: { label: "Unpaid invoice reminders" },
  statement: { label: "Customer statements" },
  restock_reminder: { label: "Restock and visit reminders" },
  appointment_booked: { label: "Booking confirmations" },
  appointment_reminder: { label: "Appointment reminders" },
  event_ticket: { label: "Event registrations" },
  repair_ready: { label: "Repair ready for collection" },
  portal_access: { label: "Customer account passwords" },
  info_request: { label: "Requests for customer details" },
  course_link: { label: "Course links" },
  journey: { label: "Marketing journeys", whatsapp: true },
  bulk: { label: "Bulk SMS campaigns" },
  otp: { label: "Password reset codes", locked: true },
  // Staff
  payslip: { label: "Payslips" },
  debt_rep: { label: "Debt alerts to sales reps" },
  note_reminder: { label: "Notebook reminders" },
  visitor: { label: "Visitor at reception" },
  iot_alert: { label: "Device alerts" },
  water_alert: { label: "Water tank alerts" },
  // Garage (bookings, job cards, estimates, reminders, call centre); default texts in GARAGE_TEXTS
  booking_confirmed: { label: "Workshop booking confirmations", whatsapp: true },
  booking_reminder: { label: "Workshop booking reminders", whatsapp: true },
  job_checked_in: { label: "Vehicle checked in (job tag and tracking link)", whatsapp: true },
  estimate_ready: { label: "Estimates to approve", whatsapp: true },
  extra_work_approval: { label: "Extra work to approve", whatsapp: true },
  car_ready: { label: "Vehicle ready for collection", whatsapp: true },
  payment_received: { label: "Payment received", whatsapp: true },
  service_due: { label: "Service due reminders", whatsapp: true },
  document_expiry: { label: "Insurance, inspection, speed governor and PSV expiry", whatsapp: true },
  win_back: { label: "Win-back messages", whatsapp: true },
  payment_request: { label: "Invoice and payment links", whatsapp: true },
  missed_call: { label: "Missed-call replies", whatsapp: true },
  // Typed or sent by hand from a screen (receipts, statements, suppliers)
  manual: { label: "Messages you send by hand", whatsapp: true },
};

/**
 * Default one-SMS English texts for the Garage events. {placeholders}: company, name, reg (number
 * plate), date, time, job (job tag), link, amount, total, item (what needs approving), doc (insurance,
 * inspection, speed governor, PSV), receipt. Missing values are left out cleanly; the result is cut to
 * one SMS part (a link at the end stays whole).
 */
export const GARAGE_TEXTS = {
  booking_confirmed: "Hi {name}, your {reg} is booked at {company} on {date} {time}. Reply or call to change it.",
  booking_reminder: "Reminder: your {reg} is booked at {company} on {date} {time}. See you then.",
  job_checked_in: "{company}: {reg} is checked in, job {job}. Follow the progress here: {link}",
  estimate_ready: "{company}: the estimate for {reg} is KES {total}. View and approve: {link}",
  extra_work_approval: "{company}: {reg} also needs {item} (KES {amount}). Approve or decline: {link}",
  car_ready: "Good news {name}: your {reg} is ready for collection at {company}. Balance KES {amount}. {link}",
  payment_received: "{company}: we received KES {amount} for {reg}, ref {receipt}. Thank you!",
  service_due: "Hi {name}, {reg} is due for service. Book with {company}: {link}",
  document_expiry: "Hi {name}, the {doc} for {reg} expires on {date}. {company} can help: {link}",
  win_back: "Hi {name}, we miss you at {company}! Book your {reg}'s next service: {link}",
  payment_request: "{company}: invoice for {reg}, KES {amount} due. View and pay: {link}",
  missed_call: "Sorry we missed your call. {company} will call you back shortly.",
};

/** A Garage event's default text filled in, one SMS part. */
export function garageText(event, vars = {}) {
  const tpl = GARAGE_TEXTS[event] || "";
  const filled = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v).trim();
  })
    .replace(/\b(Balance KES|KES|ref|job|on|for)\s+(?=[.,:;)!]|\s|$)/g, "") // a label whose value is missing
    .replace(/\(\s*\)/g, "").replace(/\s+([.,:;!])/g, "$1").replace(/([.,:;!]){2,}/g, "$1").replace(/\s{2,}/g, " ").trim();
  return fitOneSms(filled);
}

/** Events whose text a person typed: everything else is automatic and must fit one SMS part. */
const TYPED_EVENTS = new Set(["manual", "bulk", "journey", "test"]);
export const isAutomaticEvent = (event) => !TYPED_EVENTS.has(String(event || "manual"));

/** Where a server-side call came from, for callers that do not name their event yet. */
function callerFile(stack) {
  for (const line of String(stack || "").split("\n").slice(1)) {
    const m = line.match(/([\w.-]+\.m?js):\d+:\d+\)?\s*$/);
    if (m && m[1] !== "messaging.js") return m[1];
  }
  return "";
}

/** Works out the event of a message when the caller did not say. */
export function classifyMessage({ text, reference, file }) {
  const t = String(text || ""), ref = String(reference || "");
  if (ref.startsWith("alert:")) return "staff_alert";
  if (ref.startsWith("repair-")) return "repair_ready";
  if (ref.startsWith("visit-")) return "visitor";
  if (/password reset code/i.test(t)) return "otp";
  if (/your account password is/i.test(t)) return "portal_access";
  if (/payslip/i.test(t) && file === "erp.js") return "payslip";
  if (/your statement to/i.test(t)) return "statement";
  if (/^Reminder: your appointment/i.test(t)) return "appointment_reminder";
  if (/ is booked for .*\(ref /i.test(t)) return "appointment_booked";
  if (/you're registered for/i.test(t)) return "event_ticket";
  if (/^Your course is ready/i.test(t)) return "course_link";
  if (/^ALERT /.test(t)) return "iot_alert";
  if (file === "alerts.js") return /Please follow up\.?$/.test(t) ? "debt_rep" : /your balance of /i.test(t) ? "debt_reminder" : "restock_reminder";
  if (file === "erp.js") return /Unpaid: /.test(t) ? "debt_reminder" : /portal\/login/.test(t) ? "info_request" : "manual";
  if (file === "notes.js") return "note_reminder";
  if (file === "water.js") return "water_alert";
  if (file === "engage.js") return "journey";
  return "manual";
}

/** Channels an event may use, from the company's choices (defaults: SMS only, WhatsApp too where the sender picks). */
export function eventChannels(uses, event) {
  const def = MESSAGE_EVENTS[event];
  if (!def) return { sms: true, whatsapp: true };
  if (def.locked) return { sms: true, whatsapp: true };
  const saved = uses?.events?.[event] || {};
  return { sms: saved.sms ?? true, whatsapp: saved.whatsapp ?? !!def.whatsapp };
}

const usesCache = new Map();
/** The company's erp_settings.sms_uses (cached for a minute). */
export async function smsUses(tenantId) {
  const hit = usesCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const [s] = await rows(`business_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=erp_settings&limit=1`);
  const value = s?.erp_settings?.sms_uses || {};
  usesCache.set(tenantId, { at: Date.now(), value });
  if (usesCache.size > 2000) usesCache.clear();
  return value;
}

// --- Low JMSURF SMS balance -----------------------------------------------------

const lowChecked = new Map();
/** After a JMSURF SMS send: warn the company once a day when the balance runs low. */
async function checkLowBalance(tenantId, key) {
  if (Date.now() - (lowChecked.get(tenantId) || 0) < 15 * 60_000) return;
  lowChecked.set(tenantId, Date.now());
  const uses = await smsUses(tenantId);
  const limit = Number(uses?.low_balance ?? 100);
  if (!(limit > 0)) return;
  const b = await jmsBalance(key).catch(() => null);
  if (!b?.ok || b.billing === "internal" || Number(b.sms_remaining) >= limit) return;
  const [m] = await rows(`tenant_messaging?tenant_id=eq.${encodeURIComponent(tenantId)}&select=tenant_id,low_balance_warned_at&limit=1`);
  if (m?.low_balance_warned_at && Date.now() - Date.parse(m.low_balance_warned_at) < 24 * 3600_000) return;
  if (m) await db(`tenant_messaging?tenant_id=eq.${encodeURIComponent(tenantId)}`, { method: "PATCH", body: { low_balance_warned_at: new Date().toISOString() } }).catch(() => undefined);
  else if (Date.now() - (lowChecked.get(`warned:${tenantId}`) || 0) < 24 * 3600_000) return;
  lowChecked.set(`warned:${tenantId}`, Date.now());
  const left = Number(b.sms_remaining || 0).toLocaleString("en-KE");
  await db("shop_notifications", {
    method: "POST",
    body: { tenant_id: tenantId, kind: "sms_low", title: "JMSURF SMS balance is low", body: `${left} SMS left (KES ${Number(b.balance_kes || 0).toLocaleString("en-KE")}). Top up in System → SMS so messages keep going out.`, link: "/settings?tab=sms", sent_at: new Date().toISOString() },
  }).catch(() => undefined);
  const phone = internationalDigits(uses?.low_balance_phone);
  if (phone) await jmsSend(key, phone, `JMSURF Garage: your JMSURF SMS balance is low (${left} SMS left). Top up in System → SMS.`).catch(() => undefined);
}

// --- Which account a shop sends with --------------------------------------------

async function platformKeys() {
  const [row] = await rows(`platform_settings?key=eq.messaging&select=value&limit=1`);
  return row?.value || {};
}

/** The shop's JMSURF SMS API key (jms_live_…), saved write-only in integration_secrets. */
export async function jmsurfSmsKey(tenantId) {
  const [k] = await rows(`integration_secrets?tenant_id=eq.${encodeURIComponent(tenantId)}&name=eq.jmsurf_sms_key&select=value&limit=1`);
  return k?.value || "";
}

async function shopRoute(tenantId, channel) {
  // WhatsApp: the company's own WhatsApp Cloud API number first, APIWAP otherwise
  // ("whatsapp-apiwap" asks for APIWAP only).
  const apiwapOnly = channel === "whatsapp-apiwap";
  if (apiwapOnly) channel = "whatsapp";
  else if (channel === "whatsapp") {
    const connected = await cloud().then((m) => m.waCloudConnected(tenantId)).catch(() => false);
    if (connected) return { via: "cloud" };
  }
  const [m] = await rows(`tenant_messaging?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*&limit=1`);
  if (channel === "sms") {
    // JMSURF SMS sends unless the company chose its own gateway instead.
    const key = await jmsurfSmsKey(tenantId);
    const ownReady = m?.sms_mode === "own" && !!m?.sms_api_key;
    if (key && !(m?.sms_preferred === "own" && ownReady)) return { via: "jmsurfsms", apiKey: key, senderId: m?.sms_sender_id || "" };
  }
  const mode = channel === "sms" ? m?.sms_mode : m?.wa_mode;
  if (!mode || mode === "off") return { error: channel === "sms" ? "SMS is not set up yet (System → SMS & WhatsApp)" : "WhatsApp sending is not set up yet (System → SMS & WhatsApp)" };
  if (mode === "own") {
    const apiKey = channel === "sms" ? m.sms_api_key : m.wa_api_key;
    if (!apiKey) return { error: `Add your ${channel === "sms" ? SMS_PROVIDERS[m.sms_provider] || "SMS gateway" : "APIWAP"} API key in System → SMS & WhatsApp` };
    return { via: "own", apiKey, senderId: m.sms_sender_id || "", provider: channel === "sms" ? m.sms_provider || "sendbulksms" : "apiwap", account: m.sms_account || "" };
  }
  const p = await platformKeys();
  if (channel === "sms") {
    if (!p.sms_enabled || !p.sendbulksms_api_key) return { error: "JMSURF SMS is not available right now. Use your own SendBulkSMS key." };
    return { via: "platform", apiKey: p.sendbulksms_api_key, senderId: m.sms_sender_id || p.sms_sender_id || "" };
  }
  if (!p.wa_enabled || !p.apiwap_api_key) return { error: "JMSURF WhatsApp is not available right now. Use your own APIWAP key." };
  return { via: "platform", apiKey: p.apiwap_api_key };
}

/** True when this shop can send SMS at all (JMSURF SMS key, own key or platform account). */
export async function smsConfigured(tenantId) {
  const r = await shopRoute(tenantId, "sms").catch(() => ({ error: "x" }));
  return !r.error;
}

async function logSend({ tenantId, channel, to, text, ok, via, provider, detail, sender, userId, cost, parts, event }) {
  const base = {
    tenant_id: tenantId, channel, recipient: to, subject: String(text).slice(0, 160),
    status: ok ? "sent" : "failed", smtp_response: String(detail || "").slice(0, 500),
    smtp_host: via === "jmsurfsms" ? "JMSURF SMS" : via === "cloud" ? "WhatsApp Cloud API" : `${channel === "sms" ? SMS_PROVIDERS[provider] || "SendBulkSMS" : "APIWAP"}${via === "platform" ? " (JMSURF)" : ""}`,
    from_email: sender || null, sent_by: userId || null,
  };
  const extra = {
    ...(cost !== undefined && cost !== null && Number.isFinite(Number(cost)) ? { cost_kes: Number(cost) } : {}),
    ...(parts ? { parts: Number(parts) } : {}),
    ...(event ? { event } : {}),
  };
  try {
    await db("email_logs", { method: "POST", body: { ...base, ...extra } });
  } catch (e) {
    // Before the cost / event columns exist, keep logging without them.
    try { if (Object.keys(extra).length) await db("email_logs", { method: "POST", body: base }); else throw e; }
    catch (e2) { console.error("message log failed:", e2.message); }
  }
}

/**
 * Sends one message for a company. Used by the routes, receipts, reminders and alerts.
 * `event` says what the message is for (see MESSAGE_EVENTS); without it the event is
 * worked out from the text and the calling file. The company's "What uses SMS"
 * choices decide whether it goes out by SMS, WhatsApp or not at all.
 */
export async function sendForShop({ tenantId, channel, to, text, userId, reference, event, vars }) {
  const file = callerFile(new Error().stack);
  if (await isDemoTenant(tenantId)) return { ok: false, error: "Messages are not sent from the demo company" };
  const phone = internationalDigits(to);
  if (!phone) return { ok: false, error: "Enter a valid phone number" };
  // A Garage event with no text of its own: its default text, filled from vars.
  const body = String(text || (GARAGE_TEXTS[event] ? garageText(event, vars || {}) : "")).trim();
  if (!body) return { ok: false, error: "The message is empty" };
  if (body.length > 1500) return { ok: false, error: "The message is too long" };

  const ev = event || classifyMessage({ text: body, reference, file });
  let route = null;
  // Staff alerts follow System → Notifications; tests always go.
  if (ev !== "staff_alert" && ev !== "test") {
    const allowed = eventChannels(await smsUses(tenantId), ev);
    const other = channel === "sms" ? "whatsapp" : "sms";
    if (!allowed[channel]) {
      if (!allowed[other]) return { ok: false, skipped: true, event: ev, error: `${MESSAGE_EVENTS[ev]?.label || "These messages"} are switched off (System → SMS → What uses SMS)` };
      channel = other;
    } else if (allowed[other]) {
      // Both allowed: when the asked-for channel is not set up, use the other one.
      route = await shopRoute(tenantId, channel);
      if (route.error) {
        const alt = await shopRoute(tenantId, other);
        if (!alt.error) { channel = other; route = alt; }
      }
    }
  }
  return sendOne({ tenantId, channel, phone, body, userId, reference, event: ev, route });
}

async function sendOne({ tenantId, channel, phone, body, userId, reference, event, route: known }) {
  let route = known || await shopRoute(tenantId, channel);
  if (route.error) return { ok: false, error: route.error };
  // Automatic messages (reminders, job updates, links) always fit ONE SMS part.
  if (channel === "sms" && isAutomaticEvent(event)) body = fitOneSms(body);

  if (channel === "whatsapp" && route.via === "cloud") {
    const m = await cloud();
    const r = await m.waSendForCompany(tenantId, phone, body, { userId, event }).catch((e) => ({ ok: false, error: e.message }));
    if (r.ok || !r.windowClosed) {
      // waSendForCompany writes the inbox message; Message Logs get the usual line too.
      await logSend({ tenantId, channel, to: `+${phone}`, text: body, ok: r.ok, via: "cloud", detail: r.ok ? `id ${r.id || "accepted"}${r.template ? ` (template ${r.template})` : ""}` : r.error, userId, event });
      return { ...r, via: "cloud", to: `+${phone}`, channel, event };
    }
    // Outside the 24-hour window with no template set: APIWAP when the company also has it.
    const [mm] = await rows(`tenant_messaging?tenant_id=eq.${encodeURIComponent(tenantId)}&select=wa_mode&limit=1`);
    if (!mm?.wa_mode || mm.wa_mode === "off") return { ok: false, error: r.error, via: "cloud", channel, event };
    route = await shopRoute(tenantId, "whatsapp-apiwap");
    if (route.error) return { ok: false, error: r.error };
  }

  let result;
  if (channel === "sms" && route.via === "own" && route.provider && route.provider !== "sendbulksms") {
    result = await sendOtherSms(route, phone, body);
    result.parts = smsParts(body);
  } else if (channel === "sms") {
    if (!/^254[17]\d{8}$/.test(phone)) return { ok: false, error: "SMS through SendBulkSMS goes to Kenyan mobile numbers only. Use WhatsApp for other countries." };
    let parts = smsParts(body);
    if (route.via === "platform") {
      const okUnits = await rpc("consume_sms_units", { p_tenant: tenantId, p_units: parts }).catch(() => false);
      if (okUnits !== true) return { ok: false, error: `Not enough SMS units (this message needs ${parts}). Ask JMSURF to top up.` };
    }
    if (route.via === "jmsurfsms") {
      const r = await jmsSend(route.apiKey, phone, body, route.senderId || undefined);
      result = r.ok ? { ok: true, id: r.id || r.message_id || r.reference, cost: r.cost_kes, sandbox: r.test === true } : { ok: false, error: r.error };
      if (r.ok && r.segments) parts = Number(r.segments) || parts;
      if (r.ok) checkLowBalance(tenantId, route.apiKey).catch(() => undefined);
    } else {
      result = await sendBulkSms(route, phone, body, reference);
    }
    if (!result.ok && route.via === "platform") await rpc("refund_sms_units", { p_tenant: tenantId, p_units: parts }).catch(() => undefined);
    result.parts = parts;
  } else {
    result = await sendApiWap(route, phone, body);
  }
  await logSend({ tenantId, channel, to: `+${phone}`, text: body, ok: result.ok, via: route.via, provider: route.provider, detail: result.ok ? (result.id ? `id ${result.id}` : "accepted") + (result.sandbox ? " (test key: not delivered)" : "") : result.error, sender: route.senderId, userId, cost: result.ok ? result.cost : 0, parts: channel === "sms" ? result.parts : undefined, event });
  return { ...result, via: route.via, to: `+${phone}`, channel, event };
}

/** Sends from JMSURF's own SMS / WhatsApp account (renewal reminders and other platform notices). */
export async function sendPlatform(channel, to, text) {
  const p = await platformKeys();
  const phone = internationalDigits(to);
  if (!phone) return { ok: false, error: "No valid phone number" };
  if (channel === "sms") {
    // JMSURF's own JMSURF SMS account (JMSURF TECHNOLOGIES key: JMSURF_SMS_API_KEY, or the key
    // saved in Admin → Settings); SendBulkSMS only as the old fallback. Platform notices are
    // automatic, so they fit one SMS part.
    const key = credential("JMSURF_SMS_API_KEY") || p.jmsurfsms_api_key;
    const msg = fitOneSms(text);
    if (key) {
      const r = await jmsSend(key, phone, msg, credential("JMSURF_SMS_SENDER") || undefined);
      return r.ok ? { ok: true, id: r.id || r.message_id || r.reference } : { ok: false, error: r.error };
    }
    if (!p.sendbulksms_api_key) return { ok: false, error: "The platform JMSURF SMS key is not saved" };
    if (!/^254[17]\d{8}$/.test(phone)) return { ok: false, error: "SMS goes to Kenyan numbers only" };
    return sendBulkSms({ apiKey: p.sendbulksms_api_key, senderId: p.sms_sender_id || "" }, phone, msg);
  }
  // WhatsApp: APIWAP when the platform has it, else the platform WhatsApp Cloud API number.
  if (p.apiwap_api_key) return sendApiWap({ apiKey: p.apiwap_api_key }, phone, text);
  const m = await cloud();
  if (m.waPlatformConfigured()) return m.waSendPlatform(phone, text);
  return { ok: false, error: "No platform WhatsApp account is saved" };
}

// --- Routes -----------------------------------------------------------------------

export async function handleMessagingRequest(req, res, pathname, body, sendJson) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 500, { ok: false, error: "Messaging is not configured on the server" });
  const who = await caller(req);
  if (who.error) return sendJson(res, who.status, { ok: false, error: who.error });
  const isSuper = who.roles.includes("super_admin");
  const isManager = who.roles.some((r) => ["admin", "manager"].includes(r));
  const channel = body?.channel === "whatsapp" ? "whatsapp" : "sms";

  if (pathname === "/api/messages/admin") {
    if (!isSuper) return sendJson(res, 403, { ok: false, error: "Only the platform owner can do this" });
    const saved = await platformKeys();
    const smsKey = String(body?.keys?.sendbulksms_api_key || saved.sendbulksms_api_key || "");
    const waKey = String(body?.keys?.apiwap_api_key || saved.apiwap_api_key || "");
    if (body?.action === "balance") {
      if (!smsKey) return sendJson(res, 200, { ok: false, error: "Add the SendBulkSMS API key first" });
      return sendJson(res, 200, await sendBulkSmsBalance(smsKey));
    }
    const phone = internationalDigits(body?.to);
    if (!phone) return sendJson(res, 200, { ok: false, error: "Enter a valid phone number" });
    if (throttled(`admin-test:${who.user.id}`, 5000)) return sendJson(res, 429, { ok: false, error: "Wait a few seconds" });
    const text = "Test message from JMSURF Garage. Messaging is working.";
    if (channel === "sms") {
      if (!smsKey) return sendJson(res, 200, { ok: false, error: "Add the SendBulkSMS API key first" });
      return sendJson(res, 200, await sendBulkSms({ apiKey: smsKey, senderId: body?.keys?.sms_sender_id ?? saved.sms_sender_id ?? "" }, phone, text));
    }
    if (!waKey) return sendJson(res, 200, { ok: false, error: "Add the APIWAP API key first" });
    return sendJson(res, 200, await sendApiWap({ apiKey: waKey }, phone, text));
  }

  if (!who.tenantId || !who.roles.some((r) => STAFF_ROLES.includes(r))) return sendJson(res, 403, { ok: false, error: "Not allowed" });

  if (pathname === "/api/messages/send") {
    if (throttled(`send:${who.user.id}`, 2500)) return sendJson(res, 429, { ok: false, error: "Wait a moment before sending again" });
    const kind = String(body?.kind || "");
    const event = MESSAGE_EVENTS[kind] && !MESSAGE_EVENTS[kind].locked ? kind : "manual";
    const result = await sendForShop({ tenantId: who.tenantId, channel, to: body?.to, text: body?.text, userId: who.user.id, reference: body?.reference, event });
    return sendJson(res, 200, result);
  }

  // Usage log, month totals and top-up history for System → SMS. The log holds
  // message text (reset codes, passwords), so only owners and managers see it.
  if (pathname === "/api/messages/sms-overview") {
    if (!isManager) return sendJson(res, 403, { ok: false, error: "Only the owner or a manager can see the SMS log" });
    const t = encodeURIComponent(who.tenantId);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const cols = "id,created_at,channel,recipient,subject,status,smtp_host,smtp_response,cost_kes,parts,event";
    let log = await db(`email_logs?tenant_id=eq.${t}&channel=in.(sms,whatsapp)&select=${cols}&order=created_at.desc&limit=200`).catch(() => null);
    if (!Array.isArray(log)) log = await rows(`email_logs?tenant_id=eq.${t}&channel=in.(sms,whatsapp)&select=id,created_at,channel,recipient,subject,status,smtp_host,smtp_response&order=created_at.desc&limit=200`);
    const month = await db(`email_logs?tenant_id=eq.${t}&channel=eq.sms&status=eq.sent&created_at=gte.${monthStart}&select=cost_kes,parts&limit=20000`).catch(() => []);
    const monthRows = Array.isArray(month) ? month : [];
    const topups = await rows(`sms_topups?tenant_id=eq.${t}&select=topup_id,amount_kes,phone,status,sms_estimate,created_at,updated_at&order=created_at.desc&limit=50`);
    return sendJson(res, 200, {
      ok: true, log, topups,
      month: { messages: monthRows.length, parts: monthRows.reduce((n, r) => n + (Number(r.parts) || 1), 0), cost_kes: monthRows.reduce((n, r) => n + (Number(r.cost_kes) || 0), 0) },
    });
  }

  if (!isManager) return sendJson(res, 403, { ok: false, error: "Only the shop owner or a manager can do this" });

  if (pathname === "/api/messages/test") {
    if (throttled(`test:${who.user.id}`, 5000)) return sendJson(res, 429, { ok: false, error: "Wait a few seconds before another test" });
    const [shop] = await rows(`business_settings?tenant_id=eq.${encodeURIComponent(who.tenantId)}&select=business_name&limit=1`);
    const text = `Test message from ${shop?.business_name || "your shop"} on JMSURF Garage. Messaging is working.`;
    return sendJson(res, 200, await sendForShop({ tenantId: who.tenantId, channel, to: body?.to, text, userId: who.user.id, event: "test" }));
  }

  // --- JMSURF SMS: live balance, bulk campaigns and M-Pesa top-up, without leaving the ERP.
  if (pathname.startsWith("/api/messages/jmsurf/")) {
    const key = await jmsurfSmsKey(who.tenantId);
    if (!key) return sendJson(res, 200, { ok: false, needsKey: true, error: "Save your JMSURF SMS API key in System → SMS & WhatsApp first" });
    const action = pathname.slice("/api/messages/jmsurf/".length);
    if (action === "balance") return sendJson(res, 200, await jmsBalance(key));
    if (action === "topup") {
      const amount = Number(body?.amount);
      const phone = internationalDigits(body?.phone);
      if (!(amount >= 10 && amount <= 100000)) return sendJson(res, 200, { ok: false, error: "Top up between KES 10 and 100,000" });
      if (!phone || !/^254[17]\d{8}$/.test(phone)) return sendJson(res, 200, { ok: false, error: "Enter the M-Pesa number to pay from" });
      if (throttled(`topup:${who.tenantId}`, 15000)) return sendJson(res, 429, { ok: false, error: "Wait a few seconds before another top-up" });
      const r = await jmsTopup(key, amount, phone);
      const id = r.ok ? r.id : null;
      if (id) {
        await db("sms_topups", {
          method: "POST",
          body: { tenant_id: who.tenantId, topup_id: String(id), amount_kes: amount, phone: `+${phone}`, status: String(r.status || "pending"), sms_estimate: Number(r.sms_estimate) || null, created_by: who.user.id },
        }).catch((e) => console.error("sms top-up record failed:", e.message));
      }
      return sendJson(res, 200, r);
    }
    if (action === "topup-status") {
      if (!body?.id) return sendJson(res, 200, { ok: false, error: "Missing top-up id" });
      const r = await jmsTopupStatus(key, String(body.id));
      if (r.ok && r.status) {
        await db(`sms_topups?tenant_id=eq.${encodeURIComponent(who.tenantId)}&topup_id=eq.${encodeURIComponent(String(body.id))}`, { method: "PATCH", body: { status: String(r.status), updated_at: new Date().toISOString() } }).catch(() => undefined);
        // A fresh top-up clears the low-balance warning, so the next low balance warns again.
        if (String(r.status) === "completed") await db(`tenant_messaging?tenant_id=eq.${encodeURIComponent(who.tenantId)}`, { method: "PATCH", body: { low_balance_warned_at: null } }).catch(() => undefined);
      }
      return sendJson(res, 200, r);
    }
    if (action === "bulk") {
      if (!eventChannels(await smsUses(who.tenantId), "bulk").sms) return sendJson(res, 200, { ok: false, error: "Bulk SMS is switched off (System → SMS → What uses SMS)" });
      const message = String(body?.message || "").trim();
      if (!message) return sendJson(res, 200, { ok: false, error: "Write the message" });
      if (message.length > 918) return sendJson(res, 200, { ok: false, error: "Keep the message under 6 SMS parts (918 characters)" });
      const seen = new Set();
      const recipients = (Array.isArray(body?.recipients) ? body.recipients : []).map((r) => ({ phone: internationalDigits(r?.phone), name: String(r?.name || "").slice(0, 60) }))
        .filter((r) => r.phone && /^254[17]\d{8}$/.test(r.phone) && !seen.has(r.phone) && seen.add(r.phone));
      if (!recipients.length) return sendJson(res, 200, { ok: false, error: "No valid Kenyan mobile numbers in this audience" });
      if (recipients.length > 20000) return sendJson(res, 200, { ok: false, error: "Send to at most 20,000 people at a time" });
      if (throttled(`bulk:${who.tenantId}`, 10000)) return sendJson(res, 429, { ok: false, error: "Wait a few seconds before another campaign" });
      const [m] = await rows(`tenant_messaging?tenant_id=eq.${encodeURIComponent(who.tenantId)}&select=sms_sender_id&limit=1`);
      const r = await jmsBulk(key, { name: String(body?.name || "").slice(0, 80) || undefined, message, recipients, senderId: m?.sms_sender_id || undefined, sendAt: body?.send_at || undefined });
      await logSend({ tenantId: who.tenantId, channel: "sms", to: `${recipients.length} recipients`, text: message, ok: r.ok, via: "jmsurfsms", detail: r.ok ? `campaign ${r.campaign_id || ""}` : r.error, userId: who.user.id, cost: r.ok ? r.estimated_cost_kes : 0, parts: r.ok ? smsParts(message) * Number(r.recipients || recipients.length) : undefined, event: "bulk" });
      if (r.ok) checkLowBalance(who.tenantId, key).catch(() => undefined);
      return sendJson(res, 200, r);
    }
    return sendJson(res, 404, { ok: false, error: "Unknown JMSURF SMS action" });
  }

  if (pathname === "/api/messages/balance") {
    const [m] = await rows(`tenant_messaging?tenant_id=eq.${encodeURIComponent(who.tenantId)}&select=sms_mode,sms_api_key,sms_provider&limit=1`);
    if (m?.sms_mode !== "own" || !m.sms_api_key) return sendJson(res, 200, { ok: false, error: "Save your own gateway key first" });
    if (m.sms_provider && m.sms_provider !== "sendbulksms") return sendJson(res, 200, { ok: false, error: `Check the balance on your ${SMS_PROVIDERS[m.sms_provider]} dashboard` });
    return sendJson(res, 200, await sendBulkSmsBalance(m.sms_api_key));
  }

  return sendJson(res, 404, { ok: false, error: "Unknown messaging route" });
}
