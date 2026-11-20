import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Car, CheckCircle2, Wallet, Smartphone, AlertTriangle, Hourglass, PackageSearch, CalendarDays, Clock, type LucideIcon } from "lucide-react";
import { StatTile } from "@/components/kit";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { tenantPath } from "@/lib/host";
import { sb } from "../lib/api";
import { iso } from "@/pages/dashboard/parts";

export interface GarageToday {
  open: number; ready: number; approval: number; parts: number; late: number; stuck: number;
  invoiced: number; mpesa: number; partsWaiting: number; bookingsPending: number; bookingsToday: number; ok: boolean;
}

/** Today's garage figures: cars in / ready / waiting, today's sales and M-Pesa, store and booking queues. */
export function useGarageToday() {
  const tenantId = useTenantId();
  const today = iso(new Date());
  return useQuery({
    queryKey: ["gw-dash", tenantId, today], enabled: !!tenantId, refetchInterval: 120_000,
    queryFn: async (): Promise<GarageToday> => {
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
}

export interface AttentionItem { key: string; to: string; icon: LucideIcon; tone: "warning" | "destructive" | "info" | "primary"; title: string; sub?: string }

/** The garage's "needs attention" rows: each one a short line that links to where it is fixed. */
export function garageAttention(g?: GarageToday | null): AttentionItem[] {
  if (!g?.ok) return [];
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  const out: AttentionItem[] = [];
  if (g.late) out.push({ key: "late", to: "/garage/jobs", icon: Clock, tone: "destructive", title: `${n(g.late, "car")} past the promised time`, sub: "Call the customer" });
  if (g.approval) out.push({ key: "approval", to: "/garage/estimates", icon: Hourglass, tone: "warning", title: `${n(g.approval, "car")} waiting approval`, sub: g.stuck ? `${g.stuck} over 3 hours: call the customer` : "Estimates sent" });
  if (g.parts) out.push({ key: "parts", to: "/garage/jobs", icon: PackageSearch, tone: "warning", title: `${n(g.parts, "car")} waiting parts` });
  if (g.partsWaiting) out.push({ key: "store", to: "/garage/parts", icon: PackageSearch, tone: "info", title: `${n(g.partsWaiting, "part request")} at the store`, sub: "Issue from stock" });
  if (g.bookingsPending) out.push({ key: "bookings", to: "/garage/bookings", icon: CalendarDays, tone: "primary", title: `${n(g.bookingsPending, "online booking")} to confirm`, sub: "Today" });
  return out;
}

/**
 * Garage strip for the till dashboard: today's sales and M-Pesa, cars in and ready, and the
 * attention links. One strip, no buttons (Check in lives in the page header).
 * `posToday` / `posMpesaToday` are the till figures that dashboard already loads.
 */
export default function GarageDashboardPanel({ posToday = 0, posMpesaToday = 0 }: { posToday?: number; posMpesaToday?: number }) {
  const { slug } = useParams<{ slug: string }>();
  const to = (p: string) => tenantPath(slug, p);
  const { data: g } = useGarageToday();
  if (!g?.ok) return null;
  const alerts = garageAttention(g);
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Sales today" value={formatKES(g.invoiced + posToday)} icon={Wallet} tone="success" hint={posToday ? "Invoices and till" : "Invoices"} />
        <StatTile label="M-Pesa today" value={formatKES(g.mpesa + posMpesaToday)} icon={Smartphone} tone="success" />
        <StatTile label="Cars in" value={g.open} icon={Car} to={to("/garage")} hint={`${g.bookingsToday} booked today`} />
        <StatTile label="Ready" value={g.ready} icon={CheckCircle2} tone="success" to={to("/garage/jobs?view=ready")} />
      </div>
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {alerts.map((a) => (
            <Link key={a.key} to={to(a.to)} className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-[hsl(32_90%_38%)] dark:text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />{a.title}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
