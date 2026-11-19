// ---------------------------------------------------------------------------
// JMSURF Garage integrations: small pure helpers shared by the server files
// (sendmoney.js, gateways.js, messaging.js, etims.js, garage-integrations.js).
// No database or network access here, so every function is unit-tested
// (src/garage/integrations/core.test.ts).
//
//   credential(name)          platform credential: server env first, then the value the
//                             platform owner saved in Super admin → Settings → Integrations
//   encryptSecret / decryptSecret   AES-256-GCM for keys kept at rest ("enc:v1:…")
//   hmacValid / payWebhookValid / whatsappSignatureValid   webhook signature checks
//   darajaTimestamp / darajaPassword   Lipa na M-Pesa STK password (Nairobi time)
//   kenyaMsisdn / internationalPhone    phone numbers
//   referenceCandidates / matchInvoiceRef   paybill account number → invoice
//   fitOneSms / gsmLength               automatic SMS fit one part
//   ipInRanges                          Safaricom callback address check
// ---------------------------------------------------------------------------
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

// ------------------------------------------------------------ credentials

/**
 * Platform credentials the platform owner may save in the super admin instead of
 * the server env. The env always wins (infrastructure stays in charge).
 */
export const PLATFORM_CREDENTIALS = {
  JMSURFPAY_API_KEY: { label: "JMSURF PAY API key", issuer: "JMSURF PAY", secret: true, env: ["JMSURFPAY_API_KEY", "SENDMONEY_API_KEY", "SEND_MONEY_API_KEY"] },
  SENDMONEY_WEBHOOK_SECRET: { label: "JMSURF PAY webhook secret", issuer: "JMSURF PAY", secret: true, env: ["SENDMONEY_WEBHOOK_SECRET", "JMSURFPAY_WEBHOOK_SECRET"] },
  JMSURF_SMS_API_KEY: { label: "JMSURF SMS API key (JMSURF TECHNOLOGIES)", issuer: "JMSURF SMS", secret: true, env: ["JMSURF_SMS_API_KEY"] },
  JMSURF_SMS_SENDER: { label: "Platform SMS sender ID", issuer: "JMSURF SMS", secret: false, env: ["JMSURF_SMS_SENDER"] },
  JMSURF_MAIL_KEY: { label: "JMSURF MAIL API key", issuer: "JMSURF MAIL", secret: true, env: ["JMSURF_MAIL_KEY"] },
  ETIMS_PARTNER_KEY: { label: "JMSURF TAX partner key", issuer: "JMSURF TAX (eTIMS hub)", secret: true, env: ["ETIMS_PARTNER_KEY"] },
  WHATSAPP_PHONE_NUMBER_ID: { label: "Platform WhatsApp phone number ID", issuer: "Meta (WhatsApp Cloud API)", secret: false, env: ["WHATSAPP_PHONE_NUMBER_ID"] },
  WHATSAPP_WABA_ID: { label: "Platform WhatsApp business account ID", issuer: "Meta (WhatsApp Cloud API)", secret: false, env: ["WHATSAPP_WABA_ID"] },
  WHATSAPP_TOKEN: { label: "Platform WhatsApp permanent token", issuer: "Meta (WhatsApp Cloud API)", secret: true, env: ["WHATSAPP_TOKEN"] },
  WHATSAPP_APP_SECRET: { label: "Platform Meta app secret", issuer: "Meta (WhatsApp Cloud API)", secret: true, env: ["WHATSAPP_APP_SECRET"] },
  WHATSAPP_VERIFY_TOKEN: { label: "WhatsApp webhook verify token", issuer: "You choose it (also typed in Meta)", secret: true, env: ["WHATSAPP_VERIFY_TOKEN"] },
  MPESA_CONSUMER_KEY: { label: "Platform Daraja consumer key", issuer: "Safaricom Daraja", secret: true, env: ["MPESA_CONSUMER_KEY"] },
  MPESA_CONSUMER_SECRET: { label: "Platform Daraja consumer secret", issuer: "Safaricom Daraja", secret: true, env: ["MPESA_CONSUMER_SECRET"] },
  MPESA_PASSKEY: { label: "Platform Daraja passkey", issuer: "Safaricom Daraja", secret: true, env: ["MPESA_PASSKEY"] },
  MPESA_SHORTCODE: { label: "Platform Daraja paybill", issuer: "Safaricom Daraja", secret: false, env: ["MPESA_SHORTCODE"] },
  MPESA_ENVIRONMENT: { label: "Platform Daraja environment (live / sandbox)", issuer: "Safaricom Daraja", secret: false, env: ["MPESA_ENVIRONMENT"] },
  CALLCENTRE_DB_URL: { label: "Call Centre database URL (dash-db)", issuer: "JMSURF DASH / Call Centre", secret: false, env: ["CALLCENTRE_DB_URL"] },
  CALLCENTRE_SERVICE_KEY: { label: "Call Centre database service key", issuer: "JMSURF DASH / Call Centre", secret: true, env: ["CALLCENTRE_SERVICE_KEY"] },
  CALLCENTRE_LOOKUP_KEY: { label: "Call Centre screen-pop key", issuer: "You choose it (given to the Call Centre)", secret: true, env: ["CALLCENTRE_LOOKUP_KEY"] },
};

let saved = {};
/** Loaded every minute by garage-integrations.js from platform_settings (decrypted). */
export function setSavedCredentials(map) { saved = map && typeof map === "object" ? { ...map } : {}; }

/** A platform credential: env first, then the saved value. Empty string when neither is set. */
export function credential(name) {
  const def = PLATFORM_CREDENTIALS[name];
  for (const e of def?.env || [name]) { const v = str(process.env[e]); if (v) return v; }
  return str(saved[name]);
}

/** Where a credential comes from, for the super admin status list (never the value). */
export function credentialSource(name) {
  const def = PLATFORM_CREDENTIALS[name];
  for (const e of def?.env || [name]) if (str(process.env[e])) return "env";
  return str(saved[name]) ? "saved" : "missing";
}

// ------------------------------------------------------------ encryption at rest

const PREFIX = "enc:v1:";
/** 32-byte key from GARAGE_SECRETS_KEY (hex or base64), else derived from the database service key. */
export function secretsKey(raw = process.env.GARAGE_SECRETS_KEY, fallback = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "") {
  const v = str(raw);
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, "hex");
  if (v) {
    const b = Buffer.from(v, "base64");
    if (b.length === 32) return b;
    return createHash("sha256").update(`garage-secrets:${v}`).digest();
  }
  if (!fallback) return null;
  return createHash("sha256").update(`garage-secrets:${fallback}`).digest();
}

export function encryptSecret(plain, key = secretsKey()) {
  const text = String(plain ?? "");
  if (!text) return "";
  if (!key) throw new Error("GARAGE_SECRETS_KEY is not set on the server");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

/** Decrypts "enc:v1:…"; plain (older) values come back unchanged; a wrong key gives "". */
export function decryptSecret(value, key = secretsKey()) {
  const v = String(value ?? "");
  if (!v.startsWith(PREFIX)) return v;
  if (!key) return "";
  try {
    const raw = Buffer.from(v.slice(PREFIX.length), "base64url");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return ""; }
}
export const isEncrypted = (v) => String(v ?? "").startsWith(PREFIX);

// ------------------------------------------------------------ signatures

function safeEqualHex(a, b) {
  const x = Buffer.from(str(a).toLowerCase(), "utf8"), y = Buffer.from(str(b).toLowerCase(), "utf8");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** HMAC-SHA256 of the raw body; accepts hex with or without a "sha256=" prefix, or base64. */
export function hmacValid(rawBody, header, secret) {
  if (!secret || !header) return false;
  const h = str(header).replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(rawBody ?? "");
  const digest = mac.digest();
  if (/^[0-9a-f]{64}$/i.test(h)) return safeEqualHex(h, digest.toString("hex"));
  const b64 = digest.toString("base64");
  const x = Buffer.from(h), y = Buffer.from(b64);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** JMSURF PAY webhooks: X-Webhook-Signature = HMAC-SHA256(raw body, secret). */
export const payWebhookValid = (rawBody, headers, secret) =>
  hmacValid(rawBody, headers?.["x-webhook-signature"] || headers?.["X-Webhook-Signature"], secret);

/** Meta webhooks: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret). */
export function whatsappSignatureValid(rawBody, header, appSecret) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(str(header))) return false;
  return hmacValid(rawBody, header, appSecret);
}

export function randomToken(bytes = 16) { return randomBytes(bytes).toString("hex"); }
export const sha256 = (v) => createHash("sha256").update(String(v ?? "")).digest("hex");

// ------------------------------------------------------------ Daraja

/** yyyyMMddHHmmss in Nairobi time (UTC+3, no daylight saving), as Safaricom expects. */
export function darajaTimestamp(date = new Date()) {
  const n = new Date(date.getTime() + 3 * 3600_000);
  const p = (x) => String(x).padStart(2, "0");
  return `${n.getUTCFullYear()}${p(n.getUTCMonth() + 1)}${p(n.getUTCDate())}${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}`;
}

/** STK password: base64(shortcode + passkey + timestamp). */
export const darajaPassword = (shortcode, passkey, timestamp) => Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

export const darajaBase = (environment) => (str(environment) === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke");

/** Account reference Daraja accepts: letters and digits, at most 12. */
export function darajaReference(...candidates) {
  for (const c of candidates) {
    const v = str(c).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (v) return v.slice(0, 12);
  }
  return "GARAGE";
}

/** STK outcome from a query or callback ResultCode: "" pending, 0 paid, 1032 cancelled, else failed. */
export function darajaOutcome(resultCode) {
  const c = str(resultCode);
  if (!c) return "pending";
  if (c === "0") return "completed";
  if (c === "1032") return "cancelled";
  if (c === "4999" || c === "500.001.1001") return "pending"; // still being processed
  return "failed";
}

/** Daraja refuses callback URLs that name these words, so paths stay neutral. */
export const DARAJA_URL_FORBIDDEN = /(m-?pesa|safaricom|exec|cmd|sql|query)/i;
export const darajaUrlAllowed = (url) => /^https:\/\//.test(str(url)) && !DARAJA_URL_FORBIDDEN.test(str(url).replace(/^https:\/\/[^/]+/, ""));

// ------------------------------------------------------------ phones

/** Kenyan mobile in 2547XXXXXXXX / 2541XXXXXXXX form, or "" when it is not one. */
export function kenyaMsisdn(raw) {
  let d = str(raw).replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) d = `254${d}`;
  return /^254[17]\d{8}$/.test(d) ? d : "";
}

/** Digits in international form (any country). Local 0… numbers are taken as Kenyan. */
export function internationalPhone(raw, defaultCountry = "254") {
  let d = str(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) d = defaultCountry + d;
  return /^\d{9,15}$/.test(d) ? d : "";
}

/** The ways one phone number may be stored, for a lookup with `in.(…)`. */
export function phoneVariants(raw) {
  const intl = internationalPhone(raw);
  if (!intl) return [];
  const out = new Set([intl, `+${intl}`]);
  if (intl.startsWith("254")) { const local = intl.slice(3); out.add(`0${local}`); out.add(local); out.add(`+254 ${local}`); out.add(`0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`); }
  return [...out];
}

/** Masked number for screens and logs: 2547••••5678. */
export const maskPhone = (raw) => { const d = internationalPhone(raw) || str(raw).replace(/\D/g, ""); return d.length > 7 ? `${d.slice(0, 4)}••••${d.slice(-4)}` : d; };

// ------------------------------------------------------------ paybill account → invoice

const normRef = (v) => str(v).toUpperCase().replace(/[\s\-_/.#]+/g, "");

/** What a customer typed as the paybill account, best reading first (whole text, after '#', each word). */
export function referenceCandidates(raw) {
  const up = str(raw).toUpperCase();
  if (!up) return [];
  const out = [normRef(up)];
  if (up.includes("#")) for (const p of up.split("#").reverse()) out.push(normRef(p));
  const words = up.split(/[\s#,;:/|]+/).filter(Boolean);
  if (words.length > 1) for (const w of words) out.push(normRef(w));
  return [...new Set(out.filter((x) => x.length >= 2))];
}

/**
 * The invoice a paybill payment is for: the account typed matches an open invoice number
 * (ignoring case, spaces and dashes; "INV-0012", "inv 12" and "12" all match INV-0012 when
 * only one open invoice ends that way). Returns the invoice or null.
 * invoices: [{ id, invoice_number, total, amount_paid, status }]
 */
export function matchInvoiceRef(raw, invoices) {
  const open = (invoices || []).filter((i) => !["draft", "void", "paid"].includes(str(i.status)) && Number(i.total) - Number(i.amount_paid || 0) > 0);
  for (const cand of referenceCandidates(raw)) {
    const exact = open.filter((i) => normRef(i.invoice_number) === cand);
    if (exact.length === 1) return exact[0];
    // Digits only: "12" or "0012" for INV-0012, when exactly one open invoice has that number.
    if (/^\d{1,10}$/.test(cand)) {
      const n = String(Number(cand));
      const byNumber = open.filter((i) => { const m = normRef(i.invoice_number).match(/(\d+)$/); return m && String(Number(m[1])) === n; });
      if (byNumber.length === 1) return byNumber[0];
    }
  }
  return null;
}

// ------------------------------------------------------------ SMS size

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
const GSM_EXT = "^{}\\[~]|€";
const SWAPS = [[/[‘’‚‛′`]/g, "'"], [/[“”„‟″]/g, '"'], [/[–—―−]/g, "-"], [/…/g, "..."], [/[•·]/g, "-"], [/[  -​  ]/g, " "], [/×/g, "x"]];

/** Length in GSM-7 units, or null when the text needs Unicode (UCS-2). */
export function gsmLength(text) {
  let n = 0;
  for (const c of Array.from(String(text || ""))) {
    if (!GSM.includes(c)) return null;
    n += GSM_EXT.includes(c) ? 2 : 1;
  }
  return n;
}

/** SMS parts a message uses (GSM-7: 160 / 153 per part; Unicode: 70 / 67). */
export function smsPartsOf(text) {
  const g = gsmLength(text);
  const len = g ?? Array.from(String(text || "")).length;
  const single = g !== null ? 160 : 70, multi = g !== null ? 153 : 67;
  return len <= single ? 1 : Math.ceil(len / multi);
}

/**
 * Makes an automatic message fit ONE SMS part: plain GSM characters (curly quotes, dashes and
 * emoji replaced or dropped), single spaces, then shortened at a word with "..." so it fits 160.
 * A link at the end is always kept whole.
 */
export function fitOneSms(text, limit = 160) {
  let t = String(text || "");
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  t = Array.from(t).filter((c) => GSM.includes(c)).join("");
  t = t.replace(/[ \t\r\n]+/g, " ").trim();
  if (gsmLength(t) <= limit) return t;
  const m = t.match(/\s(https?:\/\/\S+)$/);
  const tail = m ? ` ${m[1]}` : "";
  let head = m ? t.slice(0, t.length - tail.length) : t;
  const room = limit - gsmLength(tail) - 3;
  if (room < 10) return t.slice(0, limit); // a link longer than the message: plain cut
  while (gsmLength(head) > room) {
    const cut = head.lastIndexOf(" ", head.length - 1);
    head = cut > room * 0.6 ? head.slice(0, cut) : head.slice(0, head.length - 1);
  }
  return `${head.replace(/[\s,;:.-]+$/, "")}...${tail}`;
}

// ------------------------------------------------------------ addresses

function ipv4ToInt(ip) {
  const p = str(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
/** True when an IPv4 address is inside one of the CIDR ranges ("196.201.212.0/22"). */
export function ipInRanges(ip, ranges) {
  const v = ipv4ToInt(str(ip).replace(/^::ffff:/, ""));
  if (v === null) return false;
  return (ranges || []).some((r) => {
    const [net, bits = "32"] = str(r).split("/");
    const n = ipv4ToInt(net), b = Number(bits);
    if (n === null || !(b >= 0 && b <= 32)) return false;
    const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
    return ((v & mask) >>> 0) === ((n & mask) >>> 0);
  });
}
/** Safaricom's published Daraja callback range (live). Sandbox callbacks come from elsewhere. */
export const SAFARICOM_RANGES = ["196.201.212.0/22"];

/** The caller's address behind Cloudflare / the proxy. */
export function clientIp(req) {
  const h = req?.headers || {};
  return str(h["cf-connecting-ip"]) || str(h["x-forwarded-for"]).split(",")[0].trim() || str(req?.socket?.remoteAddress);
}
