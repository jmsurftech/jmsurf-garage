import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Car, CheckCircle2, Hourglass, PackageSearch, Wallet, Smartphone, ArrowDownLeft, ArrowUpRight, AlertTriangle, Wrench, Plus } from "lucide-react";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import { cn } from "@/lib/utils";
import { sb } from "../lib/api";
import { iso } from "@/pages/dashboard/parts";

function Tile({ label, value, icon: Icon, tone = "primary", to, hint }: { label: string; value: string | number; icon: any; tone?: string; to?: string; hint?: string }) {
  const tile = { primary: "hsl(var(--primary))", success: "hsl(var(--success))", warning: "hsl(var(--warning))", info: "hsl(var(--info))", danger: "hsl(var(--destructive))" }[tone];
  const body = (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-2.5 py-2 transition hover:border-primary/40">
      <span className="g-tile xs" style={{ ["--tile" as any]: tile }}><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0"><p className="truncate text-[11px] text-muted-foreground">{label}</p><p className="truncate font-display text-[15px] font-bold tabular-nums">{value}</p>{hint && <p className="truncate text-[10px] text-muted-foreground">{hint}</p>}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

/**
 * Garage panel at the top of the dashboard: today's sales and M-Pesa, cars in / ready / waiting,
 * money owed to and by the garage, and things that need attention.
 * `posToday` / `posMpesaToday` are the till figures the dashboard already loads.
 */
export default function GarageDashboardPanel({ posToday = 0, posMpesaToday = 0 }: { posToday?: number; posMpesaToday?: number }) {
  const tenantId = useTenantId();
  const { slug } = useParams<{ slug: string }>();
  const to = (p: string) => tenantPath(slug, p);
  const today = iso(new Date());
  const year = new Date().getFullYear();

  const { data: g } = useQuery({
    queryKey: ["gw-dash", tenantId, today], enabled: !!tenantId, refetchInterval: 120_000,
    queryFn: async () => {
      const [jobs, inv, pay, parts, bookings] = await Promise.all([
        sb.from("garage_jobs").select("id,status,promised_at,stage_entered_at").eq("tenant_id", tenantId).not("status", "in", "(collected,cancelled)"),
        sb.from("invoices").select("total,status").eq("tenant_id", tenantId).eq("issue_date", today).not("status", "in", "(draft,void)"),
        sb.from("payments_received").select("amount,method").eq("tenant_id", tenantId).eq("payment_date", today),
        sb.from("garage_part_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["requested", "partly_issued", "to_order"]),
        sb.from("garage_bookings").select("id,status,starts_at").eq("tenant_id", tenantId).gte("starts_at", `${today}T00:00:00`).lt("starts_at", `${today}T23:59:59`),
      ]);
      const j = (jobs.data || []) as any[];
      const now = Date.now();
      return {
        open: j.length,
        ready: j.filter((x) => x.status === "ready").length,
        approval: j.filter((x) => x.status === "waiting_approval").length,
        parts: j.filter((x) => x.status === "waiting_parts").length,
        late: j.filter((x) => x.promised_at && Date.parse(x.promised_at) < now && x.status !== "ready").length,
        stuck: j.filter((x) => x.status === "waiting_approval" && now - Date.parse(x.stage_entered_at) > 3 * 3600_000).length,
        invoiced: (inv.data || []).reduce((s: number, x: any) => s + Number(x.total || 0), 0),
        mpesa: (pay.data || []).filter((x: any) => /m-?pesa/i.test(String(x.method || ""))).reduce((s: number, x: any) => s + Number(x.amount || 0), 0),
        partsWaiting: parts.count || 0,
        bookingsPending: (bookings.data || []).filter((b: any) => b.status === "pending").length,
        bookingsToday: (bookings.data || []).filter((b: any) => ["pending", "confirmed"].includes(b.status)).length,
        ok: !jobs.error,
      };
    },
  });
  // Same query (and cache) the dashboard's money view uses.
  const { data: books } = useQuery({
    queryKey: ["books-overview", tenantId, year], enabled: !!tenantId, staleTime: 60_000,
    queryFn: async () => ((await sb.rpc("dash_books_overview", { p_year: year })).data || null) as any,
  });
  if (!g?.ok) return null;
  const alerts: [string, string][] = [
    ...(g.late ? [[`${g.late} car(s) past the promised time`, "/garage/jobs"]] as [string, string][] : []),
    ...(g.stuck ? [[`${g.stuck} estimate(s) waiting over 3 hours: call the customer`, "/garage/estimates"]] as [string, string][] : []),
    ...(g.partsWaiting ? [[`${g.partsWaiting} part request(s) waiting at the store`, "/garage/parts"]] as [string, string][] : []),
    ...(g.bookingsPending ? [[`${g.bookingsPending} online booking(s) to confirm today`, "/garage/bookings"]] as [string, string][] : []),
  ];

  return (
    <section className="space-y-2 rounded-3xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-base font-bold"><Wrench className="h-4 w-4" />Garage today</h2>
        <div className="flex gap-2">
          <Link to={to("/garage")} className="h-8 rounded-xl border border-border px-2.5 text-xs font-medium leading-8">Workshop board</Link>
          <Link to={to("/garage/jobs/new")} className="inline-flex h-8 items-center gap-1 rounded-xl bg-primary px-2.5 text-xs font-semibold text-primary-foreground"><Plus className="h-3.5 w-3.5" />Check in</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="Sales today" value={formatKES(g.invoiced + posToday)} icon={Wallet} tone="success" hint={posToday ? `invoices + till` : "invoices"} />
        <Tile label="M-Pesa received" value={formatKES(g.mpesa + posMpesaToday)} icon={Smartphone} tone="success" />
        <Tile label="Cars in" value={g.open} icon={Car} to={to("/garage")} hint={`${g.bookingsToday} booked today`} />
        <Tile label="Ready" value={g.ready} icon={CheckCircle2} tone="success" to={to("/garage/jobs")} />
        <Tile label="Waiting approval" value={g.approval} icon={Hourglass} tone="warning" to={to("/garage/estimates")} />
        <Tile label="Waiting parts" value={g.parts} icon={PackageSearch} tone="warning" to={to("/garage/parts")} />
        <Tile label="Owed to the garage" value={books?.receivables ? formatKES(Number(books.receivables.total)) : "—"} icon={ArrowDownLeft} tone="info" to={to("/sales/invoices")} />
        <Tile label="The garage owes" value={books?.payables ? formatKES(Number(books.payables.total)) : "—"} icon={ArrowUpRight} tone="danger" to={to("/purchases/bills")} />
      </div>
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {alerts.map(([text, path]) => (
            <Link key={text} to={to(path)} className={cn("inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-[hsl(32_90%_38%)] dark:text-warning")}>
              <AlertTriangle className="h-3.5 w-3.5" />{text}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
