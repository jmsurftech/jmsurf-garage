import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, PackageSearch } from "lucide-react";
import { PageHeader, Panel, Segmented, TableWrap, EmptyState, PageLoader, StatusPill, StatGrid, StatTile, btnCls } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { useTenantId } from "@/hooks/useTenantId";
import { usePermissions } from "@/hooks/usePermissions";
import { sb, must } from "../lib/api";
import { useRefresh, useLiveWorkshop } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { PartRequestRow } from "../components/JobParts";
import { PlateTag, money, when } from "../components/bits";

/** All estimates with their answer, for follow-up. */
export function EstimateList() {
  const tenantId = useTenantId();
  const { go } = useWorkshopLinks();
  const [view, setView] = useState<"waiting" | "answered" | "all">("waiting");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["gw-estimates", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_estimates").select("*, job:garage_jobs(id,job_no,status,vehicle:garage_vehicles(plate),customer:customers(name,phone))").eq("tenant_id", tenantId).neq("status", "superseded").order("created_at", { ascending: false }).limit(500)) as any[],
  });
  const shown = (rows as any[]).filter((e) => view === "all" || (view === "waiting" ? ["draft", "sent", "viewed"].includes(e.status) : ["approved", "partly_approved", "declined", "expired"].includes(e.status)));
  const sent = (rows as any[]).filter((e) => e.sent_at);
  const yes = sent.filter((e) => ["approved", "partly_approved"].includes(e.status));
  return (
    <div className="space-y-3">
      <PageHeader title="Estimates" icon={FileText} />
      <StatGrid>
        <StatTile label="Waiting for an answer" value={(rows as any[]).filter((e) => ["sent", "viewed"].includes(e.status)).length} icon={FileText} tone="warning" />
        <StatTile label="Approval rate" value={sent.length ? `${Math.round((yes.length / sent.length) * 100)}%` : "—"} tone="success" />
        <StatTile label="Value sent" value={money(sent.reduce((s, e) => s + Number(e.total || 0), 0))} />
        <StatTile label="Value approved" value={money(sent.reduce((s, e) => s + Number(e.approved_total || 0), 0))} tone="success" />
      </StatGrid>
      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "waiting", label: "Waiting" }, { value: "answered", label: "Answered" }, { value: "all", label: "All" }]} />
      <Panel flush>
        {isLoading ? <PageLoader /> : !shown.length ? <EmptyState icon={FileText} title="No estimates here" description="Make an estimate on a job card, in its Estimate tab." action={<button type="button" onClick={() => go("/garage/jobs")} className={btnCls}>Open job cards</button>} /> : (
          <TableWrap><table className="dt">
            <thead><tr><th>Job</th><th>Vehicle</th><th>Customer</th><th>Version</th><th>Status</th><th>Sent</th><th>Valid to</th><th className="num">Total</th><th className="num">Approved</th></tr></thead>
            <tbody><PagedRows rows={shown} colSpan={9}>{(page) => page.map((e: any) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => go(`/garage/jobs/${e.job?.id}`)}>
                <td className="font-medium">{e.job?.job_no}</td><td><PlateTag plate={e.job?.vehicle?.plate} /></td><td>{e.job?.customer?.name || "—"}</td>
                <td>v{e.version}{e.kind === "extra" ? " · extra" : ""}</td><td><StatusPill status={e.status} /></td><td>{when(e.sent_at)}</td>
                <td className={e.expires_at && Date.parse(e.expires_at) < Date.now() ? "text-destructive" : ""}>{when(e.expires_at, false)}</td>
                <td className="num">{money(e.total)}</td><td className="num">{money(e.approved_total)}</td>
              </tr>))}</PagedRows></tbody>
          </table></TableWrap>
        )}
      </Panel>
    </div>
  );
}

/** The store's queue: parts asked for by jobs, issued from stock, unused parts taken back. */
export function PartsQueue() {
  useLiveWorkshop();
  const tenantId = useTenantId();
  const refresh = useRefresh();
  const { can } = usePermissions();
  const { href } = useWorkshopLinks();
  const [view, setView] = useState<"open" | "issued" | "all">("open");
  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["gw-parts", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_part_requests").select("*, job:garage_jobs(id,job_no,status,vehicle:garage_vehicles(plate))").eq("tenant_id", tenantId).order("requested_at", { ascending: false }).limit(500)) as any[],
  });
  const shown = useMemo(() => (rows as any[]).filter((r) => view === "all" || (view === "open" ? ["requested", "partly_issued", "to_order"].includes(r.status) : ["issued", "returned"].includes(r.status))), [rows, view]);
  const byJob = useMemo(() => { const m = new Map<string, any[]>(); for (const r of shown) m.set(r.job_id, [...(m.get(r.job_id) || []), r]); return [...m.values()]; }, [shown]);
  const canIssue = can("garage_parts", "issue") || can("inventory_adjustments", "create");
  return (
    <div className="space-y-3">
      <PageHeader title="Parts for jobs" icon={PackageSearch} />
      <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "open", label: "To issue", count: (rows as any[]).filter((r) => ["requested", "partly_issued", "to_order"].includes(r.status)).length }, { value: "issued", label: "Issued" }, { value: "all", label: "All" }]} />
      {isLoading ? <PageLoader /> : !byJob.length ? <Panel><EmptyState icon={PackageSearch} title="Nothing waiting" description="Parts asked for on a job card (Parts tab) show here for the store." /></Panel> : byJob.map((list) => (
        <Panel key={list[0].job_id} title={<span className="flex items-center gap-2"><a href={href(`/garage/jobs/${list[0].job?.id}`)} className="hover:underline">{list[0].job?.job_no}</a><PlateTag plate={list[0].job?.vehicle?.plate} /></span>}>
          <div className="divide-y divide-border">{list.map((r) => <PartRequestRow key={r.id} r={r} onChange={() => { void refetch(); refresh(); }} canIssue={canIssue} />)}</div>
        </Panel>
      ))}
    </div>
  );
}
