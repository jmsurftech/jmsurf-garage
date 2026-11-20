/** Sales: everything about what sold, with the filters. Filters stay in this view and never change the Overview. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from "recharts";
import { Crown, SlidersHorizontal, X } from "lucide-react";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DashCard, Periods, SalesLine, axis, short, tip, trendOf, type Line } from "./parts";

export const PAY_LABEL: Record<string, string> = { mpesa: "M-Pesa", mobile_money: "Mobile money", cash: "Cash", pdq_card: "Card (PDQ)", card: "Card", bank_transfer: "Bank", credit: "Credit", online: "Online shop", invoice: "Invoice", split: "Split", loyalty_points: "Loyalty" };

/** Ranked list with plain bars; a click filters the page when onPick is given. */
export function RankedBars({ rows, onPick, picked }: { rows: { name: string; value: number }[]; onPick?: (n: string) => void; picked?: string | null }) {
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">No sales in this period</p>;
  const top = rows.slice(0, 6);
  const max = Math.max(...top.map((r) => r.value), 1);
  return (
    <ul className="space-y-2 text-sm">
      {top.map((r) => (
        <li key={r.name}>
          <button type="button" disabled={!onPick} onClick={() => onPick?.(r.name)} className={cn("block w-full text-left", onPick && "hover:text-primary", picked && picked !== r.name && "opacity-50")}>
            <span className="flex justify-between gap-3"><span className={cn("min-w-0 truncate", picked === r.name && "font-semibold text-primary")}>{r.name}</span><span className="whitespace-nowrap font-medium tabular-nums">{short(r.value)}</span></span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface SalesViewProps {
  lines: Line[];
  loading: boolean;
  fetching: boolean;
  from: string;
  to: string;
  preset: string;
  onPreset: (key: string) => void;
  onDates: (from: string, to: string) => void;
}

export default function SalesView({ lines, loading, fetching, from, to, preset, onPreset, onDates }: SalesViewProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [item, setItem] = useState<string | null>(null);
  const [rep, setRep] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [bestCat, setBestCat] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const filterCount = [category, item, rep, customer].filter(Boolean).length;

  const f = useMemo(() => lines.filter((l) => (!category || l.category === category) && (!item || l.item_name === item) && (!rep || (l.rep_name || "No rep") === rep) && (!customer || l.customer_name === customer)), [lines, category, item, rep, customer]);
  const group = (key: (l: Line) => string, src = f) => {
    const m = new Map<string, number>();
    for (const l of src) m.set(key(l), (m.get(key(l)) || 0) + l.revenue);
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const revenue = f.reduce((a, l) => a + l.revenue, 0);
  const profit = revenue - f.reduce((a, l) => a + l.cost, 0);
  const units = f.reduce((a, l) => a + l.qty, 0);
  const trend = useMemo(() => trendOf(f, from, to), [f, from, to]);

  const hours = useMemo(() => Array.from({ length: 15 }, (_, i) => i + 7).map((h) => ({ label: `${String(h).padStart(2, "0")}:00`, value: Math.round(f.filter((l) => l.sale_hour === h && l.source !== "invoice").reduce((a, l) => a + l.revenue, 0)) })), [f]);
  const showHours = hours.some((h) => h.value > 0);

  const items = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const l of f) { const cur = m.get(l.item_name) || { name: l.item_name, qty: 0, revenue: 0, cost: 0 }; cur.qty += l.qty; cur.revenue += l.revenue; cur.cost += l.cost; m.set(l.item_name, cur); }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [f]);

  const categories = useMemo(() => group((l) => l.category, lines.filter((l) => (!item || l.item_name === item) && (!rep || (l.rep_name || "No rep") === rep) && (!customer || l.customer_name === customer))), [lines, item, rep, customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeBest = bestCat || category || categories[0]?.name || null;
  const best = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; revenue: number; orders: Set<string>; last: string }>();
    for (const l of lines) {
      if (!l.customer_id || (activeBest && l.category !== activeBest)) continue;
      const cur = m.get(l.customer_id) || { id: l.customer_id, name: l.customer_name, revenue: 0, orders: new Set<string>(), last: l.sale_date };
      cur.revenue += l.revenue; cur.orders.add(l.ref_id); if (l.sale_date > cur.last) cur.last = l.sale_date;
      m.set(l.customer_id, cur);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [lines, activeBest]);

  const custItems = useMemo(() => {
    if (!customer) return [];
    const m = new Map<string, { name: string; months: Map<string, number>; qty: number; revenue: number }>();
    for (const l of f) { const cur = m.get(l.item_name) || { name: l.item_name, months: new Map(), qty: 0, revenue: 0 }; cur.qty += l.qty; cur.revenue += l.revenue; const mo = l.sale_date.slice(0, 7); cur.months.set(mo, (cur.months.get(mo) || 0) + l.qty); m.set(l.item_name, cur); }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [f, customer]);
  const months = useMemo(() => [...new Set(f.map((l) => l.sale_date.slice(0, 7)))].sort(), [f]);

  const uniq = (k: (l: Line) => string) => [...new Set(lines.map(k))].filter(Boolean).sort();
  const anyFilter = category || item || rep || customer;
  const reps = group((l) => l.rep_name || "No rep");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Periods preset={preset} onPreset={onPreset} />
        {fetching && <OrbSpinner className="h-5 w-5" state="working" label="Updating" />}
        <button onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}
          className={cn("ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium", (showFilters || filterCount > 0) && "text-primary")}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters{filterCount > 0 && ` (${filterCount})`}
        </button>
      </div>
      {showFilters && (
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="fi h-8 w-36 text-xs" value={from} onChange={(e) => onDates(e.target.value, to)} aria-label="From" />
        <input type="date" className="fi h-8 w-36 text-xs" value={to} onChange={(e) => onDates(from, e.target.value)} aria-label="To" />
        <select className="fi h-8 w-36 text-xs" value={category || ""} onChange={(e) => { setCategory(e.target.value || null); setItem(null); }} aria-label="Category"><option value="">All categories</option>{uniq((l) => l.category).map((c) => <option key={c}>{c}</option>)}</select>
        <select className="fi h-8 w-36 text-xs" value={item || ""} onChange={(e) => setItem(e.target.value || null)} aria-label="Item"><option value="">All items</option>{uniq((l) => (!category || l.category === category ? l.item_name : "")).map((c) => <option key={c}>{c}</option>)}</select>
        <select className="fi h-8 w-32 text-xs" value={rep || ""} onChange={(e) => setRep(e.target.value || null)} aria-label="Sales rep"><option value="">All reps</option>{uniq((l) => l.rep_name || "No rep").map((c) => <option key={c}>{c}</option>)}</select>
        <select className="fi h-8 w-36 text-xs" value={customer || ""} onChange={(e) => setCustomer(e.target.value || null)} aria-label="Customer"><option value="">All customers</option>{uniq((l) => (l.customer_id ? l.customer_name : "")).map((c) => <option key={c}>{c}</option>)}</select>
        {anyFilter && <button onClick={() => { setCategory(null); setItem(null); setRep(null); setCustomer(null); }} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium"><X className="h-3 w-3" /> Clear</button>}
      </div>
      )}

      {loading ? <OrbLoader label="Crunching the numbers…" /> : (
        <>
          <DashCard>
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              {([["Sales", formatKES(revenue)], ["Profit", formatKES(profit)], ["Units", Math.round(units).toLocaleString()]] as const).map(([l, v]) => (
                <div key={l} className="min-w-0"><p className="text-xs text-muted-foreground">{l}</p><p className={cn("truncate text-lg font-bold tabular-nums", l === "Profit" && profit < 0 && "text-destructive")}>{v}</p></div>
              ))}
            </div>
            <SalesLine data={trend} className="-mx-3 mt-1 h-44" />
          </DashCard>

          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
            <DashCard title="By category"><RankedBars rows={categories} picked={category} onPick={(n) => { setCategory(category === n ? null : n); setItem(null); }} /></DashCard>
            {(reps.length > 1 || (reps[0] && reps[0].name !== "No rep")) && <DashCard title="By sales rep"><RankedBars rows={reps} picked={rep} onPick={(n) => setRep(rep === n ? null : n)} /></DashCard>}
            <DashCard title="How customers paid"><RankedBars rows={group((l) => PAY_LABEL[l.payment_method] || l.payment_method)} /></DashCard>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <DashCard title={`Top items${category ? ` in ${category}` : ""}`}>
              {items.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No sales in this period</p> : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="dt dt-keep"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Sales</th><th className="num">Profit</th></tr></thead>
                    <tbody>{items.slice(0, 25).map((r) => (
                      <tr key={r.name} className="cursor-pointer" onClick={() => setItem(item === r.name ? null : r.name)}>
                        <td className={cn(item === r.name && "font-semibold text-primary")}>{r.name}</td>
                        <td className="num">{Math.round(r.qty).toLocaleString()}</td><td className="num font-semibold">{formatKES(r.revenue)}</td>
                        <td className={cn("num", r.revenue - r.cost < 0 && "text-destructive")}>{formatKES(r.revenue - r.cost)}</td>
                      </tr>
                    ))}</tbody></table>
                </div>
              )}
            </DashCard>
            <DashCard title="Best customers"
              action={categories.length > 1 ? <select className="fi h-7 w-36 text-xs" value={activeBest || ""} onChange={(e) => setBestCat(e.target.value || null)} aria-label="Category for best customers">{categories.map((c) => <option key={c.name}>{c.name}</option>)}</select> : undefined}>
              {best.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No known customers bought in this period.</p> : (
                <table className="dt dt-keep"><thead><tr><th>#</th><th>Customer</th><th className="num">Orders</th><th className="num">Spent</th></tr></thead>
                  <tbody>{best.map((b, i) => (
                    <tr key={b.id || b.name}>
                      <td>{i === 0 ? <Crown className="h-4 w-4 text-primary" /> : i + 1}</td>
                      <td><Link to={`/customers/${b.id}`} className="font-semibold hover:text-primary">{b.name}</Link><span className="block text-xs text-muted-foreground">Last {fmtDate(b.last)}</span></td>
                      <td className="num">{b.orders.size}</td><td className="num font-semibold">{formatKES(b.revenue)}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </DashCard>
          </div>

          {customer && (
            <DashCard title={`${customer}: by item over time`} action={<button onClick={() => setCustomer(null)} className="text-xs text-primary">Close</button>}>
              <div className="overflow-x-auto">
                <table className="dt dt-keep min-w-[600px]"><thead><tr><th>Item</th>{months.map((m) => <th key={m} className="num">{new Date(`${m}-01`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</th>)}<th className="num">Total qty</th><th className="num">Spent</th></tr></thead>
                  <tbody>{custItems.map((r) => (
                    <tr key={r.name}><td className="font-medium">{r.name}</td>{months.map((m) => <td key={m} className="num">{r.months.get(m) ? Math.round(r.months.get(m)!) : "-"}</td>)}<td className="num">{Math.round(r.qty)}</td><td className="num font-semibold">{formatKES(r.revenue)}</td></tr>
                  ))}</tbody></table>
              </div>
            </DashCard>
          )}

          {showHours && (
            <DashCard title="Sales by hour">
              <div className="h-48">
                <ResponsiveContainer debounce={120} width="100%" height="100%">
                  <BarChart data={hours} margin={{ left: 0, right: 4, top: 4, bottom: 0 }} barCategoryGap={4}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tickFormatter={short} tick={axis} tickLine={false} axisLine={false} width={40} />
                    <Tooltip formatter={(v: any) => formatKES(Number(v))} contentStyle={tip} cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }} />
                    <Bar dataKey="value" name="Sales" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </DashCard>
          )}
        </>
      )}
    </div>
  );
}
