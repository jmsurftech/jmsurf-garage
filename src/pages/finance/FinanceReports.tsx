import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Landmark, Printer, Download, TrendingUp, Coins, Receipt, Wallet, HandCoins, FileWarning, Percent, Table2, BarChart3, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, StatGrid, StatTile } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

const sb: any = supabase;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: "month", label: "This month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; } },
  { key: "lastmonth", label: "Last month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { key: "quarter", label: "This quarter", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1)), iso(n)]; } },
  { key: "6m", label: "6 months", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 5, 1)), iso(n)]; } },
  { key: "year", label: "This year", range: () => { const n = new Date(); return [`${n.getFullYear()}-01-01`, iso(n)]; } },
];
const PAY_LABEL: Record<string, string> = { mpesa: "M-Pesa", mobile_money: "M-Pesa", cash: "Cash", pdq_card: "Card (PDQ)", card: "Card (PDQ)", bank_transfer: "Bank", bank: "Bank", cheque: "Cheque", online: "Online shop", loyalty_points: "Loyalty points", other: "Other" };
const payName = (m: string) => PAY_LABEL[m] || (m ? m.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Other");
// Validated dataviz palette, slots 1–2 (light / dark).
const SERIES = { light: ["#a8121b", "#2a78d6"], dark: ["#ef4a52", "#3987e5"] };
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");

export default function FinanceReports() {
  const tenantId = useTenantId();
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [preset, setPreset] = useState("month");
  const [custom, setCustom] = useState<[string, string] | null>(null);
  const [from, to] = custom || PRESETS.find((p) => p.key === preset)!.range();
  const [chartTable, setChartTable] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["finance", tenantId, from, to],
    enabled: !!tenantId,
    queryFn: async () => {
      const toEnd = `${to}T23:59:59.999+03:00`, fromStart = `${from}T00:00:00+03:00`;
      const [lines, tx, pr, ex, bills, debts, biz] = await Promise.all([
        sb.rpc("sales_lines", { p_from: from, p_to: to }),
        sb.from("transactions").select("total,tax,payment_method,split_payments,created_at,refunded_amount").eq("tenant_id", tenantId).eq("status", "completed").gte("created_at", fromStart).lte("created_at", toEnd).limit(50000),
        sb.from("payments_received").select("amount,method,payment_date").eq("tenant_id", tenantId).gte("payment_date", from).lte("payment_date", to).limit(20000),
        sb.from("expenses").select("amount,category_name,expense_date").eq("tenant_id", tenantId).gte("expense_date", from).lte("expense_date", to).limit(20000),
        sb.from("bills").select("name,category,amount,amount_paid,status,next_due_date,last_paid_at,purchase_id,supplier_id").eq("tenant_id", tenantId).limit(5000),
        sb.from("debts_view").select("customer_name,balance,days_overdue,age_days,due_date").eq("tenant_id", tenantId),
        sb.from("business_settings").select("business_name,tax_pin").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      return { lines: lines.data || [], tx: tx.data || [], pr: pr.data || [], ex: ex.data || [], bills: bills.data || [], debts: debts.data || [], biz: biz.data };
    },
  });

  const r = useMemo(() => {
    if (!data) return null;
    const sum = (a: any[], f: (x: any) => number) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
    const revenue = sum(data.lines, (l) => l.revenue);
    const cogs = sum(data.lines, (l) => l.cost);
    const refunds = sum(data.tx, (t) => t.refunded_amount);
    const byCat = new Map<string, { rev: number; cost: number }>();
    data.lines.forEach((l: any) => { const c = byCat.get(l.category) || { rev: 0, cost: 0 }; c.rev += Number(l.revenue) || 0; c.cost += Number(l.cost) || 0; byCat.set(l.category, c); });
    const categories = [...byCat].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    // Running costs: expenses plus bills paid in the period that are not supplier stock purchases (those are already in cost of sales).
    const exByCat = new Map<string, number>();
    data.ex.forEach((e: any) => exByCat.set(e.category_name || "Other", (exByCat.get(e.category_name || "Other") || 0) + Number(e.amount || 0)));
    data.bills.filter((b: any) => !b.purchase_id && b.last_paid_at && b.last_paid_at.slice(0, 10) >= from && b.last_paid_at.slice(0, 10) <= to)
      .forEach((b: any) => exByCat.set(b.category || b.name || "Bills", (exByCat.get(b.category || b.name || "Bills") || 0) + Number(b.amount_paid || b.amount || 0)));
    const expenses = [...exByCat].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
    const opex = sum(expenses, (e) => e.v);
    const gross = revenue - refunds - cogs;
    const net = gross - opex;
    // Money in, by how it was paid.
    const inMap = new Map<string, number>();
    const addIn = (m: string, v: number) => { if (m === "credit" || m === "invoice" || !v) return; const k = payName(m); inMap.set(k, (inMap.get(k) || 0) + v); };
    data.tx.forEach((t: any) => {
      if (t.payment_method === "split" && Array.isArray(t.split_payments)) t.split_payments.forEach((s: any) => addIn(String(s.method || s.payment_method || "other"), Number(s.amount) || 0));
      else addIn(String(t.payment_method || "other"), Number(t.total) || 0);
    });
    data.pr.forEach((p: any) => addIn(String(p.method || "other"), Number(p.amount) || 0));
    const moneyIn = [...inMap].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
    const cashIn = sum(moneyIn, (m) => m.v);
    // Month by month: money in vs money out.
    const months = new Map<string, { month: string; in: number; out: number }>();
    const mk = (d: string) => d.slice(0, 7);
    const bump = (d: string, k: "in" | "out", v: number) => { const key = mk(d); const m = months.get(key) || { month: key, in: 0, out: 0 }; m[k] += v; months.set(key, m); };
    data.tx.forEach((t: any) => t.payment_method !== "credit" && bump(t.created_at, "in", Number(t.total) || 0));
    data.pr.forEach((p: any) => bump(p.payment_date, "in", Number(p.amount) || 0));
    data.ex.forEach((e: any) => bump(e.expense_date, "out", Number(e.amount) || 0));
    data.bills.filter((b: any) => b.last_paid_at && b.last_paid_at.slice(0, 10) >= from && b.last_paid_at.slice(0, 10) <= to).forEach((b: any) => bump(b.last_paid_at, "out", Number(b.amount_paid || 0)));
    const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) }));
    // Receivables ageing.
    const buckets = [["Not yet due", (d: any) => d.days_overdue <= 0], ["1–30 days late", (d: any) => d.days_overdue > 0 && d.days_overdue <= 30], ["31–60 days late", (d: any) => d.days_overdue > 30 && d.days_overdue <= 60], ["61–90 days late", (d: any) => d.days_overdue > 60 && d.days_overdue <= 90], ["Over 90 days late", (d: any) => d.days_overdue > 90]] as const;
    const ageing = buckets.map(([name, f]) => { const rows = data.debts.filter(f); return { name, count: rows.length, v: sum(rows, (d) => d.balance) }; });
    const receivables = sum(data.debts, (d) => d.balance);
    const payablesRows = data.bills.filter((b: any) => b.status !== "paid" && Number(b.amount) - Number(b.amount_paid || 0) > 0.5);
    const payables = sum(payablesRows, (b) => Number(b.amount) - Number(b.amount_paid || 0));
    const vat = sum(data.tx, (t) => t.tax);
    return { revenue, cogs, refunds, gross, opex, net, categories, expenses, moneyIn, cashIn, monthly, ageing, receivables, payablesRows, payables, vat };
  }, [data, from, to]);

  const exportCsv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [["JMSURF Garage profit and loss", `${from} to ${to}`], [], ["Revenue", r.revenue.toFixed(2)], ...r.categories.map((c) => [`  ${c.name}`, c.rev.toFixed(2)]),
      ["Refunds", (-r.refunds).toFixed(2)], ["Cost of sales", (-r.cogs).toFixed(2)], ["Gross profit", r.gross.toFixed(2)], ["Running costs", (-r.opex).toFixed(2)], ...r.expenses.map((e) => [`  ${e.name}`, (-e.v).toFixed(2)]), ["Net profit", r.net.toFixed(2)],
      [], ["Money in by method"], ...r.moneyIn.map((m) => [m.name, m.v.toFixed(2)]), [], ["Receivables", r.receivables.toFixed(2)], ["Payables", r.payables.toFixed(2)], ["VAT collected", r.vat.toFixed(2)]];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `finance-${from}-to-${to}.csv`;
    a.click();
  };

  const colors = dark ? SERIES.dark : SERIES.light;
  const PL = ({ label, value, strong, indent, negative }: { label: string; value: number; strong?: boolean; indent?: boolean; negative?: boolean }) => (
    <tr className={cn(strong && "border-t-2 border-border font-semibold")}><td className={cn(indent && "pl-8 text-muted-foreground")}>{label}</td><td className={cn("num", strong && "font-display text-base")}>{negative && value ? `(${formatKES(value)})` : formatKES(value)}</td></tr>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Profit, cash & tax" icon={Landmark} description={`Profit and loss, cash in and out, debts and tax${data?.biz?.business_name ? ` for ${data.biz.business_name}` : ""}.`}
        actions={<div className="flex gap-2 print:hidden"><Button variant="outline" onClick={exportCsv} disabled={!r}><Download /> Excel (CSV)</Button><Button onClick={() => window.print()} disabled={!r}><Printer /> Print / PDF</Button></div>} />
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {PRESETS.map((p) => <button key={p.key} onClick={() => { setPreset(p.key); setCustom(null); }} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", !custom && preset === p.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{p.label}</button>)}
        <span className="flex items-center gap-1 text-sm"><input type="date" className="fi h-9 w-auto" value={from} onChange={(e) => setCustom([e.target.value, to])} /> – <input type="date" className="fi h-9 w-auto" value={to} onChange={(e) => setCustom([from, e.target.value])} /></span>
      </div>
      <p className="hidden text-sm print:block">Period: {from} to {to}. Printed {new Date().toLocaleString("en-GB")}.</p>
      {isLoading || !r ? <OrbLoader label="Adding up the books…" /> : (<>
        <StatGrid className="lg:grid-cols-4">
          <StatTile label="Revenue" value={formatKES(r.revenue)} icon={TrendingUp} />
          <StatTile label={`Gross profit · ${pct(r.gross, r.revenue)}`} value={formatKES(r.gross)} icon={Coins} tone="success" />
          <StatTile label="Running costs" value={formatKES(r.opex)} icon={Receipt} tone="warning" />
          <StatTile label={`Net profit · ${pct(r.net, r.revenue)}`} value={formatKES(r.net)} icon={Scale} tone={r.net >= 0 ? "success" : "danger"} />
          <StatTile label="Money in" value={formatKES(r.cashIn)} icon={Wallet} tone="info" />
          <StatTile label="Customers owe" value={formatKES(r.receivables)} icon={HandCoins} tone="warning" />
          <StatTile label="We owe (bills)" value={formatKES(r.payables)} icon={FileWarning} tone="muted" />
          <StatTile label="VAT collected" value={formatKES(r.vat)} icon={Percent} tone="muted" />
        </StatGrid>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel flush title="Profit & loss" icon={Scale} description={`${from} to ${to}`}>
            <table className="dt dt-keep"><tbody>
              <PL label="Sales" value={r.revenue} strong />
              {r.categories.map((c) => <PL key={c.name} label={c.name} value={c.rev} indent />)}
              {r.refunds > 0 && <PL label="Less refunds" value={r.refunds} negative />}
              <PL label="Less cost of sales" value={r.cogs} negative />
              <PL label={`Gross profit (${pct(r.gross, r.revenue)})`} value={r.gross} strong />
              {r.expenses.map((e) => <PL key={e.name} label={e.name} value={e.v} indent negative />)}
              <PL label="Less running costs" value={r.opex} negative />
              <PL label={`Net profit (${pct(r.net, r.revenue)})`} value={r.net} strong />
            </tbody></table>
            <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">Cost of sales uses each item's buying price at the time of sale. Running costs are expenses plus bills paid (supplier stock bills are in cost of sales).</p>
          </Panel>

          <div className="space-y-5">
            <Panel title="Money in vs money out" icon={BarChart3} actions={<button onClick={() => setChartTable(!chartTable)} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground print:hidden">{chartTable ? <BarChart3 className="h-3 w-3" /> : <Table2 className="h-3 w-3" />}{chartTable ? "Chart" : "Table"}</button>}>
              {r.monthly.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing in this period</p> : chartTable ? (
                <table className="dt dt-keep"><thead><tr><th>Month</th><th className="num">In</th><th className="num">Out</th><th className="num">Net</th></tr></thead>
                  <tbody>{r.monthly.map((m) => <tr key={m.month}><td>{m.label}</td><td className="num">{formatKES(m.in)}</td><td className="num">{formatKES(m.out)}</td><td className="num font-semibold">{formatKES(m.in - m.out)}</td></tr>)}</tbody></table>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={r.monthly} margin={{ left: 0, right: 8, top: 16, bottom: 0 }} barGap={2}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 }} formatter={(v: number) => formatKES(v)} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="in" name="Money in" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="out" name="Money out" fill={colors[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
            <Panel flush title="Money in by payment method" icon={Wallet}>
              {r.moneyIn.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No payments in this period</p> : (
                <table className="dt dt-keep"><tbody>{r.moneyIn.map((m) => (
                  <tr key={m.name}><td className="w-40">{m.name}</td><td><div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (m.v / r.cashIn) * 100)}%` }} /></div></td><td className="num w-32 font-semibold">{formatKES(m.v)}</td><td className="num w-16 text-muted-foreground">{pct(m.v, r.cashIn)}</td></tr>
                ))}</tbody></table>
              )}
            </Panel>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel flush title="Who owes us (receivables ageing)" icon={HandCoins} actions={<Link to="/sales/debts" className="text-sm text-primary hover:underline print:hidden">Debts →</Link>}>
            <table className="dt dt-keep"><thead><tr><th>Age</th><th className="num">Invoices</th><th className="num">Amount</th></tr></thead>
              <tbody>{r.ageing.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num">{a.count}</td><td className={cn("num font-semibold", a.name.startsWith("Over") && a.v > 0 && "text-destructive")}>{formatKES(a.v)}</td></tr>)}
                <tr className="border-t-2 border-border font-semibold"><td>Total</td><td className="num">{r.ageing.reduce((s, a) => s + a.count, 0)}</td><td className="num">{formatKES(r.receivables)}</td></tr></tbody></table>
          </Panel>
          <Panel flush title="What we owe (unpaid bills)" icon={FileWarning} actions={<Link to="/purchases/bills" className="text-sm text-primary hover:underline print:hidden">Bills →</Link>}>
            {r.payablesRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No unpaid bills</p> : (
              <table className="dt dt-keep"><thead><tr><th>Bill</th><th>Due</th><th className="num">Balance</th></tr></thead>
                <tbody>{r.payablesRows.slice(0, 12).map((b: any, i: number) => <tr key={i}><td>{b.name}</td><td className={cn(b.next_due_date && b.next_due_date < iso(new Date()) && "text-destructive")}>{b.next_due_date || "–"}</td><td className="num font-semibold">{formatKES(Number(b.amount) - Number(b.amount_paid || 0))}</td></tr>)}
                  <tr className="border-t-2 border-border font-semibold"><td colSpan={2}>Total</td><td className="num">{formatKES(r.payables)}</td></tr></tbody></table>
            )}
          </Panel>
        </div>

        <Panel flush title="Profit by category" icon={Coins}>
          {r.categories.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No sales in this period</p> : (
            <table className="dt"><thead><tr><th>Category</th><th className="num">Sales</th><th className="num">Cost</th><th className="num">Gross profit</th><th className="num">Margin</th><th className="num">Share of sales</th></tr></thead>
              <tbody>{r.categories.map((c) => <tr key={c.name}><td className="font-medium">{c.name}</td><td className="num">{formatKES(c.rev)}</td><td className="num text-muted-foreground">{formatKES(c.cost)}</td><td className="num font-semibold">{formatKES(c.rev - c.cost)}</td><td className="num">{pct(c.rev - c.cost, c.rev)}</td><td className="num text-muted-foreground">{pct(c.rev, r.revenue)}</td></tr>)}</tbody></table>
          )}
        </Panel>
        <p className="text-xs text-muted-foreground">VAT collected is the tax charged on till and online sales in the period{data?.biz?.tax_pin ? ` (KRA PIN ${data.biz.tax_pin})` : ""}. File returns from your accountant's records.</p>
      </>)}
    </div>
  );
}
