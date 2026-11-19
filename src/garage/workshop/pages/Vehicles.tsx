import { useState } from "react";
import { useParams } from "react-router-dom";
import { Car, Plus, Gauge, History, ShieldAlert, Users } from "lucide-react";
import { PageHeader, Panel, Toolbar, SearchBox, TableWrap, EmptyState, PageLoader, Modal, Field } from "@/components/kit";
import { CustomerPicker } from "@/components/books/CustomerPicker";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { sb } from "../lib/api";
import { useVehicle, useVehicles, useRefresh } from "../lib/data";
import { useWorkshopLinks } from "../lib/nav";
import { VEHICLE_TYPES } from "../lib/status";
import { JobStatusPill, MediaStrip, PlateTag, Sub, VehicleQuickForm, money, vehicleLabel, when } from "../components/bits";

const soon = (d?: string | null) => d && Date.parse(d) < Date.now() + 30 * 86_400_000;
const past = (d?: string | null) => d && Date.parse(d) < Date.now();

function DateChip({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px]", past(value) ? "bg-destructive/10 text-destructive" : soon(value) ? "bg-warning/15 text-[hsl(32_90%_38%)]" : "bg-muted text-muted-foreground")}>{label} {when(value, false)}</span>;
}

export function VehicleList() {
  const { go } = useWorkshopLinks();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const { data: rows = [], isLoading, refetch } = useVehicles(q);
  return (
    <div className="space-y-3">
      <PageHeader title="Vehicles" icon={Car} actions={<button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Add vehicle</button>} />
      <Toolbar><SearchBox value={q} onChange={setQ} placeholder="Search plate, make, model or chassis…" /></Toolbar>
      {adding && <VehicleQuickForm onCancel={() => setAdding(false)} onSaved={(v) => { setAdding(false); void refetch(); go(`/garage/vehicles/${v.id}`); }} />}
      <Panel flush>
        {isLoading ? <PageLoader /> : !(rows as any[]).length ? <EmptyState icon={Car} title="No vehicles yet" description="Vehicles are saved when you check them in, or add one here." /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Plate</th><th>Vehicle</th><th>Owner</th><th className="num">Mileage</th><th>Next service</th><th>Due dates</th></tr></thead>
              <tbody>
                {(rows as any[]).map((v) => (
                  <tr key={v.id} className="cursor-pointer" onClick={() => go(`/garage/vehicles/${v.id}`)}>
                    <td><PlateTag plate={v.plate} /></td>
                    <td>{vehicleLabel(v) || "—"}<p className="text-xs text-muted-foreground">{VEHICLE_TYPES.find((t) => t[0] === v.vehicle_type)?.[1]}</p></td>
                    <td>{v.customer?.name || "—"}<p className="text-xs text-muted-foreground">{v.customer?.phone || ""}</p></td>
                    <td className="num">{v.mileage ? Number(v.mileage).toLocaleString() : "—"}</td>
                    <td>{v.next_service_date ? when(v.next_service_date, false) : "—"}{v.next_service_km ? <p className="text-xs text-muted-foreground">or {Number(v.next_service_km).toLocaleString()} km</p> : null}</td>
                    <td className="space-x-1"><DateChip label="Insurance" value={v.insurance_expiry} /><DateChip label="Inspection" value={v.inspection_expiry} /></td>
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

function EditVehicle({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<any>({ ...v });
  const set = (k: string, val: any) => setF((x: any) => ({ ...x, [k]: val }));
  const save = async () => {
    const cols = ["plate", "make", "model", "year", "engine", "transmission", "fuel", "colour", "vin", "engine_no", "vehicle_type", "mileage", "insurance_expiry", "inspection_expiry", "speed_governor_expiry", "psv_expiry", "next_service_date", "next_service_km", "notes"];
    const row: any = {};
    for (const c of cols) row[c] = f[c] === "" ? null : f[c];
    for (const c of ["year", "mileage", "next_service_km"]) row[c] = row[c] === null ? null : Number(row[c]) || null;
    const { error } = await sb.from("garage_vehicles").update(row).eq("id", v.id);
    if (error) return toast({ title: "Not saved", description: /unique|duplicate/i.test(error.message) ? "Another vehicle already has this plate." : error.message, variant: "destructive" });
    toast({ title: "Vehicle saved" }); onSaved(); onClose();
  };
  const txt = (k: string, label: string, ph: string, extra = "") => <Field label={label}><input className={cn("fi", extra)} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={ph} /></Field>;
  const date = (k: string, label: string) => <Field label={label}><input type="date" className="fi" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>;
  return (
    <Modal open onClose={onClose} title="Edit vehicle" icon={Car} size="lg" footer={<><button type="button" onClick={onClose} className="h-9 rounded-xl border border-border px-3 text-sm">Cancel</button><button type="button" onClick={save} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        {txt("plate", "Number plate", "Enter number plate", "font-mono uppercase")}
        <Field label="Type"><select className="fi" value={f.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)}>{VEHICLE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {txt("make", "Make", "Enter make")}{txt("model", "Model", "Enter model")}{txt("year", "Year", "Enter year")}{txt("engine", "Engine", "e.g. 1.5L petrol")}
        {txt("transmission", "Gearbox", "Manual or automatic")}{txt("fuel", "Fuel", "Petrol, diesel, hybrid, electric")}{txt("colour", "Colour", "Enter colour")}{txt("mileage", "Mileage (km)", "Enter mileage")}
        {txt("vin", "Chassis / VIN", "Enter chassis number", "font-mono uppercase")}{txt("engine_no", "Engine number", "Enter engine number", "font-mono uppercase")}
        {date("insurance_expiry", "Insurance expires")}{date("inspection_expiry", "Inspection expires")}{date("speed_governor_expiry", "Speed governor expires")}{date("psv_expiry", "PSV licence expires")}
        {date("next_service_date", "Next service date")}{txt("next_service_km", "Next service at (km)", "Enter km")}
        <Field label="Notes" className="col-span-2"><textarea className="fi" rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Enter notes about this vehicle" /></Field>
      </div>
    </Modal>
  );
}

export function VehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { go, href } = useWorkshopLinks();
  const refresh = useRefresh();
  const { data, isLoading, refetch } = useVehicle(id);
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(false);
  const [newOwner, setNewOwner] = useState<any>(null);
  const [km, setKm] = useState("");
  if (isLoading) return <PageLoader />;
  if (!data?.vehicle) return <EmptyState icon={Car} title="Vehicle not found" />;
  const { vehicle: v, owners, miles, jobs, media } = data;
  const reload = () => { void refetch(); refresh(); };
  const spent = jobs.reduce((s: number, j: any) => s + Number(j.approved_total || 0), 0);

  const changeOwner = async () => {
    if (!newOwner) return;
    const { error } = await sb.from("garage_vehicles").update({ customer_id: newOwner.id }).eq("id", v.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    setOwner(false); setNewOwner(null); toast({ title: "Owner changed. The old owner stays in the history." }); reload();
  };
  const addKm = async () => {
    const n = Number(km);
    if (!n) return;
    await sb.from("garage_mileage_log").insert({ tenant_id: tenantId, vehicle_id: v.id, mileage: n, source: "manual" });
    if (!v.mileage || n > Number(v.mileage)) await sb.from("garage_vehicles").update({ mileage: n }).eq("id", v.id);
    setKm(""); reload();
  };

  return (
    <div className="space-y-3">
      <PageHeader title={<span className="flex items-center gap-2"><PlateTag plate={v.plate} big /> {vehicleLabel(v)}</span>} icon={Car} actions={<>
        <button type="button" onClick={() => setEditing(true)} className="h-9 rounded-xl border border-border px-3 text-sm">Edit</button>
        <button type="button" onClick={() => go(`/garage/jobs/new`)} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Check in</button>
      </>} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Details">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {[["Type", VEHICLE_TYPES.find((t) => t[0] === v.vehicle_type)?.[1]], ["Engine", v.engine], ["Gearbox", v.transmission], ["Fuel", v.fuel], ["Colour", v.colour], ["Chassis", v.vin], ["Engine no.", v.engine_no], ["Mileage", v.mileage ? `${Number(v.mileage).toLocaleString()} km` : null]].map(([k, val]) => (
              <div key={k as string} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-medium">{val || "—"}</dd></div>
            ))}
          </dl>
          {v.notes && <p className="mt-2 text-xs text-muted-foreground">{v.notes}</p>}
        </Panel>
        <Panel title="Owner" icon={Users} actions={<button type="button" onClick={() => setOwner(!owner)} className="text-xs font-medium text-primary">Change owner</button>}>
          {v.customer ? <a href={href(`/customers/${v.customer.id}`)} className="text-sm font-medium hover:underline">{v.customer.name}</a> : <p className="text-sm text-muted-foreground">No owner saved</p>}
          <p className="text-xs text-muted-foreground">{v.customer?.phone || ""}</p>
          {v.customer && <p className="mt-1 text-[11px] text-muted-foreground">Reminders {v.customer.garage_reminders_ok === false ? "off" : "on"} · offers {v.customer.garage_offers_ok ? "on" : "off"}</p>}
          {owner && <div className="mt-2 space-y-2"><CustomerPicker value={newOwner} onChange={setNewOwner} /><button type="button" onClick={changeOwner} className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">Save new owner</button></div>}
          {owners.length > 1 && (<><Sub>Earlier owners</Sub><ul className="text-xs">{owners.slice(1).map((o: any) => <li key={o.id}>{o.customer?.name || "—"} · {when(o.from_date, false)} – {when(o.to_date, false)}</li>)}</ul></>)}
        </Panel>
        <Panel title="Due dates" icon={ShieldAlert}>
          <div className="flex flex-wrap gap-1.5">
            <DateChip label="Service" value={v.next_service_date} /><DateChip label="Insurance" value={v.insurance_expiry} /><DateChip label="Inspection" value={v.inspection_expiry} />
            <DateChip label="Speed governor" value={v.speed_governor_expiry} /><DateChip label="PSV" value={v.psv_expiry} />
          </div>
          {v.next_service_km && <p className="mt-2 text-xs">Service at {Number(v.next_service_km).toLocaleString()} km</p>}
          <p className="mt-2 text-xs text-muted-foreground">{jobs.length} visits · {money(spent)} approved work</p>
        </Panel>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel title="Service history" icon={History} flush>
          {!jobs.length ? <p className="p-4 text-sm text-muted-foreground">No jobs yet.</p> : (
            <div className="divide-y divide-border">
              {jobs.map((j: any) => (
                <a key={j.id} href={href(`/garage/jobs/${j.id}`)} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                  <span className="w-24 text-xs text-muted-foreground">{when(j.created_at, false)}</span><b>{j.job_no}</b>
                  <span className="flex-1 truncate">{j.complaint}</span>
                  {j.comeback_of && <span className="text-[10px] font-semibold text-warning">Comeback</span>}
                  {j.mileage_in && <span className="text-xs text-muted-foreground">{Number(j.mileage_in).toLocaleString()} km</span>}
                  <JobStatusPill status={j.status} /><span className="w-20 text-right tabular-nums">{money(j.approved_total)}</span>
                </a>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Mileage" icon={Gauge}>
          <div className="flex gap-2"><input className="fi" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} placeholder="Enter mileage" /><button type="button" onClick={addKm} className="h-10 rounded-xl border border-border px-3 text-sm">Add</button></div>
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-xs">{miles.map((m: any) => <li key={m.id} className="flex justify-between"><span className="text-muted-foreground">{when(m.recorded_at, false)} · {m.source.replace("_", " ")}</span><span className="tabular-nums">{Number(m.mileage).toLocaleString()} km</span></li>)}</ul>
        </Panel>
      </div>
      <Panel title="Vehicle photos">
        <MediaStrip media={media} meta={{ vehicle_id: v.id, stage: "vehicle" }} onChange={reload} allowVoice={false} />
      </Panel>
      {editing && <EditVehicle v={v} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}
