import { publicBase } from "./hosts.js";
// ---------------------------------------------------------------------------
// Workflow rules (System → Workflow rules). A company's no-code automations:
//
//  * Record rules: database triggers queue every create/change of a watched record
//    in workflow_queue (only when the company has an active rule for that module).
//    Every 20 s this reads the queue, checks each rule's trigger (created, changed,
//    a field changed to a value) and conditions, and runs its actions.
//  * Date rules: once a day per company (claimed in workflow_daily, from 07:00
//    Nairobi), records whose date field is N days before/after today. Two days are
//    caught up after a missed day.
//
// Each (rule, record, slot) is claimed once in workflow_runs, so a retry or a
// second server never runs it twice; the run log keeps each action's result.
// A field changed by a rule carries the rule chain, so it never runs the same
// rule again (and chains stop after 5 rules). The demo company never sends
// email, SMS or webhooks.
// ---------------------------------------------------------------------------
import { sendForShop } from "./messaging.js";
import { deliverSignedWebhook } from "./devapi.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";


/** Modules: table, number column, link in the app, date fields a date rule may use. */
export const WF_MODULES = {
  invoices: { table: "invoices", number: "invoice_number", link: (id) => `/sales/invoices/${id}`, dates: ["due_date", "issue_date"], party: "customer" },
  quotes: { table: "quotes", number: "quote_number", link: (id) => `/sales/quotes/${id}`, dates: ["valid_until", "issue_date"], party: "customer" },
  sales_orders: { table: "sales_orders", number: "quote_number", link: (id) => `/sales/orders/${id}`, dates: ["expected_shipment_date", "issue_date"], party: "customer" },
  bills: { table: "bills", number: "bill_number", link: (id) => `/purchases/bills/${id}`, dates: ["due_date", "bill_date", "expected_payment_date"], party: "supplier" },
  customers: { table: "customers", number: "name", link: (id) => `/customers/${id}`, dates: ["created_at"], party: "self" },
  items: { table: "products", number: "name", link: (id) => `/inventory/products/${id}`, dates: [], party: null },
  leads: { table: "crm_leads", number: "name", link: (id) => `/crm/leads/${id}`, dates: ["date_deadline", "created_at"], party: "lead" },
  deals: { table: "crm_deals", number: "name", link: (id) => `/crm/deals/${id}`, dates: ["closing_date", "created_at"], party: "customer" },
  contacts: { table: "crm_contacts", number: "last_name", link: (id) => `/crm/contacts/${id}`, dates: ["date_of_birth", "created_at"], party: "self" },
  expenses: { table: "expenses", number: "expense_number", link: (id) => `/purchases/expenses/${id}`, dates: ["expense_date", "next_due_date"], party: "supplier" },
  payments: { table: "payments_received", number: "payment_number", link: () => "/sales/payments", dates: ["payment_date"], party: "customer" },
};
const MONEY = new Set(["total", "subtotal", "tax", "amount", "amount_paid", "balance", "expected_revenue", "credit_limit", "price", "cost_price"]);
const MAX_CHAIN = 5;

let sendEmail = null;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const esc = (s) => str(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const niceDate = (d) => { const t = Date.parse(String(d).length === 10 ? `${d}T00:00:00Z` : d); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : str(d); };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function db(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" && data?.message ? data.message : `Database replied ${res.status}`);
  return data;
}
const rows = async (path) => { try { const d = await db(path); return Array.isArray(d) ? d : []; } catch (e) { console.error("[workflows]", e.message); return []; } };

function nairobi() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// ---- per-company facts (cached a minute) -----------------------------------------
const companyCache = new Map();
async function company(tenantId) {
  const hit = companyCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const t = (await rows(`tenants?id=eq.${tenantId}&select=slug,business_name`))[0] || {};
  const s = (await rows(`business_settings?tenant_id=eq.${tenantId}&select=business_name&limit=1`))[0] || {};
  const v = {
    demo: t.slug === "demo",
    name: str(s.business_name || t.business_name) || "JMSURF Garage",
    origin: await publicBase(tenantId),
  };
  companyCache.set(tenantId, { at: Date.now(), v });
  return v;
}
const rulesCache = new Map();
async function eventRules(tenantId) {
  const hit = rulesCache.get(tenantId);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  const v = await rows(`workflow_rules?tenant_id=eq.${tenantId}&is_active=is.true&trigger_type=neq.date&select=*&order=created_at`);
  rulesCache.set(tenantId, { at: Date.now(), v });
  return v;
}

const contacts = (tenantId, users, roles) =>
  db("rpc/alert_contacts", { method: "POST", body: { p_tenant: tenantId, p_users: users || [], p_roles: roles || [] } })
    .then((d) => (Array.isArray(d) ? d : [])).catch((e) => { console.error("[workflows] contacts", e.message); return []; });

// ---- the record, its placeholders and its people --------------------------------------
/** Adds the computed balance and the names a message needs. */
async function enrich(module, row) {
  const r = { ...row };
  if (module === "invoices") r.balance = Math.max(0, Number(r.total || 0) - Number(r.amount_paid || 0));
  if (module === "bills") r.balance = Math.max(0, Number(r.amount || 0) - Number(r.amount_paid || 0));
  if (WF_MODULES[module]?.party === "supplier" && r.supplier_id && !r.supplier_name) {
    const s = (await rows(`suppliers?id=eq.${r.supplier_id}&select=name,email,phone`))[0];
    if (s) { r.supplier_name = s.name; r._party = { name: s.name, email: s.email, phone: s.phone }; }
  }
  if (module === "contacts") r.name = [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "Contact";
  if (module === "deals") { r.customer_name = r.account_name || r.contact_name || ""; r.total = r.amount; }
  if (module === "deals" && r.owner_id && !r.salesperson_id) r.salesperson_id = r.owner_id;
  if (r.salesperson_id && !r.salesperson_name) {
    const p = (await rows(`profiles?user_id=eq.${r.salesperson_id}&select=display_name`))[0];
    if (p) r.salesperson_name = p.display_name;
  }
  return r;
}

function placeholders(module, r, co) {
  const cfg = WF_MODULES[module];
  const v = {};
  for (const [k, x] of Object.entries(r)) {
    if (x === null || x === undefined || typeof x === "object" || k.startsWith("_")) continue;
    v[k] = MONEY.has(k) ? kes(x) : /(_date|_until|_deadline)$/.test(k) && /^\d{4}-\d{2}-\d{2}/.test(String(x)) ? niceDate(x) : String(x);
  }
  v.number = str(r[cfg.number]);
  v.customer_name = str(r.customer_name || (module === "customers" ? r.name : "") || (module === "leads" ? r.contact_name || r.partner_name || r.name : "") || r.supplier_name || r.vendor_name);
  v.supplier_name = str(r.supplier_name || r.vendor_name);
  v.total = kes(r.total ?? r.amount ?? r.expected_revenue ?? 0);
  v.balance = kes(r.balance ?? 0);
  v.due_date = r.due_date ? niceDate(r.due_date) : r.valid_until ? niceDate(r.valid_until) : r.date_deadline ? niceDate(r.date_deadline) : "";
  v.company_name = co.name;
  v.link = `${co.origin}${cfg.link(r.id)}`;
  v.today = niceDate(nairobi().date);
  return v;
}
const render = (tpl, vars) => str(tpl).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => vars[k.toLowerCase()] ?? "");

/** Email and phone of the customer (or supplier, or the lead itself). */
async function partyOf(module, r) {
  const kind = WF_MODULES[module]?.party;
  if (kind === "self") return { name: r.name, email: r.email, phone: r.phone };
  if (kind === "lead") return { name: r.contact_name || r.name, email: r.email, phone: r.mobile || r.phone };
  if (kind === "supplier") return r._party || null;
  if (kind === "customer") {
    let email = r.customer_email, phone = r.customer_phone;
    if ((!email || !phone) && r.customer_id) {
      const c = (await rows(`customers?id=eq.${r.customer_id}&select=email,phone,reminders_stopped`))[0];
      email = email || c?.email; phone = phone || c?.phone;
    }
    return { name: r.customer_name, email, phone };
  }
  return null;
}
const ownerIds = (r) => [r.salesperson_id || r.owner_id || r.assigned_to || r.created_by || r.received_by].filter(Boolean);
// The CRM record an action's follow-up belongs to: the record itself, or the customer's account.
const RELATED = { leads: "lead", deals: "deal", contacts: "contact", customers: "account" };
const OWNER_FIELD = { leads: "salesperson_id", deals: "owner_id", contacts: "owner_id", customers: "salesperson_id" };

/** Who an email/SMS/bell action goes to: [{ name, email, phone, user_id?, staff }]. */
async function recipients(tenantId, module, r, a) {
  if (a.to === "customer") { const p = await partyOf(module, r); return p ? [{ ...p, staff: false }] : []; }
  if (a.to === "owner") return (await contacts(tenantId, ownerIds(r), [])).map((p) => ({ ...p, staff: true }));
  if (a.to === "role") return a.role ? (await contacts(tenantId, [], [a.role])).map((p) => ({ ...p, staff: true })) : [];
  if (a.to === "fixed") {
    return str(a.fixed).split(/[\s,;]+/).filter(Boolean).slice(0, 10).map((x) => (EMAIL_RE.test(x) ? { email: x, staff: false } : { phone: x, staff: false }));
  }
  return [];
}

function emailHtml(co, subject, body, link) {
  const paras = str(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#3b4148">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb">
<tr><td style="background:#a8121b;color:#fff;padding:16px 24px;font-weight:bold;font-size:15px">${esc(co.name)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:19px;line-height:1.35">${esc(subject)}</h1>
${paras}
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#a8121b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:bold;font-size:14px">Open in JMSURF Garage</a>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

// ---- actions --------------------------------------------------------------------------
async function runAction(rule, module, r, a, vars, co, chain) {
  const tenantId = rule.tenant_id;
  const sends = ["email", "sms", "webhook"].includes(a.type);
  if (sends && co.demo) return { type: a.type, ok: true, skipped: true, detail: "Not sent from the demo company" };

  if (a.type === "email") {
    if (!sendEmail) return { type: "email", ok: false, detail: "Email is not set up on this server" };
    const people = (await recipients(tenantId, module, r, a)).filter((p) => p.email && EMAIL_RE.test(str(p.email)));
    if (!people.length) return { type: "email", ok: false, detail: "No email address to send to" };
    const subject = render(a.subject, vars).slice(0, 200) || `${co.name}: ${vars.number}`;
    const body = render(a.body, vars);
    const sent = [], failed = [];
    for (const p of people) {
      const link = p.staff ? vars.link : null;
      const res = await sendEmail(tenantId, { to: p.email, subject, html: emailHtml(co, subject, body, link), text: `${body}${link ? `\n\n${link}` : ""}` }).catch((e) => ({ ok: false, error: e.message }));
      (res?.ok === false ? failed : sent).push(p.email);
    }
    return { type: "email", ok: sent.length > 0, detail: `${sent.length ? `Sent to ${sent.join(", ")}` : ""}${failed.length ? `${sent.length ? "; " : ""}not sent to ${failed.join(", ")}` : ""}` };
  }

  if (a.type === "sms") {
    const people = (await recipients(tenantId, module, r, a)).filter((p) => str(p.phone));
    if (!people.length) return { type: "sms", ok: false, detail: "No phone number to send to" };
    const text = render(a.text, vars).slice(0, 600);
    if (!text) return { type: "sms", ok: false, detail: "The message is empty" };
    const sent = [], failed = [];
    for (const p of people) {
      const res = await sendForShop({ tenantId, channel: "sms", to: p.phone, text, reference: `workflow:${rule.id}`, event: p.staff ? "staff_alert" : "manual" }).catch((e) => ({ ok: false, error: e.message }));
      if (res?.ok) sent.push(p.phone); else failed.push(`${p.phone} (${str(res?.error) || "failed"})`);
    }
    return { type: "sms", ok: sent.length > 0, detail: `${sent.length ? `Sent to ${sent.join(", ")}` : ""}${failed.length ? `${sent.length ? "; " : ""}not sent to ${failed.join(", ")}` : ""}` };
  }

  if (a.type === "notify") {
    const title = render(a.title, vars).slice(0, 200) || `${rule.name}: ${vars.number}`;
    const body = render(a.body, vars).slice(0, 1000) || null;
    const base = { tenant_id: tenantId, kind: "workflow", title, body, link: WF_MODULES[module].link(r.id), entity_type: module, entity_id: r.id };
    const targets = a.to === "role" ? (a.role ? [{ role: a.role }] : []) : ownerIds(r).map((u) => ({ user_id: u }));
    if (!targets.length) return { type: "notify", ok: false, detail: a.to === "role" ? "No role chosen" : "This record has no salesperson or owner" };
    for (const t of targets) await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { ...base, user_id: t.user_id || null, role: t.role || null } });
    return { type: "notify", ok: true, detail: a.to === "role" ? `Bell for ${a.role}` : "Bell for the owner" };
  }

  if (a.type === "update") {
    const value = render(a.value, vars);
    const n = await db("rpc/wf_set_field", { method: "POST", body: { p_rule: rule.id, p_record: r.id, p_field: a.field, p_value: value, p_chain: chain } });
    return { type: "update", ok: Number(n) > 0, detail: Number(n) > 0 ? `${a.field} set to ${value || "(empty)"}` : "The record was not found" };
  }

  if (a.type === "task") {
    const days = Math.max(0, Math.min(365, Number(a.days || 0)));
    const due = addDays(nairobi().date, days);
    const related = RELATED[module] ? [RELATED[module], r.id] : r.customer_id ? ["account", r.customer_id] : [null, null];
    const assignee = a.to === "user" && a.user ? a.user : ownerIds(r)[0] || null;
    const kind = ["task", "call", "meeting"].includes(a.kind) ? a.kind : "task";
    await db("crm_activities", { method: "POST", prefer: "return=minimal", body: {
      tenant_id: tenantId, kind, summary: render(a.title, vars).slice(0, 200) || `Follow up: ${vars.number}`, note: render(a.body, vars).slice(0, 2000) || null,
      due_date: due, start_at: kind === "task" ? null : `${due}T06:00:00Z`, assigned_to: assignee, priority: a.priority || "normal",
      related_type: related[0], related_id: related[1], lead_id: related[0] === "lead" ? related[1] : null,
    } });
    return { type: "task", ok: true, detail: `${kind === "task" ? "Task" : kind === "call" ? "Call" : "Meeting"} due ${niceDate(due)}` };
  }

  if (a.type === "assign") {
    const users = (Array.isArray(a.users) ? a.users : []).filter((u) => /^[0-9a-f-]{36}$/i.test(str(u)));
    const field = OWNER_FIELD[module];
    if (!field) return { type: "assign", ok: false, detail: "This kind of record has no owner" };
    if (!users.length) return { type: "assign", ok: false, detail: "No people chosen" };
    const next = await db("rpc/crm_next_assignee", { method: "POST", body: { p_tenant: tenantId, p_key: `rule:${rule.id}`, p_users: users } });
    const n = await db("rpc/wf_set_field", { method: "POST", body: { p_rule: rule.id, p_record: r.id, p_field: field, p_value: next, p_chain: chain } });
    if (Number(n) > 0 && a.notify !== false) await db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, user_id: next, kind: "workflow", title: `Assigned to you: ${vars.number || vars.customer_name}`, body: rule.name, link: WF_MODULES[module].link(r.id), entity_type: module, entity_id: r.id } }).catch(() => undefined);
    const who = (await rows(`profiles?user_id=eq.${next}&select=display_name`))[0]?.display_name || "the next person";
    return { type: "assign", ok: Number(n) > 0, detail: Number(n) > 0 ? `Assigned to ${who}` : "The record was not found" };
  }

  if (a.type === "webhook") {
    const h = (await rows(`erp_webhooks?id=eq.${encodeURIComponent(str(a.webhook_id))}&tenant_id=eq.${tenantId}&select=*`))[0];
    if (!h) return { type: "webhook", ok: false, detail: "The webhook was deleted" };
    if (!h.is_active) return { type: "webhook", ok: false, detail: "The webhook is paused" };
    const { _party, ...record } = r;
    const res = await deliverSignedWebhook(h, `workflow.${module}`, { rule: { id: rule.id, name: rule.name }, module, record });
    return { type: "webhook", ok: !!res.ok, detail: res.ok ? `Delivered (${res.status})` : str(res.error) || "Not delivered" };
  }
  return { type: str(a.type) || "unknown", ok: false, detail: "Unknown action" };
}

/** Runs a rule on a record once per slot; logs the result. */
async function runRule(rule, module, r, slot, chain) {
  const claimed = await db("workflow_runs?on_conflict=rule_id,record_id,slot", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: { tenant_id: rule.tenant_id, rule_id: rule.id, record_id: r.id, slot, record_label: str(r[WF_MODULES[module].number]).slice(0, 120) || null, status: "running" },
  }).catch((e) => { console.error("[workflows] claim", e.message); return []; });
  const run = Array.isArray(claimed) ? claimed[0] : null;
  if (!run) return;
  const co = await company(rule.tenant_id);
  const vars = placeholders(module, r, co);
  const results = [];
  for (const a of Array.isArray(rule.actions) ? rule.actions : []) {
    try { results.push(await runAction(rule, module, r, a || {}, vars, co, chain)); }
    catch (e) { results.push({ type: str(a?.type), ok: false, detail: str(e.message).slice(0, 300) }); }
  }
  const okN = results.filter((x) => x.ok).length;
  const status = !results.length ? "skipped" : okN === results.length ? (results.every((x) => x.skipped) ? "skipped" : "ok") : okN ? "partial" : "failed";
  const errors = results.filter((x) => !x.ok).map((x) => `${x.type}: ${x.detail}`).join(" · ");
  await db(`workflow_runs?id=eq.${run.id}`, { method: "PATCH", prefer: "return=minimal", body: { status, results, detail: errors.slice(0, 500) || null, finished_at: new Date().toISOString() } }).catch(() => undefined);
  await db("rpc/wf_rule_ran", { method: "POST", prefer: "return=minimal", body: { p_rule: rule.id, p_status: status } }).catch(() => undefined);
}

// ---- triggers and conditions -------------------------------------------------------------
const asText = (x) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x));
function same(a, b) {
  const x = asText(a).trim(), y = asText(b).trim();
  if (x !== "" && y !== "" && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) return Number(x) === Number(y);
  return x.toLowerCase() === y.toLowerCase();
}
export function conditionHolds(r, c) {
  const v = asText(r?.[c.field]).trim();
  const w = asText(c.value).trim();
  const nums = v !== "" && w !== "" && Number.isFinite(Number(v)) && Number.isFinite(Number(w));
  switch (c.op) {
    case "eq": return same(v, w);
    case "neq": return !same(v, w);
    case "contains": return v.toLowerCase().includes(w.toLowerCase());
    case "gt": return nums ? Number(v) > Number(w) : v !== "" && v > w;
    case "lt": return nums ? Number(v) < Number(w) : v !== "" && v < w;
    case "empty": return v === "" || v === "false" || v === "0";
    case "not_empty": return !(v === "" || v === "false" || v === "0");
    default: return true;
  }
}
const conditionsHold = (rule, r) => (Array.isArray(rule.conditions) ? rule.conditions : []).filter((c) => c && c.field).every((c) => conditionHolds(r, c));

/** Fields behind a computed one, for "a field changes". */
const SOURCES = { balance: ["amount_paid", "total", "amount", "balance"] };
export function triggerMatches(rule, ev, r) {
  if (rule.trigger_type === "created") return ev.op === "INSERT";
  if (rule.trigger_type === "updated") return ev.op === "UPDATE";
  if (rule.trigger_type !== "field_changed") return false;
  const f = rule.trigger_field;
  const want = str(rule.trigger_value);
  if (ev.op === "INSERT") return want !== "" && same(r[f], want);
  const changed = (SOURCES[f] || [f]).some((k) => (ev.changed || []).includes(k));
  return changed && (want === "" || same(r[f], want));
}

async function handleEvent(ev) {
  const chain = Array.isArray(ev.chain) ? ev.chain : [];
  if (chain.length >= MAX_CHAIN) return;
  const rules = (await eventRules(ev.tenant_id)).filter((x) => x.module === ev.module && !chain.includes(x.id));
  if (!rules.length) return;
  const r = await enrich(ev.module, ev.row_data || {});
  for (const rule of rules) {
    if (!triggerMatches(rule, ev, r) || !conditionsHold(rule, r)) continue;
    await runRule(rule, ev.module, r, `e:${ev.id}`, chain);
  }
}

async function runQueue() {
  const due = await rows("workflow_queue?status=eq.new&order=id&limit=100");
  for (const ev of due) {
    try {
      await handleEvent(ev);
      await db(`workflow_queue?id=eq.${ev.id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done", done_at: new Date().toISOString() } });
    } catch (e) {
      const attempts = Number(ev.attempts || 0) + 1;
      console.error("[workflows] event failed", ev.id, e.message);
      await db(`workflow_queue?id=eq.${ev.id}`, { method: "PATCH", prefer: "return=minimal", body: attempts >= 3 ? { status: "failed", attempts, detail: str(e.message).slice(0, 300), done_at: new Date().toISOString() } : { attempts, detail: str(e.message).slice(0, 300) } }).catch(() => undefined);
    }
  }
  // Handled events are kept three days.
  if (Math.random() < 0.02) await db(`workflow_queue?status=neq.new&done_at=lt.${encodeURIComponent(new Date(Date.now() - 3 * 864e5).toISOString())}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => undefined);
}

/** Date rules: once a day per company. */
async function runDaily() {
  const { date: today, hour } = nairobi();
  if (hour < 7) return;
  const all = await rows("workflow_rules?is_active=is.true&trigger_type=eq.date&select=*&order=tenant_id");
  const byTenant = new Map();
  for (const r of all) { if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, []); byTenant.get(r.tenant_id).push(r); }
  for (const [tenantId, rules] of byTenant) {
    const claim = await db("workflow_daily?on_conflict=tenant_id,run_date", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { tenant_id: tenantId, run_date: today } }).catch(() => []);
    if (!Array.isArray(claim) || !claim.length) continue;
    for (const rule of rules) {
      try {
        const cfg = WF_MODULES[rule.module];
        if (!cfg || !cfg.dates.includes(rule.date_field)) continue;
        // "N days after the due date" runs when date + N = today; catch up two missed days, never before the rule existed.
        const offset = Number(rule.date_offset) || 0;
        const hi = addDays(today, -offset);
        const madeOn = String(rule.created_at || today).slice(0, 10);
        const lo = [addDays(hi, -2), addDays(madeOn, -offset)].sort().pop();
        if (lo > hi) continue;
        const f = rule.date_field;
        const list = await rows(`${cfg.table}?tenant_id=eq.${tenantId}&${f}=gte.${lo}&${f}=lt.${addDays(hi, 1)}&select=*&order=${f}&limit=1000`);
        for (const row of list) {
          const r = await enrich(rule.module, row);
          if (!conditionsHold(rule, r)) continue;
          await runRule(rule, rule.module, r, `d:${String(row[f]).slice(0, 10)}`, []);
        }
      } catch (e) { console.error("[workflows] date rule failed", rule.id, e.message); }
    }
  }
}

export function startWorkflows(emailSender) {
  sendEmail = emailSender;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runQueue(); } catch (e) { console.error("[workflows] queue failed", e.message); } finally { busy = false; }
  };
  let dBusy = false;
  const daily = async () => {
    if (dBusy) return;
    dBusy = true;
    try { await runDaily(); } catch (e) { console.error("[workflows] daily failed", e.message); } finally { dBusy = false; }
  };
  setTimeout(tick, 25_000).unref();
  setInterval(tick, 20_000).unref();
  setTimeout(daily, 120_000).unref();
  setInterval(daily, 15 * 60_000).unref();
}
