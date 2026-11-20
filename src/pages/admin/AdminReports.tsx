import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/fetchAll";
import { format, subDays, startOfMonth, subMonths, differenceInCalendarDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { Download, TrendingUp, Banknote, CreditCard, RefreshCw, Calendar, Percent, BarChart3, Trophy, ArrowRight } from "lucide-react";
import { PageHeader, Panel, StatTile, EmptyState, Segmented, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#ef4444"];
const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--popover-foreground))" };
const axis = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const methodLabel = (g?: string) => {
  const k = String(g || "").toLowerCase();
  if (["mpesa", "daraja", "jmsurf", "payhero", "sendmoney"].includes(k)) return "M-Pesa";
  if (k === "paystack") return "Paystack";
  if (k === "manual") return "Manual";
  return k ? k[0].toUpperCase() + k.slice(1) : "Other";
};

type Range = "7d" | "30d" | "90d" | "ytd" | "all";
const RANGE_LABEL: Record<Range, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", ytd: "This year", all: "All time" };

export default function AdminReports() {
  const [range, setRange] = useState<Range>("30d");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const [{ data: pays }, { data: ss }, { data: ts }] = await Promise.all([
        allRows(() => supabase.from("subscription_payments").select("id, tenant_id, amount, gateway, status, created_at, metadata, reference").order("created_at", { ascending: false })),
        allRows(() => supabase.from("subscriptions").select("tenant_id, status, price, billing_cycle").order("tenant_id")),
        allRows(() => supabase.from("tenants").select("id, business_name, slug, deleted_at").order("created_at")),
      ]);
      return { payments: (pays || []) as any[], subs: (ss || []) as any[], tenants: (ts || []) as any[] };
    },
    staleTime: 30_000,
  });

  const now = new Date();
  const fromDate = range === "7d" ? subDays(now, 6) : range === "30d" ? subDays(now, 29) : range === "90d" ? subDays(now, 89)
    : range === "ytd" ? new Date(now.getFullYear(), 0, 1) : new Date(2000, 0, 1);

  const all = data?.payments || [];
  const tenantMap = useMemo(() => Object.fromEntries((data?.tenants || []).map((t: any) => [t.id, t])), [data?.tenants]);
  const liveIds = useMemo(() => new Set((data?.tenants || []).filter((t: any) => !t.deleted_at).map((t: any) => t.id)), [data?.tenants]);
  const allCompleted = all.filter((p) => p.status === "completed");
  const inRange = all.filter((p) => new Date(p.created_at) >= fromDate);
  const completed = inRange.filter((p) => p.status === "completed");
  const totalRevenue = completed.reduce((s, p) => s + Number(p.amount || 0), 0);
  const failedCount = inRange.filter((p) => p.status === "failed" || p.status === "cancelled").length;
  const settled = completed.length + failedCount;
  const successRate = settled ? Math.round((completed.length / settled) * 100) : 0;

  const mrr = (data?.subs || []).filter((s) => s.status === "active" && liveIds.has(s.tenant_id)).reduce((sum, s) => {
    const p = Number(s.price || 0);
    return sum + (s.billing_cycle === "annually" ? p / 12 : s.billing_cycle === "quarterly" ? p / 3 : p);
  }, 0);

  const dailySeries = useMemo(() => {
    const first = range === "all" && allCompleted.length ? new Date(allCompleted[allCompleted.length - 1].created_at) : fromDate;
    const days = Math.min(365, Math.max(1, differenceInCalendarDays(now, first) + 1));
    const map: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) map[format(subDays(now, i), "d MMM")] = 0;
    completed.forEach((p) => { const k = format(new Date(p.created_at), "d MMM"); if (map[k] !== undefined) map[k] += Number(p.amount || 0); });
    return Object.entries(map).map(([date, revenue]) => ({ date, revenue }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range]);

  // Always the last six months, whatever range is picked.
  const monthlySeries = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const m = startOfMonth(subMonths(now, 5 - i));
    const next = startOfMonth(subMonths(now, 4 - i));
    const revenue = allCompleted.filter((p) => { const d = new Date(p.created_at); return d >= m && (i === 5 || d < next); })
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    return { month: format(m, "MMM yy"), revenue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data]);

  const methodRev = useMemo(() => {
    const m: Record<string, number> = {};
    completed.forEach((p) => { const k = methodLabel(p.gateway); m[k] = (m[k] || 0) + Number(p.amount || 0); });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range]);

  const planRev = useMemo(() => {
    const m: Record<string, number> = {};
    completed.forEach((p) => { const k = p.metadata?.plan_name || "Other"; m[k] = (m[k] || 0) + Number(p.amount || 0); });
    return Object.entries(m).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range]);

  const topShops = useMemo(() => {
    const m: Record<string, number> = {};
    completed.forEach((p) => { m[p.tenant_id] = (m[p.tenant_id] || 0) + Number(p.amount || 0); });
    return Object.entries(m).sort(([, a], [, b]) => b - a).slice(0, 8)
      .map(([id, total]) => ({ name: tenantMap[id]?.business_name || "—", slug: tenantMap[id]?.slug, total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range, tenantMap]);

  const exportCsv = () => {
    const rows = [["Date", "Company", "Package", "Method", "Amount", "Status", "Reference"],
      ...inRange.map((p) => [format(new Date(p.created_at), "yyyy-MM-dd HH:mm"), tenantMap[p.tenant_id]?.business_name || "", p.metadata?.plan_name || "", methodLabel(p.gateway), p.amount, p.status, p.reference || ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `platform-revenue-${range}-${format(now, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isLoading) return <div className="p-4 sm:p-6"><PageLoader label="Loading reports…" /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title="Reports" description="Platform revenue, recurring income and how companies pay." icon={BarChart3}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={isFetching ? "animate-spin" : ""} /> Refresh</Button>
          <Button size="sm" onClick={exportCsv} disabled={!inRange.length}><Download /> Export CSV</Button>
        </>}>
        <Segmented value={range} onChange={(v) => setRange(v as Range)} options={(Object.keys(RANGE_LABEL) as Range[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label={`Revenue · ${RANGE_LABEL[range]}`} value={ksh(totalRevenue)} icon={Banknote} tone="success" />
        <StatTile label="Monthly recurring" value={ksh(mrr)} icon={TrendingUp} tone="info" hint="Active packages, per month" />
        <StatTile label="Yearly run-rate" value={ksh(mrr * 12)} icon={Calendar} tone="primary" />
        <StatTile label="Paid payments" value={completed.length} icon={CreditCard} tone="success" hint={`${failedCount} failed or cancelled`} />
        <StatTile label="Success rate" value={`${successRate}%`} icon={Percent} tone={successRate >= 80 ? "success" : "warning"} />
      </div>

      <Panel title="Daily revenue" description={RANGE_LABEL[range]} icon={TrendingUp}>
        <ResponsiveContainer debounce={120} width="100%" height={250}>
          <AreaChart data={dailySeries}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={axis} axisLine={false} tickLine={false} interval={Math.max(0, Math.ceil(dailySeries.length / 8) - 1)} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [ksh(v), "Revenue"]} />
            <Area type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} fill="url(#revGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Last 6 months" icon={BarChart3}>
          <ResponsiveContainer debounce={120} width="100%" height={240}>
            <BarChart data={monthlySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} formatter={(v: number) => [ksh(v), "Revenue"]} />
              <Bar dataKey="revenue" fill="#f97316" radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="How companies pay" description={RANGE_LABEL[range]} icon={CreditCard}>
          {methodRev.length === 0 ? <EmptyState title="No payments in this period" /> : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer debounce={120} width="55%" height={220}>
                <PieChart>
                  <Pie data={methodRev} cx="50%" cy="50%" innerRadius={52} outerRadius={85} dataKey="value" paddingAngle={3} stroke="none">
                    {methodRev.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [ksh(v), ""]} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-2 text-sm">
                {methodRev.map((g, i) => (
                  <li key={g.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{g.name}</span>
                    <span className="font-semibold tabular-nums">{ksh(g.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Revenue by package" description={RANGE_LABEL[range]} icon={BarChart3}>
          {planRev.length === 0 ? <EmptyState title="No payments in this period" /> : (
            <ResponsiveContainer debounce={120} width="100%" height={240}>
              <BarChart data={planRev} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                <YAxis type="category" dataKey="name" tick={axis} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} formatter={(v: number) => [ksh(v), "Revenue"]} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 8, 8, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Top paying companies" description={RANGE_LABEL[range]} icon={Trophy} flush
          actions={<Link to="/admin/payments" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">All payments <ArrowRight className="h-3 w-3" /></Link>}>
          {topShops.length === 0 ? <EmptyState title="No payments in this period" className="py-10" /> : (
            <ol className="divide-y divide-border">
              {topShops.map((t, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    {t.slug && <p className="font-mono text-[11px] text-muted-foreground">{t.slug}</p>}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-success">{ksh(t.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
