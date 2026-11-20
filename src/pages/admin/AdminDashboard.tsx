import { useQuery } from "@tanstack/react-query";
import { Orb } from "@/components/Orb";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/fetchAll";
import {
  Building2, CreditCard, Users, TrendingUp, Clock, AlertTriangle, BarChart3, Activity, RefreshCw, Hourglass, ArrowRight, Wallet, ScrollText, Target, Package,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, AreaChart, Area } from "recharts";
import { format, subDays, startOfMonth, subMonths, formatDistanceToNowStrict } from "date-fns";
import { PageHeader, StatGrid, Panel, StatTile, TableWrap, EmptyState, StatusPill, PageLoader, btnCls } from "@/components/kit";

const COLORS = ["#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ef4444"];
const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--popover-foreground))" };
const axis = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;

async function loadDashboard() {
  const since = startOfMonth(subMonths(new Date(), 5)).toISOString();
  const [{ data: tenants }, { data: subscriptions }, { data: payments }] = await Promise.all([
    allRows(() => supabase.from("tenants").select("id, business_name, slug, contact_email, industry, created_at, deleted_at, is_active").order("created_at", { ascending: false })),
    allRows(() => supabase.from("subscriptions").select("tenant_id, plan_name, status, billing_cycle, trial_ends_at, current_period_end").order("tenant_id")),
    allRows(() => supabase.from("subscription_payments").select("id, tenant_id, amount, gateway, status, created_at, metadata").gte("created_at", since).order("created_at", { ascending: false })),
  ]);

  const all = (tenants || []) as any[];
  const live = all.filter((t) => !t.deleted_at);
  const liveIds = new Set(live.map((t) => t.id));
  const names = new Map(all.map((t) => [t.id, t.business_name || t.slug || "Company"]));
  const subs = ((subscriptions || []) as any[]).filter((s) => liveIds.has(s.tenant_id));
  const pays = (payments || []) as any[];
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 864e5);
  const isTrial = (s: any) => s.status === "trial" || s.status === "trialing";

  const completed = pays.filter((p) => p.status === "completed");
  const monthStart = startOfMonth(now);
  const monthRevenue = completed.filter((p) => new Date(p.created_at) >= monthStart).reduce((a, p) => a + Number(p.amount || 0), 0);

  const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(now, 5 - i)));
  const revenueByMonth = months.map((m, i) => {
    const end = months[i + 1] || new Date(8.64e15);
    return {
      month: format(m, "MMM"),
      revenue: completed.filter((p) => { const d = new Date(p.created_at); return d >= m && d < end; }).reduce((a, p) => a + Number(p.amount || 0), 0),
    };
  });

  const trend: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) trend[format(subDays(now, i), "MMM dd")] = 0;
  all.forEach((t) => { const k = format(new Date(t.created_at), "MMM dd"); if (trend[k] !== undefined) trend[k]++; });

  const planMap: Record<string, number> = {};
  subs.forEach((s) => { const k = s.plan_name || "No plan"; planMap[k] = (planMap[k] || 0) + 1; });

  const endingTrials = subs
    .filter((s) => isTrial(s) && s.trial_ends_at && new Date(s.trial_ends_at) > now && new Date(s.trial_ends_at) <= in7)
    .sort((a, b) => +new Date(a.trial_ends_at) - +new Date(b.trial_ends_at))
    .map((s) => ({ ...s, name: names.get(s.tenant_id) }));

  return {
    stats: {
      shops: live.length,
      archived: all.length - live.length,
      paying: subs.filter((s) => s.status === "active").length,
      trials: subs.filter(isTrial).length,
      endingSoon: endingTrials.length,
      attention: subs.filter((s) => ["expired", "paused", "past_due", "cancelled"].includes(s.status)).length,
      newThisWeek: live.filter((t) => new Date(t.created_at) >= subDays(now, 7)).length,
      monthRevenue,
    },
    revenueByMonth,
    signupTrend: Object.entries(trend).map(([date, count]) => ({ date, count })),
    planDist: Object.entries(planMap).map(([name, value]) => ({ name, value })),
    endingTrials,
    recentPayments: pays.slice(0, 8).map((p) => ({ ...p, name: names.get(p.tenant_id) || "—" })),
    recentShops: all.slice(0, 8),
  };
}

export default function AdminDashboard() {
  const { data, isLoading, isFetching, refetch } = useQuery({ queryKey: ["admin-dashboard"], queryFn: loadDashboard, staleTime: 30_000 });

  if (isLoading || !data) return <div><PageLoader label="Loading dashboard…" /></div>;
  const { stats } = data;

  return (
    <div className="space-y-3">
      <PageHeader title="Dashboard" icon={BarChart3} actions={<>
        <Orb state={isFetching ? "working" : "connecting"} size={20} theme="dark" label={isFetching ? "Refreshing" : "Live"} className="mr-1 hidden sm:block" />
        <button type="button" className={btnCls} onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} /><span className="hidden sm:inline">Refresh</span>
        </button>
      </>} />

      <StatGrid className="md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active companies" value={stats.shops} icon={Building2} tone="info" hint={`${stats.archived} archived`} to="/admin/customers" />
        <StatTile label="Paying" value={stats.paying} icon={CreditCard} tone="success" hint={`${Math.round((stats.paying / Math.max(1, stats.shops)) * 100)}% of active`} />
        <StatTile label="On trial" value={stats.trials} icon={Users} tone="primary" hint={`${stats.endingSoon} ending in 7 days`} />
        <StatTile label="Revenue this month" value={ksh(stats.monthRevenue)} icon={TrendingUp} tone="success" to="/admin/payments" />
        <StatTile label="Needs attention" value={stats.attention} icon={AlertTriangle} tone={stats.attention ? "danger" : "muted"} hint="Expired, paused or unpaid" />
        <StatTile label="New this week" value={stats.newThisWeek} icon={Clock} tone="info" />
      </StatGrid>

      {/* What needs attention first, then the charts. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Trials ending soon" description="Next 7 days" icon={Hourglass} flush
          actions={<Link to="/admin/customers" className="text-xs font-semibold text-primary hover:underline">All companies</Link>}>
          {data.endingTrials.length === 0 ? <EmptyState title="No trials ending this week" className="py-10" /> : (
            <ul className="divide-y divide-border">
              {data.endingTrials.map((s: any) => (
                <li key={s.tenant_id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.plan_name || "No plan"}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-warning">in {formatDistanceToNowStrict(new Date(s.trial_ends_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent payments" icon={CreditCard} flush
          actions={<Link to="/admin/payments" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>}>
          {data.recentPayments.length === 0 ? <EmptyState title="No payments yet" className="py-10" /> : (
            <TableWrap>
              <table className="dt">
                <thead><tr><th>Company</th><th>When</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {data.recentPayments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="max-w-[180px] truncate font-medium">{p.name}</td>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(p.created_at), "d MMM, HH:mm")}</td>
                      <td className="num font-semibold">{ksh(Number(p.amount))}</td>
                      <td><StatusPill status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Revenue" description="Completed payments, last 6 months" icon={BarChart3} className="lg:col-span-2">
          <ResponsiveContainer debounce={120} width="100%" height={240}>
            <BarChart data={data.revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} formatter={(v: number) => [ksh(v), "Revenue"]} />
              <Bar dataKey="revenue" fill="#f97316" radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Packages" description="Active companies by package" icon={CreditCard}>
          {data.planDist.length === 0 ? <EmptyState title="No subscriptions yet" /> : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer debounce={120} width="55%" height={200}>
                <PieChart>
                  <Pie data={data.planDist} cx="50%" cy="50%" innerRadius={48} outerRadius={78} dataKey="value" paddingAngle={3} stroke="none">
                    {data.planDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="min-w-0 flex-1 space-y-2 text-sm">
                {data.planDist.map((p, i) => (
                  <li key={p.name} className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="min-w-0 truncate text-muted-foreground">{p.name}</span>
                    <span className="font-semibold tabular-nums">{p.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sign-ups" description="New companies, last 30 days" icon={Activity}>
          <ResponsiveContainer debounce={120} width="100%" height={200}>
            <AreaChart data={data.signupTrend}>
              <defs>
                <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" tick={axis} interval={6} axisLine={false} tickLine={false} />
              <YAxis tick={axis} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="count" name="Sign-ups" stroke="#f97316" strokeWidth={2} fill="url(#signupGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Newest companies" icon={Building2} flush
          actions={<Link to="/admin/customers" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>}>
          {data.recentShops.length === 0 ? <EmptyState title="No companies yet" className="py-10" /> : (
            <TableWrap>
              <table className="dt">
                <thead><tr><th>Company</th><th>Contact</th><th>Joined</th><th>Status</th></tr></thead>
                <tbody>
                  {data.recentShops.map((t: any) => (
                    <tr key={t.id}>
                      <td>
                        <p className="max-w-[180px] truncate font-medium">{t.business_name || "—"}</p>
                        <p className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">{t.slug ? `${t.slug}.garage.jmsurf.co.ke` : "—"}</p>
                      </td>
                      <td className="max-w-[180px] truncate text-muted-foreground">{t.contact_email || "—"}</td>
                      <td className="whitespace-nowrap text-muted-foreground">{format(new Date(t.created_at), "d MMM yyyy")}</td>
                      <td><StatusPill status={t.deleted_at ? "archived" : t.is_active === false ? "suspended" : "active"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
