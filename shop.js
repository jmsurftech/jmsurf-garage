// ---------------------------------------------------------------------------
// JMSURF Garage online shop + customer portal (public, no staff login).
//
// Prices, stock, volume prices and minimum quantities always come from the
// database, never from the browser. A web order is a pending sale: when M-Pesa
// (JMSURF PAY) confirms it, or staff record the payment, the database deducts
// stock exactly like a till sale (online_order_follow_sale marks it paid).
//
// Customers sign in with phone + password (customer_accounts / customer_sessions,
// "Authorization: Customer <token>"), shared with the water portal tables.
// ---------------------------------------------------------------------------
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { pushSaleForShop, pushInvoiceForShop, invoicePromptStatus } from "./sendmoney.js";
import { sendForShop } from "./messaging.js";
import { statementFor } from "./erp.js";
import { portalCustomerRoutes, portalExtras, applyProfilePatch, setPortalMailer, PORTAL_CLOSED } from "./portal.js";

const scrypt = promisify(scryptCb);
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// Each request serves the company whose address it came to (subdomain or own domain).
const requestShop = new AsyncLocalStorage();
const FALLBACK_SLUG = (process.env.SHOP_SLUG || process.env.VITE_SHOP_SLUG || "").toLowerCase();
const SESSION_DAYS = 60;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const clip = (v, n) => str(v).slice(0, n) || null;
const sha = (s) => createHash("sha256").update(s).digest("hex");

let mailer = null;
/** Lets server.js hand over its email sender (shop SMTP or JMSURF's). */
export function setShopMailer(fn) { mailer = fn; setPortalMailer(fn); }

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const isShopRoute = (pathname) => pathname.startsWith("/api/shop/");

async function db(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(str(data?.message) || `Database error ${res.status}`);
  return data;
}
const one = async (path) => (await db(path))?.[0] || null;
const rpc = (fn, args) => db(`rpc/${fn}`, { method: "POST", body: args });

// --- shop ---------------------------------------------------------------------
const shopCache = new Map();
async function theShop() {
  const slug = requestShop.getStore()?.slug || FALLBACK_SLUG;
  if (!slug) throw new HttpError(404, "Open this from your company's address");
  const hit = shopCache.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit.shop;
  const t = await one(`tenants?slug=eq.${enc(slug)}&deleted_at=is.null&is_active=eq.true&select=id,slug,business_name,business_phone,contact_phone,business_email,contact_email,logo_url`);
  if (!t) throw new HttpError(404, "The shop is not available");
  const s = await one(`business_settings?tenant_id=eq.${t.id}&select=business_name,business_phone,business_email,business_address,currency,payment_provider,erp_settings,mpesa_till_number,mpesa_shortcode,mpesa_account_reference,bank_details`);
  const cfg = s?.erp_settings?.shop || {};
  const mpesaReady = s?.payment_provider === "jmsurf" && !!(await one(`sendmoney_tenants?tenant_id=eq.${t.id}&select=tenant_id`));
  const shop = {
    id: t.id, slug: t.slug, name: s?.business_name || t.business_name, logo_url: t.logo_url,
    phone: s?.business_phone || t.business_phone || t.contact_phone || null, email: s?.business_email || t.business_email || t.contact_email || null,
    address: s?.business_address || null, currency: s?.currency || "KES",
    delivery_fee: Math.max(0, Number(cfg.delivery_fee ?? 0) || 0), free_delivery_over: Math.max(0, Number(cfg.free_delivery_over ?? 0) || 0),
    min_order: Math.max(0, Number(cfg.min_order ?? 0) || 0),
    pickup: cfg.pickup !== false, delivery: cfg.delivery !== false, pay_on_delivery: cfg.pay_on_delivery !== false,
    mpesa: mpesaReady, bank_details: s?.bank_details || null,
    till: s?.mpesa_till_number || null, paybill: s?.mpesa_shortcode || null, account_ref: s?.mpesa_account_reference || null,
    announcement: clip(cfg.announcement, 200), hero_title: clip(cfg.hero_title, 120), hero_text: clip(cfg.hero_text, 300),
    sell_out_of_stock: cfg.sell_out_of_stock !== false, approve_signups: cfg.approve_signups !== false,
    site: cfg.site && typeof cfg.site === "object" ? cfg.site : {},
  };
  // The customer portal is switched on by the company in System → Customer portal.
  shop.portal = cfg.portal_enabled === true;
  // Parts of the portal the company switched off (all on unless switched off).
  const sec = cfg.portal_sections && typeof cfg.portal_sections === "object" ? cfg.portal_sections : {};
  shop.sections = Object.fromEntries(["quotes", "messages", "documents", "projects", "orders", "offers", "reminders"].map((k) => [k, sec[k] !== false]));
  // Contact changes from the portal wait for staff to approve them.
  shop.profile_review = cfg.portal_profile_review === true;
  // The company website at its address ("/"), switched on in Settings → Website.
  shop.site_enabled = cfg.site_enabled === true;
  if (shopCache.size > 500) shopCache.clear();
  shopCache.set(slug, { at: Date.now(), shop });
  return shop;
}
/** Runs fn as if the request came to this company's address (staff "View as customer"). */
export async function runForTenant(tenantId, fn) {
  const t = await one(`tenants?id=eq.${enc(str(tenantId))}&select=slug`);
  if (!t?.slug) throw new HttpError(404, "Company not found");
  return requestShop.run({ slug: String(t.slug).toLowerCase() }, async () => fn(await theShop()));
}
export const publicShop = (s) => {
  const { id: _id, ...rest } = s;
  return rest;
};

// --- phones, passwords, sessions -----------------------------------------------
export function phoneDigits(raw) {
  let d = str(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `254${d.slice(1)}`;
  else if (d.length === 9) d = `254${d}`;
  return /^\d{11,15}$/.test(d) ? d : "";
}
export const localPhone = (intl) => (intl.startsWith("254") ? `0${intl.slice(3)}` : `+${intl}`);
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function checkPassword(pw, stored) {
  const [kind, salt, hash] = str(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}
async function newSession(accountId) {
  const token = randomBytes(32).toString("base64url");
  await db("customer_sessions", { method: "POST", body: { token_hash: sha(token), account_id: accountId, expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString() } });
  return token;
}
const tokenOf = (req) => { const h = str(req.headers["authorization"]); return h.startsWith("Customer ") ? h.slice(9).trim() : ""; };
export async function signedIn(req, required = true) {
  const token = tokenOf(req);
  if (token.length < 20) { if (required) throw new HttpError(401, "Sign in first"); return null; }
  const s = await one(`customer_sessions?token_hash=eq.${sha(token)}&select=account_id,expires_at`);
  if (!s || new Date(s.expires_at) < new Date()) { if (required) throw new HttpError(401, "Your session ended. Sign in again."); return null; }
  const shop = await theShop();
  const acc = await one(`customer_accounts?id=eq.${s.account_id}&tenant_id=eq.${shop.id}&is_active=eq.true&select=id,customer_id,phone`);
  if (!acc) { if (required) throw new HttpError(401, "Sign in first"); return null; }
  return { account: acc, shop };
}

// --- rate limits -----------------------------------------------------------------
const hits = new Map();
export function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  arr.push(now); hits.set(key, arr);
  if (hits.size > 20000) hits.clear();
}
export const ipOf = (req) => str(req.headers["cf-connecting-ip"]) || str(req.headers["x-forwarded-for"]).split(",").pop()?.trim() || req.socket?.remoteAddress || "?";

/** The shop's customer with this phone (any format), created if new. */
async function findOrCreateCustomer(shop, phone, name, email) {
  const id = await rpc("customer_find_or_create_for", { p_tenant: shop.id, p_phone: localPhone(phone), p_name: name || null, p_email: email || null, p_source: "shop" });
  return id;
}

// --- account ---------------------------------------------------------------------
async function register(req, b) {
  limit(`reg:${ipOf(req)}`, 8, 3600_000);
  const shop = await theShop();
  if (!shop.portal) throw new HttpError(403, "The customer portal is not open yet. Ask the business to switch it on.");
  const name = clip(b.name, 120);
  const phone = phoneDigits(b.phone);
  const pw = String(b.password || "");
  const email = str(b.email).toLowerCase();
  if (!name) throw new HttpError(400, "Enter your name");
  if (!phone) throw new HttpError(400, "Enter a valid phone number");
  if (pw.length < 6 || pw.length > 200) throw new HttpError(400, "Use a password of at least 6 characters");
  if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address is not valid");
  if (await one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&select=id`)) throw new HttpError(409, "This phone number already has an account. Sign in instead.");
  const customerId = await findOrCreateCustomer(shop, phone, name, email);
  if (await one(`customer_accounts?customer_id=eq.${customerId}&select=id`)) throw new HttpError(409, "This phone number already has an account. Sign in instead.");
  if (email) await db(`customers?id=eq.${customerId}&email=is.null`, { method: "PATCH", body: { email } }).catch(() => {});
  // New website customers wait for the shop to approve them (Customers → Pending approval).
  if (shop.approve_signups) {
    await db(`customers?id=eq.${customerId}&first_purchase_at=is.null&source=eq.shop`, { method: "PATCH", body: { approval_status: "pending" } }).catch(() => {});
    await notifyShop(shop.id, { title: `New website sign-up: ${name}`, body: `${localPhone(phone)}${email ? ` · ${email}` : ""} is waiting for approval.`, customerId });
  }
  const [acc] = await db("customer_accounts", { method: "POST", prefer: "return=representation", body: { tenant_id: shop.id, customer_id: customerId, phone, password_hash: await hashPassword(pw) } });
  return { token: await newSession(acc.id) };
}

const notifyShop = (tenantId, n) => db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, kind: "customer_signup", title: n.title, body: n.body, link: `/customers/${n.customerId}`, role: "admin", entity_type: "customer", entity_id: n.customerId } }).catch(() => {});

/** Account for a phone number or an email address. */
async function accountFor(shop, login, cols) {
  const raw = str(login);
  if (raw.includes("@")) {
    const c = await one(`customers?tenant_id=eq.${shop.id}&email=ilike.${enc(raw.toLowerCase())}&select=id&limit=1`);
    return c ? one(`customer_accounts?tenant_id=eq.${shop.id}&customer_id=eq.${c.id}&select=${cols}`) : null;
  }
  const phone = phoneDigits(raw);
  return phone ? one(`customer_accounts?tenant_id=eq.${shop.id}&phone=eq.${phone}&select=${cols}`) : null;
}

async function login(req, b) {
  const shop = await theShop();
  if (!shop.portal) throw new HttpError(403, "The customer portal is not open yet. Ask the business to switch it on.");
  const who = str(b.phone || b.login).toLowerCase();
  limit(`login:${ipOf(req)}`, 20, 900_000);
  limit(`login:${who}`, 8, 900_000);
  const acc = who && await accountFor(shop, who, "id,password_hash,is_active,locked_until,failed_logins,mfa_enabled,totp_secret,must_change_password");
  if (acc?.locked_until && new Date(acc.locked_until) > new Date()) throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.");
  const ok = acc && acc.is_active && await checkPassword(String(b.password || ""), acc.password_hash);
  if (!ok) {
    if (acc) {
      const n = (acc.failed_logins || 0) + 1;
      await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { failed_logins: n >= 8 ? 0 : n, ...(n >= 8 ? { locked_until: new Date(Date.now() + 900_000).toISOString() } : {}) } });
    }
    throw new HttpError(401, "Wrong phone number or password");
  }
  if (acc.mfa_enabled && acc.totp_secret) {
    const code = str(b.code).replace(/\s/g, "");
    if (!code) return { mfa_required: true };
    if (!totpCheck(acc.totp_secret, code)) throw new HttpError(401, "That authenticator code is wrong");
  }
  await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString() } });
  return { token: await newSession(acc.id), must_change_password: !!acc.must_change_password };
}

// --- authenticator app (TOTP, RFC 6238) ----------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
function b32decode(s) { let bits = ""; for (const ch of str(s).toUpperCase().replace(/=+$/, "")) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
export function totpCheck(secret, code) {
  const t = Math.floor(Date.now() / 30000);
  return /^\d{6}$/.test(code) && [-1, 0, 1].some((w) => totpAt(secret, t + w) === code);
}

async function mfaSetup(req) {
  const { account, shop } = await signedIn(req);
  const secret = b32encode(randomBytes(20));
  await db(`customer_accounts?id=eq.${account.id}`, { method: "PATCH", body: { mfa_pending: secret } });
  return { secret, uri: `otpauth://totp/${enc(`${shop.name}:${account.phone}`)}?secret=${secret}&issuer=${enc(shop.name)}&digits=6&period=30` };
}
async function mfaEnable(req, b) {
  const { account } = await signedIn(req);
  const acc = await one(`customer_accounts?id=eq.${account.id}&select=mfa_pending`);
  if (!acc?.mfa_pending) throw new HttpError(400, "Start the set-up again");
  if (!totpCheck(acc.mfa_pending, str(b.code))) throw new HttpError(400, "That code is wrong. Check the time on your phone and try again.");
  await db(`customer_accounts?id=eq.${account.id}`, { method: "PATCH", body: { totp_secret: acc.mfa_pending, mfa_pending: null, mfa_enabled: true } });
  return { ok: true };
}
async function mfaDisable(req, b) {
  const { account } = await signedIn(req);
  const acc = await one(`customer_accounts?id=eq.${account.id}&select=password_hash`);
  if (!(await checkPassword(String(b.password || ""), acc.password_hash))) throw new HttpError(400, "Your password is wrong");
  await db(`customer_accounts?id=eq.${account.id}`, { method: "PATCH", body: { totp_secret: null, mfa_pending: null, mfa_enabled: false } });
  return { ok: true };
}

async function forgot(req, b) {
  limit(`forgot:${ipOf(req)}`, 5, 3600_000);
  const shop = await theShop();
  if (!shop.portal) throw new HttpError(403, "The customer portal is not open yet. Ask the business to switch it on.");
  const acc = await accountFor(shop, b.phone || b.login, "id,phone,customer_id,is_active");
  if (acc && acc.is_active) {
    const phone = acc.phone;
    limit(`forgot:${acc.id}`, 3, 3600_000);
    const code = String(randomInt(100000, 1000000));
    await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { reset_code_hash: sha(`${acc.id}:${code}`), reset_expires_at: new Date(Date.now() + 15 * 60_000).toISOString() } });
    const text = `${shop.name}: your password reset code is ${code}. It expires in 15 minutes.`;
    let sent = await sendForShop({ tenantId: shop.id, channel: "sms", to: phone, text }).catch((e) => ({ ok: false, error: e.message }));
    const c = await one(`customers?id=eq.${acc.customer_id}&select=email`);
    if (c?.email && mailer) { const m = await mailer(shop.id, { to: c.email, subject: `${shop.name}: password reset code`, text, html: `<p>${text}</p>` }).catch(() => null); if (m?.ok) sent = { ok: true }; }
    if (!sent?.ok) return { ok: false, error: `We could not send a code by SMS. Call ${shop.phone || "the shop"} to reset your password.` };
  }
  return { ok: true };
}

async function reset(req, b) {
  const shop = await theShop();
  limit(`reset:${ipOf(req)}`, 10, 3600_000);
  const acc = await accountFor(shop, b.phone || b.login, "id,reset_code_hash,reset_expires_at");
  if (!acc || !acc.reset_code_hash || new Date(acc.reset_expires_at) < new Date() || sha(`${acc.id}:${str(b.code)}`) !== acc.reset_code_hash) throw new HttpError(400, "That code is wrong or has expired");
  if (String(b.password || "").length < 6) throw new HttpError(400, "Use a password of at least 6 characters");
  await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", body: { password_hash: await hashPassword(String(b.password)), reset_code_hash: null, reset_expires_at: null, failed_logins: 0, locked_until: null, must_change_password: false } });
  await db(`customer_sessions?account_id=eq.${acc.id}`, { method: "DELETE" });
  return { token: await newSession(acc.id) };
}

/** Customer portal: profile, every purchase, totals over time, balances, reminders, pets and web orders. */
async function me(req) {
  const { account, shop } = await signedIn(req);
  if (!shop.portal) throw new HttpError(403, PORTAL_CLOSED);
  return meFor({ tenantId: shop.id, customerId: account.customer_id, accountId: account.id, shop, preview: false });
}

/** The portal home data for one customer (the signed-in one, or staff's read-only "View as customer"). */
export async function meFor(ctx) {
  const { shop } = ctx;
  const cid = ctx.customerId;
  const on = shop.sections || {};
  const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1); since.setHours(0, 0, 0, 0);
  const [c, tx, debts, reminders, pets, orders, all] = await Promise.all([
    one(`customers?id=eq.${cid}&select=id,name,phone,alt_phone,email,address,area,building,landmark,created_at,loyalty_points,credit_limit,credit_days,balance,company_name,kra_pin,approval_status,info_request`),
    db(`transactions?customer_id=eq.${cid}&status=eq.completed&select=id,created_at,items,total,payment_method&order=created_at.desc&limit=200`),
    db(`invoices?customer_id=eq.${cid}&status=not.in.(draft,void)&select=id,invoice_number,issue_date,due_date,total,amount_paid,status,items,subject&order=issue_date.desc&limit=200`),
    db(`customer_reminders?customer_id=eq.${cid}&status=in.(scheduled,sent)&select=id,product_name,due_date,status&order=due_date.asc&limit=20`),
    db(`customer_pets?customer_id=eq.${cid}&select=id,name,species,breed,birth_date&order=created_at.asc`),
    db(`online_orders?customer_id=eq.${cid}&select=id,order_no,created_at,updated_at,paid_at,total,status,payment_method,delivery_method,items,address&order=created_at.desc&limit=100`),
    db(`transactions?customer_id=eq.${cid}&status=eq.completed&select=total,created_at`),
  ]);
  const monthly = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthly.push({ month: d.toISOString().slice(0, 7), total: (all || []).filter((t) => { const x = new Date(t.created_at); return `${x.getFullYear()}-${x.getMonth()}` === key; }).reduce((a, t) => a + Number(t.total || 0), 0) });
  }
  const open = (debts || []).filter((i) => i.status !== "paid" && Number(i.total) - Number(i.amount_paid) > 0.005);
  const owed = open.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0);
  const today = new Date().toISOString().slice(0, 10);
  const [payments, credits, offers, acc] = await Promise.all([
    db(`payments_received?customer_id=eq.${cid}&select=id,payment_number,payment_date,amount,method,reference&order=payment_date.desc&limit=200`),
    db(`credit_notes?customer_id=eq.${cid}&status=in.(open,closed)&select=id,credit_note_number,issue_date,total,amount_applied,amount_refunded,status,reason&order=issue_date.desc&limit=100`),
    db(`shop_catalogue?tenant_id=eq.${shop.id}&compare_at_price=not.is.null&select=id,name,price,compare_at_price,image_url,category&limit=24`).catch(() => []),
    one(ctx.accountId ? `customer_accounts?id=eq.${ctx.accountId}&select=mfa_enabled,must_change_password,last_login_at` : `customer_accounts?customer_id=eq.${cid}&select=mfa_enabled,must_change_password,last_login_at`),
  ]);
  const extras = await portalExtras(ctx);
  const limitAmt = Number(c?.credit_limit || 0);
  return {
    shop: publicShop(shop), customer: c,
    totals: { lifetime: (all || []).reduce((a, t) => a + Number(t.total || 0), 0), purchases: (all || []).length, owed, this_year: (all || []).filter((t) => new Date(t.created_at).getFullYear() === new Date().getFullYear()).reduce((a, t) => a + Number(t.total || 0), 0) },
    monthly,
    purchases: (tx || []).map((t) => ({ id: t.id, date: t.created_at, total: Number(t.total), payment_method: t.payment_method, items: (t.items || []).map((i) => ({ name: i.name, quantity: Number(i.quantity ?? 1), price: Number(i.price || 0) })) })),
    invoices: (debts || []).map((i) => ({ ...i, balance: Math.max(0, Number(i.total) - Number(i.amount_paid)), overdue: i.status !== "paid" && !!i.due_date && i.due_date < today && Number(i.total) - Number(i.amount_paid) > 0.005 })),
    payments: payments || [], credit_notes: credits || [], offers: on.offers === false ? [] : offers || [],
    credit: { limit: limitAmt, used: owed, available: limitAmt > 0 ? Math.max(0, limitAmt - owed) : 0, days: Number(c?.credit_days || 0),
      due_now: open.filter((i) => i.due_date && i.due_date <= today).reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0),
      unused_credit: (credits || []).filter((n) => n.status === "open").reduce((a, n) => a + Number(n.total) - Number(n.amount_applied) - Number(n.amount_refunded), 0) },
    account: { mfa_enabled: !!acc?.mfa_enabled, must_change_password: !!acc?.must_change_password, last_login_at: acc?.last_login_at || null },
    synced_at: new Date().toISOString(),
    reminders: on.reminders === false ? [] : reminders || [], pets: on.reminders === false ? [] : pets || [], orders: on.orders === false ? [] : orders || [],
    ...extras,
  };
}

async function profile(req, b) {
  const { account, shop } = await signedIn(req);
  const patch = {};
  if (b.name !== undefined) { if (!str(b.name)) throw new HttpError(400, "Enter your name"); patch.name = clip(b.name, 120); }
  if (b.email !== undefined) { const e = str(b.email).toLowerCase(); if (e && !EMAIL.test(e)) throw new HttpError(400, "That email address is not valid"); patch.email = e || null; }
  for (const k of ["address", "area", "building", "landmark", "alt_phone", "company_name", "kra_pin"]) if (b[k] !== undefined) patch[k] = clip(b[k], 300);
  if (patch.kra_pin) patch.kra_pin = patch.kra_pin.toUpperCase();
  // The sign-in phone can change too (checked against the company's other accounts).
  if (b.phone !== undefined && str(b.phone)) { const d = phoneDigits(b.phone); if (!d) throw new HttpError(400, "Enter a valid phone number"); patch.phone = d; }
  let out = { ok: true };
  // Applied now, or kept for staff to approve (System → Customer portal), see portal.js.
  if (Object.keys(patch).length) out = { ok: true, ...(await applyProfilePatch({ tenantId: shop.id, customerId: account.customer_id, accountId: account.id, shop, preview: false }, patch)) };
  if (b.new_password) {
    const acc = await one(`customer_accounts?id=eq.${account.id}&select=password_hash`);
    if (!(await checkPassword(String(b.password || ""), acc.password_hash))) throw new HttpError(400, "Your current password is wrong");
    if (String(b.new_password).length < 6) throw new HttpError(400, "Use a password of at least 6 characters");
    await db(`customer_accounts?id=eq.${account.id}`, { method: "PATCH", body: { password_hash: await hashPassword(String(b.new_password)), must_change_password: false } });
  }
  return out;
}

/** The customer's own statement for a period (same ledger the shop sees). */
async function myStatement(req, b) {
  const { account } = await signedIn(req);
  return statementOf(account.customer_id, b);
}
export function statementOf(customerId, b) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = iso.test(str(b.to)) ? str(b.to) : new Date().toISOString().slice(0, 10);
  const from = iso.test(str(b.from)) ? str(b.from) : `${to.slice(0, 7)}-01`;
  return statementFor(customerId, from, to);
}

/** M-Pesa prompt for an invoice of the signed-in customer. */
async function payInvoice(req, b) {
  const { account, shop } = await signedIn(req);
  limit(`invpay:${account.id}`, 6, 600_000);
  const inv = await one(`invoices?id=eq.${enc(str(b.invoice_id))}&customer_id=eq.${account.customer_id}&select=id`);
  if (!inv) throw new HttpError(404, "Invoice not found");
  const r = await pushInvoiceForShop(shop.id, inv.id, b.phone || account.phone, b.amount, "portal");
  if (r.error) throw new HttpError(r.status || 400, r.error);
  return r;
}
async function payInvoiceStatus(req, b) {
  const { shop } = await signedIn(req);
  if (!/^[0-9a-f-]{36}$/i.test(str(b.request_id))) throw new HttpError(400, "Invalid request");
  return invoicePromptStatus(shop.id, str(b.request_id));
}

/** "I have paid": tells the shop about an M-Pesa / bank payment for an invoice so they can confirm it. */
async function payClaim(req, b) {
  const { account, shop } = await signedIn(req);
  limit(`claim:${account.id}`, 6, 3600_000);
  const inv = await one(`invoices?id=eq.${enc(str(b.invoice_id))}&customer_id=eq.${account.customer_id}&select=id,invoice_number,total,amount_paid`);
  if (!inv) throw new HttpError(404, "Invoice not found");
  const amount = Number(b.amount);
  if (!(amount > 0)) throw new HttpError(400, "Enter the amount you paid");
  const code = clip(b.reference, 40);
  if (!code) throw new HttpError(400, "Enter the M-Pesa or bank reference");
  const c = await one(`customers?id=eq.${account.customer_id}&select=name`);
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: shop.id, kind: "payment_claim", title: `${c?.name || "A customer"} says they paid ${inv.invoice_number}`, body: `KES ${amount.toLocaleString()} · ref ${code}. Confirm it and record the payment.`, link: `/sales/invoices/${inv.id}`, role: "admin", entity_type: "invoice", entity_id: inv.id } });
  return { ok: true };
}

/** Website contact form: becomes a CRM lead (source Website) and a bell alert for the team. */
/** One page view on the company's website (anonymous visitor id kept in the browser). */
const BOT = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse/i;
async function recordVisit(req, b) {
  limit(`visit:${ipOf(req)}`, 120, 600_000);
  const ua = str(req.headers["user-agent"]);
  if (!ua || BOT.test(ua)) return { ok: true };
  const vid = str(b.vid).replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const path = clip(str(b.path) || "/", 300);
  if (!vid || !path.startsWith("/")) return { ok: true };
  const shop = await theShop();
  const device = /mobile|android|iphone/i.test(ua) ? "Mobile" : /ipad|tablet/i.test(ua) ? "Tablet" : "Desktop";
  await db("site_visits", { method: "POST", prefer: "return=minimal", body: {
    tenant_id: shop.id, visitor_id: vid, path, title: clip(b.title, 200) || null, referrer: clip(b.ref, 300) || null,
    utm_source: clip(b.utm_source, 80) || null, utm_medium: clip(b.utm_medium, 80) || null, utm_campaign: clip(b.utm_campaign, 120) || null, device,
  } });
  return { ok: true };
}

async function contactForm(req, b) {
  limit(`contact:${ipOf(req)}`, 5, 3600_000);
  const shop = await theShop();
  const name = clip(b.name, 120);
  const phone = phoneDigits(b.phone);
  const email = str(b.email).toLowerCase();
  const message = clip(b.message, 2000);
  if (!name) throw new HttpError(400, "Enter your name");
  if (!phone) throw new HttpError(400, "Enter a valid phone number");
  if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address is not valid");
  if (!message) throw new HttpError(400, "Write your message");
  const stage = await one(`crm_stages?tenant_id=eq.${shop.id}&select=id&order=sequence.asc&limit=1`);
  const [lead] = await db("crm_leads", { method: "POST", prefer: "return=representation", body: {
    tenant_id: shop.id, type: "lead", name: `Website enquiry: ${name}`, contact_name: name, phone: localPhone(phone), mobile: localPhone(phone), email: email || null,
    description: message, source: "Website", medium: "Contact form", stage_id: stage?.id || null,
  } });
  // The visitor's earlier page views now belong to this lead.
  const vid = str(b.vid).replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (vid && lead?.id) await db(`site_visits?tenant_id=eq.${shop.id}&visitor_id=eq.${enc(vid)}`, { method: "PATCH", prefer: "return=minimal", body: { lead_id: lead.id } }).catch(() => undefined);
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: shop.id, kind: "crm_lead", title: `Website message from ${name}`, body: message.slice(0, 160), link: `/crm/lead/${lead.id}`, role: "admin", entity_type: "crm_lead", entity_id: lead.id } }).catch(() => {});
  return { ok: true };
}

// --- checkout ----------------------------------------------------------------------
/** Price for a quantity: the best volume price that applies, else the list price. */
function unitPrice(item, qty) {
  let price = Number(item.price || 0);
  for (const t of Array.isArray(item.tier_prices) ? item.tier_prices : []) {
    if (qty >= Number(t.min_qty) && Number(t.price) > 0 && Number(t.price) < price) price = Number(t.price);
  }
  return price;
}

async function placeOrder(req, b) {
  limit(`order:${ipOf(req)}`, 12, 600_000);
  const shop = await theShop();
  const session = await signedIn(req, false);
  const lines = (Array.isArray(b.items) ? b.items : []).slice(0, 60)
    .map((l) => ({ id: str(l.id), qty: Math.floor(Number(l.qty)) }))
    .filter((l) => /^[0-9a-f-]{36}$/i.test(l.id) && l.qty > 0 && l.qty <= 10000);
  if (!lines.length) throw new HttpError(400, "Your cart is empty");
  const ids = [...new Set(lines.map((l) => l.id))].join(",");
  const items = await db(`shop_catalogue?tenant_id=eq.${shop.id}&id=in.(${ids})&select=id,name,price,tier_prices,min_order_qty,stock,kind,vat_rate,image_url`);
  const byId = new Map((items || []).map((i) => [i.id, i]));
  const costs = new Map(((await db(`products?id=in.(${ids})&select=id,cost_price`)) || []).map((p) => [p.id, Number(p.cost_price || 0)]));
  const sale = [];
  for (const l of lines) {
    const it = byId.get(l.id);
    if (!it) throw new HttpError(409, "An item in your cart is no longer available. Refresh the shop.");
    if (l.qty < Number(it.min_order_qty || 1)) throw new HttpError(409, `${it.name}: the minimum order is ${it.min_order_qty}`);
    if (it.kind === "product" && !shop.sell_out_of_stock && l.qty > Number(it.stock || 0)) throw new HttpError(409, `${it.name}: only ${Math.max(0, Number(it.stock || 0))} left in stock`);
    const price = unitPrice(it, l.qty);
    sale.push({ id: it.id, product_id: it.id, name: it.name, price, quantity: l.qty, cost_price: costs.get(it.id) || 0, vat_rate: Number(it.vat_rate || 0), is_service: it.kind === "service", unit_type: "unit", stock_per_unit: 1, image_url: it.image_url });
  }
  const subtotal = Math.round(sale.reduce((a, i) => a + i.price * i.quantity, 0));
  if (shop.min_order && subtotal < shop.min_order) throw new HttpError(409, `The minimum order is KES ${shop.min_order.toLocaleString()}`);
  const deliveryMethod = b.delivery_method === "delivery" && shop.delivery ? "delivery" : "pickup";
  if (deliveryMethod === "pickup" && !shop.pickup) throw new HttpError(400, "Choose delivery");
  const deliveryFee = deliveryMethod === "delivery" && !(shop.free_delivery_over && subtotal >= shop.free_delivery_over) ? Math.round(shop.delivery_fee) : 0;
  const total = subtotal + deliveryFee;
  const payment = b.payment_method === "pay_on_delivery" && shop.pay_on_delivery ? "pay_on_delivery" : b.payment_method === "bank_transfer" ? "bank_transfer" : "mpesa";
  if (payment === "mpesa" && !shop.mpesa) throw new HttpError(409, "M-Pesa checkout is not switched on yet. Choose pay on delivery.");
  if (payment === "mpesa" && (total < 1 || total > 150000)) throw new HttpError(400, "M-Pesa takes KSh 1 to 150,000 per order");
  const name = clip(b.name, 120);
  const phone = phoneDigits(b.phone);
  const email = str(b.email).toLowerCase();
  if (!name) throw new HttpError(400, "Enter your name");
  if (!phone) throw new HttpError(400, "Enter a valid phone number");
  if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address is not valid");
  if (deliveryMethod === "delivery" && !str(b.address)) throw new HttpError(400, "Enter the delivery address");

  // The same order sent again within a minute (double tap, network retry) answers with the
  // first order, so the customer gets one order and one M-Pesa prompt.
  const cartKey = (list) => (Array.isArray(list) ? list : []).filter((i) => i?.product_id).map((i) => `${i.product_id}:${Number(i.quantity)}`).sort().join(",");
  const recent = await db(`online_orders?tenant_id=eq.${shop.id}&phone=eq.${enc(localPhone(phone))}&total=eq.${total}&payment_method=eq.${payment}&created_at=gt.${enc(new Date(Date.now() - 60_000).toISOString())}&order=created_at.desc&limit=3&select=id,order_no,public_token,total,status,payment_method,items`).catch(() => []);
  const twin = (Array.isArray(recent) ? recent : []).find((r) => cartKey(r.items) === cartKey(sale));
  if (twin) {
    return { order: { id: twin.id, order_no: twin.order_no, token: twin.public_token, total: Number(twin.total), status: twin.status, payment_method: twin.payment_method }, prompt: payment === "mpesa" ? { ok: true, resumed: true } : null };
  }

  const customerId = session?.account.customer_id || await findOrCreateCustomer(shop, phone, name, email);
  const main = await one(`locations?tenant_id=eq.${shop.id}&is_active=eq.true&order=is_main.desc&select=id`);
  if (deliveryFee > 0) sale.push({ id: null, product_id: null, name: "Delivery", price: deliveryFee, quantity: 1, cost_price: 0, vat_rate: 0, is_service: true, unit_type: "unit", stock_per_unit: 1 });
  const [tx] = await db("transactions", {
    method: "POST", prefer: "return=representation",
    body: {
      tenant_id: shop.id, items: sale, subtotal: total, tax: 0, discount: 0, total,
      payment_method: payment === "mpesa" ? "mpesa" : payment === "bank_transfer" ? "bank_transfer" : "cash",
      customer_id: customerId, customer_name: name, cashier_name: "Online shop", status: "pending",
      location_id: main?.id || null, stock_by_server: true,
    },
  });
  const orderNo = await rpc("next_doc_number", { p_kind: "web_order", p_tenant: shop.id });
  const [order] = await db("online_orders", {
    method: "POST", prefer: "return=representation",
    body: {
      tenant_id: shop.id, order_no: orderNo, customer_id: customerId, customer_name: name, phone: localPhone(phone), email: email || null,
      items: sale, subtotal, delivery_fee: deliveryFee, total, payment_method: payment, transaction_id: tx.id,
      delivery_method: deliveryMethod, address: clip(b.address, 400), notes: clip(b.notes, 600),
    },
  });
  let prompt = null;
  if (payment === "mpesa") {
    try {
      const r = await pushSaleForShop(shop.id, tx.id, phone);
      prompt = r?.error ? { ok: false, error: r.error } : { ok: true };
    } catch (e) {
      prompt = { ok: false, error: str(e.message) || "M-Pesa did not answer. Try again." };
    }
  }
  return { order: { id: order.id, order_no: order.order_no, token: order.public_token, total, status: order.status, payment_method: payment }, prompt };
}

/** Order status for the confirmation page (needs the order's private token). */
async function orderStatus(req, b) {
  const id = str(b.id), token = str(b.token);
  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 20) throw new HttpError(404, "Order not found");
  const o = await one(`online_orders?id=eq.${id}&public_token=eq.${enc(token)}&select=id,order_no,status,total,payment_method,delivery_method,items,created_at,paid_at,transaction_id`);
  if (!o) throw new HttpError(404, "Order not found");
  let payment = null;
  if (o.status === "pending_payment" && o.payment_method === "mpesa") {
    const [t, p] = await Promise.all([
      one(`transactions?id=eq.${o.transaction_id}&select=status,mpesa_error_message`),
      one(`sendmoney_payments?pos_transaction_id=eq.${o.transaction_id}&select=status,provider_status`),
    ]);
    payment = { sale: t?.status, prompt: p?.status || null, reason: str(p?.provider_status?.resultDesc || t?.mpesa_error_message) || null };
  }
  const { transaction_id: _t, ...rest } = o;
  return { order: rest, payment };
}

/** Send a fresh M-Pesa prompt for an unpaid order (customer cancelled or missed it). */
async function retryPayment(req, b) {
  limit(`retry:${ipOf(req)}`, 6, 600_000);
  const shop = await theShop();
  const o = await one(`online_orders?id=eq.${enc(str(b.id))}&public_token=eq.${enc(str(b.token))}&select=id,status,total,transaction_id,phone,customer_id,customer_name,items`);
  if (!o) throw new HttpError(404, "Order not found");
  if (o.status !== "pending_payment") throw new HttpError(409, "This order is already paid or closed");
  const phone = phoneDigits(b.phone || o.phone);
  if (!phone) throw new HttpError(400, "Enter a valid M-Pesa number");
  // A prompt sent in the last minute is still on the customer's phone: never send a second one.
  const last = await one(`sendmoney_payments?pos_transaction_id=eq.${o.transaction_id}&select=status,started_at`);
  if (last && !["failed", "cancelled", "completed"].includes(str(last.status)) && Date.now() - Date.parse(last.started_at) < 60_000) {
    return { ok: true, resumed: true };
  }
  // A sale can only be prompted once: start a new pending sale for the retry.
  const old = await one(`transactions?id=eq.${o.transaction_id}&select=*`);
  const { id: _id, created_at: _c, mpesa_ref: _m, mpesa_error_message: _e, mpesa_error_payload: _p, ...copy } = old || {};
  await db(`transactions?id=eq.${o.transaction_id}&status=eq.pending`, { method: "PATCH", body: { status: "cancelled" } }).catch(() => {});
  const [tx] = await db("transactions", { method: "POST", prefer: "return=representation", body: { ...copy, status: "pending", payment_method: "mpesa" } });
  await db(`online_orders?id=eq.${o.id}`, { method: "PATCH", body: { transaction_id: tx.id, payment_method: "mpesa", updated_at: new Date().toISOString() } });
  const r = await pushSaleForShop(shop.id, tx.id, phone);
  return r?.error ? { ok: false, error: r.error } : { ok: true };
}

const ROUTES = {
  "/api/shop/info": async () => ({ shop: publicShop(await theShop()) }),
  "/api/shop/order": placeOrder,
  "/api/shop/order/status": orderStatus,
  "/api/shop/order/retry": retryPayment,
  "/api/shop/contact": contactForm,
  "/api/shop/visit": recordVisit,
  "/api/shop/c/register": register,
  "/api/shop/c/login": login,
  "/api/shop/c/logout": async (req) => { const t = tokenOf(req); if (t) await db(`customer_sessions?token_hash=eq.${sha(t)}`, { method: "DELETE" }); return { ok: true }; },
  "/api/shop/c/forgot": forgot,
  "/api/shop/c/reset": reset,
  "/api/shop/c/me": me,
  "/api/shop/c/profile": profile,
  "/api/shop/c/statement": myStatement,
  "/api/shop/c/pay-claim": payClaim,
  "/api/shop/c/invoice/pay": payInvoice,
  "/api/shop/c/invoice/pay-status": payInvoiceStatus,
  "/api/shop/c/mfa/setup": mfaSetup,
  "/api/shop/c/mfa/enable": mfaEnable,
  "/api/shop/c/mfa/disable": mfaDisable,
};

export async function handleShopRequest(req, res, pathname, body, sendJson, slug) {
  const fn = ROUTES[pathname] || portalCustomerRoutes[pathname];
  if (!fn) return sendJson(res, 404, { error: "Unknown route" });
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "The shop is not available right now" });
  try {
    return sendJson(res, 200, await requestShop.run({ slug: String(slug || "").toLowerCase() }, () => fn(req, body || {})));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[shop]", pathname, e);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong. Try again." : e.message });
  }
}
