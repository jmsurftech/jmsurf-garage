// More report definitions for the report centre: business overview, accountant,
// receivables/payables detail, inventory (warehouses, batches, serials, ageing, ABC) and tax.
import { supabase } from "@/integrations/supabase/client";

const sb: any = supabase;
export type Col = { key: string; label: string; money?: boolean; num?: boolean };
export type Ctx = { tenantId: string; from: string; to: string };
export type Report = { key: string; group: string; label: string; hint: string; dated?: boolean; asOf?: boolean; chart?: { x: string; y: string }; load: (c: Ctx) => Promise<Record<string, any>[]>; cols: Col[]; filters?: string[];
  /** A report with its own screen (period, schedules, exports) instead of the standard table. */
  view?: import("react").ComponentType;
  /** Permission needed to see it, e.g. "reports.taxes". */
  perm?: string };

const n = (v: unknown) => Number(v ?? 0) || 0;
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + n(f(r)), 0);
const byKey = <T,>(rows: T[], key: (r: T) => string) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = key(r) || "—"; m.set(k, [...(m.get(k) || []), r]); } return m; };
const daysBetween = (a: string, b: string) => Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const today = () => new Date().toISOString().slice(0, 10);
const bucket = (days: number) => (days <= 0 ? "Current" : days <= 15 ? "1–15 days" : days <= 30 ? "16–30 days" : days <= 45 ? "31–45 days" : "Over 45 days");
const BUCKETS = ["Current", "1–15 days", "16–30 days", "31–45 days", "Over 45 days"];
const label = (s: string) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Bal = { account_id: string; code: string | null; name: string; type: string; sub_type: string; opening: number; debit: number; credit: number; closing: number };
const balances = async (from: string, to: string) => (((await sb.rpc("acc_balances", { p_from: from, p_to: to })).data || []) as any[]).map((b) => ({ ...b, opening: n(b.opening), debit: n(b.debit), credit: n(b.credit), closing: n(b.closing) })) as Bal[];
const period = (b: Bal) => b.debit - b.credit;
const isCash = (b: { sub_type?: string }) => b.sub_type === "cash" || b.sub_type === "bank";
const accName = (b: Bal) => (b.code ? `${b.code} · ${b.name}` : b.name);

/** P&L numbers from the books for a period. */
function plFrom(bal: Bal[]) {
  const inc = bal.filter((b) => b.type === "income");
  const cogs = bal.filter((b) => b.sub_type === "cost_of_goods_sold");
  const exp = bal.filter((b) => b.type === "expense" && b.sub_type !== "cost_of_goods_sold");
  const income = -sum(inc, period), cost = sum(cogs, period), expenses = sum(exp, period);
  return { inc, cogs, exp, income, cost, gross: income - cost, expenses, net: income - cost - expenses };
}

const ACC_COLS: Col[] = [{ key: "section", label: "Section" }, { key: "account", label: "Account" }, { key: "amount", label: "Amount", money: true }];
const SRC: Record<string, string> = { invoice: "Invoices", bill: "Bills", expense: "Expenses", sale: "POS sales", payment: "Customer payments", supplier_payment: "Supplier payments", manual: "Manual journals", opening: "Opening balances", credit_note: "Credit notes", vendor_credit: "Vendor credits", bank_line: "Bank lines", payroll: "Payroll" };

export const MORE_REPORTS: Report[] = [
  /* ───────── Business overview ───────── */
  { key: "pl", group: "Business overview", label: "Profit and loss", hint: "Income, cost of sales, expenses and net profit from the books.", dated: true, cols: ACC_COLS,
    load: async (c) => {
      const p = plFrom(await balances(c.from, c.to));
      return [
        ...p.inc.filter((b) => period(b)).map((b) => ({ section: "Operating income", account: accName(b), amount: -period(b) })),
        { section: "Total", account: "Total operating income", amount: p.income },
        ...p.cogs.filter((b) => period(b)).map((b) => ({ section: "Cost of goods sold", account: accName(b), amount: period(b) })),
        { section: "Total", account: "Gross profit", amount: p.gross },
        ...p.exp.filter((b) => period(b)).map((b) => ({ section: "Operating expenses", account: accName(b), amount: period(b) })),
        { section: "Total", account: "Total expenses", amount: p.expenses },
        { section: "Total", account: "Net profit / (loss)", amount: p.net },
      ];
    } },
  { key: "bs", group: "Business overview", label: "Balance sheet", hint: "Assets, liabilities and equity at the end date.", dated: true, asOf: true, cols: ACC_COLS,
    load: async (c) => {
      const all = await balances("1900-01-01", c.to);
      const assets = all.filter((b) => b.type === "asset" && b.closing);
      const liab = all.filter((b) => b.type === "liability" && b.closing);
      const eq = all.filter((b) => b.type === "equity" && b.closing);
      const retained = plFrom(all).net;
      const ta = sum(assets, (b) => b.closing), tl = -sum(liab, (b) => b.closing), te = -sum(eq, (b) => b.closing) + retained;
      return [
        ...assets.map((b) => ({ section: `Assets · ${label(b.sub_type)}`, account: accName(b), amount: b.closing })),
        { section: "Total", account: "Total assets", amount: ta },
        ...liab.map((b) => ({ section: `Liabilities · ${label(b.sub_type)}`, account: accName(b), amount: -b.closing })),
        { section: "Total", account: "Total liabilities", amount: tl },
        ...eq.map((b) => ({ section: "Equity", account: accName(b), amount: -b.closing })),
        { section: "Equity", account: "Retained earnings (profit to date)", amount: retained },
        { section: "Total", account: "Total equity", amount: te },
        { section: "Total", account: "Total liabilities and equity", amount: tl + te },
      ];
    } },
  { key: "cashflow", group: "Business overview", label: "Cash flow statement", hint: "Cash and bank at the start, money in and out by source, and at the end.", dated: true, cols: [{ key: "line", label: "Line" }, { key: "inflow", label: "Money in", money: true }, { key: "outflow", label: "Money out", money: true }, { key: "net", label: "Net", money: true }],
    load: async (c) => {
      const bal = (await balances(c.from, c.to)).filter(isCash);
      const ids = bal.map((b) => b.account_id);
      if (!ids.length) return [];
      const lines = ((await sb.from("journal_lines").select("debit,credit,journals!inner(source_type,status)").eq("tenant_id", c.tenantId).in("account_id", ids).gte("line_date", c.from).lte("line_date", c.to).limit(100000)).data || []) as any[];
      const opening = sum(bal, (b) => b.opening);
      const rows = [...byKey(lines, (l) => SRC[l.journals?.source_type] || label(l.journals?.source_type))].map(([k, ls]) => ({ line: k, inflow: sum(ls, (l) => l.debit), outflow: sum(ls, (l) => l.credit), net: sum(ls, (l) => n(l.debit) - n(l.credit)) })).sort((a, b) => b.net - a.net);
      return [{ line: "Cash and bank at the start", inflow: 0, outflow: 0, net: opening }, ...rows, { line: "Cash and bank at the end", inflow: 0, outflow: 0, net: opening + sum(rows, (r) => r.net) }];
    } },
  { key: "ratios", group: "Business overview", label: "Business performance ratios", hint: "Margins, liquidity, debt and how fast customers pay.", dated: true, cols: [{ key: "ratio", label: "Ratio" }, { key: "value", label: "Value" }, { key: "meaning", label: "What it means" }],
    load: async (c) => {
      const [per, all] = await Promise.all([balances(c.from, c.to), balances("1900-01-01", c.to)]);
      const p = plFrom(per);
      const ca = sum(all.filter((b) => b.type === "asset" && b.sub_type !== "fixed_asset"), (b) => b.closing);
      const inv = sum(all.filter((b) => b.sub_type === "inventory"), (b) => b.closing);
      const ar = sum(all.filter((b) => b.sub_type === "accounts_receivable"), (b) => b.closing);
      const cl = -sum(all.filter((b) => b.type === "liability" && b.sub_type !== "long_term_liability"), (b) => b.closing);
      const tl = -sum(all.filter((b) => b.type === "liability"), (b) => b.closing);
      const eq = -sum(all.filter((b) => b.type === "equity"), (b) => b.closing) + plFrom(all).net;
      const days = Math.max(1, daysBetween(c.from, c.to) + 1);
      const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
      const x = (a: number, b: number) => (b ? `${(a / b).toFixed(2)} : 1` : "—");
      return [
        { ratio: "Gross profit margin", value: pct(p.gross, p.income), meaning: "Of every 100 sold, what is left after the cost of the goods." },
        { ratio: "Net profit margin", value: pct(p.net, p.income), meaning: "Of every 100 sold, what is left after all costs." },
        { ratio: "Operating expense ratio", value: pct(p.expenses, p.income), meaning: "Running costs as a share of sales." },
        { ratio: "Current ratio", value: x(ca, cl), meaning: "Short-term assets for every 1 of short-term debts (above 1.5 is comfortable)." },
        { ratio: "Quick ratio", value: x(ca - inv, cl), meaning: "Like the current ratio but without stock." },
        { ratio: "Debt to equity", value: x(tl, eq), meaning: "Borrowed money for every 1 of the owners' money." },
        { ratio: "Days to get paid (DSO)", value: p.income ? `${Math.round((ar / p.income) * days)} days` : "—", meaning: "Average days customers take to pay." },
        { ratio: "Days of stock", value: p.cost ? `${Math.round((inv / p.cost) * days)} days` : "—", meaning: "How long the stock on hand lasts at the current selling pace." },
      ];
    } },

  /* ───────── Accountant ───────── */
  { key: "tb", group: "Accountant", label: "Trial balance", hint: "Debit and credit balance of every account at the end date.", dated: true, asOf: true, cols: [{ key: "account", label: "Account" }, { key: "type", label: "Type" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }],
    load: async (c) => (await balances("1900-01-01", c.to)).filter((b) => Math.abs(b.closing) > 0.004).map((b) => ({ account: accName(b), type: label(b.sub_type), debit: b.closing > 0 ? b.closing : 0, credit: b.closing < 0 ? -b.closing : 0 })) },
  { key: "account_type_summary", group: "Accountant", label: "Account type summary", hint: "Debits, credits and balance per account type for the period.", dated: true, cols: [{ key: "_key", label: "Account type" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }, { key: "closing", label: "Closing", money: true }],
    load: async (c) => [...byKey(await balances(c.from, c.to), (b) => `${label(b.type)} · ${label(b.sub_type)}`)].map(([k, bs]) => ({ _key: k, debit: sum(bs, (b) => b.debit), credit: sum(bs, (b) => b.credit), closing: sum(bs, (b) => b.closing) })).filter((r) => r.debit || r.credit || r.closing) },
  { key: "gl", group: "Accountant", label: "General ledger", hint: "Opening, movements and closing for every account.", dated: true, cols: [{ key: "account", label: "Account" }, { key: "opening", label: "Opening", money: true }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }, { key: "closing", label: "Closing", money: true }],
    load: async (c) => (await balances(c.from, c.to)).filter((b) => b.opening || b.debit || b.credit).map((b) => ({ account: accName(b), opening: b.opening, debit: b.debit, credit: b.credit, closing: b.closing })) },
  { key: "account_transactions", group: "Accountant", label: "Account transactions", hint: "Every debit and credit line, by account (detailed general ledger).", dated: true, cols: [{ key: "account", label: "Account" }, { key: "date", label: "Date" }, { key: "source", label: "Transaction" }, { key: "reference", label: "Reference" }, { key: "description", label: "Details" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }],
    load: async (c) => ((await sb.from("journal_lines").select("line_date,description,debit,credit,chart_of_accounts(code,name),journals!inner(source_type,reference,journal_number)").eq("tenant_id", c.tenantId).gte("line_date", c.from).lte("line_date", c.to).order("line_date").limit(20000)).data || [])
      .map((l: any) => ({ account: l.chart_of_accounts ? `${l.chart_of_accounts.code ? `${l.chart_of_accounts.code} · ` : ""}${l.chart_of_accounts.name}` : "—", date: l.line_date, source: SRC[l.journals?.source_type] || label(l.journals?.source_type), reference: l.journals?.reference || l.journals?.journal_number || "", description: l.description || "", debit: n(l.debit), credit: n(l.credit) }))
      .sort((a: any, b: any) => a.account.localeCompare(b.account) || a.date.localeCompare(b.date)) },
  { key: "journal_report", group: "Accountant", label: "Journal report", hint: "Each journal with its debit and credit lines.", dated: true, cols: [{ key: "date", label: "Date" }, { key: "journal", label: "Journal" }, { key: "source", label: "Type" }, { key: "account", label: "Account" }, { key: "debit", label: "Debit", money: true }, { key: "credit", label: "Credit", money: true }],
    load: async (c) => ((await sb.from("journal_lines").select("line_date,debit,credit,chart_of_accounts(name),journals!inner(source_type,reference,journal_number,id)").eq("tenant_id", c.tenantId).gte("line_date", c.from).lte("line_date", c.to).order("line_date").limit(20000)).data || [])
      .map((l: any) => ({ date: l.line_date, journal: l.journals?.journal_number || l.journals?.reference || String(l.journals?.id || "").slice(0, 8), source: SRC[l.journals?.source_type] || label(l.journals?.source_type), account: l.chart_of_accounts?.name || "—", debit: n(l.debit), credit: n(l.credit) })) },
  { key: "day_book", group: "Accountant", label: "Day book", hint: "Totals posted each day, by transaction type.", dated: true, cols: [{ key: "date", label: "Date" }, { key: "source", label: "Type" }, { key: "entries", label: "Journals", num: true }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => {
      const js = ((await sb.from("journals").select("journal_date,source_type,total").eq("tenant_id", c.tenantId).gte("journal_date", c.from).lte("journal_date", c.to).limit(50000)).data || []) as any[];
      return [...byKey(js, (j) => `${j.journal_date}|${j.source_type}`)].map(([k, rs]) => ({ date: k.split("|")[0], source: SRC[k.split("|")[1]] || label(k.split("|")[1]), entries: rs.length, amount: sum(rs, (r) => r.total) })).sort((a, b) => a.date.localeCompare(b.date));
    } },

  /* ───────── Sales ───────── */
  { key: "sales_summary", group: "Sales", label: "Sales summary", hint: "Sales, cost and profit month by month.", dated: true, chart: { x: "_key", y: "revenue" }, cols: [{ key: "_key", label: "Month" }, { key: "orders", label: "Sales", num: true }, { key: "revenue", label: "Sales value", money: true }, { key: "cost", label: "Cost", money: true }, { key: "profit", label: "Profit", money: true }, { key: "margin", label: "Margin" }],
    load: async (c) => [...byKey(((await sb.rpc("sales_lines", { p_from: c.from, p_to: c.to })).data || []) as any[], (r) => String(r.sale_date).slice(0, 7))]
      .map(([k, rs]) => { const revenue = sum(rs, (r) => r.revenue), cost = sum(rs, (r) => r.cost); return { _key: k, orders: new Set(rs.map((r) => r.ref_id)).size, revenue, cost, profit: revenue - cost, margin: revenue ? `${(((revenue - cost) / revenue) * 100).toFixed(1)}%` : "—" }; })
      .sort((a, b) => a._key.localeCompare(b._key)) },
  { key: "sales_orders", group: "Sales", label: "Sales order details", hint: "Every sales order and whether it has been invoiced.", dated: true, cols: [{ key: "quote_number", label: "Order#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "status", label: "Status" }, { key: "invoiced", label: "Invoiced" }, { key: "expected_shipment_date", label: "Ship by" }, { key: "total", label: "Total", money: true }],
    load: async (c) => ((await sb.from("sales_orders").select("quote_number,issue_date,customer_name,status,invoice_id,expected_shipment_date,total").eq("tenant_id", c.tenantId).gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date")).data || []).map((r: any) => ({ ...r, status: label(r.status), invoiced: r.invoice_id ? "Yes" : "No" })) },
  { key: "packing_history", group: "Sales", label: "Packing and shipment history", hint: "Packages packed and shipped, per order.", dated: true, cols: [{ key: "number", label: "Package#" }, { key: "date", label: "Date" }, { key: "source_number", label: "Order / invoice" }, { key: "customer_name", label: "Customer" }, { key: "status", label: "Status" }, { key: "qty", label: "Qty", num: true }],
    load: async (c) => ((await sb.from("wh_packages").select("number,created_at,source_number,customer_name,status,lines").eq("tenant_id", c.tenantId).gte("created_at", c.from).lte("created_at", `${c.to}T23:59:59`).order("created_at")).data || []).map((p: any) => ({ ...p, date: String(p.created_at).slice(0, 10), status: label(p.status), qty: sum(Array.isArray(p.lines) ? p.lines : [], (l: any) => l.quantity) })) },

  /* ───────── Receivables ───────── */
  { key: "ar_aging_details", group: "Receivables", label: "Receivables ageing details", hint: "Each unpaid invoice with its age bucket.", cols: [{ key: "bucket", label: "Age" }, { key: "invoice_number", label: "Invoice#" }, { key: "customer_name", label: "Customer" }, { key: "issue_date", label: "Date" }, { key: "due_date", label: "Due" }, { key: "days_overdue", label: "Days late", num: true }, { key: "balance", label: "Balance", money: true }],
    load: async (c) => ((await sb.from("debts_view").select("invoice_number,customer_name,issue_date,due_date,days_overdue,balance").eq("tenant_id", c.tenantId).order("days_overdue", { ascending: false })).data || []).map((r: any) => ({ ...r, bucket: bucket(n(r.days_overdue)) })) },
  { key: "ar_aging_customer", group: "Receivables", label: "Receivables ageing by customer", hint: "What each customer owes, split by how late.", chart: { x: "_key", y: "total" }, cols: [{ key: "_key", label: "Customer" }, ...BUCKETS.map((b) => ({ key: b, label: b, money: true })), { key: "total", label: "Total", money: true }],
    load: async (c) => [...byKey(((await sb.from("debts_view").select("customer_name,days_overdue,balance").eq("tenant_id", c.tenantId)).data || []) as any[], (r) => r.customer_name)]
      .map(([k, rs]) => ({ _key: k, ...Object.fromEntries(BUCKETS.map((b) => [b, sum(rs.filter((r) => bucket(n(r.days_overdue)) === b), (r) => r.balance)])), total: sum(rs, (r) => r.balance) })).sort((a: any, b: any) => b.total - a.total) },
  { key: "refunds", group: "Receivables", label: "Refund history", hint: "Money refunded to customers from credit notes.", dated: true, cols: [{ key: "credit_note_number", label: "Credit note#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "refund_method", label: "Method" }, { key: "refund_reference", label: "Reference" }, { key: "amount_refunded", label: "Refunded", money: true }],
    load: async (c) => (await sb.from("credit_notes").select("credit_note_number,issue_date,customer_name,refund_method,refund_reference,amount_refunded").eq("tenant_id", c.tenantId).gt("amount_refunded", 0).gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date")).data || [] },

  /* ───────── Payables & purchases ───────── */
  { key: "ap_aging", group: "Payables & purchases", label: "Payables ageing summary", hint: "What you owe suppliers, split by how late.", chart: { x: "_key", y: "total" }, cols: [{ key: "_key", label: "Supplier" }, ...BUCKETS.map((b) => ({ key: b, label: b, money: true })), { key: "total", label: "Total", money: true }],
    load: async (c) => {
      const bills = ((await sb.from("bills").select("amount,amount_paid,due_date,bill_date,suppliers(name)").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void,paid)")).data || []) as any[];
      const t = today();
      const open = bills.map((b) => ({ s: b.suppliers?.name || "—", bal: n(b.amount) - n(b.amount_paid), b: bucket(daysBetween(b.due_date || b.bill_date || t, t)) })).filter((b) => b.bal > 0.004);
      return [...byKey(open, (b) => b.s)].map(([k, rs]) => ({ _key: k, ...Object.fromEntries(BUCKETS.map((x) => [x, sum(rs.filter((r) => r.b === x), (r) => r.bal)])), total: sum(rs, (r) => r.bal) })).sort((a: any, b: any) => b.total - a.total);
    } },
  { key: "ap_aging_details", group: "Payables & purchases", label: "Payables ageing details", hint: "Each unpaid bill with its age.", cols: [{ key: "bucket", label: "Age" }, { key: "bill_number", label: "Bill#" }, { key: "supplier", label: "Supplier" }, { key: "bill_date", label: "Date" }, { key: "due_date", label: "Due" }, { key: "days", label: "Days late", num: true }, { key: "balance", label: "Balance", money: true }],
    load: async (c) => {
      const t = today();
      return (((await sb.from("bills").select("bill_number,name,bill_date,due_date,amount,amount_paid,suppliers(name)").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void,paid)")).data || []) as any[])
        .map((b) => { const days = Math.max(0, daysBetween(b.due_date || b.bill_date || t, t)); return { bill_number: b.bill_number || b.name, supplier: b.suppliers?.name || "—", bill_date: b.bill_date, due_date: b.due_date, days, bucket: bucket(days), balance: n(b.amount) - n(b.amount_paid) }; })
        .filter((b) => b.balance > 0.004).sort((a, b) => b.days - a.days);
    } },
  { key: "bill_details", group: "Payables & purchases", label: "Bill details", hint: "Every supplier bill with what is still owed.", dated: true, cols: [{ key: "bill_number", label: "Bill#" }, { key: "bill_date", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "status", label: "Status" }, { key: "due_date", label: "Due" }, { key: "amount", label: "Total", money: true }, { key: "balance", label: "Balance", money: true }],
    load: async (c) => ((await sb.from("bills").select("bill_number,name,bill_date,status,due_date,amount,amount_paid,suppliers(name)").eq("tenant_id", c.tenantId).gte("bill_date", c.from).lte("bill_date", c.to).order("bill_date")).data || []).map((b: any) => ({ ...b, bill_number: b.bill_number || b.name, supplier: b.suppliers?.name || "—", status: label(b.status), balance: n(b.amount) - n(b.amount_paid) })) },
  { key: "vendor_credits", group: "Payables & purchases", label: "Vendor credit details", hint: "Credits from suppliers, applied and refunded.", dated: true, cols: [{ key: "credit_number", label: "Credit#" }, { key: "credit_date", label: "Date" }, { key: "supplier_name", label: "Supplier" }, { key: "reason", label: "Reason" }, { key: "amount", label: "Amount", money: true }, { key: "amount_applied", label: "Applied", money: true }, { key: "left", label: "Left", money: true }],
    load: async (c) => ((await sb.from("vendor_credits").select("*").eq("tenant_id", c.tenantId).neq("status", "void").gte("credit_date", c.from).lte("credit_date", c.to).order("credit_date")).data || []).map((v: any) => ({ ...v, left: n(v.amount) - n(v.amount_applied) - n(v.amount_refunded) })) },
  { key: "po_details", group: "Payables & purchases", label: "Purchase order details", hint: "Every purchase order: received and billed or not.", dated: true, cols: [{ key: "po_number", label: "PO#" }, { key: "order_date", label: "Date" }, { key: "supplier_name", label: "Supplier" }, { key: "status", label: "Status" }, { key: "billed", label: "Billed" }, { key: "expected_date", label: "Expected" }, { key: "total", label: "Total", money: true }],
    load: async (c) => ((await sb.from("purchases").select("po_number,order_date,supplier_name,status,billed,expected_date,total").eq("tenant_id", c.tenantId).gte("order_date", c.from).lte("order_date", c.to).order("order_date")).data || []).map((p: any) => ({ ...p, status: label(p.status), billed: p.billed ? "Yes" : "No" })) },
  { key: "receive_history", group: "Payables & purchases", label: "Purchase receive history", hint: "Goods received per receive, with batches and serial numbers.", dated: true, cols: [{ key: "receive_number", label: "Receive#" }, { key: "received_date", label: "Date" }, { key: "supplier_name", label: "Supplier" }, { key: "item", label: "Item" }, { key: "quantity", label: "Qty", num: true }, { key: "batches", label: "Batches" }, { key: "serials", label: "Serials", num: true }],
    load: async (c) => ((await sb.from("purchase_receives").select("receive_number,received_date,created_at,supplier_name,items").eq("tenant_id", c.tenantId).gte("created_at", c.from).lte("created_at", `${c.to}T23:59:59`).order("created_at")).data || [])
      .flatMap((r: any) => (Array.isArray(r.items) ? r.items : []).map((i: any) => ({ receive_number: r.receive_number, received_date: r.received_date || String(r.created_at).slice(0, 10), supplier_name: r.supplier_name, item: i.name, quantity: n(i.quantity),
        batches: (Array.isArray(i.lots) && i.lots.length ? i.lots.map((l: any) => `${l.batch || "—"}${l.qty ? ` × ${l.qty}` : ""}`) : i.batch_number ? [i.batch_number] : []).join(", "), serials: Array.isArray(i.serials) ? i.serials.length : 0 }))) },

  /* ───────── Inventory ───────── */
  { key: "stock_by_warehouse", group: "Inventory", label: "Stock by warehouse", hint: "Stock on hand of every item in every branch / warehouse.", filters: ["category"], cols: [{ key: "item", label: "Item" }, { key: "category", label: "Category" }, { key: "warehouse", label: "Warehouse" }, { key: "stock", label: "In stock", num: true }, { key: "value", label: "Value at cost", money: true }],
    load: async (c) => {
      const [st, locs] = await Promise.all([
        sb.from("product_stocks").select("stock,location_id,products!inner(name,category,cost_price,tenant_id,is_active)").eq("products.tenant_id", c.tenantId).eq("products.is_active", true).neq("stock", 0).limit(50000),
        sb.from("locations").select("id,name").eq("tenant_id", c.tenantId),
      ]);
      const ln = Object.fromEntries(((locs.data || []) as any[]).map((l) => [l.id, l.name]));
      return ((st.data || []) as any[]).map((s) => ({ item: s.products?.name, category: s.products?.category, warehouse: ln[s.location_id] || "—", stock: n(s.stock), value: n(s.stock) * n(s.products?.cost_price) })).sort((a, b) => String(a.item).localeCompare(String(b.item)));
    } },
  { key: "batch_details", group: "Inventory", label: "Batch details", hint: "Every batch in stock with expiry, warehouse, cost and value.", filters: ["category"], chart: { x: "item", y: "quantity" }, cols: [{ key: "item", label: "Item" }, { key: "batch", label: "Batch" }, { key: "expiry", label: "Expiry" }, { key: "state", label: "State" }, { key: "warehouse", label: "Warehouse" }, { key: "received", label: "Received" }, { key: "quantity", label: "Qty", num: true }, { key: "value", label: "Value at cost", money: true }],
    load: async (c) => {
      const t = today(), in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const [b, locs] = await Promise.all([
        sb.from("product_batches").select("batch_number,expiry_date,received_at,quantity,unit_cost,location_id,products(name,category,cost_price)").eq("tenant_id", c.tenantId).gt("quantity", 0).order("expiry_date", { ascending: true, nullsFirst: false }).limit(50000),
        sb.from("locations").select("id,name").eq("tenant_id", c.tenantId),
      ]);
      const ln = Object.fromEntries(((locs.data || []) as any[]).map((l) => [l.id, l.name]));
      return ((b.data || []) as any[]).map((x) => ({ item: x.products?.name, category: x.products?.category, batch: x.batch_number || "—", expiry: x.expiry_date || "—", state: !x.expiry_date ? "No expiry" : x.expiry_date < t ? "Expired" : x.expiry_date <= in90 ? "Expires within 90 days" : "Good", warehouse: ln[x.location_id] || "—", received: String(x.received_at || "").slice(0, 10), quantity: n(x.quantity), value: n(x.quantity) * n(x.unit_cost ?? x.products?.cost_price) }));
    } },
  { key: "batch_sales", group: "Inventory", label: "Batch sales (traceability)", hint: "Which customers received which batch, from invoices.", dated: true, cols: [{ key: "batch", label: "Batch" }, { key: "expiry", label: "Expiry" }, { key: "item", label: "Item" }, { key: "invoice_number", label: "Invoice#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "qty", label: "Qty", num: true }],
    load: async (c) => {
      const [inv, prods] = await Promise.all([
        sb.from("invoices").select("invoice_number,issue_date,customer_name,lots_applied").eq("tenant_id", c.tenantId).not("lots_applied", "is", null).gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date").limit(10000),
        sb.from("products").select("id,name").eq("tenant_id", c.tenantId).limit(20000),
      ]);
      const pn = Object.fromEntries(((prods.data || []) as any[]).map((p) => [p.id, p.name]));
      return ((inv.data || []) as any[]).flatMap((i) => (Array.isArray(i.lots_applied) ? i.lots_applied : []).map((l: any) => ({ batch: l.batch || "—", expiry: l.expiry || "—", item: pn[l.product_id] || "Item", invoice_number: i.invoice_number, issue_date: i.issue_date, customer_name: i.customer_name, qty: n(l.qty) })))
        .sort((a: any, b: any) => String(a.batch).localeCompare(String(b.batch)));
    } },
  { key: "serials", group: "Inventory", label: "Serial number report", hint: "Every serial number: in stock, sold to whom, received on which document.", cols: [{ key: "serial_number", label: "Serial#" }, { key: "item", label: "Item" }, { key: "status", label: "Status" }, { key: "batch_number", label: "Batch" }, { key: "received", label: "Received" }, { key: "received_ref_number", label: "Received on" }, { key: "invoice_number", label: "Invoice#" }, { key: "customer_name", label: "Customer" }],
    load: async (c) => ((await sb.from("product_serials").select("serial_number,status,batch_number,received_at,received_ref_number,invoice_number,customer_name,products(name)").eq("tenant_id", c.tenantId).order("serial_number").limit(50000)).data || []).map((s: any) => ({ ...s, item: s.products?.name, status: label(s.status), received: String(s.received_at || "").slice(0, 10) })) },
  { key: "inventory_aging", group: "Inventory", label: "Inventory ageing", hint: "How long stock has been sitting, by batch received date.", chart: { x: "_key", y: "value" }, cols: [{ key: "_key", label: "Age" }, { key: "batches", label: "Batches", num: true }, { key: "quantity", label: "Qty", num: true }, { key: "value", label: "Value at cost", money: true }],
    load: async (c) => {
      const b = ((await sb.from("product_batches").select("received_at,quantity,unit_cost,products(cost_price)").eq("tenant_id", c.tenantId).gt("quantity", 0).limit(50000)).data || []) as any[];
      const t = today();
      const age = (d: number) => (d <= 30 ? "1. 0–30 days" : d <= 60 ? "2. 31–60 days" : d <= 90 ? "3. 61–90 days" : d <= 180 ? "4. 91–180 days" : "5. Over 180 days");
      return [...byKey(b, (x) => age(daysBetween(String(x.received_at || t).slice(0, 10), t)))].map(([k, rs]) => ({ _key: k, batches: rs.length, quantity: sum(rs, (r) => r.quantity), value: sum(rs, (r) => n(r.quantity) * n(r.unit_cost ?? r.products?.cost_price)) })).sort((a, b) => a._key.localeCompare(b._key));
    } },
  { key: "abc", group: "Inventory", label: "ABC classification", hint: "A = the items making 80% of sales, B = the next 15%, C = the rest.", dated: true, chart: { x: "_key", y: "revenue" }, cols: [{ key: "_key", label: "Item" }, { key: "class", label: "Class" }, { key: "qty", label: "Qty sold", num: true }, { key: "revenue", label: "Sales", money: true }, { key: "share", label: "Share" }, { key: "cumulative", label: "Cumulative" }],
    load: async (c) => {
      const rows = [...byKey(((await sb.rpc("sales_lines", { p_from: c.from, p_to: c.to })).data || []) as any[], (r) => r.item_name)].map(([k, rs]) => ({ _key: k, qty: sum(rs, (r) => r.qty), revenue: sum(rs, (r) => r.revenue) })).sort((a, b) => b.revenue - a.revenue);
      const total = sum(rows, (r) => r.revenue) || 1;
      let run = 0;
      return rows.map((r) => { run += r.revenue; const cum = run / total; return { ...r, class: cum <= 0.8 + 1e-9 ? "A" : cum <= 0.95 + 1e-9 ? "B" : "C", share: `${((r.revenue / total) * 100).toFixed(1)}%`, cumulative: `${(cum * 100).toFixed(1)}%` }; });
    } },
  { key: "committed_stock", group: "Inventory", label: "Committed and incoming stock", hint: "Stock on hand, promised on open sales orders, coming on open purchase orders, and free to sell.", filters: ["category"], cols: [{ key: "item", label: "Item" }, { key: "category", label: "Category" }, { key: "on_hand", label: "On hand", num: true }, { key: "committed", label: "Committed", num: true }, { key: "available", label: "Available", num: true }, { key: "incoming", label: "Incoming", num: true }],
    load: async (c) => {
      const [prods, so, po] = await Promise.all([
        sb.from("products").select("id,name,category,stock").eq("tenant_id", c.tenantId).eq("is_active", true).limit(20000),
        sb.from("sales_orders").select("items,status,invoice_id").eq("tenant_id", c.tenantId).is("invoice_id", null).not("status", "in", "(draft,void,cancelled,declined,invoiced,closed)").limit(10000),
        sb.from("purchase_items").select("product_id,quantity,received_quantity,cancelled_quantity,purchases!inner(tenant_id,status)").eq("purchases.tenant_id", c.tenantId).not("purchases.status", "in", "(draft,cancelled,received)").limit(50000),
      ]);
      const committed = new Map<string, number>(), incoming = new Map<string, number>();
      for (const o of (so.data || []) as any[]) for (const l of Array.isArray(o.items) ? o.items : []) { const id = l.item_id || l.product_id; if (id) committed.set(id, (committed.get(id) || 0) + n(l.quantity)); }
      for (const p of (po.data || []) as any[]) incoming.set(p.product_id, (incoming.get(p.product_id) || 0) + Math.max(0, n(p.quantity) - n(p.received_quantity) - n(p.cancelled_quantity)));
      return ((prods.data || []) as any[]).map((p) => ({ item: p.name, category: p.category, on_hand: n(p.stock), committed: committed.get(p.id) || 0, available: n(p.stock) - (committed.get(p.id) || 0), incoming: incoming.get(p.id) || 0 }))
        .filter((r) => r.on_hand || r.committed || r.incoming).sort((a, b) => a.available - b.available);
    } },
  { key: "adjustment_details", group: "Inventory", label: "Inventory adjustment details", hint: "Stock counted, damaged, written off or corrected by hand.", dated: true, cols: [{ key: "date", label: "Date" }, { key: "item", label: "Item" }, { key: "reason", label: "Reason" }, { key: "batch_number", label: "Batch" }, { key: "quantity_change", label: "Change", num: true }, { key: "stock_after", label: "After", num: true }],
    load: async (c) => ((await sb.from("stock_adjustments").select("created_at,quantity_change,stock_after,reason,batch_number,products(name)").eq("tenant_id", c.tenantId).not("reason", "in", "(sale,return,purchase_received)").is("ref_type", null).gte("created_at", c.from).lte("created_at", `${c.to}T23:59:59`).order("created_at").limit(20000)).data || [])
      .map((r: any) => ({ date: String(r.created_at).slice(0, 10), item: r.products?.name, reason: label(r.reason), batch_number: r.batch_number || "", quantity_change: n(r.quantity_change), stock_after: n(r.stock_after) })) },

  /* ───────── Taxes ───────── */
  { key: "vat_by_rate", group: "Taxes", label: "VAT by rate", hint: "Taxable sales and VAT for each rate (16%, 8%, zero / exempt).", dated: true, cols: [{ key: "_key", label: "Rate" }, { key: "lines", label: "Lines", num: true }, { key: "taxable", label: "Taxable amount", money: true }, { key: "vat", label: "VAT", money: true }],
    load: async (c) => {
      const inv = ((await sb.from("invoices").select("items").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void)").gte("issue_date", c.from).lte("issue_date", c.to).limit(20000)).data || []) as any[];
      const ls = inv.flatMap((i) => (Array.isArray(i.items) ? i.items : []).map((l: any) => { const amt = l.amount !== undefined ? n(l.amount) : n(l.quantity) * n(l.rate ?? l.price) * (1 - n(l.discount) / 100); return { rate: n(l.tax_rate ?? l.vat_rate), amt }; }));
      return [...byKey(ls, (l) => (l.rate ? `VAT ${l.rate}%` : "Zero-rated / exempt"))].map(([k, rs]) => ({ _key: k, lines: rs.length, taxable: sum(rs, (r) => r.amt), vat: sum(rs, (r) => (r.amt * r.rate) / 100) })).sort((a, b) => b.vat - a.vat);
    } },
];
