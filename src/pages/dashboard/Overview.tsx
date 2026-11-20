/**
 * Overview: four key figures across the top, the sales line with what needs doing beside it,
 * then who and what sold, the year's money and the stock that is running low.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";
import {
  ArrowDown, ArrowDownLeft, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck, Bell, Boxes, CircleCheck, Clock, CreditCard,
  Globe, Landmark, ListChecks, PackageMinus, PieChart, Receipt, ShoppingBag, TrendingUp, Trophy, Wallet,
} from "lucide-react";
import { useModules } from "@/hooks/useModules";
import { OrbSpinner } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DashCard, Periods, PRESETS, RankRows, SalesLine, axis, iso, tip, trendOf, type Aging, type Books, type Line } from "./parts";
import { PAY_LABEL, RankedBars } from "./SalesView";
import type { DashHome } from "./dashHome";

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const late = (a: Aging) => Math.max(0, Number(a.total) - Number(a.current));
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type Tone = "primary" | "success" | "warning" | "info" | "destructive";
const TONE: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
};

/** One key figure: a coloured icon, the amount, and one line under it. */
function Kpi({ label, value, sub, subTone, to, icon: Icon, tone, danger }: {
  label: string; value?: string; sub?: React.ReactNode; subTone?: "bad" | "good"; to: string;
  icon: React.ComponentType<{ className?: string }>; tone: Tone; danger?: boolean;
}) {
  return (
    <Link to={to} className="group flex min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(16,24,40,.12)] transition-all hover:-translate-y-0.5 hover:border-primary/30 sm:p-5 max-sm:p-3.5" style={{ containerType: "inline-size" }}>
      <span className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE[tone])}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </span>
      {value === undefined ? <span className="block h-7 w-32 animate-pulse rounded-md bg-muted" />
        : <span className={cn("block truncate font-display font-bold leading-none tracking-tight tabular-nums", danger && "text-destructive")} style={{ fontSize: "clamp(0.95rem, 10.5cqi, 1.45rem)" }} title={value}>{value}</span>}
      <span className={cn("block truncate text-xs", subTone === "bad" ? "text-destructive" : subTone === "good" ? "text-success" : "text-muted-foreground")}>{sub || " "}</span>
    </Link>
  );
}

/** A row in the to-do list: icon, what, why, and the amount. */
function TodoRow({ to, icon: Icon, tone, title, sub, amount, amountTone }: {
  to: string; icon: React.ComponentType<{ className?: string }>; tone: Tone; title: string; sub?: string; amount?: string; amountTone?: string;
}) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE[tone])}><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {amount ? <span className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", amountTone)}>{amount}</span>
        : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
    </Link>
  );
}

const linkCls = "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";

export interface OverviewProps {
  lines: Line[];
  loading: boolean;
  fetching: boolean;
  from: string;
  to: string;
  preset: string;
  onPreset: (key: string) => void;
  prevRevenue: number | null;
  home?: DashHome;
  books: Books | null;
  year: number;
  onSales: () => void;
  onMoney: () => void;
}

export default function Overview({ lines, loading, fetching, from, to, preset, onPreset, prevRevenue, home, books: b, year, onSales, onMoney }: OverviewProps) {
  const { has } = useModules();
  const today = iso(new Date());
  const [rank, setRank] = useState<"items" | "customers">("items");
  const revenue = useMemo(() => lines.reduce((a, l) => a + l.revenue, 0), [lines]);
  const profitOnSales = useMemo(() => lines.reduce((a, l) => a + l.revenue - l.cost, 0), [lines]);
  const orders = useMemo(() => new Set(lines.map((l) => l.ref_id)).size, [lines]);
  const trend = useMemo(() => trendOf(lines, from, to), [lines, from, to]);
  const change = prevRevenue ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
  const periodLabel = PRESETS.find((x) => x.key === preset)?.label || "Custom dates";

  const cashNow = (b?.banks || []).reduce((a, x) => a + Number(x.balance), 0);
  const income = (b?.monthly || []).reduce((a, x) => a + Number(x.income), 0);
  const expense = (b?.monthly || []).reduce((a, x) => a + Number(x.expense), 0);
  const profit = income - expense;

  const topItems = useMemo(() => {
    const m = new Map<string, { value: number; qty: number }>();
    for (const l of lines) { const x = m.get(l.item_name) || { value: 0, qty: 0 }; x.value += l.revenue; x.qty += l.qty; m.set(l.item_name, x); }
    return [...m.entries()].sort((x, y) => y[1].value - x[1].value).slice(0, 5)
      .map(([name, x]) => ({ key: name, name, sub: `${x.qty.toLocaleString()} sold`, value: formatKES(x.value) }));
  }, [lines]);
  const topCustomers = useMemo(() => {
    const m = new Map<string, { name: string; value: number; refs: Set<string> }>();
    for (const l of lines) {
      if (!l.customer_id) continue;
      const c = m.get(l.customer_id) || { name: l.customer_name, value: 0, refs: new Set<string>() };
      c.value += l.revenue; c.refs.add(l.ref_id); m.set(l.customer_id, c);
    }
    return [...m.entries()].sort((x, y) => y[1].value - x[1].value).slice(0, 5)
      .map(([id, c]) => ({ key: id, name: c.name, sub: plural(c.refs.size, "order"), value: formatKES(c.value), to: `/customers/${id}` }));
  }, [lines]);
  const recent = useMemo(() => {
    if (!home) return [];
    const rows = [
      ...home.recent_invoices.map((r) => ({ key: `i${r.id}`, ref: r.invoice_number || "Invoice", who: r.customer_name || "Customer", amount: Number(r.total), status: r.status, at: r.created_at, to: `/sales/invoices/${r.id}` })),
      ...home.recent_sales.map((r) => ({ key: `t${r.id}`, ref: `Sale ${String(r.id).slice(0, 6).toUpperCase()}`, who: r.customer_name || "Walk-in", amount: Number(r.total), status: r.status || "completed", at: r.created_at, to: "/reports" })),
    ];
    return rows.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 6);
  }, [home]);

  const paidBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) { const k = PAY_LABEL[l.payment_method] || l.payment_method; m.set(k, (m.get(k) || 0) + l.revenue); }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((x, y) => y.value - x.value);
  }, [lines]);
  const months = (b?.monthly || []).map((x) => ({ month: MONTHS[x.m - 1], name: MONTH_NAMES[x.m - 1], Income: Number(x.income), Expenses: Number(x.expense) }));

  const lowStock = Number(home?.low_stock_count || 0);
  const notes: { to: string; text: string; icon: React.ComponentType<{ className?: string }>; tone: Tone }[] = [];
  if (home?.approvals) notes.push({ to: "/approvals", text: `${home.approvals} waiting for approval`, icon: BadgeCheck, tone: "primary" });
  if (lowStock) notes.push({ to: "/warehouse/reorder", text: `${plural(lowStock, "item")} to reorder`, icon: PackageMinus, tone: "warning" });
  if (home?.reminders_due) notes.push({ to: "/sales/reminders", text: `${plural(home.reminders_due, "reminder")} due`, icon: Bell, tone: "info" });
  if (has("ecommerce") && home?.web_orders) notes.push({ to: "/sales/online-orders", text: `${plural(home.web_orders, "web order")} open`, icon: Globe, tone: "info" });
  const todo = (home?.overdue_list.length || 0) + (home?.bills_due.length || 0) + notes.length;
  const count = (n: number) => <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{n}</span>;

  return (
    <div className="space-y-4">
      {/* Key figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi label="To collect" icon={ArrowDownLeft} tone="success" to="/sales/invoices"
          value={b ? formatKES(Number(b.receivables.total)) : undefined}
          sub={b && (late(b.receivables) > 0 ? `${formatKES(late(b.receivables))} overdue` : "Nothing overdue")} subTone={b && late(b.receivables) > 0 ? "bad" : undefined} />
        <Kpi label="To pay" icon={Receipt} tone="warning" to="/purchases/bills"
          value={b ? formatKES(Number(b.payables.total)) : undefined}
          sub={b && (late(b.payables) > 0 ? `${formatKES(late(b.payables))} overdue` : "Nothing overdue")} subTone={b && late(b.payables) > 0 ? "bad" : undefined} />
        <Kpi label="Cash & bank" icon={Landmark} tone="info" to="/accounting/banking" danger={cashNow < 0}
          value={b ? formatKES(cashNow) : undefined} sub={b && `Across ${plural(b.banks.length, "account")}`} />
        <Kpi label={`Profit ${year}`} icon={Wallet} tone={profit < 0 ? "destructive" : "primary"} to="/reports" danger={profit < 0}
          value={b ? formatKES(profit) : undefined} sub={b && `${formatKES(income)} income`} />
      </div>

      {/* Sales and to do */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(16,24,40,.12)]">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" /> Sales <span className="font-normal text-muted-foreground">· {periodLabel.toLowerCase()}</span></p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {loading ? <span className="block h-9 w-48 animate-pulse rounded-md bg-muted" />
                  : <Link to="/reports" className="truncate font-display text-[2rem] font-bold leading-none tracking-tight tabular-nums hover:text-primary" title={formatKES(revenue)}>{formatKES(revenue)}</Link>}
                {change != null && Number.isFinite(change) && (
                  <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold", change >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                    {change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(change).toFixed(1)}%
                    <span className="ml-1 font-normal text-muted-foreground">vs before</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {fetching && !loading && <OrbSpinner className="h-4 w-4" state="working" label="Updating" />}
              <Periods preset={preset} onPreset={onPreset} />
            </div>
          </div>
          <SalesLine data={trend} className="mt-3 h-60 px-2 xl:h-auto xl:min-h-60 xl:flex-1" />
          <dl className="grid grid-cols-3 divide-x divide-border border-t border-border/70">
            {[
              ["Orders", loading ? null : orders.toLocaleString()],
              ["Average sale", loading ? null : formatKES(orders ? revenue / orders : 0)],
              ["Gross profit", loading ? null : formatKES(profitOnSales)],
            ].map(([l, v]) => (
              <div key={l} className="min-w-0 px-4 py-3 sm:px-5">
                <dt className="truncate text-xs text-muted-foreground">{l}</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-[15px]">{v ?? <span className="block h-4 w-16 animate-pulse rounded bg-muted" />}</dd>
              </div>
            ))}
          </dl>
        </section>

        <DashCard title="Needs attention" icon={ListChecks} className="xl:h-0 xl:min-h-full" action={todo > 0 ? count(todo) : undefined}>
          {!home ? <div className="h-48 animate-pulse rounded-xl bg-muted/50" /> : todo === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10"><CircleCheck className="h-5 w-5 text-success" /></span>
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs text-muted-foreground">Nothing overdue or waiting on you.</p>
            </div>
          ) : (
            <div className="-mx-2 max-h-80 min-h-0 flex-1 overflow-y-auto overscroll-contain xl:max-h-none">
              {notes.map((n) => <TodoRow key={n.to} to={n.to} icon={n.icon} tone={n.tone} title={n.text} />)}
              {home.overdue_list.map((x) => (
                <TodoRow key={x.invoice_id} to={`/sales/invoices/${x.invoice_id}`} icon={Clock} tone="destructive" title={x.customer_name}
                  sub={`Collect · ${x.days_overdue} days late`} amount={formatKES(Number(x.balance))} amountTone="text-destructive" />
              ))}
              {home.bills_due.map((x) => (
                <TodoRow key={x.id} to={`/purchases/bills/${x.id}`} icon={CreditCard} tone="warning" title={x.bill_number || "Bill"}
                  sub={`Pay · ${x.due_date < today ? "was due" : "due"} ${day(x.due_date)}`} amount={formatKES(Number(x.amount) - Number(x.amount_paid || 0))} />
              ))}
            </div>
          )}
        </DashCard>
      </div>

      {/* Best sellers, latest, income vs expenses */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <DashCard title="Best sellers" icon={Trophy} action={
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium" role="tablist">
            {(["items", "customers"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={rank === k} onClick={() => setRank(k)}
                className={cn("rounded-md px-2.5 py-1 capitalize transition-colors", rank === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{k}</button>
            ))}
          </div>
        }>
          <div className="flex-1">
            {rank === "items" ? <RankRows rows={topItems} /> : <RankRows rows={topCustomers} empty="No known customers bought in this period" />}
          </div>
          <button onClick={onSales} className={cn(linkCls, "mt-3 self-start")}>Full sales breakdown <ArrowRight className="h-3 w-3" /></button>
        </DashCard>

        <DashCard title="Latest activity" icon={ShoppingBag} action={<Link to="/sales/invoices" className={linkCls}>All invoices</Link>}>
          {!home ? <div className="h-48 animate-pulse rounded-xl bg-muted/50" /> : !recent.length ? <p className="py-2 text-sm text-muted-foreground">No orders yet</p> : (
            <ul className="-mx-2">
              {recent.map((r) => (
                <li key={r.key}>
                  <Link to={r.to} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted/60">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold uppercase text-primary">{r.who.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.who}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.ref} · {day(r.at)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block whitespace-nowrap text-sm font-semibold tabular-nums">{formatKES(r.amount)}</span>
                      <span className="block text-[11px] capitalize text-muted-foreground">{String(r.status).replace(/_/g, " ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Income vs expenses ${year}`} icon={PieChart} className="lg:col-span-2 2xl:col-span-1" action={<button onClick={onMoney} className={linkCls}>Money</button>}>
          <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Income <b className="font-semibold tabular-nums">{b ? formatKES(income) : "—"}</b></span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive/70" />Expenses <b className="font-semibold tabular-nums">{b ? formatKES(expense) : "—"}</b></span>
          </div>
          <div className="h-48 shrink-0">
            <ResponsiveContainer debounce={120} width="100%" height="100%">
              <BarChart data={months} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} barGap={2} barCategoryGap="22%">
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} interval={0} />
                <Tooltip formatter={(v: any) => formatKES(Number(v))} labelFormatter={(_: any, p: any) => p?.[0]?.payload?.name} contentStyle={tip} cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} />
                <Bar dataKey="Income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="hsl(var(--destructive))" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DashCard>
      </div>

      {/* Smaller lists */}
      <div className="grid gap-4 md:grid-cols-3">
        <DashCard title="How customers paid" icon={CreditCard}><RankedBars rows={paidBy.slice(0, 5)} /></DashCard>
        <DashCard title="Where the money went" icon={Receipt} action={<Link to="/purchases/expenses" className={linkCls}>Expenses</Link>}>
          {!b?.top_expenses.length ? <p className="py-2 text-sm text-muted-foreground">No expenses in {year}</p>
            : <RankedBars rows={b.top_expenses.slice(0, 5).map((x) => ({ name: x.name, value: Number(x.amount) }))} />}
        </DashCard>
        <DashCard title="Running low" icon={Boxes} action={<Link to="/warehouse/reorder" className={linkCls}>Reorder</Link>}>
          {!home?.low_stock?.length ? (
            <p className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-sm text-muted-foreground"><CircleCheck className="h-5 w-5 text-success" /> Stock is fine</p>
          ) : (
            <ul className="-my-0.5 divide-y divide-border/60">
              {home.low_stock.slice(0, 5).map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{x.name}</span>
                  <span className="whitespace-nowrap rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-destructive">{Number(x.stock).toLocaleString()} {x.unit || "left"}</span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>
      </div>
    </div>
  );
}
