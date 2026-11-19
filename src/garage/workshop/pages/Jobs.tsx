import { useMemo, useState } from "react";
import { Wrench, Plus } from "lucide-react";
import { PageHeader, Panel, Toolbar, SearchBox, Segmented, TableWrap, EmptyState, PageLoader } from "@/components/kit";
import { useJobs, useLiveWorkshop } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { JOB_TYPES, stageMinutes, humanMinutes } from "../lib/status";
import { JobStatusPill, PlateTag, money, vehicleLabel, when } from "../components/bits";

const VIEWS = [
  { value: "open", label: "Open" }, { value: "waiting", label: "Waiting" }, { value: "ready", label: "Ready" }, { value: "done", label: "Collected" }, { value: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];

export default function Jobs() {
  useLiveWorkshop();
  const { go } = useWorkshopLinks();
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const { data: jobs = [], isLoading } = useJobs({ limit: 1000 });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s/g, "");
    return (jobs as any[]).filter((j) => {
      if (view === "open" && ["collected", "cancelled"].includes(j.status)) return false;
      if (view === "waiting" && !["waiting_approval", "waiting_parts"].includes(j.status)) return false;
      if (view === "ready" && j.status !== "ready") return false;
      if (view === "done" && j.status !== "collected") return false;
      if (type && j.job_type !== type) return false;
      if (!s) return true;
      return `${j.job_no}${j.vehicle?.plate || ""}${j.vehicle?.make || ""}${j.vehicle?.model || ""}${j.customer?.name || ""}${j.customer?.phone || ""}${j.complaint || ""}`.toLowerCase().replace(/\s/g, "").includes(s);
    });
  }, [jobs, view, q, type]);
  const counts = (v: View) => (jobs as any[]).filter((j) => v === "all" || (v === "open" ? !["collected", "cancelled"].includes(j.status) : v === "waiting" ? ["waiting_approval", "waiting_parts"].includes(j.status) : v === "ready" ? j.status === "ready" : j.status === "collected")).length;

  return (
    <div className="space-y-3">
      <PageHeader title="Job cards" icon={Wrench} actions={<button type="button" onClick={() => go("/garage/jobs/new")} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Check in</button>} />
      <Toolbar>
        <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={VIEWS.map((v) => ({ ...v, count: counts(v.value) }))} />
        <SearchBox value={q} onChange={setQ} placeholder="Search plate, job, customer…" />
        <select className="fi w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">All job types</option>{JOB_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </Toolbar>
      <Panel flush>
        {isLoading ? <PageLoader /> : !rows.length ? <EmptyState icon={Wrench} title="No job cards here" description="Check in a vehicle to open a job card." /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Job</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>In stage</th><th>Promised</th><th className="num">Approved</th></tr></thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} className="cursor-pointer" onClick={() => go(`/garage/jobs/${j.id}`)}>
                    <td><p className="font-medium">{j.job_no}</p><p className="max-w-[16rem] truncate text-xs text-muted-foreground">{j.complaint}</p></td>
                    <td><PlateTag plate={j.vehicle?.plate} /><p className="text-xs text-muted-foreground">{vehicleLabel(j.vehicle)}</p></td>
                    <td><p>{j.customer?.name || "—"}</p><p className="text-xs text-muted-foreground">{j.customer?.phone || ""}</p></td>
                    <td><JobStatusPill status={j.status} />{j.comeback_of && <span className="ml-1 text-[10px] font-semibold text-warning">Comeback</span>}</td>
                    <td className="tabular-nums">{["collected", "cancelled"].includes(j.status) ? "—" : humanMinutes(Number(stageMinutes(j)[j.status]) || 0)}</td>
                    <td className={j.promised_at && Date.parse(j.promised_at) < Date.now() && !["ready", "collected", "cancelled"].includes(j.status) ? "font-semibold text-destructive" : ""}>{when(j.promised_at)}</td>
                    <td className="num">{money(j.approved_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
