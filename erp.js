import { APP_ORIGIN, publicBase } from "./hosts.js";
// ---------------------------------------------------------------------------
// ERP server jobs and staff actions:
//
//  * Customer statements: one ledger (invoices, payments, credit notes) used
//    by the customer portal, by "Email statement" in the ERP and by the
//    automatic month-end / chosen-dates emails (System → Customer statements).
//  * Backups: automatic (hourly … weekly) and manual JSON backups of every
//    module in the private "tenant-backups" bucket, download links, full
//    download and restoring one module (rows are upserted, nothing deleted).
//  * Customer portal admin: reset a customer's portal password, approve
//    website sign-ups and ask a customer for more details.
// ---------------------------------------------------------------------------
import { gzipSync, gunzipSync } from "node:zlib";
import { randomInt } from "node:crypto";
import { sendForShop } from "./messaging.js";
import { hashPassword, phoneDigits, HttpError as ShopError } from "./shop.js";
import { portalStaffRoutes } from "./portal.js";
import { pushInvoiceForShop, invoicePromptStatus } from "./sendmoney.js";
import { payLinkUrl } from "./paylinks.js";
import { etimsRoutes, EtimsError, startEtimsJobs } from "./etims.js";
import { migrateRoutes, MigrateError } from "./migrate.js";
import { engageRoutes, EngageError } from "./engage.js";
import { withPlatformRole } from "./platform.js";
import { s3Put, s3Delete } from "./s3.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
const PORTAL_ORIGIN = APP_ORIGIN;
const BUCKET = "tenant-backups";
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const money = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

let deliverEmail = null;

async function db(path, { method = "GET", body, prefer = "return=representation", headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(60000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer, ...headers },
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

/** Nairobi date and hour now. */
function nairobiNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}
const niceDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The company's customer pages (custom domain when live, else app.jmsurfgarage.co.ke/<slug>): links in SMS and emails. */
const portalOrigin = (tenantId) => publicBase(tenantId);
async function erpSettings(tenantId) {
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=id,erp_settings,business_name,business_phone,business_email,business_address,currency,mpesa_till_number,mpesa_shortcode,mpesa_account_reference,bank_details`);
  if (s) s.portal_origin = await portalOrigin(tenantId);
  return s;
}
async function saveErpSection(tenantId, key, value) {
  const s = await one(`business_settings?tenant_id=eq.${tenantId}&select=id,erp_settings`);
  if (!s) return;
  await db(`business_settings?id=eq.${s.id}`, { method: "PATCH", prefer: "return=minimal", body: { erp_settings: { ...(s.erp_settings || {}), [key]: value } } });
}

// =========================================================================
// Statements
// =========================================================================

/** Ledger for one customer between two dates (YYYY-MM-DD), with opening and closing balances. */
export async function statementFor(customerId, from, to) {
  const [inv, pay, cn] = await Promise.all([
    rows(`invoices?customer_id=eq.${customerId}&status=not.in.(draft,void)&select=id,invoice_number,issue_date,due_date,total,amount_paid,status&order=issue_date.asc`),
    rows(`payments_received?customer_id=eq.${customerId}&select=id,payment_number,payment_date,amount,method,reference&order=payment_date.asc`),
    rows(`credit_notes?customer_id=eq.${customerId}&status=in.(open,closed)&select=id,credit_note_number,issue_date,total,amount_refunded,reason&order=issue_date.asc`),
  ]);
  const all = [
    ...inv.map((i) => ({ date: str(i.issue_date), kind: "invoice", ref: i.invoice_number, detail: i.due_date ? `Due ${niceDate(i.due_date)}` : "", debit: Number(i.total || 0), credit: 0, id: i.id })),
    ...pay.map((p) => ({ date: str(p.payment_date), kind: "payment", ref: p.payment_number, detail: `${str(p.method).replace(/_/g, " ")}${p.reference ? ` · ${p.reference}` : ""}`, debit: 0, credit: Number(p.amount || 0), id: p.id })),
    ...cn.map((c) => ({ date: str(c.issue_date), kind: "credit_note", ref: c.credit_note_number, detail: str(c.reason), debit: 0, credit: Number(c.total || 0) - Number(c.amount_refunded || 0), id: c.id })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1));
  const opening = all.filter((l) => l.date < from).reduce((s, l) => s + l.debit - l.credit, 0);
  let running = opening;
  const lines = all.filter((l) => l.date >= from && l.date <= to).map((l) => ({ ...l, balance: (running += l.debit - l.credit) }));
  const invoiced = lines.reduce((s, l) => s + l.debit, 0);
  const received = lines.reduce((s, l) => s + l.credit, 0);
  const today = nairobiNow().date;
  const open = inv.filter((i) => Number(i.total) - Number(i.amount_paid) > 0.005 && i.status !== "paid");
  return {
    from, to, opening, invoiced, received, closing: opening + invoiced - received, lines,
    due_now: open.filter((i) => i.due_date && str(i.due_date) <= today).reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0),
    outstanding: open.reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0),
  };
}

function statementHtml(shop, customer, st, message) {
  const ccy = shop.currency || "KES";
  const rowsHtml = st.lines.map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${niceDate(l.date)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(l.kind === "invoice" ? "Invoice" : l.kind === "payment" ? "Payment" : "Credit note")} ${esc(l.ref)}<div style="color:#888;font-size:12px">${esc(l.detail)}</div></td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${l.debit ? money(l.debit) : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${l.credit ? money(l.credit) : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(l.balance)}</td></tr>`).join("");
  const pay = [shop.mpesa_till_number && `M-Pesa Till ${shop.mpesa_till_number}`, shop.mpesa_shortcode && `Paybill ${shop.mpesa_shortcode}${shop.mpesa_account_reference ? `, account ${shop.mpesa_account_reference}` : ""}`, shop.bank_details].filter(Boolean).map(esc).join("<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#1f1a17">
  <div style="background:#A8121B;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><div style="font-size:20px;font-weight:bold">${esc(shop.business_name)}</div><div style="opacity:.85">Statement of account</div></div>
  <div style="border:1px solid #eee;border-top:0;padding:20px 24px;border-radius:0 0 12px 12px">
  <p>Dear ${esc(customer.name)},</p>
  ${message ? `<p>${esc(message)}</p>` : ""}
  <p>Here is your statement for <b>${niceDate(st.from)} – ${niceDate(st.to)}</b>.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0"><tr><td>Opening balance</td><td style="text-align:right">${ccy} ${money(st.opening)}</td></tr><tr><td>Invoiced</td><td style="text-align:right">${ccy} ${money(st.invoiced)}</td></tr><tr><td>Payments & credits</td><td style="text-align:right">${ccy} ${money(st.received)}</td></tr><tr><td style="font-weight:bold;padding-top:6px">Balance due</td><td style="text-align:right;font-weight:bold;font-size:18px;color:#A8121B;padding-top:6px">${ccy} ${money(st.closing)}</td></tr></table>
  ${st.lines.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#faf6f2;text-align:left"><th style="padding:6px 8px">Date</th><th style="padding:6px 8px">Transaction</th><th style="padding:6px 8px;text-align:right">Charges</th><th style="padding:6px 8px;text-align:right">Credits</th><th style="padding:6px 8px;text-align:right">Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : "<p>No transactions in this period.</p>"}
  ${pay ? `<p style="margin-top:16px"><b>How to pay</b><br>${pay}</p>` : ""}
  <p style="margin-top:16px"><a href="${shop?.portal_origin || PORTAL_ORIGIN}/portal/login" style="background:#A8121B;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">View your account online</a></p>
  <p style="color:#888;font-size:12px;margin-top:20px">${esc(shop.business_name)}${shop.business_phone ? ` · ${esc(shop.business_phone)}` : ""}${shop.business_email ? ` · ${esc(shop.business_email)}` : ""}</p></div></div>`;
}

async function logEmail(tenantId, to, subject, ok, detail, userId) {
  await db("email_logs", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, recipient: to, subject, status: ok ? "sent" : "failed", smtp_response: str(detail).slice(0, 500), channel: "email", sent_by: userId || null } }).catch(() => {});
}

/** Emails (and optionally SMSes) one customer's statement. */
async function sendStatement(tenantId, customerId, from, to, { message = "", sms = false, email = true, userId = null } = {}) {
  const [shop, customer] = await Promise.all([erpSettings(tenantId), one(`customers?id=eq.${customerId}&tenant_id=eq.${tenantId}&select=id,name,email,phone`)]);
  if (!customer) throw new HttpError(404, "Customer not found");
  const st = await statementFor(customerId, from, to);
  const out = { email: null, sms: null, closing: st.closing };
  if (email) {
    if (!customer.email) out.email = { ok: false, error: "No email address on this customer" };
    else if (!deliverEmail) out.email = { ok: false, error: "Email is not set up" };
    else {
      const subject = `${shop.business_name}: statement ${niceDate(from)} – ${niceDate(to)}`;
      const r = await deliverEmail(tenantId, { purpose: "statements", to: customer.email, subject, html: statementHtml(shop, customer, st, message), text: `Your balance due is ${shop.currency || "KES"} ${money(st.closing)}. View it at ${shop?.portal_origin || PORTAL_ORIGIN}/portal/login` });
      out.email = r?.ok ? { ok: true } : { ok: false, error: r?.error || "Not sent" };
      await logEmail(tenantId, customer.email, subject, !!r?.ok, r?.error || r?.response, userId);
    }
  }
  if (sms && customer.phone) {
    out.sms = await sendForShop({ tenantId, channel: "sms", to: customer.phone, userId, text: `${shop.business_name}: Hi ${str(customer.name).split(" ")[0]}, your statement to ${niceDate(to)} shows a balance of ${shop.currency || "KES"} ${money(st.closing)}. View it any time at ${shop?.portal_origin || PORTAL_ORIGIN}/portal/login` }).catch((e) => ({ ok: false, error: e.message }));
  }
  return out;
}

/** Hourly: send scheduled statements once per scheduled day. */
async function statementTick() {
  const now = nairobiNow();
  const tenants = await rows("business_settings?select=tenant_id,erp_settings");
  for (const t of tenants) {
    const cfg = t.erp_settings?.statements;
    if (!cfg?.enabled || now.hour < Number(cfg.hour ?? 8)) continue;
    const lastDay = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();
    const due = cfg.schedule === "days" ? (cfg.days || []).map(Number).includes(now.d) : now.d === lastDay;
    if (!due || t.erp_settings?.statements_state?.last === now.date) continue;
    await saveErpSection(t.tenant_id, "statements_state", { last: now.date, started_at: new Date().toISOString() });
    const from = `${now.y}-${String(now.m).padStart(2, "0")}-01`;
    const customers = await rows(`customers?tenant_id=eq.${t.tenant_id}&select=id,email,phone,balance&limit=5000`);
    let sent = 0;
    for (const c of customers) {
      if (cfg.email !== false && !c.email && !(cfg.sms && c.phone)) continue;
      try {
        const st = await statementFor(c.id, from, now.date);
        if (cfg.only_with_balance !== false ? st.closing <= 0.5 : (!st.lines.length && Math.abs(st.closing) < 0.5)) continue;
        await sendStatement(t.tenant_id, c.id, from, now.date, { message: str(cfg.message), sms: !!cfg.sms, email: cfg.email !== false });
        sent++;
      } catch (e) { console.error("[statements]", c.id, e.message); }
    }
    await saveErpSection(t.tenant_id, "statements_state", { last: now.date, sent, finished_at: new Date().toISOString() });
  }
}

// =========================================================================
// Backups
// =========================================================================

/** Tables per module, parents first. [table, upsert conflict column(s)]. Every table is scoped to the company. */
export const BACKUP_MODULES = {
  settings: { label: "Settings & documents", tables: [["business_settings"], ["document_templates"], ["locations"], ["user_branches", "user_id,location_id"], ["doc_sequences", "tenant_id,kind"], ["app_sequences"], ["tenant_themes"]] },
  customers: { label: "Customers", tables: [["customers"], ["customer_pets"], ["customer_reminders"], ["customer_accounts"]] },
  inventory: { label: "Items & stock", tables: [["product_categories"], ["product_subcategories"], ["product_units"], ["products"], ["product_variants"], ["product_stocks"], ["composite_components"], ["product_bundles"], ["product_bundle_items"], ["price_lists"], ["price_list_items"], ["services"], ["product_batches"], ["stock_adjustments"], ["inventory_adjustments"], ["stock_counts"], ["stock_count_lines"]] },
  warehouse: { label: "Warehouse & shipping", tables: [["wh_bins"], ["wh_reorder_rules"], ["wh_transfers"], ["wh_packages"], ["delivery_notes"], ["packing_lists"], ["sample_issues"]] },
  sales: { label: "Sales", tables: [["sales_reps", "user_id"], ["commission_rules"], ["transactions"], ["quotes"], ["sales_orders"], ["invoices"], ["payments_received"], ["payment_allocations"], ["credit_notes"], ["credit_note_applications"], ["sale_returns"], ["online_orders"], ["layaways"], ["open_bills"], ["commission_payouts"]] },
  purchases: { label: "Purchases & supply chain", tables: [["suppliers"], ["expense_categories"], ["bill_categories"], ["purchases"], ["purchase_items"], ["purchase_receives"], ["bills"], ["bill_payments"], ["supplier_payments"], ["vendor_credits"], ["expenses"], ["requisitions"], ["requisition_items"], ["requisition_events"], ["rfqs"], ["rfq_quotes"], ["landed_costs"]] },
  accounting: { label: "Accounting", tables: [["chart_of_accounts"], ["tenant_bank_accounts"], ["journals"], ["journal_lines"], ["budgets"], ["bank_transactions"]] },
  crm: { label: "CRM", tables: [["crm_stages"], ["crm_tags"], ["crm_teams"], ["crm_lost_reasons"], ["crm_activity_types"], ["crm_campaigns"], ["crm_leads"], ["crm_deals"], ["crm_activities"], ["crm_messages"]] },
  hrm: { label: "HRM & payroll", tables: [["hr_departments"], ["hr_designations"], ["hr_employees"], ["hr_pay_items"], ["hr_leave_types"], ["hr_leave_requests"], ["hr_attendance"], ["hr_payroll_runs"], ["hr_payslips"], ["hr_loans"], ["hr_loan_repayments"], ["hr_holidays"], ["hr_disciplinary"], ["hr_documents"], ["hr_appraisals"]] },
  work: { label: "Projects, apps & calendar", tables: [["app_definitions"], ["app_records"], ["app_record_events"], ["approval_requests"], ["calendar_events"], ["documents"]] },
  service: { label: "Service & call centre", tables: [["support_tickets"], ["support_ticket_messages"], ["cc_queues"], ["cc_agents"], ["cc_calls"], ["cc_callbacks"]] },
};

/** Tables without a tenant_id column: their rows belong to the company through a parent record. */
const PARENT = { product_stocks: ["product_id", "products"], stock_count_lines: ["count_id", "stock_counts"], purchase_items: ["purchase_id", "purchases"] };

async function parentIds(tenantId, parent) {
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const batch = await db(`${parent}?tenant_id=eq.${tenantId}&select=id`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!Array.isArray(batch)) break;
    ids.push(...batch.map((x) => x.id));
    if (batch.length < 1000) break;
  }
  return ids;
}

async function dumpTable(tenantId, table) {
  const out = [];
  const pull = async (filter) => {
    for (let from = 0; ; from += 1000) {
      const batch = await db(`${table}?${filter}&select=*`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
      if (!Array.isArray(batch)) break;
      out.push(...batch);
      if (batch.length < 1000) break;
    }
  };
  const p = PARENT[table];
  if (!p) { await pull(`tenant_id=eq.${tenantId}`); return out; }
  const ids = await parentIds(tenantId, p[1]);
  for (let i = 0; i < ids.length; i += 150) await pull(`${p[0]}=in.(${ids.slice(i, i + 150).join(",")})`);
  return out;
}

async function buildBackup(tenantId, only = null) {
  const data = { format: "garage-erp-backup", version: 2, tenant_id: tenantId, created_at: new Date().toISOString(), modules: {} };
  const counts = {};
  for (const [mod, def] of Object.entries(BACKUP_MODULES)) {
    if (only?.length && !only.includes(mod)) continue;
    data.modules[mod] = {};
    for (const [table] of def.tables) {
      try {
        const r = await dumpTable(tenantId, table);
        data.modules[mod][table] = r;
        counts[table] = r.length;
      } catch (e) { counts[table] = `error: ${e.message}`.slice(0, 120); }
    }
  }
  return { data, counts };
}

async function storage(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/${path}`, { method, body, signal: AbortSignal.timeout(120000), headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...headers } });
  if (!res.ok) throw new Error(`Storage replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** The company's own storage (System → Backup → Your own storage), with its secret; null when off. */
async function remoteFor(tenantId, cfg) {
  const r = cfg?.remote;
  if (!r?.enabled || !r.bucket || !r.access_key_id) return null;
  const secret = (await one(`integration_secrets?tenant_id=eq.${tenantId}&name=eq.backup_s3_secret&select=value`))?.value;
  if (!secret) return null;
  return { provider: r.provider, endpoint: r.endpoint, region: r.region, account: r.account, bucket: r.bucket, prefix: str(r.prefix).replace(/^\/+|\/+$/g, ""), accessKeyId: r.access_key_id, secret };
}
const remoteKey = (remote, path) => [remote.prefix, path.split("/").pop()].filter(Boolean).join("/");

async function createBackup(tenantId, kind, userId = null, only = null) {
  const settings = await one(`business_settings?tenant_id=eq.${tenantId}&select=erp_settings`);
  const cfg = settings?.erp_settings?.backup || {};
  const mods = only?.length ? only : kind === "auto" && Array.isArray(cfg.modules) && cfg.modules.length ? cfg.modules : null;
  const { data, counts } = await buildBackup(tenantId, mods);
  const gz = gzipSync(Buffer.from(JSON.stringify(data)));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${tenantId}/${stamp}-${kind}.json.gz`;
  await storage(`object/${BUCKET}/${path}`, { method: "POST", body: gz, headers: { "Content-Type": "application/gzip", "x-upsert": "true" } });
  // A copy in the company's own storage (R2, S3, ...) when set up.
  let remote_status = null;
  const remote = await remoteFor(tenantId, cfg).catch(() => null);
  if (remote) {
    try { await s3Put(remote, remoteKey(remote, path), gz, "application/gzip"); remote_status = "copied"; }
    catch (e) { remote_status = `failed: ${e.message}`.slice(0, 200); }
  }
  const [row] = await db("tenant_backups", { method: "POST", body: { tenant_id: tenantId, kind, path, size_bytes: gz.length, tables: { ...counts, _modules: Object.keys(data.modules), ...(remote_status ? { _remote: remote_status } : {}) }, created_by: userId } });
  return row;
}

async function pruneBackups(tenantId, keep, cfg) {
  const list = await rows(`tenant_backups?tenant_id=eq.${tenantId}&kind=eq.auto&select=id,path&order=created_at.desc`);
  const remote = await remoteFor(tenantId, cfg).catch(() => null);
  for (const b of list.slice(Math.max(1, keep))) {
    await storage(`object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: [b.path] }), headers: { "Content-Type": "application/json" } }).catch(() => {});
    if (remote && b.path && cfg?.remote?.prune !== false) await s3Delete(remote, remoteKey(remote, b.path));
    await db(`tenant_backups?id=eq.${b.id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  }
}

const FREQ_MS = { hourly: 3600e3, "6h": 6 * 3600e3, "12h": 12 * 3600e3, daily: 86400e3, weekly: 7 * 86400e3, monthly: 30 * 86400e3 };
let backupRunning = false;
async function backupTick() {
  if (backupRunning) return;
  backupRunning = true;
  try {
    const tenants = await rows("business_settings?select=tenant_id,erp_settings");
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    for (const t of tenants) {
      const cfg = t.erp_settings?.backup || { frequency: "daily", keep: 14 };
      const every = FREQ_MS[cfg.frequency];
      if (!every) continue;
      // Daily and longer backups run at the chosen hour (default 2 am).
      if (every >= 86400e3 && hour !== Number(cfg.hour ?? 2)) continue;
      const last = await one(`tenant_backups?tenant_id=eq.${t.tenant_id}&kind=eq.auto&select=created_at&order=created_at.desc&limit=1`);
      if (last && Date.now() - Date.parse(last.created_at) < every - 2 * 3600e3 * (every >= 86400e3 ? 1 : 0) - 120e3) continue;
      try { await createBackup(t.tenant_id, "auto"); await pruneBackups(t.tenant_id, Number(cfg.keep) || 14, cfg); }
      catch (e) { console.error("[backup]", e.message); await db("tenant_backups", { method: "POST", prefer: "return=minimal", body: { tenant_id: t.tenant_id, kind: "auto", status: "failed", error: str(e.message).slice(0, 400) } }).catch(() => {}); }
    }
  } finally { backupRunning = false; }
}

/** Puts one module back: rows are upserted (nothing is deleted) and must belong to this company. */
async function restoreModule(tenantId, mod, payload) {
  const def = BACKUP_MODULES[mod];
  if (!def) throw new HttpError(400, "Unknown module");
  if (payload?.format !== "garage-erp-backup") throw new HttpError(400, "That file is not a JMSURF Garage backup");
  if (payload.tenant_id && payload.tenant_id !== tenantId) throw new HttpError(400, "That backup belongs to another business");
  const tables = payload.modules?.[mod];
  if (!tables) throw new HttpError(400, "That backup has no data for this module");
  const result = {};
  for (const [table, key = "id"] of def.tables) {
    let list = Array.isArray(tables[table]) ? tables[table] : [];
    const p = PARENT[table];
    if (p) {
      const mine = new Set(await parentIds(tenantId, p[1]));
      list = list.filter((r) => mine.has(r[p[0]]));
    } else {
      list = list.filter((r) => r && r.tenant_id === tenantId);
    }
    try {
      for (let i = 0; i < list.length; i += 500) {
        await db(`${table}?on_conflict=${key}`, { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: list.slice(i, i + 500) });
      }
      result[table] = list.length;
    } catch (e) { result[table] = `error: ${e.message}`.slice(0, 160); }
  }
  return result;
}

// =========================================================================
// Staff auth + routes
// =========================================================================

async function caller(req) {
  const auth = str(req.headers["authorization"]);
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Sign in first");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(401, "Sign in first");
  const user = await r.json();
  const profile = await one(`profiles?user_id=eq.${enc(user.id)}&select=tenant_id,display_name`);
  const roles = await withPlatformRole((await rows(`user_roles?user_id=eq.${enc(user.id)}&select=role`)).map((x) => String(x.role)), user.id, req);
  if (!profile?.tenant_id) throw new HttpError(403, "Not allowed");
  return { user, tenantId: profile.tenant_id, roles, owner: roles.some((x) => ["admin", "super_admin"].includes(x)), manager: roles.some((x) => ["admin", "manager", "super_admin"].includes(x)) };
}

const tempPassword = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => a[randomInt(a.length)]).join("");
};

async function portalPassword(who, b) {
  if (!who.manager && !who.roles.includes("cashier") && !who.roles.includes("sales_person")) throw new HttpError(403, "Not allowed");
  const c = await one(`customers?id=eq.${enc(str(b.customer_id))}&tenant_id=eq.${who.tenantId}&select=id,name,phone,email`);
  if (!c) throw new HttpError(404, "Customer not found");
  const phone = phoneDigits(c.phone);
  let acc = await one(`customer_accounts?customer_id=eq.${c.id}&select=id,phone`);
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  if (!acc) {
    if (!phone) throw new HttpError(400, "Add the customer's phone number first: they sign in with it");
    const clash = await one(`customer_accounts?tenant_id=eq.${who.tenantId}&phone=eq.${phone}&select=id`);
    if (clash) throw new HttpError(409, "Another customer account already uses this phone number");
    [acc] = await db("customer_accounts", { method: "POST", body: { tenant_id: who.tenantId, customer_id: c.id, phone, password_hash: hash, must_change_password: true } });
  } else {
    await db(`customer_accounts?id=eq.${acc.id}`, { method: "PATCH", prefer: "return=minimal", body: { password_hash: hash, must_change_password: true, failed_logins: 0, locked_until: null, is_active: true } });
    await db(`customer_sessions?account_id=eq.${acc.id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  }
  const shop = await erpSettings(who.tenantId);
  const text = `${shop.business_name}: your account password is ${pw}. Sign in at ${shop?.portal_origin || PORTAL_ORIGIN}/portal/login with your phone number and change it after signing in.`;
  let sent = null;
  if (b.send === "sms" && c.phone) sent = await sendForShop({ tenantId: who.tenantId, channel: "sms", to: c.phone, text, userId: who.user.id }).catch((e) => ({ ok: false, error: e.message }));
  if (b.send === "email" && c.email && deliverEmail) {
    const r = await deliverEmail(who.tenantId, { to: c.email, subject: `${shop.business_name}: your account password`, text, html: `<p>${esc(text)}</p>` });
    sent = r?.ok ? { ok: true } : { ok: false, error: r?.error || "Not sent" };
  }
  return { ok: true, password: pw, phone: acc.phone || phone, sent };
}

async function requestInfo(who, b) {
  const c = await one(`customers?id=eq.${enc(str(b.customer_id))}&tenant_id=eq.${who.tenantId}&select=id,name,phone,email`);
  if (!c) throw new HttpError(404, "Customer not found");
  const ask = str(b.message).slice(0, 500) || "Please complete your details (address, KRA PIN and ID) in your account.";
  await db(`customers?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: { approval_status: "info_requested", info_request: ask, info_requested_at: new Date().toISOString() } });
  const shop = await erpSettings(who.tenantId);
  const text = `${shop.business_name}: Hi ${str(c.name).split(" ")[0]}, ${ask} Sign in at ${shop?.portal_origin || PORTAL_ORIGIN}/portal/login`;
  const out = {};
  if (c.phone) out.sms = await sendForShop({ tenantId: who.tenantId, channel: "sms", to: c.phone, text, userId: who.user.id }).catch((e) => ({ ok: false, error: e.message }));
  if (c.email && deliverEmail) out.email = await deliverEmail(who.tenantId, { to: c.email, subject: `${shop.business_name}: a few more details please`, text, html: `<p>${esc(text)}</p>` }).catch((e) => ({ ok: false, error: e.message }));
  return { ok: true, ...out };
}

// =========================================================================
// Payment reminders (Debts page, bulk on invoices)
// =========================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idList = (v, max = 300) => (Array.isArray(v) ? v : []).map(str).filter((x) => UUID.test(x)).slice(0, max);

/** One reminder per customer listing their unpaid invoices, by SMS and/or email, with the portal link to pay by M-Pesa. */
async function remindPayment(who, b) {
  if (!who.manager && !who.roles.includes("cashier") && !who.roles.includes("sales_person")) throw new HttpError(403, "Not allowed");
  let ids = idList(b.invoice_ids);
  const custIds = idList(b.customer_ids);
  if (!ids.length && custIds.length) {
    ids = (await rows(`invoices?tenant_id=eq.${who.tenantId}&customer_id=in.(${custIds.join(",")})&status=in.(sent,overdue,partially_paid)&select=id&limit=500`)).map((x) => x.id);
  }
  if (!ids.length) throw new HttpError(400, "Pick unpaid invoices or customers");
  const shop = await erpSettings(who.tenantId);
  const invs = (await rows(`invoices?id=in.(${ids.join(",")})&tenant_id=eq.${who.tenantId}&select=id,invoice_number,customer_id,customer_name,customer_phone,customer_email,total,amount_paid,due_date,status`))
    .filter((i) => !["draft", "void", "paid"].includes(i.status) && Number(i.total) - Number(i.amount_paid || 0) > 0.005);
  const cids = [...new Set(invs.map((i) => i.customer_id).filter(Boolean))];
  const custs = new Map((cids.length ? await rows(`customers?id=in.(${cids.join(",")})&select=id,name,phone,email`) : []).map((c) => [c.id, c]));
  const groups = new Map();
  for (const i of invs) { const k = i.customer_id || i.id; groups.set(k, [...(groups.get(k) || []), i]); }
  const out = { sms: 0, email: 0, skipped: 0, failed: [] };
  const name = str(shop?.business_name) || "our shop";
  const payLine = shop?.mpesa_till_number ? ` or M-Pesa Till ${shop.mpesa_till_number}` : shop?.mpesa_shortcode ? ` or M-Pesa Paybill ${shop.mpesa_shortcode}${shop.mpesa_account_reference ? ` account ${shop.mpesa_account_reference}` : ""}` : "";
  for (const list of groups.values()) {
    const c = custs.get(list[0].customer_id) || {};
    const phone = str(c.phone || list[0].customer_phone), email = str(c.email || list[0].customer_email);
    const first = str(c.name || list[0].customer_name).split(" ")[0] || "there";
    const due = list.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid || 0), 0);
    const listTxt = list.map((i) => `${i.invoice_number} KES ${money(Number(i.total) - Number(i.amount_paid || 0))}${i.due_date ? ` (due ${niceDate(i.due_date)})` : ""}`).join(", ");
    const lead = str(b.message) || `Hi ${first}, a friendly reminder from ${name}.`;
    // Each invoice's own "Pay now" link (made if missing); one invoice: the SMS carries its link.
    const links = new Map();
    for (const i of list.slice(0, 20)) { const u = await payLinkUrl(who.tenantId, i.id).catch(() => null); if (u) links.set(i.id, u); }
    const payHere = list.length === 1 && links.get(list[0].id) ? `Pay now: ${links.get(list[0].id)}` : `Pay in your account: ${shop?.portal_origin || PORTAL_ORIGIN}/account`;
    const text = `${lead} Unpaid: ${listTxt}. Total KES ${money(due)}. ${payHere}${payLine}. Thank you.`;
    let sent = false;
    if (b.sms !== false && phone) {
      const r = await sendForShop({ tenantId: who.tenantId, channel: "sms", to: phone, text, userId: who.user.id }).catch((e) => ({ ok: false, error: e.message }));
      if (r.ok) { out.sms++; sent = true; } else out.failed.push(`SMS ${first}: ${r.error}`);
    }
    if (b.email !== false && email && deliverEmail) {
      const rowsHtml = list.map((i) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.invoice_number)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${i.due_date ? esc(niceDate(i.due_date)) : "—"}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">KES ${money(Number(i.total) - Number(i.amount_paid || 0))}${links.get(i.id) ? ` <a href="${esc(links.get(i.id))}" style="color:#A8121B;font-weight:bold;margin-left:6px">Pay now</a>` : ""}</td></tr>`).join("");
      const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:560px"><h2 style="color:#A8121B">${esc(name)}</h2><p>${esc(lead)}</p><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#faf6f2"><th style="text-align:left;padding:6px 8px">Invoice</th><th style="text-align:left;padding:6px 8px">Due</th><th style="text-align:right;padding:6px 8px">Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table><p style="font-size:16px"><b>Total due: KES ${money(due)}</b></p><p><a href="${list.length === 1 && links.get(list[0].id) ? esc(links.get(list[0].id)) : `${shop?.portal_origin || PORTAL_ORIGIN}/account`}" style="background:#A8121B;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Pay now</a></p>${payLine ? `<p style="font-size:13px;color:#555">You can also pay${esc(payLine)}.</p>` : ""}<p style="font-size:13px;color:#555">Thank you for shopping with us.</p></div>`;
      const r = await deliverEmail(who.tenantId, { purpose: "reminders", to: email, subject: `${name}: payment reminder (KES ${money(due)})`, text, html }).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok === false) out.failed.push(`Email ${first}: ${r.error}`); else { out.email++; sent = true; }
    }
    if (!sent && !phone && !email) out.skipped++;
  }
  return out;
}

// =========================================================================
// Payslips: email (full payslip) and SMS (summary) after approval
// =========================================================================

function payslipHtml(shop, run, s, e) {
  const d = s.data || {};
  const scheme = Number(d.nssf_scheme || 0);
  const line = (l, v, bold = false) => `<tr${bold ? ' style="font-weight:bold;border-top:1px solid #ccc"' : ""}><td style="padding:4px 2px">${esc(l)}</td><td style="padding:4px 2px;text-align:right">${money(v)}</td></tr>`;
  const box = "border:1px solid #eee;border-radius:8px;padding:10px;margin-top:12px";
  return `<div style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:auto">
  <table style="width:100%"><tr><td><h2 style="margin:0;color:#A8121B">${esc(shop?.business_name)}</h2><div style="font-size:12px">${esc(shop?.business_address || "")} ${esc(shop?.business_phone || "")}</div></td><td style="text-align:right"><b>PAYSLIP</b><br>${esc(run.period)}</td></tr></table>
  <div style="${box};font-size:13px"><b>${esc(s.employee_name)}</b> · ${esc(e?.employee_no || "")}<br>ID ${esc(e?.national_id || "—")} · KRA PIN ${esc(e?.kra_pin || "—")} · NSSF ${esc(e?.nssf_no || "—")} · SHA ${esc(e?.shif_no || "—")}</div>
  <div style="${box}"><b>Earnings</b><table style="width:100%;border-collapse:collapse;font-size:13px">${line("Basic salary", s.basic)}${(d.allowances || []).map((a) => line(a.name, a.amount)).join("")}${d.overtime ? line(`Overtime (${d.overtime_hours} h)`, d.overtime) : ""}${d.unpaid_leave ? line("Unpaid days", -d.unpaid_leave) : ""}${line("Gross pay", s.gross, true)}</table></div>
  <div style="${box}"><b>Deductions</b><table style="width:100%;border-collapse:collapse;font-size:13px">${d.nssf_tier1 == null ? line("NSSF", s.nssf) : line("NSSF Tier I", d.nssf_tier1) + (Number(d.nssf_tier2 || 0) - scheme > 0.004 ? line("NSSF Tier II", Number(d.nssf_tier2) - scheme) : "") + (scheme > 0 ? line(`${str(d.nssf_scheme_name) || "Private pension scheme"} (Tier II)`, scheme) : "")}${line("SHIF", s.shif)}${line("Housing Levy", s.housing_levy)}${line("PAYE", s.paye)}${d.pension ? line("Pension", d.pension) : ""}${d.prmf ? line("Post-retirement medical fund", d.prmf) : ""}${d.helb ? line("HELB", d.helb) : ""}${Number(s.loan_deductions) ? line("Loans & advances", s.loan_deductions) : ""}${(d.other_deductions || []).map((x) => line(x.name, x.amount)).join("")}${line("Total deductions", d.total_deductions || 0, true)}</table></div>
  <div style="${box};font-size:12px"><b>Tax</b><table style="width:100%;border-collapse:collapse">${line("Taxable pay", s.taxable_pay)}${line("Tax charged", d.tax_before_relief || 0)}${line("Personal relief", d.personal_relief || 0)}${d.insurance_relief ? line("Insurance relief", d.insurance_relief) : ""}${line("PAYE", s.paye, true)}</table></div>
  ${d.net_rounding ? `<p style="font-size:11px;color:#777;margin:6px 0 0">Net pay rounded by ${money(d.net_rounding)}</p>` : ""}<div style="background:#A8121B;color:#fff;padding:12px;border-radius:8px;font-size:18px;margin-top:14px"><table style="width:100%;color:#fff"><tr><td>NET PAY</td><td style="text-align:right"><b>KES ${money(s.net_pay)}</b></td></tr></table></div>
  <p style="font-size:11px;color:#777">Paid by ${esc(e?.payment_method === "bank" ? `${e?.bank_name || "bank"} ${e?.bank_account || ""}` : e?.payment_method === "mpesa" ? `M-Pesa ${e?.mpesa_phone || ""}` : e?.payment_method || "")}. This payslip is confidential.</p></div>`;
}

/** Records one delivery of a stored payroll document (best effort: the table may not exist yet). */
async function logDelivery(tenantId, documentId, channel, to, ok, error, userId) {
  if (!documentId) return;
  await db("hr_payroll_document_deliveries", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, document_id: documentId, channel, sent_to: str(to) || null, status: ok ? "sent" : "failed", error: ok ? null : str(error).slice(0, 500) || null, sent_by: userId || null } }).catch(() => {});
}
const canSendPayroll = (who) => who.manager || who.roles.includes("hr_manager") || who.roles.includes("accountant");

/** Sends payslips of an approved or paid run. Called by the Payroll page (bulk or all) and right after approval. */
async function sendPayslips(who, b) {
  if (!canSendPayroll(who)) throw new HttpError(403, "Only HR or managers can send payslips");
  const run = await one(`hr_payroll_runs?id=eq.${enc(str(b.run_id))}&tenant_id=eq.${who.tenantId}&select=*`);
  if (!run) throw new HttpError(404, "Payroll not found");
  if (run.status === "draft") throw new HttpError(400, "Approve the payroll before sending payslips");
  const pick = idList(b.payslip_ids, 1000);
  let slips = await rows(`hr_payslips?run_id=eq.${run.id}&select=*`);
  if (pick.length) slips = slips.filter((x) => pick.includes(x.id));
  if (!slips.length) return { email: 0, sms: 0, skipped: 0 };
  const emps = new Map((await rows(`hr_employees?id=in.(${[...new Set(slips.map((x) => x.employee_id))].join(",")})&select=*`)).map((e) => [e.id, e]));
  const shop = await erpSettings(who.tenantId);
  const out = { email: 0, sms: 0, skipped: 0, failed: [] };
  // Stored payslips (Payroll → Documents) get each send logged against them.
  const docs = new Map((await rows(`hr_payroll_documents?run_id=eq.${run.id}&kind=eq.payslip&select=id,employee_id`).catch(() => [])).map((d) => [d.employee_id, d.id]));
  for (const sl of slips) {
    const docId = docs.get(sl.employee_id);
    const e = emps.get(sl.employee_id) || {};
    const log = { ...(sl.send_log || {}) };
    const patch = {};
    let any = false;
    if (b.email !== false && e.email && deliverEmail) {
      const r = await deliverEmail(who.tenantId, { purpose: "payroll", to: e.email, subject: `Your payslip for ${run.period} · ${str(shop?.business_name)}`, html: payslipHtml(shop, run, sl, e), text: `Your payslip for ${run.period}: net pay KES ${money(sl.net_pay)}.` }).catch((x) => ({ ok: false, error: x.message }));
      if (r && r.ok === false) { out.failed.push(`${sl.employee_name} email: ${r.error}`); log.email_error = r.error; } else { out.email++; patch.sent_email_at = new Date().toISOString(); any = true; }
      await logDelivery(who.tenantId, docId, "email", e.email, !(r && r.ok === false), r?.error, who.user.id);
    }
    const phone = str(e.phone || e.mpesa_phone);
    if (b.sms && phone) {
      const text = `Hi ${str(e.first_name) || "there"}, your ${run.period} payslip from ${str(shop?.business_name)}: gross KES ${money(sl.gross)}, deductions KES ${money(Number(sl.gross) - Number(sl.net_pay))}, net pay KES ${money(sl.net_pay)}.${e.email ? " The full payslip is in your email." : ""}`;
      const r = await sendForShop({ tenantId: who.tenantId, channel: "sms", to: phone, text, userId: who.user.id }).catch((x) => ({ ok: false, error: x.message }));
      if (r.ok) { out.sms++; patch.sent_sms_at = new Date().toISOString(); any = true; } else { out.failed.push(`${sl.employee_name} SMS: ${r.error}`); log.sms_error = r.error; }
      await logDelivery(who.tenantId, docId, "sms", phone, !!r.ok, r.error, who.user.id);
    }
    if (!any && !e.email && !phone) out.skipped++;
    await db(`hr_payslips?id=eq.${sl.id}`, { method: "PATCH", prefer: "return=minimal", body: { ...patch, send_log: { ...log, last_try: new Date().toISOString() } } }).catch(() => {});
  }
  return out;
}

/**
 * Emails stored payroll documents (payslips and P9s in the private payroll-docs bucket) to their
 * employees: the page itself in the email and as an attached file. Used by Resend and the yearly P9.
 */
async function sendPayrollDocs(who, b) {
  if (!canSendPayroll(who)) throw new HttpError(403, "Only HR or managers can send payroll documents");
  const ids = idList(b.document_ids, 2000);
  if (!ids.length) return { email: 0, skipped: 0, failed: [] };
  const docs = await rows(`hr_payroll_documents?id=in.(${ids.join(",")})&tenant_id=eq.${who.tenantId}&select=*`);
  if (!docs.length) return { email: 0, skipped: 0, failed: [] };
  const emps = new Map((await rows(`hr_employees?id=in.(${[...new Set(docs.map((d) => d.employee_id))].join(",")})&select=id,first_name,last_name,email`)).map((e) => [e.id, e]));
  const shop = await erpSettings(who.tenantId);
  const out = { email: 0, skipped: 0, failed: [] };
  for (const d of docs) {
    const e = emps.get(d.employee_id) || {};
    const name = [e.first_name, e.last_name].filter(Boolean).join(" ") || "Employee";
    if (!e.email || !deliverEmail) { out.skipped++; await logDelivery(who.tenantId, d.id, "email", null, false, "No email address", who.user.id); continue; }
    try {
      const html = (await (await storage(`object/payroll-docs/${d.path}`)).text()).replace(/<script[\s\S]*?<\/script>/gi, "");
      const what = d.kind === "p9" ? `P9 tax deduction card for ${d.period}` : `payslip for ${d.period}`;
      const r = await deliverEmail(who.tenantId, {
        purpose: "payroll", to: e.email, subject: `Your ${what} · ${str(shop?.business_name)}`, html,
        text: `Hi ${str(e.first_name) || "there"}, your ${what} is attached.`,
        attachments: [{ filename: str(d.file_name) || `${d.kind}-${d.period}.html`, content: Buffer.from(html, "utf8").toString("base64"), contentType: "text/html" }],
      }).catch((x) => ({ ok: false, error: x.message }));
      const ok = !(r && r.ok === false);
      if (ok) out.email++; else out.failed.push(`${name}: ${r.error}`);
      await logDelivery(who.tenantId, d.id, "email", e.email, ok, r?.error, who.user.id);
      if (ok && d.kind === "payslip" && d.run_id) await db(`hr_payslips?run_id=eq.${d.run_id}&employee_id=eq.${d.employee_id}`, { method: "PATCH", prefer: "return=minimal", body: { sent_email_at: new Date().toISOString() } }).catch(() => {});
    } catch (x) {
      out.failed.push(`${name}: ${x.message}`);
      await logDelivery(who.tenantId, d.id, "email", e.email, false, x.message, who.user.id);
    }
  }
  return out;
}

const ROUTES = {
  /** KRA eTIMS: ask JMSURF TAX for the integration token to enter on KRA's portal (with the PIN and device serial). */
  "/api/erp/etims-token-request": async (who, b) => {
    if (!who.manager) throw new HttpError(403, "Only admins and managers can set up KRA eTIMS");
    const pin = str(b.pin).toUpperCase(); const serial = str(b.serial); const branch = (str(b.branch) || "00").replace(/\D/g, "").padStart(2, "0").slice(0, 2);
    if (!/^[AP]\d{9}[A-Z]$/.test(pin)) throw new HttpError(400, "Enter the company's KRA PIN first");
    if (!serial) throw new HttpError(400, "The device serial number is missing");
    const open = await one(`etims_token_requests?tenant_id=eq.${who.tenantId}&branch_id=eq.${branch}&status=eq.requested&select=id`);
    if (open) return { ok: true, already: true };
    const [shop] = await rows(`tenants?id=eq.${who.tenantId}&select=business_name,business_phone,business_email,slug`);
    const [req] = await db("etims_token_requests", { method: "POST", body: { tenant_id: who.tenantId, kra_pin: pin, branch_id: branch, device_serial: serial, contact_phone: shop?.business_phone || null, contact_email: shop?.business_email || who.user.email || null, requested_by: who.user.id } });
    const to = (process.env.JMSURF_TAX_EMAIL || process.env.PLATFORM_ALERT_EMAIL || "info@jmsurf.co.ke").split(",").map((x) => x.trim()).filter(Boolean);
    const text = `${shop?.business_name || "A company"} asks for a KRA eTIMS integration token.\n\nKRA PIN: ${pin}\nBranch: ${branch}\nDevice serial: ${serial}\nPhone: ${shop?.business_phone || "-"}\nEmail: ${shop?.business_email || who.user.email || "-"}\n\nIssue it in the JMSURF admin: KRA tokens.`;
    if (deliverEmail) await deliverEmail(who.tenantId, { to, subject: `eTIMS integration token request: ${shop?.business_name || pin}`, text, html: `<pre style="font:14px/1.5 Arial">${esc(text)}</pre>` }).catch(() => null);
    return { ok: true, id: req?.id };
  },
  "/api/erp/remind-payment": remindPayment,
  "/api/erp/payslips/send": sendPayslips,
  "/api/erp/payroll-docs/send": sendPayrollDocs,
  "/api/erp/statement": async (who, b) => {
    const c = await one(`customers?id=eq.${enc(str(b.customer_id))}&tenant_id=eq.${who.tenantId}&select=id`);
    if (!c) throw new HttpError(404, "Customer not found");
    return statementFor(c.id, str(b.from), str(b.to));
  },
  "/api/erp/statement/send": async (who, b) => {
    const c = await one(`customers?id=eq.${enc(str(b.customer_id))}&tenant_id=eq.${who.tenantId}&select=id`);
    if (!c) throw new HttpError(404, "Customer not found");
    return sendStatement(who.tenantId, c.id, str(b.from), str(b.to), { message: str(b.message), sms: !!b.sms, email: b.email !== false, userId: who.user.id });
  },
  "/api/erp/customer/portal-password": portalPassword,
  "/api/erp/invoice/mpesa": async (who, b) => {
    const r = await pushInvoiceForShop(who.tenantId, str(b.invoice_id), b.phone, b.amount, "staff");
    if (r.error) throw new HttpError(r.status || 400, r.error);
    return r;
  },
  "/api/erp/invoice/mpesa-status": async (who, b) => invoicePromptStatus(who.tenantId, str(b.request_id)),
  "/api/erp/customer/request-info": requestInfo,
  "/api/erp/backup/list": async (who) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can manage backups");
    return { backups: await rows(`tenant_backups?tenant_id=eq.${who.tenantId}&select=*&order=created_at.desc&limit=100`), modules: Object.fromEntries(Object.entries(BACKUP_MODULES).map(([k, v]) => [k, v.label])) };
  },
  "/api/erp/backup/create": async (who, b) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can manage backups");
    const mods = Array.isArray(b.modules) ? b.modules.filter((m) => BACKUP_MODULES[m]) : null;
    return { backup: await createBackup(who.tenantId, "manual", who.user.id, mods) };
  },
  "/api/erp/backup/test-remote": async (who) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can manage backups");
    const s = await one(`business_settings?tenant_id=eq.${who.tenantId}&select=erp_settings`);
    const cfg = { ...(s?.erp_settings?.backup || {}), remote: { ...(s?.erp_settings?.backup?.remote || {}), enabled: true } };
    const remote = await remoteFor(who.tenantId, cfg);
    if (!remote) throw new HttpError(400, "Save the bucket, access key and secret first");
    const key = [remote.prefix, `jmsurf-dash-test-${Date.now()}.txt`].filter(Boolean).join("/");
    try { await s3Put(remote, key, Buffer.from("JMSURF Garage backup test"), "text/plain"); }
    catch (e) { throw new HttpError(400, e.message); }
    await s3Delete(remote, key);
    return { ok: true, bucket: remote.bucket };
  },
  "/api/erp/backup/download": async (who, b) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can manage backups");
    const bk = await one(`tenant_backups?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=path`);
    if (!bk?.path) throw new HttpError(404, "Backup not found");
    const r = await storage(`object/sign/${BUCKET}/${bk.path}`, { method: "POST", body: JSON.stringify({ expiresIn: 600 }), headers: { "Content-Type": "application/json" } });
    const j = await r.json();
    return { url: `${(process.env.VITE_SUPABASE_URL || SUPABASE_URL).replace(/\/+$/, "")}/storage/v1${j.signedURL || j.signedUrl}` };
  },
  "/api/erp/backup/data": async (who, b) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can manage backups");
    if (b.id) {
      const bk = await one(`tenant_backups?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=path`);
      if (!bk?.path) throw new HttpError(404, "Backup not found");
      const r = await storage(`object/${BUCKET}/${bk.path}`);
      return JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8"));
    }
    return (await buildBackup(who.tenantId)).data;
  },
  "/api/erp/backup/restore": async (who, b) => {
    if (!who.owner) throw new HttpError(403, "Only the owner can restore data");
    let payload = b.data;
    if (!payload && b.id) {
      const bk = await one(`tenant_backups?id=eq.${enc(str(b.id))}&tenant_id=eq.${who.tenantId}&select=path`);
      if (!bk?.path) throw new HttpError(404, "Backup not found");
      payload = JSON.parse(gunzipSync(Buffer.from(await (await storage(`object/${BUCKET}/${bk.path}`)).arrayBuffer())).toString("utf8"));
    }
    // A safety copy first, so a restore can itself be undone.
    await createBackup(who.tenantId, "manual", who.user.id).catch(() => {});
    return { restored: await restoreModule(who.tenantId, str(b.module), payload) };
  },
};

export const isErpRoute = (pathname) => pathname.startsWith("/api/erp/");

export async function handleErpRequest(req, res, pathname, body, sendJson) {
  const fn = ROUTES[pathname] || etimsRoutes[pathname] || migrateRoutes[pathname] || engageRoutes[pathname] || portalStaffRoutes[pathname];
  if (!fn) return sendJson(res, 404, { error: "Unknown route" });
  if (!SUPABASE_URL || !SERVICE_KEY) return sendJson(res, 503, { error: "Not available right now" });
  try {
    const who = await caller(req);
    return sendJson(res, 200, await fn(who, body || {}));
  } catch (e) {
    const status = e instanceof HttpError || e instanceof EtimsError || e instanceof MigrateError || e instanceof EngageError || e instanceof ShopError ? e.status : 500;
    if (status === 500) console.error("[erp]", pathname, e);
    return sendJson(res, status, { error: status === 500 ? str(e.message) || "Something went wrong" : e.message });
  }
}

/** Starts the statement and backup schedulers. deliver(tenantId, {to, subject, html, text}) sends email. */
export function startErpJobs(deliver) {
  deliverEmail = deliver;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  startEtimsJobs();
  setTimeout(() => { void statementTick().catch((e) => console.error("[statements]", e.message)); void backupTick().catch((e) => console.error("[backup]", e.message)); }, 60_000);
  setInterval(() => void statementTick().catch((e) => console.error("[statements]", e.message)), 30 * 60_000);
  setInterval(() => void backupTick().catch((e) => console.error("[backup]", e.message)), 10 * 60_000);
}
