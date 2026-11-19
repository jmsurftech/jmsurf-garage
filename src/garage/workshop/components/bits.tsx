import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, Check, Loader2, Mic, Plus, Search, Square, Trash2, Eye, EyeOff, Car, Video } from "lucide-react";
import { Pill } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type JobStatus, VEHICLE_TYPES } from "../lib/status";
import { formatPlate, normalisePlate, suggestTypeFromPlate, isKenyanPlate } from "../lib/plate";
import { mediaUrl, uploadMedia, shrinkPhoto, sb, must } from "../lib/api";
import { smsInfo, render, MEASURE_VARS } from "../lib/reminders";
import type { Rag } from "../lib/checklists";

export function JobStatusPill({ status, className }: { status: string; className?: string }) {
  const s = (status in STATUS_LABEL ? status : "checked_in") as JobStatus;
  return <Pill tone={STATUS_TONE[s]} className={className}>{STATUS_LABEL[s]}</Pill>;
}

/** A number plate drawn like the real thing (yellow for commercial/PSV is not known, so plain white). */
export function PlateTag({ plate, className, big }: { plate?: string | null; className?: string; big?: boolean }) {
  if (!plate) return <span className="text-muted-foreground">No plate</span>;
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md border-2 border-foreground/80 bg-white px-1.5 font-mono font-bold tracking-wider text-black",
      big ? "py-1 text-xl" : "py-0 text-[12px]", className)}>{formatPlate(plate)}</span>
  );
}

export function vehicleLabel(v?: any): string {
  if (!v) return "";
  return [v.make, v.model, v.year].filter(Boolean).join(" ");
}

/** Small section heading inside a panel. */
export function Sub({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="mb-1.5 mt-3 flex items-center justify-between gap-2 first:mt-0"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>{right}</div>;
}

/* ------------------------------------------------------------- vehicle picker */

export function VehicleQuickForm({ initialPlate = "", customerId, onSaved, onCancel }: { initialPlate?: string; customerId?: string | null; onSaved: (v: any) => void; onCancel?: () => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const [f, setF] = useState<any>({ plate: initialPlate, make: "", model: "", year: "", vehicle_type: suggestTypeFromPlate(initialPlate) || "car", colour: "", engine: "", fuel: "", transmission: "", vin: "", mileage: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v, ...(k === "plate" && suggestTypeFromPlate(v) ? { vehicle_type: suggestTypeFromPlate(v) } : {}) }));
  const save = async () => {
    if (!normalisePlate(f.plate)) return toast({ title: "Enter the number plate", variant: "destructive" });
    setSaving(true);
    try {
      const row = must(await sb.from("garage_vehicles").insert({
        tenant_id: tenantId, plate: f.plate, make: f.make || null, model: f.model || null, year: Number(f.year) || null, vehicle_type: f.vehicle_type,
        colour: f.colour || null, engine: f.engine || null, fuel: f.fuel || null, transmission: f.transmission || null, vin: f.vin || null,
        mileage: Number(f.mileage) || null, customer_id: customerId || null,
      }).select("*, customer:customers(id,name,phone)").single());
      onSaved(row);
    } catch (e: any) {
      toast({ title: "Vehicle not saved", description: /duplicate|unique/i.test(e.message) ? "This plate is already saved. Search for it instead." : e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2 sm:col-span-1"><span className="text-xs text-muted-foreground">Number plate</span><input className="fi font-mono uppercase" value={f.plate} onChange={(e) => set("plate", e.target.value)} placeholder="Enter number plate" /></label>
        <label><span className="text-xs text-muted-foreground">Make</span><input className="fi" value={f.make} onChange={(e) => set("make", e.target.value)} placeholder="Enter make" /></label>
        <label><span className="text-xs text-muted-foreground">Model</span><input className="fi" value={f.model} onChange={(e) => set("model", e.target.value)} placeholder="Enter model" /></label>
        <label><span className="text-xs text-muted-foreground">Year</span><input className="fi" inputMode="numeric" value={f.year} onChange={(e) => set("year", e.target.value)} placeholder="Enter year" /></label>
        <label><span className="text-xs text-muted-foreground">Type</span><select className="fi" value={f.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)}>{VEHICLE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className="text-xs text-muted-foreground">Engine</span><input className="fi" value={f.engine} onChange={(e) => set("engine", e.target.value)} placeholder="e.g. 1.5L petrol" /></label>
        <label><span className="text-xs text-muted-foreground">Colour</span><input className="fi" value={f.colour} onChange={(e) => set("colour", e.target.value)} placeholder="Enter colour" /></label>
        <label><span className="text-xs text-muted-foreground">Mileage (km)</span><input className="fi" inputMode="numeric" value={f.mileage} onChange={(e) => set("mileage", e.target.value)} placeholder="Enter mileage" /></label>
        <label className="col-span-2"><span className="text-xs text-muted-foreground">Chassis / VIN</span><input className="fi font-mono uppercase" value={f.vin} onChange={(e) => set("vin", e.target.value)} placeholder="Enter chassis number" /></label>
      </div>
      {f.plate && !isKenyanPlate(f.plate) && <p className="text-xs text-warning">This does not look like a Kenyan plate. You can still save it.</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="h-9 rounded-xl border border-border px-3 text-sm" onClick={onCancel}>Cancel</button>}
        <button type="button" disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60" onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save vehicle
        </button>
      </div>
    </div>
  );
}

/** Search by plate (or make/model/VIN); pick one or add a new vehicle. */
export function VehiclePicker({ value, onChange, customerId }: { value: any | null; onChange: (v: any | null) => void; customerId?: string | null }) {
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const [list, setList] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (!tenantId || s.length < 2) { setList([]); return; }
    const t = setTimeout(async () => {
      const plate = normalisePlate(s);
      const { data } = await sb.from("garage_vehicles").select("*, customer:customers(id,name,phone)").eq("tenant_id", tenantId)
        .or(`plate.ilike.%${plate || s}%,make.ilike.%${s}%,model.ilike.%${s}%,vin.ilike.%${plate || s}%`).limit(8);
      setList(data || []);
    }, 220);
    return () => clearTimeout(t);
  }, [q, tenantId]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
        <span className="g-tile xs"><Car className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><PlateTag plate={value.plate} /><span className="truncate text-sm font-medium">{vehicleLabel(value)}</span></div>
          <p className="truncate text-xs text-muted-foreground">{value.customer?.name ? `Owner: ${value.customer.name}` : "No owner saved"}{value.mileage ? ` · ${Number(value.mileage).toLocaleString()} km` : ""}</p>
        </div>
        <button type="button" className="text-xs font-medium text-primary" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className="fi pl-9 font-mono uppercase" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Enter number plate" autoFocus />
      </div>
      {list.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {list.map((v) => (
            <button key={v.id} type="button" onClick={() => { onChange(v); setQ(""); }} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50">
              <PlateTag plate={v.plate} /><span className="flex-1 truncate text-sm">{vehicleLabel(v) || "—"}</span><span className="truncate text-xs text-muted-foreground">{v.customer?.name || ""}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"><Plus className="h-4 w-4" /> New vehicle {normalisePlate(q) && <span className="font-mono">{formatPlate(q)}</span>}</button>
      )}
      {adding && <VehicleQuickForm initialPlate={q} customerId={customerId} onCancel={() => setAdding(false)} onSaved={(v) => { setAdding(false); onChange(v); }} />}
    </div>
  );
}

/* ------------------------------------------------------------- mechanics */

export function MechanicChips({ value, onChange, list, disabled }: { value: string[]; onChange: (v: string[]) => void; list: { id: string; name: string }[]; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((m) => {
        const on = value.includes(m.id);
        return (
          <button key={m.id} type="button" disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {m.name}
          </button>
        );
      })}
      {!list.length && <span className="text-xs text-muted-foreground">Add staff in Settings → Users first</span>}
    </div>
  );
}

/* ------------------------------------------------------------- media */

function Thumb({ m, onDelete, onToggle }: { m: any; onDelete?: () => void; onToggle?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; mediaUrl(m.path).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [m.path]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
      {url && m.kind === "photo" && <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={m.caption || "Photo"} className="h-full w-full object-cover" loading="lazy" /></a>}
      {url && m.kind === "video" && <video src={url} controls className="h-full w-full object-cover" />}
      {url && m.kind === "voice" && <div className="flex h-full items-center p-1"><audio src={url} controls className="w-full" /></div>}
      {url && m.kind === "file" && <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-full items-center justify-center p-2 text-center text-xs underline">{m.caption || "Open file"}</a>}
      {m.caption && m.kind === "photo" && <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{m.caption}</span>}
      <div className="absolute right-1 top-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {onToggle && <button type="button" onClick={onToggle} title={m.customer_visible ? "Customer can see it" : "Staff only"} className="rounded-md bg-black/60 p-1 text-white">{m.customer_visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</button>}
        {onDelete && <button type="button" onClick={onDelete} title="Delete" className="rounded-md bg-black/60 p-1 text-white"><Trash2 className="h-3 w-3" /></button>}
      </div>
    </div>
  );
}

/** Photos / videos / voice notes with camera upload and a voice recorder. */
export function MediaStrip({ media, meta, onChange, compact, allowVoice = true }: {
  media: any[]; meta: { job_id?: string | null; line_id?: string | null; vehicle_id?: string | null; inspection_id?: string | null; stage?: string; caption?: string }; onChange: () => void; compact?: boolean; allowVoice?: boolean;
}) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length || !tenantId) return;
    setBusy(true);
    try { for (const f of Array.from(files)) await uploadMedia(tenantId, await shrinkPhoto(f), meta); onChange(); }
    catch (e: any) { toast({ title: "Not uploaded", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const record = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        const blob = Object.assign(new Blob(chunks, { type: r.mimeType || "audio/webm" }), { name: "voice-note.webm" });
        setBusy(true);
        try { await uploadMedia(tenantId!, blob, { ...meta, customer_visible: false }); onChange(); }
        catch (e: any) { toast({ title: "Voice note not saved", description: e.message, variant: "destructive" }); }
        finally { setBusy(false); }
      };
      r.start();
      setRec(r);
    } catch { toast({ title: "Microphone not available", description: "Allow the microphone for this site and try again.", variant: "destructive" }); }
  };
  const del = async (m: any) => { await sb.from("garage_job_media").delete().eq("id", m.id); onChange(); };
  const toggle = async (m: any) => { await sb.from("garage_job_media").update({ customer_visible: !m.customer_visible }).eq("id", m.id); onChange(); };
  return (
    <div className="space-y-2">
      {media.length > 0 && (
        <div className={cn("grid gap-2", compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-6")}>
          {media.map((m) => <Thumb key={m.id} m={m} onDelete={() => del(m)} onToggle={() => toggle(m)} />)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*,video/*" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Photo / video
        </button>
        {allowVoice && typeof window !== "undefined" && "MediaRecorder" in window && (
          <button type="button" disabled={busy} onClick={record} className={cn("inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium disabled:opacity-60", rec ? "border-destructive bg-destructive text-white" : "border-border bg-card hover:bg-muted")}>
            {rec ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />} {rec ? "Stop recording" : "Voice note"}
          </button>
        )}
        {!media.length && !compact && <span className="self-center text-xs text-muted-foreground"><Video className="mr-1 inline h-3.5 w-3.5" />Photos marked with the eye show on the customer's tracking page.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- car diagram */

export interface DamageMark { view: "top" | "left" | "right"; x: number; y: number; type: string; note?: string }
export const DAMAGE_TYPES: [string, string, string][] = [
  ["scratch", "Scratch", "#f59e0b"], ["dent", "Dent", "#3b82f6"], ["crack", "Crack / chip", "#a855f7"], ["broken", "Broken", "#ef4444"], ["missing", "Missing", "#64748b"], ["rust", "Rust", "#b45309"],
];
const colorOf = (t: string) => DAMAGE_TYPES.find((d) => d[0] === t)?.[2] || "#ef4444";

function CarTop() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
      <rect x="40" y="20" width="120" height="260" rx="38" />
      <path d="M58 95 Q100 72 142 95 L136 130 Q100 120 64 130 Z" />
      <path d="M64 205 Q100 214 136 205 L142 238 Q100 256 58 238 Z" />
      <rect x="64" y="132" width="72" height="70" rx="8" />
      <rect x="26" y="70" width="14" height="40" rx="4" /><rect x="160" y="70" width="14" height="40" rx="4" />
      <rect x="26" y="190" width="14" height="40" rx="4" /><rect x="160" y="190" width="14" height="40" rx="4" />
      <text x="100" y="14" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">FRONT</text>
      <text x="100" y="296" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">REAR</text>
    </g>
  );
}
function CarSide({ flip }: { flip?: boolean }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" transform={flip ? "translate(300,0) scale(-1,1)" : undefined}>
      <path d="M15 85 L30 60 L85 55 L120 25 L205 25 L245 55 L285 62 L290 85 Z" />
      <path d="M95 55 L125 30 L160 30 L160 55 Z" /><path d="M168 30 L200 30 L232 55 L168 55 Z" />
      <circle cx="70" cy="88" r="16" /><circle cx="235" cy="88" r="16" />
      <line x1="163" y1="30" x2="163" y2="85" />
    </g>
  );
}

/** Clickable car outline: pick a damage type, tap where it is. Tap a mark to remove it. */
export function CarDiagram({ marks, onChange, readOnly }: { marks: DamageMark[]; onChange?: (m: DamageMark[]) => void; readOnly?: boolean }) {
  const [type, setType] = useState("scratch");
  const add = (view: DamageMark["view"], e: React.MouseEvent<SVGSVGElement>) => {
    if (readOnly || !onChange) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    onChange([...marks, { view, x: Math.round(p.x), y: Math.round(p.y), type }]);
  };
  const remove = (i: number) => { if (!readOnly && onChange) onChange(marks.filter((_, j) => j !== i)); };
  const dots = (view: DamageMark["view"]) => marks.map((m, i) => m.view === view && (
    <g key={i} onClick={(e) => { e.stopPropagation(); remove(i); }} style={{ cursor: readOnly ? "default" : "pointer" }}>
      <circle cx={m.x} cy={m.y} r="7" fill={colorOf(m.type)} stroke="white" strokeWidth="2" />
      <text x={m.x} y={m.y + 3} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">{marks.slice(0, i + 1).length}</text>
    </g>
  ));
  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex flex-wrap gap-1.5">
          {DAMAGE_TYPES.map(([k, l, c]) => (
            <button key={k} type="button" onClick={() => setType(k)} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs", type === k ? "border-foreground font-semibold" : "border-border text-muted-foreground")}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] items-center gap-2 rounded-xl border border-border bg-muted/20 p-2">
        <svg viewBox="0 0 200 300" className="w-full touch-manipulation select-none" onClick={(e) => add("top", e)} role="img" aria-label="Car from above">
          <CarTop />{dots("top")}
        </svg>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Left side</p>
          <svg viewBox="0 0 300 110" className="w-full touch-manipulation select-none" onClick={(e) => add("left", e)} role="img" aria-label="Left side"><CarSide />{dots("left")}</svg>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Right side</p>
          <svg viewBox="0 0 300 110" className="w-full touch-manipulation select-none" onClick={(e) => add("right", e)} role="img" aria-label="Right side"><CarSide flip />{dots("right")}</svg>
        </div>
      </div>
      {marks.length > 0 && (
        <ol className="space-y-1 text-xs">
          {marks.map((m, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: colorOf(m.type) }}>{i + 1}</span>
              <span className="w-24 shrink-0">{DAMAGE_TYPES.find((d) => d[0] === m.type)?.[1]} ({m.view})</span>
              {readOnly ? <span className="text-muted-foreground">{m.note}</span> : (
                <input className="fi h-7 py-0 text-xs" value={m.note || ""} placeholder="Add a note (optional)" onChange={(e) => onChange?.(marks.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- RAG buttons */

export function RagPicker({ value, onChange }: { value: Rag | null; onChange: (v: Rag | null) => void }) {
  const opts: [Rag, string, string][] = [["green", "OK", "bg-success text-white"], ["amber", "Soon", "bg-warning text-white"], ["red", "Now", "bg-destructive text-white"], ["na", "N/A", "bg-muted-foreground text-white"]];
  return (
    <div className="inline-flex shrink-0 gap-1">
      {opts.map(([k, l, on]) => (
        <button key={k} type="button" onClick={() => onChange(value === k ? null : k)}
          className={cn("h-7 min-w-[2.5rem] rounded-lg border px-1.5 text-[11px] font-semibold", value === k ? cn(on, "border-transparent") : "border-border bg-card text-muted-foreground")}>{l}</button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- SMS text box */

/** Message template box with a live count. Fits one SMS part when the warning stays off. */
export function SmsTextBox({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const info = useMemo(() => smsInfo(render(value, MEASURE_VARS)), [value]);
  return (
    <div className="space-y-1">
      <textarea className="fi" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">Fields: {"{name} {plate} {date} {garage} {phone} {link}"}</span>
        <span className={cn("font-semibold tabular-nums", info.parts > 1 ? "text-destructive" : info.length > info.limit - 15 ? "text-warning" : "text-success")}>
          {info.length}/{info.limit} · {info.parts} SMS{info.parts > 1 ? " (shorten to fit 1)" : ""}{info.unicode ? " · special characters" : ""}
        </span>
      </div>
    </div>
  );
}

export const money = (n: number | string | null | undefined) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const when = (iso?: string | null, time = true) => iso ? new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", ...(time ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }) }) : "—";
