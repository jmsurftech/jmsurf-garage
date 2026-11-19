/** Money: the books for a year. Cash flow, who owes what, bank and stock, where the money went. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area } from "recharts";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DashCard, axis, short, tip, type Aging, type Books } from "./parts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Age bands: on time, then later and later. */
const BANDS = [["current", "On time", "#10b981"], ["d1_15", "1-15 days late", "#facc15"], ["d16_30", "16-30", "#fb923c"], ["d31_45", "31-45", "#f97316"], ["d45", "45+", "#dc2626"]] as const;

function AgeBar({ title, a, to }: { title: string; a: Aging; to: string }) {
  const total = Number(a.total) || 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 text-sm">
        <Link to={to} className="min-w-0 truncate font-medium hover:text-primary">{title}</Link>
        <span className="ml-auto whitespace-nowrap font-semibold tabular-nums">{formatKES(total)}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {total > 0 && BANDS.map(([k, l, c]) => { const v = Number(a[k]) || 0; return v > 0 ? <div key={k} style={{ width: `${(v / total) * 100}%`, background: c }} title={`${l}: ${formatKES(v)}`} /> : null; })}
      </div>
    </div>
  );
}

export default function MoneyView({ books: b, year, onYear, stockValue }: { books: Books | null; year: number; onYear: (y: number) => void; stockValue: number }) {
  const [chart, setChart] = useState<"cash" | "pl">("cash");
  if (!b) return <div className="h-80 animate-pulse rounded-2xl bg-muted/50" />;
  let running = Number(b.cash_start) || 0;
  const flow = b.monthly.map((x) => { running += Number(x.cash_in) - Number(x.cash_out); return { month: MONTHS[x.m - 1], Balance: running }; });
  const pl = b.monthly.map((x) => ({ month: MONTHS[x.m - 1], Income: Number(x.income), Expenses: Number(x.expense) }));
  const topTotal = b.top_expenses.reduce((a, x) => a + Number(x.amount), 0);
  const cashIn = b.monthly.reduce((a, x) => a + Number(x.cash_in), 0);
  const cashOut = b.monthly.reduce((a, x) => a + Number(x.cash_out), 0);
  const income = b.monthly.reduce((a, x) => a + Number(x.income), 0);
  const expense = b.monthly.reduce((a, x) => a + Number(x.expense), 0);
  const side: [string, number, string, string][] = chart === "cash"
    ? [[`Cash on 1 Jan ${year}`, Number(b.cash_start) || 0, "bg-muted-foreground/50", ""], ["Money in", cashIn, "bg-success", "+"], ["Money out", cashOut, "bg-destructive", "−"], [`Cash at end of ${year}`, (Number(b.cash_start) || 0) + cashIn - cashOut, "bg-primary", "="]]
    : [["Income", income, "bg-success", ""], ["Expenses", expense, "bg-destructive", ""], [income - expense >= 0 ? "Profit" : "Loss", Math.abs(income - expense), income - expense >= 0 ? "bg-primary" : "bg-destructive", ""]];

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <DashCard
        title={
          <span className="inline-flex flex-wrap gap-0.5 text-xs font-medium">
            {([["cash", "Cash flow"], ["pl", "Income vs expenses"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setChart(k)} aria-pressed={chart === k} className={cn("rounded-full px-2.5 py-1 transition-colors", chart === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </span>
        }
        action={
          <select className="fi h-7 w-auto text-xs" value={year} onChange={(e) => onYear(Number(e.target.value))} aria-label="Year">
            {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="h-64 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            {chart === "pl" ? (
              <BarChart data={pl} margin={{ left: 0, right: 4, top: 4, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} tick={axis} tickLine={false} axisLine={false} width={40} />
                <Tooltip formatter={(v: any) => formatKES(Number(v))} contentStyle={tip} cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} />
                <Bar dataKey="Income" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Expenses" fill="hsl(var(--destructive))" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            ) : (
              <AreaChart data={flow} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <defs><linearGradient id="dash-cash" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={short} tick={axis} tickLine={false} axisLine={false} width={40} />
                <Tooltip formatter={(v: any) => formatKES(Number(v))} contentStyle={tip} />
                <Area type="monotone" dataKey="Balance" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#dash-cash)" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
        <dl className="grid grid-cols-2 content-center gap-3 md:grid-cols-1 md:border-l md:border-border md:pl-4">
          {side.map(([label, v, dot, sign]) => (
            <div key={label} className="min-w-0">
              <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"><span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />{label}</dt>
              <dd className="whitespace-nowrap font-display text-base font-bold tabular-nums">{formatKES(v)}{sign && <span className="ml-1 text-xs font-normal text-muted-foreground">({sign})</span>}</dd>
            </div>
          ))}
        </dl>
        </div>
        {chart === "pl" && <p className="mt-2 text-[11px] text-muted-foreground">Amounts exclude tax.</p>}
      </DashCard>

      <DashCard title="Who owes what">
        <div className="space-y-3">
          <AgeBar title="Owed to you" a={b.receivables} to="/sales/invoices" />
          <AgeBar title="You owe" a={b.payables} to="/purchases/bills" />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {BANDS.map(([k, l, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{l}</span>)}
          </div>
        </div>
      </DashCard>

      <DashCard title="Where the money went" action={<Link to="/purchases/expenses" className="text-xs font-medium text-primary">Expenses</Link>}>
        {b.top_expenses.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No expenses in {year}.</p> : (
          <ul className="space-y-2 text-sm">
            {b.top_expenses.map((x) => {
              const pct = topTotal ? (Number(x.amount) / topTotal) * 100 : 0;
              return (
                <li key={x.name}>
                  <div className="flex justify-between gap-3"><span className="min-w-0 truncate">{x.name}</span><span className="whitespace-nowrap font-medium tabular-nums">{formatKES(Number(x.amount))}</span></div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, pct)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        )}
      </DashCard>

      <DashCard title="Bank, cash and stock" action={<Link to="/accounting/banking" className="text-xs font-medium text-primary">Banking</Link>}>
        <ul className="space-y-1.5 text-sm">
          {b.banks.map((x) => (
            <li key={x.name} className="flex justify-between gap-3"><span className="min-w-0 truncate text-muted-foreground">{x.name}</span><span className={cn("whitespace-nowrap font-medium tabular-nums", Number(x.balance) < 0 && "text-destructive")}>{formatKES(Number(x.balance))}</span></li>
          ))}
          <li className="flex justify-between gap-3 border-t border-border pt-1.5"><Link to="/inventory/stock" className="min-w-0 truncate text-muted-foreground hover:text-primary">Stock value</Link><span className="whitespace-nowrap font-medium tabular-nums">{formatKES(stockValue)}</span></li>
        </ul>
      </DashCard>
    </div>
  );
}
