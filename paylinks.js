import { publicBase } from "./hosts.js";
// ---------------------------------------------------------------------------
// Invoice payment links (public, no login): /pay/<token> in the app calls
//
//   GET  /api/pub/pay?t=<token>          the invoice summary, balance and the ways to pay
//   POST /api/pub/pay/mpesa              M-Pesa prompt for the balance (JMSURF PAY or own Daraja), via
//                                        pushInvoiceForShop: the same flow as the portal and
//                                        "M-Pesa prompt" on the invoice (settle_invoice_mpesa)
//   POST /api/pub/pay/mpesa-status       is that prompt paid yet
//   POST /api/pub/pay/card               card payment on the company's own Paystack account
//   POST /api/pub/pay/card-verify        Paystack confirms; settle_invoice_card() records it
//
// The token (64 hex characters) is the only key. It finds exactly one invoice; nothing
// else of the company is returned. A switched-off link, a draft or a void invoice answers
// "not found". The public demo company never sends payment prompts or card payments.
// Payments are only recorded after the provider confirms them (amount and currency checked).
// ---------------------------------------------------------------------------
import { isDemoTenant } from "./demo.js";
import { pushInvoiceForShop, invoicePromptStatus } from "./sendmoney.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const DEMO_OFF = "Payments are switched off in the demo company.";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
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

const hits = new Map();
function limit(req, key, max, windowMs = 60_000) {
  const ip = str(req.headers["x-forwarded-for"]).split(",")[0] || req.socket?.remoteAddress || "?";
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, "Too many tries. Wait a few minutes and try again.");
  list.push(now); hits.set(k, list);
  if (hits.size > 20000) hits.clear();
}

/** The company's customer pages (custom domain when live, else app.jmsurfgarage.co.ke/<slug>). */
export const companyOrigin = (tenantId) => publicBase(tenantId);

/** Server use (payment reminders): the invoice's live payment link, made if missing. Null for draft / void. */
export async function payLinkUrl(tenantId, invoiceId) {
  if (!SUPABASE_URL || !SERVICE_KEY || !UUID.test(str(invoiceId))) return null;
  const inv = await one(`invoices?id=eq.${invoiceId}&tenant_id=eq.${tenantId}&select=id,status`);
  if (!inv || ["draft", "void"].includes(inv.status)) return null;
  let link = await one(`invoice_pay_links?invoice_id=eq.${inv.id}&revoked_at=is.null&select=token`);
  if (!link) {
    // A second caller at the same moment hits the one-live-link index; then the re-read finds its link.
    await db("invoice_pay_links", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, invoice_id: inv.id, created_by: null } }).catch(() => null);
    link = await one(`invoice_pay_links?invoice_id=eq.${inv.id}&revoked_at=is.null&select=token`);
  }
  return link?.token ? `${await companyOrigin(tenantId)}/pay/${link.token}` : null;
}

/** The link, its invoice and company. Anything not payable reads as "not found". */
async function load(token) {
  if (!TOKEN.test(str(token))) throw new HttpError(404, "This payment link is not valid");
  const link = await one(`invoice_pay_links?token=eq.${enc(token)}&revoked_at=is.null&select=id,tenant_id,invoice_id,opens`);
  if (!link) throw new HttpError(404, "This payment link is not valid or was switched off");
  const [inv, co, bs] = await Promise.all([
    one(`invoices?id=eq.${link.invoice_id}&tenant_id=eq.${link.tenant_id}&select=id,invoice_number,customer_id,customer_name,customer_email,customer_phone,issue_date,due_date,items,subtotal,tax,discount,shipping,adjustment,total,amount_paid,status`),
    one(`tenants?id=eq.${link.tenant_id}&select=id,business_name,logo_url,is_active,deleted_at`),
    one(`business_settings?tenant_id=eq.${link.tenant_id}&select=business_name,business_phone,business_email,currency,payment_provider,paystack_secret_key,mpesa_till_number,mpesa_shortcode,mpesa_account_reference,mpesa_transaction_type`),
  ]);
  if (!inv || !co || co.is_active === false || co.deleted_at || ["draft", "void"].includes(inv.status)) throw new HttpError(404, "This payment link is not valid");
  return { link, inv, co, bs: bs || {} };
}

const balanceOf = (inv) => Math.max(0, Math.round((Number(inv.total || 0) - Number(inv.amount_paid || 0)) * 100) / 100);

async function options(ctx) {
  const provider = str(ctx.bs.payment_provider);
  const demo = await isDemoTenant(ctx.link.tenant_id);
  // JMSURF PAY (linked Till / Paybill / bank) or the company's own Daraja app.
  const mpesa = !demo && (
    (provider === "jmsurf" && !!(await one(`sendmoney_tenants?tenant_id=eq.${ctx.link.tenant_id}&select=tenant_id`).catch(() => null))) ||
    (provider === "daraja" && await (await import("./gateways.js")).darajaReady(ctx.link.tenant_id).catch(() => false))
  );
  const card = !demo && provider === "paystack" && /^sk_(live|test)_/.test(str(ctx.bs.paystack_secret_key));
  return { demo, mpesa, card };
}

async function info(req, q) {
  limit(req, "pay-info", 60);
  const ctx = await load(q.get("t"));
  const { inv, co, bs } = ctx;
  db(`invoice_pay_links?id=eq.${ctx.link.id}`, { method: "PATCH", prefer: "return=minimal", body: { last_opened_at: new Date().toISOString(), opens: Number(ctx.link.opens || 0) + 1 } }).catch(() => {});
  const opt = await options(ctx);
  const balance = balanceOf(inv);
  const till = str(bs.mpesa_till_number), paybill = str(bs.mpesa_shortcode);
  return {
    company: { name: str(bs.business_name) || str(co.business_name), logo: co.logo_url || null, phone: str(bs.business_phone) || null, email: str(bs.business_email) || null },
    invoice: {
      number: inv.invoice_number, customer: inv.customer_name, issue_date: inv.issue_date, due_date: inv.due_date, currency: str(bs.currency) || "KES",
      items: (Array.isArray(inv.items) ? inv.items : []).slice(0, 100).map((l) => ({ name: str(l?.name).slice(0, 200), quantity: Number(l?.quantity ?? l?.qty ?? 1) || 0, amount: Number(l?.amount ?? 0) || Number(l?.quantity ?? 1) * Number(l?.rate ?? l?.price ?? 0) })),
      subtotal: Number(inv.subtotal || 0), tax: Number(inv.tax || 0), discount: Number(inv.discount || 0), total: Number(inv.total || 0),
      paid: Number(inv.amount_paid || 0), balance, status: balance <= 0 ? "paid" : inv.status,
    },
    pay: {
      demo: opt.demo, mpesa: balance >= 1 && opt.mpesa, card: balance >= 1 && opt.card,
      phone: str(inv.customer_phone) || null, email: str(inv.customer_email) || null,
      // Paying by hand: the company's own Till or Paybill, with the invoice number as account.
      // (A till company may keep its store number in mpesa_shortcode: the till is what customers pay.)
      till: till || null, paybill: !till && paybill ? paybill : null, account: !till && paybill ? (str(bs.mpesa_account_reference) || inv.invoice_number) : null,
    },
  };
}

async function mpesa(req, b) {
  limit(req, "pay-mpesa", 5, 10 * 60_000);
  const ctx = await load(b.t);
  if (await isDemoTenant(ctx.link.tenant_id)) throw new HttpError(403, DEMO_OFF);
  const opt = await options(ctx);
  if (!opt.mpesa) throw new HttpError(409, "M-Pesa prompts are not available for this invoice. Pay using the details shown.");
  const balance = balanceOf(ctx.inv);
  if (balance < 1) throw new HttpError(409, "This invoice is already paid");
  let r;
  try { r = await pushInvoiceForShop(ctx.link.tenant_id, ctx.inv.id, b.phone, b.amount || Math.floor(balance), "link"); }
  catch (e) { throw new HttpError(503, str(e.message) || "M-Pesa is not available right now. Pay using the details shown."); }
  if (r.error) throw new HttpError(r.status || 400, r.error);
  return { ok: true, request_id: r.request_id };
}

async function mpesaStatus(req, b) {
  limit(req, "pay-status", 120);
  const ctx = await load(b.t);
  const id = str(b.request_id);
  if (!UUID.test(id)) throw new HttpError(400, "Unknown request");
  const mine = await one(`invoice_mpesa_requests?id=eq.${id}&invoice_id=eq.${ctx.inv.id}&tenant_id=eq.${ctx.link.tenant_id}&select=id`);
  if (!mine) throw new HttpError(404, "Unknown request");
  const s = await invoicePromptStatus(ctx.link.tenant_id, id);
  return { status: str(s?.status) || "unknown", receipt: s?.mpesa_receipt || null };
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

async function card(req, b) {
  limit(req, "pay-card", 10, 10 * 60_000);
  const ctx = await load(b.t);
  if (await isDemoTenant(ctx.link.tenant_id)) throw new HttpError(403, DEMO_OFF);
  const opt = await options(ctx);
  if (!opt.card) throw new HttpError(409, "Card payments are not available for this invoice. Pay using the details shown.");
  const balance = balanceOf(ctx.inv);
  if (balance < 1) throw new HttpError(409, "This invoice is already paid");
  const amount = Math.round((Number(b.amount) || balance) * 100) / 100;
  if (!(amount >= 1) || amount > balance) throw new HttpError(400, `Pay between 1 and ${balance.toLocaleString("en-KE")}`);
  const email = str(b.email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 160) throw new HttpError(400, "Enter your email address for the card receipt");
  const currency = (str(ctx.bs.currency) || "KES").toUpperCase();
  const [row] = await db("invoice_card_payments", { method: "POST", body: { tenant_id: ctx.link.tenant_id, invoice_id: ctx.inv.id, link_id: ctx.link.id, amount, currency, email } });
  const origin = await companyOrigin(ctx.link.tenant_id);
  try {
    const payload = await paystack(str(ctx.bs.paystack_secret_key), "/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email, amount: Math.round(amount * 100), currency, reference: row.id,
        callback_url: `${origin}/pay/${b.t}?ref=${row.id}`,
        metadata: { tenant_id: ctx.link.tenant_id, invoice_id: ctx.inv.id, invoice_number: ctx.inv.invoice_number, source: "payment_link" },
      }),
    });
    const url = str(payload?.data?.authorization_url);
    if (!/^https:\/\/checkout\.paystack\.com\//.test(url)) throw new Error("Paystack did not return a checkout page");
    return { ok: true, url, ref: row.id };
  } catch (e) {
    await db(`invoice_card_payments?id=eq.${row.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", provider_status: { error: str(e.message).slice(0, 300) } } }).catch(() => {});
    throw new HttpError(502, str(e.message) || "Paystack did not answer. Try again.");
  }
}

/** Asks Paystack about one card payment and records it when paid. */
async function reconcileCard(r) {
  if (r.status !== "pending") return r.status;
  const bs = await one(`business_settings?tenant_id=eq.${r.tenant_id}&select=paystack_secret_key`);
  const secret = str(bs?.paystack_secret_key);
  if (!secret) return "pending";
  let data;
  try { data = (await paystack(secret, `/transaction/verify/${enc(r.id)}`))?.data || {}; } catch { return "pending"; }
  const age = Date.now() - Date.parse(r.created_at);
  const settle = (status, ref) => db("rpc/settle_invoice_card", { method: "POST", body: { p_request: r.id, p_status: status, p_reference: ref, p_provider: { status: data.status, gateway_response: data.gateway_response, channel: data.channel, amount: data.amount, currency: data.currency, paid_at: data.paid_at } } });
  if (data.status === "success") {
    if (Number(data.amount) !== Math.round(Number(r.amount) * 100) || str(data.currency).toUpperCase() !== str(r.currency).toUpperCase()) return "pending";
    return settle("completed", `paystack:${str(data.reference) || r.id}`);
  }
  if (["failed", "reversed"].includes(str(data.status)) || (str(data.status) === "abandoned" && age > 60 * 60_000)) return settle("failed", null);
  return "pending";
}

async function cardVerify(req, b) {
  limit(req, "pay-verify", 60);
  const ctx = await load(b.t);
  const id = str(b.ref);
  if (!UUID.test(id)) throw new HttpError(400, "Unknown payment");
  const r = await one(`invoice_card_payments?id=eq.${id}&invoice_id=eq.${ctx.inv.id}&tenant_id=eq.${ctx.link.tenant_id}&select=*`);
  if (!r) throw new HttpError(404, "Unknown payment");
  const status = await reconcileCard(r);
  return { status: typeof status === "string" ? status : "pending" };
}

/** Records card payments whose payer closed the page before returning. */
export function startPayLinkReconciler() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const pending = await rows(`invoice_card_payments?status=eq.pending&created_at=gte.${enc(since)}&select=*&order=created_at.asc&limit=30`);
      for (const r of pending) { try { await reconcileCard(r); } catch (e) { console.error("[pay-link] card", r.id, e.message); } }
    } catch (e) { console.error("[pay-link] batch", e.message); }
    finally { busy = false; }
  }, 60_000).unref();
}

// ---------------------------------------------------------------- routes
const POSTS = { "/api/pub/pay/mpesa": mpesa, "/api/pub/pay/mpesa-status": mpesaStatus, "/api/pub/pay/card": card, "/api/pub/pay/card-verify": cardVerify };
export const isPayLinkRoute = (p) => p === "/api/pub/pay" || Object.prototype.hasOwnProperty.call(POSTS, p);

export async function handlePayLink(req, res, pathname, search, readJsonBody, sendJson) {
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Not available right now" });
  try {
    if (pathname === "/api/pub/pay") {
      if (req.method !== "GET") return sendJson(res, 405, { error: "Use GET" });
      return sendJson(res, 200, await info(req, new URLSearchParams(search || "")));
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
    const body = (await readJsonBody(req, 20_000).catch(() => ({}))) || {};
    return sendJson(res, 200, await POSTS[pathname](req, body));
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error("[pay-link]", pathname, e);
    return sendJson(res, 500, { error: "Something went wrong. Try again." });
  }
}
