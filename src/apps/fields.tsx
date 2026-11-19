import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "./format";
import { useLookup, useRecordOptions, type Option } from "./data";
import { refTarget } from "./registry";
import type { FieldDef } from "./types";

/* ------------------------------------------------------------- picker */

export function Picker({ value, onChange, options, placeholder = "Select…", loading }: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: Option[];
  placeholder?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(t)) : options).slice(0, 60);
  }, [q, options]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="fi flex items-center justify-between gap-2 text-left">
        <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? current.label : loading ? "Loading…" : placeholder}</span>
        <span className="flex items-center gap-1">
          {current && <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onChange(null); }} />}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>
      {open && (
        <div className="absolute z-[95] mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none" />
          <div className="max-h-64 overflow-y-auto py-1">
            {list.map((o) => (
              <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted", o.id === value && "bg-primary/5")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.sub && <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>}
                </span>
                {o.id === value && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
            {!list.length && <p className="px-3 py-3 text-sm text-muted-foreground">{loading ? "Loading…" : "Nothing found"}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function LookupPicker({ type, value, onChange }: { type: "customer" | "supplier" | "employee" | "product" | "user"; value: any; onChange: (v: any) => void }) {
  const { data = [], isLoading } = useLookup(type);
  return <Picker value={value} onChange={onChange} options={data} loading={isLoading} placeholder={`Choose ${type === "user" ? "a person" : `a ${type}`}…`} />;
}

function RecordPicker({ app, refKind, value, onChange }: { app: string; refKind: string; value: any; onChange: (v: any) => void }) {
  const t = refTarget(app, refKind);
  const { data = [], isLoading } = useRecordOptions(t.app, t.kind);
  return <Picker value={value} onChange={onChange} options={data} loading={isLoading} />;
}

/* ------------------------------------------------------------- signature */

export function SignaturePad({ value, onChange }: { value?: string | null; onChange: (v: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.current!.width, y: ((e.clientY - r.top) / r.height) * canvas.current!.height };
  };
  return (
    <div className="space-y-2">
      <canvas ref={canvas} width={600} height={180} className="h-36 w-full touch-none rounded-xl border border-dashed border-input bg-white"
        onPointerDown={(e) => { drawing.current = true; const ctx = canvas.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = canvas.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#111318"; ctx.lineTo(p.x, p.y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(canvas.current!.toDataURL("image/png")); }} />
      <button type="button" className="text-xs font-medium text-muted-foreground hover:text-destructive"
        onClick={() => { const c = canvas.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); onChange(null); }}>
        Clear signature
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- lines */

function LinesEditor({ app, field, value, onChange }: { app: string; field: FieldDef; value: any; onChange: (v: any) => void }) {
  const rows: Record<string, any>[] = Array.isArray(value) ? value : [];
  const cols = field.lineFields || [];
  const set = (i: number, k: string, v: any) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="dt dt-keep min-w-[480px]">
        <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}<th className="w-10" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className="!px-2 !py-1.5">
                  <FieldInput app={app} field={c} value={r[c.key]} onChange={(v) => set(i, c.key, v)} compact />
                </td>
              ))}
              <td className="!px-1"><button type="button" className="icon-btn-danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length + 1} className="text-center text-sm text-muted-foreground">No lines yet</td></tr>}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...rows, {}])} className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary hover:bg-primary/5">
        <Plus className="h-4 w-4" /> Add line
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- inputs */

export function FieldInput({ app, field, value, onChange, compact }: { app: string; field: FieldDef; value: any; onChange: (v: any) => void; compact?: boolean }) {
  const cls = cn("fi", compact && "h-9 rounded-lg");
  switch (field.type) {
    case "textarea": return <textarea className="fi" rows={compact ? 2 : 4} value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "number": case "money": case "percent":
      return <input className={cls} type="number" step="any" inputMode="decimal" value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "date": return <input className={cls} type="date" value={value ? String(value).slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "datetime": return <input className={cls} type="datetime-local" value={value ? toLocalInput(value) : ""} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case "select": return (
      <select className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    case "multiselect": {
      const arr: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options || []).map((o) => {
            const on = arr.includes(o);
            return <button key={o} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40")}>{o}</button>;
          })}
        </div>
      );
    }
    case "checkbox": return (
      <label className="inline-flex h-10 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {compact ? "" : "Yes"}
      </label>
    );
    case "rating": return (
      <div className="flex h-10 items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} aria-label={`${n} star`}>
            <Star className={cn("h-5 w-5", Number(value) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
          </button>
        ))}
      </div>
    );
    case "color": return <input type="color" className="h-10 w-16 cursor-pointer rounded-lg border border-input bg-background p-1" value={value || "#a8121b"} onChange={(e) => onChange(e.target.value)} />;
    case "email": return <input className={cls} type="email" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "phone": return <input className={cls} type="tel" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "url": return <input className={cls} type="url" placeholder="https://" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "customer": case "supplier": case "employee": case "product": case "user":
      return <LookupPicker type={field.type} value={value} onChange={onChange} />;
    case "record": return <RecordPicker app={app} refKind={field.ref || ""} value={value} onChange={onChange} />;
    case "lines": return <LinesEditor app={app} field={field} value={value} onChange={onChange} />;
    case "signature": return <SignaturePad value={value} onChange={onChange} />;
    default: return <input className={cls} value={value ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

function toLocalInput(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------- display */

export function useFieldLabels(app: string, fields: FieldDef[]) {
  const need = (t: string) => fields.some((f) => f.type === t);
  const customers = useLookup("customer", need("customer"));
  const suppliers = useLookup("supplier", need("supplier"));
  const employees = useLookup("employee", need("employee"));
  const products = useLookup("product", need("product"));
  const users = useLookup("user", need("user"));
  const maps = useMemo(() => {
    const m = (o?: Option[]) => new Map((o || []).map((x) => [x.id, x.label]));
    return { customer: m(customers.data), supplier: m(suppliers.data), employee: m(employees.data), product: m(products.data), user: m(users.data) };
  }, [customers.data, suppliers.data, employees.data, products.data, users.data]);
  return maps;
}

export function FieldDisplay({ field, value, labels, recordLabels }: {
  field: FieldDef; value: any;
  labels: ReturnType<typeof useFieldLabels>;
  recordLabels?: Map<string, string>;
}) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return <span className="text-muted-foreground">—</span>;
  switch (field.type) {
    case "money": return <span className="tabular-nums">{fmtMoney(Number(value))}</span>;
    case "percent": return <span className="tabular-nums">{Number(value)}%</span>;
    case "number": return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;
    case "date": return <span>{new Date(String(value).slice(0, 10) + "T00:00:00").toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</span>;
    case "datetime": return <span>{new Date(value).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>;
    case "checkbox": return <span>{value ? "Yes" : "No"}</span>;
    case "rating": return <span className="text-amber-500">{"★".repeat(Number(value))}<span className="text-muted-foreground/40">{"★".repeat(5 - Number(value))}</span></span>;
    case "color": return <span className="inline-block h-4 w-4 rounded-full border" style={{ background: value }} />;
    case "multiselect": return <span>{(value as string[]).join(", ")}</span>;
    case "customer": case "supplier": case "employee": case "product": case "user":
      return <span>{labels[field.type].get(value) || "…"}</span>;
    case "record": return <span>{recordLabels?.get(value) || "…"}</span>;
    case "lines": return <span>{(value as unknown[]).length} line(s)</span>;
    case "signature": return <img src={value} alt="Signature" className="h-10 rounded bg-white" />;
    case "url": return <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary underline">{value}</a>;
    default: return <span>{String(value)}</span>;
  }
}
