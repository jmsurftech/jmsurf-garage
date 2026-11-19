// ---------------------------------------------------------------------------
// Recurring bills, expenses and invoices.
//
// Runs inside the app server (the edge function was never deployed, so these
// were never generated). Every hour it creates what has fallen due. Each item
// is claimed first by moving its next due date forward only if nobody else
// has, so a second server or an overlapping run can never create duplicates.
// ---------------------------------------------------------------------------

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.JMSURF_SUPABASE_SERVICE_KEY ||
  "";

const MAX_CATCH_UP = 12; // at most a year of monthly items in one run

async function db(path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function advance(dateStr, interval, unit) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  const n = Math.max(1, Number(interval) || 1);
  if (unit === "days") d.setUTCDate(d.getUTCDate() + n);
  else if (unit === "weeks") d.setUTCDate(d.getUTCDate() + n * 7);
  else {
    // Months and years keep the same day, clamped to the month's last day
    // (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
    const months = unit === "years" ? n * 12 : n;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

// Nairobi calendar date.
const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Moves next_due_date forward only if it still holds `from`. True when this run owns the period. */
async function claim(table, id, from, to, extra) {
  const rows = await db(
    `${table}?id=eq.${id}&next_due_date=eq.${from}&select=id`,
    { method: "PATCH", body: { next_due_date: to, ...extra }, prefer: "return=representation" },
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function runTable(table, makeRow, stampColumn) {
  const t = today();
  const due = await db(`${table}?is_recurring=eq.true&next_due_date=lte.${t}&select=*&order=next_due_date.asc&limit=500`);
  let made = 0;
  for (const item of due || []) {
    let current = String(item.next_due_date).slice(0, 10);
    for (let i = 0; i < MAX_CATCH_UP && current <= t; i++) {
      const next = advance(current, item.recurrence_interval, item.recurrence_unit);
      const owned = await claim(table, item.id, current, next, { [stampColumn]: new Date().toISOString() });
      if (!owned) break; // someone else handled it
      try {
        const row = await makeRow(item, current, next);
        // A books bill (numbered, with lines) repeats as a new bill; an old shop "bill" (rent, utilities) as an expense.
        const target = table === "bills" ? (item.bill_number ? "bills" : "expenses") : table;
        await db(target, { method: "POST", body: row, prefer: "return=minimal" });
        made++;
      } catch (error) {
        // Give the period back so the next run retries it.
        await db(`${table}?id=eq.${item.id}&next_due_date=eq.${next}`, { method: "PATCH", body: { next_due_date: current } }).catch(() => {});
        console.error(`[recurring] ${table} ${item.id} failed`, error.message);
        break;
      }
      current = next;
    }
  }
  return made;
}

export async function processRecurring() {
  const bills = await runTable("bills", async (bill, period) => bill.bill_number ? await (async () => {
    const number = await db("rpc/next_doc_number", { method: "POST", body: { p_kind: "bill", p_tenant: bill.tenant_id } }).catch(() => null);
    const termsDays = bill.bill_date && bill.due_date ? Math.max(0, Math.round((new Date(bill.due_date) - new Date(bill.bill_date)) / 86400000)) : 30;
    const due = new Date(`${period}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + termsDays);
    const supplier = String(bill.name || "").split(" · ")[0];
    return {
      tenant_id: bill.tenant_id, created_by: bill.created_by, supplier_id: bill.supplier_id, location_id: bill.location_id,
      name: `${supplier} · ${number || ""}`, bill_number: number, category: bill.category, items: bill.items, subtotal: bill.subtotal, tax: bill.tax, amount: bill.amount,
      bill_date: period, due_date: due.toISOString().slice(0, 10), status: "pending", amount_paid: 0, is_recurring: false,
      reference: `Recurring ${bill.bill_number}`, notes: bill.notes, payment_terms: bill.payment_terms,
    };
  })() : ({
    category_name: bill.category || "Bill payment",
    description: `Recurring bill: ${bill.name}`,
    amount: bill.amount,
    location_id: bill.location_id,
    expense_date: period,
    tenant_id: bill.tenant_id,
    created_by: bill.created_by,
  }), "updated_at");

  const expenses = await runTable("expenses", (exp, period) => ({
    category_id: exp.category_id,
    category_name: exp.category_name,
    description: exp.description,
    amount: exp.amount,
    location_id: exp.location_id,
    expense_date: period,
    tenant_id: exp.tenant_id,
    created_by: exp.created_by,
    is_recurring: false,
    supplier_id: exp.supplier_id ?? null,
    vendor_name: exp.vendor_name ?? null,
    payment_method: exp.payment_method ?? null,
    paid_through: exp.paid_through ?? null,
    tax_amount: exp.tax_amount ?? 0,
    notes: exp.notes ? `${exp.notes} (repeat of ${exp.expense_number || "expense"})` : `Repeat of ${exp.expense_number || "expense"}`,
    customer_id: exp.customer_id ?? null,
    employee_id: exp.employee_id ?? null,
    created_by_name: "Automatic (recurring)",
  }), "last_generated_at");

  const invoices = await runTable("invoices", async (inv, period, next) => {
    // Proper invoice numbers from the company's own sequence (INV-000123).
    const number = await db("rpc/next_doc_number", { method: "POST", body: { p_kind: "invoice", p_tenant: inv.tenant_id } }).catch(() => null);
    const termsDays = inv.issue_date && inv.due_date ? Math.max(0, Math.round((new Date(inv.due_date) - new Date(inv.issue_date)) / 86400000)) : 0;
    const due = new Date(`${period}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + termsDays);
    return {
      invoice_number: number || `INV-${Date.now().toString(36).toUpperCase()}`,
      customer_id: inv.customer_id, customer_name: inv.customer_name, customer_email: inv.customer_email, customer_phone: inv.customer_phone ?? null,
      items: inv.items, subtotal: inv.subtotal, tax: inv.tax, discount: inv.discount, shipping: inv.shipping ?? 0, adjustment: inv.adjustment ?? 0, total: inv.total,
      notes: inv.notes, customer_notes: inv.customer_notes ?? null, terms: inv.terms ?? null, subject: inv.subject ?? null, payment_terms: inv.payment_terms ?? null,
      salesperson_id: inv.salesperson_id ?? null, salesperson_name: inv.salesperson_name ?? null,
      status: "sent", issue_date: period, due_date: due.toISOString().slice(0, 10), reference: inv.invoice_number, source: "recurring",
      tenant_id: inv.tenant_id, created_by: inv.created_by, is_recurring: false,
    };
  }, "last_generated_at");

  return { bills, expenses, invoices };
}

export function startRecurringScheduler() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn("[recurring] not started: missing Supabase URL or service key");
    return;
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const made = await processRecurring();
      if (made.bills || made.expenses || made.invoices) console.log("[recurring] generated", made);
    } catch (error) {
      console.error("[recurring] run failed", error.message);
    } finally { busy = false; }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 15 * 60 * 1000).unref();
}
