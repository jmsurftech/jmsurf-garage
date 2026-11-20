import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardCheck, Plus, FileText, Printer, Loader2, Camera } from "lucide-react";
import { PageHeader, Panel, TableWrap, EmptyState, PageLoader, Modal, Field, Toolbar, SearchBox, MoreMenu, btnPrimaryCls } from "@/components/kit";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must } from "../lib/api";
import { useInspectionTemplates, useRefresh } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { linesFromInspection, ragCounts, type CheckResult, type Rag } from "../lib/checklists";
import { MediaStrip, PlateTag, RagPicker, VehiclePicker, vehicleLabel, when } from "../components/bits";

const KIND_LABEL: Record<string, string> = { multi_point: "Multi-point", pre_purchase: "Pre-purchase", ntsa: "NTSA prep", quality_check: "Quality check", other: "Other" };

export function InspectionList() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { go } = useWorkshopLinks();
  const [q, setQ] = useState("");
  const [start, setStart] = useState(false);
  const [vehicle, setVehicle] = useState<any>(null);
  const [tpl, setTpl] = useState("");
  const { data: templates = [] } = useInspectionTemplates();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["gw-inspections", tenantId], enabled: !!tenantId,
    queryFn: async () => must(await sb.from("garage_inspections").select("*, vehicle:garage_vehicles(plate,make,model), job:garage_jobs(job_no)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500)) as any[],
  });
  const shown = useMemo(() => { const s = q.trim().toLowerCase().replace(/\s/g, ""); return (rows as any[]).filter((r) => !s || `${r.inspection_no}${r.name}${r.vehicle?.plate}${r.job?.job_no}`.toLowerCase().replace(/\s/g, "").includes(s)); }, [rows, q]);
  const create = async () => {
    const t = (templates as any[]).find((x) => x.id === tpl);
    if (!vehicle || !t) return toast({ title: "Choose the vehicle and the checklist", variant: "destructive" });
    try {
      const r = must(await sb.from("garage_inspections").insert({ tenant_id: tenantId, vehicle_id: vehicle.id, template_id: t.id, name: t.name, kind: t.kind, mileage: vehicle.mileage, results: (t.items || []).map((i: any) => ({ ...i, status: null })) }).select("id").single()) as any;
      go(`/garage/inspections/${r.id}`);
    } catch (e: any) { toast({ title: "Not started", description: e.message, variant: "destructive" }); }
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Inspections" icon={ClipboardCheck} actions={<button type="button" onClick={() => setStart(true)} className={btnPrimaryCls}><Plus className="h-4 w-4" />New inspection</button>} />
      <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Search plate, job or number…" /></Toolbar>
      <Panel flush>
        {isLoading ? <PageLoader /> : !shown.length ? <EmptyState icon={ClipboardCheck} title="No inspections yet" description="Start one on a job card, or here for a pre-purchase check." action={<button type="button" onClick={() => setStart(true)} className={btnPrimaryCls}><Plus className="h-4 w-4" />New inspection</button>} /> : (
          <TableWrap><table className="dt">
            <thead><tr><th>Number</th><th>Vehicle</th><th>Checklist</th><th>Job</th><th>Result</th><th>Date</th></tr></thead>
            <tbody>{shown.map((r) => { const c = ragCounts(r.results || []); return (
              <tr key={r.id} className="cursor-pointer" onClick={() => go(`/garage/inspections/${r.id}`)}>
                <td className="font-medium">{r.inspection_no}</td><td><PlateTag plate={r.vehicle?.plate} /> <span className="text-xs text-muted-foreground">{vehicleLabel(r.vehicle)}</span></td>
                <td>{r.name}<p className="text-xs text-muted-foreground">{KIND_LABEL[r.kind] || ""}</p></td><td>{r.job?.job_no || "—"}</td>
                <td className="whitespace-nowrap text-xs"><span className="text-success">{c.green}</span> · <span className="text-warning">{c.amber}</span> · <span className="text-destructive">{c.red}</span>{c.open ? <span className="text-muted-foreground"> · {c.open} open</span> : null}</td>
                <td>{when(r.created_at, false)}</td>
              </tr>); })}</tbody>
          </table></TableWrap>
        )}
      </Panel>
      <Modal open={start} onClose={() => setStart(false)} title="New inspection" icon={ClipboardCheck} footer={<button type="button" onClick={create} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Start</button>}>
        <div className="space-y-3">
          <Field label="Vehicle"><VehiclePicker value={vehicle} onChange={setVehicle} /></Field>
          <Field label="Checklist"><select className="fi" value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">Choose a checklist</option>{(templates as any[]).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          {!(templates as any[]).length && <p className="text-xs text-muted-foreground">Add checklists in Workshop settings (ready-made ones are there to start from).</p>}
        </div>
      </Modal>
    </div>
  );
}

/** One inspection: green / amber / red per item with notes and photos, then an estimate from it. */
export function InspectionForm() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { go, href } = useWorkshopLinks();
  const refresh = useRefresh();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gw-inspection", id], enabled: !!id,
    queryFn: async () => {
      const i = must(await sb.from("garage_inspections").select("*, vehicle:garage_vehicles(id,plate,make,model,year,mileage), job:garage_jobs(id,job_no,status)").eq("id", id).maybeSingle()) as any;
      const media = i ? must(await sb.from("garage_job_media").select("*").eq("inspection_id", id).order("created_at")) as any[] : [];
      return i ? { ...i, media } : null;
    },
  });
  const [results, setResults] = useState<CheckResult[]>([]);
  const [summary, setSummary] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoFor, setPhotoFor] = useState<number | null>(null);
  useEffect(() => { if (data) { setResults(data.results || []); setSummary(data.summary || ""); setDirty(false); } }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save a moment after each change (mechanics work on the phone; nothing should be lost).
  useEffect(() => {
    if (!dirty || !data) return;
    const t = setTimeout(async () => { await sb.from("garage_inspections").update({ results, summary: summary || null }).eq("id", data.id); setDirty(false); }, 800);
    return () => clearTimeout(t);
  }, [results, summary, dirty, data]);

  if (isLoading) return <PageLoader />;
  if (!data) return <EmptyState icon={ClipboardCheck} title="Inspection not found" />;
  const c = ragCounts(results);
  const sections = [...new Set(results.map((r) => r.section))];
  const setItem = (i: number, p: Partial<CheckResult>) => { setResults((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true); };

  const finish = async () => {
    setBusy(true);
    const { error } = await sb.from("garage_inspections").update({ results, summary: summary || null, status: "done" }).eq("id", data.id);
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Inspection done" }); void refetch(); refresh();
  };
  const toEstimate = async () => {
    if (!data.job) return toast({ title: "This inspection has no job", description: "Open a job card for the car first, or start the inspection from the job.", variant: "destructive" });
    const ls = linesFromInspection(results);
    if (!ls.length) return toast({ title: "Nothing red or amber to quote" });
    setBusy(true);
    try {
      const { count } = await sb.from("garage_job_lines").select("id", { count: "exact", head: true }).eq("job_id", data.job.id);
      must(await sb.from("garage_job_lines").insert(ls.map((l, i) => ({ tenant_id: tenantId, job_id: data.job.id, kind: l.kind, description: l.description, priority: l.priority, qty: 1, rate: 0, sort: (count || 0) + i, approved: null }))));
      await sb.from("garage_inspections").update({ results, status: "done" }).eq("id", data.id);
      toast({ title: `${ls.length} line(s) added to the job`, description: "Put the prices in, then send the estimate." });
      go(`/garage/jobs/${data.job.id}`);
    } catch (e: any) { toast({ title: "Not added", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 pb-10">
      <PageHeader title={`${data.inspection_no} · ${data.name || "Inspection"}`} icon={ClipboardCheck} actions={<>
        <MoreMenu items={[
          { label: "Estimate from red and amber", icon: FileText, hidden: !data.job, disabled: busy, onSelect: () => void toEstimate() },
          { label: "Print", icon: Printer, onSelect: () => window.print() },
        ]} />
        <button type="button" disabled={busy} onClick={finish} className={btnPrimaryCls}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Finish</button>
      </>}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <PlateTag plate={data.vehicle?.plate} /><span>{vehicleLabel(data.vehicle)}</span>
          {data.job && <a className="text-primary hover:underline" href={href(`/garage/jobs/${data.job.id}`)}>{data.job.job_no}</a>}
          <span className="text-success">{c.green} OK</span><span className="text-warning">{c.amber} soon</span><span className="text-destructive">{c.red} now</span>{c.open > 0 && <span className="text-muted-foreground">{c.open} to check</span>}
          {data.status === "done" && <span className="rounded-full bg-success/10 px-2 text-xs font-semibold text-success">Done {when(data.done_at)}</span>}
          {dirty && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
      </PageHeader>
      {sections.map((s) => (
        <Panel key={s} title={s} flush>
          <div className="divide-y divide-border">
            {results.map((r, i) => r.section !== s ? null : (
              <div key={i} className={cn("px-3 py-2", r.status === "red" && "bg-destructive/5", r.status === "amber" && "bg-warning/5")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm">{r.label}</span>
                  <button type="button" onClick={() => setPhotoFor(photoFor === i ? null : i)} className="rounded-lg border border-border p-1" aria-label="Photos"><Camera className="h-3.5 w-3.5" /></button>
                  <RagPicker value={r.status} onChange={(v: Rag | null) => setItem(i, { status: v })} />
                </div>
                {(r.status === "red" || r.status === "amber" || r.note) && <input className="fi mt-1.5 h-8 py-0 text-xs" value={r.note || ""} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="Enter what you found (shows on the estimate)" />}
                {photoFor === i && <div className="mt-2"><MediaStrip compact media={(data.media || []).filter((m: any) => m.caption === r.label)} meta={{ job_id: data.job?.id || null, vehicle_id: data.vehicle?.id, inspection_id: data.id, stage: "inspection", caption: r.label }} onChange={() => refetch()} allowVoice={false} /><p className="mt-1 text-[10px] text-muted-foreground">Photos are added to the job and shown to the customer with the estimate.</p></div>}
              </div>
            ))}
          </div>
        </Panel>
      ))}
      <Panel title="Summary"><textarea className="fi" rows={3} value={summary} onChange={(e) => { setSummary(e.target.value); setDirty(true); }} placeholder="Enter the overall result and advice" /></Panel>
    </div>
  );
}
