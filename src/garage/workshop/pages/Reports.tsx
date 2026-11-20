import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { PageHeader, Panel, StatGrid, StatTile, TableWrap, PageLoader, PickMenu } from "@/components/kit";
import { useTenantId } from "@/hooks/useTenantId";
import { downloadCsv } from "@/components/Bulk";
import { sb, must } from "../lib/api";
import { STATUS_LABEL, JOB_TYPES, humanMinutes, type JobStatus } from "../lib/status";
import { useWorkshopLinks } from "../lib/nav";
import { PlateTag, money, when } from "../components/bits";

const RANGES = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "12 months" }] as const;
type Range = (typeof RANGES)[number]["value"];

export default function Reports() {
  const tenantId = useTenantId();
  const { href } = useWorkshopLinks();
  const [range, setRange] = useState<Range>("30");
  const from = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(range)); return d.toISOString(); }, [range]);
  const to = useMemo(() => new Date(Date.now() + 86_400_000).toISOString(), []);
  const { data: r, isLoading } = useQuery({
    queryKey: ["gw-report", tenantId, from], enabled: !!tenantId,
    queryFn: async () => must(await sb.rpc("garage_report", { p_from: from, p_to: to })) as any,
  });
  const { data: due = [] } = useQuery({
    queryKey: ["gw-service-due", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_vehicles").select("id,plate,make,model,next_service_date,next_service_km,mileage,customer:customers(name,phone)").eq("tenant_id", tenantId)
      .lte("next_service_date", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)).order("next_service_date").limit(300)) as any[],
  });
  if (isLoading || !r) return <PageLoader />;

  const statusRows = Object.entries(r.by_status || {}).map(([k, v]) => ({ name: STATUS_LABEL[k as JobStatus] || k, jobs: Number(v) }));
  const stage = r.stage_minutes || {};
  const waitParts = Number(stage.waiting_parts || 0), waitApproval = Number(stage.waiting_approval || 0);
  const mechanics: any[] = r.mechanics || [];
  const approval = r.estimates_sent ? Math.round((Number(r.estimates_approved) / Number(r.estimates_sent)) * 100) : null;

  return (
    <div className="space-y-3">
      <PageHeader title="Workshop reports" icon={BarChart3} actions={<PickMenu value={range} onChange={(v) => setRange(v)} options={RANGES.map((x) => ({ ...x }))} ariaLabel="Period" />} />
      <StatGrid className="lg:grid-cols-6">
        <StatTile label="Jobs" value={r.jobs} />
        <StatTile label="Average time in the shop" value={r.avg_hours_in_shop ? `${r.avg_hours_in_shop} h` : "—"} tone="info" />
        <StatTile label="Average job value" value={money(r.avg_job_value)} tone="success" />
        <StatTile label="Estimate approval rate" value={approval === null ? "—" : `${approval}%`} hint={`${r.estimates_approved}/${r.estimates_sent} · ${money(r.estimate_value_approved)} of ${money(r.estimate_value_sent)}`} tone="success" />
        <StatTile label="Comebacks" value={r.comebacks} hint={Number(r.comeback_cost) ? `${money(r.comeback_cost)} cost` : undefined} tone={Number(r.comebacks) ? "danger" : "muted"} />
        <StatTile label="Customer rating" value={r.rating_avg ? `${r.rating_avg} / 5` : "—"} hint={`${r.ratings} ratings`} tone="warning" />
      </StatGrid>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Jobs by status">
          <div className="h-56">
            <ResponsiveContainer debounce={120} width="100%" height="100%">
              <BarChart data={statusRows} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-25} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} width={30} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Bar dataKey="jobs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">By type: {Object.entries(r.by_type || {}).map(([k, v]) => `${JOB_TYPES.find((t) => t[0] === k)?.[1] || k} ${v}`).join(" · ") || "—"}</p>
        </Panel>
        <Panel title="Time lost">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Waiting for parts</span><b>{humanMinutes(waitParts)}</b></div>
            <div className="flex justify-between"><span>Waiting for approval</span><b>{humanMinutes(waitApproval)}</b></div>
            <div className="flex justify-between"><span>Checked in, not started</span><b>{humanMinutes(Number(stage.checked_in || 0))}</b></div>
            <div className="flex justify-between"><span>Ready, not collected</span><b>{humanMinutes(Number(stage.ready || 0))}</b></div>
            <p className="text-xs text-muted-foreground">Totals for jobs opened in the period, counted when each job leaves a stage.</p>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Bay use</p>
          <ul className="text-sm">{(r.bay_use || []).map((b: any) => <li key={b.bay} className="flex justify-between"><span>{b.bay}</span><span className="tabular-nums">{b.jobs} jobs · {b.hours} h</span></li>)}</ul>
        </Panel>
      </div>

      <Panel title="Mechanics: hours sold against hours clocked" flush actions={<button type="button" onClick={() => downloadCsv("mechanics.csv", ["Mechanic", "Hours sold", "Hours clocked", "Labour revenue"], mechanics.map((m) => [m.name, m.sold_hours, m.clocked_hours, m.revenue]))} className="inline-flex items-center gap-1 text-xs text-primary"><Download className="h-3.5 w-3.5" />CSV</button>}>
        <TableWrap><table className="dt">
          <thead><tr><th>Mechanic</th><th className="num">Hours sold</th><th className="num">Hours clocked</th><th className="num">Efficiency</th><th className="num">Labour revenue</th></tr></thead>
          <tbody>
            {!mechanics.length && <tr><td colSpan={5} className="text-center text-muted-foreground">Assign mechanics to labour lines and use clock on / off to see this.</td></tr>}
            {mechanics.map((m) => <tr key={m.mechanic_id}><td>{m.name}</td><td className="num">{m.sold_hours}</td><td className="num">{m.clocked_hours}</td><td className="num">{Number(m.clocked_hours) ? `${Math.round((Number(m.sold_hours) / Number(m.clocked_hours)) * 100)}%` : "—"}</td><td className="num">{money(m.revenue)}</td></tr>)}
          </tbody>
        </table></TableWrap>
      </Panel>

      <Panel title="Service due (next 30 days and overdue)" flush actions={<button type="button" onClick={() => downloadCsv("service-due.csv", ["Plate", "Vehicle", "Owner", "Phone", "Service date", "Service km", "Mileage"], (due as any[]).map((v) => [v.plate, [v.make, v.model].filter(Boolean).join(" "), v.customer?.name || "", v.customer?.phone || "", v.next_service_date || "", v.next_service_km || "", v.mileage || ""]))} className="inline-flex items-center gap-1 text-xs text-primary"><Download className="h-3.5 w-3.5" />CSV</button>}>
        <TableWrap><table className="dt">
          <thead><tr><th>Plate</th><th>Owner</th><th>Service due</th><th className="num">Mileage</th></tr></thead>
          <tbody>
            {!(due as any[]).length && <tr><td colSpan={4} className="text-center text-muted-foreground">No services due in the next 30 days.</td></tr>}
            {(due as any[]).map((v) => <tr key={v.id}><td><a href={href(`/garage/vehicles/${v.id}`)}><PlateTag plate={v.plate} /></a> <span className="text-xs text-muted-foreground">{[v.make, v.model].filter(Boolean).join(" ")}</span></td><td>{v.customer?.name || "—"}<p className="text-xs text-muted-foreground">{v.customer?.phone || ""}</p></td><td className={Date.parse(v.next_service_date) < Date.now() ? "text-destructive" : ""}>{when(v.next_service_date, false)}{v.next_service_km ? ` or ${Number(v.next_service_km).toLocaleString()} km` : ""}</td><td className="num">{v.mileage ? Number(v.mileage).toLocaleString() : "—"}</td></tr>)}
          </tbody>
        </table></TableWrap>
      </Panel>
    </div>
  );
}
