import PageHead from "@/components/PageHead";
import { formatKES } from "@/lib/format";
import { useProducts, useLocations, useSalesInRange } from "@/hooks/useData";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useExpiredBatches, useExpiringBatches } from "@/hooks/useBatches";
import {
  TrendingUp, TrendingDown, ShoppingCart, AlertTriangle, Plus, Package, BarChart3, Receipt,
  Wallet, CalendarX, ArrowRight, Clock, Sparkles, Settings as SettingsIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { tenantPath } from "@/lib/host";
import { methodLabel, itemsSummary } from "@/lib/exportUtils";
import { Orb } from "@/components/Orb";

/** Local calendar date (not UTC), so sales after midnight belong to the right day. */
const localDay = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

const METHOD_COLORS: Record<string, string> = {
  mpesa: "bg-emerald-500", cash: "bg-sky-500", card: "bg-violet-500", split: "bg-amber-500",
  credit: "bg-rose-500", mobile_money: "bg-teal-500",
};

function TrialBanner() {
  const { subscription } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const status = subscription?.status;
  if (!subscription || (status !== "trial" && status !== "trialing") || !subscription.trial_ends_at) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86_400_000));
  if (daysLeft <= 0) return null;
  return (
    <div className={cn("rounded-xl border px-4 py-3 flex items-center justify-between flex-wrap gap-3",
      daysLeft <= 2 ? "border-destructive/40 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className={cn("w-4 h-4", daysLeft <= 2 ? "text-destructive" : "text-warning")} />
        {daysLeft === 1 ? "Your trial ends tomorrow" : `${daysLeft} days left on your free trial`}
      </div>
      <Link to={tenantPath(slug, "/billing")} className="text-sm font-semibold text-primary hover:underline">Choose a package →</Link>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, trend, tone = "primary" }: {
  label: string; value: string; sub?: string; icon: any; trend?: number | null; tone?: "primary" | "success" | "warning" | "info";
}) {
  const tile = { primary: "hsl(var(--primary))", success: "hsl(var(--success))", warning: "hsl(var(--warning))", info: "hsl(var(--info))" }[tone];
  return (
    <div className="bg-card rounded-3xl border border-border p-4 sm:p-5">
      <span className="g-tile" style={{ ["--tile" as any]: tile }}><Icon className="w-5 h-5" /></span>
      <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-[clamp(1.35rem,2.3vw,1.9rem)] font-display font-extrabold mt-1 leading-tight tracking-tight tabular-nums">{value}</p>
      <div className="flex items-center gap-2 mt-1 text-xs">
        {trend != null && Number.isFinite(trend) && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", trend >= 0 ? "text-success" : "text-destructive")}>
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(Math.round(trend))}%
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("bg-card rounded-3xl border border-border", className)}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="font-display text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { profile } = useAuth();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const isWaterShop = useBusinessType().businessType === "water";
  const { data: locations = [] } = useLocations();
  const expired = useExpiredBatches();
  const expiring = useExpiringBatches(30);
  const [locationId, setLocationId] = useState("__all__");

  // Only the last eight days are needed here (today, yesterday and the week).
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 7); return d.toISOString(); }, []);
  const { data: recent = [], isLoading: salesLoading } = useSalesInRange(since, null);

  const sales = useMemo(() => recent.filter((t: any) =>
    t.status === "completed" && t.payment_method !== "credit_note" && (locationId === "__all__" || t.location_id === locationId)),
    [recent, locationId]);

  const todayKey = localDay(new Date());
  const yesterdayKey = localDay(new Date(Date.now() - 86_400_000));
  const today = useMemo(() => sales.filter((t: any) => localDay(t.created_at) === todayKey), [sales, todayKey]);
  const yesterday = useMemo(() => sales.filter((t: any) => localDay(t.created_at) === yesterdayKey), [sales, yesterdayKey]);

  const sum = (rows: any[]) => rows.reduce((s, t) => s + Number(t.total || 0), 0);
  const todayTotal = sum(today);
  const yesterdayTotal = sum(yesterday);
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const todayCost = today.reduce((s, t: any) => s + (Array.isArray(t.items) ? t.items : []).reduce((c: number, l: any) => c + Number(l.cost_price || 0) * Number(l.quantity || 0), 0), 0);
  const todayTax = today.reduce((s, t: any) => s + Number(t.tax || 0), 0);
  const grossToday = todayTotal - todayCost - todayTax;
  const lowStock = useMemo(() => (products as any[]).filter((p) => Number(p.stock || 0) <= Number(p.reorder_level || 0)), [products]);

  const week = useMemo(() => {
    const out: { day: string; sales: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = localDay(d);
      out.push({ day: d.toLocaleDateString("en-KE", { weekday: "short" }), sales: sum(sales.filter((t: any) => localDay(t.created_at) === key)) });
    }
    return out;
  }, [sales]);

  // Sales per hour, today against yesterday, over the hours the shop trades.
  const hourly = useMemo(() => {
    const t = new Array(24).fill(0), y = new Array(24).fill(0);
    today.forEach((x: any) => { t[new Date(x.created_at).getHours()] += Number(x.total || 0); });
    yesterday.forEach((x: any) => { y[new Date(x.created_at).getHours()] += Number(x.total || 0); });
    const active = t.map((v, i) => v + y[i]).map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    const from = active.length ? Math.min(active[0], 8) : 8;
    const to = active.length ? Math.max(active[active.length - 1], 18) : 18;
    const out: { hour: string; today: number; yesterday: number }[] = [];
    for (let h = from; h <= to; h++) out.push({ hour: `${String(h).padStart(2, "0")}:00`, today: Math.round(t[h]), yesterday: Math.round(y[h]) });
    const busiest = t.indexOf(Math.max(...t));
    return { rows: out, busiest: t[busiest] > 0 ? `${String(busiest).padStart(2, "0")}:00` : null };
  }, [today, yesterday]);

  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    today.forEach((t: any) => m.set(t.payment_method || "cash", (m.get(t.payment_method || "cash") || 0) + Number(t.total || 0)));
    return Array.from(m.entries()).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount);
  }, [today]);

  const topItems = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; amount: number }>();
    today.forEach((t: any) => (Array.isArray(t.items) ? t.items : []).forEach((l: any) => {
      const k = String(l.product_id || l.id || l.name);
      const r = m.get(k) || { name: l.name || "Item", qty: 0, amount: 0 };
      r.qty += Number(l.quantity || 0);
      r.amount += Number(l.quantity || 0) * Number(l.price || 0);
      m.set(k, r);
    }));
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount).slice(0, 6);
  }, [today]);

  const latest = useMemo(() => recent.filter((t: any) => locationId === "__all__" || t.location_id === locationId).slice(0, 8), [recent, locationId]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = String(profile?.display_name || "").split(" ")[0];
  const needsSetup = !productsLoading && (products as any[]).length === 0;

  if (salesLoading && recent.length === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
        <div className="grid lg:grid-cols-3 gap-6"><Skeleton className="lg:col-span-2 h-80 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHead title="Today · JMSURF Garage" description="Live sales, stock and cashflow overview for your store." noindex />
      <TrialBanner />

      {/* Greeting + actions */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Orb state="breathing" label="Live" className="hidden sm:block" />
          <div>
          <h1 className="text-2xl font-display font-bold">{greeting}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · figures update live
          </p>
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {locations.length > 1 && (
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
              className="h-10 px-3 rounded-xl bg-card border border-input text-sm" aria-label="Branch">
              <option value="__all__">All branches</option>
              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <Link to={tenantPath(slug, isWaterShop ? "/water/products" : "/inventory/products")} className="h-10 inline-flex items-center gap-2 px-4 rounded-xl border border-border bg-card text-sm font-medium hover:bg-muted">
            <Package className="w-4 h-4" /> {isWaterShop ? "Refill sizes" : "Products"}
          </Link>
          <Link to={tenantPath(slug, isWaterShop ? "/water/reports" : "/reports")} className="h-10 inline-flex items-center gap-2 px-4 rounded-xl border border-border bg-card text-sm font-medium hover:bg-muted">
            <BarChart3 className="w-4 h-4" /> Reports
          </Link>
          <Link to={tenantPath(slug, "/pos")} className="h-10 inline-flex items-center gap-2 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:opacity-90">
            <Plus className="w-4 h-4" /> New sale
          </Link>
        </div>
      </div>

      {needsSetup && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Let's get your company ready</p>
            <p className="text-sm text-muted-foreground">Add your products and choose your payment gateway, then start selling.</p>
          </div>
          <Link to={tenantPath(slug, "/settings")} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <SettingsIcon className="w-4 h-4" /> Settings
          </Link>
        </div>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Sales today" value={formatKES(todayTotal)} trend={pct(todayTotal, yesterdayTotal)} sub="vs yesterday" icon={Wallet} tone="success" />
        <Kpi label="Transactions" value={String(today.length)} trend={pct(today.length, yesterday.length)} sub={`${yesterday.length} yesterday`} icon={Receipt} tone="info" />
        <Kpi label="Average sale" value={formatKES(today.length ? todayTotal / today.length : 0)} sub="per transaction" icon={ShoppingCart} />
        <Kpi label="Gross profit today" value={formatKES(grossToday)} sub={todayTotal ? `${Math.round((grossToday / todayTotal) * 100)}% margin` : "after cost & VAT"} icon={TrendingUp} tone={grossToday >= 0 ? "success" : "warning"} />
      </div>

      <Card title="Sales by hour"
        action={<span className="text-xs text-muted-foreground">{hourly.busiest ? `Busiest today: ${hourly.busiest}` : "Today vs yesterday"}</span>}>
        <div className="h-56 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourly.rows} margin={{ left: 0, right: 12, top: 8 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="hour" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} formatter={(v: number, n: string) => [formatKES(v), n === "today" ? "Today" : "Yesterday"]} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-muted-foreground">{v === "today" ? "Today" : "Yesterday"}</span>} />
              <Bar dataKey="yesterday" fill="hsl(var(--muted-foreground))" fillOpacity={0.25} radius={[4, 4, 0, 0]} />
              <Bar dataKey="today" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Last 7 days" className="lg:col-span-2" action={<span className="text-xs text-muted-foreground">{formatKES(sum(sales.filter((t: any) => new Date(t.created_at).getTime() >= Date.now() - 7 * 86_400_000)))}</span>}>
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={week} margin={{ left: 0, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip formatter={(v: number) => [formatKES(v), "Sales"]} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#salesFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Today by payment">
          <div className="px-5 pb-5 space-y-3">
            {byMethod.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No sales yet today</p>}
            {byMethod.map((m) => (
              <div key={m.method}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{methodLabel(m.method)}</span>
                  <span className="font-semibold">{formatKES(m.amount)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full", METHOD_COLORS[m.method] || "bg-primary")} style={{ width: `${todayTotal ? (m.amount / todayTotal) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Latest sales" className="lg:col-span-2"
          action={<Link to={tenantPath(slug, "/payments")} className="text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline">All payments <ArrowRight className="w-3.5 h-3.5" /></Link>}>
          <div className="divide-y divide-border">
            {latest.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No sales in the last week</p>}
            {latest.map((t: any) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <span className={cn("w-2 h-2 rounded-full shrink-0",
                  t.status === "completed" ? "bg-success" : t.status === "pending" ? "bg-warning" : "bg-destructive")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{itemsSummary(t) || "Sale"}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString("en-KE", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {t.cashier_name || "—"} · {methodLabel(t.payment_method)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-semibold", t.status !== "completed" && "text-muted-foreground line-through")}>{formatKES(Number(t.total || 0))}</p>
                  {t.status !== "completed" && <p className="text-[11px] capitalize text-muted-foreground">{t.status}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Top items today">
            <div className="px-5 pb-4 space-y-2.5">
              {topItems.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nothing sold yet today</p>}
              {topItems.map((i, idx) => (
                <div key={i.name} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 rounded-lg bg-muted text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="text-muted-foreground">×{i.qty}</span>
                  <span className="font-medium w-24 text-right">{formatKES(i.amount)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Stock alerts"
            action={<Link to={tenantPath(slug, "/inventory/products")} className="text-xs font-medium text-primary hover:underline">Inventory</Link>}>
            <div className="px-5 pb-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning" /> Low or out of stock</span>
                <strong>{lowStock.length}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2"><CalendarX className="w-4 h-4 text-destructive" /> Expired batches</span>
                <strong>{expired.length}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-warning" /> Expiring in 30 days</span>
                <strong>{expiring.length}</strong>
              </div>
              {lowStock.slice(0, 5).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
                  <span className="truncate">{p.name}</span>
                  <span className={cn("font-semibold", Number(p.stock) <= 0 ? "text-destructive" : "text-warning")}>{Number(p.stock || 0)} left</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
