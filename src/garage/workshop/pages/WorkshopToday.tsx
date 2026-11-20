import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Wrench, Plus, Tv, CalendarDays, Car, Clock, CheckCircle2, PackageSearch, Hourglass, Smartphone, Columns3, List } from "lucide-react";
import { PageHeader, Panel, StatGrid, StatTile, Segmented, MoreMenu, PickMenu, SearchBox, TableWrap, EmptyState, PageLoader, btnPrimaryCls } from "@/components/kit";
import { PagedRows } from "@/components/Pager";
import { cn } from "@/lib/utils";
import { useJobs, useBookings, useLiveWorkshop, useRefresh } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { JOB_TYPES, stageMinutes, humanMinutes } from "../lib/status";
import Board, { type BoardMode } from "../components/Board";
import { JobStatusPill, PlateTag, money, vehicleLabel, when } from "../components/bits";

const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const VIEWS = [
  { value: "open", label: "Open" }, { value: "waiting", label: "Waiting" }, { value: "ready", label: "Ready" }, { value: "done", label: "Collected" }, { value: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["value"];
const inView = (j: any, v: View) =>
  v === "all" ? true
    : v === "open" ? !["collected", "cancelled"].includes(j.status)
      : v === "waiting" ? ["waiting_approval", "waiting_parts"].includes(j.status)
        : v === "ready" ? j.status === "ready" : j.status === "collected";

/**
 * Job cards: ONE page for the workshop with a Board / List switch (it used to be two menu entries,
 * "Today / Workshop board" and "Job cards", that showed the same jobs). /garage opens the board,
 * /garage/jobs the list. One key-figure strip, one Check in button; TV board and mechanic view in More.
 */
export default function Workshop({ start = "board" }: { start?: "board" | "list" }) {
  useLiveWorkshop();
  const { go, href } = useWorkshopLinks();
  const refresh = useRefresh();
  const [params] = useSearchParams();
  const layout = start;
  const [mode, setMode] = useState<BoardMode>("stage");
  const asked = params.get("view");
  const [view, setView] = useState<View>(() => (VIEWS.some((v) => v.value === asked) ? (asked as View) : "open"));
  useEffect(() => { if (VIEWS.some((v) => v.value === asked)) setView(asked as View); }, [asked]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const { data: open = [] } = useJobs({ open: true });
  const { data: all = [], isLoading } = useJobs({ limit: 1000 });
  const from = useMemo(() => dayStart().toISOString(), []);
  const to = useMemo(() => new Date(dayStart().getTime() + 86_400_000).toISOString(), []);
  const { data: bookings = [] } = useBookings(from, to);
  const count = (s: string) => (open as any[]).filter((j) => j.status === s).length;
  const inToday = (open as any[]).filter((j) => j.checked_in_at && j.checked_in_at >= from).length;
  const waitingBookings = (bookings as any[]).filter((b) => ["pending", "confirmed"].includes(b.status));

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s/g, "");
    return (all as any[]).filter((j) => {
      if (!inView(j, view)) return false;
      if (type && j.job_type !== type) return false;
      if (!s) return true;
      return `${j.job_no}${j.vehicle?.plate || ""}${j.vehicle?.make || ""}${j.vehicle?.model || ""}${j.customer?.name || ""}${j.customer?.phone || ""}${j.complaint || ""}`.toLowerCase().replace(/\s/g, "").includes(s);
    });
  }, [all, view, q, type]);

  return (
    <div className="space-y-3">
      <PageHeader title="Job cards" icon={Wrench} actions={<>
        <Segmented value={layout} onChange={(v) => go(v === "board" ? "/garage" : "/garage/jobs")}
          options={[{ value: "board", label: <span className="inline-flex items-center gap-1"><Columns3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Board</span></span> }, { value: "list", label: <span className="inline-flex items-center gap-1"><List className="h-3.5 w-3.5" /><span className="hidden sm:inline">List</span></span> }]} />
        <MoreMenu iconOnly items={[
          { label: "TV board", icon: Tv, href: href("/garage/board"), newTab: true },
          { label: "Mechanic view", icon: Smartphone, href: href("/garage/mechanic") },
          { label: "Bookings", icon: CalendarDays, href: href("/garage/bookings"), separator: true },
        ]} />
        <button type="button" onClick={() => go("/garage/jobs/new")} className={btnPrimaryCls}><Plus className="h-4 w-4" />Check in</button>
      </>} />

      <StatGrid className="lg:grid-cols-6">
        <StatTile label="Cars in" value={(open as any[]).length} icon={Car} />
        <StatTile label="In today" value={inToday} icon={Clock} tone="info" />
        <StatTile label="Waiting approval" value={count("waiting_approval")} icon={Hourglass} tone="warning" to={href("/garage/estimates")} />
        <StatTile label="Waiting parts" value={count("waiting_parts")} icon={PackageSearch} tone="warning" to={href("/garage/parts")} />
        <StatTile label="Ready" value={count("ready")} icon={CheckCircle2} tone="success" to={href("/garage/jobs?view=ready")} />
        <StatTile label="Booked today" value={waitingBookings.length} icon={CalendarDays} tone="muted" to={href("/garage/bookings")} />
      </StatGrid>

      {layout === "board" ? (
        <>
          {waitingBookings.length > 0 && (
            <Panel title="Expected today" icon={CalendarDays} flush actions={<a href={href("/garage/bookings")} className="text-xs font-medium text-primary">All bookings</a>}>
              <div className="divide-y divide-border">
                {waitingBookings.map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{new Date(b.starts_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
                    <PlateTag plate={b.plate} /><span className="min-w-0 flex-1 truncate">{b.name || ""}{b.service ? ` · ${b.service}` : ""}</span>
                    <button type="button" onClick={() => go(`/garage/jobs/new?booking=${b.id}`)} className="h-8 shrink-0 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground">Check in</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <div className="flex items-center justify-between gap-2">
            <Segmented value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "stage", label: "By stage" }, { value: "bay", label: "By bay" }]} />
            <span className="hidden text-[11px] text-muted-foreground md:inline">Drag a car to move it</span>
          </div>
          {(open as any[]).length ? <Board jobs={open as any[]} mode={mode} onOpen={(id) => go(`/garage/jobs/${id}`)} onChanged={refresh} />
            : <Panel><EmptyState icon={Car} title="No cars in the workshop" description="Check in a car to open its job card." action={<button type="button" onClick={() => go("/garage/jobs/new")} className={btnPrimaryCls}><Plus className="h-4 w-4" />Check in</button>} /></Panel>}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <PickMenu value={view} onChange={setView} ariaLabel="Which jobs" options={VIEWS.map((v) => ({ ...v, count: (all as any[]).filter((j) => inView(j, v.value)).length }))} />
            <SearchBox value={q} onChange={setQ} placeholder="Search plate, job, customer…" />
            <select className="fi h-9 w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Job type"><option value="">All job types</option>{JOB_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <Panel flush>
            {isLoading ? <PageLoader /> : !rows.length ? (
              <EmptyState icon={Wrench} title={q || type ? "No job cards match" : "No job cards here"}
                description={q || type ? "Clear the search or pick another view." : "Check in a car to open a job card."}
                action={q || type ? <button type="button" onClick={() => { setQ(""); setType(""); }} className="h-9 rounded-xl border border-border px-3 text-sm">Clear search</button>
                  : <button type="button" onClick={() => go("/garage/jobs/new")} className={btnPrimaryCls}><Plus className="h-4 w-4" />Check in</button>} />
            ) : (
              <TableWrap>
                <table className="dt">
                  <thead><tr><th>Job</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>In stage</th><th>Promised</th><th className="num">Approved</th></tr></thead>
                  <tbody>
                    <PagedRows rows={rows} colSpan={7}>{(page) => page.map((j: any) => (
                      <tr key={j.id} className="cursor-pointer" onClick={() => go(`/garage/jobs/${j.id}`)}>
                        <td><p className="font-medium">{j.job_no}</p><p className="max-w-[16rem] truncate text-xs text-muted-foreground">{j.complaint}</p></td>
                        <td><PlateTag plate={j.vehicle?.plate} /><p className="truncate text-xs text-muted-foreground">{vehicleLabel(j.vehicle)}</p></td>
                        <td><p className="truncate">{j.customer?.name || "—"}</p><p className="text-xs text-muted-foreground">{j.customer?.phone || ""}</p></td>
                        <td><JobStatusPill status={j.status} />{j.comeback_of && <span className="ml-1 text-[10px] font-semibold text-warning">Comeback</span>}</td>
                        <td className="whitespace-nowrap tabular-nums">{["collected", "cancelled"].includes(j.status) ? "—" : humanMinutes(Number(stageMinutes(j)[j.status]) || 0)}</td>
                        <td className={cn("whitespace-nowrap", j.promised_at && Date.parse(j.promised_at) < Date.now() && !["ready", "collected", "cancelled"].includes(j.status) && "font-semibold text-destructive")}>{when(j.promised_at)}</td>
                        <td className="num">{money(j.approved_total)}</td>
                      </tr>
                    ))}</PagedRows>
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
