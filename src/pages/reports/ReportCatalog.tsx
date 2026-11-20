import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import {
  BarChart3, Boxes, HandCoins, Truck, Wallet, Percent, Users, Search, ArrowLeft, Star, FileSpreadsheet, Printer, Table2, ChevronRight, Scale, BookText,
} from "lucide-react";
import { MORE_REPORTS, type Col, type Ctx, type Report } from "./moreReports";
import { HR_REPORTS } from "./hrReports";
import { VatReturnReport, WhtCertificatesReport } from "./VatReturn";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Button } from "@/components/ui/button";
import { Panel, EmptyState, TableWrap } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import ImportExport from "@/components/ImportExport";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
function group<T>(rows: T[], key: (r: T) => string, agg: (rs: T[]) => Record<string, any>) {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r) || "—"; m.set(k, [...(m.get(k) || []), r]); }
  return [...m.entries()].map(([k, rs]) => ({ _key: k, ...agg(rs) }));
}
async function lines(c: Ctx) { return ((await sb.rpc("sales_lines", { p_from: c.from, p_to: c.to })).data || []) as any[]; }
const salesAgg = (rs: any[]) => ({ qty: sum(rs, (r) => r.qty), revenue: sum(rs, (r) => r.revenue), cost: sum(rs, (r) => r.cost), profit: sum(rs, (r) => r.revenue - r.cost), orders: new Set(rs.map((r) => r.ref_id)).size });
const SALES_COLS = (first: string): Col[] => [{ key: "_key", label: first }, { key: "qty", label: "Qty", num: true }, { key: "orders", label: "Orders", num: true }, { key: "revenue", label: "Sales", money: true }, { key: "cost", label: "Cost", money: true }, { key: "profit", label: "Profit", money: true }];

const REPORTS: Report[] = [
  // Sales
  { key: "sales_item", group: "Sales", label: "Sales by item", hint: "Quantity, sales and profit for every product and service.", dated: true, chart: { x: "_key", y: "revenue" }, filters: ["category"], cols: SALES_COLS("Item"),
    load: async (c) => group(await lines(c), (r) => r.item_name, salesAgg).sort((a: any, b: any) => b.revenue - a.revenue) },
  { key: "sales_category", group: "Sales", label: "Sales by category", hint: "Which categories sell best.", dated: true, chart: { x: "_key", y: "revenue" }, cols: SALES_COLS("Category"),
    load: async (c) => group(await lines(c), (r) => r.category, salesAgg).sort((a: any, b: any) => b.revenue - a.revenue) },
  { key: "sales_customer", group: "Sales", label: "Sales by customer", hint: "What each customer bought.", dated: true, chart: { x: "_key", y: "revenue" }, cols: SALES_COLS("Customer"),
    load: async (c) => group(await lines(c), (r) => r.customer_name || "Walk-in", salesAgg).sort((a: any, b: any) => b.revenue - a.revenue) },
  { key: "sales_rep", group: "Sales", label: "Sales by sales rep", hint: "Sales and profit per rep (for commission).", dated: true, chart: { x: "_key", y: "revenue" }, cols: SALES_COLS("Sales rep"),
    load: async (c) => group(await lines(c), (r) => r.rep_name || "No rep", salesAgg).sort((a: any, b: any) => b.revenue - a.revenue) },
  { key: "sales_payment", group: "Sales", label: "Sales by payment method", hint: "Cash, M-Pesa, card (PDQ), credit…", dated: true, chart: { x: "_key", y: "revenue" }, cols: SALES_COLS("Paid by"),
    load: async (c) => group(await lines(c), (r) => r.payment_method, salesAgg) },
  { key: "sales_day", group: "Sales", label: "Sales by day", hint: "Daily sales and profit.", dated: true, chart: { x: "_key", y: "revenue" }, cols: SALES_COLS("Date"),
    load: async (c) => group(await lines(c), (r) => r.sale_date, salesAgg).sort((a: any, b: any) => a._key.localeCompare(b._key)) },
  { key: "invoices", group: "Sales", label: "Invoice details", hint: "Every invoice with what is still owed.", dated: true, cols: [{ key: "invoice_number", label: "Invoice#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "status", label: "Status" }, { key: "total", label: "Total", money: true }, { key: "balance", label: "Balance", money: true }],
    load: async (c) => ((await sb.from("invoices").select("invoice_number,issue_date,customer_name,status,total,amount_paid").eq("tenant_id", c.tenantId).gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date")).data || []).map((i: any) => ({ ...i, balance: Number(i.total) - Number(i.amount_paid) })) },
  { key: "quotes", group: "Sales", label: "Quotation details", hint: "Quotes sent and how many were won.", dated: true, cols: [{ key: "quote_number", label: "Quote#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "status", label: "Status" }, { key: "total", label: "Total", money: true }],
    load: async (c) => (await sb.from("quotes").select("quote_number,issue_date,customer_name,status,total").eq("tenant_id", c.tenantId).gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date")).data || [] },
  { key: "credit_notes", group: "Sales", label: "Credit note details", hint: "Credits given, applied and refunded.", dated: true, cols: [{ key: "credit_note_number", label: "Credit note#" }, { key: "issue_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "reason", label: "Reason" }, { key: "total", label: "Total", money: true }, { key: "amount_applied", label: "Applied", money: true }, { key: "amount_refunded", label: "Refunded", money: true }],
    load: async (c) => (await sb.from("credit_notes").select("*").eq("tenant_id", c.tenantId).neq("status", "void").gte("issue_date", c.from).lte("issue_date", c.to).order("issue_date")).data || [] },
  // Inventory
  { key: "stock_summary", group: "Inventory", label: "Stock summary", hint: "Stock on hand for every product. Filter to in-stock, low or out.", filters: ["category", "stock"], chart: { x: "name", y: "stock" }, cols: [{ key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "stock", label: "In stock", num: true }, { key: "reorder_level", label: "Reorder at", num: true }, { key: "state", label: "State" }],
    load: async (c) => ((await sb.from("products").select("name,category,stock,reorder_level").eq("tenant_id", c.tenantId).eq("is_active", true).order("name").limit(10000)).data || []).map((p: any) => ({ ...p, stock: Number(p.stock), state: Number(p.stock) <= 0 ? "Out of stock" : Number(p.stock) <= Number(p.reorder_level) ? "Low" : "In stock" })) },
  { key: "valuation", group: "Inventory", label: "Inventory valuation", hint: "What the stock is worth at cost and at selling price.", filters: ["category"], chart: { x: "name", y: "cost_value" }, cols: [{ key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "stock", label: "Qty", num: true }, { key: "cost_price", label: "Cost", money: true }, { key: "cost_value", label: "Value at cost", money: true }, { key: "sell_value", label: "Value at price", money: true }],
    load: async (c) => ((await sb.from("products").select("name,category,stock,cost_price,price").eq("tenant_id", c.tenantId).eq("is_active", true).gt("stock", 0).order("name").limit(10000)).data || []).map((p: any) => ({ ...p, cost_value: Number(p.stock) * Number(p.cost_price), sell_value: Number(p.stock) * Number(p.price) })) },
  { key: "movements", group: "Inventory", label: "Stock movements", hint: "Every stock change: sales, receives, counts, transfers.", dated: true, cols: [{ key: "date", label: "Date" }, { key: "item", label: "Item" }, { key: "reason", label: "Why" }, { key: "quantity_change", label: "Change", num: true }, { key: "stock_after", label: "After", num: true }],
    load: async (c) => ((await sb.from("stock_adjustments").select("created_at,quantity_change,stock_after,reason,products(name,tenant_id)").gte("created_at", c.from).lte("created_at", `${c.to}T23:59:59`).order("created_at", { ascending: false }).limit(5000)).data || []).filter((r: any) => r.products?.tenant_id === c.tenantId).map((r: any) => ({ date: r.created_at.slice(0, 10), item: r.products?.name, reason: String(r.reason || "").replace(/_/g, " "), quantity_change: Number(r.quantity_change), stock_after: Number(r.stock_after) })) },
  // Receivables
  { key: "ar_balances", group: "Receivables", label: "Customer balances", hint: "Who owes what, and how late.", chart: { x: "_key", y: "balance" }, cols: [{ key: "_key", label: "Customer" }, { key: "invoices", label: "Invoices", num: true }, { key: "balance", label: "Balance", money: true }, { key: "overdue", label: "Overdue", money: true }],
    load: async (c) => group(((await sb.from("debts_view").select("*").eq("tenant_id", c.tenantId)).data || []) as any[], (r) => r.customer_name, (rs) => ({ invoices: rs.length, balance: sum(rs, (r) => r.balance), overdue: sum(rs.filter((r) => Number(r.days_overdue) > 0), (r) => r.balance) })).sort((a: any, b: any) => b.balance - a.balance) },
  { key: "ar_aging", group: "Receivables", label: "Receivables ageing", hint: "Unpaid balances by how many days late.", chart: { x: "_key", y: "amount" }, cols: [{ key: "_key", label: "Age" }, { key: "count", label: "Invoices", num: true }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => { const d = ((await sb.from("debts_view").select("*").eq("tenant_id", c.tenantId)).data || []) as any[]; const b = (x: number) => (x <= 0 ? "1. Not due" : x <= 30 ? "2. 1–30 days" : x <= 60 ? "3. 31–60 days" : x <= 90 ? "4. 61–90 days" : "5. Over 90 days"); return group(d, (r) => b(Number(r.days_overdue)), (rs) => ({ count: rs.length, amount: sum(rs, (r) => r.balance) })).sort((a: any, b2: any) => a._key.localeCompare(b2._key)); } },
  { key: "payments_received", group: "Receivables", label: "Payments received", hint: "Money customers paid, by method.", dated: true, cols: [{ key: "payment_number", label: "Payment#" }, { key: "payment_date", label: "Date" }, { key: "customer_name", label: "Customer" }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => (await sb.from("payments_received").select("*").eq("tenant_id", c.tenantId).gte("payment_date", c.from).lte("payment_date", c.to).order("payment_date")).data || [] },
  // Payables
  { key: "ap_balances", group: "Payables & purchases", label: "Supplier balances", hint: "What you owe each supplier.", chart: { x: "_key", y: "balance" }, cols: [{ key: "_key", label: "Supplier" }, { key: "bills", label: "Bills", num: true }, { key: "balance", label: "Owed", money: true }],
    load: async (c) => group(((await sb.from("bills").select("amount,amount_paid,status,suppliers(name)").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void,paid)")).data || []) as any[], (r) => r.suppliers?.name || "—", (rs) => ({ bills: rs.length, balance: sum(rs, (r) => Number(r.amount) - Number(r.amount_paid)) })).sort((a: any, b: any) => b.balance - a.balance) },
  { key: "purchases_supplier", group: "Payables & purchases", label: "Purchases by supplier", hint: "Purchase orders per supplier.", dated: true, chart: { x: "_key", y: "total" }, cols: [{ key: "_key", label: "Supplier" }, { key: "orders", label: "Orders", num: true }, { key: "total", label: "Amount", money: true }],
    load: async (c) => group(((await sb.from("purchases").select("supplier_name,total,status,order_date").eq("tenant_id", c.tenantId).neq("status", "cancelled").gte("order_date", c.from).lte("order_date", c.to)).data || []) as any[], (r) => r.supplier_name, (rs) => ({ orders: rs.length, total: sum(rs, (r) => r.total) })).sort((a: any, b: any) => b.total - a.total) },
  { key: "purchases_item", group: "Payables & purchases", label: "Purchases by item", hint: "Quantities and cost bought per product.", dated: true, chart: { x: "_key", y: "total" }, cols: [{ key: "_key", label: "Item" }, { key: "qty", label: "Ordered", num: true }, { key: "received", label: "Received", num: true }, { key: "total", label: "Cost", money: true }],
    load: async (c) => group(((await sb.from("purchase_items").select("quantity,received_quantity,total,products(name),purchases!inner(tenant_id,order_date,status)").eq("purchases.tenant_id", c.tenantId).gte("purchases.order_date", c.from).lte("purchases.order_date", c.to)).data || []) as any[], (r) => r.products?.name, (rs) => ({ qty: sum(rs, (r) => r.quantity), received: sum(rs, (r) => r.received_quantity), total: sum(rs, (r) => r.total) })).sort((a: any, b: any) => b.total - a.total) },
  { key: "payments_made", group: "Payables & purchases", label: "Payments made", hint: "Money paid to suppliers.", dated: true, cols: [{ key: "paid_on", label: "Date" }, { key: "supplier", label: "Supplier" }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => ((await sb.from("supplier_payments").select("paid_on,method,reference,amount,suppliers(name)").eq("tenant_id", c.tenantId).gte("paid_on", c.from).lte("paid_on", c.to).order("paid_on")).data || []).map((r: any) => ({ ...r, supplier: r.suppliers?.name })) },
  // Expenses
  { key: "expense_category", group: "Expenses", label: "Expenses by category", hint: "Running costs grouped.", dated: true, chart: { x: "_key", y: "amount" }, cols: [{ key: "_key", label: "Category" }, { key: "count", label: "Entries", num: true }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => group(((await sb.from("expenses").select("category_name,amount,expense_date").eq("tenant_id", c.tenantId).gte("expense_date", c.from).lte("expense_date", c.to)).data || []) as any[], (r) => r.category_name, (rs) => ({ count: rs.length, amount: sum(rs, (r) => r.amount) })).sort((a: any, b: any) => b.amount - a.amount) },
  { key: "expense_details", group: "Expenses", label: "Expense details", hint: "Every expense in the period.", dated: true, cols: [{ key: "expense_date", label: "Date" }, { key: "category_name", label: "Category" }, { key: "description", label: "Description" }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => (await sb.from("expenses").select("expense_date,category_name,description,amount").eq("tenant_id", c.tenantId).gte("expense_date", c.from).lte("expense_date", c.to).order("expense_date")).data || [] },
  // Taxes
  { key: "vat3", group: "Taxes", label: "VAT return (VAT3)", hint: "KRA monthly VAT return: output and input VAT by rate, withholding VAT, and the iTax sales and purchases schedules.", perm: "reports.taxes", view: VatReturnReport, cols: [], load: async () => [] },
  { key: "wht_vat", group: "Taxes", label: "Withholding VAT certificates", hint: "VAT customers withheld, by customer and month, and which certificates you have received.", perm: "reports.taxes", view: WhtCertificatesReport, cols: [], load: async () => [] },
  { key: "vat", group: "Taxes", label: "VAT summary", hint: "VAT on sales and on supplier bills for the period (for KRA iTax).", dated: true, cols: [{ key: "_key", label: "Line" }, { key: "amount", label: "Amount", money: true }],
    load: async (c) => {
      const [tx, inv, bills] = await Promise.all([
        sb.from("transactions").select("tax,total").eq("tenant_id", c.tenantId).eq("status", "completed").gte("created_at", c.from).lte("created_at", `${c.to}T23:59:59`).limit(50000),
        sb.from("invoices").select("tax,source").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void)").neq("source", "pos").gte("issue_date", c.from).lte("issue_date", c.to),
        sb.from("bills").select("tax").eq("tenant_id", c.tenantId).not("status", "in", "(draft,void)").gte("bill_date", c.from).lte("bill_date", c.to),
      ]);
      const out = sum((tx.data || []) as any[], (r) => r.tax) + sum((inv.data || []) as any[], (r) => r.tax);
      const input = sum((bills.data || []) as any[], (r) => r.tax);
      return [{ _key: "Output VAT (sales)", amount: out }, { _key: "Input VAT (purchases)", amount: input }, { _key: "VAT payable", amount: out - input }];
    } },
  // HR
  { key: "payroll", group: "Payroll & HR", label: "Payroll summary", hint: "Gross, PAYE, NSSF, SHIF, Housing Levy and net by month.", chart: { x: "period", y: "net" }, cols: [{ key: "period", label: "Month" }, { key: "status", label: "Status" }, { key: "gross", label: "Gross", money: true }, { key: "paye", label: "PAYE", money: true }, { key: "nssf", label: "NSSF", money: true }, { key: "shif", label: "SHIF", money: true }, { key: "housing", label: "Housing Levy", money: true }, { key: "net", label: "Net", money: true }],
    load: async (c) => ((await sb.from("hr_payroll_runs").select("period,status,totals").eq("tenant_id", c.tenantId).order("period")).data || []).map((r: any) => ({ period: r.period, status: r.status, ...r.totals })) },
  { key: "leave", group: "Payroll & HR", label: "Leave taken", hint: "Approved leave days by employee and type.", dated: true, cols: [{ key: "_key", label: "Employee" }, { key: "requests", label: "Requests", num: true }, { key: "days", label: "Days", num: true }],
    load: async (c) => group(((await sb.from("hr_leave_requests").select("days,start_date,status,hr_employees(first_name,last_name)").eq("tenant_id", c.tenantId).eq("status", "approved").gte("start_date", c.from).lte("start_date", c.to)).data || []) as any[], (r) => `${r.hr_employees?.first_name || ""} ${r.hr_employees?.last_name || ""}`.trim(), (rs) => ({ requests: rs.length, days: sum(rs, (r) => r.days) })) },
  { key: "attendance", group: "Payroll & HR", label: "Attendance summary", hint: "Days present, absent and overtime per employee.", dated: true, cols: [{ key: "_key", label: "Employee" }, { key: "present", label: "Present", num: true }, { key: "late", label: "Late", num: true }, { key: "absent", label: "Absent", num: true }, { key: "overtime", label: "Overtime h", num: true }],
    load: async (c) => group(((await sb.from("hr_attendance").select("status,overtime_hours,date,hr_employees(first_name,last_name)").eq("tenant_id", c.tenantId).gte("date", c.from).lte("date", c.to)).data || []) as any[], (r) => `${r.hr_employees?.first_name || ""} ${r.hr_employees?.last_name || ""}`.trim(), (rs) => ({ present: rs.filter((r) => ["present", "late", "half_day"].includes(r.status)).length, late: rs.filter((r) => r.status === "late").length, absent: rs.filter((r) => r.status === "absent").length, overtime: sum(rs, (r) => r.overtime_hours) })) },
];
REPORTS.push(...MORE_REPORTS, ...HR_REPORTS);
const GROUPS: [string, any][] = [["Business overview", Scale], ["Accountant", BookText], ["Sales", BarChart3], ["Inventory", Boxes], ["Receivables", HandCoins], ["Payables & purchases", Truck], ["Expenses", Wallet], ["Taxes", Percent], ["Payroll & HR", Users]];
const FAV_KEY = "garage.report.favs";

/** report centre: pick a report, set the period and filters, see a chart and the table, export. */
export default function ReportCatalog() {
  const [open, setOpen] = useState<Report | null>(null);
  const [q, setQ] = useState("");
  const { can } = usePermissions();
  const [favs, setFavs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } });
  const toggleFav = (k: string) => { const n = favs.includes(k) ? favs.filter((x) => x !== k) : [...favs, k]; setFavs(n); try { localStorage.setItem(FAV_KEY, JSON.stringify(n)); } catch { /* per device */ } };
  if (open) return open.view ? <OwnScreen r={open} onBack={() => setOpen(null)} /> : <ReportViewer r={open} onBack={() => setOpen(null)} />;
  const allowed = (r: Report) => !r.perm || can(r.perm, "view");
  const match = (r: Report) => allowed(r) && (!q.trim() || `${r.label} ${r.hint} ${r.group}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-5">
      <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Find a report…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {favs.length > 0 && !q && (
        <Panel title="Favourites" icon={Star}><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{REPORTS.filter((r) => favs.includes(r.key) && allowed(r)).map((r) => <ReportLink key={r.key} r={r} fav onFav={() => toggleFav(r.key)} onOpen={() => setOpen(r)} />)}</div></Panel>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {GROUPS.map(([g, Icon]) => {
          const list = REPORTS.filter((r) => r.group === g && match(r));
          if (!list.length) return null;
          return <Panel key={g} title={g} icon={Icon}><div className="space-y-1">{list.map((r) => <ReportLink key={r.key} r={r} fav={favs.includes(r.key)} onFav={() => toggleFav(r.key)} onOpen={() => setOpen(r)} />)}</div></Panel>;
        })}
      </div>
    </div>
  );
}

/** A report with its own screen (e.g. the VAT return). */
function OwnScreen({ r, onBack }: { r: Report; onBack: () => void }) {
  const View = r.view!;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft /> All reports</Button>
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{r.group}</p><h2 className="font-display text-xl font-bold">{r.label}</h2></div>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print / PDF</Button>
      </div>
      <View />
    </div>
  );
}

function ReportLink({ r, fav, onFav, onOpen }: { r: Report; fav: boolean; onFav: () => void; onOpen: () => void }) {
  return (
    <div className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/60">
      <button onClick={onFav} aria-label={fav ? "Remove favourite" : "Add to favourites"} className={cn("rounded-md p-1", fav ? "text-warning" : "text-muted-foreground/40 hover:text-warning")}><Star className={cn("h-4 w-4", fav && "fill-current")} /></button>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 flex-1"><span className="block font-medium text-primary group-hover:underline">{r.label}</span><span className="block truncate text-xs text-muted-foreground">{r.hint}</span></span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

const PRESETS: [string, () => [string, string]][] = [
  ["Today", () => [iso(new Date()), iso(new Date())]],
  ["This week", () => { const n = new Date(); const d = new Date(n); d.setDate(n.getDate() - ((n.getDay() + 6) % 7)); return [iso(d), iso(n)]; }],
  ["This month", () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; }],
  ["Last month", () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
  ["This quarter", () => { const n = new Date(); return [iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), iso(n)]; }],
  ["This year", () => { const n = new Date(); return [`${n.getFullYear()}-01-01`, iso(n)]; }],
];

function ReportViewer({ r, onBack }: { r: Report; onBack: () => void }) {
  const tenantId = useTenantId();
  const [range, setRange] = useState<[string, string]>(PRESETS[2][1]());
  const [preset, setPreset] = useState("This month");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [stock, setStock] = useState("");
  const [view, setView] = useState<"both" | "table">("both");
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["report", r.key, tenantId, r.dated ? range.join() : ""], enabled: !!tenantId,
    queryFn: () => r.load({ tenantId: tenantId!, from: range[0], to: range[1] }),
  });
  const cats = useMemo(() => [...new Set((data as any[]).map((x) => x.category).filter(Boolean))].sort(), [data]);
  const rows = useMemo(() => (data as any[]).filter((x) => (!cat || x.category === cat) && (!stock || x.state === stock) && (!q.trim() || Object.values(x).some((v) => String(v ?? "").toLowerCase().includes(q.trim().toLowerCase())))), [data, q, cat, stock]);
  const paged = usePaged(rows, 25);
  const fmt = (c: Col, v: any) => (c.money ? formatKES(Number(v || 0)) : c.num ? Number(v || 0).toLocaleString() : String(v ?? "—"));
  const totals = r.cols.map((c) => (c.money || c.num ? rows.reduce((a, x) => a + (Number(x[c.key]) || 0), 0) : null));
  const chartData = r.chart ? rows.slice(0, 15).map((x) => ({ name: String(x[r.chart!.x]).slice(0, 22), value: Number(x[r.chart!.y]) || 0 })) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft /> All reports</Button>
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{r.group}</p><h2 className="font-display text-xl font-bold">{r.label}</h2></div>
        <Button variant="outline" size="sm" onClick={() => setView(view === "both" ? "table" : "both")}><Table2 /> {view === "both" ? "Table only" : "Chart & table"}</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print / PDF</Button>
        <ImportExport entity={r.key} label="Export" rows={rows.map((x) => Object.fromEntries(r.cols.map((c) => [c.label, x[c.key]])))} />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 print:hidden">
        {r.dated && <>
          {PRESETS.map(([l, f]) => <button key={l} onClick={() => { setPreset(l); setRange(f()); }} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", preset === l ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}>{l}</button>)}
          {r.asOf ? <span className="text-xs">As at</span> : <>
          <input type="date" className="fi h-8 w-auto text-xs" value={range[0]} onChange={(e) => { setPreset(""); setRange([e.target.value, range[1]]); }} />
          <span className="text-xs">to</span>
          </>}
          <input type="date" className="fi h-8 w-auto text-xs" value={range[1]} onChange={(e) => { setPreset(""); setRange([range[0], e.target.value]); }} />
        </>}
        {r.filters?.includes("category") && cats.length > 0 && <select className="fi h-8 w-auto text-xs" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>}
        {r.filters?.includes("stock") && <select className="fi h-8 w-auto text-xs" value={stock} onChange={(e) => setStock(e.target.value)}><option value="">Any stock</option><option>In stock</option><option>Low</option><option>Out of stock</option></select>}
        <div className="relative ml-auto w-full sm:w-56"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input className="fi h-8 pl-8 text-xs" placeholder="Search in the report…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {isLoading ? <OrbLoader label="Building the report…" /> : error ? <EmptyState icon={FileSpreadsheet} title="This report could not load" description={(error as Error).message} /> : <>
        {view === "both" && chartData.length > 1 && (
          <Panel title="Chart" icon={BarChart3}>
            <div className="h-64">
              <ResponsiveContainer debounce={120} width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} fontSize={10} height={60} tickLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} />
                  <Tooltip formatter={(v: any) => (r.cols.find((c) => c.key === r.chart!.y)?.money ? formatKES(Number(v)) : Number(v).toLocaleString())} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
        <Panel flush>
          {rows.length === 0 ? <EmptyState icon={FileSpreadsheet} title="No data for these filters" /> : <>
            <TableWrap><table className="dt">
              <thead><tr>{r.cols.map((c) => <th key={c.key} className={cn((c.money || c.num) && "num")}>{c.label}</th>)}</tr></thead>
              <tbody>{paged.rows.map((x: any, i: number) => <tr key={i}>{r.cols.map((c) => <td key={c.key} className={cn((c.money || c.num) && "num", c.key === r.cols[0].key && "font-medium")}>{fmt(c, x[c.key])}</td>)}</tr>)}</tbody>
              <tfoot><tr>{r.cols.map((c, i) => <td key={c.key} className={cn((c.money || c.num) && "num")}>{i === 0 ? `Total (${rows.length})` : totals[i] == null ? "" : fmt(c, totals[i])}</td>)}</tr></tfoot>
            </table></TableWrap>
            <Pager {...paged.pager} />
          </>}
        </Panel>
      </>}
    </div>
  );
}
