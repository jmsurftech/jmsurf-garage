// ---------------------------------------------------------------------------
// Customer portal v2: quotes (accept / decline), documents to view and print,
// Pay now links, messages with the company, shared files, projects and
// contact changes. Staff side: reply to messages, review contact changes and
// "View as customer" (read-only).
//
// Customers: /api/shop/c/* with "Authorization: Customer <token>" (shop.js
// signedIn). Every query is filtered by that session's company AND customer,
// so a customer only ever reaches their own records. Nothing here takes a
// tenant or customer id from the browser.
//
// Staff: /api/erp/portal/* (erp.js caller(): Supabase session + company).
// "View as customer" runs the same read handlers with preview = true: no
// writes, nothing marked read, nothing logged as the customer.
//
// The public demo company never sends emails (and its payment pages refuse
// payments, paylinks.js).
// ---------------------------------------------------------------------------
import { signedIn, HttpError, limit, phoneDigits, localPhone, runForTenant, meFor, statementOf } from "./shop.js";
import { payLinkUrl, companyOrigin } from "./paylinks.js";
import { isDemoTenant } from "./demo.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const PUBLIC_SUPABASE_URL = (process.env.VITE_SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const clip = (v, n) => str(v).slice(0, n) || null;
const enc = encodeURIComponent;
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // Nairobi date
const niceDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const PORTAL_CLOSED = "The customer portal is closed. Contact the business.";
const PREVIEW_ONLY = "This is a preview. Nothing can be changed here.";

let mailer = null;
/** shop.js hands over the email sender (company SMTP or JMSURF's). */
export function setPortalMailer(fn) { mailer = fn; }

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
const rows = async (path) => { const d = await db(path); return Array.isArray(d) ? d : []; };
const one = async (path) => (await rows(path))[0] || null;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

/** A short-lived link to a file in the private documents bucket. */
async function signFile(path, download) {
  if (!path) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path.split("/").map(enc).join("/")}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const j = await res.json().catch(() => ({}));
  const rel = j.signedURL || j.signedUrl;
  if (!res.ok || !rel) return null;
  const url = `${PUBLIC_SUPABASE_URL}/storage/v1${rel}`;
  return download ? `${url}${url.includes("?") ? "&" : "?"}download=${enc(download)}` : url;
}
async function putFile(path, buf, type) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split("/").map(enc).join("/")}`, {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": type || "application/octet-stream", "x-upsert": "false" },
    body: buf,
  });
  if (!res.ok) throw new HttpError(502, "The file could not be saved. Try again.");
}

// ------------------------------------------------------------------ helpers
const need = (ctx, key) => { if (ctx.shop?.sections && ctx.shop.sections[key] === false) throw new HttpError(404, "This part of the portal is switched off"); };
const noPreview = (ctx) => { if (ctx.preview) throw new HttpError(403, PREVIEW_ONLY); };

const moduleCache = new Map();
/** Is a paid module on for the company (projects)? */
async function moduleOn(tenantId, key) {
  const k = `${tenantId}:${key}`;
  const hit = moduleCache.get(k);
  if (hit && hit.until > Date.now()) return hit.on;
  const on = await db("rpc/tenant_module_active", { method: "POST", body: { p_tenant: tenantId, p_key: key } }).then((r) => r === true).catch(() => false);
  if (moduleCache.size > 2000) moduleCache.clear();
  moduleCache.set(k, { on, until: Date.now() + 5 * 60_000 });
  return on;
}

/** Bell for the team: the salesperson (when there is one) and the admins. */
async function notifyStaff(ctx, n) {
  const base = { tenant_id: ctx.tenantId, kind: n.kind, title: n.title, body: n.body || null, link: n.link, entity_type: n.entityType || null, entity_id: n.entityId || null };
  const list = [{ ...base, role: "admin" }];
  if (n.userId && UUID.test(str(n.userId))) list.push({ ...base, user_id: n.userId });
  await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: list }).catch(() => {});
}

/** Email the salesperson and the company's own address. Never from the demo company. */
async function emailStaff(ctx, userId, subject, lines, link) {
  if (!mailer || await isDemoTenant(ctx.tenantId)) return;
  const [rep, bs] = await Promise.all([
    userId && UUID.test(str(userId)) ? one(`sales_reps?user_id=eq.${userId}&tenant_id=eq.${ctx.tenantId}&select=email`).catch(() => null) : null,
    one(`business_settings?tenant_id=eq.${ctx.tenantId}&select=business_email`).catch(() => null),
  ]);
  const to = [...new Set([str(rep?.email), str(bs?.business_email)].filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).map((e) => e.toLowerCase()))];
  if (!to.length) return;
  const url = link ? `${await companyOrigin(ctx.tenantId)}${link}` : null;
  const text = `${lines.join("\n")}${url ? `\n\nOpen it: ${url}` : ""}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:560px">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}${url ? `<p><a href="${esc(url)}" style="background:#A8121B;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open in JMSURF Garage</a></p>` : ""}</div>`;
  await mailer(ctx.tenantId, { to, subject, text, html }).catch(() => null);
}

/** Email the customer (new reply, …). Never from the demo company. */
async function emailCustomer(ctx, customer, subject, lines, path) {
  if (!mailer || !customer?.email || await isDemoTenant(ctx.tenantId)) return null;
  const url = `${await companyOrigin(ctx.tenantId)}${path}`;
  const name = str(ctx.shop?.name) || "Your supplier";
  const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:560px"><h2 style="color:#A8121B">${esc(name)}</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${esc(url)}" style="background:#A8121B;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open your account</a></p></div>`;
  return mailer(ctx.tenantId, { to: customer.email, subject, text: `${lines.join("\n")}\n\n${url}`, html }).catch(() => null);
}

// ------------------------------------------------------------------ home extras
/** Added to the portal home (c/me): sections, open quotes, unread messages, pending contact change. */
export async function portalExtras(ctx) {
  const on = { ...(ctx.shop.sections || {}) };
  if (on.projects) on.projects = await moduleOn(ctx.tenantId, "projects");
  const [quotes, unread, pending] = await Promise.all([
    on.quotes ? rows(`quotes?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&status=eq.sent&select=id,quote_number,issue_date,valid_until,total,subject&order=issue_date.desc&limit=20`).catch(() => []) : [],
    on.messages ? rows(`portal_messages?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&sender=eq.staff&read_by_customer_at=is.null&select=id`).catch(() => []) : [],
    one(`customer_profile_updates?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&status=eq.pending&select=changes,created_at&order=created_at.desc&limit=1`).catch(() => null),
  ]);
  const t = today();
  return {
    sections: on,
    currency: ctx.shop.currency || "KES",
    open_quotes: quotes.filter((q) => !q.valid_until || q.valid_until >= t),
    unread_messages: unread.length,
    pending_update: pending,
    profile_review: !!ctx.shop.profile_review,
    preview: !!ctx.preview,
  };
}

// ------------------------------------------------------------------ quotes
async function quotes(ctx) {
  need(ctx, "quotes");
  const list = await rows(`quotes?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&status=in.(sent,accepted,declined,expired,invoiced)&select=id,quote_number,issue_date,valid_until,total,status,subject,salesperson_name,accepted_at,customer_signed_name,customer_comment,customer_responded_at,declined_at,decline_reason&order=issue_date.desc&limit=300`);
  const t = today();
  return {
    quotes: list.map((q) => {
      const expired = q.status === "expired" || (q.status === "sent" && !!q.valid_until && q.valid_until < t);
      return { ...q, total: Number(q.total || 0), status: expired ? "expired" : q.status, can_answer: q.status === "sent" && !expired };
    }),
  };
}

async function quoteRespond(ctx, b) {
  noPreview(ctx);
  need(ctx, "quotes");
  limit(`quote:${ctx.accountId}`, 12, 3600_000);
  const id = str(b.id);
  if (!UUID.test(id)) throw new HttpError(404, "Quote not found");
  const action = b.action === "accept" ? "accept" : b.action === "decline" ? "decline" : null;
  if (!action) throw new HttpError(400, "Accept or decline");
  const q = await one(`quotes?id=eq.${id}&tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&select=id,quote_number,status,valid_until,total,salesperson_id,customer_name`);
  if (!q) throw new HttpError(404, "Quote not found");
  if (q.status !== "sent") throw new HttpError(409, q.status === "accepted" || q.status === "invoiced" ? "This quote is already accepted" : q.status === "declined" ? "This quote is already declined" : "This quote is no longer open");
  if (q.valid_until && q.valid_until < today()) throw new HttpError(409, `This quote expired on ${niceDate(q.valid_until)}. Ask for a new one.`);
  const now = new Date().toISOString();
  let patch;
  if (action === "accept") {
    const name = clip(b.name, 120);
    if (!name || name.length < 3) throw new HttpError(400, "Type your full name to accept");
    patch = { status: "accepted", accepted_at: now, customer_signed_name: name, customer_comment: clip(b.comment, 1000), customer_responded_at: now, updated_at: now };
  } else {
    const reason = clip(b.reason, 1000);
    if (!reason) throw new HttpError(400, "Tell us why you are declining");
    patch = { status: "declined", declined_at: now, decline_reason: reason, customer_responded_at: now, updated_at: now };
  }
  // Only a quote that is still open changes (two taps or two tabs: the second one is refused).
  const done = await db(`quotes?id=eq.${q.id}&tenant_id=eq.${ctx.tenantId}&status=eq.sent`, { method: "PATCH", prefer: "return=representation", body: patch });
  if (!Array.isArray(done) || !done.length) throw new HttpError(409, "This quote was already answered");
  const money = `${ctx.shop.currency || "KES"} ${Number(q.total || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
  const who = str(q.customer_name) || "The customer";
  const title = action === "accept" ? `${who} accepted quote ${q.quote_number}` : `${who} declined quote ${q.quote_number}`;
  const body = action === "accept"
    ? `${money} · signed as ${patch.customer_signed_name}${patch.customer_comment ? ` · "${patch.customer_comment}"` : ""}`
    : `${money} · reason: ${patch.decline_reason}`;
  const link = `/sales/quotes/${q.id}`;
  await notifyStaff(ctx, { kind: action === "accept" ? "quote_accepted" : "quote_declined", title, body, link, userId: q.salesperson_id, entityType: "quote", entityId: q.id });
  await emailStaff(ctx, q.salesperson_id, title, [
    `${title} in the customer portal.`,
    action === "accept" ? `Amount: ${money}. Signed as: ${patch.customer_signed_name}.` : `Amount: ${money}.`,
    ...(action === "accept" && patch.customer_comment ? [`Comment: ${patch.customer_comment}`] : []),
    ...(action === "decline" ? [`Reason: ${patch.decline_reason}`] : []),
    ...(action === "accept" ? ["Convert it to a sales order or an invoice from the quote."] : []),
  ], link);
  return { ok: true, status: patch.status };
}

// ------------------------------------------------------------------ documents (view, print, PDF)
const DOC_TABLE = { quote: "quotes", invoice: "invoices", payment: "payments_received", credit_note: "credit_notes" };
const DOC_FIELDS = [
  "id", "tenant_id", "customer_id", "customer_name", "customer_phone", "customer_email", "items", "lots_applied", "subtotal", "tax", "discount",
  "adjustment", "shipping", "total", "amount_paid", "amount_applied", "amount_refunded", "status", "issue_date", "created_at", "updated_at", "due_date",
  "valid_until", "payment_terms", "reference", "salesperson_name", "subject", "customer_notes", "terms", "prices_include_tax", "custom",
  "quote_number", "invoice_number", "credit_note_number", "invoice_id", "reason", "payment_number", "payment_date", "amount", "method",
  "etims_status", "etims_signed_at", "etims_sdc_id", "etims_invc_no", "etims_internal_data", "etims_signature", "etims_qr_url", "etims_rcpt_no",
];
const BIZ_FIELDS = ["tenant_id", "business_name", "business_address", "postal_address", "business_phone", "business_email", "business_website", "tax_pin", "vat_number", "doc_contact", "theme", "mpesa_till_number", "mpesa_shortcode", "mpesa_account_reference", "bank_details"];

/**
 * Everything the app's document renderer (src/lib/docModels.ts) reads for one of the customer's own
 * documents, as table → rows. The browser renders and prints it exactly like staff see it.
 */
async function docData(ctx, b) {
  const kind = str(b.kind);
  const id = str(b.id);
  const table = DOC_TABLE[kind];
  if (!table || !UUID.test(id)) throw new HttpError(404, "Document not found");
  if (kind === "quote") need(ctx, "quotes");
  const select = kind === "payment" ? "*,payment_allocations(amount,invoices(invoice_number,issue_date,total))" : "*";
  const d = await one(`${table}?id=eq.${id}&tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&select=${enc(select)}`);
  const hidden = !d
    || (kind === "quote" && d.status === "draft")
    || (kind === "invoice" && ["draft", "void"].includes(d.status))
    || (kind === "credit_note" && !["open", "closed"].includes(d.status));
  if (hidden) throw new HttpError(404, "Document not found");
  const entity = kind === "credit_note" ? "credit_note" : kind;
  const [biz, tenant, tpl, cust, fields, sig, inv] = await Promise.all([
    // Only the fields documents print (never keys or mail settings): BIZ_FIELDS.
    one(`business_settings?tenant_id=eq.${ctx.tenantId}&select=*`).catch(() => null),
    one(`tenants?id=eq.${ctx.tenantId}&select=id,business_name,logo_url`),
    one(`document_templates?tenant_id=eq.${ctx.tenantId}&kind=eq.${enc(kind)}&select=kind,tenant_id,template,settings`).catch(() => null),
    one(`customers?id=eq.${ctx.customerId}&select=id,name,phone,alt_phone,email,address,area,building,company_name,kra_pin`),
    d.custom && typeof d.custom === "object" && Object.keys(d.custom).length
      ? rows(`custom_fields?tenant_id=eq.${ctx.tenantId}&entity=eq.${entity}&is_active=eq.true&show_on_pdf=eq.true&select=id,label,field_type,sort,created_at&order=sort,created_at`).catch(() => [])
      : [],
    kind === "payment" ? null : one(`signature_requests?tenant_id=eq.${ctx.tenantId}&doc_type=eq.${enc(kind)}&doc_id=eq.${id}&status=eq.signed&select=signed_by,signed_by_name,signed_at&order=signed_at.desc&limit=1`).catch(() => null),
    kind === "credit_note" && d.invoice_id ? one(`invoices?id=eq.${d.invoice_id}&tenant_id=eq.${ctx.tenantId}&select=id,invoice_number,issue_date,etims_sdc_id,etims_invc_no`).catch(() => null) : null,
  ]);
  const row = pick(d, DOC_FIELDS);
  // Only custom fields printed on the document travel to the browser.
  if (row.custom) row.custom = Object.fromEntries(Object.entries(row.custom).filter(([k]) => fields.some((f) => f.id === k)));
  if (kind === "payment") row.payment_allocations = (d.payment_allocations || []).map((a) => ({ amount: a.amount, invoices: a.invoices ? pick(a.invoices, ["invoice_number", "issue_date", "total"]) : null }));
  const signed = {};
  let userSig = null;
  if (sig?.signed_by) {
    userSig = await one(`user_signatures?user_id=eq.${sig.signed_by}&select=user_id,full_name,title,signature_path,stamp_path`).catch(() => null);
    for (const p of [userSig?.signature_path, userSig?.stamp_path]) if (p) signed[p] = await signFile(p);
  }
  return {
    kind, id, currency: ctx.shop.currency || "KES",
    tables: {
      [table]: [row],
      business_settings_safe: biz ? [{ ...pick(biz, BIZ_FIELDS), tenant_id: ctx.tenantId }] : [],
      tenants: tenant ? [tenant] : [],
      document_templates: tpl ? [tpl] : [],
      customers: cust ? [cust] : [],
      custom_fields: fields.map((f) => ({ ...f, tenant_id: ctx.tenantId, entity, is_active: true, show_on_pdf: true })),
      signature_requests: sig ? [{ ...sig, doc_type: kind, doc_id: id, status: "signed" }] : [],
      user_signatures: userSig ? [userSig] : [],
      ...(inv ? { invoices: [inv] } : {}),
    },
    signed,
  };
}

/** The invoice's Pay now link (paylinks.js): the one payment page for M-Pesa and card. */
async function invoicePayLink(ctx, b) {
  noPreview(ctx);
  const id = str(b.invoice_id);
  if (!UUID.test(id)) throw new HttpError(404, "Invoice not found");
  const inv = await one(`invoices?id=eq.${id}&tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&select=id,status,total,amount_paid`);
  if (!inv || ["draft", "void"].includes(inv.status)) throw new HttpError(404, "Invoice not found");
  if (Number(inv.total) - Number(inv.amount_paid || 0) < 0.995) throw new HttpError(409, "This invoice is already paid");
  const url = await payLinkUrl(ctx.tenantId, inv.id);
  if (!url) throw new HttpError(409, "Online payment is not available for this invoice");
  return { url };
}

// ------------------------------------------------------------------ messages
const MSG_COLS = "id,sender,staff_name,body,attachment_name,attachment_mime,attachment_size,created_at,read_by_customer_at,read_by_staff_at";
const FILE_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|gif)|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel))$/;
const MAX_FILE = 5 * 1024 * 1024;

async function messages(ctx) {
  need(ctx, "messages");
  const list = await rows(`portal_messages?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&select=${MSG_COLS}&order=created_at.asc&limit=500`);
  // Staff replies count as read once the customer opens the thread (never in a staff preview).
  if (!ctx.preview && list.some((m) => m.sender === "staff" && !m.read_by_customer_at)) {
    await db(`portal_messages?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&sender=eq.staff&read_by_customer_at=is.null`, { method: "PATCH", prefer: "return=minimal", body: { read_by_customer_at: new Date().toISOString() } }).catch(() => {});
  }
  return { messages: list };
}

async function messageSend(ctx, b) {
  noPreview(ctx);
  need(ctx, "messages");
  limit(`pmsg:${ctx.accountId}`, 20, 600_000);
  const body = str(b.body).slice(0, 4000);
  let file = null;
  if (b.file && typeof b.file === "object") {
    const name = str(b.file.name).replace(/[^\w.\- ]+/g, "-").slice(0, 120) || "file";
    const type = str(b.file.type).toLowerCase();
    if (!FILE_TYPES.test(type)) throw new HttpError(400, "Send a PDF, a picture, or a Word or Excel file");
    const buf = Buffer.from(str(b.file.data).replace(/^data:[^,]*,/, ""), "base64");
    if (!buf.length) throw new HttpError(400, "The file is empty");
    if (buf.length > MAX_FILE) throw new HttpError(400, "Files up to 5 MB");
    const path = `${ctx.tenantId}/portal/${ctx.customerId}/${Date.now()}-${name.replace(/\s+/g, "-").toLowerCase()}`;
    await putFile(path, buf, type);
    file = { attachment_path: path, attachment_name: name, attachment_mime: type, attachment_size: buf.length };
  }
  if (!body && !file) throw new HttpError(400, "Write your message");
  const [msg] = await db("portal_messages", { method: "POST", prefer: "return=representation", body: { tenant_id: ctx.tenantId, customer_id: ctx.customerId, sender: "customer", body, ...(file || {}) } });
  const c = await one(`customers?id=eq.${ctx.customerId}&select=name,salesperson_id`);
  const who = str(c?.name) || "A customer";
  const link = `/customers/${ctx.customerId}?tab=messages`;
  const preview = body ? body.slice(0, 160) : `Sent a file: ${file?.attachment_name}`;
  await notifyStaff(ctx, { kind: "portal_message", title: `Message from ${who}`, body: preview, link, userId: c?.salesperson_id, entityType: "customer", entityId: ctx.customerId });
  // One email per conversation burst: only when the customer had no unread message waiting already.
  const waiting = await rows(`portal_messages?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&sender=eq.customer&read_by_staff_at=is.null&id=neq.${msg.id}&select=id&limit=1`).catch(() => []);
  if (!waiting.length) await emailStaff(ctx, c?.salesperson_id, `Message from ${who}`, [`${who} wrote in the customer portal:`, body || `(a file: ${file?.attachment_name})`, "Reply from the customer's page, Messages tab."], link);
  return { message: pick(msg, MSG_COLS.split(",")) };
}

async function messageFile(ctx, b) {
  need(ctx, "messages");
  const id = str(b.id);
  if (!UUID.test(id)) throw new HttpError(404, "File not found");
  const m = await one(`portal_messages?id=eq.${id}&tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&select=attachment_path,attachment_name,attachment_mime`);
  if (!m?.attachment_path) throw new HttpError(404, "File not found");
  const url = await signFile(m.attachment_path);
  if (!url) throw new HttpError(502, "The file could not be opened. Try again.");
  return { url, name: m.attachment_name, mime: m.attachment_mime };
}

// ------------------------------------------------------------------ shared documents
async function documents(ctx) {
  need(ctx, "documents");
  return { documents: await rows(`documents?tenant_id=eq.${ctx.tenantId}&entity_type=eq.customer&entity_id=eq.${ctx.customerId}&shared_with_customer=eq.true&select=id,name,category,mime_type,size_bytes,created_at,shared_at,expires_on&order=created_at.desc&limit=300`) };
}
async function documentOpen(ctx, b) {
  need(ctx, "documents");
  const id = str(b.id);
  if (!UUID.test(id)) throw new HttpError(404, "File not found");
  const d = await one(`documents?id=eq.${id}&tenant_id=eq.${ctx.tenantId}&entity_type=eq.customer&entity_id=eq.${ctx.customerId}&shared_with_customer=eq.true&select=name,path,url,mime_type`);
  if (!d) throw new HttpError(404, "File not found");
  const url = d.path ? await signFile(d.path) : /^https:\/\//.test(str(d.url)) ? d.url : null;
  if (!url) throw new HttpError(502, "The file could not be opened. Try again.");
  return { url, name: d.name, mime: d.mime_type };
}

// ------------------------------------------------------------------ projects
const PROJECT_STAGE = { planning: "Planning", active: "In progress", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };
async function projects(ctx) {
  need(ctx, "projects");
  if (!(await moduleOn(ctx.tenantId, "projects"))) throw new HttpError(404, "This part of the portal is switched off");
  const list = await rows(`app_records?tenant_id=eq.${ctx.tenantId}&app=eq.projects&kind=eq.project&customer_id=eq.${ctx.customerId}&archived=eq.false&select=id,number,title,stage,starts_at,due_date,updated_at&order=created_at.desc&limit=100`);
  const ids = list.map((p) => p.id);
  const kids = ids.length ? await rows(`app_records?tenant_id=eq.${ctx.tenantId}&parent_id=in.(${ids.join(",")})&kind=in.(task,milestone)&archived=eq.false&select=parent_id,kind,title,stage,due_date&order=due_date.asc.nullslast&limit=5000`) : [];
  return {
    projects: list.map((p) => {
      const tasks = kids.filter((k) => k.parent_id === p.id && k.kind === "task");
      const done = tasks.filter((k) => k.stage === "done").length;
      return {
        id: p.id, number: p.number, title: p.title, stage: p.stage, stage_label: PROJECT_STAGE[p.stage] || str(p.stage).replace(/_/g, " "),
        starts_at: p.starts_at, due_date: p.due_date, updated_at: p.updated_at,
        tasks: tasks.length, tasks_done: done,
        progress: p.stage === "completed" ? 100 : tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        milestones: kids.filter((k) => k.parent_id === p.id && k.kind === "milestone").map((m) => ({ title: m.title, due_date: m.due_date, reached: m.stage === "reached" })),
      };
    }),
  };
}

// ------------------------------------------------------------------ contact details
const PROFILE_KEYS = ["name", "phone", "email", "alt_phone", "company_name", "kra_pin", "address", "area", "building", "landmark"];

/** Phone digits that another portal account of the company already signs in with. */
async function phoneTaken(tenantId, customerId, digits) {
  const clash = await one(`customer_accounts?tenant_id=eq.${tenantId}&phone=eq.${digits}&customer_id=neq.${customerId}&select=id`);
  return !!clash;
}

/** Writes contact changes to the customer (and the sign-in phone to the account). */
async function writeProfile(tenantId, customerId, changes) {
  const patch = { ...changes };
  if (patch.phone) {
    const digits = phoneDigits(patch.phone);
    if (!digits) throw new HttpError(400, "That phone number is not valid");
    if (await phoneTaken(tenantId, customerId, digits)) throw new HttpError(409, "Another customer account already uses this phone number");
    patch.phone = localPhone(digits);
    await db(`customer_accounts?tenant_id=eq.${tenantId}&customer_id=eq.${customerId}`, { method: "PATCH", prefer: "return=minimal", body: { phone: digits } });
  }
  if (Object.keys(patch).length) await db(`customers?id=eq.${customerId}&tenant_id=eq.${tenantId}`, { method: "PATCH", prefer: "return=minimal", body: patch });
}

/**
 * Contact changes from the portal. Only changed fields count. With "changes wait for approval" on
 * (System → Customer portal) they are kept for staff to approve; otherwise they apply now and staff
 * are told. As before, details sent after the company asked for more put the customer back to pending.
 */
export async function applyProfilePatch(ctx, patch) {
  noPreview(ctx);
  const cur = await one(`customers?id=eq.${ctx.customerId}&tenant_id=eq.${ctx.tenantId}&select=${PROFILE_KEYS.join(",")},approval_status,salesperson_id`);
  if (!cur) throw new HttpError(404, "Customer not found");
  const curPhone = phoneDigits(cur.phone);
  const changes = {};
  for (const k of PROFILE_KEYS) {
    if (patch[k] === undefined) continue;
    if (k === "phone") { if (patch.phone && patch.phone !== curPhone) changes.phone = localPhone(patch.phone); continue; }
    if (str(patch[k]) !== str(cur[k])) changes[k] = patch[k] === "" ? null : patch[k];
  }
  if (!Object.keys(changes).length) return { changed: false };
  if (changes.phone && await phoneTaken(ctx.tenantId, ctx.customerId, phoneDigits(changes.phone))) throw new HttpError(409, "Another customer account already uses this phone number");
  const link = `/customers/${ctx.customerId}?tab=online%20account`;
  const who = str(cur.name) || "A customer";
  if (ctx.shop.profile_review) {
    limit(`profile:${ctx.customerId}`, 10, 3600_000);
    await db(`customer_profile_updates?tenant_id=eq.${ctx.tenantId}&customer_id=eq.${ctx.customerId}&status=eq.pending`, { method: "PATCH", prefer: "return=minimal", body: { status: "replaced" } });
    await db("customer_profile_updates", { method: "POST", prefer: "return=minimal", body: { tenant_id: ctx.tenantId, customer_id: ctx.customerId, changes, previous: pick(cur, Object.keys(changes)) } });
    await notifyStaff(ctx, { kind: "customer_update", title: `${who} sent new contact details`, body: "Review and approve them.", link, userId: cur.salesperson_id, entityType: "customer", entityId: ctx.customerId });
    return { changed: true, pending: true };
  }
  await writeProfile(ctx.tenantId, ctx.customerId, changes);
  if (cur.approval_status === "info_requested") {
    await db(`customers?id=eq.${ctx.customerId}&tenant_id=eq.${ctx.tenantId}`, { method: "PATCH", prefer: "return=minimal", body: { approval_status: "pending" } });
    await notifyStaff(ctx, { kind: "customer_signup", title: `${who} updated their details`, body: "Review and approve the customer.", link, userId: cur.salesperson_id, entityType: "customer", entityId: ctx.customerId });
  } else {
    await notifyStaff(ctx, { kind: "customer_update", title: `${who} updated their contact details`, body: Object.keys(changes).map((k) => k.replace(/_/g, " ")).join(", "), link, userId: cur.salesperson_id, entityType: "customer", entityId: ctx.customerId });
  }
  return { changed: true, pending: false };
}

// ------------------------------------------------------------------ routes
/** Read-only handlers: also used by staff "View as customer". */
const READ = {
  me: (ctx) => meFor(ctx),
  statement: (ctx, b) => statementOf(ctx.customerId, b),
  quotes, doc: docData, messages, "message/file": messageFile, documents, "document/open": documentOpen, projects,
};

/** Customer routes (/api/shop/c/*), signed in with the customer session. */
const asCustomer = (fn) => async (req, b) => {
  const { account, shop } = await signedIn(req);
  if (!shop.portal) throw new HttpError(403, PORTAL_CLOSED);
  return fn({ tenantId: shop.id, customerId: account.customer_id, accountId: account.id, shop, preview: false }, b || {});
};
export const portalCustomerRoutes = {
  "/api/shop/c/quotes": asCustomer(quotes),
  "/api/shop/c/quote/respond": asCustomer(quoteRespond),
  "/api/shop/c/doc": asCustomer(docData),
  "/api/shop/c/invoice/pay-link": asCustomer(invoicePayLink),
  "/api/shop/c/messages": asCustomer(messages),
  "/api/shop/c/message/send": asCustomer(messageSend),
  "/api/shop/c/message/file": asCustomer(messageFile),
  "/api/shop/c/documents": asCustomer(documents),
  "/api/shop/c/document/open": asCustomer(documentOpen),
  "/api/shop/c/projects": asCustomer(projects),
};
export const isPortalUpload = (pathname) => pathname === "/api/shop/c/message/send";

// ------------------------------------------------------------------ staff
const mayServe = (who) => who.manager || who.roles.includes("cashier") || who.roles.includes("sales_person") || who.roles.includes("accountant");

async function staffCustomer(who, id) {
  if (!UUID.test(str(id))) throw new HttpError(404, "Customer not found");
  const c = await one(`customers?id=eq.${id}&tenant_id=eq.${who.tenantId}&select=id,name,email,phone`);
  if (!c) throw new HttpError(404, "Customer not found");
  return c;
}

/** "View as customer": the portal exactly as this customer sees it, read-only. */
async function preview(who, b) {
  if (!mayServe(who)) throw new HttpError(403, "Not allowed");
  const c = await staffCustomer(who, b.customer_id);
  const fn = READ[str(b.route)];
  if (!fn) throw new HttpError(403, PREVIEW_ONLY);
  return runForTenant(who.tenantId, (shop) => fn({ tenantId: who.tenantId, customerId: c.id, accountId: null, shop, preview: true }, b.body && typeof b.body === "object" ? b.body : {}));
}

/** Staff reply in the customer's thread (from the customer page); the customer is emailed. */
async function reply(who, b) {
  if (!mayServe(who)) throw new HttpError(403, "Not allowed");
  const c = await staffCustomer(who, b.customer_id);
  const body = str(b.body).slice(0, 4000);
  const path = str(b.file_path);
  let file = null;
  if (path) {
    if (!path.startsWith(`${who.tenantId}/portal/${c.id}/`) || path.includes("..")) throw new HttpError(400, "That file is not in this customer's folder");
    file = { attachment_path: path, attachment_name: clip(b.file_name, 120) || path.split("/").pop(), attachment_mime: clip(b.file_mime, 100), attachment_size: Number(b.file_size) || null };
  }
  if (!body && !file) throw new HttpError(400, "Write your reply");
  const me = await one(`profiles?user_id=eq.${who.user.id}&select=display_name`).catch(() => null);
  const [msg] = await db("portal_messages", { method: "POST", prefer: "return=representation", body: { tenant_id: who.tenantId, customer_id: c.id, sender: "staff", staff_user_id: who.user.id, staff_name: clip(me?.display_name, 120) || "Staff", body, ...(file || {}) } });
  const now = new Date().toISOString();
  await db(`portal_messages?tenant_id=eq.${who.tenantId}&customer_id=eq.${c.id}&sender=eq.customer&read_by_staff_at=is.null`, { method: "PATCH", prefer: "return=minimal", body: { read_by_staff_at: now } }).catch(() => {});
  const emailed = await runForTenant(who.tenantId, async (shop) => {
    const acc = await one(`customer_accounts?customer_id=eq.${c.id}&tenant_id=eq.${who.tenantId}&is_active=eq.true&select=id`).catch(() => null);
    if (!acc || !shop.portal) return null;
    return emailCustomer({ tenantId: who.tenantId, shop }, c, `${shop.name}: a new message for you`, [`Hi ${str(c.name).split(" ")[0] || "there"}, you have a new message from ${shop.name}:`, body || `(a file: ${file?.attachment_name})`, "Reply in your account."], "/account/messages");
  }).catch(() => null);
  return { message: msg, emailed: !!emailed?.ok };
}

/** Approve or reject contact changes a customer sent from the portal. */
async function profileReview(who, b) {
  if (!mayServe(who)) throw new HttpError(403, "Not allowed");
  const id = str(b.id);
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
  const u = await one(`customer_profile_updates?id=eq.${id}&tenant_id=eq.${who.tenantId}&status=eq.pending&select=id,customer_id,changes`);
  if (!u) throw new HttpError(404, "This change was already reviewed");
  const approve = b.approve === true;
  if (approve) {
    const changes = Object.fromEntries(Object.entries(u.changes || {}).filter(([k]) => PROFILE_KEYS.includes(k)));
    await writeProfile(who.tenantId, u.customer_id, changes);
  }
  await db(`customer_profile_updates?id=eq.${u.id}&status=eq.pending`, { method: "PATCH", prefer: "return=minimal", body: { status: approve ? "approved" : "rejected", review_note: clip(b.note, 500), reviewed_by: who.user.id, reviewed_at: new Date().toISOString() } });
  return { ok: true };
}

export const portalStaffRoutes = {
  "/api/erp/portal/preview": preview,
  "/api/erp/portal/reply": reply,
  "/api/erp/portal/profile-review": profileReview,
};
