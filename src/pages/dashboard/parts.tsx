/** Shared pieces of the dashboard's three views. */
import { Link } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Line = {
  sale_date: string; sale_hour: number; source: string; ref_id: string; customer_id: string | null; customer_name: string;
  rep_id: string | null; rep_name: string | null; item_id: string | null; item_name: string; category: string; subcategory: string | null;
  brand: string | null; qty: number; revenue: number; cost: number; payment_method: string;
};
export type Aging = { total: number; current: number; d1_15: number; d16_30: number; d31_45: number; d45: number; count: number };
export type Books = {
  year: number; receivables: Aging; payables: Aging; cash_start: number;
  monthly: { m: number; cash_in: number; cash_out: number; income: number; expense: number }[];
  top_expenses: { name: string; amount: number }[]; banks: { name: string; sub_type: string; balance: number }[];
};

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: "today", label: "Today", range: () => [iso(new Date()), iso(new Date())] },
  { key: "7d", label: "7 days", range: () => [iso(new Date(Date.now() - 6 * 864e5)), iso(new Date())] },
  { key: "30d", label: "30 days", range: () => [iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())] },
  { key: "month", label: "This month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; } },
  { key: "lastmonth", label: "Last month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { key: "year", label: "This year", range: () => { const n = new Date(); return [`${n.getFullYear()}-01-01`, iso(n)]; } },
];

export const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`);
export const tip = { borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 };
export const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

/** Sales over the period: daily up to 62 days, else monthly. */
export function trendOf(lines: Line[], from: string, to: string) {
  const monthly = (new Date(to).getTime() - new Date(from).getTime()) / 864e5 + 1 > 62;
  const m = new Map<string, number>();
  const cursor = new Date(from);
  while (iso(cursor) <= to) {
    const k = monthly ? iso(cursor).slice(0, 7) : iso(cursor);
    m.set(k, 0);
    if (monthly) cursor.setMonth(cursor.getMonth() + 1, 1); else cursor.setDate(cursor.getDate() + 1);
  }
  for (const l of lines) { const k = monthly ? l.sale_date.slice(0, 7) : l.sale_date; m.set(k, (m.get(k) || 0) + l.revenue); }
  return [...m.entries()].map(([k, v]) => ({ label: monthly ? new Date(`${k}-01`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : new Date(k).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), value: Math.round(v) }));
}

/** The one card every view uses: a title, an optional action, nothing else. */
export function DashCard({ title, action, children, className, icon: Icon }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(16,24,40,.12)]", className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-7 flex-wrap items-center gap-2">
          {Icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-3.5 w-3.5" /></span>}
          <h3 className="flex-1 text-sm font-semibold tracking-tight">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The period: pills, or a dropdown where there is no room for them. */
export function Periods({ preset, onPreset }: { preset: string; onPreset: (key: string) => void }) {
  return (
    <>
      <select value={preset} onChange={(e) => onPreset(e.target.value)} className="fi h-8 w-auto text-xs font-medium sm:hidden" aria-label="Period">
        {PRESETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        {!PRESETS.some((x) => x.key === preset) && <option value={preset}>Custom dates</option>}
      </select>
      <div className="hidden items-center gap-0.5 rounded-lg bg-muted p-0.5 sm:flex" role="group" aria-label="Period">
        {PRESETS.map((x) => (
          <button key={x.key} onClick={() => onPreset(x.key)} aria-pressed={preset === x.key}
            className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors", preset === x.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{x.label}</button>
        ))}
      </div>
    </>
  );
}

/** A soft line of sales with no grid or side axis; hover gives the amount. */
export function SalesLine({ data, className }: { data: { label: string; value: number }[]; className?: string }) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
          <defs><linearGradient id="dash-line" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={48} padding={{ left: 16, right: 16 }} />
          <Tooltip formatter={(v: any) => formatKES(Number(v))} contentStyle={tip} />
          <Area type="monotone" dataKey="value" name="Sales" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#dash-line)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Numbered rows: name on the left, amount on the right. */
export function RankRows({ rows, empty = "No sales in this period" }: { rows: { key: string; name: string; sub?: string; value: string; to?: string }[]; empty?: string }) {
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="-my-0.5">
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span>{r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}</span>
            <span className="whitespace-nowrap font-semibold tabular-nums">{r.value}</span>
          </>
        );
        return <li key={r.key}>{r.to ? <Link to={r.to} className="flex items-center gap-2 py-1.5 text-sm hover:text-primary">{body}</Link> : <div className="flex items-center gap-2 py-1.5 text-sm">{body}</div>}</li>;
      })}
    </ol>
  );
}
