import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Wrench, ChevronRight, Copy, Printer, Send, Save, AlertTriangle, ClipboardCheck, Plus, Timer, Undo2, Car, XCircle, ArrowRight, type LucideIcon } from "lucide-react";
import { PageHeader, Panel, PageLoader, EmptyState, LineTabs, MoreMenu, RecordSplit, btnPrimaryCls, type MenuAction } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must, wsApi } from "../lib/api";
import { useBays, useJob, useJobs, useMechanics, useRefresh, useInspectionTemplates, useLiveWorkshop } from "../lib/data";
import { STATUS_LABEL, nextStatuses, moveProblem, stageMinutes, humanMinutes, primaryNext, JOB_TYPES, WAITING_STAGES, type JobStatus } from "../lib/status";
import { jobTotals, lineGross } from "../lib/totals";
import { useWorkshopLinks } from "../lib/nav";
import { CarDiagram, JobStatusPill, MechanicChips, MediaStrip, PlateTag, Sub, money, vehicleLabel, when } from "../components/bits";
import JobLines from "../components/JobLines";
import JobEstimate from "../components/JobEstimate";
import JobParts from "../components/JobParts";
import JobMoney from "../components/JobMoney";
import JobQC, { QC_PASS_EVENT } from "../components/JobQC";

type Tab = "work" | "estimate" | "parts" | "inspection" | "checkin" | "photos" | "qc" | "money" | "history";

/** The workshop flow in plain steps, and where each status sits in it. */
const STEPS = ["Check in", "Inspect", "Estimate", "Approve", "Work", "Quality check", "Ready", "Release"];
const STEP_OF: Record<JobStatus, number> = {
  booked: 0, checked_in: 1, diagnosing: 2, waiting_approval: 3, waiting_parts: 4, in_progress: 4, quality_check: 5, ready: 7, collected: 8, cancelled: -1,
};

function JobSteps({ status }: { status: JobStatus }) {
  const at = STEP_OF[status];
  if (at < 0) return null;
  return (
    <div className="job-steps" aria-label="Job progress">
      {STEPS.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <b />}
          <span className={cn(i < at && "is-done", i === at && "is-now")}><i />{s}{i === 4 && status === "waiting_parts" && i === at ? " (waiting parts)" : ""}</span>
        </Fragment>
      ))}
    </div>
  );
}

function printJob(d: any, nameOf: (id: string) => string) {
  const { job, lines } = d;
  const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const t = jobTotals(lines);
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(job.job_no)}</title><style>
    body{font:13px/1.4 Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}
    td,th{border:1px solid #ccc;padding:5px;text-align:left}th{background:#f3f3f3}.r{text-align:right}.g{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
    .box{border:1px solid #ccc;padding:8px;min-height:40px}</style></head><body>
    <h1>Job card ${esc(job.job_no)}</h1><p>${esc(when(job.checked_in_at || job.created_at))} · ${esc(STATUS_LABEL[job.status as JobStatus])}</p>
    <div class="g"><div class="box"><b>Vehicle</b><br>${esc(job.vehicle?.plate)} ${esc(vehicleLabel(job.vehicle))}<br>Mileage in: ${esc(job.mileage_in ?? "")} km · Fuel: ${esc(job.fuel_level ?? "")}</div>
    <div class="box"><b>Customer</b><br>${esc(job.customer?.name ?? "")}<br>${esc(job.customer?.phone ?? "")}</div></div>
    <div class="box" style="margin-top:6px"><b>Complaint</b><br>${esc(job.complaint)}</div>
    <div class="box" style="margin-top:6px"><b>Findings</b><br>${esc(job.findings ?? "")}</div>
    <table><tr><th>Work / part</th><th>Mechanic</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th><th>Approved</th></tr>
    ${lines.filter((l: any) => l.status !== "cancelled").map((l: any) => `<tr><td>${esc(l.description)}</td><td>${esc((l.mechanic_ids || []).map(nameOf).join(", "))}</td><td class="r">${esc(l.qty)}</td><td class="r">${esc(money(l.rate))}</td><td class="r">${esc(money(lineGross(l)))}</td><td>${l.approved === true ? "Yes" : l.approved === false ? "No" : ""}</td></tr>`).join("")}
    <tr><td colspan="4" class="r"><b>Total</b></td><td class="r"><b>${esc(money(t.total))}</b></td><td></td></tr></table>
    <div class="g" style="margin-top:30px"><div>Service advisor: ____________________</div><div>Customer: ____________________</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function JobCard() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { go, href } = useWorkshopLinks();
  const refresh = useRefresh();
  useLiveWorkshop();
  const { data, isLoading, refetch } = useJob(id);
  const { data: bays = [] } = useBays();
  const { data: templates = [] } = useInspectionTemplates();
  const mech = useMechanics();
  const { data: openJobs = [], isLoading: railLoading } = useJobs({ open: true });
  const [tab, setTab] = useState<Tab>("work");
  const [notes, setNotes] = useState<any>({});
  const [obd, setObd] = useState("");
  const reload = () => { void refetch(); refresh(); };

  useEffect(() => {
    if (data?.job) setNotes({ findings: data.job.findings || "", customer_notes: data.job.customer_notes || "", internal_notes: data.job.internal_notes || "" });
  }, [data?.job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stages = useMemo(() => (data?.job ? stageMinutes(data.job) : {}), [data?.job]);
  // The open jobs beside the record (from 1280px wide); the open record stays in the list even when collected.
  const railRows = useMemo(() => {
    const list = [...(openJobs as any[])];
    if (data?.job && !list.some((j) => j.id === data.job.id)) list.unshift(data.job);
    return list.map((j) => ({
      id: j.id, title: <span className="inline-flex items-center gap-1.5">{j.job_no}<PlateTag plate={j.vehicle?.plate} /></span>,
      sub: vehicleLabel(j.vehicle) || j.complaint || "", meta: <JobStatusPill status={j.status} className="px-1.5 text-[10px]" />,
      search: `${j.job_no} ${j.vehicle?.plate || ""} ${j.vehicle?.make || ""} ${j.vehicle?.model || ""} ${j.customer?.name || ""}`,
    }));
  }, [openJobs, data?.job]);
  const split = (body: React.ReactNode) => (
    <RecordSplit title="Open jobs" listTo={href("/garage/jobs")} rows={railRows} currentId={id} hrefOf={(x) => href(`/garage/jobs/${x}`)} loading={railLoading}
      newAction={<a href={href("/garage/jobs/new")} aria-label="Check in a car" title="Check in" className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Plus className="h-4 w-4" /></a>}>
      {body}
    </RecordSplit>
  );
  if (isLoading) return split(<PageLoader />);
  if (!data?.job) return split(<EmptyState icon={Wrench} title="Job not found" description="It may have been deleted." action={<a href={href("/garage/jobs")} className="text-sm font-medium text-primary">Back to job cards</a>} />);
  const { job, lines, events, media, inspections, logs } = data;
  const status = job.status as JobStatus;

  const patch = async (p: Record<string, unknown>, ok?: string) => {
    const { error } = await sb.from("garage_jobs").update(p).eq("id", job.id);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return false; }
    if (ok) toast({ title: ok });
    reload();
    return true;
  };
  const move = async (to: JobStatus) => {
    const problem = moveProblem(status, to, job);
    if (problem && to !== "ready" && to !== "collected") return toast({ title: "Not moved", description: problem, variant: "destructive" });
    // Ready goes through the quality check; quality check opens its checklist.
    if (to === "ready" || to === "quality_check") {
      if (to === "quality_check") await patch({ status: to });
      else toast({ title: "Finish the quality check", description: "Tick the list, then press “Passed: car ready” at the bottom." });
      setTab("qc");
      return;
    }
    if (to === "collected") { setTab("money"); return toast({ title: "Release the car at the gate", description: "The gate pass checks payment first." }); }
    await patch({ status: to }, `Moved to ${STATUS_LABEL[to]}`);
  };
  const addObd = async () => {
    const code = obd.trim().toUpperCase();
    if (!code) return;
    await patch({ obd_codes: [...(job.obd_codes || []), { code, at: new Date().toISOString() }] });
    setObd("");
  };
  const startInspection = async (tplId: string) => {
    const tpl = (templates as any[]).find((t) => t.id === tplId);
    if (!tpl) return;
    try {
      const row = must(await sb.from("garage_inspections").insert({
        tenant_id: tenantId, job_id: job.id, vehicle_id: job.vehicle_id, template_id: tpl.id, name: tpl.name, kind: tpl.kind, mileage: job.mileage_in,
        results: (tpl.items || []).map((i: any) => ({ section: i.section, label: i.label, status: null })),
      }).select("id").single()) as any;
      go(`/garage/inspections/${row.id}`);
    } catch (e: any) { toast({ title: "Not started", description: e.message, variant: "destructive" }); }
  };
  const saveTemplate = async () => {
    const name = window.prompt("Name this template", job.complaint?.slice(0, 40) || "Job template");
    if (!name) return;
    const r = await sb.from("garage_job_templates").insert({ tenant_id: tenantId, name, job_type: job.job_type, complaint: job.complaint,
      lines: lines.filter((l: any) => l.status !== "cancelled").map((l: any) => ({ kind: l.kind, description: l.description, qty: l.qty, rate: l.rate, tax_rate: l.tax_rate, item_id: l.item_id, pricing: l.pricing, hours: l.hours })) });
    toast({ title: r.error ? "Not saved" : "Template saved", description: r.error?.message, variant: r.error ? "destructive" : undefined });
  };
  const sendTrack = async () => {
    try { await wsApi("send-job", { job_id: job.id, kind: job.status === "ready" ? "ready" : "tag" }); toast({ title: "Tracking link sent" }); reload(); }
    catch (e: any) { toast({ title: "Not sent", description: e.message, variant: "destructive" }); }
  };

  const waitingMin = WAITING_STAGES.reduce((s, k) => s + (Number(stages[k]) || 0), 0);
  const next = primaryNext(status);
  // ONE next-step button that follows the status; every other move sits in More.
  const step: { label: string; icon: LucideIcon; run: () => void; tone?: "success" } | null =
    status === "booked" ? { label: "Check in", icon: ArrowRight, run: () => void move("checked_in") }
      : status === "checked_in" ? { label: "Inspect", icon: ClipboardCheck, run: () => { void move("diagnosing"); setTab("inspection"); } }
        : status === "diagnosing" ? { label: "Estimate", icon: ArrowRight, run: () => { void move("waiting_approval"); setTab("estimate"); } }
          : status === "waiting_approval" ? { label: "Approve & start", icon: ArrowRight, run: () => void move("in_progress") }
            : status === "waiting_parts" ? { label: "Start work", icon: ArrowRight, run: () => void move("in_progress") }
              : status === "in_progress" ? { label: "Quality check", icon: ClipboardCheck, run: () => void move("quality_check") }
                : status === "quality_check" ? { label: "Ready", icon: ClipboardCheck, run: () => { if (tab === "qc") window.dispatchEvent(new CustomEvent(QC_PASS_EVENT, { detail: data.job.id })); else setTab("qc"); } }
                  : status === "ready" ? { label: "Release car", icon: ArrowRight, tone: "success", run: () => void move("collected") }
                    : status === "cancelled" ? { label: "Reopen", icon: Undo2, run: () => void move("checked_in") }
                      : null;
  const stepTarget: JobStatus | null = status === "cancelled" ? "checked_in" : status === "checked_in" ? "diagnosing" : status === "diagnosing" ? "waiting_approval" : status === "waiting_approval" || status === "waiting_parts" ? "in_progress" : next;
  const moves: MenuAction[] = nextStatuses(status).filter((s) => s !== stepTarget && s !== "collected" && s !== "cancelled").map((s, i) => ({ label: STATUS_LABEL[s], icon: ChevronRight, onSelect: () => void move(s), group: i === 0 ? "Move to" : undefined }));
  const more: MenuAction[] = [
    ...moves,
    { label: "Send tracking link", icon: Send, onSelect: () => void sendTrack(), separator: moves.length > 0 },
    { label: "Print job card", icon: Printer, onSelect: () => printJob(data, mech.nameOf) },
    { label: "Open vehicle", icon: Car, href: href(`/garage/vehicles/${job.vehicle_id}`), hidden: !job.vehicle_id },
    { label: "Duplicate", icon: Copy, onSelect: () => go(`/garage/jobs/new?from=${job.id}`), separator: true },
    { label: "Save as template", icon: Save, onSelect: () => void saveTemplate() },
    { label: "Comeback", icon: Undo2, onSelect: () => go(`/garage/jobs/new?from=${job.id}&comeback=1`), hidden: status !== "collected" },
    { label: "Cancel job", icon: XCircle, danger: true, separator: true, onSelect: () => { if (window.confirm("Cancel this job?")) void move("cancelled"); }, hidden: !nextStatuses(status).includes("cancelled") },
  ];
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "work", label: "Work", count: lines.length }, { value: "estimate", label: "Estimate" }, { value: "parts", label: "Parts", count: data.parts.length },
    { value: "inspection", label: "Inspection", count: inspections.length }, { value: "checkin", label: "Check-in" }, { value: "photos", label: "Photos", count: media.length },
    { value: "qc", label: "Quality check" }, { value: "money", label: "Money" }, { value: "history", label: "History" },
  ];

  return split(
    <div className="space-y-3 pb-10">
      <PageHeader title={<span className="flex min-w-0 items-center gap-2"><span className="truncate">{job.job_no}</span> <PlateTag plate={job.vehicle?.plate} /> <JobStatusPill status={status} /></span>} icon={Wrench}
        actions={<>
          <MoreMenu items={more} />
          {step && <button type="button" onClick={step.run} className={cn(btnPrimaryCls, step.tone === "success" && "bg-success text-white hover:bg-success/90")}><step.icon className="h-4 w-4" />{step.label}</button>}
        </>}>
        <JobSteps status={status} />
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <Panel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Sub>Vehicle</Sub>
                <a href={href(`/garage/vehicles/${job.vehicle_id}`)} className="text-sm font-medium hover:underline">{vehicleLabel(job.vehicle) || "—"}</a>
                <p className="text-xs text-muted-foreground">{job.mileage_in ? `${Number(job.mileage_in).toLocaleString()} km in` : "Mileage not taken"}{job.fuel_level ? ` · fuel ${job.fuel_level}` : ""}</p>
              </div>
              <div>
                <Sub>Customer</Sub>
                {job.customer ? <a href={href(`/customers/${job.customer.id}`)} className="text-sm font-medium hover:underline">{job.customer.name}</a> : <span className="text-sm text-muted-foreground">No customer</span>}
                <p className="text-xs text-muted-foreground">{job.customer?.phone || ""}</p>
              </div>
              <div>
                <Sub>Time</Sub>
                <p className="text-xs">In {when(job.checked_in_at || job.created_at)} · {humanMinutes(Number(stages[status]) || 0)} in this stage</p>
                <p className="text-xs">Promised <input type="datetime-local" className="ml-1 rounded border border-border bg-transparent px-1 text-xs" defaultValue={job.promised_at ? new Date(Date.parse(job.promised_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onBlur={(e) => patch({ promised_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></p>
                {waitingMin > 0 && <p className="text-xs text-warning">Time lost waiting: {humanMinutes(waitingMin)}</p>}
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-muted/40 p-2 text-sm"><span className="text-xs font-semibold text-muted-foreground">Complaint: </span>{job.complaint || "—"}</div>
            {job.comeback_of && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Comeback of <a className="underline" href={href(`/garage/jobs/${job.comeback_of}`)}>the earlier job</a>{job.comeback_reason ? `: ${job.comeback_reason}` : ""}</p>}
          </Panel>

          <LineTabs value={tab} onChange={(v) => setTab(v)} options={tabs} />

          <Panel>
            {tab === "work" && (
              <div className="space-y-3">
                <JobLines data={data} onChange={reload} readOnly={status === "collected" || status === "cancelled"} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="text-xs font-semibold text-muted-foreground">Findings (diagnosis)</span>
                    <textarea className="fi" rows={3} value={notes.findings || ""} onChange={(e) => setNotes((n: any) => ({ ...n, findings: e.target.value }))} onBlur={() => notes.findings !== (job.findings || "") && patch({ findings: notes.findings || null })} placeholder="Enter what the mechanic found" /></label>
                  <label className="block"><span className="text-xs font-semibold text-muted-foreground">Note to the customer (shows on tracking and invoice)</span>
                    <textarea className="fi" rows={3} value={notes.customer_notes || ""} onChange={(e) => setNotes((n: any) => ({ ...n, customer_notes: e.target.value }))} onBlur={() => notes.customer_notes !== (job.customer_notes || "") && patch({ customer_notes: notes.customer_notes || null })} placeholder="Enter a note the customer can see" /></label>
                  <label className="block sm:col-span-2"><span className="text-xs font-semibold text-muted-foreground">Internal note (staff only)</span>
                    <textarea className="fi" rows={2} value={notes.internal_notes || ""} onChange={(e) => setNotes((n: any) => ({ ...n, internal_notes: e.target.value }))} onBlur={() => notes.internal_notes !== (job.internal_notes || "") && patch({ internal_notes: notes.internal_notes || null })} placeholder="Enter a note for the team" /></label>
                </div>
                <div>
                  <Sub>Fault codes (OBD)</Sub>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(job.obd_codes || []).map((c: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive">{c.code}
                        <button type="button" onClick={() => patch({ obd_codes: job.obd_codes.filter((_: any, j: number) => j !== i) })}>×</button></span>
                    ))}
                    <input className="fi h-8 w-32 py-0 font-mono uppercase" value={obd} onChange={(e) => setObd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addObd()} placeholder="Enter code" />
                    <button type="button" onClick={addObd} className="h-8 rounded-lg border border-border px-2 text-xs">Add</button>
                  </div>
                </div>
                {job.job_type === "warranty" && (
                  <div className="grid gap-2 rounded-xl border border-warning/40 p-2.5 sm:grid-cols-3">
                    <Sub>Warranty / comeback cost</Sub>
                    <input className="fi" inputMode="decimal" defaultValue={job.warranty_cost ?? ""} placeholder="Enter cost to the garage" onBlur={(e) => patch({ warranty_cost: e.target.value === "" ? null : Number(e.target.value) })} />
                    <select className="fi" defaultValue={job.warranty_mechanic_id || ""} onChange={(e) => patch({ warranty_mechanic_id: e.target.value || null })}><option value="">Mechanic responsible</option>{mech.list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                  </div>
                )}
              </div>
            )}
            {tab === "estimate" && <JobEstimate data={data} onChange={reload} />}
            {tab === "parts" && <JobParts data={data} onChange={reload} />}
            {tab === "inspection" && (
              <div className="space-y-2">
                {inspections.map((i: any) => {
                  const res = i.results || [];
                  const red = res.filter((r: any) => r.status === "red").length, amber = res.filter((r: any) => r.status === "amber").length;
                  return (
                    <a key={i.id} href={href(`/garage/inspections/${i.id}`)} className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-sm hover:bg-muted/40">
                      <ClipboardCheck className="h-4 w-4" /><span className="flex-1 font-medium">{i.inspection_no} · {i.name}</span>
                      <span className="text-xs text-destructive">{red} red</span><span className="text-xs text-warning">{amber} amber</span><span className="text-xs">{i.status === "done" ? "Done" : "Open"}</span><ChevronRight className="h-4 w-4" />
                    </a>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  {(templates as any[]).filter((t) => t.active && t.kind !== "quality_check").map((t) => <button key={t.id} type="button" onClick={() => startInspection(t.id)} className="inline-flex h-8 items-center gap-1 rounded-xl border border-border px-2.5 text-xs"><Plus className="h-3.5 w-3.5" />{t.name}</button>)}
                  {!(templates as any[]).length && <p className="text-sm text-muted-foreground">Add inspection checklists in <a className="text-primary underline" href={href("/garage/settings")}>Workshop settings</a>.</p>}
                </div>
              </div>
            )}
            {tab === "checkin" && (
              <div className="space-y-3">
                <CarDiagram marks={job.checkin?.damage || []} readOnly />
                <div><Sub>Items left in the car</Sub><p className="text-sm">{(job.checkin?.items_left || []).join(", ") || "None noted"}</p></div>
                <div><Sub>Signed</Sub>{job.checkin?.signature ? <><img src={job.checkin.signature} alt="Customer signature" className="h-20 rounded border border-border bg-white" /><p className="text-xs text-muted-foreground">{job.checkin.signed_name || ""} · {when(job.checkin.signed_at)}</p></> : <p className="text-sm text-muted-foreground">Not signed</p>}</div>
                <MediaStrip media={media.filter((m: any) => m.stage === "check_in")} meta={{ job_id: job.id, vehicle_id: job.vehicle_id, stage: "check_in" }} onChange={reload} />
              </div>
            )}
            {tab === "photos" && <MediaStrip media={media} meta={{ job_id: job.id, vehicle_id: job.vehicle_id, stage: "job" }} onChange={reload} />}
            {tab === "qc" && <JobQC data={data} onChange={reload} />}
            {tab === "money" && <JobMoney data={data} onChange={reload} />}
            {tab === "history" && (
              <div className="space-y-3">
                <ol className="space-y-1.5 border-l-2 border-border pl-3">
                  {events.map((e: any) => (
                    <li key={e.id} className="text-sm">
                      <span className="text-xs text-muted-foreground">{when(e.at)}</span>{" "}
                      {e.kind === "status" ? <>{e.from_status ? `${STATUS_LABEL[e.from_status as JobStatus] || e.from_status} → ` : ""}<b>{STATUS_LABEL[e.to_status as JobStatus] || e.to_status}</b>{e.minutes_in_stage ? <span className="text-xs text-muted-foreground"> (after {humanMinutes(e.minutes_in_stage)})</span> : null}</> : e.note}
                      {(e.by_name || e.by_user) && <span className="text-xs text-muted-foreground"> · {e.by_name || mech.nameOf(e.by_user)}</span>}
                    </li>
                  ))}
                </ol>
                {logs.length > 0 && (
                  <div><Sub>Clock on / off</Sub>
                    <ul className="text-xs">{logs.map((l: any) => <li key={l.id}><Timer className="mr-1 inline h-3 w-3" />{mech.nameOf(l.mechanic_id) || "Mechanic"} · {lines.find((x: any) => x.id === l.line_id)?.description || "Job"} · {when(l.started_at)} – {l.ended_at ? when(l.ended_at) : "now"}{l.minutes ? ` (${humanMinutes(l.minutes)})` : ""}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Workshop">
            <div className="space-y-2">
              <label className="block"><span className="text-xs text-muted-foreground">Job type</span><select className="fi" value={job.job_type} onChange={(e) => patch({ job_type: e.target.value })}>{JOB_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="block"><span className="text-xs text-muted-foreground">Bay</span><select className="fi" value={job.bay_id || ""} onChange={(e) => patch({ bay_id: e.target.value || null, bay: (bays as any[]).find((b) => b.id === e.target.value)?.name || null })}><option value="">No bay</option>{(bays as any[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <div><span className="text-xs text-muted-foreground">Mechanics</span><MechanicChips value={job.mechanic_ids || []} onChange={(v) => patch({ mechanic_ids: v })} list={mech.list} /></div>
            </div>
          </Panel>
          <Panel title="Money">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">All quoted</span><span className="tabular-nums">{money(job.estimate_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Approved</span><b className="tabular-nums">{money(job.approved_total)}</b></div>
              <button type="button" onClick={() => setTab("money")} className="text-xs font-medium text-primary">Invoices, M-Pesa and gate pass</button>
            </div>
          </Panel>
          {job.rating && <Panel title="Customer rating"><p className="text-sm">{"★".repeat(job.rating)}{"☆".repeat(5 - job.rating)}{job.mechanic_rating ? ` · mechanic ${job.mechanic_rating}/5` : ""}</p>{job.rating_comment && <p className="text-xs text-muted-foreground">"{job.rating_comment}"</p>}</Panel>}
        </div>
      </div>
    </div>
  );
}
