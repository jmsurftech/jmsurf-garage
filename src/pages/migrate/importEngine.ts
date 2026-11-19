import { withoutOutbox } from "@/lib/offlineOutbox";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

/**
 * The move-in engine. Takes rows shaped like the CSV exports of common cloud
 * accounting systems (from uploaded files, or staged by the API connection) and
 * imports them in dependency order: chart of accounts → bank accounts → contacts →
 * items → quotes → sales orders → invoices → credit notes (applied to invoices) →
 * customer payments → purchase orders → bills → vendor credits (applied to bills) →
 * vendor payments → expenses → journals → opening balances → bank transactions →
 * recurring profiles → price lists, projects, tasks and timesheets → attachments, plus CRM leads and employees. Every document posts to the
 * books automatically. Safe to repeat: numbers and names that already exist are skipped.
 */

export type Kind = "accounts" | "bank_accounts" | "customers" | "vendors" | "items" | "quotes" | "sales_orders" | "invoices" | "credit_notes" | "payments" | "purchase_orders" | "bills" | "vendor_credits" | "vendor_payments" | "expenses" | "journals" | "opening_balances" | "bank_transactions" | "recurring_invoices" | "recurring_bills" | "recurring_expenses" | "price_lists" | "projects" | "timesheets" | "attachments" | "leads" | "employees" | "crm" | "deals" | "crm_contacts" | "crm_notes";
export type Row = Record<string, string>;

export const KINDS: { kind: Kind; label: string; where: string; files: RegExp; signature: string[] }[] = [
  { kind: "accounts", label: "Chart of accounts", where: "Accountant → Chart of Accounts → Export", files: /chart.?of.?account|^accounts?\b/i, signature: ["accountname", "accounttype"] },
  { kind: "customers", label: "Customers", where: "Sales → Customers → Export", files: /contact|customer(?!.?payment)/i, signature: ["displayname", "contactname", "customername"] },
  { kind: "vendors", label: "Vendors", where: "Purchases → Vendors → Export", files: /vendor(?!.?payment|.?credit)|supplier/i, signature: ["vendorname", "displayname"] },
  { kind: "items", label: "Items", where: "Items → Export", files: /^items?\b|item\.|product/i, signature: ["itemname", "rate"] },
  { kind: "quotes", label: "Quotes / estimates", where: "Sales → Quotes → Export", files: /estimate|quote/i, signature: ["estimatenumber", "quotenumber"] },
  { kind: "sales_orders", label: "Sales orders", where: "Sales → Sales Orders → Export", files: /sales.?order/i, signature: ["salesordernumber"] },
  { kind: "invoices", label: "Invoices", where: "Sales → Invoices → Export", files: /invoice/i, signature: ["invoicenumber", "invoicedate"] },
  { kind: "credit_notes", label: "Credit notes", where: "Sales → Credit Notes → Export", files: /credit.?note/i, signature: ["creditnotenumber"] },
  { kind: "payments", label: "Customer payments", where: "Sales → Payments Received → Export", files: /customer.?payment|payments?.?received/i, signature: ["paymentnumber", "customername"] },
  { kind: "bills", label: "Bills", where: "Purchases → Bills → Export", files: /^bills?\b|bill\./i, signature: ["billnumber", "billdate"] },
  { kind: "vendor_payments", label: "Vendor payments", where: "Purchases → Payments Made → Export", files: /vendor.?payment|payments?.?made/i, signature: ["vendorname", "paymentnumber"] },
  { kind: "expenses", label: "Expenses", where: "Purchases → Expenses → Export", files: /expense/i, signature: ["expensedate", "expenseaccount"] },
  { kind: "journals", label: "Manual journals", where: "Accountant → Manual Journals → Export", files: /journal/i, signature: ["journaldate", "journalnumber"] },
  { kind: "bank_accounts", label: "Bank & card accounts", where: "Banking → (account) → export, or Chart of Accounts", files: /bank.?account/i, signature: ["accountnumber", "bankname"] },
  { kind: "purchase_orders", label: "Purchase orders", where: "Purchases → Purchase Orders → Export", files: /purchase.?order/i, signature: ["purchaseordernumber"] },
  { kind: "vendor_credits", label: "Vendor credits", where: "Purchases → Vendor Credits → Export", files: /vendor.?credit|debit.?note/i, signature: ["vendorcreditnumber"] },
  { kind: "opening_balances", label: "Opening balances", where: "Settings → Opening Balances (or a trial balance as at the start)", files: /opening.?balance/i, signature: ["openingdate"] },
  { kind: "bank_transactions", label: "Bank transactions", where: "Banking → (account) → Export transactions", files: /bank.?(transaction|statement)|transaction/i, signature: ["transactionid", "bankaccount"] },
  { kind: "recurring_invoices", label: "Recurring invoices", where: "Sales → Recurring Invoices → Export", files: /recurring.?invoice/i, signature: ["profilename", "customername"] },
  { kind: "recurring_bills", label: "Recurring bills", where: "Purchases → Recurring Bills → Export", files: /recurring.?bill/i, signature: ["profilename", "vendorname"] },
  { kind: "recurring_expenses", label: "Recurring expenses", where: "Purchases → Recurring Expenses → Export", files: /recurring.?expense/i, signature: ["profilename", "expenseaccount"] },
  { kind: "price_lists", label: "Price lists", where: "Items → Price Lists → Export", files: /price.?(list|book)/i, signature: ["pricelistname"] },
  { kind: "projects", label: "Projects & tasks", where: "Time Tracking → Projects → Export (and Tasks)", files: /^projects?\b|project.?task|^tasks?\b/i, signature: ["projectname", "recordtype"] },
  { kind: "timesheets", label: "Timesheets", where: "Time Tracking → Timesheet → Export", files: /timesheet|time.?entr|time.?log/i, signature: ["logdate", "loggedhours"] },
  { kind: "attachments", label: "Attachments", where: "Brought by the API connection", files: /^attachments?\b/i, signature: ["storagepath"] },
  { kind: "leads", label: "CRM leads", where: "CRM → Leads → Export", files: /lead/i, signature: ["leadsource", "leadstatus"] },
  { kind: "employees", label: "Employees", where: "People / Payroll → Employees → Export", files: /employee/i, signature: ["employeeid", "dateofjoining"] },
  // CRM by API: accounts become customers, products become items, and these three steps follow.
  { kind: "crm", label: "CRM accounts, contacts, products, deals & notes", where: "Brought by the API connection", files: /^$/, signature: ["__api_only__"] },
  { kind: "deals", label: "CRM deals", where: "CRM → Deals → Export", files: /^deals?\b|potential/i, signature: ["dealname", "closingdate"] },
  { kind: "crm_contacts", label: "CRM contact persons", where: "Brought by the API connection", files: /^$/, signature: ["__api_only__"] },
  { kind: "crm_notes", label: "CRM notes", where: "Brought by the API connection", files: /^$/, signature: ["__api_only__"] },
];
export const ORDER: Kind[] = ["accounts", "bank_accounts", "customers", "vendors", "items", "quotes", "sales_orders", "invoices", "credit_notes", "payments", "purchase_orders", "bills", "vendor_credits", "vendor_payments", "expenses", "journals", "opening_balances", "bank_transactions", "recurring_invoices", "recurring_bills", "recurring_expenses", "price_lists", "employees", "projects", "timesheets", "attachments", "leads", "crm_contacts", "deals", "crm_notes"];

export const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** First non-empty value among candidate column names (normalised). */
const pick = (r: Row, ...names: string[]) => { for (const n of names) { const v = r[norm(n)]; if (v !== undefined && String(v).trim() !== "") return String(v).trim(); } return ""; };
const num = (v: string) => { const n = Number(String(v || "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const date = (v: string) => {
  const s = String(v || "").trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const chunk = <T,>(a: T[], n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const groupBy = (rows: Row[], key: (r: Row) => string) => { const m = new Map<string, Row[]>(); rows.forEach((r) => { const k = key(r); if (!k) return; const g = m.get(k); if (g) g.push(r); else m.set(k, [r]); }); return m; };

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

export async function readFile(f: File): Promise<Row[]> {
  let grid: string[][];
  if (/\.xlsx?$/i.test(f.name)) {
    const XLSX = await import("@e965/xlsx");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }) as string[][];
  } else {
    grid = parseCsv((await f.text()).replace(/^﻿/, ""));
  }
  const head = (grid[0] || []).map((h) => norm(String(h)));
  return grid.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "").trim()])));
}

export function detect(name: string, rows: Row[]): Kind | null {
  const cols = new Set(Object.keys(rows[0] || {}));
  const base = name.replace(/\.[^.]+$/, "");
  const byName = KINDS.filter((k) => /^recurring/.test(k.kind)).find((k) => k.files.test(base)) || KINDS.find((k) => k.files.test(base));
  // Vendors files and customer contacts share columns: the file name or "Contact Type" decides.
  if (byName) {
    if (byName.kind === "customers" && rows.some((r) => /vendor/i.test(r.contacttype || ""))) return rows.every((r) => /vendor/i.test(r.contacttype || "")) ? "vendors" : "customers";
    return byName.kind;
  }
  return KINDS.find((k) => k.signature.some((s) => cols.has(s)))?.kind || null;
}

const ACCOUNT_TYPE: Record<string, [string, string]> = {
  "cash": ["asset", "cash"], "bank": ["asset", "bank"], "accountsreceivable": ["asset", "accounts_receivable"], "stock": ["asset", "inventory"],
  "othercurrentasset": ["asset", "other_current_asset"], "fixedasset": ["asset", "fixed_asset"], "otherasset": ["asset", "other_asset"],
  "paymentclearing": ["asset", "other_current_asset"], "inputtax": ["asset", "other_current_asset"],
  "accountspayable": ["liability", "accounts_payable"], "creditcard": ["liability", "credit_card"], "othercurrentliability": ["liability", "other_current_liability"],
  "longtermliability": ["liability", "long_term_liability"], "otherliability": ["liability", "long_term_liability"], "outputtax": ["liability", "other_current_liability"],
  "equity": ["equity", "equity"], "income": ["income", "income"], "otherincome": ["income", "other_income"],
  "expense": ["expense", "expense"], "costofgoodssold": ["expense", "cost_of_goods_sold"], "otherexpense": ["expense", "other_expense"],
};
/** eTIMS details from the previous system ("eTIMS Status" pushed/signed, "eTIMS QR" the KRA receipt link). */
export function kraFrom(h: Row): Record<string, string> {
  const st = norm(pick(h, "eTIMS Status", "E-Invoice Status", "KRA Status"));
  const qr = pick(h, "eTIMS QR", "KRA QR", "QR Code URL");
  // Exact statuses only: "not_pushed" must not count.
  if (!/^(pushed|signed|success|submitted)$/.test(st) &&!/etims\.kra\.go\.ke/.test(qr)) return {};
  const data = /Data=([A-Za-z0-9]+)/.exec(qr)?.[1] || "";
  // Data = KRA PIN (11) + branch (2) + receipt signature.
  const sig = data.length > 13 ? data.slice(13) : "";
  return { etims_status: "signed", ...(qr ? { etims_qr_url: qr } : {}), ...(sig ? { etims_signature: sig } : {}), ...(pick(h, "CU Invoice Number", "KRA Receipt Number") ? { etims_rcpt_no: pick(h, "CU Invoice Number", "KRA Receipt Number") } : {}) };
}
const invStatus = (s: string) => { const v = norm(s); return v === "draft" ? "draft" : v === "void" ? "void" : v === "overdue" ? "overdue" : "sent"; };

/** Network blips (a page cut off mid-download) are tried again with a growing pause; other errors are returned as they are. */
export async function readRetry(f: () => PromiseLike<any>, tries = 5): Promise<any> {
  let last: any;
  for (let k = 0; k < tries; k++) {
    try {
      const r = await f();
      const m = String(r?.error?.message || "");
      if (!r.error || !/failed to fetch|network|load failed|timeout|fetch failed|ECONNRESET|502|503|504/i.test(m)) return r;
      last = r;
    } catch (e: any) {
      if (!/failed to fetch|network|load failed|timeout|fetch failed|aborted/i.test(String(e?.message || e))) throw e;
      last = { data: null, error: e };
    }
    await new Promise((ok) => setTimeout(ok, 800 * 2 ** k));
  }
  return last;
}

/** Imports never go through the offline queue: a write it re-sent later could be saved twice (two bills, two payments). */
export const runImport = (...args: Parameters<typeof runImportInner>) => withoutOutbox(() => runImportInner(...args));

export interface Log { kind: Kind; ok: number; skipped: number; errors: string[] }

async function runImportInner(byKind: Map<Kind, Row[]>, opts: { tenantId: string; synthPayments: boolean; onStep: (s: string) => void; onLog: (l: Log[]) => void; /** Called as each kind starts, with its row count (progress pop-up). */ onKind?: (kind: Kind, rows: number) => void }): Promise<Log[]> {
  const { tenantId, synthPayments } = opts;
  const setStep = opts.onStep;
  const logs: Log[] = [];
  const push = (l: Log) => { logs.push(l); opts.onLog([...logs]); };
    // Look-ups that grow as we import.
    const loc = (await sb.from("locations").select("id").order("is_main", { ascending: false }).limit(1)).data?.[0]?.id || null;
    // Every row, page by page: the database API returns at most 1,000 rows per request, and a
    // look-up that silently stops there would create duplicates on a re-run.
    // Paged by "after the last id" and limited to this company: offsets made deep pages of a big company
    // sort everything again and run past the database's 8s limit. Every caller selects id.
    const pageAll = async (table: string, cols: string, filter?: (q: any) => any): Promise<any[]> => {
      const out: any[] = [];
      let last = "";
      for (let n = 0; n < 500; n++) {
        let q = sb.from(table).select(cols).eq("tenant_id", tenantId);
        if (filter) q = filter(q);
        if (last) q = q.gt("id", last);
        const { data, error } = await readRetry(() => q.order("id").limit(1000));
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
        last = String((data[data.length - 1] as any).id);
      }
      return out;
    };
    const map = async (table: string, cols: string, keyFn: (r: any) => string) => new Map<string, any>((await pageAll(table, cols)).map((r: any) => [keyFn(r), r]));
    let accounts = await map("chart_of_accounts", "id,name,code,type,system_key", (r) => norm(r.name));
    let customers = await map("customers", "id,name,email,phone", (r) => norm(r.name));
    let vendors = await map("suppliers", "id,name,email,phone", (r) => norm(r.name));
    let items = await map("products", "id,name,sku,price,cost_price", (r) => norm(r.name));
    const exists = async (table: string, col: string) => new Set<string>((await pageAll(table, `id,${col}`)).map((r: any) => String(r[col] || "")));
    // Documents are posted several at a time (POOL): one by one, a big move-in took many minutes.
    const POOL = 8;
    const each = async <T>(list: Iterable<T>, fn: (x: T) => Promise<void>) => {
      const arr = [...list]; let i = 0;
      await Promise.all(Array.from({ length: Math.min(POOL, arr.length) }, async () => { while (i < arr.length) await fn(arr[i++]); }));
    };
    // Two documents touching the same stock or invoice row can collide; a refused single insert saved nothing, so try again.
    const busy = (e: any) => /deadlock|could not serialize|40P01|40001|lock timeout|due to lock/i.test(`${e?.code || ""} ${e?.message || ""}`);
    const retry = async (f: () => PromiseLike<any>): Promise<any> => {
      for (let k = 0; ; k++) {
        const r = await f();
        const err = (r as any)?.error;
        if (!err || k >= 4 || !busy(err)) return r;
        await new Promise((ok) => setTimeout(ok, 150 * (k + 1) + Math.random() * 250));
      }
    };
    // Work on the same key (one customer, one bill) runs in order; different keys run side by side.
    const chains = new Map<string, Promise<unknown>>();
    const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      const next = (chains.get(key) || Promise.resolve()).then(fn, fn);
      chains.set(key, next.catch(() => undefined));
      return next;
    };
    const ensureCustomer = async (name: string, extra: any = {}) => {
      const k = norm(name); if (!k) return null;
      if (customers.has(k)) return customers.get(k).id;
      return serial(`c:${k}`, async () => {
        if (customers.has(k)) return customers.get(k).id;
        const { data, error } = await sb.from("customers").insert({ tenant_id: tenantId, name, phone: extra.phone || "", email: extra.email || null }).select("id,name").single();
        if (error) throw error; customers.set(k, data); return data.id;
      });
    };
    const ensureVendor = async (name: string) => {
      const k = norm(name); if (!k) return null;
      if (vendors.has(k)) return vendors.get(k).id;
      return serial(`v:${k}`, async () => {
        if (vendors.has(k)) return vendors.get(k).id;
        const { data, error } = await sb.from("suppliers").insert({ tenant_id: tenantId, name }).select("id,name").single();
        if (error) throw error; vendors.set(k, data); return data.id;
      });
    };
    // "'+254-0712 504 593" (spreadsheet-safe quote, dashes, spaces) → "+2540712504593".
    const phoneOf = (v: string) => String(v || "").replace(/^'+/, "").replace(/[^\d+]/g, "");
    /** Inserts in batches; a batch that fails is retried row by row so only the bad rows are reported. */
    const insertRows = async (table: string, rowsIn: any[], cols: string, label: (x: any) => string, fail: (m: string) => void) => {
      const saved: any[] = [];
      for (const c of chunk(rowsIn)) {
        const { data, error } = await sb.from(table).insert(c).select(cols);
        if (!error) { saved.push(...(data || [])); continue; }
        for (const one of c) {
          const r1 = await sb.from(table).insert(one).select(cols).single();
          if (r1.error) fail(`${label(one)}: ${r1.error.message}`); else saved.push(r1.data);
        }
      }
      return saved;
    };
    const ensureProduct = async (name: string, cost = 0): Promise<string | null> => {
      const k = norm(name); if (!k) return null;
      const hit = items.get(k); if (hit && hit.id !== "pending") return hit.id;
      return serial(`p:${k}`, () => makeProduct(k, name, cost));
    };
    const makeProduct = async (k: string, name: string, cost: number) => {
      const hit = items.get(k); if (hit && hit.id !== "pending") return hit.id as string;
      const { data, error } = await sb.from("products").insert({ tenant_id: tenantId, name, sku: `IM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, category: "General", price: 0, cost_price: cost || 0, unit: "piece", product_type: "product", is_active: true }).select("id,name,sku,price,cost_price").single();
      if (error) throw error; items.set(k, data); return data.id;
    };
    const ensureAccount = async (name: string, type: string, sub: string) => {
      const k = norm(name); if (!k) return null;
      if (accounts.has(k)) return accounts.get(k).id;
      const { data, error } = await sb.from("chart_of_accounts").insert({ tenant_id: tenantId, name, type, sub_type: sub, is_active: true }).select("id,name,code,type,system_key").single();
      if (error) throw error; accounts.set(k, data); return data.id;
    };
    const UNIT: Record<string, string> = { day: "days", days: "days", daily: "days", week: "weeks", weeks: "weeks", weekly: "weeks", month: "months", months: "months", monthly: "months", year: "years", years: "years", yearly: "years" };
    const unitOf = (v: string) => UNIT[norm(v)] || "months";
    const stoppedProfile = (st: string) => /stop|expire|inactive|cancel/i.test(st);
    const jsonCol = (r: Row, ...names: string[]) => { try { const v = JSON.parse(pick(r, ...names) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
    const creditsOn = (credits: Row[] | undefined, col: string, numKey: string, groupCols: string[]) => {
      const out = new Map<string, number>();
      for (const [, lines] of groupBy(credits || [], (r) => pick(r, ...groupCols))) {
        for (const a of jsonCol(lines[0], col)) {
          const k = String(a[numKey] || ""); const amt = num(String(a.amount ?? a.amount_applied ?? ""));
          if (k && amt > 0) out.set(k, (out.get(k) || 0) + amt);
        }
      }
      return out;
    };
    const creditedInvoices = creditsOn(byKind.get("credit_notes"), "Invoices Credited", "invoice_number", ["Credit Note Number", "CreditNote Number"]);
    const creditedBills = creditsOn(byKind.get("vendor_credits"), "Bills Credited", "bill_number", ["Vendor Credit Number", "Vendor Credit#", "Debit Note Number"]);
    const itemLine = (r: Row) => {
      const name = pick(r, "Item Name", "Product Name", "Account", "Description", "Item Desc");
      const qty = num(pick(r, "Quantity", "QuantityOrdered", "Qty")) || 1;
      const rate = num(pick(r, "Item Price", "Rate", "Unit Price", "Price"));
      const total = num(pick(r, "Item Total", "Line Total", "Amount")) || qty * rate;
      const taxPct = num(pick(r, "Item Tax %", "Tax %", "Tax Percentage"));
      return { name, description: pick(r, "Item Desc", "Description"), item_id: items.get(norm(name))?.id || null, quantity: qty, rate, price: rate, amount: total, discount: num(pick(r, "Discount", "Item Discount")), tax_rate: taxPct };
    };

    for (const kind of ORDER) {
      const rows = byKind.get(kind);
      if (!rows?.length) continue;
      setStep(KINDS.find((k) => k.kind === kind)!.label);
      opts.onKind?.(kind, rows.length);
      const l: Log = { kind, ok: 0, skipped: 0, errors: [] };
      const fail = (m: string) => { if (l.errors.length < 8) l.errors.push(m); };
      try {
        if (kind === "accounts") {
          const ins: any[] = [];
          for (const r of rows) {
            const name = pick(r, "Account Name"); if (!name) continue;
            if (accounts.has(norm(name))) { l.skipped++; continue; }
            const [type, sub] = ACCOUNT_TYPE[norm(pick(r, "Account Type"))] || ["expense", "expense"];
            ins.push({ tenant_id: tenantId, name, code: pick(r, "Account Code") || null, type, sub_type: sub, description: pick(r, "Description") || null, is_active: !/inactive/i.test(pick(r, "Account Status", "Status")) });
          }
          for (const c of chunk(ins)) { const { error } = await sb.from("chart_of_accounts").insert(c); if (error) { fail(error.message); } else l.ok += c.length; }
          accounts = await map("chart_of_accounts", "id,name,code,type,system_key", (r) => norm(r.name));
        }
        if (kind === "customers" || kind === "vendors") {
          const target = kind === "customers" ? customers : vendors;
          const ins: any[] = [];
          for (const r of rows) {
            const isVendor = /vendor/i.test(pick(r, "Contact Type")) || kind === "vendors";
            if ((kind === "customers") === isVendor && pick(r, "Contact Type")) continue;
            const name = pick(r, "Display Name", "Contact Name", "Company Name", "Vendor Name", "Customer Name", "Name") || `${pick(r, "First Name")} ${pick(r, "Last Name")}`.trim();
            if (!name) continue;
            if (target.has(norm(name))) { l.skipped++; continue; }
            const address = [pick(r, "Billing Address", "Billing Street", "Address"), pick(r, "Billing City", "City"), pick(r, "Billing Country", "Country")].filter(Boolean).join(", ");
            const phone = phoneOf(pick(r, "Mobile Phone", "MobilePhone", "Phone", "Work Phone", "Billing Phone"));
            const altPhone = [pick(r, "Phone"), pick(r, "Billing Phone"), pick(r, "Shipping Phone")].map(phoneOf).find((x) => x && x !== phone) || null;
            const extra = [
              pick(r, "Notes", "Remarks"),
              pick(r, "Customer Number") && `Customer number in the previous system: ${pick(r, "Customer Number")}`,
              pick(r, "Website") && `Website: ${pick(r, "Website")}`,
              (pick(r, "First Name") || pick(r, "Last Name")) && `Contact: ${[pick(r, "Salutation"), pick(r, "First Name"), pick(r, "Last Name")].filter(Boolean).join(" ")}${pick(r, "Designation") ? ` (${pick(r, "Designation")})` : ""}`,
              pick(r, "Billing Attention") && `Billing attention: ${pick(r, "Billing Attention")}`,
              pick(r, "Billing Code") && `Postal: ${pick(r, "Billing Code")}`,
            ].filter(Boolean).join("\n");
            if (kind === "customers") ins.push({ tenant_id: tenantId, name, phone: phone || "", alt_phone: altPhone, email: pick(r, "EmailID", "Email", "Email ID") || null, company_name: pick(r, "Company Name") || null, address: address || null,
              area: pick(r, "Billing State", "Billing County") || null, kra_pin: pick(r, "Tax Registration Number", "TRN", "KRA PIN", "PIN") || null, credit_limit: num(pick(r, "Credit Limit")) || 0,
              credit_days: Math.round(num(pick(r, "Payment Terms"))) || 0, notes: extra || null, source: "Import", customer_type: /business|company/i.test(pick(r, "Customer Sub Type")) || pick(r, "Company Name") ? "business" : "individual" });
            else ins.push({ tenant_id: tenantId, name, phone: phone || null, email: pick(r, "EmailID", "Email", "Email ID") || null, address: address || null, contact_person: `${pick(r, "First Name")} ${pick(r, "Last Name")}`.trim() || null, kra_pin: pick(r, "Tax Registration Number", "TRN", "KRA PIN") || null, website: pick(r, "Website") || null, payment_terms: pick(r, "Payment Terms Label", "Payment Terms") || null, notes: pick(r, "Notes") || null, is_active: true });
            target.set(norm(name), { id: "pending", name });
          }
          const saved = await insertRows(kind === "customers" ? "customers" : "suppliers", ins, "id,name", (x) => x.name, fail);
          l.ok += saved.length; saved.forEach((d: any) => target.set(norm(d.name), d));
        }
        if (kind === "items") {
          const exactItems = new Set((await pageAll("products", "id,name")).map((x: any) => String(x.name || "").trim()));
          const ins: any[] = []; const stock: { name: string; qty: number }[] = [];
          let n = 0;
          for (const r of rows) {
            const name = pick(r, "Item Name", "Name", "Product Name"); if (!name) continue;
            // Exact names: the old system keeps names that differ only by case or a double space as separate items
            // (one active at 1,500 and one inactive at 0 on the Smatts move).
            const exact = name.trim();
            if (exactItems.has(exact)) { l.skipped++; continue; }
            exactItems.add(exact);
            const service = /service/i.test(pick(r, "Product Type", "Item Type", "Type"));
            ins.push({ tenant_id: tenantId, name, sku: pick(r, "SKU", "Item Code", "Code") || `IM-${Date.now().toString(36)}-${++n}`, category: pick(r, "Category Name", "Category", "Item Group") || "General",
              price: num(pick(r, "Rate", "Selling Price", "Sales Rate", "Price")), cost_price: num(pick(r, "Purchase Rate", "Cost Price", "Purchase Price")), purchase_description: pick(r, "Purchase Description") || null, sales_enabled: !/^false$/i.test(pick(r, "Can Be Sold")), purchase_enabled: !/^false$/i.test(pick(r, "Can Be Purchased")),
              unit: pick(r, "Usage unit", "Unit Name", "Unit", "UOM") || "piece", vat_rate: /exempt|zero/i.test(pick(r, "Sales Tax Rule", "Tax Name")) ? 0 : num(pick(r, "Tax Percentage", "Item Tax %", "Tax %", "Intra State Tax Rate")),
              description: pick(r, "Description", "Sales Description", "Item Description") || null, reorder_level: num(pick(r, "Reorder Point", "Reorder Level")) || 0, product_type: service ? "service" : "product",
              barcode: pick(r, "UPC", "EAN", "Barcode", "ISBN") || null, is_active: !/inactive/i.test(pick(r, "Status")), brand: pick(r, "Brand", "Manufacturer") || null,
              track_batches: /^true|yes$/i.test(pick(r, "Track Batches")), track_serials: /^true|yes$/i.test(pick(r, "TrackSerialNumber", "Track Serial Number")),
              etims_item_cls_cd: pick(r, "Item Classification Code") || null });
            const q = num(pick(r, "Stock On Hand", "Opening Stock", "Quantity", "Stock"));
            if (q && !service) stock.push({ name, qty: q });
            items.set(norm(name), { id: "pending", name });
          }
          const saved = await insertRows("products", ins, "id,name,sku,price,cost_price", (x) => x.name, fail);
          l.ok += saved.length; saved.forEach((d: any) => items.set(norm(d.name), d));
          if (loc && stock.length) {
            const ps = stock.map((s) => ({ product_id: items.get(norm(s.name))?.id, location_id: loc, stock: s.qty })).filter((x) => x.product_id && x.product_id !== "pending");
            for (const c of chunk(ps)) { const { error } = await sb.from("product_stocks").upsert(c, { onConflict: "product_id,location_id" }); if (error) fail(`Stock: ${error.message}`); }
          }
        }
        if (kind === "quotes" || kind === "sales_orders" || kind === "invoices" || kind === "credit_notes") {
          const numberCol = kind === "quotes" ? ["Estimate Number", "Quote Number"] : kind === "sales_orders" ? ["SalesOrder Number", "Sales Order Number", "Sales Order#"] : kind === "invoices" ? ["Invoice Number"] : ["Credit Note Number", "CreditNote Number"];
          const table = kind === "quotes" ? "quotes" : kind === "sales_orders" ? "sales_orders" : kind === "invoices" ? "invoices" : "credit_notes";
          const numField = kind === "quotes" || kind === "sales_orders" ? "quote_number" : kind === "invoices" ? "invoice_number" : "credit_note_number";
          const have = await exists(table, numField);
          const groups = groupBy(rows, (r) => pick(r, ...numberCol));
          const paidLater: { id: string; amount: number; date: string | null; customer_id: string | null; customer: string; number: string }[] = [];
          await each(groups, async ([no, lines]) => {
            if (have.has(no)) {
              // Already here (re-migrate): still bring the KRA eTIMS details reported in the previous system.
              const k = kind === "invoices" || kind === "credit_notes" ? kraFrom(lines[0]) : {};
              if (Object.keys(k).length) await sb.from(table).update(k).eq("tenant_id", tenantId).eq(numField, no).is("etims_status", null);
              l.skipped++; return;
            }
            const h = lines[0];
            const cust = pick(h, "Customer Name", "Display Name");
            try {
              const customer_id = await ensureCustomer(cust);
              const its = lines.map(itemLine).filter((i) => i.name || i.amount);
              const total = num(pick(h, "Total", "Invoice Total", "Estimate Total")) || its.reduce((a, i) => a + i.amount, 0);
              const tax = lines.reduce((a, r) => a + num(pick(r, "Item Tax Amount", "Tax Amount")), 0) || num(pick(h, "Tax Total", "Total Tax"));
              const subtotal = num(pick(h, "SubTotal", "Sub Total")) || total - tax;
              const base: any = { tenant_id: tenantId, customer_id, customer_name: cust, items: its, subtotal, tax, discount: num(pick(h, "Entity Discount Amount", "Discount Amount")), total, notes: pick(h, "Notes", "Customer Notes") || null, terms: pick(h, "Terms & Conditions", "Terms") || null, reference: pick(h, "Reference#", "Reference Number", "PurchaseOrder", "Reference") || null, salesperson_name: pick(h, "Sales person", "Salesperson") || null };
              const issue = date(pick(h, "Invoice Date", "Estimate Date", "Credit Note Date", "Order Date", "SalesOrder Date", "Date"));
              if (kind === "quotes") Object.assign(base, { quote_number: no, issue_date: issue, valid_until: date(pick(h, "Expiry Date")), status: /invoiced/i.test(pick(h, "Estimate Status", "Status")) ? "invoiced" : /accept/i.test(pick(h, "Estimate Status", "Status")) ? "accepted" : /declin/i.test(pick(h, "Estimate Status", "Status")) ? "declined" : /draft/i.test(pick(h, "Estimate Status", "Status")) ? "draft" : "sent" });
              if (kind === "sales_orders") { const st = norm(pick(h, "Status", "SalesOrder Status", "Order Status")); Object.assign(base, { quote_number: no, issue_date: issue, valid_until: date(pick(h, "Expected Shipment Date", "Shipment Date")), expected_shipment_date: date(pick(h, "Expected Shipment Date", "Shipment Date")), status: st === "draft" ? "draft" : /void|cancel/.test(st) ? "declined" : /invoiced|closed|fulfilled/.test(st) ? "invoiced" : /confirm|open|partial/.test(st) ? "accepted" : "sent" }); }
              if (kind === "invoices") Object.assign(base, { invoice_number: no, issue_date: issue, due_date: date(pick(h, "Due Date")), status: invStatus(pick(h, "Invoice Status", "Status")), source: "import" });
              if (kind === "credit_notes") Object.assign(base, { credit_note_number: no, issue_date: issue, reason: pick(h, "Reason") || "Imported", status: /void/i.test(pick(h, "Credit Note Status", "Status")) ? "void" : /draft/i.test(pick(h, "Credit Note Status", "Status")) ? "draft" : "open" });
              // Already reported to KRA eTIMS in the previous system: keep the KRA receipt link and signature.
              if (kind === "invoices" || kind === "credit_notes") Object.assign(base, kraFrom(h));
              const { data, error } = await retry(() => sb.from(table).insert(base).select("id").single());
              if (error) throw error;
              l.ok++;
              if (kind === "credit_notes" && base.status === "open") {
                let applied = 0;
                for (const a of jsonCol(h, "Invoices Credited")) {
                  const inv = (await sb.from("invoices").select("id").eq("invoice_number", String(a.invoice_number || "")).limit(1)).data?.[0];
                  const amt = num(String(a.amount ?? a.amount_applied ?? ""));
                  if (!inv || amt <= 0) continue;
                  const { error: ae } = await retry(() => sb.rpc("apply_credit_note", { p_note: data.id, p_invoice: inv.id, p_amount: amt }));
                  if (ae) fail(`${no} → ${a.invoice_number}: ${ae.message}`); else applied += amt;
                }
                const bal = pick(h, "Balance") !== "" ? num(pick(h, "Balance")) : null;
                const refunded = bal === null ? 0 : Math.max(0, total - applied - bal);
                if (refunded > 0.005) await sb.from("credit_notes").update({ amount_refunded: refunded, status: refunded + applied >= total - 0.005 ? "closed" : "open", refund_reference: "Refunded before the move" }).eq("id", data.id);
              }
              if (kind === "invoices") {
                const balance = pick(h, "Balance", "Balance Due") !== "" ? num(pick(h, "Balance", "Balance Due")) : (/paid/i.test(pick(h, "Invoice Status")) && !/partial/i.test(pick(h, "Invoice Status")) ? 0 : total);
                const paidPart = total - balance - (creditedInvoices.get(no) || 0);
                if (paidPart > 0.005 && base.status !== "void") paidLater.push({ id: data.id, amount: paidPart, date: issue, customer_id, customer: cust, number: no });
              }
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
          // Amounts the old system shows as already paid, when no Customer Payments file is imported.
          if (kind === "invoices" && synthPayments && !byKind.get("payments")?.length) {
            for (const p of paidLater) {
              const { data: pay, error } = await sb.from("payments_received").insert({ tenant_id: tenantId, payment_number: `ZP-${p.number}`, customer_id: p.customer_id, customer_name: p.customer, payment_date: p.date, amount: p.amount, method: "bank", reference: "Paid before the move" }).select("id").single();
              if (!error) await sb.from("payment_allocations").insert({ tenant_id: tenantId, payment_id: pay.id, invoice_id: p.id, amount: p.amount });
            }
          }
        }
        if (kind === "payments") {
          const have = await exists("payments_received", "payment_number");
          const invByNo = await map("invoices", "id,invoice_number,total,amount_paid", (r) => String(r.invoice_number || ""));
          const groups = groupBy(rows, (r) => pick(r, "Payment Number", "CustomerPayment ID", "Payment ID") || `${pick(r, "Date")}-${pick(r, "Customer Name")}-${pick(r, "Amount")}`);
          await each(groups, async ([no, lines]) => {
            if (have.has(no)) { l.skipped++; return; }
            const h = lines[0];
            try {
              const cust = pick(h, "Customer Name");
              const customer_id = await ensureCustomer(cust);
              const amount = num(pick(h, "Amount", "Payment Amount", "Total"));
              const { data: pay, error } = await retry(() => sb.from("payments_received").insert({ tenant_id: tenantId, payment_number: no, customer_id, customer_name: cust, payment_date: date(pick(h, "Date", "Payment Date")), amount, method: pick(h, "Mode", "Payment Mode", "Deposit To") || "bank", reference: pick(h, "Reference Number", "Reference#") || null, notes: pick(h, "Description", "Notes") || null }).select("id").single());
              if (error) throw error;
              for (const r of lines) {
                const inv = invByNo.get(pick(r, "Invoice Number"));
                const applied = num(pick(r, "Amount Applied to Invoice", "Invoice Payment Applied Amount", "Applied Amount", "Invoice Amount Applied")) || (lines.length === 1 ? amount : 0);
                if (inv && applied > 0) {
                  const dup = (await sb.from("payment_allocations").select("id").eq("payment_id", pay.id).eq("invoice_id", inv.id).limit(1)).data?.length;
                  if (dup) continue;
                  const { error: ae } = await retry(() => sb.from("payment_allocations").insert({ tenant_id: tenantId, payment_id: pay.id, invoice_id: inv.id, amount: applied }));
                  if (ae) fail(`${no} → ${pick(r, "Invoice Number")}: ${ae.message}`);
                }
              }
              l.ok++;
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
        }
        if (kind === "bills") {
          // A bill number is the supplier's own invoice number, so it is only unique per supplier.
          const billKey = (vendor: string, no: string) => `${norm(vendor)}|${no}`;
          const have = new Set((await pageAll("bills", "id,bill_number,name")).map((x: any) => billKey(x.name || "", String(x.bill_number || ""))));
          const groups = groupBy(rows, (r) => { const no = pick(r, "Bill Number", "Bill#"); return no ? billKey(pick(r, "Vendor Name"), no) : ""; });
          await each(groups, async ([key, lines]) => {
            const h = lines[0];
            const no = pick(h, "Bill Number", "Bill#");
            if (have.has(key)) { l.skipped++; return; }
            try {
              const vend = pick(h, "Vendor Name");
              const supplier_id = await ensureVendor(vend);
              const its = lines.map(itemLine);
              const total = num(pick(h, "Total", "Bill Total")) || its.reduce((a, i) => a + i.amount, 0);
              const tax = lines.reduce((a, r) => a + num(pick(r, "Tax Amount", "Item Tax Amount")), 0);
              const balance = pick(h, "Balance", "Balance Due") !== "" ? num(pick(h, "Balance", "Balance Due")) : (/paid/i.test(pick(h, "Bill Status")) ? 0 : total);
              const st = norm(pick(h, "Bill Status", "Status"));
              // Paid before the move = total − balance − vendor credits applied (credits are applied below, not paid).
              // With a vendor payments list, those payments settle the bill instead.
              const payFile = !!byKind.get("vendor_payments")?.length;
              const paidPart = Math.max(0, total - balance - (creditedBills.get(billKey(vend, no)) || creditedBills.get(no) || 0));
              const paidNow = payFile || !synthPayments || st === "void" || st === "draft" ? 0 : paidPart;
              const status = st === "void" ? "void" : st === "draft" ? "draft" : "pending";
              const { data, error } = await retry(() => sb.from("bills").insert({ tenant_id: tenantId, bill_number: no, name: vend || `Bill ${no}`, supplier_id, category: pick(h, "Account", "Expense Account") || "Purchases", bill_date: date(pick(h, "Bill Date", "Date")), due_date: date(pick(h, "Due Date")), reference: pick(h, "Reference Number", "Reference#") || null, items: its, subtotal: total - tax, tax, amount: total, amount_paid: 0, status, notes: pick(h, "Notes") || null, is_recurring: false }).select("id").single());
              if (error) throw error;
              // What the old system shows as paid also leaves the books (when no vendor payments list is imported),
              // recorded the way DASH records any bill payment (the table takes no direct inserts).
              if (paidNow > 0.005) {
                const { error: pe } = await retry(() => sb.rpc("record_bill_payment", { p_bill: data.id, p_amount: paidNow, p_method: "bank", p_reference: "Paid before the move", p_paid_on: date(pick(h, "Bill Date", "Date")), p_notes: null }));
                if (pe) fail(`${vend} ${no}: ${pe.message}`);
              }
              l.ok++;
            } catch (e: any) { fail(`${pick(h, "Vendor Name")} ${no}: ${e.message || e}`); }
          });
        }
        if (kind === "vendor_payments") {
          const bills = await pageAll("bills", "id,bill_number,name,amount,amount_paid");
          const billByKey = new Map<string, any>(bills.map((b: any) => [`${norm(b.name || "")}|${b.bill_number || ""}`, b]));
          const billByNo = new Map<string, any[]>();
          bills.forEach((b: any) => { const k = String(b.bill_number || ""); billByNo.set(k, [...(billByNo.get(k) || []), b]); });
          const findBill = (vendor: string, no: string) => billByKey.get(`${norm(vendor)}|${no}`) || ((billByNo.get(no) || []).length === 1 ? billByNo.get(no)![0] : null);
          const paidRefs = await exists("supplier_payments", "reference");
          const groups = groupBy(rows, (r) => pick(r, "Payment Number", "Payment ID") || `${pick(r, "Date")}-${pick(r, "Vendor Name")}-${pick(r, "Amount")}`);
          await each(groups, async ([no, lines]) => {
            if (paidRefs.has(no)) { l.skipped++; return; }
            const h = lines[0];
            try {
              const vend = pick(h, "Vendor Name");
              const supplier_id = await ensureVendor(vend);
              void supplier_id;
              // A payment whose bills are all settled already (an earlier or parallel run) is already here.
              const targets = lines.map((r) => findBill(vend, pick(r, "Bill Number"))).filter(Boolean);
              if (targets.length && targets.every((b: any) => Number(b.amount_paid || 0) >= Number(b.amount || 0) - 0.005)) { l.skipped++; return; }
              for (const r of lines) {
                const bill = findBill(vend, pick(r, "Bill Number"));
                const amt = num(pick(r, "Amount Applied to Bill", "Bill Amount", "Applied Amount")) || (lines.length === 1 ? num(pick(h, "Amount", "Total")) : 0);
                if (!amt) continue;
                if (!bill) { fail(`${no}: bill ${pick(r, "Bill Number")} of ${vend} not found`); continue; }
                // One bill's payments go in order; record_bill_payment updates the bill's paid amount and status.
                const { error } = await serial(`b:${bill.id}`, () => retry(() => sb.rpc("record_bill_payment", { p_bill: bill.id, p_amount: amt, p_method: pick(h, "Mode", "Payment Mode", "Paid Through") || "bank", p_reference: no, p_paid_on: date(pick(h, "Date", "Payment Date")), p_notes: pick(h, "Description", "Notes") || null })));
                if (error && /already paid/i.test(error.message || "")) continue;
                if (error) throw error;
                bill.amount_paid = Number(bill.amount_paid || 0) + amt;
              }
              l.ok++;
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
        }
        if (kind === "expenses") {
          const ins: any[] = [];
          const ek = (d: any, a: any, c: any, ref: any, v: any) => [d || "", Number(a || 0).toFixed(2), norm(c || ""), norm(ref || ""), norm(v || "")].join("|");
          const have = new Set((await pageAll("expenses", "id,expense_date,amount,category_name,reference,vendor_name")).map((x: any) => ek(x.expense_date, x.amount, x.category_name, x.reference, x.vendor_name)));
          for (const r of rows) {
            const amount = num(pick(r, "Total", "Amount", "Expense Amount"));
            if (!amount) continue;
            const vend = pick(r, "Vendor", "Vendor Name", "Merchant");
            const key = ek(date(pick(r, "Expense Date", "Date")), amount, pick(r, "Expense Account", "Account", "Category") || "General expenses", pick(r, "Reference#", "Reference Number", "Reference"), vend);
            if (have.has(key)) { l.skipped++; continue; }
            have.add(key);
            ins.push({ tenant_id: tenantId, expense_date: date(pick(r, "Expense Date", "Date")), category_name: pick(r, "Expense Account", "Account", "Category") || "General expenses", amount, tax_amount: num(pick(r, "Tax Amount")) || 0,
              description: pick(r, "Description", "Notes") || null, vendor_name: vend || null, supplier_id: vend ? vendors.get(norm(vend))?.id || null : null, paid_through: pick(r, "Paid Through", "Payment Account") || null, payment_method: "bank",
              reference: pick(r, "Reference#", "Reference Number", "Reference") || null, customer_id: pick(r, "Customer Name") ? customers.get(norm(pick(r, "Customer Name")))?.id || null : null, location_id: loc, approval_status: "approved" });
          }
          for (const c of chunk(ins)) { const { error } = await sb.from("expenses").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
        if (kind === "journals") {
          const groups = groupBy(rows, (r) => pick(r, "Journal Number", "Journal#", "Reference Number") || pick(r, "Journal Date"));
          const posted = new Set((await pageAll("journals", "id,reference", (q) => q.eq("source_type", "manual"))).map((x: any) => String(x.reference || "")));
          await each(groups, async ([no, lines]) => {
            if (posted.has(no)) { l.skipped++; return; }
            try {
              const jl = lines.map((r) => {
                const accName = pick(r, "Account", "Account Name");
                let acc = accounts.get(norm(accName));
                if (!acc) throw new Error(`Unknown account "${accName}" (import the chart of accounts first)`);
                return { account_id: acc.id, description: pick(r, "Description", "Line Description"), debit: num(pick(r, "Debit")), credit: num(pick(r, "Credit")) };
              });
              const { error } = await retry(() => sb.rpc("acc_manual_journal", { p_id: null, p_date: date(pick(lines[0], "Journal Date", "Date")), p_reference: no, p_notes: pick(lines[0], "Notes") || "Imported", p_lines: jl }));
              if (error) throw error;
              l.ok++;
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
        }
        if (kind === "bank_accounts") {
          for (const r of rows) {
            const name = pick(r, "Account Name"); if (!name) continue;
            if (accounts.has(norm(name))) { l.skipped++; continue; }
            const card = /credit.?card|card/i.test(pick(r, "Account Type"));
            try { await ensureAccount(name, card ? "liability" : "asset", card ? "credit_card" : "bank"); l.ok++; } catch (e: any) { fail(`${name}: ${e.message || e}`); }
          }
        }
        if (kind === "purchase_orders") {
          const have = await exists("purchases", "po_number");
          const groups = groupBy(rows, (r) => pick(r, "Purchase Order Number", "PurchaseOrder Number", "PO Number"));
          await each(groups, async ([no, lines]) => {
            if (have.has(no)) { l.skipped++; return; }
            const h = lines[0];
            try {
              const vend = pick(h, "Vendor Name");
              const supplier_id = await ensureVendor(vend);
              const st = norm(pick(h, "Status", "Purchase Order Status"));
              const status = st === "draft" ? "draft" : /cancel|void/.test(st) ? "cancelled" : /partiallyreceived/.test(st) ? "partially_received" : /received/.test(st) ? "received" : /billed|closed/.test(st) ? "closed" : "pending";
              const its = lines.map(itemLine).filter((i) => i.name || i.amount);
              const total = num(pick(h, "Total")) || its.reduce((a, i) => a + i.amount, 0);
              const tax = num(pick(h, "Tax Total", "Tax Amount"));
              const { data: po, error } = await retry(() => sb.from("purchases").insert({ tenant_id: tenantId, po_number: no, supplier_id, supplier_name: vend || null, location_id: loc, status, order_date: date(pick(h, "Purchase Order Date", "Date")), expected_date: date(pick(h, "Delivery Date", "Expected Delivery Date")), reference: pick(h, "Reference#", "Reference Number") || null, notes: pick(h, "Notes") || null, subtotal: num(pick(h, "SubTotal", "Sub Total")) || total - tax, tax, total, payment_status: "unpaid", billed: /billed|closed/.test(st) || /billed/i.test(pick(h, "Billed")), received_at: status === "received" ? new Date().toISOString() : null }).select("id").single());
              if (error) throw error;
              // Header and lines go in together: if the lines fail, the header is removed so a re-run brings the whole order.
              try {
                const lineRows: any[] = [];
                for (const r of lines) {
                  const li = itemLine(r); if (!li.name) continue;
                  const product_id = await ensureProduct(li.name, li.rate);
                  lineRows.push({ purchase_id: po.id, product_id, quantity: Math.max(1, Math.round(li.quantity)), unit_cost: li.rate, total: li.amount, received_quantity: num(pick(r, "Quantity Received", "Received Quantity")) });
                }
                if (lineRows.length) { const { error: le } = await retry(() => sb.from("purchase_items").insert(lineRows)); if (le) throw le; }
              } catch (le: any) {
                await sb.from("purchases").delete().eq("id", po.id);
                throw le;
              }
              l.ok++;
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
        }
        if (kind === "vendor_credits") {
          const have = await exists("vendor_credits", "credit_number");
          const vcBills = await pageAll("bills", "id,bill_number,name");
          const vcBill = (vendor: string, no: string) => vcBills.find((b: any) => String(b.bill_number || "") === no && norm(b.name || "") === norm(vendor)) || vcBills.filter((b: any) => String(b.bill_number || "") === no).reduce((a: any, b: any, _i: number, all: any[]) => (all.length === 1 ? b : a), null);
          const groups = groupBy(rows, (r) => pick(r, "Vendor Credit Number", "Vendor Credit#", "Debit Note Number"));
          await each(groups, async ([no, lines]) => {
            if (have.has(no)) { l.skipped++; return; }
            const h = lines[0];
            try {
              const vend = pick(h, "Vendor Name");
              const supplier_id = await ensureVendor(vend);
              const its = lines.map(itemLine).filter((i) => i.name || i.amount);
              const total = num(pick(h, "Total", "Amount")) || its.reduce((a, i) => a + i.amount, 0);
              if (total <= 0) { l.skipped++; return; }
              const st = norm(pick(h, "Status"));
              const status = st === "void" ? "void" : st === "draft" ? "draft" : "open";
              const { data: vc, error } = await retry(() => sb.from("vendor_credits").insert({ tenant_id: tenantId, credit_number: no, supplier_id, supplier_name: vend || null, credit_date: date(pick(h, "Vendor Credit Date", "Date")), reason: pick(h, "Notes", "Reason") || "Imported", items: its, amount: total, amount_applied: 0, amount_refunded: 0, status, notes: pick(h, "Reference#", "Reference Number") || null }).select("id").single());
              if (error) throw error;
              let applied = 0;
              if (status === "open") {
                for (const a of jsonCol(h, "Bills Credited")) {
                  const bill = vcBill(vend, String(a.bill_number || ""));
                  const amt = num(String(a.amount ?? a.amount_applied ?? ""));
                  if (!bill || amt <= 0) continue;
                  const { error: ae } = await retry(() => sb.rpc("apply_vendor_credit", { p_credit: vc.id, p_bill: bill.id, p_amount: amt }));
                  if (ae) fail(`${no} → ${a.bill_number}: ${ae.message}`); else applied += amt;
                }
                const bal = pick(h, "Balance") !== "" ? num(pick(h, "Balance")) : null;
                const refunded = bal === null ? 0 : Math.max(0, total - applied - bal);
                // DASH posts a vendor credit's refund itself (money back into the bank), so banking skips vendor refunds.
                if (refunded > 0.005) await sb.from("vendor_credits").update({ amount_refunded: refunded, status: refunded + applied >= total - 0.005 ? "closed" : "open" }).eq("id", vc.id);
              }
              l.ok++;
            } catch (e: any) { fail(`${no}: ${e.message || e}`); }
          });
        }
        if (kind === "opening_balances") {
          const ref = "OPENING-BALANCES";
          const posted = new Set((await pageAll("journals", "id,reference", (q) => q.eq("source_type", "manual"))).map((x: any) => String(x.reference || "")));
          if (posted.has(ref)) { l.skipped++; }
          else {
            try {
              const jl: any[] = [];
              for (const r of rows) {
                const accName = pick(r, "Account", "Account Name");
                const debit = num(pick(r, "Debit")), credit = num(pick(r, "Credit"));
                if (!accName || (!debit && !credit)) continue;
                const acc = accounts.get(norm(accName));
                if (!acc) throw new Error(`Unknown account "${accName}" (import the chart of accounts first)`);
                jl.push({ account_id: acc.id, description: "Opening balance", debit, credit });
              }
              const diff = Math.round((jl.reduce((a, x) => a + x.debit - x.credit, 0)) * 100) / 100;
              if (Math.abs(diff) > 0.005) {
                const adj = await ensureAccount("Opening Balance Adjustments", "equity", "equity");
                jl.push({ account_id: adj, description: "Opening balance adjustment", debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 });
              }
              if (jl.length) {
                const { error } = await sb.rpc("acc_manual_journal", { p_id: null, p_date: date(pick(rows[0], "Opening Date", "Date")), p_reference: ref, p_notes: "Opening balances from the previous system", p_lines: jl });
                if (error) throw error;
                l.ok++;
              }
            } catch (e: any) { fail(e.message || String(e)); }
          }
        }
        if (kind === "bank_transactions") {
          const done = new Set((await pageAll("bank_transactions", "id,import_batch")).map((x: any) => String(x.import_batch || "")));
          // Kinds of money movement the old system created from documents imported above, or the opening balances journal.
          const IN_DOCS = /^(customer_?payment|vendor_?payment|expense|bill|invoice|journal|manual_?journal|opening_?balance|vendor_?credit_?refund|vendor_?refund|debit_?note_?refund)$/i;
          const IN = /^(deposit|owner_?contribution|sales_?without_?invoices|interest_?income|other_?income|expense_?refund)$/i;
          const OUT = /^(owner_?drawings|refund|payment_?refund|creditnote_?refund)$/i;
          for (const r of rows) {
            const id = pick(r, "Transaction ID", "TransactionID") || [pick(r, "Bank Account"), pick(r, "Date"), pick(r, "Amount"), pick(r, "Reference", "Reference Number"), pick(r, "Description")].join("|");
            const key = `ext:${id}`;
            const type = pick(r, "Type", "Transaction Type");
            if (done.has(key)) { l.skipped++; continue; }
            if (IN_DOCS.test(type)) { l.skipped++; continue; }
            try {
              const bankName = pick(r, "Bank Account", "Account");
              const bank = accounts.get(norm(bankName));
              if (!bank) throw new Error(`Unknown bank account "${bankName}" (import bank accounts first)`);
              const from = pick(r, "From Account"), to = pick(r, "To Account");
              let amount = Math.abs(num(pick(r, "Amount", "Deposits", "Withdrawals")));
              if (!amount) { l.skipped++; continue; }
              const inflow = IN.test(type) ? true : OUT.test(type) ? false
                : to && norm(to) === norm(bankName) ? true : from && norm(from) === norm(bankName) ? false
                : num(pick(r, "Withdrawals")) ? false : num(pick(r, "Deposits")) ? true
                : !/credit/i.test(pick(r, "Direction", "Debit or Credit"));
              if (!inflow) amount = -amount;
              const offsetName = norm(to) === norm(bankName) ? from : to;
              const { data: line, error } = await sb.from("bank_transactions").insert({ tenant_id: tenantId, account_id: bank.id, txn_date: date(pick(r, "Date")), description: pick(r, "Description") || type || null, reference: pick(r, "Reference", "Reference Number") || null, payee: pick(r, "Payee") || null, amount, status: "uncategorized", import_batch: key }).select("id").single();
              if (error) throw error;
              done.add(key);
              const offset = offsetName ? accounts.get(norm(offsetName)) : null;
              if (offset && !/^uncategori/i.test(pick(r, "Status"))) {
                const { error: ce } = await sb.rpc("acc_categorize_bank_line", { p_line: line.id, p_account: offset.id, p_exclude: false });
                if (ce) fail(`${id}: ${ce.message}`);
              }
              l.ok++;
            } catch (e: any) { fail(`${id}: ${e.message || e}`); }
          }
        }
        if (kind === "recurring_invoices" || kind === "recurring_bills" || kind === "recurring_expenses") {
          const table = kind === "recurring_invoices" ? "invoices" : kind === "recurring_bills" ? "bills" : "expenses";
          const groups = groupBy(rows, (r) => pick(r, "Profile Name", "Recurrence Name") || [pick(r, "Customer Name", "Vendor Name", "Vendor", "Expense Account"), pick(r, "Total")].join("|"));
          for (const [name, lines] of groups) {
            const h = lines[0];
            if (stoppedProfile(pick(h, "Status"))) { l.skipped++; continue; }
            try {
              const total = num(pick(h, "Total", "Amount"));
              const schedule = { is_recurring: true, recurrence_interval: Math.max(1, Math.round(num(pick(h, "Repeat Every")) || 1)), recurrence_unit: unitOf(pick(h, "Frequency", "Recurrence Frequency")), next_due_date: date(pick(h, "Next Date", "Next Invoice Date", "Next Bill Date", "Next Expense Date")) };
              let templateId: string | null = null;
              if (kind === "recurring_invoices") {
                const cid = await ensureCustomer(pick(h, "Customer Name"));
                const cands = (await sb.from("invoices").select("id,total,is_recurring").eq("customer_id", cid).neq("status", "void").order("issue_date", { ascending: false }).limit(25)).data || [];
                if (cands.some((x: any) => x.is_recurring)) { l.skipped++; continue; }
                templateId = cands.find((x: any) => Math.abs(Number(x.total) - total) < 0.01)?.id || null;
                if (!templateId) {
                  const its = lines.map(itemLine).filter((i) => i.name || i.amount);
                  const { data, error } = await sb.from("invoices").insert({ tenant_id: tenantId, invoice_number: `REC-${norm(name).slice(0, 24) || Date.now()}`, customer_id: cid, customer_name: pick(h, "Customer Name"), items: its, subtotal: total, tax: 0, total, status: "draft", issue_date: schedule.next_due_date, source: "import", notes: `Repeating profile "${name}" from the previous system` }).select("id").single();
                  if (error) throw error; templateId = data.id;
                }
              } else if (kind === "recurring_bills") {
                const sid = await ensureVendor(pick(h, "Vendor Name"));
                const cands = (await sb.from("bills").select("id,amount,is_recurring").eq("supplier_id", sid).neq("status", "void").order("bill_date", { ascending: false }).limit(25)).data || [];
                if (cands.some((x: any) => x.is_recurring)) { l.skipped++; continue; }
                templateId = cands.find((x: any) => Math.abs(Number(x.amount) - total) < 0.01)?.id || null;
                if (!templateId) {
                  const its = lines.map(itemLine).filter((i) => i.name || i.amount);
                  const { data, error } = await sb.from("bills").insert({ tenant_id: tenantId, bill_number: `REC-${norm(name).slice(0, 24) || Date.now()}`, name: pick(h, "Vendor Name") || name, supplier_id: sid, category: pick(h, "Account", "Expense Account") || "Purchases", bill_date: schedule.next_due_date, items: its, subtotal: total, tax: 0, amount: total, amount_paid: 0, status: "draft", notes: `Repeating profile "${name}" from the previous system`, is_recurring: false }).select("id").single();
                  if (error) throw error; templateId = data.id;
                }
              } else {
                const cat = pick(h, "Expense Account", "Account");
                const cands = (await sb.from("expenses").select("id,amount,is_recurring,category_name").eq("amount", total).order("expense_date", { ascending: false }).limit(50)).data || [];
                const same = cands.filter((x: any) => norm(x.category_name || "") === norm(cat));
                if (same.some((x: any) => x.is_recurring)) { l.skipped++; continue; }
                templateId = same[0]?.id || null;
                if (!templateId) { fail(`"${name}": no past expense of ${total} in "${cat}" to repeat; set it up under Expenses`); continue; }
              }
              const { error } = await sb.from(table).update(schedule).eq("id", templateId);
              if (error) throw error;
              l.ok++;
            } catch (e: any) { fail(`${name}: ${e.message || e}`); }
          }
        }
        if (kind === "price_lists") {
          const haveLists = await map("price_lists", "id,name", (r) => norm(r.name));
          for (const [name, lines] of groupBy(rows, (r) => pick(r, "Price List Name", "Pricebook Name", "Name"))) {
            const h = lines[0];
            const existing = haveLists.get(norm(name));
            if (existing) {
              const got = new Set(((await sb.from("price_list_items").select("product_id").eq("price_list_id", existing.id)).data || []).map((x: any) => x.product_id));
              const add = new Map<string, any>();
              for (const r of lines) {
                const item = items.get(norm(pick(r, "Item Name")));
                if (item && item.id !== "pending" && !got.has(item.id)) add.set(item.id, { price_list_id: existing.id, tenant_id: tenantId, product_id: item.id, rate: num(pick(r, "Rate", "Custom Rate", "Price List Rate")) });
              }
              for (const c of chunk([...add.values()])) { const { error: ie } = await sb.from("price_list_items").upsert(c, { onConflict: "price_list_id,product_id" }); if (ie) fail(`${name}: ${ie.message}`); }
              l.skipped++; continue;
            }
            try {
              const perItem = /item|individual|unit/i.test(pick(h, "Type", "Pricing Scheme", "Price List Type")) || lines.some((r) => pick(r, "Item Name"));
              const pct = num(pick(h, "Percentage", "Markup Percentage", "Percent"));
              const down = /down|discount/i.test(pick(h, "Markup or Markdown", "Rounding Type", "Percentage Type"));
              const { data: pl, error } = await sb.from("price_lists").insert({ tenant_id: tenantId, name, kind: perItem ? "items" : "percent", percent: perItem ? 0 : down ? -Math.abs(pct) : pct, description: pick(h, "Description") || null, is_active: !/inactive/i.test(pick(h, "Status")) }).select("id").single();
              if (error) throw error;
              if (perItem) {
                const its = new Map<string, any>();
                for (const r of lines) {
                  const item = items.get(norm(pick(r, "Item Name")));
                  if (item && item.id !== "pending") its.set(item.id, { price_list_id: pl.id, tenant_id: tenantId, product_id: item.id, rate: num(pick(r, "Rate", "Custom Rate", "Price List Rate")) });
                }
                for (const c of chunk([...its.values()])) { const { error: ie } = await sb.from("price_list_items").upsert(c, { onConflict: "price_list_id,product_id" }); if (ie) fail(`${name}: ${ie.message}`); }
              }
              haveLists.set(norm(name), pl); l.ok++;
            } catch (e: any) { fail(`${name}: ${e.message || e}`); }
          }
        }
        // Projects and time entries need the Projects module: say so once instead of a database refusal per row.
        const projectsOff = (kind === "projects" || kind === "timesheets")
          && (await sb.rpc("tenant_module_active" as any, { p_tenant: tenantId, p_key: "projects" } as any)).data === false;
        if (projectsOff) fail("The Projects module is off for this company. Switch it on in Settings → Modules, then run Move-in again (records already moved are skipped).");
        if ((kind === "projects" || kind === "timesheets") && !projectsOff) {
          // Projects, tasks and time entries live in the Projects app (app_records); the old system's id is kept in data.ext_id.
          const recs = await pageAll("app_records", "id,kind,title,parent_id,data", (q) => q.eq("app", "projects"));
          const byExt = new Map<string, any>(recs.filter((x: any) => x.data?.ext_id).map((x: any) => [String(x.data.ext_id), x]));
          const projByName = new Map<string, any>(recs.filter((x: any) => x.kind === "project").map((x: any) => [norm(x.title), x]));
          const taskKeys = new Set<string>(recs.filter((x: any) => x.kind === "task" && x.parent_id).map((x: any) => `${x.parent_id}|${norm(x.title)}`));
          const staff = await pageAll("hr_employees", "id,first_name,last_name,email");
          const staffId = (who: string) => { const k = norm(who); if (!k) return null; return staff.find((x: any) => norm(`${x.first_name || ""}${x.last_name || ""}`) === k || norm(x.email || "") === k)?.id || null; };
          const projStage = (v: string) => { const t = norm(v); return /complete|closed|finish/.test(t) ? "completed" : /cancel/.test(t) ? "cancelled" : /hold/.test(t) ? "on_hold" : /plan|draft|notstarted/.test(t) ? "planning" : "active"; };
          if (kind === "projects") {
            const sorted = [...rows].sort((a, b) => (norm(pick(a, "Record Type")) === "task" || pick(a, "Task Name") ? 1 : 0) - (norm(pick(b, "Record Type")) === "task" || pick(b, "Task Name") ? 1 : 0));
            for (const r of sorted) {
              const rt = norm(pick(r, "Record Type"));
              const isTask = rt === "task" || (rt !== "project" && !!pick(r, "Task Name"));
              const ext = isTask ? `task:${pick(r, "Task ID") || `${pick(r, "Project Name")}|${pick(r, "Task Name")}`}` : `project:${pick(r, "Project ID") || pick(r, "Project Name")}`;
              if (byExt.has(ext)) { l.skipped++; continue; }
              try {
                if (!isTask) {
                  const name = pick(r, "Project Name"); if (!name) continue;
                  if (projByName.has(norm(name))) { byExt.set(ext, projByName.get(norm(name))); l.skipped++; continue; }
                  const customer_id = await ensureCustomer(pick(r, "Customer Name"));
                  const { data, error } = await sb.from("app_records").insert({ tenant_id: tenantId, app: "projects", kind: "project", title: name, stage: projStage(pick(r, "Status")), customer_id,
                    amount: num(pick(r, "Fixed Cost", "Budget Amount", "Project Cost", "Budget")) || null, starts_at: date(pick(r, "Start Date", "Created Date")), due_date: date(pick(r, "End Date", "Due Date")),
                    data: { _prefix: "PRJ-", ext_id: ext, billing: /fixed/i.test(pick(r, "Billing Method", "Billing Type")) ? "Fixed price" : /staff|user/i.test(pick(r, "Billing Method", "Billing Type")) ? "Time & materials (staff rate)" : /task/i.test(pick(r, "Billing Method", "Billing Type")) ? "Time & materials (task rate)" : pick(r, "Billing Method") ? "Fixed price" : "Not billable",
                      rate: num(pick(r, "Rate", "Hourly Rate", "Project Rate")) || undefined, budget_hours: num(pick(r, "Budget Hours")) || undefined, description: pick(r, "Description") || undefined } }).select("id,kind,title,data").single();
                  if (error) throw error;
                  byExt.set(ext, data); projByName.set(norm(name), data); l.ok++;
                } else {
                  const proj = byExt.get(`project:${pick(r, "Project ID")}`) || projByName.get(norm(pick(r, "Project Name")));
                  if (!proj) throw new Error(`Task "${pick(r, "Task Name")}": project not found`);
                  // The same project kept in two places (the books and the projects app) lists the same tasks twice.
                  const tk = `${proj.id}|${norm(pick(r, "Task Name") || "Task")}`;
                  if (taskKeys.has(tk)) { byExt.set(ext, proj); l.skipped++; continue; }
                  taskKeys.add(tk);
                  const { data, error } = await sb.from("app_records").insert({ tenant_id: tenantId, app: "projects", kind: "task", title: pick(r, "Task Name") || "Task", parent_id: proj.id,
                    stage: /complete|done|closed/i.test(pick(r, "Status", "Task Status")) ? "done" : /progress|open/i.test(pick(r, "Status", "Task Status")) ? "in_progress" : "todo",
                    quantity: num(pick(r, "Budget Hours", "Estimated Hours")) || null, due_date: date(pick(r, "Due Date", "End Date")),
                    data: { _prefix: "TSK-", ext_id: ext, billable: !/no|false|non/i.test(pick(r, "Billable", "Is Billable") || "yes"), rate: num(pick(r, "Rate", "Task Rate")) || undefined, description: pick(r, "Description") || undefined } }).select("id,kind,title,data").single();
                  if (error) throw error;
                  byExt.set(ext, data); l.ok++;
                }
              } catch (e: any) { fail(e.message || String(e)); }
            }
          } else {
            const hours = (v: string) => { const m = String(v || "").match(/^(\d+):(\d{1,2})/); return m ? Number(m[1]) + Number(m[2]) / 60 : num(v); };
            for (const r of rows) {
              const ext = `time:${pick(r, "Time Entry ID", "TimeEntry ID") || [pick(r, "Project Name"), pick(r, "Task Name"), pick(r, "User Name", "Staff"), pick(r, "Log Date", "Date"), pick(r, "Logged Hours", "Hours")].join("|")}`;
              if (byExt.has(ext)) { l.skipped++; continue; }
              try {
                const proj = byExt.get(`project:${pick(r, "Project ID")}`) || projByName.get(norm(pick(r, "Project Name")));
                if (!proj) throw new Error(`Time entry on "${pick(r, "Project Name")}": project not found (import projects first)`);
                const task = byExt.get(`task:${pick(r, "Task ID")}`) || recs.find((x: any) => x.kind === "task" && x.parent_id === proj.id && norm(x.title) === norm(pick(r, "Task Name")));
                const h = hours(pick(r, "Logged Hours", "Hours", "Time Spent", "Log Time"));
                if (!h) { l.skipped++; continue; }
                const { data, error } = await sb.from("app_records").insert({ tenant_id: tenantId, app: "projects", kind: "timesheet", title: pick(r, "Notes", "Description") || pick(r, "Task Name") || "Work done", parent_id: proj.id,
                  stage: /^(billed|invoiced)$/i.test(pick(r, "Billed Status", "Status").trim()) ? "invoiced" : "approved", employee_id: staffId(pick(r, "User Name", "Staff", "Employee")), starts_at: date(pick(r, "Log Date", "Date")), quantity: Math.round(h * 100) / 100,
                  amount: num(pick(r, "Billable Amount", "Amount")) || null, data: { ext_id: ext, task: task?.id || undefined, billable: !/no|false|non/i.test(pick(r, "Billable", "Is Billable") || "yes"), staff_name: pick(r, "User Name", "Staff") || undefined } }).select("id,kind,title,data").single();
                if (error) throw error;
                byExt.set(ext, data); l.ok++;
              } catch (e: any) { fail(e.message || String(e)); }
            }
          }
        }
        if (kind === "attachments") {
          // Files the API connection copied into the company's private document store; link each to its record.
          const havePaths = new Set((await pageAll("documents", "id,path")).map((x: any) => String(x.path || "")));
          const where: Record<string, [string, string, string]> = {
            invoice: ["invoices", "invoice_number", "invoice"], quote: ["quotes", "quote_number", "quote"], sales_order: ["sales_orders", "quote_number", "sales_order"],
            credit_note: ["credit_notes", "credit_note_number", "credit_note"], bill: ["bills", "bill_number", "bill"], purchase_order: ["purchases", "po_number", "purchase_order"],
            vendor_credit: ["vendor_credits", "credit_number", "vendor_credit"], journal: ["journals", "reference", "journal"], expense: ["expenses", "reference", "expense"],
          };
          for (const r of rows) {
            const path = pick(r, "Storage Path");
            if (!path || havePaths.has(path)) { l.skipped++; continue; }
            try {
              const module = pick(r, "Module"); const no = pick(r, "Number");
              const [table, col, type] = where[module] || [];
              let entityId: string | null = null;
              if (table && no) entityId = (await sb.from(table).select("id").eq(col, no).limit(1)).data?.[0]?.id || null;
              if (!entityId && module === "expense") {
                const q = sb.from("expenses").select("id").eq("amount", num(pick(r, "Amount"))).eq("expense_date", date(pick(r, "Date")));
                entityId = (await q.limit(1)).data?.[0]?.id || null;
              }
              const { error } = await sb.from("documents").insert({ tenant_id: tenantId, entity_type: entityId ? type : "general", entity_id: entityId, entity_name: no || null, name: pick(r, "File Name") || "Attachment", category: "From the previous system", path, mime_type: pick(r, "Mime Type") || null, size_bytes: num(pick(r, "Size")) || null, notes: entityId ? null : `${module} ${no}` });
              if (error) throw error;
              havePaths.add(path); l.ok++;
            } catch (e: any) { fail(`${pick(r, "File Name")}: ${e.message || e}`); }
          }
        }
        if (kind === "leads") {
          const lk = (name: any, email: any, phone: any) => [norm(name || ""), norm(email || ""), norm(phone || "")].join("|");
          const haveLeads = new Set((await pageAll("crm_leads", "id,name,email,phone")).map((x: any) => lk(x.name, x.email, x.phone)));
          const fresh = rows.filter((r) => {
            const k = lk(pick(r, "Lead Name", "Company", "Full Name") || `${pick(r, "First Name")} ${pick(r, "Last Name")}`.trim() || "Lead", pick(r, "Email"), pick(r, "Phone"));
            if (haveLeads.has(k)) { l.skipped++; return false; }
            return true;
          });
          const ins = fresh.map((r) => ({ tenant_id: tenantId, type: "lead", name: pick(r, "Lead Name", "Company", "Full Name") || `${pick(r, "First Name")} ${pick(r, "Last Name")}`.trim() || "Lead",
            contact_name: `${pick(r, "First Name")} ${pick(r, "Last Name")}`.trim() || null, partner_name: pick(r, "Company", "Account Name") || null, email: pick(r, "Email") || null, phone: pick(r, "Phone") || null, mobile: pick(r, "Mobile") || null,
            website: pick(r, "Website") || null, city: pick(r, "City") || null, country: pick(r, "Country") || null, source: pick(r, "Lead Source", "Source") || "Import", description: pick(r, "Description") || null, expected_revenue: num(pick(r, "Annual Revenue", "Amount")) || 0, active: true }));
          for (const c of chunk(ins)) { const { error } = await sb.from("crm_leads").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
        if (kind === "deals") {
          // The same deal name for the same account recurs (repeat orders): the closing date and amount tell them apart.
          const dk = (n: any, a: any, d: any, amt: any) => `${norm(n || "")}|${norm(a || "")}|${String(d || "").slice(0, 10)}|${Number(amt || 0).toFixed(2)}`;
          const have = new Set((await pageAll("crm_deals", "id,name,account_name,closing_date,amount")).map((x: any) => dk(x.name, x.account_name, x.closing_date, x.amount)));
          const stageKey = (v: string) => { const t = norm(v); return /won/.test(t) ? "won" : /lost/.test(t) ? "lost" : /negotiat|review/.test(t) ? "negotiation" : /proposal|quote/.test(t) ? "proposal" : /decision/.test(t) ? "decision_makers" : /value/.test(t) ? "value_proposition" : /need|analysis/.test(t) ? "needs_analysis" : "qualification"; };
          const conBy = new Map<string, string>((await pageAll("crm_contacts", "id,first_name,last_name")).map((x: any) => [norm(`${x.first_name || ""}${x.last_name || ""}`), x.id]));
          const ins: any[] = [];
          for (const r of rows) {
            const name = pick(r, "Deal Name", "Potential Name"); if (!name) continue;
            const acc = pick(r, "Account Name");
            const key = dk(name, acc, date(pick(r, "Closing Date")), num(pick(r, "Amount")));
            if (have.has(key)) { l.skipped++; continue; }
            have.add(key);
            const stage = stageKey(pick(r, "Stage"));
            const cust = acc ? customers.get(norm(acc)) : null;
            ins.push({ tenant_id: tenantId, name, account_name: acc || null, customer_id: cust?.id && cust.id !== "pending" ? cust.id : null, contact_name: pick(r, "Contact Name") || null,
              contact_id: conBy.get(norm(pick(r, "Contact Name"))) || null,
              amount: num(pick(r, "Amount")), stage, probability: Math.round(num(pick(r, "Probability"))) || (stage === "won" ? 100 : stage === "lost" ? 0 : 10),
              closing_date: date(pick(r, "Closing Date")), source: pick(r, "Lead Source") || null, next_step: pick(r, "Next Step") || null,
              deal_type: /existing/i.test(pick(r, "Type")) ? "Existing business" : /new/i.test(pick(r, "Type")) ? "New business" : pick(r, "Type") || null,
              description: pick(r, "Description") || null,
              closed_at: stage === "won" || stage === "lost" ? date(pick(r, "Closing Date")) : null });
          }
          for (const c of chunk(ins)) { const { error } = await sb.from("crm_deals").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
        if (kind === "crm_contacts") {
          // Contact persons become the CRM's contacts, at their account (customer); once each (same account and name or email).
          const accBy = new Map<string, any>((await pageAll("customers", "id,name")).map((x: any) => [norm(x.name), x]));
          const ck = (acc: any, first: any, last: any, email: any) => `${acc || ""}|${norm(email || "") || norm(`${first || ""}${last || ""}`)}`;
          const have = new Set((await pageAll("crm_contacts", "id,account_id,first_name,last_name,email")).map((x: any) => ck(x.account_id, x.first_name, x.last_name, x.email)));
          const ins: any[] = [];
          for (const r of rows) {
            const acc = accBy.get(norm(pick(r, "Account Name")))?.id || null;
            const first = pick(r, "First Name"), last = pick(r, "Last Name") || (first ? "" : pick(r, "Email"));
            if (!first && !last) continue;
            const k = ck(acc, first, last, pick(r, "Email"));
            if (have.has(k)) { l.skipped++; continue; }
            have.add(k);
            ins.push({ tenant_id: tenantId, account_id: acc, salutation: pick(r, "Salutation") || null, first_name: first || null, last_name: last || "", title: pick(r, "Title") || null, department: pick(r, "Department") || null,
              email: pick(r, "Email") || null, phone: pick(r, "Phone") || null, mobile: pick(r, "Mobile") || null, lead_source: "Previous system" });
          }
          for (const c of chunk(ins)) { const { error } = await sb.from("crm_contacts").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
        if (kind === "crm_notes") {
          // Notes stay on the account, contact or deal they were written on; once each.
          const accBy = new Map<string, any>((await pageAll("customers", "id,name")).map((x: any) => [norm(x.name), x.id]));
          const dealBy = new Map<string, any>((await pageAll("crm_deals", "id,name")).map((x: any) => [norm(x.name), x.id]));
          const conBy = new Map<string, any>((await pageAll("crm_contacts", "id,first_name,last_name")).map((x: any) => [norm(`${x.first_name || ""}${x.last_name || ""}`), x.id]));
          const nk = (t: any, id: any, title: any, body: any) => `${t}|${id}|${norm(title || "")}|${norm(String(body || "").slice(0, 200))}`;
          const have = new Set((await pageAll("crm_notes", "id,related_type,related_id,title,body")).map((x: any) => nk(x.related_type, x.related_id, x.title, x.body)));
          const ins: any[] = [];
          for (const r of rows) {
            const mod = norm(pick(r, "Parent Module"));
            const parent = norm(pick(r, "Parent Name"));
            const [type, id] = mod === "deals" ? ["deal", dealBy.get(parent)] : mod === "contacts" ? ["contact", conBy.get(parent)] : ["account", accBy.get(parent)];
            if (!id) { l.skipped++; continue; }
            const k = nk(type, id, pick(r, "Title"), pick(r, "Content"));
            if (have.has(k)) { l.skipped++; continue; }
            have.add(k);
            const created = pick(r, "Created");
            ins.push({ tenant_id: tenantId, related_type: type, related_id: id, title: pick(r, "Title") || null, body: pick(r, "Content") || "", ext_id: "previous-system", created_by: null, ...(created ? { created_at: new Date(created).toISOString() } : {}) });
          }
          for (const c of chunk(ins)) { const { error } = await sb.from("crm_notes").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
        if (kind === "employees") {
          const staff = await pageAll("hr_employees", "id,employee_no,email");
          const haveNo = new Set(staff.map((x: any) => norm(x.employee_no || "")).filter(Boolean));
          const haveMail = new Set(staff.map((x: any) => norm(x.email || "")).filter(Boolean));
          const fresh = rows.filter((r) => {
            const no = norm(pick(r, "Employee ID", "EmployeeID", "Employee Number")), mail = norm(pick(r, "Email ID", "Email address", "Email"));
            if ((no && haveNo.has(no)) || (mail && haveMail.has(mail))) { l.skipped++; return false; }
            if (no) haveNo.add(no); if (mail) haveMail.add(mail); return true;
          });
          const ins = fresh.map((r) => ({ tenant_id: tenantId, employee_no: pick(r, "Employee ID", "EmployeeID", "Employee Number") || null, first_name: pick(r, "First Name", "Name") || "Employee", last_name: pick(r, "Last Name") || "",
            email: pick(r, "Email ID", "Email address", "Email") || null, phone: pick(r, "Mobile Phone", "Work Phone", "Phone") || null, hire_date: date(pick(r, "Date of Joining", "Date Of Joining", "Joining Date")) || date(pick(r, "Created Time", "Added Time")) || new Date().toISOString().slice(0, 10),
            gender: pick(r, "Gender").toLowerCase() || null, date_of_birth: date(pick(r, "Date of Birth", "Birth Date")), kra_pin: pick(r, "KRA PIN", "PAN", "Tax ID") || null, national_id: pick(r, "National ID", "ID Number") || null,
            basic_salary: num(pick(r, "Basic", "Basic Salary", "Monthly Salary", "CTC")) || 0, status: /terminat|resign|inactive/i.test(pick(r, "Employee Status", "Status")) ? "exited" : "active", notes: pick(r, "Designation", "Title") ? `Designation: ${pick(r, "Designation", "Title")}` : null }));
          for (const c of chunk(ins)) { const { error } = await sb.from("hr_employees").insert(c); if (error) fail(error.message); else l.ok += c.length; }
        }
      } catch (e: any) { fail(e.message || String(e)); }
      push(l);
    }
  // New documents carry on from the old system's numbers (INV000002 → INV000003).
  await sb.rpc("continue_doc_numbers", { p_tenant: tenantId }).then(() => undefined, () => undefined);
  return logs;
}
