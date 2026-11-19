import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Camera, ChevronLeft, ChevronRight, Droplet, FileText, Paintbrush, Pencil, Plus, Receipt, Settings2, Wrench } from "lucide-react";
import { EmptyState, PageHeader, PageLoader, Panel } from "@/components/kit";
import DocumentsPanel from "@/components/DocumentsPanel";
import { fmtMoney } from "@/apps/format";
import { useTenantId } from "@/hooks/useTenantId";
import { BP_STAGES } from "../apps";
import { ensureVehicle, logEvent, moveStage, num, patchRec, sb, sendToWorkshop, useInvoices, useJobsFrom, useModuleSettings, useRec, useRecs, useRefresh } from "../shared/db";
import { createInvoice } from "../shared/billing";
import { downloadPdf, item, party } from "../shared/pdf";
import { btn, btnDark, btnPrimary, Gate, KV, Labeled, LinesTable, ModuleHome, NumIn, RecTable, StageBar, StageChip, useAction, type Col } from "../shared/ui";
import { mixCost, normalisePlate, panelTotals } from "../lib/calc";

export const PANELS = [
  "Front bumper", "Rear bumper", "Bonnet", "Boot lid / tailgate", "Roof", "Front left wing", "Front right wing", "Rear left quarter", "Rear right quarter",
  "Front left door", "Front right door", "Rear left door", "Rear right door", "Left sill", "Right sill", "Left mirror", "Right mirror", "Grille", "Whole car",
];
const OPS = ["Repair", "Replace", "Paint only", "Blend", "Polish", "Dent removal"];

interface BodySettings { labourRate: number; booths: string[]; consumablesPerPanel: number }
const DEFAULTS: BodySettings = { labourRate: 0, booths: ["Booth 1", "Booth 2"], consumablesPerPanel: 0 };
export const useBodySettings = () => useModuleSettings<BodySettings>("body_paint", DEFAULTS);

export function BodyHome() {
  const { data: jobs = [] } = useRecs("body_paint", "bp_job");
  const active = jobs.filter((j) => !["done", "booked"].includes(String(j.stage)));
  return (
    <ModuleHome module="body_paint" title="Body & paint" icon={Paintbrush}
      actions={<Link to="/apps/body_paint/bp_job?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> New body job</Link>}
      stats={[
        { label: "Booked", value: jobs.filter((j) => j.stage === "booked").length },
        { label: "In the shop", value: active.length, tone: "warning" },
        { label: "In the booth now", value: jobs.filter((j) => j.starts_at && j.ends_at && new Date(j.starts_at) <= new Date() && new Date(j.ends_at) >= new Date()).length, tone: "info" },
        { label: "Work value (open)", value: fmtMoney(jobs.filter((j) => j.stage !== "done").reduce((a, j) => a + num(j.amount), 0)) },
      ]}
      links={[
        { to: "/apps/body_paint/bp_job", label: "Jobs board", icon: Paintbrush, hint: "Strip → refit" },
        { to: "/garage/body-paint/booth", label: "Booth schedule", icon: CalendarDays },
        { to: "/garage/body-paint/settings", label: "Rates & booths", icon: Settings2 },
      ]}>
      <Panel title="Jobs in the shop" flush>
        <RecTable rows={jobs.filter((j) => j.stage !== "done")} to={(r) => `/garage/body-paint/jobs/${r.id}`} empty="No body jobs open."
          cols={[{ label: "Job", get: (r) => `${r.number || ""} ${r.data?.plate || r.title}` }, { label: "Booth", get: (r) => r.data?.booth || "—" }, { label: "Promised", get: (r) => (r.due_date ? String(r.due_date).slice(0, 10) : "—") }, { label: "Estimate", get: (r) => fmtMoney(num(r.amount)), num: true }, { label: "Stage", get: (r) => <StageChip stages={BP_STAGES} stage={r.stage} /> }]} />
      </Panel>
    </ModuleHome>
  );
}

export function BodyJob() {
  return <Gate module="body_paint"><Job /></Gate>;
}

const PANEL_COLS: Col[] = [
  { key: "panel", label: "Panel", type: "select", options: PANELS, width: "170px" },
  { key: "operation", label: "Work", type: "select", options: OPS, width: "130px" },
  { key: "labour_hours", label: "Labour hrs", type: "number", width: "90px" },
  { key: "paint_cost", label: "Paint & materials", type: "money", width: "120px" },
  { key: "parts_cost", label: "Parts", type: "money", width: "110px" },
  { key: "note", label: "Note", placeholder: "Enter damage note" },
];

function Job() {
  const { id = "" } = useParams();
  const tenantId = useTenantId();
  const { data: job, isLoading } = useRec(id);
  const { value: settings } = useBodySettings();
  const { data: jobs = [], refetch } = useJobsFrom("bp_job_id", id);
  const refresh = useRefresh();
  const { busy, run } = useAction();
  const [panels, setPanels] = useState<Record<string, any>[]>([]);
  const [mix, setMix] = useState<Record<string, any>[]>([]);
  const [consumables, setConsumables] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const { data: paints = [] } = useQuery({
    queryKey: ["sp-paint-items", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("products").select("id, name, cost_price, unit").eq("is_active", true).order("name").limit(3000)).data || []) as any[],
  });
  useEffect(() => {
    if (!job) return;
    setPanels(job.data?.panels || []); setMix(job.data?.mix || []); setConsumables(job.data?.consumables ?? null); setDirty(false);
  }, [job?.id, job?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const invQ = useInvoices([job?.data?.invoice_id]);
  const rate = num(job?.data?.labour_rate) || num(settings.labourRate);
  const pt = useMemo(() => panelTotals(panels.map((p) => ({ panel: p.panel, operation: p.operation, labour_hours: num(p.labour_hours), paint_cost: num(p.paint_cost), parts_cost: num(p.parts_cost) })), rate), [panels, rate]);
  const consum = consumables ?? panels.length * num(settings.consumablesPerPanel);
  const mixTotal = mixCost(mix.map((m) => ({ qty: num(m.qty), unit_cost: num(m.unit_cost) })), consum);

  if (isLoading) return <PageLoader />;
  if (!job || job.app !== "body_paint") return <EmptyState title="Body job not found" />;
  const total = pt.total;

  const save = () => run("save", async () => {
    await patchRec(job.id, { amount: total, data: { panels, mix: mix.map((m) => ({ ...m, qty: num(m.qty), unit_cost: num(m.unit_cost) })), consumables: consumables, paint_actual: mixTotal, labour_rate: rate } });
    setDirty(false); refresh("body_paint", job.id);
  }, "Saved");

  const toWorkshop = () => run("ws", async () => {
    const plate = normalisePlate(job.data?.plate || job.title);
    const vehicleId = job.data?.vehicle_id || await ensureVehicle(tenantId!, { plate, customer_id: job.customer_id });
    const j = await sendToWorkshop(tenantId!, { vehicle_id: vehicleId, customer_id: job.customer_id, job_type: "body_paint", complaint: `Body & paint: ${panels.map((p) => `${p.panel} (${p.operation})`).join(", ")}`, source: { module: "body_paint", bp_job_id: job.id, claim_id: job.data?.claim_id || null } });
    await patchRec(job.id, { data: { vehicle_id: vehicleId } });
    await logEvent(job.id, `Job card ${j.job_no || ""} opened in the workshop.`);
    void refetch();
  }, "Job card opened in the workshop");

  const invoice = () => run("inv", async () => {
    if (!job.customer_id) throw new Error("Set the customer first (Edit details)");
    if (job.data?.invoice_id) throw new Error("Already invoiced");
    const lines = [
      ...panels.filter((p) => num(p.labour_hours)).map((p) => ({ name: `${p.panel}: ${p.operation} (labour)`, quantity: num(p.labour_hours), rate })),
      ...panels.filter((p) => num(p.paint_cost)).map((p) => ({ name: `${p.panel}: paint & materials`, quantity: 1, rate: num(p.paint_cost) })),
      ...panels.filter((p) => num(p.parts_cost)).map((p) => ({ name: `${p.panel}: parts`, quantity: 1, rate: num(p.parts_cost) })),
    ];
    const inv = await createInvoice(tenantId!, { customerId: job.customer_id, lines, subject: `Body & paint ${job.number || ""} · ${job.data?.plate || job.title}`, reference: job.number, source: "garage_body_paint" });
    await patchRec(job.id, { data: { invoice_id: inv.id } });
    refresh("body_paint", job.id); void invQ.refetch();
  }, "Draft invoice created in Sales");

  const pdf = () => run("pdf", () => downloadPdf(tenantId!, {
    title: "Body & Paint Estimate", number: job.number, party: party("Customer", job.title, [job.data?.plate]),
    meta: [{ label: "Vehicle", value: job.data?.plate || job.title }, { label: "Colour code", value: job.data?.colour_code || "—" }],
    currency: "KES", items: panels.flatMap((p) => [
      ...(num(p.labour_hours) ? [item(`${p.panel}: ${p.operation}`, num(p.labour_hours), rate, "Labour (hours)")] : []),
      ...(num(p.paint_cost) ? [item(`${p.panel}: paint & materials`, 1, num(p.paint_cost))] : []),
      ...(num(p.parts_cost) ? [item(`${p.panel}: parts`, 1, num(p.parts_cost))] : []),
    ]),
    totals: { subtotal: total, tax: 0, total }, sections: [], signatures: ["Prepared by", "Customer's approval"],
  } as any, `${job.number || "body-job"}-estimate.pdf`));

  const inv = invQ.data?.get(job.data?.invoice_id);
  return (
    <div className="space-y-3">
      <PageHeader title={`${job.number || ""} ${job.data?.plate || job.title}`} icon={Paintbrush} actions={<>
        <Link to={`/apps/body_paint/bp_job?open=${job.id}`} className={btn}><Pencil className="h-4 w-4" /> Edit details</Link>
        <button className={btnPrimary} disabled={!dirty || !!busy} onClick={save}>Save</button>
      </>} />
      <StageBar stages={BP_STAGES} value={job.stage} onChange={(s) => void run("st", async () => { await moveStage(job, s.key, s.label); refresh("body_paint", job.id); })} />
      <Panel><KV items={[["Colour code", job.data?.colour_code], ["Booth", job.data?.booth], ["Booth time", job.starts_at ? `${new Date(job.starts_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}` : null], ["Promised", job.due_date ? String(job.due_date).slice(0, 10) : null], ["Labour rate", fmtMoney(rate)], ["Estimate", fmtMoney(total)], ["Paint cost (mix)", fmtMoney(mixTotal)], ["Invoice", inv ? <Link className="text-primary" to={`/sales/invoices/${inv.id}`}>{inv.invoice_number} · {inv.status}</Link> : "—"]]} /></Panel>
      <Panel title="Panel-by-panel estimate" icon={Paintbrush} actions={<div className="flex gap-2"><button className={btn} disabled={!!busy} onClick={pdf}><FileText className="h-4 w-4" /> PDF</button><button className={btn} disabled={!!busy} onClick={invoice}><Receipt className="h-4 w-4" /> Invoice</button></div>}>
        <LinesTable cols={PANEL_COLS} rows={panels} onChange={(r) => { setPanels(r); setDirty(true); }} newRow={{ operation: "Repair" }} addLabel="Add panel"
          footer={<p className="text-sm tabular-nums">{pt.hours} h × {fmtMoney(rate)} = {fmtMoney(pt.labour)} · paint {fmtMoney(pt.paint)} · parts {fmtMoney(pt.parts)} · <b>{fmtMoney(pt.total)}</b></p>} />
      </Panel>
      <Panel title="Paint mixing & materials (actual cost)" icon={Droplet} description="Toner, clear, hardener, thinner, filler and primer used, from the stock items' cost. Compare with what the estimate charged.">
        <LinesTable cols={[{ key: "name", label: "Material", placeholder: "Enter material or choose below" }, { key: "qty", label: "Qty (g / ml / unit)", type: "number", width: "120px" }, { key: "unit_cost", label: "Cost per unit", type: "money", width: "120px" }]}
          rows={mix} onChange={(r) => { setMix(r); setDirty(true); }} addLabel="Add material"
          footer={<p className="text-sm tabular-nums">Materials {fmtMoney(mixTotal)} · charged {fmtMoney(pt.paint)} · <b className={pt.paint - mixTotal < 0 ? "text-destructive" : "text-success"}>{fmtMoney(pt.paint - mixTotal)}</b></p>} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Labeled label="Add from stock items">
            <select className="fi" value="" onChange={(e) => { const p = paints.find((x) => x.id === e.target.value); if (p) { setMix([...mix, { name: p.name, product_id: p.id, qty: "", unit_cost: num(p.cost_price) }]); setDirty(true); } }}>
              <option value="">Choose an item…</option>{paints.map((p) => <option key={p.id} value={p.id}>{p.name}{p.cost_price ? ` · ${fmtMoney(num(p.cost_price))}/${p.unit || "unit"}` : ""}</option>)}
            </select>
          </Labeled>
          <Labeled label="Consumables (masking, sandpaper…)"><NumIn value={consumables ?? panels.length * num(settings.consumablesPerPanel)} onChange={(v) => { setConsumables(v); setDirty(true); }} /></Labeled>
        </div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Workshop" icon={Wrench} actions={<button className={btnDark} disabled={!!busy} onClick={toWorkshop}>Open job card</button>}>
          <ul className="divide-y divide-border text-sm">{jobs.map((j) => <li key={j.id} className="flex justify-between py-1.5"><span>{j.job_no || "Job card"}</span><span className="text-xs text-muted-foreground">{j.status}</span></li>)}{!jobs.length && <li className="py-2 text-xs text-muted-foreground">No job card yet.</li>}</ul>
        </Panel>
        <Panel title="Before & after photos" icon={Camera}>
          <DocumentsPanel entityType="garage_body_job" entityId={job.id} entityName={`${job.number || ""} ${job.title}`} checklist={["Before photos", "After photos", "Colour match card"]} />
        </Panel>
      </div>
    </div>
  );
}

/** Week view of the paint booths. */
export function BoothBoard() {
  return <Gate module="body_paint"><Booths /></Gate>;
}

function Booths() {
  const { data: jobs = [] } = useRecs("body_paint", "bp_job");
  const { value: settings } = useBodySettings();
  const [start, setStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const booths = Array.from(new Set([...(settings.booths || []), ...jobs.map((j) => j.data?.booth).filter(Boolean)])) as string[];
  const on = (j: any, d: Date) => {
    if (!j.starts_at) return false;
    const a = new Date(j.starts_at), b = new Date(j.ends_at || j.starts_at);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    return a < e && b >= d;
  };
  return (
    <div className="space-y-3">
      <PageHeader title="Booth schedule" icon={CalendarDays} actions={<>
        <button className={btn} onClick={() => { const d = new Date(start); d.setDate(d.getDate() - 7); setStart(d); }} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
        <button className={btn} onClick={() => { const d = new Date(start); d.setDate(d.getDate() + 7); setStart(d); }} aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        <Link to="/apps/body_paint/bp_job?new=1" className={btnPrimary}><Plus className="h-4 w-4" /> Book</Link>
      </>} />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-border bg-muted/40"><th className="w-28 px-2 py-2 text-left">Booth</th>{days.map((d) => <th key={d.toISOString()} className="px-2 py-2 text-left font-semibold">{d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}</th>)}</tr></thead>
          <tbody>
            {booths.map((b) => (
              <tr key={b} className="border-b border-border align-top">
                <td className="px-2 py-2 font-semibold">{b}</td>
                {days.map((d) => (
                  <td key={d.toISOString()} className="px-1 py-1">
                    {jobs.filter((j) => j.data?.booth === b && on(j, d)).map((j) => (
                      <Link key={j.id} to={`/garage/body-paint/jobs/${j.id}`} className="mb-1 block truncate rounded-md bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary">
                        {j.data?.plate || j.title} <span className="text-muted-foreground">{BP_STAGES.find((s) => s.key === j.stage)?.label}</span>
                      </Link>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
            {!booths.length && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Add booths in Rates & booths.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Set the booth and the booth from / until times on each job to place it here.</p>
    </div>
  );
}

export function BodySettingsPage() {
  return <Gate module="body_paint"><BodySettingsInner /></Gate>;
}

function BodySettingsInner() {
  const s = useBodySettings();
  const [v, setV] = useState<BodySettings | null>(null);
  const cur = v || s.value;
  const { busy, run } = useAction();
  return (
    <div className="space-y-3">
      <PageHeader title="Body & paint settings" icon={Settings2} actions={<button className={btnPrimary} disabled={!v || !!busy} onClick={() => void run("s", async () => { await s.save(cur); setV(null); }, "Saved")}>Save</button>} />
      <Panel>
        <div className="grid gap-2 sm:grid-cols-3">
          <Labeled label="Body shop labour rate per hour"><NumIn value={cur.labourRate} onChange={(x) => setV({ ...cur, labourRate: x ?? 0 })} /></Labeled>
          <Labeled label="Consumables per panel"><NumIn value={cur.consumablesPerPanel} onChange={(x) => setV({ ...cur, consumablesPerPanel: x ?? 0 })} /></Labeled>
          <Labeled label="Booths (comma separated)"><input className="fi" placeholder="Enter booth names" value={(cur.booths || []).join(", ")} onChange={(e) => setV({ ...cur, booths: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Labeled>
        </div>
      </Panel>
    </div>
  );
}
