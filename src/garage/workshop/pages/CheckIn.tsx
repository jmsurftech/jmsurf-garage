import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardPlus, Loader2, Camera, X, History, Fuel } from "lucide-react";
import { PageHeader, Panel, Field } from "@/components/kit";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { SignaturePad } from "@/apps/fields";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb, must, uploadMedia, shrinkPhoto, wsApi } from "../lib/api";
import { useBays, useGarageSettings, useJobTemplates, useMechanics, useRefresh } from "../lib/data";
import { FUEL_LEVELS, JOB_TYPES, STATUS_LABEL } from "../lib/status";
import { useWorkshopLinks } from "../lib/nav";
import { CarDiagram, MechanicChips, VehiclePicker, JobStatusPill, type DamageMark, when, money } from "../components/bits";

const LEFT_ITEMS = ["Spare wheel", "Jack and tools", "Radio / screen", "Documents", "Phone charger", "Floor mats", "Child seat", "Umbrella", "Fire extinguisher", "Triangles"];
const PHOTO_SIDES = ["Front", "Rear", "Left", "Right", "Dashboard (mileage)", "Interior"];

/** Reception: plate search with full history, mileage, fuel, complaint, photos all round, damage, items left, signature. */
export default function CheckIn() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { go } = useWorkshopLinks();
  const [params] = useSearchParams();
  const refresh = useRefresh();
  const { data: settings } = useGarageSettings();
  const { data: bays = [] } = useBays();
  const { data: templates = [] } = useJobTemplates();
  const mech = useMechanics();

  const [vehicle, setVehicle] = useState<any | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [f, setF] = useState<any>({ job_type: "mechanical", mileage_in: "", fuel_level: "1/2", complaint: "", promised_at: "", bay_id: "", mechanic_ids: [] as string[], template_id: "", comeback_of: "", comeback_reason: "", internal_notes: "", items_other: "" });
  const [marks, setMarks] = useState<DamageMark[]>([]);
  const [left, setLeft] = useState<string[]>([]);
  const [photos, setPhotos] = useState<{ file: File; label: string }[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState({ reminders: true, offers: false });
  const [sendTag, setSendTag] = useState(true);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState<any | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoLabel = useRef("Photo");
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  // From a booking (?booking=) or a past job to repeat (?from=).
  useEffect(() => {
    const bid = params.get("booking");
    if (!bid || !tenantId) return;
    void sb.from("garage_bookings").select("*").eq("id", bid).maybeSingle().then(async ({ data: b }: any) => {
      if (!b) return;
      setBooking(b);
      setF((x: any) => ({ ...x, complaint: [b.service, b.notes].filter(Boolean).join(". "), bay_id: b.bay_id || "", mechanic_ids: b.mechanic_id ? [b.mechanic_id] : [] }));
      if (b.vehicle_id) { const { data: v } = await sb.from("garage_vehicles").select("*, customer:customers(id,name,phone)").eq("id", b.vehicle_id).maybeSingle(); if (v) setVehicle(v); }
      if (b.customer_id) { const { data: c } = await sb.from("customers").select("id,name,phone,email").eq("id", b.customer_id).maybeSingle(); if (c) setCustomer(c); }
    });
  }, [params, tenantId]);

  useEffect(() => {
    const from = params.get("from");
    if (!from) return;
    void sb.from("garage_jobs").select("*, vehicle:garage_vehicles(*, customer:customers(id,name,phone))").eq("id", from).maybeSingle().then(({ data: j }: any) => {
      if (!j) return;
      if (j.vehicle) setVehicle(j.vehicle);
      setF((x: any) => ({ ...x, job_type: params.get("comeback") ? "warranty" : j.job_type, complaint: j.complaint || "", comeback_of: params.get("comeback") ? j.id : "" }));
    });
  }, [params]);

  // Owner and full history when a vehicle is picked.
  useEffect(() => {
    if (!vehicle) { setHistory([]); return; }
    if (vehicle.customer && !customer) setCustomer({ id: vehicle.customer.id, name: vehicle.customer.name, phone: vehicle.customer.phone });
    if (vehicle.mileage && !f.mileage_in) set("mileage_in", String(vehicle.mileage));
    void sb.from("garage_jobs").select("id,job_no,status,job_type,complaint,findings,approved_total,created_at,mileage_in").eq("vehicle_id", vehicle.id).order("created_at", { ascending: false }).limit(20)
      .then(({ data }: any) => setHistory(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  useEffect(() => {
    if (!customer?.id) return;
    void sb.from("customers").select("garage_reminders_ok,garage_offers_ok").eq("id", customer.id).maybeSingle().then(({ data }: any) => {
      if (data) setConsent({ reminders: data.garage_reminders_ok !== false, offers: !!data.garage_offers_ok });
    });
  }, [customer?.id]);

  const openJob = history.find((j) => !["collected", "cancelled"].includes(j.status));
  const lowerMileage = vehicle?.mileage && Number(f.mileage_in) > 0 && Number(f.mileage_in) < Number(vehicle.mileage);
  const terms = settings?.checkin_terms || "I leave this vehicle for inspection and the work I approve. I have noted its condition and the items left in it. The garage is not responsible for items not listed here. Work beyond the approved amount needs my approval.";
  const tpl = useMemo(() => (templates as any[]).find((t) => t.id === f.template_id), [templates, f.template_id]);

  const save = async () => {
    if (!tenantId) return;
    if (!vehicle) return toast({ title: "Search for the number plate first", variant: "destructive" });
    if (!f.complaint.trim()) return toast({ title: "Write the customer's complaint in their words", variant: "destructive" });
    setSaving(true);
    try {
      if (customer && vehicle.customer_id !== customer.id) await sb.from("garage_vehicles").update({ customer_id: customer.id }).eq("id", vehicle.id);
      if (customer) await sb.from("customers").update({ garage_reminders_ok: consent.reminders, garage_offers_ok: consent.offers }).eq("id", customer.id);
      const bay = (bays as any[]).find((b) => b.id === f.bay_id);
      const job = must(await sb.from("garage_jobs").insert({
        tenant_id: tenantId, vehicle_id: vehicle.id, customer_id: customer?.id || null, booking_id: booking?.id || null, status: "checked_in",
        job_type: f.comeback_of ? "warranty" : f.job_type, mileage_in: Number(f.mileage_in) || null, fuel_level: f.fuel_level, complaint: f.complaint.trim(),
        promised_at: f.promised_at ? new Date(f.promised_at).toISOString() : null, bay_id: f.bay_id || null, bay: bay?.name || null,
        mechanic_ids: f.mechanic_ids, internal_notes: f.internal_notes || null, comeback_of: f.comeback_of || null, comeback_reason: f.comeback_reason || null,
        location_id: settings?.default_location_id || null,
        checkin: { damage: marks, items_left: [...left, ...(f.items_other ? [f.items_other] : [])], signature, terms_accepted: !!signature, terms, signed_at: signature ? new Date().toISOString() : null, signed_name: customer?.name || null },
      }).select("*").single()) as any;
      if (tpl?.lines?.length) {
        must(await sb.from("garage_job_lines").insert(tpl.lines.map((l: any, i: number) => ({
          tenant_id: tenantId, job_id: job.id, kind: l.kind || "labour", description: l.description || "", qty: Number(l.qty) || 1, rate: Number(l.rate) || 0,
          tax_rate: Number(l.tax_rate) || 0, item_id: l.item_id || null, pricing: l.pricing || "fixed", hours: l.hours ?? null, sort: i,
        }))));
      }
      if (booking) await sb.from("garage_bookings").update({ status: "arrived", job_id: job.id, vehicle_id: vehicle.id, customer_id: customer?.id || booking.customer_id }).eq("id", booking.id);
      for (const p of photos) await uploadMedia(tenantId, await shrinkPhoto(p.file), { job_id: job.id, vehicle_id: vehicle.id, stage: "check_in", caption: p.label, customer_visible: true }).catch(() => null);
      if (sendTag && customer?.phone) wsApi("send-job", { job_id: job.id, kind: "tag" }).catch((e) => toast({ title: "Job tag not sent", description: e.message, variant: "destructive" }));
      refresh();
      toast({ title: `${job.job_no} opened` });
      go(`/garage/jobs/${job.id}`, { replace: true });
    } catch (e: any) {
      toast({ title: "Job card not saved", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3 pb-24">
      <PageHeader title="Check in a vehicle" icon={ClipboardPlus} actions={
        <button type="button" disabled={saving} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Open job card
        </button>} />

      {booking && <div className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-sm">From booking <b>{booking.booking_no}</b> · {when(booking.starts_at)} · {booking.name || ""}</div>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Vehicle and customer">
          <div className="space-y-3">
            <VehiclePicker value={vehicle} onChange={setVehicle} customerId={customer?.id} />
            {openJob && <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-xs text-[hsl(32_90%_38%)]">This car already has an open job ({openJob.job_no}, {STATUS_LABEL[openJob.status as keyof typeof STATUS_LABEL]}). <button type="button" className="font-semibold underline" onClick={() => go(`/garage/jobs/${openJob.id}`)}>Open it</button></p>}
            <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
            {customer && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={consent.reminders} onChange={(e) => setConsent((c) => ({ ...c, reminders: e.target.checked }))} /> Service and expiry reminders by SMS</label>
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={consent.offers} onChange={(e) => setConsent((c) => ({ ...c, offers: e.target.checked }))} /> Offers and "we miss you" messages</label>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="History" icon={History}>
          {!vehicle ? <p className="text-sm text-muted-foreground">Search the plate to see every past job on this car.</p>
            : !history.length ? <p className="text-sm text-muted-foreground">First visit for this car.</p> : (
              <div className="max-h-64 divide-y divide-border overflow-y-auto">
                {history.map((j) => (
                  <div key={j.id} className="flex items-start gap-2 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{j.job_no} · {j.complaint || "—"}</p>
                      <p className="text-xs text-muted-foreground">{when(j.created_at, false)}{j.mileage_in ? ` · ${Number(j.mileage_in).toLocaleString()} km` : ""} · {money(j.approved_total)}</p>
                    </div>
                    <JobStatusPill status={j.status} />
                    {j.status === "collected" && <button type="button" className="text-[11px] font-medium text-primary" onClick={() => { set("comeback_of", j.id); set("job_type", "warranty"); }}>Comeback</button>}
                  </div>
                ))}
              </div>
            )}
        </Panel>
      </div>

      <Panel title="The job">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Job type"><select className="fi" value={f.job_type} onChange={(e) => set("job_type", e.target.value)}>{JOB_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Mileage in (km)" error={lowerMileage ? `Lower than the last reading (${Number(vehicle.mileage).toLocaleString()} km)` : undefined}>
            <input className="fi" inputMode="numeric" value={f.mileage_in} onChange={(e) => set("mileage_in", e.target.value.replace(/\D/g, ""))} placeholder="Enter mileage" />
          </Field>
          <Field label="Promised for"><input type="datetime-local" className="fi" value={f.promised_at} onChange={(e) => set("promised_at", e.target.value)} /></Field>
          <Field label="Bay"><select className="fi" value={f.bay_id} onChange={(e) => set("bay_id", e.target.value)}><option value="">Not yet</option>{(bays as any[]).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        </div>
        <div className="mt-3">
          <span className="mb-1 flex items-center gap-1 text-sm font-medium"><Fuel className="h-4 w-4" /> Fuel level</span>
          <div className="flex flex-wrap gap-1.5">
            {FUEL_LEVELS.map((l) => <button key={l} type="button" onClick={() => set("fuel_level", l)} className={cn("h-8 rounded-xl border px-3 text-sm", f.fuel_level === l ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{l}</button>)}
          </div>
        </div>
        <Field label="Complaint (in the customer's words)" className="mt-3" required>
          <textarea className="fi" rows={3} value={f.complaint} onChange={(e) => set("complaint", e.target.value)} placeholder="Enter what the customer says is wrong" />
        </Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Start from a template"><select className="fi" value={f.template_id} onChange={(e) => set("template_id", e.target.value)}><option value="">No template</option>{(templates as any[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Internal note (staff only)"><input className="fi" value={f.internal_notes} onChange={(e) => set("internal_notes", e.target.value)} placeholder="Enter a note for the team" /></Field>
        </div>
        {f.comeback_of && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/5 p-2.5">
            <p className="text-sm font-medium">Comeback of {history.find((j) => j.id === f.comeback_of)?.job_no || "an earlier job"} <button type="button" className="ml-2 text-xs text-muted-foreground underline" onClick={() => set("comeback_of", "")}>Remove</button></p>
            <input className="fi mt-1.5" value={f.comeback_reason} onChange={(e) => set("comeback_reason", e.target.value)} placeholder="Enter what came back (e.g. same noise after repair)" />
          </div>
        )}
        <div className="mt-3"><span className="mb-1 block text-sm font-medium">Mechanics</span><MechanicChips value={f.mechanic_ids} onChange={(v) => set("mechanic_ids", v)} list={mech.list} /></div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Photos all round" icon={Camera}>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setPhotos((p) => [...p, { file, label: photoLabel.current }]);
            e.target.value = "";
          }} />
          <div className="grid grid-cols-3 gap-2">
            {PHOTO_SIDES.map((side) => {
              const p = photos.find((x) => x.label === side);
              return (
                <button key={side} type="button" onClick={() => { photoLabel.current = side; photoInput.current?.click(); }}
                  className={cn("relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-xl border text-xs", p ? "border-success" : "border-dashed border-border text-muted-foreground")}>
                  {p ? <img src={URL.createObjectURL(p.file)} alt={side} className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="mb-1 h-5 w-5" />}
                  <span className="relative z-10 rounded bg-black/50 px-1 text-[10px] text-white">{side}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="text-xs font-medium text-primary" onClick={() => { photoLabel.current = "Extra"; photoInput.current?.click(); }}>+ Another photo</button>
            {photos.filter((p) => !PHOTO_SIDES.includes(p.label)).map((p, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 text-[11px]">Extra {i + 1}<button type="button" onClick={() => setPhotos((x) => x.filter((y) => y !== p))}><X className="h-3 w-3" /></button></span>)}
          </div>
        </Panel>

        <Panel title="Damage on arrival">
          <CarDiagram marks={marks} onChange={setMarks} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Items left in the car">
          <div className="flex flex-wrap gap-1.5">
            {LEFT_ITEMS.map((it) => {
              const on = left.includes(it);
              return <button key={it} type="button" onClick={() => setLeft(on ? left.filter((x) => x !== it) : [...left, it])} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground")}>{it}</button>;
            })}
          </div>
          <input className="fi mt-2" value={f.items_other} onChange={(e) => set("items_other", e.target.value)} placeholder="Enter anything else left in the car" />
        </Panel>

        <Panel title="Customer accepts">
          <p className="mb-2 whitespace-pre-line rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">{terms}</p>
          <SignaturePad value={signature} onChange={setSignature} />
          <label className="mt-2 inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={sendTag} onChange={(e) => setSendTag(e.target.checked)} /> Send the job tag by SMS with the tracking link</label>
        </Panel>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur sm:hidden">
        <button type="button" disabled={saving} onClick={save} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Open job card
        </button>
      </div>
    </div>
  );
}
