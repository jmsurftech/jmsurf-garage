// ---------------------------------------------------------------------------
// Garage AI: the JMSURF Garage business assistant.
//
// POST /api/ai/chat  { messages: [{ role: "user"|"assistant", content: string }] }
//   → { reply, actions: [{ id, type, input, summary }], used: [tool names] }
//
// Garage AI answers from the company's live data through read-only tools that run
// with the signed-in person's own access token, so database row security
// applies exactly as in the app: Garage AI can never see more than the person can.
// Garage AI never changes anything itself: "propose_*" tools only return a
// proposal; the app shows it and the person confirms it (the app then does it
// with their own permissions).
// ---------------------------------------------------------------------------
import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SERVICE_SUPABASEANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const MODEL = process.env.DASH_AI_MODEL || process.env.RENA_MODEL || "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

let client = null;
const anthropic = () => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const enc = encodeURIComponent;
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const isAiRoute = (pathname) => pathname.startsWith("/api/ai/");

/* ------------------------------------------------------------------ data */

function makeDb(token) {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const get = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(str(j?.message) || `Data error ${r.status}`);
    return j;
  };
  const rpc = async (fn, args = {}) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(str(j?.message) || `Data error ${r.status}`);
    return j;
  };
  return { get, rpc };
}

async function whoIs(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(401, "Sign in again");
  const user = await r.json();
  const db = makeDb(token);
  const prof = (await db.get(`profiles?user_id=eq.${user.id}&select=display_name,tenant_id`))?.[0];
  if (!prof?.tenant_id) throw new HttpError(403, "Open a company first");
  const roles = (await db.get(`user_roles?user_id=eq.${user.id}&select=role`)).map((x) => x.role);
  const settings = (await db.get(`business_settings?tenant_id=eq.${prof.tenant_id}&select=business_name,currency,country`))?.[0] || {};
  const on = await db.rpc("tenant_module_active", { p_tenant: prof.tenant_id, p_key: "ai" });
  if (on !== true) throw new HttpError(402, "Switch on Garage AI in System → Modules to chat with Garage AI.");
  return { user, db, name: prof.display_name || user.email, tenantId: prof.tenant_id, roles, company: settings.business_name || "your company", currency: settings.currency || "KES", country: settings.country || "KE" };
}

/* ------------------------------------------------------------------ tools */

const READ_TOOLS = [
  {
    name: "business_overview",
    description: "Headline numbers for a period: income, cost of sales, expenses, net profit, cash and bank balances, money customers owe (receivables), money owed to suppliers (payables), and how many invoices are overdue. Use for 'how is the business doing', profit, cash, totals.",
    input_schema: { type: "object", properties: { from: { type: "string", description: "Start date YYYY-MM-DD (default: 1 January this year)" }, to: { type: "string", description: "End date YYYY-MM-DD (default: today)" } } },
  },
  {
    name: "find_customers",
    description: "Find customers by name, phone or email, with what each owes on unpaid invoices. Leave query empty to list the customers who owe the most.",
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", description: "Max rows, default 15" } } },
  },
  {
    name: "list_invoices",
    description: "Sales invoices. status: unpaid (sent, partially paid or overdue), overdue (past due date and unpaid), paid, draft or all. Optional customer name filter and date range on the invoice date.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["unpaid", "overdue", "paid", "draft", "all"] }, customer: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "integer" } } },
  },
  {
    name: "list_bills",
    description: "Supplier bills (what the company owes suppliers). unpaid_only defaults to true.",
    input_schema: { type: "object", properties: { unpaid_only: { type: "boolean" }, limit: { type: "integer" } } },
  },
  {
    name: "find_items",
    description: "Products and services with price, cost and stock on hand. low_stock_only returns items at or below their reorder level.",
    input_schema: { type: "object", properties: { query: { type: "string" }, low_stock_only: { type: "boolean" }, limit: { type: "integer" } } },
  },
  {
    name: "top_sellers",
    description: "Best-selling items and best customers by revenue in a date range (from invoices and POS sales).",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, limit: { type: "integer" } } },
  },
  {
    name: "expenses_by_category",
    description: "Expenses in a date range grouped by category, largest first.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } },
  },
  {
    name: "crm_pipeline",
    description: "CRM leads and opportunities: counts and expected revenue by stage, plus the largest open opportunities.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "hr_overview",
    description: "Staff: active employees, departments, the latest payroll run (gross, net, deductions) and pending leave requests.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_purchase_orders",
    description: "Purchase orders with their supplier, status (draft, pending = issued, partially_received, received, cancelled), total and items still to receive.",
    input_schema: { type: "object", properties: { status: { type: "string" }, supplier: { type: "string" }, limit: { type: "integer" } } },
  },
  {
    name: "list_app_records",
    description: "Records of add-on apps: projects/project, projects/task, projects/timesheet, helpdesk/ticket, contracts/contract, fleet/vehicle, manufacturing/mo, recruitment/applicant, field_service/job, appointments/booking, expense/claim and others. Filter by stage.",
    input_schema: { type: "object", properties: { app: { type: "string" }, kind: { type: "string" }, stage: { type: "string" }, limit: { type: "integer" } }, required: ["app", "kind"] },
  },
];

const ACTION_TOOLS = [
  {
    name: "propose_create_customer",
    description: "Propose adding a customer. Nothing is saved until the user confirms in the app.",
    input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, company_name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "propose_create_invoice",
    description: "Propose a draft invoice. Use find_customers and find_items first to use the right names and prices. Nothing is saved until the user confirms.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, rate: { type: "number" }, tax_rate: { type: "number" } }, required: ["name", "quantity", "rate"] } },
        due_in_days: { type: "integer" },
        notes: { type: "string" },
      },
      required: ["customer_name", "items"],
    },
  },
  {
    name: "propose_payment_reminders",
    description: "Propose sending SMS/email payment reminders for unpaid invoices to the named customers. Nothing is sent until the user confirms.",
    input_schema: { type: "object", properties: { customer_names: { type: "array", items: { type: "string" } }, message: { type: "string", description: "Optional friendly opening line" } }, required: ["customer_names"] },
  },
  {
    name: "propose_task",
    description: "Propose a task (in JMSURF PROJECTS) with an optional due date and project name. Nothing is saved until the user confirms.",
    input_schema: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string" }, project: { type: "string" }, description: { type: "string" } }, required: ["title"] },
  },
  {
    name: "propose_lead",
    description: "Propose a CRM lead. Nothing is saved until the user confirms.",
    input_schema: { type: "object", properties: { name: { type: "string" }, contact_name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, expected_revenue: { type: "number" }, notes: { type: "string" } }, required: ["name"] },
  },
  {
    name: "propose_purchase_order",
    description: "Propose a purchase order to a supplier (e.g. from an attached quotation or delivery note). receive_now: true also receives the goods into stock straight away. Nothing is saved until the user confirms.",
    input_schema: {
      type: "object",
      properties: {
        supplier_name: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, unit_cost: { type: "number" } }, required: ["name", "quantity", "unit_cost"] } },
        expected_date: { type: "string" }, reference: { type: "string" }, receive_now: { type: "boolean" },
      },
      required: ["supplier_name", "items"],
    },
  },
  {
    name: "propose_receive_purchase_order",
    description: "Propose receiving all outstanding items of an issued purchase order into stock. Use list_purchase_orders first. Nothing is saved until the user confirms.",
    input_schema: { type: "object", properties: { po_number: { type: "string" } }, required: ["po_number"] },
  },
  {
    name: "propose_bill",
    description: "Propose a supplier bill (e.g. from an attached supplier invoice the company has to pay later). Nothing is saved until the user confirms.",
    input_schema: {
      type: "object",
      properties: {
        supplier_name: { type: "string" }, supplier_pin: { type: "string" }, reference: { type: "string", description: "The supplier's invoice number" },
        bill_date: { type: "string" }, due_date: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, rate: { type: "number", description: "Price before VAT" }, tax_rate: { type: "number" } }, required: ["name", "quantity", "rate"] } },
      },
      required: ["supplier_name", "items"],
    },
  },
  {
    name: "propose_expense",
    description: "Propose recording an expense. Nothing is saved until the user confirms.",
    input_schema: { type: "object", properties: { category: { type: "string" }, amount: { type: "number" }, date: { type: "string" }, vendor: { type: "string" }, description: { type: "string" }, paid_through: { type: "string", description: "Cash, M-Pesa or Bank" } }, required: ["category", "amount"] },
  },
];

const lim = (n, d = 15, max = 50) => Math.min(max, Math.max(1, Number(n) || d));

async function runReadTool(who, name, input) {
  const { db } = who;
  const from = str(input.from) || yearStart();
  const to = str(input.to) || today();
  switch (name) {
    case "business_overview": {
      const bal = await db.rpc("acc_balances", { p_from: from, p_to: to });
      const period = (b) => Number(b.debit) - Number(b.credit);
      const sum = (f, pred) => round(bal.filter(pred).reduce((a, b) => a + f(b), 0));
      const income = -sum(period, (b) => b.type === "income");
      const cogs = sum(period, (b) => b.sub_type === "cost_of_goods_sold");
      const expenses = sum(period, (b) => b.type === "expense" && b.sub_type !== "cost_of_goods_sold");
      const cash = bal.filter((b) => ["cash", "bank"].includes(b.sub_type)).map((b) => ({ account: b.name, balance: round(b.closing) }));
      const ar = sum((b) => Number(b.closing), (b) => b.sub_type === "accounts_receivable");
      const ap = -sum((b) => Number(b.closing), (b) => b.sub_type === "accounts_payable");
      const overdue = await db.get(`invoices?status=in.(sent,overdue,partially_paid)&due_date=lt.${today()}&select=total,amount_paid&limit=5000`);
      return {
        period: { from, to }, currency: who.currency, income, cost_of_sales: cogs, gross_profit: round(income - cogs), expenses, net_profit: round(income - cogs - expenses),
        cash_and_bank: cash, receivables: ar, payables: ap,
        overdue_invoices: { count: overdue.length, amount: round(overdue.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid || 0), 0)) },
      };
    }
    case "find_customers": {
      const q = str(input.query);
      const filter = q ? `&or=(name.ilike.*${enc(q)}*,phone.ilike.*${enc(q)}*,email.ilike.*${enc(q)}*)` : "";
      const custs = await db.get(`customers?select=id,name,phone,email,company_name${filter}&limit=${q ? 50 : 2000}`);
      const ids = custs.map((c) => c.id);
      const inv = ids.length ? await db.get(`invoices?status=in.(sent,overdue,partially_paid)&select=customer_id,total,amount_paid,due_date&limit=10000`) : [];
      const owed = new Map(); const overdue = new Map();
      inv.forEach((i) => { const d = Number(i.total) - Number(i.amount_paid || 0); owed.set(i.customer_id, (owed.get(i.customer_id) || 0) + d); if (i.due_date && i.due_date < today()) overdue.set(i.customer_id, (overdue.get(i.customer_id) || 0) + d); });
      return custs.map((c) => ({ name: c.name, phone: c.phone, email: c.email, company: c.company_name, owes: round(owed.get(c.id) || 0), overdue: round(overdue.get(c.id) || 0) }))
        .sort((a, b) => b.owes - a.owes).slice(0, lim(input.limit));
    }
    case "list_invoices": {
      const st = str(input.status) || "unpaid";
      let f = st === "unpaid" ? "&status=in.(sent,overdue,partially_paid)" : st === "overdue" ? `&status=in.(sent,overdue,partially_paid)&due_date=lt.${today()}` : st === "all" ? "" : `&status=eq.${st}`;
      if (input.customer) f += `&customer_name=ilike.*${enc(str(input.customer))}*`;
      if (input.from) f += `&issue_date=gte.${enc(str(input.from))}`;
      if (input.to) f += `&issue_date=lte.${enc(str(input.to))}`;
      const rows = await db.get(`invoices?select=invoice_number,customer_name,issue_date,due_date,total,amount_paid,status${f}&order=issue_date.desc&limit=${lim(input.limit, 20, 100)}`);
      return rows.map((r) => ({ ...r, balance: round(Number(r.total) - Number(r.amount_paid || 0)) }));
    }
    case "list_bills": {
      const f = input.unpaid_only === false ? "" : "&status=not.in.(paid,void,draft)";
      const rows = await db.get(`bills?select=bill_number,name,bill_date,due_date,amount,amount_paid,status${f}&order=due_date.asc.nullslast&limit=${lim(input.limit, 20, 100)}`);
      return rows.map((r) => ({ ...r, balance: round(Number(r.amount) - Number(r.amount_paid || 0)) }));
    }
    case "find_items": {
      const q = str(input.query);
      const rows = await db.get(`products?is_active=eq.true&select=name,sku,price,cost_price,stock,reorder_level,unit,product_type${q ? `&or=(name.ilike.*${enc(q)}*,sku.ilike.*${enc(q)}*)` : ""}&order=name&limit=${input.low_stock_only ? 2000 : lim(input.limit, 20, 100)}`);
      return input.low_stock_only ? rows.filter((r) => r.product_type !== "service" && Number(r.stock) <= Number(r.reorder_level || 0)).slice(0, lim(input.limit, 30, 100)) : rows;
    }
    case "top_sellers": {
      const inv = await db.get(`invoices?status=not.in.(draft,void)&issue_date=gte.${enc(from)}&issue_date=lte.${enc(to)}&select=customer_name,items,total&limit=5000`);
      const pos = await db.get(`transactions?status=eq.completed&invoice_id=is.null&created_at=gte.${enc(from)}&created_at=lte.${enc(to)}T23:59:59&select=customer_name,items,total&limit=10000`);
      const items = new Map(); const customers = new Map();
      for (const d of [...inv, ...pos]) {
        customers.set(d.customer_name || "Walk-in", (customers.get(d.customer_name || "Walk-in") || 0) + Number(d.total || 0));
        for (const i of d.items || []) {
          const k = str(i.name || i.product_name); if (!k) continue;
          const x = items.get(k) || { qty: 0, revenue: 0 };
          const q = Number(i.quantity ?? i.qty ?? 0);
          x.qty += q; x.revenue += Number(i.amount ?? i.total ?? q * Number(i.rate ?? i.price ?? 0));
          items.set(k, x);
        }
      }
      const n = lim(input.limit, 10, 30);
      return {
        period: { from, to },
        top_items: [...items].map(([name, v]) => ({ name, quantity: v.qty, revenue: round(v.revenue) })).sort((a, b) => b.revenue - a.revenue).slice(0, n),
        top_customers: [...customers].map(([name, v]) => ({ name, revenue: round(v) })).sort((a, b) => b.revenue - a.revenue).slice(0, n),
      };
    }
    case "expenses_by_category": {
      const rows = await db.get(`expenses?expense_date=gte.${enc(from)}&expense_date=lte.${enc(to)}&select=category_name,amount&limit=20000`);
      const m = new Map(); rows.forEach((r) => m.set(r.category_name || "Other", (m.get(r.category_name || "Other") || 0) + Number(r.amount || 0)));
      return { period: { from, to }, total: round(rows.reduce((a, r) => a + Number(r.amount || 0), 0)), by_category: [...m].map(([category, amount]) => ({ category, amount: round(amount) })).sort((a, b) => b.amount - a.amount) };
    }
    case "crm_pipeline": {
      const [leads, stages] = await Promise.all([db.get("crm_leads?active=eq.true&select=name,type,stage_id,expected_revenue,probability,won_status,partner_name&limit=5000"), db.get("crm_stages?select=id,name")]);
      const sname = new Map(stages.map((s) => [s.id, s.name]));
      const by = new Map();
      leads.forEach((l) => { const k = sname.get(l.stage_id) || (l.type === "lead" ? "Lead" : "Unstaged"); const x = by.get(k) || { count: 0, expected: 0 }; x.count++; x.expected += Number(l.expected_revenue || 0); by.set(k, x); });
      return { by_stage: [...by].map(([stage, v]) => ({ stage, ...v, expected: round(v.expected) })), largest_open: leads.filter((l) => l.won_status !== "won" && l.won_status !== "lost").sort((a, b) => Number(b.expected_revenue || 0) - Number(a.expected_revenue || 0)).slice(0, 10).map((l) => ({ name: l.name, company: l.partner_name, expected_revenue: Number(l.expected_revenue || 0), stage: sname.get(l.stage_id) || "" })) };
    }
    case "hr_overview": {
      const [emps, runs, leave, depts] = await Promise.all([
        db.get("hr_employees?select=status,department_id,basic_salary&limit=5000"),
        db.get("hr_payroll_runs?select=period,status,total_gross,total_net,total_paye,created_at&order=created_at.desc&limit=1").catch(() => []),
        db.get("hr_leave_requests?status=eq.pending&select=id").catch(() => []),
        db.get("hr_departments?select=id,name"),
      ]);
      const active = emps.filter((e) => e.status !== "exited");
      const dn = new Map(depts.map((d) => [d.id, d.name]));
      const byDept = new Map(); active.forEach((e) => { const k = dn.get(e.department_id) || "No department"; byDept.set(k, (byDept.get(k) || 0) + 1); });
      return { active_employees: active.length, monthly_basic_salaries: round(active.reduce((a, e) => a + Number(e.basic_salary || 0), 0)), by_department: Object.fromEntries(byDept), latest_payroll: runs[0] || null, pending_leave_requests: leave.length };
    }
    case "list_purchase_orders": {
      let q = `purchases?select=po_number,supplier_name,status,order_date,expected_date,total,purchase_items(quantity,received_quantity,products(name))&order=created_at.desc&limit=${lim(input.limit)}`;
      if (str(input.status)) q += `&status=eq.${enc(str(input.status))}`;
      if (str(input.supplier)) q += `&supplier_name=ilike.*${enc(str(input.supplier))}*`;
      const rows = await db.get(q);
      return rows.map((r) => ({ po_number: r.po_number, supplier: r.supplier_name, status: r.status, order_date: r.order_date, expected: r.expected_date, total: round(r.total),
        to_receive: (r.purchase_items || []).map((i) => ({ item: i.products?.name, ordered: i.quantity, received: i.received_quantity })) }));
    }
    case "list_app_records": {
      const f = input.stage ? `&stage=eq.${enc(str(input.stage))}` : "";
      return await db.get(`app_records?app=eq.${enc(str(input.app))}&kind=eq.${enc(str(input.kind))}&archived=eq.false${f}&select=number,title,stage,priority,amount,quantity,starts_at,due_date,data&order=updated_at.desc&limit=${lim(input.limit, 20, 100)}`);
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

function summarize(name, input) {
  const money = (n) => `${Number(n || 0).toLocaleString("en-KE")}`;
  switch (name) {
    case "propose_create_customer": return `Add customer ${input.name}${input.phone ? ` (${input.phone})` : ""}`;
    case "propose_create_invoice": return `Draft invoice for ${input.customer_name}: ${(input.items || []).map((i) => `${i.quantity} × ${i.name} @ ${money(i.rate)}`).join(", ")}`;
    case "propose_payment_reminders": return `Send payment reminders to ${(input.customer_names || []).join(", ")}`;
    case "propose_task": return `Create task "${input.title}"${input.due_date ? ` due ${input.due_date}` : ""}${input.project ? ` in ${input.project}` : ""}`;
    case "propose_lead": return `Add CRM lead ${input.name}${input.expected_revenue ? ` (${money(input.expected_revenue)})` : ""}`;
    case "propose_purchase_order": return `Purchase order to ${input.supplier_name}: ${(input.items || []).map((i) => `${i.quantity} × ${i.name} @ ${money(i.unit_cost)}`).join(", ")}${input.receive_now ? " · and receive the goods now" : ""}`;
    case "propose_receive_purchase_order": return `Receive the goods on ${input.po_number} into stock`;
    case "propose_bill": return `Bill from ${input.supplier_name}${input.reference ? ` (invoice ${input.reference})` : ""}: ${(input.items || []).map((i) => `${i.quantity} × ${i.name} @ ${money(i.rate)}`).join(", ")}`;
    case "propose_expense": return `Record expense: ${input.category} ${money(input.amount)}${input.vendor ? ` to ${input.vendor}` : ""}`;
    default: return name;
  }
}

function systemPrompt(who) {
  return [
    `You are Garage AI, the AI business assistant built into JMSURF Garage, working for ${who.company}. You are talking with ${who.name} (role: ${who.roles.join(", ") || "staff"}).`,
    `Amounts are in ${who.currency}. The company is in ${who.country}. Today is ${today()}.`,
    "Use the tools to get facts; never invent numbers, names or balances. If a tool returns nothing, say so plainly.",
    "To change anything (customers, invoices, reminders, tasks, leads, expenses) use a propose_* tool: it only prepares the action and the person confirms it in the app. Say that it is ready for them to confirm; never say it is already done.",
    "Write short, clear answers for busy business owners: lead with the answer, then the few figures that matter, formatted with thousands separators. Use a short list or table when comparing several things.",
    "Reply in the language the person writes in (English, Kiswahili, French and others).",
    "When a document is attached (invoice, receipt, quotation, delivery note, statement), read it carefully and use its exact supplier, numbers, dates, items and amounts. A receipt or invoice already paid is an expense; an invoice to pay later is a bill; goods ordered are a purchase order (receive_now when the person says the goods have arrived).",
    ...(who.voice ? ["The person is talking to you by voice and hears your answer read aloud: answer in one to three short spoken sentences, round amounts, no tables, lists or symbols."] : []),
  ].join("\n");
}

/* ------------------------------------------------------------------ chat */

const rate = new Map();
function throttle(userId) {
  const now = Date.now();
  const hits = (rate.get(userId) || []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 40) throw new HttpError(429, "Garage AI needs a short break. Try again in a few minutes.");
  hits.push(now); rate.set(userId, hits);
}

/* ------------------------------------------------------------ free mode */
// Everyday questions are answered straight from the books, with no AI model:
// instant, and nothing to pay. Anything else goes to the AI model when one is connected.

const pad2 = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The period a question talks about (default: this year). */
function periodOf(q) {
  const n = new Date();
  const y = n.getFullYear(), m = n.getMonth();
  if (/\byesterday\b/.test(q)) { const d = new Date(y, m, n.getDate() - 1); return { from: isoDay(d), to: isoDay(d), label: "yesterday" }; }
  if (/\btoday\b/.test(q)) return { from: isoDay(n), to: isoDay(n), label: "today" };
  if (/\blast week\b/.test(q)) { const s = new Date(y, m, n.getDate() - ((n.getDay() + 6) % 7) - 7); const e = new Date(s); e.setDate(s.getDate() + 6); return { from: isoDay(s), to: isoDay(e), label: "last week" }; }
  if (/\bthis week\b|\bweek\b/.test(q)) { const s = new Date(y, m, n.getDate() - ((n.getDay() + 6) % 7)); return { from: isoDay(s), to: isoDay(n), label: "this week" }; }
  if (/\blast month\b/.test(q)) return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)), label: "last month" };
  if (/\bthis month\b|\bmonth\b/.test(q)) return { from: isoDay(new Date(y, m, 1)), to: isoDay(n), label: "this month" };
  if (/\blast year\b/.test(q)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
  const yr = q.match(/\b(20\d\d)\b/);
  if (yr && Number(yr[1]) <= y) return { from: `${yr[1]}-01-01`, to: Number(yr[1]) === y ? isoDay(n) : `${yr[1]}-12-31`, label: yr[1] };
  return { from: `${y}-01-01`, to: isoDay(n), label: "this year" };
}

const EXAMPLES = [
  "Show my best-selling items this year",
  "Who are my best customers this month?",
  "Who owes me money?",
  "Which invoices are overdue?",
  "What bills do I still have to pay?",
  "What is running low?",
  "What is the stock of maize flour?",
  "How much did we spend this month, by category?",
  "How is the business doing this year?",
  "How is the sales pipeline?",
  "How many staff do we have?",
];
const examplesText = (intro) => `${intro}\n${EXAMPLES.slice(0, 8).map((e) => `- ${e}`).join("\n")}`;

/** Words after "of", "for" or "called" (the thing a question is about), cleaned of filler. */
function subjectOf(q, words) {
  const m = q.match(new RegExp(`\\b(?:${words})\\s+(?:of|for|on|called|named)?\\s*(.+)$`));
  if (!m) return "";
  return m[1].replace(/\b(the|a|an|my|our|item|items|product|products|customer|customers|please|in stock|left|now|today)\b/g, " ").replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Answers everyday questions from the books. Returns null when the question is not one of them. */
async function freeAnswer(who, question) {
  const raw = str(question);
  const q = raw.toLowerCase().replace(/[’']/g, "'");
  const cur = who.currency || "KES";
  const money = (v) => `${cur} ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const per = periodOf(q);
  const out = (tool, reply) => ({ reply, actions: [], used: [tool], mode: "free", matched: true });

  if (!q || /^(hi|hello|hey|habari|hujambo|good (morning|afternoon|evening))\b[\s!.?]*$/.test(q) || /what can you (do|answer)|^help\b|how do(es)? (you|dash ai) work/.test(q)) {
    return { reply: examplesText(`Hello ${String(who.name || "").split(/[\s@]/)[0]}! I can answer questions about ${who.company} from your books. Try:`), actions: [], used: [], mode: "free", matched: true };
  }

  // Requests to do something (create, send, record…) need the full Garage AI, which proposes the action for you to confirm.
  if (/^(please\s+)?(create|draft|send|add|record|make|remind|receive|issue|raise|prepare|write|book|schedule|email|sms|whatsapp|pay|post|update|change|delete)\b/.test(q)) return null;
  // "How do I…" questions are about using the system, not the figures (the app answers them from the Help centre).
  if (/^(how (do|can|should) (i|we)|how to|where (do|can) (i|we)|where is|where are|can i|is there a way|what is the way|steps? to)\b/.test(q)) return null;

  // Best customers (before best sellers: "best customers" also says "best").
  if (/\b(best|top|biggest|largest|most valuable)\b.*\b(customers?|clients?|buyers?)\b|\bwho (buys|bought|spent) the most\b/.test(q)) {
    const r = await runReadTool(who, "top_sellers", { from: per.from, to: per.to, limit: 10 });
    if (!r.top_customers.length) return out("top_sellers", `No sales ${per.label}.`);
    return out("top_sellers", `**Best customers ${per.label}** (${per.from} to ${per.to})\n| # | Customer | Sales |\n|---|---|---|\n${r.top_customers.map((c, i) => `| ${i + 1} | ${c.name} | ${money(c.revenue)} |`).join("\n")}`);
  }
  if (/\b(best|top|most)[\s-]*(sell|sold|selling|popular|items?|products?|goods)\b|\bsells? (the )?most\b|\bbest sellers?\b|\bfast(est)?[\s-]moving\b/.test(q)) {
    const r = await runReadTool(who, "top_sellers", { from: per.from, to: per.to, limit: 10 });
    if (!r.top_items.length) return out("top_sellers", `No items were sold ${per.label}.`);
    return out("top_sellers", `**Best-selling items ${per.label}** (${per.from} to ${per.to})\n| # | Item | Qty | Sales |\n|---|---|---|---|\n${r.top_items.map((x, i) => `| ${i + 1} | ${x.name} | ${Number(x.quantity).toLocaleString("en-KE")} | ${money(x.revenue)} |`).join("\n")}`);
  }

  if (/\boverdue\b|\blate (invoices?|payments?)\b|\bpast due\b/.test(q) && !/\bbills?\b/.test(q)) {
    const rows = await runReadTool(who, "list_invoices", { status: "overdue", limit: 20 });
    if (!rows.length) return out("list_invoices", "No invoices are overdue. 🎉");
    const total = rows.reduce((a, r) => a + r.balance, 0);
    return out("list_invoices", `**${rows.length} overdue invoice${rows.length === 1 ? "" : "s"}**, ${money(total)} in all\n| Invoice | Customer | Due | Balance |\n|---|---|---|---|\n${rows.map((r) => `| ${r.invoice_number} | ${r.customer_name || "—"} | ${r.due_date || "—"} | ${money(r.balance)} |`).join("\n")}`);
  }
  if (/\bunpaid (invoices?|sales)\b|\binvoices? (not paid|unpaid|outstanding|open)\b|\bopen invoices?\b/.test(q)) {
    const rows = await runReadTool(who, "list_invoices", { status: "unpaid", limit: 20 });
    if (!rows.length) return out("list_invoices", "Every invoice is paid.");
    const total = rows.reduce((a, r) => a + r.balance, 0);
    return out("list_invoices", `**${rows.length} unpaid invoice${rows.length === 1 ? "" : "s"}**, ${money(total)} in all\n| Invoice | Customer | Due | Balance |\n|---|---|---|---|\n${rows.map((r) => `| ${r.invoice_number} | ${r.customer_name || "—"} | ${r.due_date || "—"} | ${money(r.balance)} |`).join("\n")}`);
  }
  if (/\bwho owes\b|\bowes? (me|us)\b|\bdebtors?\b|\breceivables?\b|\bowing\b|\bcustomers? (with )?(debts?|balances?)\b|\bnot (yet )?paid (me|us)\b/.test(q)) {
    const rows = (await runReadTool(who, "find_customers", { limit: 15 })).filter((c) => c.owes > 0);
    if (!rows.length) return out("find_customers", "No customer owes you anything right now.");
    const total = rows.reduce((a, r) => a + r.owes, 0);
    return out("find_customers", `**Customers who owe you** (top ${rows.length}, ${money(total)})\n| Customer | Owes | Overdue | Phone |\n|---|---|---|---|\n${rows.map((c) => `| ${c.name} | ${money(c.owes)} | ${c.overdue ? money(c.overdue) : "—"} | ${c.phone || "—"} |`).join("\n")}`);
  }
  if (/\bbills?\b|\bpayables?\b|\bcreditors?\b|\b(i|we) owe\b|\bowe (to )?suppliers?\b|\bsuppliers? (to )?pay\b/.test(q)) {
    const rows = await runReadTool(who, "list_bills", { unpaid_only: true, limit: 20 });
    if (!rows.length) return out("list_bills", "You have no unpaid bills.");
    const total = rows.reduce((a, r) => a + r.balance, 0);
    return out("list_bills", `**${rows.length} unpaid bill${rows.length === 1 ? "" : "s"}**, ${money(total)} in all\n| Bill | Supplier | Due | Balance |\n|---|---|---|---|\n${rows.map((r) => `| ${r.bill_number || "—"} | ${r.name || "—"} | ${r.due_date || "—"} | ${money(r.balance)} |`).join("\n")}`);
  }
  if (/\b(low|running low|run(ning)? out|out of stock|reorder|restock|finish(ing|ed)|almost (out|finished))\b/.test(q) && !/\bcash\b|\bmoney\b/.test(q)) {
    const rows = await runReadTool(who, "find_items", { low_stock_only: true, limit: 30 });
    if (!rows.length) return out("find_items", "Nothing is running low. Every item is above its reorder level.");
    return out("find_items", `**${rows.length} item${rows.length === 1 ? " is" : "s are"} running low**\n| Item | In stock | Reorder at |\n|---|---|---|\n${rows.map((r) => `| ${r.name} | ${Number(r.stock).toLocaleString("en-KE")} ${r.unit || ""} | ${Number(r.reorder_level || 0).toLocaleString("en-KE")} |`).join("\n")}`);
  }
  if (/\b(stock|price|cost|quantity|how many)\b/.test(q) && !/\bstock value\b|\bstaff\b|\bemployees?\b|\bcustomers?\b|\binvoices?\b/.test(q)) {
    const subject = subjectOf(q, "stock|price|cost|quantity|how many|much is|level");
    if (subject) {
      const rows = await runReadTool(who, "find_items", { query: subject, limit: 10 });
      if (!rows.length) return out("find_items", `I found no item matching "${subject}".`);
      return out("find_items", `**Items matching "${subject}"**\n| Item | In stock | Price | Cost |\n|---|---|---|---|\n${rows.map((r) => `| ${r.name}${r.sku ? ` (${r.sku})` : ""} | ${r.product_type === "service" ? "service" : `${Number(r.stock).toLocaleString("en-KE")} ${r.unit || ""}`} | ${money(r.price)} | ${money(r.cost_price)} |`).join("\n")}`);
    }
  }
  if (/\b(expenses?|spend|spent|spending|costs)\b|\bwhere (did )?(the |my )?money go\b/.test(q)) {
    const r = await runReadTool(who, "expenses_by_category", { from: per.from, to: per.to });
    if (!r.by_category.length) return out("expenses_by_category", `No expenses recorded ${per.label}.`);
    return out("expenses_by_category", `**Expenses ${per.label}: ${money(r.total)}**\n| Category | Amount |\n|---|---|\n${r.by_category.slice(0, 12).map((c) => `| ${c.category} | ${money(c.amount)} |`).join("\n")}`);
  }
  if (/\b(leads?|pipeline|opportunit(y|ies)|deals?|prospects?)\b/.test(q)) {
    const r = await runReadTool(who, "crm_pipeline", {});
    if (!r.by_stage.length) return out("crm_pipeline", "There are no open leads or opportunities.");
    return out("crm_pipeline", `**Sales pipeline**\n| Stage | Count | Expected |\n|---|---|---|\n${r.by_stage.map((s) => `| ${s.stage} | ${s.count} | ${money(s.expected)} |`).join("\n")}${r.largest_open.length ? `\n\n**Largest open**\n${r.largest_open.slice(0, 5).map((l) => `- ${l.name}${l.company ? ` (${l.company})` : ""}: ${money(l.expected_revenue)}${l.stage ? `, ${l.stage}` : ""}`).join("\n")}` : ""}`);
  }
  if (/\b(staff|employees?|workers?|payroll|salar(y|ies)|leave|headcount|team size)\b/.test(q)) {
    const r = await runReadTool(who, "hr_overview", {});
    const p = r.latest_payroll;
    return out("hr_overview", [
      `**${r.active_employees} active employee${r.active_employees === 1 ? "" : "s"}**, basic salaries ${money(r.monthly_basic_salaries)} a month`,
      ...Object.entries(r.by_department).map(([d, n]) => `- ${d}: ${n}`),
      p ? `\n**Latest payroll** (${p.period}, ${p.status}): gross ${money(p.total_gross)}, net ${money(p.total_net)}, PAYE ${money(p.total_paye)}` : "",
      r.pending_leave_requests ? `\n${r.pending_leave_requests} leave request${r.pending_leave_requests === 1 ? "" : "s"} waiting for approval.` : "",
    ].filter(Boolean).join("\n"));
  }
  if (/\bpurchase orders?\b|\bpos?\b(?= (to|from|pending|open))|\b(orders?|goods) (from|to) suppliers?\b|\bnot (yet )?received\b/.test(q)) {
    const rows = await runReadTool(who, "list_purchase_orders", { limit: 15 });
    if (!rows.length) return out("list_purchase_orders", "There are no purchase orders yet.");
    return out("list_purchase_orders", `**Latest purchase orders**\n| PO | Supplier | Status | Total |\n|---|---|---|---|\n${rows.map((r) => `| ${r.po_number || "—"} | ${r.supplier || "—"} | ${String(r.status || "").replace(/_/g, " ")} | ${money(r.total)} |`).join("\n")}`);
  }
  {
    const m = q.match(/\b(?:find|search|look ?up|show)\s+(?:the\s+)?(?:customer|client)\s+(.+)$/) || q.match(/\b(?:phone|number|email|contact|details)\s+(?:of|for)\s+(.+)$/);
    if (m) {
      const subject = m[1].replace(/[?.!]/g, "").trim();
      const rows = await runReadTool(who, "find_customers", { query: subject, limit: 10 });
      if (!rows.length) return out("find_customers", `I found no customer matching "${subject}".`);
      return out("find_customers", `**Customers matching "${subject}"**\n| Customer | Phone | Email | Owes |\n|---|---|---|---|\n${rows.map((c) => `| ${c.name}${c.company ? ` (${c.company})` : ""} | ${c.phone || "—"} | ${c.email || "—"} | ${money(c.owes)} |`).join("\n")}`);
    }
  }
  if (/\b(profit|loss|income|revenue|sales|turnover|made|earn(ed|ings)?|cash|bank|balance|how (is|are) (the )?(business|things|we doing)|doing|summary|overview|performance)\b/.test(q)) {
    const r = await runReadTool(who, "business_overview", { from: per.from, to: per.to });
    return out("business_overview", [
      `**${who.company}, ${per.label}** (${per.from} to ${per.to})`,
      `- Income: ${money(r.income)}`,
      `- Cost of sales: ${money(r.cost_of_sales)}`,
      `- Gross profit: ${money(r.gross_profit)}`,
      `- Expenses: ${money(r.expenses)}`,
      `- **Net ${r.net_profit >= 0 ? "profit" : "loss"}: ${money(Math.abs(r.net_profit))}**`,
      `- Customers owe you: ${money(r.receivables)}${r.overdue_invoices.count ? ` (${r.overdue_invoices.count} overdue, ${money(r.overdue_invoices.amount)})` : ""}`,
      `- You owe suppliers: ${money(r.payables)}`,
      ...(r.cash_and_bank.length ? ["", "**Cash and bank**", ...r.cash_and_bank.map((b) => `- ${b.account}: ${money(b.balance)}`)] : []),
    ].join("\n"));
  }
  return null;
}

/** The reply when a question is not one free mode knows and no AI model can take it. */
const freeFallback = (why) => ({
  reply: examplesText(`${why} Here is what I can answer for free right now:`),
  actions: [], used: [], mode: "free", matched: false,
});

async function chat(req, body) {
  const token = str(req.headers.authorization).replace(/^Bearer\s+/i, "");
  if (token.length < 20) throw new HttpError(401, "Sign in first");
  const who = await whoIs(token);

  // The app sends plain text turns; keep the last 20 and cap their size.
  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && str(m.content))
    .map((m) => ({ role: m.role, content: str(m.content).slice(0, 8000) }));
  if (!history.length || history[history.length - 1].role !== "user") throw new HttpError(400, "Ask Garage AI something");
  who.voice = !!body.voice;
  // Documents attached to the latest question: images and PDFs (max 3, about 20 MB in all).
  const files = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 3)
    .filter((f) => /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(str(f?.type)) && /^[A-Za-z0-9+/=]+$/.test(str(f?.data).slice(0, 200)));
  if (files.reduce((a, f) => a + str(f.data).length, 0) > 28_000_000) throw new HttpError(413, "Those files are too large. Attach up to about 20 MB.");

  // Free mode first: everyday questions are answered from the books, with no AI model and nothing to pay.
  if (!files.length) {
    try {
      const quick = await freeAnswer(who, history[history.length - 1].content);
      if (quick) return quick;
    } catch (e) {
      console.warn("[dash-ai] free answer failed:", e?.message || e);
    }
  }
  const ai = anthropic();
  const filesNote = "Reading attached files needs the full Garage AI, which is not available right now.";
  if (!ai) return freeFallback(files.length ? filesNote : "I can't answer that one yet.");
  throttle(who.user.id);
  try {
    return await chatWithModel(ai, who, history, files);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // The AI model is out of credit or not answering: never leave the person with an error.
    console.error("[dash-ai] model failed, free mode instead:", e?.message || e);
    return freeFallback(files.length ? filesNote : "I can't answer that one right now.");
  }
}

/** The full Garage AI: the AI model with the company's tools. */
async function chatWithModel(ai, who, history, files) {
  if (files.length) {
    const last = history[history.length - 1];
    last.content = [
      ...files.map((f) => f.type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: str(f.name).slice(0, 120) || "document.pdf" }
        : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } }),
      { type: "text", text: last.content },
    ];
  }
  while (history.length && history[0].role !== "user") history.shift();

  const messages = [...history];
  const actions = [];
  const used = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: systemPrompt(who) }],
      tools: [...READ_TOOLS, ...ACTION_TOOLS],
      messages,
    });
    if (response.stop_reason === "refusal") {
      return { reply: "I can't help with that one. Ask me about your sales, customers, stock, cash, staff or projects.", actions, used };
    }
    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { reply: reply || "Done.", actions, used };
    }
    // Keep the assistant turn exactly as returned (thinking blocks included).
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(toolUses.map(async (t) => {
      used.push(t.name);
      try {
        if (t.name.startsWith("propose_")) {
          const id = `${t.id}`;
          actions.push({ id, type: t.name.replace(/^propose_/, ""), input: t.input || {}, summary: summarize(t.name, t.input || {}) });
          return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify({ status: "ready_for_user_confirmation", action_id: id }) };
        }
        const data = await runReadTool(who, t.name, t.input || {});
        const text = JSON.stringify(data);
        return { type: "tool_result", tool_use_id: t.id, content: text.length > 60000 ? `${text.slice(0, 60000)}… (truncated)` : text };
      } catch (e) {
        return { type: "tool_result", tool_use_id: t.id, is_error: true, content: str(e?.message) || "Tool failed" };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  return { reply: "That took more steps than I can do at once. Try a narrower question.", actions, used };
}

/** Reads an invoice or receipt the company received and returns the expense to record. */
const EXPENSE_TOOL = {
  name: "record_expense",
  description: "The expense on this supplier invoice or receipt.",
  input_schema: {
    type: "object",
    properties: {
      vendor: { type: "string" }, vendor_pin: { type: "string", description: "Supplier KRA PIN if shown" }, invoice_number: { type: "string" },
      vendor_type: { type: "string", enum: ["company", "individual"], description: "company for a business (Ltd, shop, enterprise, a trading name), individual for a person" },
      vendor_phone: { type: "string", description: "Supplier phone if shown" }, vendor_email: { type: "string", description: "Supplier email if shown" },
      vendor_address: { type: "string", description: "Supplier address or location if shown" },
      date: { type: "string", description: "YYYY-MM-DD" }, due_date: { type: "string", description: "YYYY-MM-DD if shown" }, currency: { type: "string" },
      subtotal: { type: "number", description: "Amount before VAT" }, tax: { type: "number", description: "VAT amount, 0 if none" }, total: { type: "number" },
      already_paid: { type: "boolean", description: "True for a receipt or an invoice marked paid" },
      payment_method: { type: "string", enum: ["cash", "mpesa", "bank", "card", "unknown"] },
      category: { type: "string", description: "Best expense category, e.g. Fuel, Rent, Utilities, Internet, Office supplies, Travel, Meals, Repairs, Professional fees, Stock purchases" },
      description: { type: "string", description: "One line describing what was bought" },
      items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, rate: { type: "number" }, amount: { type: "number" } } } },
    },
    required: ["vendor", "total", "category"],
  },
};
async function extractExpense(req, body) {
  const ai = anthropic();
  if (!ai) throw new HttpError(503, "Garage AI is not connected yet. The platform owner must add the AI key.");
  const token = str(req.headers.authorization).replace(/^Bearer\s+/i, "");
  if (token.length < 20) throw new HttpError(401, "Sign in first");
  const who = await whoIs(token);
  throttle(who.user.id);
  const f = body.file || {};
  if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(str(f.type))) throw new HttpError(400, "Upload a photo (JPG, PNG) or a PDF of the invoice.");
  if (str(f.data).length > 28_000_000) throw new HttpError(413, "That file is too large (about 20 MB at most).");
  const doc = f.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } };
  const response = await ai.beta.messages.create({
    model: MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    system: [{ type: "text", text: `You read supplier invoices and receipts for ${who.company} (amounts in ${who.currency}, today is ${today()}). Copy names, numbers, dates and amounts exactly as printed. If VAT is not shown, tax is 0 and subtotal equals total.` }],
    tools: [EXPENSE_TOOL], tool_choice: { type: "tool", name: "record_expense" },
    messages: [{ role: "user", content: [doc, { type: "text", text: "Record this as an expense." }] }],
  });
  const use = response.content.find((b) => b.type === "tool_use");
  if (!use) throw new HttpError(422, "Garage AI could not read that document. Try a clearer photo.");
  return { expense: use.input };
}

const CONTRACT_TYPES = ["nda", "service", "supply", "sales", "consultancy", "employment", "sla", "maintenance", "licence", "lease", "agency", "partnership"];
const CONTRACT_AREAS = ["general", "it", "construction", "healthcare", "finance", "education", "hospitality", "manufacturing", "agriculture", "logistics", "retail", "realestate", "energy", "public", "ngo", "security"];
const CONTRACT_TOOL = {
  name: "record_contract",
  description: "The particulars of this contract and its full text.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The contract's title, e.g. Supply Agreement for Laptops." },
      type: { type: "string", enum: CONTRACT_TYPES, description: "Closest kind of contract." },
      area: { type: "string", enum: CONTRACT_AREAS, description: "Closest area of business; general if unclear." },
      party_name: { type: "string", description: "The OTHER party (not our company): its full legal name." },
      party_kind: { type: "string", enum: ["customer", "supplier", "employee", "other"], description: "customer if they pay us, supplier if we pay them (vendor, consultant, landlord, contractor), employee for employment." },
      party_contact: { type: "string", description: "The person who signs or is named for the other party." },
      party_email: { type: "string" }, party_phone: { type: "string" }, party_address: { type: "string" },
      party_pin: { type: "string", description: "The other party's KRA PIN or tax number, or ID number for a person." },
      value: { type: "number", description: "Total contract value (or monthly salary / rent). 0 if none is stated." },
      currency: { type: "string", description: "ISO code, e.g. KES or USD." },
      start_date: { type: "string", description: "YYYY-MM-DD when it starts (the effective or commencement date). Empty if not stated." },
      end_date: { type: "string", description: "YYYY-MM-DD when it ends or expires. Work it out from the term if it says e.g. 12 months from the start. Empty if open-ended." },
      renewal: { type: "string", enum: ["none", "notify", "auto"], description: "auto if it renews automatically, none if it says it does not, otherwise notify." },
      notice_days: { type: "integer", description: "Notice period in days for ending or not renewing (a month = 30). 30 if not stated." },
      signed_by_both: { type: "boolean", description: "True if the document shows signatures from both sides." },
      summary: { type: "string", description: "Two or three plain sentences on what the contract is about and the key obligations." },
      full_text: { type: "string", description: "The whole contract text, word for word, laid out as: first line the title in capitals; a blank line between paragraphs; section headings as '1. HEADING' in capitals; clauses as '1.1 text', '1.2 text'. Leave out page numbers, headers and footers and the signature blocks." },
    },
    required: ["title", "type", "area", "party_name", "party_kind", "value", "currency", "start_date", "end_date", "renewal", "notice_days", "signed_by_both", "summary", "full_text"],
  },
};

async function extractContract(req, body) {
  const ai = anthropic();
  if (!ai) throw new HttpError(503, "Garage AI is not connected yet. The platform owner must add the AI key.");
  const token = str(req.headers.authorization).replace(/^Bearer\s+/i, "");
  if (token.length < 20) throw new HttpError(401, "Sign in first");
  const who = await whoIs(token);
  throttle(who.user.id);
  const f = body.file || {};
  if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(str(f.type))) throw new HttpError(400, "Upload the contract as a PDF or a photo (JPG, PNG).");
  if (str(f.data).length > 28_000_000) throw new HttpError(413, "That file is too large (about 20 MB at most).");
  const doc = f.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
    : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } };
  // Long contracts produce long text: stream so the request does not time out.
  const response = await ai.beta.messages.stream({
    model: MODEL, max_tokens: 32000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    system: [{ type: "text", text: `You read contracts for ${who.company} (our company; amounts usually in ${who.currency}; today is ${today()}). The other party is whoever is not ${who.company}. Copy names, numbers, dates and amounts exactly as written, and copy the contract text word for word.` }],
    tools: [CONTRACT_TOOL], tool_choice: { type: "tool", name: "record_contract" },
    messages: [{ role: "user", content: [doc, { type: "text", text: "Record this contract." }] }],
  }).finalMessage();
  const use = response.content.find((b) => b.type === "tool_use");
  if (!use) throw new HttpError(422, "Garage AI could not read that contract. Try a clearer scan.");
  return { contract: use.input, truncated: response.stop_reason === "max_tokens" };
}

export async function handleAiRequest(req, res, pathname, body, sendJson) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    if (pathname === "/api/ai/chat") return sendJson(res, 200, await chat(req, body || {}));
    if (pathname === "/api/ai/extract-expense") return sendJson(res, 200, await extractExpense(req, body || {}));
    if (pathname === "/api/ai/extract-contract") return sendJson(res, 200, await extractContract(req, body || {}));
    if (pathname === "/api/ai/status") return sendJson(res, 200, { connected: !!process.env.ANTHROPIC_API_KEY });
    return sendJson(res, 404, { error: "Unknown route" });
  } catch (e) {
    // The AI account ran out of credit: say so plainly (the platform owner tops it up).
    const noCredit = e instanceof Anthropic.APIError && /credit balance|billing/i.test(String(e?.message || ""));
    const status = e instanceof HttpError ? e.status : noCredit ? 503 : e instanceof Anthropic.RateLimitError ? 429 : 500;
    if (status >= 500) console.error("[dash-ai]", pathname, e?.message || e);
    const msg = e instanceof HttpError ? e.message
      : noCredit ? "Garage AI is paused while its AI credit is topped up. Please try again later."
      : status === 429 ? "Garage AI is busy right now. Try again in a moment." : "Garage AI could not answer just now. Try again.";
    return sendJson(res, status, { error: msg });
  }
}
