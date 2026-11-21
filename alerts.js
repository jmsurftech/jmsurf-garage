import { publicBase } from "./hosts.js";
// ---------------------------------------------------------------------------
// Customer alerts, run every 15 minutes after the shop's send hour (Nairobi):
//
//  * Debt alerts: an unpaid invoice with a due date gets a reminder at each
//    stage (default 3 days before, on the day, then 3/7/14/30 days late).
//    The customer gets an SMS and email; the owner, the attendants and the
//    invoice's sales rep get a bell notification; the rep also gets an SMS.
//    Each (invoice, stage, channel, recipient) is logged once in debt_alerts.
//  * Restock reminders: customer_reminders that fall due (e.g. dewormer every
//    3 months) send the customer an SMS and tell the attendants and the rep.
//
// Rules live in business_settings.erp_settings.alerts (Settings → Alerts).
// ---------------------------------------------------------------------------
import { sendForShop, smsConfigured } from "./messaging.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY || process.env.JMSURF_SUPABASE_SERVICE_KEY || "";
/** The company's customer pages (custom domain when live, else app.jmsurfgarage.co.ke/<slug>) for links in reminders. */
const companyOrigin = (tenantId) => publicBase(tenantId);

export const DEFAULT_ALERTS = {
  send_hour: 9,
  debt: { enabled: true, stages: [-3, 0, 3, 7, 14, 30], customer_sms: true, customer_email: true, rep_sms: true, staff_inapp: true },
  restock: { enabled: true, days_before: 3, customer_sms: true, staff_inapp: true },
};

let sendEmail = null;
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

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
const rows = async (path) => { try { const d = await db(path); return Array.isArray(d) ? d : []; } catch (e) { console.error("[alerts]", e.message); return []; } };

/** Today's date and hour in Nairobi. */
function nairobiNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const niceDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function mergeRules(saved) {
  const a = saved?.alerts || {};
  return { send_hour: Number(a.send_hour ?? DEFAULT_ALERTS.send_hour), debt: { ...DEFAULT_ALERTS.debt, ...(a.debt || {}) }, restock: { ...DEFAULT_ALERTS.restock, ...(a.restock || {}) } };
}

/** Claims an alert slot; false when it was already sent. */
async function claim(tenantId, invoiceId, stage, channel, recipient) {
  const r = await db("debt_alerts?on_conflict=invoice_id,stage,channel,recipient", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=representation",
    body: { tenant_id: tenantId, invoice_id: invoiceId, stage: String(stage), channel, recipient: recipient || "-", status: "sending" },
  }).catch((e) => { console.error("[alerts] claim failed", e.message); return []; });
  return Array.isArray(r) && r.length ? r[0].id : null;
}
const finish = (id, ok, detail) => db(`debt_alerts?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { status: ok ? "sent" : "failed", detail: str(detail).slice(0, 300) } }).catch(() => undefined);

const notify = (tenantId, n) => db("shop_notifications", { method: "POST", prefer: "return=minimal", body: { tenant_id: tenantId, kind: n.kind, title: n.title, body: n.body, link: n.link, user_id: n.user_id || null, role: n.role || null, entity_type: n.entity_type || null, entity_id: n.entity_id || null } })
  .catch((e) => console.error("[alerts] notify failed", e.message));

function stageLabel(days) {
  if (days < 0) return `due in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

async function debtAlerts(tenantId, shop, rules, today) {
  const stages = [...new Set((rules.debt.stages || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!stages.length) return;
  const debts = await rows(`debts_view?tenant_id=eq.${tenantId}&due_date=not.is.null&select=invoice_id,invoice_number,customer_id,customer_name,customer_phone,due_date,balance,salesperson_id,salesperson_name`);
  if (!debts.length) return;
  const custIds = [...new Set(debts.map((d) => d.customer_id).filter(Boolean))];
  const customers = custIds.length ? await rows(`customers?id=in.(${custIds.join(",")})&select=id,name,phone,email,reminders_stopped`) : [];
  const custById = new Map(customers.map((c) => [c.id, c]));
  // "Stop all reminders" on a customer: no automatic debt reminders for them.
  for (let i = debts.length - 1; i >= 0; i--) if (custById.get(debts[i].customer_id)?.reminders_stopped) debts.splice(i, 1);
  const reps = await rows(`sales_reps?tenant_id=eq.${tenantId}&select=user_id,display_name,phone`);
  const repById = new Map(reps.map((r) => [r.user_id, r]));

  for (const d of debts) {
    const days = dayDiff(today, d.due_date);
    const stage = stages.filter((s) => s <= days).pop();
    // Only the latest stage reached, and only within 2 days of reaching it (no back-fill of old stages).
    if (stage === undefined || days - stage > 2) continue;
    const c = custById.get(d.customer_id) || {};
    const name = str(c.name || d.customer_name) || "Customer";
    const phone = str(c.phone || d.customer_phone);
    const when = days < 0 ? `is due on ${niceDate(d.due_date)}` : days === 0 ? "is due today" : `was due on ${niceDate(d.due_date)}`;
    const payLine = str(shop.pay_text) ? ` ${str(shop.pay_text)}` : "";
    const msg = `Hi ${name.split(" ")[0]}, your balance of ${kes(d.balance)} on ${d.invoice_number} at ${shop.name} ${when}.${payLine} Thank you.${shop.phone ? ` Questions: ${shop.phone}` : ""}`;
    const label = `${d.invoice_number}: ${kes(d.balance)} ${stageLabel(days)}`;

    if (rules.debt.customer_sms && phone) {
      const id = await claim(tenantId, d.invoice_id, stage, "sms", phone);
      if (id) { const r = await sendForShop({ tenantId, channel: "sms", to: phone, text: msg }); await finish(id, r.ok, r.ok ? "sent" : r.error); }
    }
    if (rules.debt.customer_email && c.email && sendEmail) {
      const id = await claim(tenantId, d.invoice_id, stage, "email", c.email);
      if (id) {
        const r = await sendEmail({ tenantId, to: c.email, subject: `${d.invoice_number}: payment ${stageLabel(days)}`, text: msg, html: `<p>${msg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p><p><a href="${shop.origin}/account">See your account</a></p>` }).catch((e) => ({ ok: false, error: e.message }));
        await finish(id, r?.ok !== false, r?.error || "sent");
      }
    }
    if (rules.debt.staff_inapp) {
      const id = await claim(tenantId, d.invoice_id, stage, "inapp", "staff");
      if (id) {
        const base = { kind: "debt_due", title: `Debt ${stageLabel(days)}: ${name}`, body: label, link: "/sales/debts", entity_type: "invoice", entity_id: d.invoice_id };
        await notify(tenantId, { ...base, role: "admin" });
        await notify(tenantId, { ...base, role: "manager" });
        await notify(tenantId, { ...base, role: "cashier" });
        if (d.salesperson_id) await notify(tenantId, { ...base, user_id: d.salesperson_id, title: `Your customer's debt ${stageLabel(days)}: ${name}` });
        await finish(id, true, "notified");
      }
    }
    const rep = d.salesperson_id ? repById.get(d.salesperson_id) : null;
    if (rules.debt.rep_sms && rep?.phone) {
      const id = await claim(tenantId, d.invoice_id, stage, "rep_sms", rep.phone);
      if (id) {
        const r = await sendForShop({ tenantId, channel: "sms", to: rep.phone, text: `${shop.name}: your customer ${name} (${phone || "no phone"}) has ${kes(d.balance)} on ${d.invoice_number}, ${stageLabel(days)}. Please follow up.` });
        await finish(id, r.ok, r.ok ? "sent" : r.error);
      }
    }
  }
}

/** Next date of a recurring reminder. */
function nextDue(date, every, unit) {
  const d = new Date(`${date}T00:00:00Z`);
  const n = Math.max(1, Number(every) || 1);
  if (unit === "day") d.setUTCDate(d.getUTCDate() + n);
  else if (unit === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (unit === "year") d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Customer reminders that fall due: restock (repurchase), pet return visits and custom ones.
    The customer gets an SMS and/or email (per reminder), staff get a bell alert, and a recurring
    reminder books its next date. */
async function restockAlerts(tenantId, shop, rules, today) {
  const until = addDays(today, Math.max(0, Number(rules.restock.days_before) || 0));
  const due = await rows(`customer_reminders?tenant_id=eq.${tenantId}&status=eq.scheduled&due_date=lte.${until}&select=*&order=due_date.asc&limit=300`);
  if (!due.length) return;
  const custIds = [...new Set(due.map((r) => r.customer_id))];
  const customers = await rows(`customers?id=in.(${custIds.join(",")})&select=id,name,phone,email,reminders_stopped`);
  const byId = new Map(customers.map((c) => [c.id, c]));
  for (let i = due.length - 1; i >= 0; i--) if (byId.get(due[i].customer_id)?.reminders_stopped) due.splice(i, 1);
  const petIds = [...new Set(due.map((r) => r.pet_id).filter(Boolean))];
  const pets = new Map((petIds.length ? await rows(`customer_pets?id=in.(${petIds.join(",")})&select=id,name`) : []).map((p) => [p.id, p]));
  for (const r of due) {
    // Visits are sent on the day before (or the day); restock follows the shop's "days before" rule.
    if (r.kind === "visit" && dayDiff(r.due_date, today) > 1) continue;
    // Claim first so two servers never send the same reminder.
    const claimed = await db(`customer_reminders?id=eq.${r.id}&status=eq.scheduled`, { method: "PATCH", body: { status: "sent", notified_at: new Date().toISOString(), updated_at: new Date().toISOString() } }).catch(() => []);
    if (!Array.isArray(claimed) || !claimed.length) continue;
    const c = byId.get(r.customer_id) || {};
    const pet = r.pet_id ? pets.get(r.pet_id)?.name : null;
    const first = str(c.name).split(" ")[0] || "there";
    const ch = r.channels || {};
    const results = {};
    const late = dayDiff(today, r.due_date) > 0;
    let text;
    if (r.kind === "visit") {
      text = `Hi ${first}, a reminder from ${shop.name}: ${pet ? `${pet}: ` : "your "}${str(r.title) || "next visit"} is due ${late ? "now" : niceDate(r.due_date)}.${shop.phone ? ` Call ${shop.phone} to confirm.` : ""}`;
    } else if (r.kind === "custom") {
      text = `Hi ${first}, a reminder from ${shop.name}: ${str(r.title) || "you have a reminder"}${r.note ? `. ${str(r.note)}` : ""}${pet ? ` (${pet})` : ""}.`;
    } else {
      const item = str(r.product_name) || "your supplies";
      text = `Hi ${first}, it's ${late ? "time" : "almost time"} to restock ${item}${pet ? ` for ${pet}` : ""}. Order at ${shop.name} or online: ${shop.origin}/shop${shop.phone ? `, or call ${shop.phone}` : ""}.`;
    }
    if (rules.restock.customer_sms && ch.sms !== false && c.phone) {
      const res = await sendForShop({ tenantId, channel: "sms", to: c.phone, text });
      results.sms = res.ok ? "sent" : res.error;
    }
    if (ch.email !== false && c.email && sendEmail) {
      const res = await sendEmail({ tenantId, to: c.email, subject: `${shop.name}: ${r.kind === "visit" ? "visit reminder" : r.kind === "custom" ? str(r.title) || "reminder" : "time to restock"}`, text, html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p><p><a href="${shop.origin}/account">Open your account</a></p>` }).catch((e) => ({ ok: false, error: e.message }));
      results.email = res?.ok === false ? res.error : "sent";
    }
    if (rules.restock.staff_inapp) {
      const label = r.kind === "visit" ? "Visit due" : r.kind === "custom" ? "Reminder due" : "Restock due";
      const base = { kind: "restock_due", title: `${label}: ${str(c.name) || "customer"}${pet ? ` (${pet})` : ""}`, body: `${str(r.title) || str(r.product_name) || label} · ${niceDate(r.due_date)}${c.phone ? ` · ${c.phone}` : ""}`, link: `/customers/${r.customer_id}`, entity_type: "customer", entity_id: r.customer_id };
      await notify(tenantId, { ...base, role: "cashier" });
      await notify(tenantId, { ...base, role: "admin" });
      if (r.sales_rep_id) await notify(tenantId, { ...base, user_id: r.sales_rep_id });
      results.inapp = "notified";
    }
    await db(`customer_reminders?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal", body: { results } }).catch(() => undefined);
    // Recurring: book the next one.
    if (r.repeat_every && r.repeat_unit) {
      const next = nextDue(r.due_date, r.repeat_every, r.repeat_unit);
      if (!r.repeat_until || next <= r.repeat_until) {
        await db("customer_reminders", { method: "POST", prefer: "return=minimal", body: {
          tenant_id: tenantId, customer_id: r.customer_id, pet_id: r.pet_id, kind: r.kind, product_id: r.product_id, product_name: r.product_name,
          due_date: next, title: r.title, note: r.note, status: "scheduled", sales_rep_id: r.sales_rep_id, created_by: r.created_by,
          repeat_every: r.repeat_every, repeat_unit: r.repeat_unit, repeat_until: r.repeat_until, channels: r.channels, parent_id: r.parent_id || r.id,
        } }).catch((e) => console.error("[alerts] next reminder", e.message));
      }
    }
  }
}

/** Purchase orders whose expected delivery date has come with goods still to arrive: one bell alert a day. */
async function deliveryAlerts(tenantId, today) {
  const due = await rows(`purchases?tenant_id=eq.${tenantId}&status=in.(pending,partially_received)&expected_date=lte.${today}&or=(delivery_alerted_on.is.null,delivery_alerted_on.lt.${today})&select=id,po_number,supplier_name,expected_date,status&limit=100`);
  for (const p of due) {
    const late = dayDiff(today, p.expected_date);
    const base = { kind: "delivery_due", title: `${late > 0 ? "Delivery late" : "Delivery due today"}: ${p.po_number || "purchase order"}`, body: `${p.supplier_name || "Supplier"}${p.status === "partially_received" ? " · balance of a partial delivery" : ""} · expected ${niceDate(p.expected_date)}`, link: `/purchases/orders/${p.id}`, entity_type: "purchase", entity_id: p.id };
    for (const role of ["admin", "manager", "stock_manager"]) await notify(tenantId, { ...base, role });
    await db(`purchases?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { delivery_alerted_on: today } }).catch(() => undefined);
  }
}

/** Low and out-of-stock: one bell alert a day per product, to owners, managers and stock staff. */
async function stockAlerts(tenantId, today) {
  const items = await rows(`products?tenant_id=eq.${tenantId}&is_active=eq.true&select=id,name,stock,reorder_level&limit=5000`);
  const low = items.filter((p) => Number(p.stock) <= Number(p.reorder_level ?? 0));
  if (!low.length) return;
  const done = new Set((await rows(`stock_alert_log?tenant_id=eq.${tenantId}&alerted_on=eq.${today}&select=product_id`)).map((x) => x.product_id));
  const fresh = low.filter((p) => !done.has(p.id));
  if (!fresh.length) return;
  const out = fresh.filter((p) => Number(p.stock) <= 0);
  const few = fresh.filter((p) => Number(p.stock) > 0);
  const list = (arr) => arr.slice(0, 6).map((p) => `${p.name} (${Number(p.stock)})`).join(", ") + (arr.length > 6 ? ` and ${arr.length - 6} more` : "");
  for (const [arr, kind, title] of [[out, "out_of_stock", `${out.length} item${out.length === 1 ? " is" : "s are"} out of stock`], [few, "low_stock", `${few.length} item${few.length === 1 ? " is" : "s are"} running low`]]) {
    if (!arr.length) continue;
    for (const role of ["admin", "manager", "stock_manager"]) await notify(tenantId, { kind, title, body: list(arr), link: "/inventory/products?view=low", role, entity_type: "stock" });
    await db("stock_alert_log?on_conflict=product_id,kind,alerted_on", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: arr.map((p) => ({ tenant_id: tenantId, product_id: p.id, kind, alerted_on: today })) }).catch(() => undefined);
  }
}

async function runOnce({ anyHour = false } = {}) {
  const { date: today, hour } = nairobiNow();
  const settings = await rows(`business_settings?select=tenant_id,business_name,business_phone,erp_settings`);
  for (const s of settings) {
    const rules = mergeRules(s.erp_settings);
    try { await stockAlerts(s.tenant_id, today); } catch (e) { console.error("[alerts] stock run failed", s.tenant_id, e.message); }
    try { if (hour >= 7) await deliveryAlerts(s.tenant_id, today); } catch (e) { console.error("[alerts] delivery run failed", s.tenant_id, e.message); }
    if (!anyHour && (hour < rules.send_hour || hour >= 20)) continue; // no SMS at night
    // Without SMS set up, SMS alerts wait (they are not used up as failures).
    const smsOn = await smsConfigured(s.tenant_id);
    if (!smsOn) { rules.debt.customer_sms = false; rules.debt.rep_sms = false; rules.restock.customer_sms = false; }
    const shop = { name: str(s.business_name) || "our shop", phone: str(s.business_phone), pay_text: str(s.erp_settings?.alerts?.pay_text), origin: await companyOrigin(s.tenant_id) };
    try { if (rules.debt.enabled) await debtAlerts(s.tenant_id, shop, rules, today); } catch (e) { console.error("[alerts] debt run failed", s.tenant_id, e.message); }
    try { if (rules.restock.enabled) await restockAlerts(s.tenant_id, shop, rules, today); } catch (e) { console.error("[alerts] restock run failed", s.tenant_id, e.message); }
  }
}

/** Runs one pass now (for a manual check from the server console). */
export const runCustomerAlertsNow = (opts) => runOnce(opts);

export function startCustomerAlerts(emailSender) {
  sendEmail = emailSender;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runOnce(); } catch (e) { console.error("[alerts] run failed", e.message); } finally { busy = false; }
  };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
