import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Play, Square, Package, Wrench, Truck, Droplet, Check, X, Clock, Lightbulb } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProducts } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must } from "../lib/api";
import { useGarageSettings, useMechanics, useServiceMenus } from "../lib/data";
import { jobTotals, lineGross, type LineKind } from "../lib/totals";
import { MechanicChips, MediaStrip, money, Sub } from "./bits";
import { humanMinutes } from "../lib/status";

const KIND: Record<LineKind, { label: string; icon: any }> = {
  labour: { label: "Labour", icon: Wrench }, part: { label: "Part", icon: Package }, sublet: { label: "Sublet", icon: Truck }, consumable: { label: "Consumable", icon: Droplet },
};

/** Product search for part / consumable lines (items with stock). */
function ProductSearch({ onPick }: { onPick: (p: any) => void }) {
  const { data: products = [] } = useProducts();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 1) return [];
    return (products as any[]).filter((p) => `${p.name} ${p.sku || ""} ${p.barcode || ""} ${p.brand || ""}`.toLowerCase().includes(s)).slice(0, 12);
  }, [q, products]);
  return (
    <div className="relative">
      <input className="fi" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts by name, part number or barcode" />
      {list.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
          {list.map((p) => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
              <span className="flex-1 truncate">{p.name}{p.sku ? <span className="ml-1 text-xs text-muted-foreground">{p.sku}</span> : null}</span>
              <span className={cn("text-xs", Number(p.stock) > 0 ? "text-success" : "text-destructive")}>{Number(p.stock || 0)} in stock</span>
              <span className="w-20 text-right text-xs font-semibold">{money(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddLine({ job, onDone, extra }: { job: any; onDone: () => void; extra: boolean }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: settings } = useGarageSettings();
  const { data: menus = [] } = useServiceMenus();
  const [kind, setKind] = useState<LineKind>("labour");
  const [f, setF] = useState<any>({ description: "", pricing: "fixed", qty: "1", rate: "", hours: "", tax_rate: "0", item_id: null, priority: "must", supplier: "" });
  const [guide, setGuide] = useState<any | null>(null);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const fits = (m: any) => (!m.make || String(job.vehicle?.make || "").toLowerCase() === String(m.make).toLowerCase()) && (!m.model || String(job.vehicle?.model || "").toLowerCase() === String(m.model).toLowerCase());
  const menuList = (menus as any[]).filter(fits);

  // Labour time guide from this garage's own history.
  useEffect(() => {
    const s = f.description.trim();
    if (kind !== "labour" || s.length < 4) { setGuide(null); return; }
    const t = setTimeout(async () => {
      const { data } = await sb.rpc("garage_time_guide", { p_make: job.vehicle?.make || null, p_model: job.vehicle?.model || null, p_q: s });
      setGuide((data || [])[0] || null);
    }, 400);
    return () => clearTimeout(t);
  }, [f.description, kind, job.vehicle?.make, job.vehicle?.model]);

  const insert = async (rows: any[]) => {
    const { count } = await sb.from("garage_job_lines").select("id", { count: "exact", head: true }).eq("job_id", job.id);
    must(await sb.from("garage_job_lines").insert(rows.map((r, i) => ({
      tenant_id: tenantId, job_id: job.id, is_extra: extra, approved: null, sort: (count || 0) + i,
      // A job opened by another module (insurance, fleet) can say who pays by default.
      payer: ["customer", "insurer", "fleet"].includes(job.payer_split?.default_payer) ? job.payer_split.default_payer : "customer", ...r,
    }))));
    onDone();
    setF({ description: "", pricing: "fixed", qty: "1", rate: "", hours: "", tax_rate: f.tax_rate, item_id: null, priority: "must", supplier: "" });
  };

  const addMenu = async (m: any) => {
    try {
      await insert([
        { kind: "labour", pricing: "menu", service_menu_id: m.id, description: m.name, qty: 1, rate: Number(m.labour_price) || 0, hours: m.labour_hours, tax_rate: Number(f.tax_rate) || 0 },
        ...(Array.isArray(m.parts) ? m.parts : []).map((p: any) => ({ kind: "part", item_id: p.item_id || null, description: p.name || "Part", qty: Number(p.qty) || 1, rate: Number(p.rate) || 0, tax_rate: Number(p.tax_rate ?? f.tax_rate) || 0 })),
      ]);
    } catch (e: any) { toast({ title: "Not added", description: e.message, variant: "destructive" }); }
  };

  const add = async () => {
    if (!f.description.trim()) return toast({ title: "Enter what the line is for", variant: "destructive" });
    const hourly = kind === "labour" && f.pricing === "hourly";
    const hours = Number(f.hours) || 0;
    const rate = Number(f.rate) || (hourly ? Number(settings?.labour_rate) || 0 : 0);
    try {
      await insert([{
        kind, description: f.description.trim(), pricing: kind === "labour" ? f.pricing : "fixed", item_id: f.item_id,
        qty: hourly ? hours || 1 : Number(f.qty) || 1, hours: kind === "labour" ? (hourly ? hours || 1 : hours || null) : null,
        rate, tax_rate: Number(f.tax_rate) || 0, priority: f.priority, note: kind === "sublet" && f.supplier ? `Sublet to ${f.supplier}` : null,
      }]);
    } catch (e: any) { toast({ title: "Not added", description: e.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-2.5">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(KIND) as LineKind[]).map((k) => {
          const I = KIND[k].icon;
          return <button key={k} type="button" onClick={() => setKind(k)} className={cn("inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium", kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border")}><I className="h-3.5 w-3.5" />{KIND[k].label}</button>;
        })}
        {extra && <span className="self-center rounded-full bg-warning/15 px-2 text-[11px] font-semibold text-[hsl(32_90%_38%)]">Extra work: needs the customer's approval</span>}
      </div>
      {kind === "labour" && menuList.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-muted-foreground">Service menu:</span>
          {menuList.slice(0, 10).map((m) => <button key={m.id} type="button" onClick={() => addMenu(m)} className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs hover:border-primary">{m.name} · {money(Number(m.labour_price) + (m.parts || []).reduce((s: number, p: any) => s + Number(p.rate || 0) * Number(p.qty || 1), 0))}</button>)}
        </div>
      )}
      {(kind === "part" || kind === "consumable") && <ProductSearch onPick={(p) => setF((x: any) => ({ ...x, item_id: p.id, description: p.name, rate: String(p.price ?? ""), tax_rate: String(p.vat_rate ?? x.tax_rate) }))} />}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
        <input className="fi col-span-2 sm:col-span-3 2xl:col-span-2" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder={kind === "labour" ? "Enter the work" : kind === "sublet" ? "Enter the outside work" : "Enter the part"} />
        {kind === "labour" ? (
          <select className="fi" value={f.pricing} onChange={(e) => set("pricing", e.target.value)}><option value="fixed">Fixed price</option><option value="hourly">Per hour</option></select>
        ) : <input className="fi" inputMode="decimal" value={f.qty} onChange={(e) => set("qty", e.target.value)} placeholder="Qty" />}
        {kind === "labour" && <input className="fi" inputMode="decimal" value={f.hours} onChange={(e) => set("hours", e.target.value)} placeholder={f.pricing === "hourly" ? "Hours" : "Hours (for reports)"} />}
        <input className="fi" inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder={kind === "labour" && f.pricing === "hourly" ? `Rate per hour${settings?.labour_rate ? ` (${settings.labour_rate})` : ""}` : "Price"} />
        <select className="fi" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)}><option value="0">No VAT</option><option value="16">VAT 16%</option><option value="8">8%</option></select>
        {kind === "sublet" && <input className="fi col-span-2" value={f.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder="Enter who does it" />}
        <select className="fi" value={f.priority} onChange={(e) => set("priority", e.target.value)}><option value="must">Must do</option><option value="advised">Advised</option><option value="optional">Optional</option></select>
        <button type="button" onClick={add} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Add</button>
      </div>
      {guide && <p className="flex items-center gap-1 text-xs text-info"><Lightbulb className="h-3.5 w-3.5" /> Your past {guide.jobs} job(s) like this on {[guide.make, guide.model].filter(Boolean).join(" ") || "this car"}: about {guide.avg_hours} h, average {money(guide.avg_price)}.</p>}
    </div>
  );
}

/** Job lines: labour, parts, sublet and consumables with approval, payer, mechanics and clock on / off. */
export default function JobLines({ data, onChange, readOnly }: { data: any; onChange: () => void; readOnly?: boolean }) {
  const { user } = useAuth() as any;
  const tenantId = useTenantId();
  const { toast } = useToast();
  const mech = useMechanics();
  const { job, lines, logs, media } = data;
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const anyApproved = lines.some((l: any) => l.approved === true);
  const totals = jobTotals(lines);
  const approved = jobTotals(lines, { onlyApproved: true });

  const patch = async (id: string, p: Record<string, unknown>) => {
    const { error } = await sb.from("garage_job_lines").update(p).eq("id", id);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    onChange();
  };
  const del = async (l: any) => {
    if (l.invoice_id) return toast({ title: "This line is on an invoice", description: "Change it on the invoice instead.", variant: "destructive" });
    if (Number(l.issued_qty) > 0) return toast({ title: "Parts were issued for this line", description: "Return them to the store first (Parts tab).", variant: "destructive" });
    await sb.from("garage_job_lines").delete().eq("id", l.id);
    onChange();
  };
  const openLog = (lineId: string) => logs.find((x: any) => x.line_id === lineId && x.mechanic_id === user?.id && !x.ended_at);
  const clock = async (l: any) => {
    const o = openLog(l.id);
    if (o) {
      await sb.from("garage_time_logs").update({ ended_at: new Date().toISOString() }).eq("id", o.id);
    } else {
      const r = await sb.from("garage_time_logs").insert({ tenant_id: tenantId, job_id: job.id, line_id: l.id, mechanic_id: user?.id });
      if (r.error) return toast({ title: "Not clocked on", description: r.error.message, variant: "destructive" });
      const p: any = { status: "in_progress" };
      if (user?.id && !l.mechanic_ids?.includes(user.id)) p.mechanic_ids = [...(l.mechanic_ids || []), user.id];
      await sb.from("garage_job_lines").update(p).eq("id", l.id);
    }
    onChange();
  };
  const clocked = (lineId: string) => logs.filter((x: any) => x.line_id === lineId).reduce((s: number, x: any) => s + (x.ended_at ? Number(x.minutes || 0) : (now - Date.parse(x.started_at)) / 60000), 0);
  const approve = (l: any, yes: boolean, via: string) => patch(l.id, { approved: yes, approved_at: new Date().toISOString(), approved_via: via });

  return (
    <div className="space-y-2">
      {!lines.length && <p className="py-4 text-center text-sm text-muted-foreground">No work on this job yet. Add labour, parts, sublet work or consumables.</p>}
      <div className="divide-y divide-border rounded-xl border border-border">
        {lines.map((l: any) => {
          const K = KIND[l.kind as LineKind] || KIND.labour;
          const mins = clocked(l.id);
          const mine = openLog(l.id);
          return (
            <div key={l.id} className={cn("p-2.5", l.status === "cancelled" && "opacity-50")}>
              <div className="flex items-start gap-2">
                <span className="g-tile xs mt-0.5 shrink-0"><K.icon className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setOpen(open === l.id ? null : l.id)} className="block w-full text-left">
                    <p className={cn("text-sm font-medium", l.status === "done" && "line-through decoration-success")}>{l.description || K.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {K.label}{l.pricing === "hourly" ? ` · ${l.qty} h × ${money(l.rate)}` : ` · ${l.qty} × ${money(l.rate)}`}{Number(l.discount) ? ` · −${l.discount}%` : ""}{Number(l.tax_rate) ? ` · VAT ${l.tax_rate}%` : ""}
                      {l.priority !== "must" ? ` · ${l.priority}` : ""}{l.payer !== "customer" ? ` · ${l.payer} pays` : ""}
                      {l.mechanic_ids?.length ? ` · ${l.mechanic_ids.map(mech.nameOf).filter(Boolean).join(", ")}` : ""}
                      {mins > 0 ? ` · clocked ${humanMinutes(mins)}` : ""}{l.kind === "part" && Number(l.issued_qty) > 0 ? ` · issued ${l.issued_qty}` : ""}
                      {l.invoice_id ? " · invoiced" : ""}{l.is_extra ? " · extra" : ""}
                    </p>
                  </button>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{money(lineGross(l))}</span>
                  {l.approved === true ? <span className="text-[10px] font-semibold text-success">Approved{l.approved_via ? ` (${l.approved_via})` : ""}</span>
                    : l.approved === false ? <span className="text-[10px] font-semibold text-destructive">Declined</span>
                      : <span className="text-[10px] font-semibold text-warning">Not approved yet</span>}
                </div>
              </div>
              {!readOnly && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
                  {l.kind === "labour" && l.approved !== false && l.status !== "done" && (
                    <button type="button" onClick={() => clock(l)} className={cn("inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold", mine ? "border-destructive bg-destructive text-white" : "border-border")}>
                      {mine ? <><Square className="h-3 w-3" />Clock off</> : <><Play className="h-3 w-3" />Clock on</>}
                    </button>
                  )}
                  {l.status !== "done" && l.approved !== false && <button type="button" onClick={() => patch(l.id, { status: "done" })} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px]"><Check className="h-3 w-3" />Done</button>}
                  {l.status === "done" && <button type="button" onClick={() => patch(l.id, { status: "pending" })} className="h-7 rounded-lg border border-border px-2 text-[11px]">Not done</button>}
                  {l.approved !== true && <button type="button" onClick={() => approve(l, true, "in person")} className="h-7 rounded-lg border border-success/40 px-2 text-[11px] text-success">Approved in person</button>}
                  {l.approved !== true && <button type="button" onClick={() => approve(l, true, "phone")} className="h-7 rounded-lg border border-success/40 px-2 text-[11px] text-success">By phone</button>}
                  {l.approved !== false && !l.invoice_id && <button type="button" onClick={() => approve(l, false, "staff")} className="h-7 rounded-lg border border-border px-2 text-[11px] text-muted-foreground">Declined</button>}
                </div>
              )}
              {open === l.id && !readOnly && (
                <div className="mt-2 space-y-2 rounded-lg bg-muted/30 p-2 pl-9">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
                    <input className="fi col-span-2 sm:col-span-3 2xl:col-span-2" defaultValue={l.description} onBlur={(e) => e.target.value !== l.description && patch(l.id, { description: e.target.value })} disabled={!!l.invoice_id} />
                    <input className="fi" inputMode="decimal" defaultValue={l.qty} onBlur={(e) => Number(e.target.value) !== Number(l.qty) && patch(l.id, { qty: Number(e.target.value) || 0 })} disabled={!!l.invoice_id} title="Quantity / hours" />
                    <input className="fi" inputMode="decimal" defaultValue={l.rate} onBlur={(e) => Number(e.target.value) !== Number(l.rate) && patch(l.id, { rate: Number(e.target.value) || 0 })} disabled={!!l.invoice_id} title="Price" />
                    <input className="fi" inputMode="decimal" defaultValue={l.discount} onBlur={(e) => Number(e.target.value) !== Number(l.discount) && patch(l.id, { discount: Number(e.target.value) || 0 })} disabled={!!l.invoice_id} placeholder="Discount %" title="Discount %" />
                    <select className="fi" value={l.payer} onChange={(e) => patch(l.id, { payer: e.target.value })} disabled={!!l.invoice_id}><option value="customer">Customer pays</option><option value="insurer">Insurer pays</option><option value="fleet">Fleet pays</option></select>
                  </div>
                  {l.kind === "labour" && <div><Sub>Mechanics on this line</Sub><MechanicChips value={l.mechanic_ids || []} onChange={(v) => patch(l.id, { mechanic_ids: v })} list={mech.list} /></div>}
                  {l.kind === "part" && <div className="grid grid-cols-2 gap-2"><input className="fi" inputMode="decimal" defaultValue={l.cost ?? ""} placeholder="Cost price (for warranty and margin)" onBlur={(e) => patch(l.id, { cost: e.target.value === "" ? null : Number(e.target.value) })} /></div>}
                  <input className="fi" defaultValue={l.note || ""} placeholder="Note on this line (staff)" onBlur={(e) => e.target.value !== (l.note || "") && patch(l.id, { note: e.target.value || null })} />
                  <MediaStrip compact media={media.filter((m: any) => m.line_id === l.id)} meta={{ job_id: job.id, line_id: l.id, vehicle_id: job.vehicle_id, stage: "job" }} onChange={onChange} />
                  <div className="flex gap-2">
                    {l.status !== "cancelled" ? <button type="button" onClick={() => patch(l.id, { status: "cancelled" })} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><X className="h-3 w-3" />Cancel line</button>
                      : <button type="button" onClick={() => patch(l.id, { status: "pending" })} className="text-xs text-primary">Restore line</button>}
                    <button type="button" onClick={() => del(l)} className="ml-auto inline-flex items-center gap-1 text-xs text-destructive"><Trash2 className="h-3 w-3" />Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {lines.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-sm">
          <span className="text-muted-foreground">Labour {money(totals.labour)} · Parts {money(totals.parts)} · Other {money(totals.other)}</span>
          <span>All quoted <b className="tabular-nums">{money(totals.total)}</b></span>
          <span className="text-success">Approved <b className="tabular-nums">{money(approved.total)}</b></span>
        </div>
      )}
      {!readOnly && <AddLine job={job} onDone={onChange} extra={anyApproved && ["in_progress", "waiting_parts", "quality_check", "waiting_approval"].includes(job.status)} />}
      {!readOnly && <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Tap a line to change it, add mechanics, photos or a voice note.</p>}
    </div>
  );
}
