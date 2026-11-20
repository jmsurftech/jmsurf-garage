import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3, Droplets, Wallet, TrendingUp, Truck, Bike, Users, Download, LayoutDashboard, Receipt, Package, Ticket,
  CreditCard, LineChart as LineIcon, Clock, AlertTriangle, PieChart as PieIcon,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { PageHeader, Panel, StatTile, StatGrid, PageLoader, TableWrap, Segmented, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useCustomers } from "@/hooks/useData";
import { formatKES } from "@/lib/format";
import { formatLitres } from "@/lib/businessType";
import { cn } from "@/lib/utils";
import { useWaterTanks } from "@/hooks/useWaterTanks";
import { ORDER_STATUS, useWaterOrders } from "@/lib/waterOrders";
import { TICKET_STATUS, categoryLabel } from "@/lib/tickets";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
type Range = "1" | "7" | "30" | "90" | "365";
type Tab = "overview" | "sales" | "items" | "orders" | "riders" | "tanks" | "customers" | "payments" | "expenses" | "tickets" | "charts";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "sales", label: "Sales", icon: Receipt },
  { key: "items", label: "Sizes & items", icon: Package },
  { key: "orders", label: "Orders & delivery", icon: Truck },
  { key: "riders", label: "Riders", icon: Bike },
  { key: "tanks", label: "Tanks & water", icon: Droplets },
  { key: "customers", label: "Customers", icon: Users },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "expenses", label: "Expenses & bills", icon: Wallet },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "charts", label: "Charts", icon: LineIcon },
];

const COLORS = ["#0ea5e9", "hsl(var(--primary))", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#64748b", "#ec4899", "#84cc16", "#f97316"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const tip = { contentStyle: { borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 } };
const axis = { fontSize: 11, tickLine: false, axisLine: false, tick: { fill: "hsl(var(--muted-foreground))" } } as const;
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const money = (v: any) => formatKES(Number(v));
const num = (v: any) => Number(v) || 0;
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const L = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`;
const METHOD: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", card: "Card", credit: "On credit", online: "Online", bank: "Bank", split: "Split", cheque: "Cheque" };
const methodLabel = (m?: string | null) => METHOD[String(m || "")] || String(m || "Other");
const isRefund = (t: any) => !!t.refund_of || t.payment_method === "credit_note" || num(t.total) < 0;
const mins = (a?: string | null, b?: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60000 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtMin = (m: number | null) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

type Kind = "refill" | "container" | "item" | "service";
const lineKind = (i: any): Kind => (num(i.litres) > 0 ? "refill" : num(i.container_litres) > 0 ? "container" : i.is_service ? "service" : "item");
const KIND_LABEL: Record<Kind, string> = { refill: "Refill", container: "Bottle / jerrican", item: "Item", service: "Service" };

function csv(name: string, rows: (string | number)[][]) {
  const esc = (v: any) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
}

function ChartCard({ title, subtitle, children, tall }: { title: string; subtitle?: string; children: React.ReactElement; tall?: boolean }) {
  return (
    <Panel title={title} description={subtitle} icon={PieIcon}>
      <div className={tall ? "h-80" : "h-64"}><ResponsiveContainer debounce={120}>{children}</ResponsiveContainer></div>
    </Panel>
  );
}

function Table({ head, rows, empty = "Nothing in this period", right = [] }: { head: string[]; rows: React.ReactNode[][]; empty?: string; right?: number[] }) {
  return (
    <TableWrap>
      <table className="dt">
        <thead><tr>{head.map((h, i) => <th key={h} className={right.includes(i) ? "text-right" : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          <PagedRows rows={rows} colSpan={head.length} after={<>{rows.length === 0 && <tr><td colSpan={head.length} className="text-center text-muted-foreground">{empty}</td></tr>}</>}>{(pageRows) => pageRows.map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} className={right.includes(i) ? "text-right tabular-nums" : undefined}>{c}</td>)}</tr>)}</PagedRows>
        </tbody>
      </table>
    </TableWrap>
  );
}

const ExportBtn = ({ onClick }: { onClick: () => void }) => <Button size="sm" variant="outline" onClick={onClick}><Download /> CSV</Button>;

/** Water shop reports: everything in the system, tab by tab, plus a Charts tab. */
export default function WaterReports() {
  const tenantId = useTenantId();
  const nav = useNavigate();
  const base = useLocation().pathname.replace(/\/water\/reports\/?$/, "");
  const [range, setRange] = useState<Range>("30");
  const [tab, setTab] = useState<Tab>("overview");
  const since = useMemo(() => {
    if (range === "1") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
    return new Date(Date.now() - Number(range) * 86400_000).toISOString();
  }, [range]);
  const { data: tanks = [] } = useWaterTanks();
  const { data: allOrders = [] } = useWaterOrders();
  const { data: customers = [] } = useCustomers();

  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["water-report-sales", tenantId, since],
    enabled: !!tenantId,
    queryFn: async () => {
      const out: any[] = [];
      for (let from = 0; from < 30000; from += 1000) {
        const { data, error } = await sb.from("transactions")
          .select("id,created_at,items,total,discount,subtotal,payment_method,split_payments,customer_id,customer_name,cashier_name,status,refund_of")
          .eq("tenant_id", tenantId).eq("status", "completed").gte("created_at", since).order("created_at").range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });
  const { data: moves = [] } = useQuery({
    queryKey: ["water-report-moves", tenantId, since],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("water_tank_movements").select("tank_id,kind,litres,total_cost,cost_per_litre,created_at,supplier,note")
        .eq("tenant_id", tenantId).gte("created_at", since).order("created_at").limit(20000);
      if (error) throw error;
      return data || [];
    },
  });
  const { data: office = { expenses: [], bills: [] } } = useQuery({
    queryKey: ["water-report-office", tenantId, since],
    enabled: !!tenantId,
    queryFn: async () => {
      const [e, b] = await Promise.all([
        sb.from("expenses").select("*").eq("tenant_id", tenantId).gte("expense_date", since.slice(0, 10)).order("expense_date", { ascending: false }).limit(5000),
        sb.from("bills").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
      ]);
      return { expenses: e.data || [], bills: (b.data || []).filter((x: any) => x.created_at >= since || num(x.amount) - num(x.amount_paid) > 0.009) };
    },
  });
  const { data: tickets = [] } = useQuery({
    queryKey: ["water-report-tickets", tenantId, since],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("support_tickets").select("*").eq("tenant_id", tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
      return error ? [] : data || [];
    },
  });

  const r = useMemo(() => {
    const sales = txs.filter((t: any) => !isRefund(t));
    const refunds = txs.filter((t: any) => isRefund(t));
    const byProduct = new Map<string, { name: string; kind: Kind; qty: number; litres: number; revenue: number; cost: number }>();
    const byDay = new Map<string, { key: string; count: number; litres: number; revenue: number; cost: number; discount: number }>();
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}`, revenue: 0, litres: 0 }));
    const byWeekday = WEEKDAYS.map((day) => ({ day, revenue: 0, litres: 0 }));
    const byCustomer = new Map<string, { id: string; name: string; litres: number; revenue: number; visits: number; last: string }>();
    const byMethod = new Map<string, { method: string; count: number; amount: number }>();
    const byKind: Record<Kind, number> = { refill: 0, container: 0, item: 0, service: 0 };
    let litres = 0, revenue = 0, cost = 0, discount = 0, withContainer = 0, refillSales = 0;
    for (const s of sales) {
      const items: any[] = Array.isArray(s.items) ? s.items : [];
      const gross = items.reduce((a, i) => a + num(i.price) * num(i.quantity), 0) || 1;
      const factor = num(s.total) / gross; // spread the sale's discount over its lines
      let saleL = 0, saleCost = 0, hasRefill = false, hasCont = false;
      for (const i of items) {
        const q = num(i.quantity), k = lineKind(i);
        const rev = num(i.price) * q * factor, c = num(i.cost_price) * q, l = num(i.litres) * q;
        saleL += l; saleCost += c; byKind[k] += rev;
        if (k === "refill") hasRefill = true;
        if (k === "container") hasCont = true;
        const key = i.product_id || i.id || i.name;
        const p = byProduct.get(key) || { name: i.name || "Item", kind: k, qty: 0, litres: 0, revenue: 0, cost: 0 };
        p.qty += q; p.litres += l; p.revenue += rev; p.cost += c;
        byProduct.set(key, p);
      }
      if (hasRefill) { refillSales++; if (hasCont) withContainer++; }
      litres += saleL; revenue += num(s.total); cost += saleCost; discount += num(s.discount);
      const dk = dayKey(s.created_at);
      const d = byDay.get(dk) || { key: dk, count: 0, litres: 0, revenue: 0, cost: 0, discount: 0 };
      d.count++; d.litres += saleL; d.revenue += num(s.total); d.cost += saleCost; d.discount += num(s.discount);
      byDay.set(dk, d);
      const dt = new Date(s.created_at);
      byHour[dt.getHours()].revenue += num(s.total); byHour[dt.getHours()].litres += saleL;
      byWeekday[(dt.getDay() + 6) % 7].revenue += num(s.total); byWeekday[(dt.getDay() + 6) % 7].litres += saleL;
      if (s.customer_id) {
        const c = byCustomer.get(s.customer_id) || { id: s.customer_id, name: s.customer_name || "Customer", litres: 0, revenue: 0, visits: 0, last: s.created_at };
        c.litres += saleL; c.revenue += num(s.total); c.visits++; c.last = s.created_at;
        byCustomer.set(s.customer_id, c);
      }
      const splits: any[] = Array.isArray(s.split_payments) && s.split_payments.length ? s.split_payments : [{ method: s.payment_method, amount: s.total }];
      for (const sp of splits) {
        const m = byMethod.get(sp.method) || { method: sp.method, count: 0, amount: 0 };
        m.count++; m.amount += num(sp.amount);
        byMethod.set(sp.method, m);
      }
    }
    const refundTotal = refunds.reduce((a: number, t: any) => a + Math.abs(num(t.total)), 0);
    const purchases = moves.filter((m: any) => m.kind === "purchase");
    const wastage = moves.filter((m: any) => m.kind === "wastage" || (m.kind === "adjust" && num(m.litres) < 0));
    const orders = allOrders.filter((o) => o.created_at >= since);
    const riders = new Map<string, { name: string; assigned: number; delivered: number; cash: number; mpesa: number; litres: number; minutes: number[]; last: string | null }>();
    for (const o of orders) {
      if (!o.rider_id) continue;
      const x = riders.get(o.rider_id) || { name: o.rider_name || "Rider", assigned: 0, delivered: 0, cash: 0, mpesa: 0, litres: 0, minutes: [], last: null };
      x.assigned++;
      if (o.status === "paid") {
        x.delivered++; x.litres += o.litres_total;
        if (o.payment_method === "cash") x.cash += o.total; else x.mpesa += o.total;
        const m = mins(o.assigned_at, o.delivered_at); if (m != null && m >= 0) x.minutes.push(m);
        if (!x.last || String(o.paid_at) > x.last) x.last = o.paid_at;
      }
      riders.set(o.rider_id, x);
    }
    const expenses = office.expenses.reduce((a: number, e: any) => a + num(e.amount), 0);
    const billsInRange = office.bills.filter((b: any) => b.created_at >= since);
    const billTotal = billsInRange.reduce((a: number, b: any) => a + num(b.amount), 0);
    return {
      sales, refunds, refundTotal, litres, revenue, cost, discount, profit: revenue - cost, withContainer, refillSales, byKind,
      products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
      days: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
      byHour, byWeekday,
      customers: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue),
      methods: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
      purchases, wastage,
      bought: purchases.reduce((a: number, m: any) => a + num(m.litres), 0),
      boughtCost: purchases.reduce((a: number, m: any) => a + num(m.total_cost), 0),
      wasted: wastage.reduce((a: number, m: any) => a - num(m.litres), 0),
      orders,
      riders: [...riders.values()].sort((a, b) => b.delivered - a.delivered),
      expenses, billTotal, billsInRange,
    };
  }, [txs, moves, allOrders, since, office]);

  if (isLoading) return <PageLoader label="Building the report…" />;

  const otherExpenses = r.expenses + r.billsInRange.filter((b: any) => (b.category || b.category_name) !== "Water Purchase").reduce((a: number, b: any) => a + num(b.amount), 0);
  const net = r.profit - otherExpenses;
  const paidOrders = r.orders.filter((o) => o.status === "paid");
  const deliveryMins = paidOrders.map((o) => mins(o.created_at, o.delivered_at)).filter((m): m is number => m != null && m >= 0);
  const openTickets = tickets.filter((t: any) => !["resolved", "closed"].includes(t.status)).length;
  const rangeLabel = range === "1" ? "today" : `last ${range} days`;

  const go = (id: string) => nav(`${base}/customers/${id}`);

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" icon={BarChart3} description={`Everything in your water shop, ${rangeLabel}: sales, sizes, deliveries, riders, tanks, customers, money and tickets.`}
        actions={<Segmented value={range} onChange={(v) => setRange(v as Range)} options={[
          { value: "1", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "Year" },
        ]} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Water sold" value={L(r.litres)} hint={`${formatKES(r.litres ? r.byKind.refill / r.litres : 0)}/L average`} icon={Droplets} tone="info" />
        <StatTile label="Sales" value={formatKES(r.revenue)} hint={`${r.sales.length} sales`} icon={Receipt} tone="primary" />
        <StatTile label="Gross profit" value={formatKES(r.profit)} hint={r.revenue ? `${Math.round((r.profit / r.revenue) * 100)}% margin` : undefined} icon={TrendingUp} tone={r.profit >= 0 ? "success" : "danger"} />
        <StatTile label="Net profit" value={formatKES(net)} hint="after expenses & other bills" icon={Wallet} tone={net >= 0 ? "success" : "danger"} />
        <StatTile label="Deliveries" value={paidOrders.length} hint={`avg ${fmtMin(avg(deliveryMins))} order → door`} icon={Truck} tone="warning" />
        <StatTile label="Open tickets" value={openTickets} hint={`${tickets.length} raised`} icon={Ticket} tone={openTickets ? "danger" : "muted"} />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-secondary p-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <Panel title="Litres sold per day" icon={Droplets}>
            {r.days.length === 0 ? <p className="text-sm text-muted-foreground">No sales in this period.</p> : (
              <div className="h-56"><ResponsiveContainer debounce={120}>
                <BarChart data={r.days.map((d) => ({ ...d, label: d.key.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={44} tickFormatter={short} />
                  <Tooltip {...tip} formatter={(v: any, n: any) => (n === "Litres" ? L(num(v)) : money(v))} />
                  <Bar dataKey="litres" name="Litres" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer></div>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="What sells" icon={Package} flush>
              <Table head={["Kind", "Sales", "Share"]} right={[1, 2]} rows={(Object.keys(r.byKind) as Kind[]).filter((k) => r.byKind[k] > 0).map((k) => [
                KIND_LABEL[k], formatKES(r.byKind[k]), `${r.revenue ? Math.round((r.byKind[k] / r.revenue) * 100) : 0}%`,
              ])} />
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                {r.refillSales ? `${Math.round((r.withContainer / r.refillSales) * 100)}% of refill sales also sold a bottle or jerrican.` : "No refill sales yet."}
              </p>
            </Panel>
            <Panel title="Money in and out" icon={Wallet} flush>
              <Table head={["", "Amount"]} right={[1]} rows={[
                ["Sales", formatKES(r.revenue)],
                ["Refunds", formatKES(-r.refundTotal)],
                ["Cost of what was sold", formatKES(-r.cost)],
                ["Gross profit", <b key="g">{formatKES(r.profit)}</b>],
                ["Expenses", formatKES(-r.expenses)],
                ["Other bills", formatKES(-(otherExpenses - r.expenses))],
                ["Net profit", <b key="n" className={net < 0 ? "text-destructive" : "text-success"}>{formatKES(net)}</b>],
                ["Water bought into tanks", `${L(r.bought)} · ${formatKES(r.boughtCost)}`],
              ]} />
            </Panel>
            <Panel title="Payment methods" icon={CreditCard} flush>
              <Table head={["Method", "Payments", "Amount"]} right={[1, 2]} rows={r.methods.map((m) => [methodLabel(m.method), m.count, formatKES(m.amount)])} />
            </Panel>
            <Panel title="Tanks now" icon={Droplets} flush>
              <Table head={["Tank", "Level", "Capacity", "Status"]} right={[1, 2]} rows={tanks.map((t) => [
                t.name, L(t.current_l), L(t.capacity_l),
                t.current_l <= 0 ? <Pill key="s" tone="danger">Empty</Pill> : t.current_l <= t.alert_level_l ? <Pill key="s" tone="warning">Low</Pill> : <Pill key="s" tone="success">OK</Pill>,
              ])} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="space-y-4">
          <Panel title="Sales by day" icon={Receipt} flush actions={<ExportBtn onClick={() => csv(`water-sales-by-day-${range}d`, [["Date", "Sales", "Litres", "Revenue", "Discounts", "Cost", "Profit"], ...r.days.map((d) => [d.key, d.count, d.litres.toFixed(1), d.revenue.toFixed(2), d.discount.toFixed(2), d.cost.toFixed(2), (d.revenue - d.cost).toFixed(2)])])} />}>
            <Table head={["Date", "Sales", "Litres", "Revenue", "Discounts", "Profit"]} right={[1, 2, 3, 4, 5]}
              rows={[...r.days].reverse().map((d) => [d.key, d.count, L(d.litres), formatKES(d.revenue), formatKES(d.discount), formatKES(d.revenue - d.cost)])} />
          </Panel>
          <Panel title={`Every sale (${r.sales.length})`} icon={Receipt} flush actions={<ExportBtn onClick={() => csv(`water-sales-${range}d`, [["Time", "Customer", "Items", "Method", "Total", "Cashier"], ...r.sales.map((s: any) => [s.created_at, s.customer_name || "Walk-in", (s.items || []).map((i: any) => `${i.quantity} x ${i.name}`).join("; "), methodLabel(s.payment_method), num(s.total), s.cashier_name || ""])])} />}>
            <Table head={["Time", "Customer", "Items", "Method", "Total", "Cashier"]} right={[4]}
              rows={[...r.sales].reverse().slice(0, 300).map((s: any) => [
                new Date(s.created_at).toLocaleString(), s.customer_name || "Walk-in",
                <span key="i" className="text-xs">{(s.items || []).map((i: any) => `${i.quantity} × ${i.name}`).join(", ")}</span>,
                methodLabel(s.payment_method), formatKES(num(s.total)), s.cashier_name || "—",
              ])} />
          </Panel>
          {r.refunds.length > 0 && (
            <Panel title="Refunds" icon={AlertTriangle} flush>
              <Table head={["Time", "Customer", "Amount"]} right={[2]} rows={r.refunds.map((t: any) => [new Date(t.created_at).toLocaleString(), t.customer_name || "Walk-in", formatKES(Math.abs(num(t.total)))])} />
            </Panel>
          )}
        </div>
      )}

      {tab === "items" && (
        <Panel title="Refill sizes, bottles, items and services" icon={Package} flush actions={<ExportBtn onClick={() => csv(`water-items-${range}d`, [["Item", "Kind", "Qty", "Litres", "Revenue", "Cost", "Profit"], ...r.products.map((p) => [p.name, KIND_LABEL[p.kind], p.qty, p.litres.toFixed(1), p.revenue.toFixed(2), p.cost.toFixed(2), (p.revenue - p.cost).toFixed(2)])])} />}>
          <Table head={["Item", "Kind", "Sold", "Litres", "Revenue", "Profit", "Margin"]} right={[2, 3, 4, 5, 6]} rows={r.products.map((p) => [
            <span key="n" className="font-medium">{p.name}</span>, KIND_LABEL[p.kind], p.qty.toLocaleString(), p.litres ? L(p.litres) : "—",
            formatKES(p.revenue), formatKES(p.revenue - p.cost), `${p.revenue ? Math.round(((p.revenue - p.cost) / p.revenue) * 100) : 0}%`,
          ])} />
        </Panel>
      )}

      {tab === "orders" && (
        <div className="space-y-4">
          <StatGrid className="lg:grid-cols-4">
            <StatTile label="Orders placed" value={r.orders.length} hint={L(r.orders.reduce((a, o) => a + o.litres_total, 0))} icon={Truck} tone="primary" />
            <StatTile label="Delivered & paid" value={paidOrders.length} hint={formatKES(paidOrders.reduce((a, o) => a + o.total, 0))} icon={Wallet} tone="success" />
            <StatTile label="Cancelled" value={r.orders.filter((o) => o.status === "cancelled").length} icon={AlertTriangle} tone="danger" />
            <StatTile label="Order → door" value={fmtMin(avg(deliveryMins))} hint={`accepted in ${fmtMin(avg(r.orders.map((o) => mins(o.created_at, o.accepted_at)).filter((m): m is number => m != null && m >= 0)))}`} icon={Clock} tone="info" />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By status" icon={Truck} flush>
              <Table head={["Status", "Orders", "Litres", "Value"]} right={[1, 2, 3]} rows={(Object.keys(ORDER_STATUS) as (keyof typeof ORDER_STATUS)[])
                .map((k) => [k, r.orders.filter((o) => o.status === k)] as const).filter(([, os]) => os.length)
                .map(([k, os]) => [ORDER_STATUS[k].label, os.length, L(os.reduce((a, o) => a + o.litres_total, 0)), formatKES(os.reduce((a, o) => a + o.total, 0))])} />
            </Panel>
            <Panel title="Cancellations" icon={AlertTriangle} flush>
              <Table head={["Order", "Customer", "Reason"]} rows={r.orders.filter((o) => o.status === "cancelled").map((o) => [`#${o.order_no}`, o.customer_name || "—", o.cancel_reason || "—"])} empty="No cancelled orders" />
            </Panel>
          </div>
          <Panel title="Every order" icon={Truck} flush actions={<ExportBtn onClick={() => csv(`water-orders-${range}d`, [["Order", "Placed", "Customer", "Litres", "Total", "Status", "Rider", "Minutes to deliver", "Paid by"], ...r.orders.map((o) => [o.order_no, o.created_at, o.customer_name || "", o.litres_total, o.total, ORDER_STATUS[o.status].label, o.rider_name || "", mins(o.created_at, o.delivered_at)?.toFixed(0) || "", o.payment_method || ""])])} />}>
            <Table head={["Order", "Placed", "Customer", "Litres", "Total", "Status", "Rider", "Took"]} right={[3, 4]} rows={r.orders.slice(0, 300).map((o) => [
              `#${o.order_no}`, new Date(o.created_at).toLocaleString(), o.customer_name || "—", L(o.litres_total), formatKES(o.total),
              <Pill key="s" tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Pill>, o.rider_name || "—", fmtMin(mins(o.created_at, o.delivered_at)),
            ])} />
          </Panel>
        </div>
      )}

      {tab === "riders" && (
        <Panel title="Riders" icon={Bike} flush actions={<ExportBtn onClick={() => csv(`water-riders-${range}d`, [["Rider", "Assigned", "Delivered", "Litres", "Cash", "M-Pesa", "Avg minutes"], ...r.riders.map((x) => [x.name, x.assigned, x.delivered, x.litres, x.cash, x.mpesa, avg(x.minutes)?.toFixed(0) || ""])])} />}>
          <Table head={["Rider", "Assigned", "Delivered", "Litres", "Cash collected", "M-Pesa", "Avg. time", "Last delivery"]} right={[1, 2, 3, 4, 5, 6]}
            rows={r.riders.map((x) => [<span key="n" className="font-medium">{x.name}</span>, x.assigned, x.delivered, L(x.litres), formatKES(x.cash), formatKES(x.mpesa), fmtMin(avg(x.minutes)), x.last ? new Date(x.last).toLocaleString() : "—"])}
            empty="No rider deliveries in this period" />
        </Panel>
      )}

      {tab === "tanks" && (
        <div className="space-y-4">
          <StatGrid className="lg:grid-cols-4">
            <StatTile label="Bought into tanks" value={L(r.bought)} hint={formatKES(r.boughtCost)} icon={Truck} tone="primary" />
            <StatTile label="Sold from tanks" value={L(-moves.filter((m: any) => m.kind === "sale" || m.kind === "return").reduce((a: number, m: any) => a + num(m.litres), 0))} icon={Droplets} tone="info" />
            <StatTile label="Wasted" value={L(r.wasted)} hint={r.bought ? `${((r.wasted / r.bought) * 100).toFixed(1)}% of what was bought` : undefined} icon={AlertTriangle} tone={r.wasted ? "warning" : "success"} />
            <StatTile label="In tanks now" value={L(tanks.reduce((a, t) => a + t.current_l, 0))} icon={Droplets} tone="success" />
          </StatGrid>
          <Panel title="Per tank" icon={Droplets} flush>
            <Table head={["Tank", "Now", "Bought", "Sold", "Wasted / corrected", "Cost / L", "Price / L"]} right={[1, 2, 3, 4, 5, 6]} rows={tanks.map((t) => {
              const m = moves.filter((x: any) => x.tank_id === t.id);
              const sum = (f: (x: any) => boolean) => m.filter(f).reduce((a: number, x: any) => a + num(x.litres), 0);
              return [t.name, L(t.current_l), L(sum((x) => x.kind === "purchase")), L(-sum((x) => x.kind === "sale" || x.kind === "return")),
                L(sum((x) => x.kind === "wastage" || x.kind === "adjust")), formatKES(t.cost_per_litre), formatKES(t.price_per_litre)];
            })} />
          </Panel>
          <Panel title="Purchases" icon={Truck} flush actions={<ExportBtn onClick={() => csv(`water-purchases-${range}d`, [["Date", "Tank", "Litres", "Cost/L", "Total", "Supplier"], ...r.purchases.map((m: any) => [m.created_at, tanks.find((t) => t.id === m.tank_id)?.name || "", m.litres, m.cost_per_litre, m.total_cost, m.supplier || ""])])} />}>
            <Table head={["Date", "Tank", "Litres", "Cost / L", "Total", "Supplier"]} right={[2, 3, 4]} rows={[...r.purchases].reverse().map((m: any) => [
              new Date(m.created_at).toLocaleString(), tanks.find((t) => t.id === m.tank_id)?.name || "—", L(num(m.litres)), formatKES(num(m.cost_per_litre)), formatKES(num(m.total_cost)), m.supplier || "—",
            ])} empty="No tank purchases" />
          </Panel>
          <Panel title="Wastage and corrections" icon={AlertTriangle} flush>
            <Table head={["Date", "Tank", "Litres", "Note"]} right={[2]} rows={[...r.wastage].reverse().map((m: any) => [
              new Date(m.created_at).toLocaleString(), tanks.find((t) => t.id === m.tank_id)?.name || "—", L(num(m.litres)), m.note || "—",
            ])} empty="No wastage recorded" />
          </Panel>
        </div>
      )}

      {tab === "customers" && (() => {
        const fresh = (customers as any[]).filter((c) => c.created_at >= since);
        const owing = (customers as any[]).filter((c) => num(c.balance) > 0).sort((a, b) => num(b.balance) - num(a.balance));
        return (
          <div className="space-y-4">
            <StatGrid className="lg:grid-cols-4">
              <StatTile label="Customers" value={(customers as any[]).length} icon={Users} tone="primary" />
              <StatTile label="New in period" value={fresh.length} icon={Users} tone="success" />
              <StatTile label="Bought in period" value={r.customers.length} hint={`${r.sales.filter((s: any) => !s.customer_id).length} walk-in sales`} icon={Receipt} tone="info" />
              <StatTile label="Owed to you" value={formatKES(owing.reduce((a, c) => a + num(c.balance), 0))} hint={`${owing.length} customers`} icon={Wallet} tone="danger" />
            </StatGrid>
            <Panel title="Top customers" icon={Users} flush actions={<ExportBtn onClick={() => csv(`water-customers-${range}d`, [["Customer", "Purchases", "Litres", "Spent", "Last"], ...r.customers.map((c) => [c.name, c.visits, c.litres.toFixed(1), c.revenue.toFixed(2), c.last])])} />}>
              <Table head={["Customer", "Purchases", "Litres", "Spent", "Last purchase"]} right={[1, 2, 3]} rows={r.customers.slice(0, 50).map((c) => [
                <button key="n" type="button" onClick={() => go(c.id)} className="font-medium hover:text-primary hover:underline">{c.name}</button>,
                c.visits, L(c.litres), formatKES(c.revenue), new Date(c.last).toLocaleDateString(),
              ])} empty="Walk-in sales only" />
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="New customers" icon={Users} flush>
                <Table head={["Customer", "Phone", "Joined"]} rows={fresh.map((c) => [
                  <button key="n" type="button" onClick={() => go(c.id)} className="font-medium hover:text-primary hover:underline">{c.name}</button>, c.phone, new Date(c.created_at).toLocaleDateString(),
                ])} empty="No new customers" />
              </Panel>
              <Panel title="Customers owing" icon={Wallet} flush>
                <Table head={["Customer", "Phone", "Owes"]} right={[2]} rows={owing.slice(0, 50).map((c) => [
                  <button key="n" type="button" onClick={() => go(c.id)} className="font-medium hover:text-primary hover:underline">{c.name}</button>, c.phone, formatKES(num(c.balance)),
                ])} empty="Nobody owes you" />
              </Panel>
            </div>
          </div>
        );
      })()}

      {tab === "payments" && (
        <div className="space-y-4">
          <Panel title="By method" icon={CreditCard} flush>
            <Table head={["Method", "Payments", "Amount", "Share"]} right={[1, 2, 3]} rows={r.methods.map((m) => [methodLabel(m.method), m.count, formatKES(m.amount), `${r.revenue ? Math.round((m.amount / r.revenue) * 100) : 0}%`])} />
          </Panel>
          <Panel title="By day" icon={CreditCard} flush>
            {(() => {
              const methods = r.methods.map((m) => m.method);
              const rows = new Map<string, Record<string, number>>();
              for (const s of r.sales) {
                const k = dayKey(s.created_at);
                const row = rows.get(k) || {};
                const splits: any[] = Array.isArray(s.split_payments) && s.split_payments.length ? s.split_payments : [{ method: s.payment_method, amount: s.total }];
                for (const sp of splits) row[sp.method] = (row[sp.method] || 0) + num(sp.amount);
                rows.set(k, row);
              }
              return <Table head={["Date", ...methods.map(methodLabel), "Total"]} right={methods.map((_, i) => i + 1).concat(methods.length + 1)}
                rows={[...rows.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, v]) => [d, ...methods.map((m) => formatKES(v[m] || 0)), formatKES(Object.values(v).reduce((a, b) => a + b, 0))])} />;
            })()}
          </Panel>
        </div>
      )}

      {tab === "expenses" && (() => {
        const cats = new Map<string, number>();
        office.expenses.forEach((e: any) => cats.set(e.category_name || e.category || "Other", (cats.get(e.category_name || e.category || "Other") || 0) + num(e.amount)));
        return (
          <div className="space-y-4">
            <StatGrid className="lg:grid-cols-3">
              <StatTile label="Expenses" value={formatKES(r.expenses)} icon={Wallet} tone="danger" />
              <StatTile label="Bills raised" value={formatKES(r.billTotal)} hint="includes water purchases" icon={Receipt} tone="warning" />
              <StatTile label="Still owed on bills" value={formatKES(office.bills.reduce((a: number, b: any) => a + Math.max(0, num(b.amount) - num(b.amount_paid)), 0))} icon={AlertTriangle} tone="info" />
            </StatGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Expenses by category" icon={Wallet} flush>
                <Table head={["Category", "Amount"]} right={[1]} rows={[...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, formatKES(v)])} empty="No expenses" />
              </Panel>
              <Panel title="Expenses" icon={Wallet} flush>
                <Table head={["Date", "What", "Amount"]} right={[2]} rows={office.expenses.slice(0, 200).map((e: any) => [e.expense_date, e.description || e.category_name || "Expense", formatKES(num(e.amount))])} empty="No expenses" />
              </Panel>
            </div>
            <Panel title="Bills" icon={Receipt} flush actions={<ExportBtn onClick={() => csv(`water-bills-${range}d`, [["Created", "Bill", "Status", "Amount", "Paid", "Owed"], ...office.bills.map((b: any) => [b.created_at, b.name, b.status, b.amount, b.amount_paid || 0, Math.max(0, num(b.amount) - num(b.amount_paid))])])} />}>
              <Table head={["Created", "Bill", "Status", "Amount", "Paid", "Owed"]} right={[3, 4, 5]} rows={office.bills.map((b: any) => [
                new Date(b.created_at).toLocaleDateString(), b.name || "—", <span key="s" className="capitalize">{b.status === "partial" ? "part paid" : b.status || "—"}</span>,
                formatKES(num(b.amount)), formatKES(num(b.amount_paid)), formatKES(Math.max(0, num(b.amount) - num(b.amount_paid))),
              ])} empty="No bills" />
            </Panel>
          </div>
        );
      })()}

      {tab === "tickets" && (() => {
        const resolved = tickets.filter((t: any) => t.resolved_at);
        const hours = resolved.map((t: any) => (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600_000);
        const cats = new Map<string, number>();
        tickets.forEach((t: any) => cats.set(t.category, (cats.get(t.category) || 0) + 1));
        return (
          <div className="space-y-4">
            <StatGrid className="lg:grid-cols-4">
              <StatTile label="Tickets raised" value={tickets.length} hint={`${tickets.filter((t: any) => t.source === "customer").length} from customers`} icon={Ticket} tone="primary" />
              <StatTile label="Still open" value={openTickets} icon={AlertTriangle} tone={openTickets ? "danger" : "success"} />
              <StatTile label="Resolved" value={resolved.length} icon={Ticket} tone="success" />
              <StatTile label="Time to resolve" value={hours.length ? `${(avg(hours) || 0).toFixed(1)} h` : "—"} hint="average" icon={Clock} tone="info" />
            </StatGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="By topic" icon={Ticket} flush>
                <Table head={["Topic", "Tickets"]} right={[1]} rows={[...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => [categoryLabel(c), n])} empty="No tickets" />
              </Panel>
              <Panel title="By status" icon={Ticket} flush>
                <Table head={["Status", "Tickets"]} right={[1]} rows={(Object.keys(TICKET_STATUS) as (keyof typeof TICKET_STATUS)[]).map((k) => [TICKET_STATUS[k].label, tickets.filter((t: any) => t.status === k).length])} />
              </Panel>
            </div>
            <Panel title="Every ticket" icon={Ticket} flush>
              <Table head={["#", "Opened", "From", "Subject", "Topic", "Status", "Handled by"]} rows={tickets.map((t: any) => [
                t.ticket_no, new Date(t.created_at).toLocaleString(), t.source === "customer" ? t.customer_name || "Customer" : t.created_by_name || "Staff",
                t.subject, categoryLabel(t.category), <Pill key="s" tone={(TICKET_STATUS as any)[t.status]?.tone || "muted"}>{(TICKET_STATUS as any)[t.status]?.label || t.status}</Pill>, t.assigned_name || "—",
              ])} empty="No tickets in this period" />
            </Panel>
          </div>
        );
      })()}

      {tab === "charts" && (() => {
        const trend = r.days.map((d) => ({ label: d.key.slice(5), litres: Math.round(d.litres), revenue: Math.round(d.revenue), profit: Math.round(d.revenue - d.cost), count: d.count }));
        const sizes = r.products.filter((p) => p.kind === "refill").slice(0, 10).map((p) => ({ name: p.name.length > 20 ? `${p.name.slice(0, 19)}…` : p.name, litres: Math.round(p.litres), revenue: Math.round(p.revenue) }));
        const kinds = (Object.keys(r.byKind) as Kind[]).filter((k) => r.byKind[k] > 0).map((k) => ({ name: KIND_LABEL[k], value: Math.round(r.byKind[k]) }));
        const methods = r.methods.map((m) => ({ name: methodLabel(m.method), value: Math.round(m.amount) }));
        const statuses = (Object.keys(ORDER_STATUS) as (keyof typeof ORDER_STATUS)[]).map((k) => ({ name: ORDER_STATUS[k].label, value: r.orders.filter((o) => o.status === k).length })).filter((x) => x.value);
        const tankFlow = new Map<string, { label: string; bought: number; sold: number }>();
        for (const m of moves as any[]) {
          const k = dayKey(m.created_at);
          const row = tankFlow.get(k) || { label: k.slice(5), bought: 0, sold: 0 };
          if (m.kind === "purchase") row.bought += num(m.litres);
          if (m.kind === "sale" || m.kind === "return") row.sold -= num(m.litres);
          tankFlow.set(k, row);
        }
        const flow = [...tankFlow.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
        const riders = r.riders.map((x) => ({ name: x.name, delivered: x.delivered, collected: Math.round(x.cash + x.mpesa) }));
        const topCust = r.customers.slice(0, 10).map((c) => ({ name: c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name, value: Math.round(c.revenue) }));
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="1. Litres sold per day">
              <AreaChart data={trend}>
                <defs><linearGradient id="wl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.4} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={44} tickFormatter={short} />
                <Tooltip {...tip} formatter={(v: any) => L(num(v))} /><Area dataKey="litres" name="Litres" stroke="#0ea5e9" strokeWidth={2} fill="url(#wl)" />
              </AreaChart>
            </ChartCard>
            <ChartCard title="2. Sales and profit per day">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
                <Tooltip {...tip} formatter={money} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="3. Water bought vs sold" subtitle="Litres per day through the tanks">
              <LineChart data={flow}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
                <Tooltip {...tip} formatter={(v: any) => L(num(v))} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="bought" name="Bought" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line dataKey="sold" name="Sold" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
            <ChartCard title="4. Refill sizes" subtitle="Litres sold per size">
              <BarChart data={sizes} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={short} /><YAxis dataKey="name" type="category" width={130} {...axis} />
                <Tooltip {...tip} formatter={(v: any) => L(num(v))} /><Bar dataKey="litres" name="Litres" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="5. What earns the money" subtitle="Refills, bottles, items, services">
              <PieChart>
                <Pie data={kinds} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} label={(e: any) => e.name}>
                  {kinds.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={money} />
              </PieChart>
            </ChartCard>
            <ChartCard title="6. Payment methods">
              <PieChart>
                <Pie data={methods} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} label={(e: any) => e.name}>
                  {methods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} formatter={money} />
              </PieChart>
            </ChartCard>
            <ChartCard title="7. Busiest hours" subtitle="Litres sold by hour">
              <BarChart data={r.byHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" {...axis} interval={1} /><YAxis {...axis} width={44} tickFormatter={short} />
                <Tooltip {...tip} formatter={(v: any) => L(num(v))} /><Bar dataKey="litres" name="Litres" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="8. Busiest days of the week">
              <BarChart data={r.byWeekday}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" {...axis} /><YAxis {...axis} width={48} tickFormatter={short} />
                <Tooltip {...tip} formatter={money} /><Bar dataKey="revenue" name="Sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="9. Delivery orders by status">
              <PieChart>
                <Pie data={statuses} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} label={(e: any) => e.name}>
                  {statuses.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...tip} />
              </PieChart>
            </ChartCard>
            <ChartCard title="10. Riders" subtitle="Deliveries and money collected">
              <BarChart data={riders}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" {...axis} /><YAxis yAxisId="l" {...axis} width={36} allowDecimals={false} /><YAxis yAxisId="r" orientation="right" {...axis} width={48} tickFormatter={short} />
                <Tooltip {...tip} formatter={(v: any, n: any) => (n === "Collected" ? money(v) : v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="delivered" name="Delivered" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="r" dataKey="collected" name="Collected" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="11. Top customers" tall>
              <BarChart data={topCust} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={short} /><YAxis dataKey="name" type="category" width={130} {...axis} />
                <Tooltip {...tip} formatter={money} /><Bar dataKey="value" name="Spent" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="12. Number of sales per day" tall>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} width={36} allowDecimals={false} />
                <Tooltip {...tip} /><Bar dataKey="count" name="Sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>
        );
      })()}
    </div>
  );
}
