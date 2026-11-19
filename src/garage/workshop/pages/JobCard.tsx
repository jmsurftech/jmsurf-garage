import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Wrench, ChevronRight, Copy, Printer, Send, Save, AlertTriangle, ClipboardCheck, Plus, Timer, Undo2 } from "lucide-react";
import { PageHeader, Panel, PageLoader, EmptyState, Segmented } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must, wsApi } from "../lib/api";
import { useBays, useJob, useMechanics, useRefresh, useInspectionTemplates, useLiveWorkshop } from "../lib/data";
import { STATUS_LABEL, nextStatuses, moveProblem, stageMinutes, humanMinutes, primaryNext, JOB_TYPES, WAITING_STAGES, type JobStatus } from "../lib/status";
import { jobTotals, lineGross } from "../lib/totals";
import { useWorkshopLinks } from "../lib/nav";
import { CarDiagram, JobStatusPill, MechanicChips, MediaStrip, PlateTag, Sub, money, vehicleLabel, when } from "../components/bits";
import JobLines from "../components/JobLines";
import JobEstimate from "../components/JobEstimate";
import JobParts from "../components/JobParts";
import JobMoney from "../components/JobMoney";
import JobQC from "../components/JobQC";

type Tab = "work" | "estimate" | "parts" | "inspection" | "checkin" | "photos" | "qc" | "money" | "history";

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
  const [tab, setTab] = useState<Tab>("work");
  const [notes, setNotes] = useState<any>({});
  const [obd, setObd] = useState("");
  const reload = () => { void refetch(); refresh(); };

  useEffect(() => {
    if (data?.job) setNotes({ findings: data.job.findings || "", customer_notes: data.job.customer_notes || "", internal_notes: data.job.internal_notes || "" });
  }, [data?.job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stages = useMemo(() => (data?.job ? stageMinutes(data.job) : {}), [data?.job]);
  if (isLoading) return <PageLoader />;
  if (!data?.job) return <EmptyState icon={Wrench} title="Job not found" description="It may have been deleted." />;
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
    if (to === "ready" || to === "quality_check") { if (to === "quality_check") await patch({ status: to }); setTab("qc"); return; }
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
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "work", label: "Work", count: lines.length }, { value: "estimate", label: "Estimate" }, { value: "parts", label: "Parts", count: data.parts.length },
    { value: "inspection", label: "Inspection", count: inspections.length }, { value: "checkin", label: "Check-in" }, { value: "photos", label: "Photos", count: media.length },
    { value: "qc", label: "Quality check" }, { value: "money", label: "Money" }, { value: "history", label: "History" },
  ];

  return (
    <div className="space-y-3 pb-10">
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{job.job_no} <PlateTag plate={job.vehicle?.plate} /> <JobStatusPill status={status} /></span>} icon={Wrench}
        actions={<>
          <button type="button" onClick={sendTrack} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Send className="h-4 w-4" />Send tracking link</button>
          <button type="button" onClick={() => printJob(data, mech.nameOf)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Printer className="h-4 w-4" />Print</button>
          <button type="button" onClick={() => go(`/garage/jobs/new?from=${job.id}`)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Copy className="h-4 w-4" />Duplicate</button>
          <button type="button" onClick={saveTemplate} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm"><Save className="h-4 w-4" />Save as template</button>
          {status === "collected" && <button type="button" onClick={() => go(`/garage/jobs/new?from=${job.id}&comeback=1`)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-warning/50 px-3 text-sm"><Undo2 className="h-4 w-4" />Comeback</button>}
        </>} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
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

          <div className="overflow-x-auto"><Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={tabs} /></div>

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
                    <input className="fi h-8 w-32 py-0 font-mono uppercase" value={obd} onChange={(e) => setObd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addObd()} placeholder="e.g. P0301" />
                    <button type="button" onClick={addObd} className="h-8 rounded-lg border border-border px-2 text-xs">Add</button>
                  </div>
                </div>
                {job.job_type === "warranty" && (
                  <div className="grid gap-2 rounded-xl border border-warning/40 p-2.5 sm:grid-cols-3">
                    <Sub>Warranty / comeback cost</Sub>
                    <input className="fi" inputMode="decimal" defaultValue={job.warranty_cost ?? ""} placeholder="Cost to the garage" onBlur={(e) => patch({ warranty_cost: e.target.value === "" ? null : Number(e.target.value) })} />
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
          <Panel title="Move job">
            <div className="flex flex-wrap gap-1.5">
              {next && next !== "collected" && <button type="button" onClick={() => move(next)} className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground">{STATUS_LABEL[next]} <ChevronRight className="h-4 w-4" /></button>}
              {next === "collected" && <button type="button" onClick={() => setTab("money")} className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-success px-3 text-sm font-semibold text-white">Gate pass and collection</button>}
              {nextStatuses(status).filter((s) => s !== next && s !== "collected").map((s) => (
                <button key={s} type="button" onClick={() => move(s)} className={cn("h-8 rounded-lg border px-2 text-xs", s === "cancelled" ? "border-destructive/40 text-destructive" : "border-border")}>{STATUS_LABEL[s]}</button>
              ))}
            </div>
          </Panel>
          <Panel title="Workshop">
            <div className="space-y-2">
              <label className="block"><span className="text-xs text-muted-foreground">Job type</span><select className="fi" value={job.job_type} onChange={(e) => patch({ job_type: e.target.value })}>{JOB_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="block"><span className="text-xs text-muted-foreground">Bay</span><select className="fi" value={job.bay_id || ""} onChange={(e) => patch({ bay_id: e.target.value || null, bay: (bays as any[]).find((b) => b.id === e.target.value)?.name || null })}><option value="">No bay</option>{(bays as any[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <div><span className="text-xs text-muted-foreground">Mechanics</span><MechanicChips value={job.mechanic_ids || []} onChange={(v) => patch({ mechanic_ids: v })} list={mech.list} /></div>
            </div>
          </Panel>
          <Panel title="Money">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">All work</span><span className="tabular-nums">{money(job.estimate_total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Approved</span><b className="tabular-nums">{money(job.approved_total)}</b></div>
              <button type="button" onClick={() => setTab("money")} className="text-xs font-medium text-primary">Invoices, M-Pesa and gate pass →</button>
            </div>
          </Panel>
          {job.rating && <Panel title="Customer rating"><p className="text-sm">{"★".repeat(job.rating)}{"☆".repeat(5 - job.rating)}{job.mechanic_rating ? ` · mechanic ${job.mechanic_rating}/5` : ""}</p>{job.rating_comment && <p className="text-xs text-muted-foreground">"{job.rating_comment}"</p>}</Panel>}
        </div>
      </div>
    </div>
  );
}
