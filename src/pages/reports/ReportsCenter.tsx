import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Download, FileText, Search, ShoppingCart, Package, Users, Boxes, Receipt, TrendingDown, ShoppingBag,
  UserRound, BarChart3, LayoutList, AlertTriangle, ArrowUpRight, ArrowDownRight, Filter, X, ChevronDown, ChevronRight,
  Zap, Snail, Ban, MapPin,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useSalesInRange, useProductStocks, useLocations } from "@/hooks/useData";
import Pager, { usePaged } from "@/components/Pager";
import { useTenantId } from "@/hooks/useTenantId";
import { useTenant } from "@/hooks/useTenant";
import { formatKES, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { realDiscount } from "@/lib/reportMath";
import { exportSalesExcel, exportSalesPDF, methodLabel } from "@/lib/exportUtils";

// ------------------------------------------------------------------ helpers

type Preset = "today" | "yesterday" | "week" | "month" | "lastmonth" | "30d" | "90d" | "year" | "all" | "custom";
type Tab = "overview" | "sales" | "products" | "movers" | "staff" | "stock" | "expenses" | "purchases" | "customers" | "charts";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "sales", label: "Sales", icon: ShoppingCart },
  { key: "products", label: "Products", icon: Package },
  { key: "movers", label: "Fast & slow movers", icon: Zap },
  { key: "staff", label: "Staff", icon: UserRound },
  { key: "stock", label: "Stock", icon: Boxes },
  { key: "expenses", label: "Expenses & Bills", icon: TrendingDown },
  { key: "purchases", label: "Purchases", icon: ShoppingBag },
  { key: "customers", label: "Customers", icon: Users },
  { key: "charts", label: "Charts", icon: BarChart3 },
];

const COLORS = ["hsl(var(--primary))", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#64748b", "#ec4899", "#84cc16", "#f97316"];
const DAY = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function rangeFor(preset: Preset, from: string, to: string): { start: number; end: number; label: string } {
  const now = new Date();
  const day = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfToday = day(now).getTime() + DAY - 1;
  switch (preset) {
    case "today": return { start: day(now).getTime(), end: endOfToday, label: "Today" };
    case "yesterday": { const y = day(now).getTime() - DAY; return { start: y, end: y + DAY - 1, label: "Yesterday" }; }
    case "week": { const s = day(now); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return { start: s.getTime(), end: endOfToday, label: "This week" }; }
    case "month": { const s = day(now); s.setDate(1); return { start: s.getTime(), end: endOfToday, label: "This month" }; }
    case "lastmonth": {
      const s = day(now); s.setDate(1); s.setMonth(s.getMonth() - 1);
      const e = day(now); e.setDate(1);
      return { start: s.getTime(), end: e.getTime() - 1, label: format(s, "MMMM yyyy") };
    }
    case "30d": return { start: day(now).getTime() - 29 * DAY, end: endOfToday, label: "Last 30 days" };
    case "90d": return { start: day(now).getTime() - 89 * DAY, end: endOfToday, label: "Last 90 days" };
    case "year": { const s = day(now); s.setMonth(0, 1); return { start: s.getTime(), end: endOfToday, label: `${now.getFullYear()} so far` }; }
    case "custom": {
      const s = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
      const e = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
      return { start: s, end: e, label: `${from || "start"} → ${to || "today"}` };
    }
    default: return { start: -Infinity, end: Infinity, label: "All time" };
  }
}

const within = (iso: string | null | undefined, r: { start: number; end: number }) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.start && t <= r.end;
};

function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const itemsOf = (t: any): any[] => (Array.isArray(t.items) ? t.items : []);
const lineGross = (l: any) => Number(l.quantity || 0) * Number(l.price || 0);
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const isRefund = (t: any) => !!t.refund_of || t.payment_method === "credit_note" || Number(t.total) < 0;

/** One sold line with its share of the sale's discount and VAT, so line totals add up to the sale. */
type SoldLine = {
  key: string; saleId: string; at: string; productId: string; name: string; category: string; variant: string;
  qty: number; unitPrice: number; revenue: number; tax: number; cost: number; profit: number;
  cashier: string; customer: string; customerId: string; branch: string; method: string;
};

// ------------------------------------------------------------------ data

function useBackOffice() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["report-backoffice", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const sb: any = supabase;
      const [expenses, bills, purchases, adjustments, billPayments] = await Promise.all([
        sb.from("expenses").select("*").eq("tenant_id", tenantId).order("expense_date", { ascending: false }).limit(3000),
        sb.from("bills").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(3000),
        sb.from("purchases").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(3000),
        sb.from("stock_adjustments").select("*, products!inner(name, sku, tenant_id, category)").eq("products.tenant_id", tenantId)
          .order("created_at", { ascending: false }).limit(2000),
        sb.from("supplier_payments").select("id, bill_id, purchase_id, amount, method, paid_on").eq("tenant_id", tenantId)
          .order("paid_on", { ascending: false }).limit(5000),
      ]);
      return {
        expenses: expenses.data || [], bills: bills.data || [], purchases: purchases.data || [],
        adjustments: adjustments.data || [], billPayments: billPayments.data || [],
      };
    },
  });
}

// ------------------------------------------------------------------ UI bits

function Kpi({ label, value, hint, tone, delta }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; delta?: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-bold tabular-nums", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
        {delta !== undefined && delta !== null && Number.isFinite(delta) && (
          <span className={cn("inline-flex items-center font-semibold", delta >= 0 ? "text-success" : "text-destructive")}>
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(delta).toFixed(0)}%
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, actions, children, className }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="font-display text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function ExportButton({ onClick, label = "CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
      {label === "PDF" ? <FileText className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

function Select({ value, onChange, children, label, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string; className?: string }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={cn("fi h-9 w-auto min-w-[120px] text-sm", className)}>{children}</select>;
}

function Table({ head, rows, empty = "Nothing for these filters", align, footer, pageSize = 25 }: {
  head: string[]; rows: React.ReactNode[][]; empty?: string; align?: ("left" | "right" | "center")[]; footer?: React.ReactNode[]; pageSize?: number;
}) {
  const paged = usePaged(rows, pageSize);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr>{head.map((h, i) => <th key={`${h}${i}`} className={cn("whitespace-nowrap", `text-${align?.[i] || "left"}`)}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={head.length} className="py-10 text-center text-muted-foreground">{empty}</td></tr>
            ) : paged.pageRows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci} className={cn(`text-${align?.[ci] || "left"}`, (align?.[ci] === "right") && "tabular-nums")}>{c}</td>)}</tr>
            ))}
          </tbody>
          {footer && rows.length > 0 && (
            <tfoot><tr>{footer.map((c, i) => <td key={i} className={cn(`text-${align?.[i] || "left"}`, "tabular-nums")}>{c}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {rows.length > pageSize && <Pager page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} />}
    </>
  );
}

function ChartCard({ title, subtitle, children, actions, tall }: { title: string; subtitle?: string; children: React.ReactElement; actions?: React.ReactNode; tall?: boolean }) {
  return (
    <Panel title={title} subtitle={subtitle} actions={actions}>
      <div className={cn("p-3", tall ? "h-80" : "h-64")}><ResponsiveContainer debounce={120}>{children}</ResponsiveContainer></div>
    </Panel>
  );
}

const tip = { contentStyle: { borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 } };
const axis = { fontSize: 11, tickLine: false, axisLine: false, tick: { fill: "hsl(var(--muted-foreground))" } } as const;
const moneyTip = (v: any) => formatKES(Number(v));

function SalesList({ rows, open, setOpen, money, branchName }: { rows: any[]; open: string | null; setOpen: (v: string | null) => void; money: (n: number) => string; branchName: (id: string) => string }) {
  const paged = usePaged(rows, 25);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="dt">
          <thead><tr><th className="w-8" /><th>Date</th><th>Receipt</th><th>Items</th><th>Cashier</th><th>Customer</th><th>Payment</th><th className="num">Total</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">No completed sales for these filters</td></tr>}
            {paged.pageRows.map((r) => (
              <Fragment key={r.t.id}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === r.t.id ? null : r.t.id)}>
                  <td className="!px-2 text-muted-foreground">{open === r.t.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="whitespace-nowrap">{format(new Date(r.t.created_at), "d MMM, HH:mm")}</td>
                  <td className="font-mono text-xs">#{r.t.id.slice(0, 8).toUpperCase()}</td>
                  <td className="max-w-[260px] truncate">{r.ls.length} item{r.ls.length === 1 ? "" : "s"} · {r.units} unit{r.units === 1 ? "" : "s"}</td>
                  <td>{r.t.cashier_name || "—"}</td>
                  <td>{r.t.customer_name || "Walk-in"}</td>
                  <td>{methodLabel(r.t.payment_method)}</td>
                  <td className="num font-semibold">{money(r.value)}</td>
                  <td className={cn("num", r.profit >= 0 ? "text-success" : "text-destructive")}>{money(r.profit)}</td>
                </tr>
                {open === r.t.id && (
                  <tr key={`${r.t.id}-d`}>
                    <td />
                    <td colSpan={8} className="bg-muted/30">
                      <table className="w-full text-xs">
                        <thead><tr className="text-muted-foreground"><th className="py-1 text-left font-medium">Item</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Price</th><th className="text-right font-medium">Line</th><th className="text-right font-medium">Profit</th></tr></thead>
                        <tbody>
                          {r.ls.map((l: SoldLine) => (
                            <tr key={l.key}><td className="py-1">{l.name}{l.variant && <span className="text-muted-foreground"> · {l.variant}</span>}</td><td className="text-right">{l.qty}</td><td className="text-right">{money(l.unitPrice)}</td><td className="text-right">{money(l.revenue)}</td><td className="text-right">{money(l.profit)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {branchName(r.t.location_id)}{realDiscount(r.t) > 0 ? ` · discount ${money(realDiscount(r.t))}` : ""}{r.t.mpesa_ref ? ` · ref ${r.t.mpesa_ref}` : ""}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 25 && <Pager page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} />}
    </>
  );
}


// ------------------------------------------------------------------ page

export default function ReportsCenter() {
  const { tenant } = useTenant();
  const shop = tenant?.business_name || "Shop";
  const { data: stock = [] } = useProductStocks("__all__");
  const { data: locations = [] } = useLocations();
  const { data: office } = useBackOffice();

  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);
  const finite = Number.isFinite(range.start) && Number.isFinite(range.end);
  const prevRange = useMemo(() => finite ? { start: range.start - (range.end - range.start + 1), end: range.start - 1 } : null, [range, finite]);

  const { data: transactions = [], isLoading } = useSalesInRange(
    Number.isFinite(range.start) ? new Date(range.start).toISOString() : null,
    Number.isFinite(range.end) ? new Date(range.end).toISOString() : null,
  );
  const { data: prevTransactions = [] } = useSalesInRange(
    prevRange ? new Date(prevRange.start).toISOString() : "1970-01-01T00:00:00.000Z",
    prevRange ? new Date(prevRange.end).toISOString() : "1970-01-01T00:00:01.000Z",
  );

  // ---------------- filters (apply to every tab)
  const [branch, setBranch] = useState("all");
  const [method, setMethod] = useState("all");
  const [cashier, setCashier] = useState("all");
  const [category, setCategory] = useState("all");
  const [product, setProduct] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [hourFrom, setHourFrom] = useState("0");
  const [hourTo, setHourTo] = useState("23");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [salesView, setSalesView] = useState<"sales" | "items">("sales");
  const [salesSort, setSalesSort] = useState("new");
  const [openSale, setOpenSale] = useState<string | null>(null);
  const [productSort, setProductSort] = useState("revenue");
  const [moverView, setMoverView] = useState<"fast" | "slow" | "dead">("fast");
  const [stockLevel, setStockLevel] = useState("all");
  const [stockReason, setStockReason] = useState("all");
  const [chartMetric, setChartMetric] = useState<"revenue" | "profit" | "units">("revenue");
  const [chartGroup, setChartGroup] = useState<"day" | "week" | "month">("day");
  const [chartTop, setChartTop] = useState("10");
  const stamp = new Date().toISOString().slice(0, 10);

  const productById = useMemo(() => new Map((stock as any[]).map((p) => [p.id, p])), [stock]);
  const categories = useMemo(() => Array.from(new Set((stock as any[]).map((p) => p.category || "Other"))).sort(), [stock]);
  const branchName = (id: string | null | undefined) => (locations as any[]).find((l) => l.id === id)?.name || "—";
  const staffList = useMemo(() => Array.from(new Set(transactions.map((t: any) => t.cashier_name || "Unknown"))).sort(), [transactions]);
  const customerList = useMemo(() => {
    const m = new Map<string, string>();
    transactions.forEach((t: any) => { if (t.customer_id) m.set(t.customer_id, t.customer_name || "Customer"); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [transactions]);

  const activeFilters = [branch, method, cashier, category, product, customer].filter((v) => v !== "all").length + (hourFrom !== "0" || hourTo !== "23" ? 1 : 0);
  const clearFilters = () => { setBranch("all"); setMethod("all"); setCashier("all"); setCategory("all"); setProduct("all"); setCustomer("all"); setHourFrom("0"); setHourTo("23"); };

  const saleOk = (t: any) => {
    if (branch !== "all" && t.location_id !== branch) return false;
    if (method !== "all" && t.payment_method !== method) return false;
    if (cashier !== "all" && (t.cashier_name || "Unknown") !== cashier) return false;
    if (customer !== "all" && (customer === "walk-in" ? !!t.customer_id : t.customer_id !== customer)) return false;
    const h = new Date(t.created_at).getHours();
    return h >= Number(hourFrom) && h <= Number(hourTo);
  };
  const lineOk = (l: any) => {
    const pid = String(l.product_id || l.id || "");
    if (product !== "all" && pid !== product) return false;
    if (category !== "all" && (productById.get(pid)?.category || "Other") !== category) return false;
    return true;
  };
  const lineFilter = product !== "all" || category !== "all";

  /** Completed sales (and refunds) that pass the filters, broken into lines. */
  const build = (txs: any[], r: { start: number; end: number } | null) => {
    const sales: any[] = [], refunds: any[] = [], lines: SoldLine[] = [], returnedLines: SoldLine[] = [];
    let failed = 0;
    for (const t of txs) {
      if (r && !within(t.created_at, r)) continue;
      if (!saleOk(t)) continue;
      if (t.status !== "completed") { if (t.status === "failed" || t.status === "cancelled") failed++; continue; }
      const its = itemsOf(t);
      const gross = its.reduce((s, l) => s + lineGross(l), 0);
      const refund = isRefund(t);
      const factor = gross > 0 ? Math.abs(Number(t.total || 0)) / gross : 0;
      const taxShare = gross > 0 ? Math.abs(Number(t.tax || 0)) / gross : 0;
      const out: SoldLine[] = [];
      its.forEach((l, i) => {
        if (!lineOk(l)) return;
        const pid = String(l.product_id || l.id || l.name);
        const qty = Number(l.quantity || 0);
        const g = lineGross(l);
        const revenue = g * factor, tax = g * taxShare, cost = Number(l.cost_price ?? productById.get(pid)?.cost_price ?? 0) * qty;
        out.push({
          key: `${t.id}:${i}`, saleId: t.id, at: t.created_at, productId: pid, name: l.name || productById.get(pid)?.name || "Item",
          category: productById.get(pid)?.category || "Other", variant: [l.size, l.color].filter(Boolean).join(" · "),
          qty, unitPrice: Number(l.price || 0), revenue, tax, cost, profit: revenue - tax - cost,
          cashier: t.cashier_name || "Unknown", customer: t.customer_name || "Walk-in", customerId: t.customer_id || "walk-in",
          branch: t.location_id || "", method: t.payment_method || "cash",
        });
      });
      if (lineFilter && out.length === 0) continue;
      if (refund) { refunds.push(t); returnedLines.push(...out); }
      else { sales.push(t); lines.push(...out); }
    }
    const sum = (a: SoldLine[], k: keyof SoldLine) => a.reduce((s, l) => s + Number(l[k] || 0), 0);
    const revenue = lineFilter ? sum(lines, "revenue") : sales.reduce((s, t) => s + Number(t.total || 0), 0);
    const tax = lineFilter ? sum(lines, "tax") : sales.reduce((s, t) => s + Number(t.tax || 0), 0);
    const cost = sum(lines, "cost");
    const refundAmt = lineFilter ? sum(returnedLines, "revenue") : refunds.reduce((s, t) => s + Math.abs(Number(t.total || 0)), 0);
    const returnedCost = sum(returnedLines, "cost");
    const discount = sales.reduce((s, t) => s + realDiscount(t), 0);
    const units = sum(lines, "qty");
    const gross = revenue - tax - cost - (refundAmt - returnedCost);
    return { sales, refunds, lines, returnedLines, failed, revenue, tax, cost, refundAmt, returnedCost, discount, units, gross, count: sales.length };
  };

  const cur = useMemo(() => build(transactions, range), [transactions, range, branch, method, cashier, customer, hourFrom, hourTo, category, product, productById]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => (prevRange ? build(prevTransactions, prevRange) : null), [prevTransactions, prevRange, branch, method, cashier, customer, hourFrom, hourTo, category, product, productById]); // eslint-disable-line react-hooks/exhaustive-deps
  const delta = (a: number, b?: number) => (prev && b ? ((a - b) / Math.abs(b)) * 100 : null);

  const expTotal = useMemo(() => (office?.expenses || []).filter((e: any) => within(e.expense_date, range) && (branch === "all" || e.location_id === branch))
    .reduce((s: number, e: any) => s + Number(e.amount || 0), 0), [office, range, branch]);
  const billsPaid = useMemo(() => (office?.billPayments || []).filter((p: any) => !p.purchase_id && within(p.paid_on, range))
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0), [office, range]);
  const net = cur.gross - expTotal - billsPaid;
  const days = finite ? Math.max(1, Math.round((Math.min(range.end, Date.now()) - range.start) / DAY)) : Math.max(1, new Set(cur.sales.map((t) => String(t.created_at).slice(0, 10))).size);

  const q = search.trim().toLowerCase();
  const matches = (...v: unknown[]) => !q || v.some((x) => String(x ?? "").toLowerCase().includes(q));

  // ---------------- aggregates
  const byProduct = useMemo(() => {
    const m = new Map<string, { id: string; name: string; category: string; qty: number; revenue: number; cost: number; profit: number; sales: Set<string>; returned: number; lastSold: string }>();
    cur.lines.forEach((l) => {
      const r = m.get(l.productId) || { id: l.productId, name: l.name, category: l.category, qty: 0, revenue: 0, cost: 0, profit: 0, sales: new Set<string>(), returned: 0, lastSold: l.at };
      r.qty += l.qty; r.revenue += l.revenue; r.cost += l.cost; r.profit += l.profit; r.sales.add(l.saleId);
      if (l.at > r.lastSold) r.lastSold = l.at;
      m.set(l.productId, r);
    });
    cur.returnedLines.forEach((l) => { const r = m.get(l.productId); if (r) r.returned += l.qty; });
    return Array.from(m.values()).map((r) => {
      const p = productById.get(r.id);
      const onHand = Number(p?.stock ?? 0);
      const perDay = r.qty / days;
      return { ...r, orders: r.sales.size, margin: pct(r.profit, r.revenue), perDay, onHand, cover: perDay > 0 ? onHand / perDay : Infinity, avgPrice: r.qty ? r.revenue / r.qty : 0 };
    });
  }, [cur, productById, days]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; revenue: number; profit: number; products: Set<string> }>();
    cur.lines.forEach((l) => {
      const r = m.get(l.category) || { name: l.category, qty: 0, revenue: 0, profit: 0, products: new Set<string>() };
      r.qty += l.qty; r.revenue += l.revenue; r.profit += l.profit; r.products.add(l.productId);
      m.set(l.category, r);
    });
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
  }, [cur]);

  const groupSales = (keyOf: (t: any) => string, labelOf?: (k: string) => string) => {
    const m = new Map<string, { key: string; label: string; count: number; revenue: number; units: number; profit: number; discount: number; cash: number; mpesa: number; other: number }>();
    cur.sales.forEach((t) => {
      const k = keyOf(t);
      const r = m.get(k) || { key: k, label: labelOf ? labelOf(k) : k, count: 0, revenue: 0, units: 0, profit: 0, discount: 0, cash: 0, mpesa: 0, other: 0 };
      const ls = cur.lines.filter((l) => l.saleId === t.id);
      const v = lineFilter ? ls.reduce((s, l) => s + l.revenue, 0) : Number(t.total || 0);
      r.count += 1; r.revenue += v; r.discount += realDiscount(t);
      r.units += ls.reduce((s, l) => s + l.qty, 0); r.profit += ls.reduce((s, l) => s + l.profit, 0);
      if (t.payment_method === "cash") r.cash += v; else if (t.payment_method === "mpesa") r.mpesa += v; else r.other += v;
      m.set(k, r);
    });
    return Array.from(m.values());
  };
  const byDay = useMemo(() => groupSales((t) => String(t.created_at).slice(0, 10)).sort((a, b) => a.key.localeCompare(b.key)), [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const byMethod = useMemo(() => groupSales((t) => t.payment_method || "cash", methodLabel).sort((a, b) => b.revenue - a.revenue), [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const byStaff = useMemo(() => groupSales((t) => t.cashier_name || "Unknown").sort((a, b) => b.revenue - a.revenue), [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const byBranch = useMemo(() => groupSales((t) => t.location_id || "", branchName).sort((a, b) => b.revenue - a.revenue), [cur, locations]); // eslint-disable-line react-hooks/exhaustive-deps
  const byHour = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, revenue: 0, count: 0 }));
    cur.sales.forEach((t) => { const h = new Date(t.created_at).getHours(); out[h].count++; out[h].revenue += Number(t.total || 0); });
    return out;
  }, [cur]);
  const byWeekday = useMemo(() => {
    const out = WEEKDAYS.map((d) => ({ day: d, revenue: 0, count: 0 }));
    cur.sales.forEach((t) => { const d = (new Date(t.created_at).getDay() + 6) % 7; out[d].count++; out[d].revenue += Number(t.total || 0); });
    return out;
  }, [cur]);
  const byCustomer = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number; revenue: number; units: number; profit: number; first: string; last: string }>();
    cur.sales.forEach((t) => {
      const k = t.customer_id || "walk-in";
      const ls = cur.lines.filter((l) => l.saleId === t.id);
      const r = m.get(k) || { id: k, name: t.customer_name || "Walk-in", count: 0, revenue: 0, units: 0, profit: 0, first: t.created_at, last: t.created_at };
      r.count += 1; r.revenue += lineFilter ? ls.reduce((s, l) => s + l.revenue, 0) : Number(t.total || 0);
      r.units += ls.reduce((s, l) => s + l.qty, 0); r.profit += ls.reduce((s, l) => s + l.profit, 0);
      if (t.created_at > r.last) r.last = t.created_at;
      if (t.created_at < r.first) r.first = t.created_at;
      m.set(k, r);
    });
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
  }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading && transactions.length === 0) {
    return <div className="flex h-64 items-center justify-center"><p className="text-muted-foreground">Loading reports…</p></div>;
  }

  const money = (n: number) => formatKES(n);
  const avgBasket = cur.count ? cur.revenue / cur.count : 0;

  // ------------------------------------------------------------------ render
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="font-display text-xl font-bold">Sales, stock & team</h2>
          <p className="text-sm text-muted-foreground">{range.label} · completed sales only{cur.failed ? ` · ${cur.failed} failed/cancelled attempts left out` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"],
            ["30d", "30 days"], ["90d", "90 days"], ["year", "This year"], ["all", "All time"], ["custom", "Custom"]] as [Preset, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", preset === k ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80")}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {preset === "custom" && (<>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="fi h-9 w-auto" aria-label="From date" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="fi h-9 w-auto" aria-label="To date" />
          </>)}
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this report…" className="fi h-9 pl-9" />
          </div>
          <button onClick={() => setShowFilters((v) => !v)}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium", activeFilters ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted")}>
            <Filter className="h-4 w-4" /> Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          {activeFilters > 0 && <button onClick={clearFilters} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /> Clear</button>}
        </div>
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
            {locations.length > 1 && (
              <Select value={branch} onChange={setBranch} label="Branch">
                <option value="all">All branches</option>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
            <Select value={method} onChange={setMethod} label="Payment method">
              <option value="all">All payment methods</option>
              {["cash", "mpesa", "card", "online", "split", "credit", "mobile_money", "loyalty_points"].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </Select>
            <Select value={cashier} onChange={setCashier} label="Staff">
              <option value="all">All staff</option>{staffList.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={category} onChange={(v) => { setCategory(v); setProduct("all"); }} label="Category">
              <option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={product} onChange={setProduct} label="Product" className="max-w-[220px]">
              <option value="all">All products</option>
              {(stock as any[]).filter((p) => category === "all" || (p.category || "Other") === category).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={customer} onChange={setCustomer} label="Customer" className="max-w-[200px]">
              <option value="all">All customers</option><option value="walk-in">Walk-in only</option>
              {customerList.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
            <span className="text-xs text-muted-foreground">Time of day</span>
            <Select value={hourFrom} onChange={setHourFrom} label="From hour" className="min-w-[80px]">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </Select>
            <span className="text-xs text-muted-foreground">to</span>
            <Select value={hourTo} onChange={setHourTo} label="To hour" className="min-w-[80px]">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:59</option>)}
            </Select>
          </div>
        )}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Sales" value={money(cur.revenue)} delta={delta(cur.revenue, prev?.revenue)} hint={prev ? "vs previous" : undefined} />
        <Kpi label="Orders" value={cur.count.toLocaleString()} delta={delta(cur.count, prev?.count)} hint={`${(cur.count / days).toFixed(1)}/day`} />
        <Kpi label="Units sold" value={cur.units.toLocaleString()} delta={delta(cur.units, prev?.units)} hint={cur.count ? `${(cur.units / cur.count).toFixed(1)} per sale` : undefined} />
        <Kpi label="Average sale" value={money(avgBasket)} delta={prev && prev.count ? delta(avgBasket, prev.revenue / prev.count) : null} />
        <Kpi label="Gross profit" value={money(cur.gross)} tone={cur.gross >= 0 ? "good" : "bad"} hint={`${pct(cur.gross, cur.revenue - cur.tax).toFixed(1)}% margin`} delta={delta(cur.gross, prev?.gross)} />
        <Kpi label="Net profit" value={money(net)} tone={net >= 0 ? "good" : "bad"} hint="After expenses & bills" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-secondary p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && Overview()}
      {tab === "sales" && SalesTab()}
      {tab === "products" && ProductsTab()}
      {tab === "movers" && MoversTab()}
      {tab === "staff" && StaffTab()}
      {tab === "stock" && StockTab()}
      {tab === "expenses" && ExpensesTab()}
      {tab === "purchases" && PurchasesTab()}
      {tab === "customers" && CustomersTab()}
      {tab === "charts" && ChartsTab()}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Receipt className="h-3.5 w-3.5" /> Every figure follows the period and filters above. Only completed sales count; failed and cancelled payment attempts are left out. Discounts and VAT are shared across each sale's items so product figures add up to the totals.
      </p>
    </div>
  );

  // ================================================================ tabs
  // (inner components read the aggregates above)

  function Overview() {
    const plRows: [string, number, boolean?][] = [
      ["Sales (after discounts)", cur.revenue], ["Discounts given", cur.discount], ["VAT collected", cur.tax], ["Cost of goods sold", cur.cost],
      ["Returns / refunds", cur.refundAmt], ["Cost of returned stock", cur.returnedCost], ["Gross profit", cur.gross, true],
      ["Expenses", expTotal], ["Bills paid (not stock)", billsPaid], ["Net profit", net, true],
    ];
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Profit & loss" subtitle={range.label}
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_profit_loss_${stamp}.csv`, [["Line", `Amount (${currencyCode()})`], ...plRows.map(([l, v]) => [l, v.toFixed(2)])])} />}>
          <Table align={["left", "right"]} head={["Line", "Amount"]} pageSize={50}
            rows={plRows.map(([l, v, strong]) => [strong ? <strong key="l">{l}</strong> : l, strong ? <strong key="v" className={v >= 0 ? "text-success" : "text-destructive"}>{money(v)}</strong> : money(v)])} />
        </Panel>
        <Panel title="Key figures" subtitle="For this period and filters">
          <Table align={["left", "right"]} head={["Measure", "Value"]} pageSize={50} rows={[
            ["Sales per day", money(cur.revenue / days)],
            ["Orders per day", (cur.count / days).toFixed(1)],
            ["Units per sale", cur.count ? (cur.units / cur.count).toFixed(2) : "0"],
            ["Gross margin", `${pct(cur.gross, cur.revenue - cur.tax).toFixed(1)}%`],
            ["Different products sold", byProduct.length.toLocaleString()],
            ["Returns", `${cur.refunds.length} (${money(cur.refundAmt)})`],
            ["Discount rate", `${pct(cur.discount, cur.revenue + cur.discount).toFixed(1)}%`],
            ["Busiest hour", (() => { const b = [...byHour].sort((a, c) => c.revenue - a.revenue)[0]; return b && b.revenue > 0 ? b.hour : "—"; })()],
            ["Busiest day of week", (() => { const b = [...byWeekday].sort((a, c) => c.revenue - a.revenue)[0]; return b && b.revenue > 0 ? b.day : "—"; })()],
            ["Customers served (named)", byCustomer.filter((c) => c.id !== "walk-in").length.toLocaleString()],
            ["Failed / cancelled attempts (excluded)", cur.failed.toLocaleString()],
          ]} />
        </Panel>
        <Panel title="By payment method" actions={<ExportButton onClick={() => downloadCSV(`${shop}_payment_methods_${stamp}.csv`, [["Method", "Sales", `Amount (${currencyCode()})`, "Share %"], ...byMethod.map((m) => [m.label, m.count, m.revenue.toFixed(2), pct(m.revenue, cur.revenue).toFixed(1)])])} />}>
          <Table align={["left", "center", "right", "right"]} head={["Method", "Sales", "Amount", "Share"]}
            rows={byMethod.map((m) => [m.label, m.count, money(m.revenue), `${pct(m.revenue, cur.revenue).toFixed(0)}%`])} />
        </Panel>
        <Panel title="By branch" actions={<ExportButton onClick={() => downloadCSV(`${shop}_branches_${stamp}.csv`, [["Branch", "Sales", "Units", `Revenue (${currencyCode()})`, `Profit (${currencyCode()})`], ...byBranch.map((b) => [b.label, b.count, b.units, b.revenue.toFixed(2), b.profit.toFixed(2)])])} />}>
          <Table align={["left", "center", "right", "right", "right"]} head={["Branch", "Sales", "Units", "Revenue", "Profit"]}
            rows={byBranch.map((b) => [<span key="b" className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{b.label}</span>, b.count, b.units, money(b.revenue), money(b.profit)])} />
        </Panel>
        <Panel title="Day by day" className="xl:col-span-2"
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_daily_${stamp}.csv`, [["Date", "Sales", "Units", "Cash", "M-Pesa", "Other", `Total (${currencyCode()})`, `Profit (${currencyCode()})`], ...byDay.map((d) => [d.key, d.count, d.units, d.cash.toFixed(2), d.mpesa.toFixed(2), d.other.toFixed(2), d.revenue.toFixed(2), d.profit.toFixed(2)])])} />}>
          <Table align={["left", "center", "right", "right", "right", "right", "right", "right"]}
            head={["Date", "Sales", "Units", "Cash", "M-Pesa", "Other", "Total", "Profit"]}
            rows={[...byDay].reverse().map((d) => [format(new Date(d.key), "EEE d MMM yyyy"), d.count, d.units, money(d.cash), money(d.mpesa), money(d.other), <strong key="t">{money(d.revenue)}</strong>,
              <span key="p" className={d.profit >= 0 ? "text-success" : "text-destructive"}>{money(d.profit)}</span>])}
            footer={["Total", cur.count, cur.units, money(byDay.reduce((s, d) => s + d.cash, 0)), money(byDay.reduce((s, d) => s + d.mpesa, 0)), money(byDay.reduce((s, d) => s + d.other, 0)), money(cur.revenue), money(byDay.reduce((s, d) => s + d.profit, 0))]} />
        </Panel>
      </div>
    );
  }

  function SalesTab() {
    const [view, setView] = [salesView, setSalesView];
    const [sort, setSort] = [salesSort, setSalesSort];
    const [open, setOpen] = [openSale, setOpenSale];
    const saleRows = cur.sales
      .map((t) => {
        const ls = cur.lines.filter((l) => l.saleId === t.id);
        return { t, ls, units: ls.reduce((s, l) => s + l.qty, 0), value: lineFilter ? ls.reduce((s, l) => s + l.revenue, 0) : Number(t.total || 0), profit: ls.reduce((s, l) => s + l.profit, 0) };
      })
      .filter((r) => matches(r.t.customer_name, r.t.cashier_name, r.t.mpesa_ref, r.t.id, ...r.ls.map((l) => l.name)))
      .sort((a, b) => sort === "old" ? a.t.created_at.localeCompare(b.t.created_at) : sort === "big" ? b.value - a.value : sort === "small" ? a.value - b.value : sort === "profit" ? b.profit - a.profit : b.t.created_at.localeCompare(a.t.created_at));
    const itemRows = cur.lines.filter((l) => matches(l.name, l.category, l.customer, l.cashier)).sort((a, b) => b.at.localeCompare(a.at));

    return (
      <Panel title={view === "sales" ? "Completed sales" : "Every item sold"} subtitle={view === "sales" ? `${saleRows.length} sales · ${money(saleRows.reduce((s, r) => s + r.value, 0))}` : `${itemRows.length} lines · ${itemRows.reduce((s, l) => s + l.qty, 0)} units`}
        actions={<>
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {(["sales", "items"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-2.5 py-1 font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v === "sales" ? "Sales" : "Items sold"}</button>)}
          </div>
          {view === "sales" && (
            <Select value={sort} onChange={setSort} label="Sort" className="h-8 min-w-0 text-xs">
              <option value="new">Newest first</option><option value="old">Oldest first</option><option value="big">Biggest first</option><option value="small">Smallest first</option><option value="profit">Most profit</option>
            </Select>
          )}
          {view === "sales" ? <>
            <ExportButton onClick={() => downloadCSV(`${shop}_sales_${stamp}.csv`, [["Date", "Receipt", "Branch", "Cashier", "Customer", "Payment", "Items", "Units", `Discount`, `Total (${currencyCode()})`, `Profit (${currencyCode()})`],
              ...saleRows.map((r) => [r.t.created_at, r.t.id.slice(0, 8).toUpperCase(), branchName(r.t.location_id), r.t.cashier_name, r.t.customer_name || "Walk-in", methodLabel(r.t.payment_method), r.ls.map((l) => `${l.name} x${l.qty}`).join("; "), r.units, realDiscount(r.t), r.value.toFixed(2), r.profit.toFixed(2)])])} />
            <ExportButton label="Excel" onClick={() => exportSalesExcel(saleRows.map((r) => r.t) as any, `${shop}_sales_${stamp}.xlsx`)} />
            <ExportButton label="PDF" onClick={() => exportSalesPDF(saleRows.map((r) => r.t) as any, { sales: cur.revenue, vat: cur.tax, profit: cur.gross, count: cur.count }, `${shop}_sales_${stamp}.pdf`, shop)} />
          </> : (
            <ExportButton onClick={() => downloadCSV(`${shop}_items_sold_${stamp}.csv`, [["Date", "Receipt", "Product", "Variant", "Category", "Qty", "Unit price", "Revenue", "Cost", "Profit", "Cashier", "Customer", "Branch", "Payment"],
              ...itemRows.map((l) => [l.at, l.saleId.slice(0, 8).toUpperCase(), l.name, l.variant, l.category, l.qty, l.unitPrice, l.revenue.toFixed(2), l.cost.toFixed(2), l.profit.toFixed(2), l.cashier, l.customer, branchName(l.branch), methodLabel(l.method)])])} />
          )}
        </>}>
        {view === "sales" ? (
          <SalesList rows={saleRows} open={open} setOpen={setOpen} money={money} branchName={branchName} />
        ) : (
          <Table align={["left", "left", "left", "right", "right", "right", "right", "left"]}
            head={["Date", "Product", "Category", "Qty", "Price", "Revenue", "Profit", "Sold by / to"]}
            rows={itemRows.map((l) => [
              <span key="d" className="whitespace-nowrap">{format(new Date(l.at), "d MMM, HH:mm")}</span>,
              <span key="n"><span className="font-medium">{l.name}</span>{l.variant && <span className="block text-xs text-muted-foreground">{l.variant}</span>}</span>,
              l.category, l.qty, money(l.unitPrice), money(l.revenue),
              <span key="p" className={l.profit >= 0 ? "text-success" : "text-destructive"}>{money(l.profit)}</span>,
              <span key="s" className="text-xs text-muted-foreground">{l.cashier} → {l.customer}</span>,
            ])}
            footer={["Total", "", "", itemRows.reduce((s, l) => s + l.qty, 0), "", money(itemRows.reduce((s, l) => s + l.revenue, 0)), money(itemRows.reduce((s, l) => s + l.profit, 0)), ""]} />
        )}
      </Panel>
    );
  }

  function ProductsTab() {
    const [sort, setSort] = [productSort, setProductSort];
    const rows = byProduct.filter((p) => matches(p.name, p.category)).sort((a, b) =>
      sort === "units" ? b.qty - a.qty : sort === "profit" ? b.profit - a.profit : sort === "margin" ? b.margin - a.margin : sort === "orders" ? b.orders - a.orders : sort === "name" ? a.name.localeCompare(b.name) : b.revenue - a.revenue);
    return (
      <div className="grid gap-4">
        <Panel title="Products sold" subtitle={`${rows.length} products · ${rows.reduce((s, p) => s + p.qty, 0).toLocaleString()} units`}
          actions={<>
            <Select value={sort} onChange={setSort} label="Sort" className="h-8 min-w-0 text-xs">
              <option value="revenue">Most sales</option><option value="units">Most units</option><option value="profit">Most profit</option><option value="margin">Best margin</option><option value="orders">Most orders</option><option value="name">Name</option>
            </Select>
            <ExportButton onClick={() => downloadCSV(`${shop}_products_${stamp}.csv`, [["Product", "Category", "Units sold", "Orders", "Returned", "Avg price", `Revenue (${currencyCode()})`, `Cost (${currencyCode()})`, `Profit (${currencyCode()})`, "Margin %", "Share %", "In stock", "Days of stock left"],
              ...rows.map((p) => [p.name, p.category, p.qty, p.orders, p.returned, p.avgPrice.toFixed(2), p.revenue.toFixed(2), p.cost.toFixed(2), p.profit.toFixed(2), p.margin.toFixed(1), pct(p.revenue, cur.revenue).toFixed(1), p.onHand, Number.isFinite(p.cover) ? p.cover.toFixed(0) : ""])])} />
          </>}>
          <Table align={["left", "left", "right", "right", "right", "right", "right", "right", "right", "right"]}
            head={["Product", "Category", "Units", "Orders", "Returned", "Revenue", "Profit", "Margin", "Share", "Stock left"]}
            rows={rows.map((p) => [<span key="n" className="font-medium">{p.name}</span>, p.category, p.qty, p.orders, p.returned || "—", money(p.revenue),
              <span key="p" className={p.profit >= 0 ? "text-success" : "text-destructive"}>{money(p.profit)}</span>, `${p.margin.toFixed(0)}%`, `${pct(p.revenue, cur.revenue).toFixed(1)}%`,
              <span key="s" className={cn(Number.isFinite(p.cover) && p.cover < 7 && "font-semibold text-warning")}>{p.onHand}{Number.isFinite(p.cover) ? ` · ${p.cover < 1 ? "<1" : p.cover.toFixed(0)}d` : ""}</span>])}
            footer={["Total", "", rows.reduce((s, p) => s + p.qty, 0), "", rows.reduce((s, p) => s + p.returned, 0), money(rows.reduce((s, p) => s + p.revenue, 0)), money(rows.reduce((s, p) => s + p.profit, 0)), "", "", ""]} />
        </Panel>
        <Panel title="By category" actions={<ExportButton onClick={() => downloadCSV(`${shop}_categories_${stamp}.csv`, [["Category", "Products", "Units", `Revenue (${currencyCode()})`, `Profit (${currencyCode()})`, "Share %"], ...byCategory.map((c) => [c.name, c.products.size, c.qty, c.revenue.toFixed(2), c.profit.toFixed(2), pct(c.revenue, cur.revenue).toFixed(1)])])} />}>
          <Table align={["left", "right", "right", "right", "right", "right"]} head={["Category", "Products", "Units", "Revenue", "Profit", "Share"]}
            rows={byCategory.filter((c) => matches(c.name)).map((c) => [c.name, c.products.size, c.qty, money(c.revenue), money(c.profit), `${pct(c.revenue, cur.revenue).toFixed(1)}%`])} />
        </Panel>
      </div>
    );
  }

  function MoversTab() {
    const [view, setView] = [moverView, setMoverView];
    const soldIds = new Set(byProduct.map((p) => p.id));
    const fast = [...byProduct].sort((a, b) => b.perDay - a.perDay);
    const slow = [...byProduct].filter((p) => p.onHand > 0).sort((a, b) => a.perDay - b.perDay);
    const dead = (stock as any[]).filter((p) => !soldIds.has(p.id) && Number(p.stock || 0) > 0 && (category === "all" || (p.category || "Other") === category))
      .map((p) => ({ ...p, value: Number(p.stock || 0) * (Number(p.cost_price) || Number(p.price) || 0) })).sort((a, b) => b.value - a.value);
    const cls = (p: any) => (p.perDay >= 1 ? "Fast" : p.perDay >= 1 / 7 ? "Steady" : "Slow");
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => setView("fast")} className={cn("rounded-xl border p-4 text-left", view === "fast" ? "border-primary bg-primary/5" : "border-border bg-card")}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Zap className="h-3.5 w-3.5 text-success" /> Fast movers</p>
            <p className="mt-1 text-xl font-bold">{byProduct.filter((p) => p.perDay >= 1).length}</p><p className="text-[11px] text-muted-foreground">1 or more sold a day</p>
          </button>
          <button onClick={() => setView("slow")} className={cn("rounded-xl border p-4 text-left", view === "slow" ? "border-primary bg-primary/5" : "border-border bg-card")}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Snail className="h-3.5 w-3.5 text-warning" /> Slow movers</p>
            <p className="mt-1 text-xl font-bold">{byProduct.filter((p) => p.perDay < 1 / 7).length}</p><p className="text-[11px] text-muted-foreground">Less than 1 a week</p>
          </button>
          <button onClick={() => setView("dead")} className={cn("rounded-xl border p-4 text-left", view === "dead" ? "border-primary bg-primary/5" : "border-border bg-card")}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Ban className="h-3.5 w-3.5 text-destructive" /> Not selling</p>
            <p className="mt-1 text-xl font-bold">{dead.length}</p><p className="text-[11px] text-muted-foreground">{money(dead.reduce((s, p) => s + p.value, 0))} of stock sitting</p>
          </button>
        </div>
        {view !== "dead" ? (
          <Panel title={view === "fast" ? "Fastest moving products" : "Slowest moving products (in stock)"} subtitle={`Speed = units sold per day over ${days} day${days === 1 ? "" : "s"}`}
            actions={<ExportButton onClick={() => downloadCSV(`${shop}_${view}_movers_${stamp}.csv`, [["Product", "Category", "Units sold", "Per day", "Speed", "In stock", "Days left", `Revenue (${currencyCode()})`, "Last sold"],
              ...(view === "fast" ? fast : slow).map((p) => [p.name, p.category, p.qty, p.perDay.toFixed(2), cls(p), p.onHand, Number.isFinite(p.cover) ? p.cover.toFixed(0) : "", p.revenue.toFixed(2), p.lastSold])])} />}>
            <Table align={["left", "left", "right", "right", "left", "right", "right", "left"]}
              head={["Product", "Category", "Units", "Per day", "Speed", "In stock", "Days left", "Last sold"]}
              rows={(view === "fast" ? fast : slow).filter((p) => matches(p.name, p.category)).map((p) => [<span key="n" className="font-medium">{p.name}</span>, p.category, p.qty, p.perDay.toFixed(2),
                <span key="c" className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", cls(p) === "Fast" ? "bg-success/10 text-success" : cls(p) === "Steady" ? "bg-info/10 text-info" : "bg-warning/10 text-warning")}>{cls(p)}</span>,
                p.onHand, Number.isFinite(p.cover) ? <span key="d" className={cn(p.cover < 7 && "font-semibold text-destructive")}>{p.cover < 1 ? "<1" : p.cover.toFixed(0)}</span> : "—", format(new Date(p.lastSold), "d MMM")])} />
          </Panel>
        ) : (
          <Panel title="In stock but not sold in this period" subtitle="Consider a promotion, a price change or stop reordering"
            actions={<ExportButton onClick={() => downloadCSV(`${shop}_not_selling_${stamp}.csv`, [["Product", "Category", "In stock", `Stock value (${currencyCode()})`], ...dead.map((p) => [p.name, p.category || "", p.stock, p.value.toFixed(2)])])} />}>
            <Table align={["left", "left", "right", "right"]} head={["Product", "Category", "In stock", "Stock value"]}
              rows={dead.filter((p) => matches(p.name, p.category)).map((p) => [<span key="n" className="font-medium">{p.name}</span>, p.category || "—", Number(p.stock), money(p.value)])} />
          </Panel>
        )}
      </div>
    );
  }

  function StaffTab() {
    return (
      <Panel title="Sales by staff member"
        actions={<ExportButton onClick={() => downloadCSV(`${shop}_staff_${stamp}.csv`, [["Staff", "Sales", "Units", "Cash", "M-Pesa", "Other", "Discounts", `Total (${currencyCode()})`, `Profit (${currencyCode()})`, `Average (${currencyCode()})`, "Share %"],
          ...byStaff.map((s) => [s.label, s.count, s.units, s.cash.toFixed(2), s.mpesa.toFixed(2), s.other.toFixed(2), s.discount.toFixed(2), s.revenue.toFixed(2), s.profit.toFixed(2), (s.count ? s.revenue / s.count : 0).toFixed(2), pct(s.revenue, cur.revenue).toFixed(1)])])} />}>
        <Table align={["left", "center", "right", "right", "right", "right", "right", "right", "right", "right"]}
          head={["Staff", "Sales", "Units", "Cash", "M-Pesa", "Other", "Discounts", "Total", "Profit", "Avg sale"]}
          rows={byStaff.filter((s) => matches(s.label)).map((s) => [<span key="n" className="font-medium">{s.label}</span>, s.count, s.units, money(s.cash), money(s.mpesa), money(s.other), money(s.discount),
            <strong key="t">{money(s.revenue)}</strong>, money(s.profit), money(s.count ? s.revenue / s.count : 0)])}
          footer={["Total", cur.count, cur.units, "", "", "", money(cur.discount), money(cur.revenue), money(byStaff.reduce((a, s) => a + s.profit, 0)), money(avgBasket)]} />
      </Panel>
    );
  }

  function StockTab() {
    const [level, setLevel] = [stockLevel, setStockLevel];
    const [reason, setReason] = [stockReason, setStockReason];
    const sold = new Map(byProduct.map((p) => [p.id, p.qty]));
    const rows = (stock as any[]).filter((p) => matches(p.name, p.sku, p.category) && (category === "all" || (p.category || "Other") === category))
      .filter((p) => level === "all" ? true : level === "out" ? Number(p.stock) <= 0 : level === "low" ? Number(p.stock) > 0 && Number(p.stock) <= Number(p.reorder_level || 0) : Number(p.stock) > Number(p.reorder_level || 0))
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));
    const value = rows.reduce((s, p) => s + Number(p.stock || 0) * (Number(p.cost_price) || Number(p.price) || 0), 0);
    const moves = (office?.adjustments || []).filter((a: any) => within(a.created_at, range) && matches(a.products?.name, a.reason) && (reason === "all" || a.reason === reason)
      && (branch === "all" || a.location_id === branch));
    const reasons = Array.from(new Set((office?.adjustments || []).map((a: any) => a.reason))).filter(Boolean) as string[];
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Stock levels" subtitle={`${rows.length} products · stock value ${money(value)}`}
          actions={<>
            <Select value={level} onChange={setLevel} label="Level" className="h-8 min-w-0 text-xs"><option value="all">All</option><option value="out">Out of stock</option><option value="low">Low</option><option value="ok">OK</option></Select>
            <ExportButton onClick={() => downloadCSV(`${shop}_stock_${stamp}.csv`, [["Product", "Category", "In stock", "Reorder level", "Sold in period", "Cost", "Stock value", "Status"],
              ...rows.map((p) => [p.name, p.category || "", Number(p.stock || 0), Number(p.reorder_level || 0), sold.get(p.id) || 0, p.cost_price, (Number(p.stock || 0) * (Number(p.cost_price) || Number(p.price) || 0)).toFixed(2), Number(p.stock) <= 0 ? "Out" : Number(p.stock || 0) <= Number(p.reorder_level || 0) ? "Low" : "OK"])])} />
          </>}>
          <Table align={["left", "right", "right", "right", "right"]} head={["Product", "In stock", "Reorder at", "Sold", "Value"]}
            rows={rows.map((p) => [<span key="n" className="inline-flex items-center gap-1.5">{Number(p.stock || 0) <= Number(p.reorder_level || 0) && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}{p.name}</span>,
              Number(p.stock || 0), Number(p.reorder_level || 0), sold.get(p.id) || 0, money(Number(p.stock || 0) * (Number(p.cost_price) || Number(p.price) || 0))])} />
        </Panel>
        <Panel title="Stock movements" subtitle={`${moves.length} in period`}
          actions={<>
            <Select value={reason} onChange={setReason} label="Reason" className="h-8 min-w-0 text-xs"><option value="all">All reasons</option>{reasons.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</Select>
            <ExportButton onClick={() => downloadCSV(`${shop}_stock_movements_${stamp}.csv`, [["Date", "Product", "Change", "Before", "After", "Reason", "Branch"], ...moves.map((a: any) => [a.created_at, a.products?.name || "", a.quantity_change, a.stock_before, a.stock_after, a.reason, branchName(a.location_id)])])} />
          </>}>
          <Table align={["left", "left", "right", "right", "left"]} head={["Date", "Product", "Change", "After", "Reason"]}
            rows={moves.map((a: any) => [<span key="d" className="whitespace-nowrap">{format(new Date(a.created_at), "d MMM, HH:mm")}</span>, a.products?.name || "—",
              <span key="c" className={Number(a.quantity_change) >= 0 ? "text-success" : "text-destructive"}>{Number(a.quantity_change) > 0 ? "+" : ""}{Number(a.quantity_change)}</span>,
              Number(a.stock_after ?? 0), <span key="r" className="capitalize">{String(a.reason || "").replace(/_/g, " ")}</span>])} />
        </Panel>
      </div>
    );
  }

  function ExpensesTab() {
    const exp = (office?.expenses || []).filter((e: any) => within(e.expense_date, range) && (branch === "all" || e.location_id === branch) && matches(e.description, e.category_name));
    const cats = new Map<string, number>();
    exp.forEach((e: any) => cats.set(e.category_name || "Other", (cats.get(e.category_name || "Other") || 0) + Number(e.amount || 0)));
    const bills = (office?.bills || []).filter((b: any) => (within(b.created_at, range) || Number(b.amount) - Number(b.amount_paid || 0) > 0.009) && matches(b.name, b.status));
    const payments = (office?.billPayments || []).filter((p: any) => within(p.paid_on, range));
    const expSum = exp.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Expenses by category" subtitle={money(expSum)}>
          <Table align={["left", "right", "right"]} head={["Category", "Amount", "Share"]}
            rows={Array.from(cats.entries()).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, money(v), `${pct(v, expSum).toFixed(1)}%`])} />
        </Panel>
        <Panel title="Payments made" subtitle={`${payments.length} payments · ${money(payments.reduce((s: number, p: any) => s + Number(p.amount), 0))}`}>
          <Table align={["left", "left", "left", "right"]} head={["Date", "For", "Method", "Amount"]}
            rows={payments.map((p: any) => [p.paid_on, p.purchase_id ? "Purchase order" : "Bill", methodLabel(p.method), money(Number(p.amount))])} />
        </Panel>
        <Panel title="Expenses" subtitle={`${exp.length} entries`}
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_expenses_${stamp}.csv`, [["Date", "Description", "Category", `Amount (${currencyCode()})`], ...exp.map((e: any) => [e.expense_date, e.description, e.category_name || "", e.amount])])} />}>
          <Table align={["left", "left", "left", "right"]} head={["Date", "Description", "Category", "Amount"]}
            rows={exp.map((e: any) => [e.expense_date || "—", e.description || "—", e.category_name || "—", money(Number(e.amount || 0))])}
            footer={["Total", "", "", money(expSum)]} />
        </Panel>
        <Panel title="Bills" subtitle={`${bills.filter((b: any) => Number(b.amount) - Number(b.amount_paid || 0) > 0.009).length} with money owed`}
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_bills_${stamp}.csv`, [["Created", "Bill", "Status", "Due", `Amount (${currencyCode()})`, "Paid", "Balance"],
            ...bills.map((b: any) => [b.created_at, b.name, b.status, b.next_due_date || "", b.amount, b.amount_paid || 0, Math.max(0, Number(b.amount) - Number(b.amount_paid || 0))])])} />}>
          <Table align={["left", "left", "left", "right", "right"]} head={["Bill", "Status", "Due", "Amount", "Balance"]}
            rows={bills.map((b: any) => [b.name || "—", <span key="s" className="capitalize">{b.status === "partial" ? "part paid" : b.status || "—"}</span>, b.next_due_date || "—",
              money(Number(b.amount || 0)), money(Math.max(0, Number(b.amount) - Number(b.amount_paid || 0)))])} />
        </Panel>
      </div>
    );
  }

  function PurchasesTab() {
    const rows = (office?.purchases || []).filter((p: any) => within(p.created_at, range) && (branch === "all" || p.location_id === branch) && matches(p.supplier_name, p.status));
    const sup = new Map<string, { name: string; orders: number; total: number; paid: number }>();
    rows.forEach((p: any) => {
      const k = p.supplier_name || "Unknown";
      const r = sup.get(k) || { name: k, orders: 0, total: 0, paid: 0 };
      r.orders++; r.total += Number(p.total || 0); r.paid += Number(p.amount_paid || 0);
      sup.set(k, r);
    });
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="By supplier" subtitle={`${sup.size} suppliers`}>
          <Table align={["left", "center", "right", "right", "right"]} head={["Supplier", "Orders", "Bought", "Paid", "Owed"]}
            rows={Array.from(sup.values()).sort((a, b) => b.total - a.total).map((s) => [s.name, s.orders, money(s.total), money(s.paid), money(Math.max(0, s.total - s.paid))])} />
        </Panel>
        <Panel title="Purchase orders" subtitle={`${rows.length} orders · ${money(rows.reduce((s: number, p: any) => s + Number(p.total || 0), 0))}`}
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_purchases_${stamp}.csv`, [["Date", "PO", "Supplier", "Status", "Payment", "Currency", `Total (${currencyCode()})`, "Paid"],
            ...rows.map((p: any) => [p.created_at, String(p.id).slice(0, 8).toUpperCase(), p.supplier_name || "", p.status || "", p.payment_status || "", p.currency || currencyCode(), p.total, p.amount_paid || 0])])} />}>
          <Table align={["left", "left", "left", "left", "right"]} head={["Date", "Supplier", "Received", "Payment", "Total"]}
            rows={rows.map((p: any) => [format(new Date(p.created_at), "d MMM yyyy"), p.supplier_name || "—", <span key="s" className="capitalize">{String(p.status || "").replace("_", " ")}</span>,
              <span key="p" className="capitalize">{p.payment_status || "unpaid"}</span>, money(Number(p.total || 0))])} />
        </Panel>
      </div>
    );
  }

  function CustomersTab() {
    const named = byCustomer.filter((c) => c.id !== "walk-in");
    const walk = byCustomer.find((c) => c.id === "walk-in");
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Named customers" value={named.length.toLocaleString()} />
          <Kpi label="Their share of sales" value={`${pct(named.reduce((s, c) => s + c.revenue, 0), cur.revenue).toFixed(0)}%`} />
          <Kpi label="Walk-in sales" value={money(walk?.revenue || 0)} hint={`${walk?.count || 0} sales`} />
          <Kpi label="Repeat customers" value={named.filter((c) => c.count > 1).length.toLocaleString()} hint="Bought more than once" />
        </div>
        <Panel title="Customers" subtitle="Ranked by spend in this period"
          actions={<ExportButton onClick={() => downloadCSV(`${shop}_customers_${stamp}.csv`, [["Customer", "Visits", "Units", `Spent (${currencyCode()})`, `Profit (${currencyCode()})`, "Average", "First visit", "Last visit"],
            ...byCustomer.map((c) => [c.name, c.count, c.units, c.revenue.toFixed(2), c.profit.toFixed(2), (c.count ? c.revenue / c.count : 0).toFixed(2), c.first, c.last])])} />}>
          <Table align={["left", "center", "right", "right", "right", "right", "left"]} head={["Customer", "Visits", "Units", "Spent", "Profit", "Average", "Last visit"]}
            rows={byCustomer.filter((c) => matches(c.name)).map((c) => [<span key="n" className="font-medium">{c.name}</span>, c.count, c.units, money(c.revenue), money(c.profit), money(c.count ? c.revenue / c.count : 0), format(new Date(c.last), "d MMM yyyy")])} />
        </Panel>
      </div>
    );
  }

  function ChartsTab() {
    const [metric, setMetric] = [chartMetric, setChartMetric];
    const [group, setGroup] = [chartGroup, setChartGroup];
    const [topN, setTopN] = [chartTop, setChartTop];
    const n = Number(topN);
    const trend = (() => {
      const m = new Map<string, { label: string; revenue: number; profit: number; units: number; count: number }>();
      byDay.forEach((d) => {
        const dt = new Date(d.key);
        const key = group === "day" ? d.key : group === "month" ? d.key.slice(0, 7) : (() => { const s = new Date(dt); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s.toISOString().slice(0, 10); })();
        const label = group === "day" ? format(dt, "d MMM") : group === "month" ? format(dt, "MMM yyyy") : `Wk ${format(new Date(key), "d MMM")}`;
        const r = m.get(key) || { label, revenue: 0, profit: 0, units: 0, count: 0 };
        r.revenue += d.revenue; r.profit += d.profit; r.units += d.units; r.count += d.count;
        m.set(key, r);
      });
      return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => ({ ...v, avg: v.count ? v.revenue / v.count : 0, margin: v.revenue ? (v.profit / v.revenue) * 100 : 0 }));
    })();
    const metricLabel = metric === "revenue" ? "Sales" : metric === "profit" ? "Profit" : "Units";
    const fmt = (v: any) => (metric === "units" ? Number(v).toLocaleString() : formatKES(Number(v)));
    const topProducts = [...byProduct].sort((a, b) => (metric === "units" ? b.qty - a.qty : metric === "profit" ? b.profit - a.profit : b.revenue - a.revenue)).slice(0, n)
      .map((p) => ({ name: p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name, value: metric === "units" ? p.qty : metric === "profit" ? p.profit : p.revenue }));
    const catData = byCategory.slice(0, 9).map((c) => ({ name: c.name, value: metric === "units" ? c.qty : metric === "profit" ? c.profit : c.revenue }));
    const staffData = byStaff.slice(0, n).map((s) => ({ name: s.label, value: metric === "units" ? s.units : metric === "profit" ? s.profit : s.revenue }));
    const branchData = byBranch.map((b) => ({ name: b.label, value: metric === "units" ? b.units : metric === "profit" ? b.profit : b.revenue }));
    const expCats = (() => {
      const m = new Map<string, number>();
      (office?.expenses || []).filter((e: any) => within(e.expense_date, range)).forEach((e: any) => m.set(e.category_name || "Other", (m.get(e.category_name || "Other") || 0) + Number(e.amount || 0)));
      return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    })();
    const customerData = byCustomer.filter((c) => c.id !== "walk-in").slice(0, n).map((c) => ({ name: c.name, value: metric === "units" ? c.units : metric === "profit" ? c.profit : c.revenue }));
    const seg = (value: string, set: (v: any) => void, opts: [string, string][]) => (
      <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
        {opts.map(([v, l]) => <button key={v} onClick={() => set(v)} className={cn("rounded-md px-2.5 py-1 font-medium", value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{l}</button>)}
      </div>
    );
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="text-sm font-medium">Show</span>
          {seg(metric, setMetric, [["revenue", "Sales"], ["profit", "Profit"], ["units", "Units"]])}
          <span className="text-sm font-medium">Group by</span>
          {seg(group, setGroup, [["day", "Day"], ["week", "Week"], ["month", "Month"]])}
          <span className="text-sm font-medium">Top</span>
          {seg(topN, setTopN, [["5", "5"], ["10", "10"], ["20", "20"]])}
          <span className="text-xs text-muted-foreground">Every chart also follows the filters at the top.</span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title={`1. ${metricLabel} over time`} subtitle={`By ${group}`}>
            <AreaChart data={trend}>
              <defs><linearGradient id="rt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={fmt} /><Area dataKey={metric} name={metricLabel} stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#rt)" />
            </AreaChart>
          </ChartCard>
          <ChartCard title="2. Sales and profit" subtitle={`By ${group}`}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={moneyTip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name="Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name="Profit" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="3. Number of sales" subtitle={`By ${group}`}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={36} allowDecimals={false} />
              <Tooltip {...tip} /><Bar dataKey="count" name="Sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="4. Average sale and margin" subtitle={`By ${group}`}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis yAxisId="l" {...axis} width={48} tickFormatter={short} /><YAxis yAxisId="r" orientation="right" {...axis} width={36} unit="%" />
              <Tooltip {...tip} formatter={(v: any, name: any) => (name === "Margin" ? `${Number(v).toFixed(1)}%` : formatKES(Number(v)))} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" dataKey="avg" name="Average sale" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line yAxisId="r" dataKey="margin" name="Margin" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>
          <ChartCard title="5. Busiest hours" subtitle="Sales by hour of the day">
            <BarChart data={byHour.filter((h, i) => i >= Number(hourFrom) && i <= Number(hourTo))}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hour" {...axis} interval={1} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={moneyTip} /><Bar dataKey="revenue" name="Sales" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="6. Busiest days of the week">
            <BarChart data={byWeekday}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="day" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={moneyTip} /><Bar dataKey="revenue" name="Sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title={`7. Top ${n} products`} subtitle={`By ${metricLabel.toLowerCase()}`} tall>
            <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" {...axis} tickFormatter={short} /><YAxis dataKey="name" type="category" width={150} {...axis} />
              <Tooltip {...tip} formatter={fmt} /><Bar dataKey="value" name={metricLabel} fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="8. Categories" subtitle={`Share of ${metricLabel.toLowerCase()}`} tall>
            <PieChart>
              <Pie data={catData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={100} paddingAngle={2} label={(e: any) => e.name}>
                {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} formatter={fmt} />
            </PieChart>
          </ChartCard>
          <ChartCard title="9. Payment methods" subtitle="Share of sales">
            <PieChart>
              <Pie data={byMethod.map((m) => ({ name: m.label, value: m.revenue }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} label={(e: any) => e.name}>
                {byMethod.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} formatter={moneyTip} />
            </PieChart>
          </ChartCard>
          <ChartCard title="10. Staff performance" subtitle={`By ${metricLabel.toLowerCase()}`}>
            <BarChart data={staffData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={fmt} /><Bar dataKey="value" name={metricLabel} fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="11. Branches" subtitle={`By ${metricLabel.toLowerCase()}`}>
            <BarChart data={branchData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={fmt} /><Bar dataKey="value" name={metricLabel} fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title={`12. Top ${n} customers`} subtitle={`By ${metricLabel.toLowerCase()} (named customers)`}>
            <BarChart data={customerData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" {...axis} tickFormatter={short} /><YAxis dataKey="name" type="category" width={130} {...axis} />
              <Tooltip {...tip} formatter={fmt} /><Bar dataKey="value" name={metricLabel} fill="#ec4899" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard title="13. Where the money goes" subtitle="Expenses by category">
            <PieChart>
              <Pie data={expCats} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2} label={(e: any) => e.name}>
                {expCats.map((_, i) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} formatter={moneyTip} />
            </PieChart>
          </ChartCard>
          <ChartCard title="14. Cash vs M-Pesa vs other" subtitle={`By ${group === "day" ? "day" : "day in period"}`}>
            <BarChart data={byDay.map((d) => ({ label: format(new Date(d.key), "d MMM"), cash: d.cash, mpesa: d.mpesa, other: d.other }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
              <Tooltip {...tip} formatter={moneyTip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cash" name="Cash" stackId="a" fill="#0ea5e9" /><Bar dataKey="mpesa" name="M-Pesa" stackId="a" fill="#16a34a" /><Bar dataKey="other" name="Other" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
      </div>
    );
  }
}
