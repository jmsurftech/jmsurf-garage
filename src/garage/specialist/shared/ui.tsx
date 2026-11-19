/**
 * Small building blocks the specialist pages share: module gate, home layout,
 * stage bar, pickers for customers and vehicles, a lines editor, link sharing
 * and public photo uploads. Built on the app kit so the look stays the same.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Copy, ImagePlus, Lock, MessageSquare, Plus, Share2, Trash2, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageLoader, Panel, StatTile } from "@/components/kit";
import { useModules } from "@/hooks/useModules";
import { moduleFor } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { Picker } from "@/apps/fields";
import { useLookup } from "@/apps/data";
import { useTenantId } from "@/hooks/useTenantId";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendlyError";
import { sendShopMessage } from "@/lib/messaging";
import { shareOnWhatsApp } from "@/lib/docSend";
import type { StageDef } from "@/apps/types";
import { ensureVehicle, num, useVehicles, vehicleLabel, type Rec } from "./db";

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50";
export const btnDark = "inline-flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-1.5 text-sm font-semibold text-background disabled:opacity-50";

/** Runs an async action with a busy flag and friendly errors. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  };
  return { busy, run };
}

/** Shows the page only while the module is switched on. */
export function Gate({ module, children }: { module: string; children: ReactNode }) {
  const { has, ready } = useModules();
  const mod = moduleFor(module);
  if (!ready) return <PageLoader />;
  if (has(module)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: mod?.color || "#a8121b" }}>
        {mod ? <mod.icon className="h-8 w-8" /> : <Lock className="h-8 w-8" />}
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold">{mod?.name || "This module"} is switched off</h1>
      <p className="mt-2 text-muted-foreground">Switch it on in Modules to use it. Your existing records are kept.</p>
      <Link to={`/modules?app=${module}`} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Open Modules <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}

export interface HomeLink { to: string; label: string; icon: LucideIcon; hint?: string }
export interface HomeStat { label: string; value: ReactNode; tone?: "primary" | "success" | "warning" | "danger" | "info" | "muted"; icon?: LucideIcon; hint?: ReactNode }

/** Module overview: stats, shortcuts, then the module's own panels. */
export function ModuleHome({ module, title, icon, stats, links, actions, children }: {
  module: string; title: string; icon: LucideIcon; stats: HomeStat[]; links: HomeLink[]; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <Gate module={module}>
      <div className="space-y-3">
        <PageHeader title={title} icon={icon} actions={actions} />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.value} tone={s.tone} icon={s.icon} hint={s.hint} />)}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary/40 hover:bg-primary/5">
              <l.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0"><span className="block truncate">{l.label}</span>{l.hint && <span className="block truncate text-[11px] text-muted-foreground">{l.hint}</span>}</span>
            </Link>
          ))}
        </div>
        {children}
      </div>
    </Gate>
  );
}

const TONE: Record<StageDef["tone"], string> = {
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300", blue: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300", violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", red: "bg-red-500/10 text-red-600 dark:text-red-300",
  cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300", pink: "bg-pink-500/10 text-pink-600 dark:text-pink-300",
};

export function StageChip({ stages, stage }: { stages: StageDef[]; stage: string | null | undefined }) {
  const s = stages.find((x) => x.key === stage);
  if (!s) return stage ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{stage}</span> : null;
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[s.tone])}>{s.label}</span>;
}

/** Clickable stage bar (same look as the record form). */
export function StageBar({ stages, value, onChange, disabled }: { stages: StageDef[]; value: string | null | undefined; onChange: (s: StageDef) => void; disabled?: boolean }) {
  const cur = stages.findIndex((x) => x.key === value);
  return (
    <div className="flex overflow-x-auto rounded-xl border border-border">
      {stages.map((s, i) => (
        <button key={s.key} type="button" disabled={disabled} onClick={() => onChange(s)}
          className={cn("flex-1 whitespace-nowrap px-3 py-1.5 text-xs font-semibold transition-colors", i > 0 && "border-l border-border",
            s.key === value ? "bg-primary text-primary-foreground" : i < cur && !s.done ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function CustomerSelect({ value, onChange, placeholder = "Choose a customer…" }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string }) {
  const { data = [], isLoading } = useLookup("customer");
  return <Picker value={value} onChange={onChange} options={data} loading={isLoading} placeholder={placeholder} />;
}

export function EmployeeSelect({ value, onChange, placeholder = "Choose a person…" }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string }) {
  const { data = [], isLoading } = useLookup("employee");
  return <Picker value={value} onChange={onChange} options={data} loading={isLoading} placeholder={placeholder} />;
}

export function ProductSelect({ value, onChange, placeholder = "Choose an item…" }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string }) {
  const { data = [], isLoading } = useLookup("product");
  return <Picker value={value} onChange={onChange} options={data} loading={isLoading} placeholder={placeholder} />;
}

/** Picks a vehicle from the workshop's list, or adds one by plate. */
export function VehicleSelect({ value, onChange, customerId }: { value: string | null | undefined; onChange: (id: string | null) => void; customerId?: string | null }) {
  const tenantId = useTenantId();
  const { data = [], isLoading, refetch } = useVehicles();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ plate: "", make: "", model: "", year: "" });
  const opts = useMemo(() => data.map((v) => ({ id: v.id, label: v.plate, sub: [v.make, v.model, v.year].filter(Boolean).join(" ") })), [data]);
  const add = async () => {
    try {
      const id = await ensureVehicle(tenantId!, { plate: f.plate, make: f.make || null, model: f.model || null, year: f.year ? Number(f.year) : null, customer_id: customerId || null });
      await refetch(); onChange(id); setAdding(false); setF({ plate: "", make: "", model: "", year: "" });
    } catch (e) { toast.error(friendlyError(e)); }
  };
  if (adding) {
    return (
      <div className="space-y-2 rounded-xl border border-border p-2">
        <div className="grid grid-cols-2 gap-2">
          <input className="fi" placeholder="Enter number plate" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
          <input className="fi" placeholder="Enter make" value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} />
          <input className="fi" placeholder="Enter model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <input className="fi" placeholder="Enter year" inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2"><button type="button" className={btn} onClick={() => setAdding(false)}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void add()}>Add vehicle</button></div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1"><Picker value={value} onChange={onChange} options={opts} loading={isLoading} placeholder="Choose a vehicle…" /></div>
      <button type="button" className={btn} onClick={() => setAdding(true)} title="Add a vehicle"><Plus className="h-4 w-4" /></button>
    </div>
  );
}

export function VehicleText({ id }: { id: string | null | undefined }) {
  const { data = [] } = useVehicles(!!id);
  const v = data.find((x) => x.id === id);
  return <>{v ? vehicleLabel(v) : id ? "Vehicle" : "—"}</>;
}

/* ------------------------------------------------------------ lines editor */

export interface Col {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "select" | "checkbox" | "date";
  options?: string[];
  width?: string;
  placeholder?: string;
}

/** Editable table of lines (phone: each line wraps into a card). */
export function LinesTable({ cols, rows, onChange, addLabel = "Add line", newRow = {}, footer, readOnly }: {
  cols: Col[]; rows: Record<string, any>[]; onChange: (rows: Record<string, any>[]) => void; addLabel?: string; newRow?: Record<string, any>; footer?: ReactNode; readOnly?: boolean;
}) {
  const set = (i: number, k: string, v: any) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="dt">
          <thead><tr>{cols.map((c) => <th key={c.key} className={cn(["number", "money"].includes(c.type || "") && "num")} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}{!readOnly && <th />}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} data-label={c.label} className={cn(["number", "money"].includes(c.type || "") && "num")}>
                    {readOnly ? (c.type === "checkbox" ? (r[c.key] ? "Yes" : "") : String(r[c.key] ?? "")) :
                      c.type === "select" ? (
                        <select className="fi h-8 py-0 text-sm" value={r[c.key] ?? ""} onChange={(e) => set(i, c.key, e.target.value)}>
                          <option value="">—</option>{(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : c.type === "checkbox" ? (
                        <input type="checkbox" checked={!!r[c.key]} onChange={(e) => set(i, c.key, e.target.checked)} />
                      ) : (
                        <input className={cn("fi h-8 py-0 text-sm", ["number", "money"].includes(c.type || "") && "text-right tabular-nums")}
                          type={c.type === "date" ? "date" : "text"} inputMode={["number", "money"].includes(c.type || "") ? "decimal" : undefined}
                          placeholder={c.placeholder} value={r[c.key] ?? ""}
                          onChange={(e) => set(i, c.key, ["number", "money"].includes(c.type || "") ? e.target.value.replace(/[^0-9.-]/g, "") : e.target.value)} />
                      )}
                  </td>
                ))}
                {!readOnly && <td className="w-8"><button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 1} className="py-4 text-center text-sm text-muted-foreground">No lines yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!readOnly ? <button type="button" className={btn} onClick={() => onChange([...rows, { ...newRow }])}><Plus className="h-4 w-4" /> {addLabel}</button> : <span />}
        {footer}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ misc */

export function KV({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-4", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0"><dt className="truncate text-[11px] text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v ?? "—"}</dd></div>
      ))}
    </dl>
  );
}

export function Labeled({ label, children, className, hint }: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function NumIn({ value, onChange, placeholder, className }: { value: any; onChange: (v: number | null) => void; placeholder?: string; className?: string }) {
  return <input className={cn("fi text-right tabular-nums", className)} inputMode="decimal" placeholder={placeholder} value={value ?? ""} onChange={(e) => { const s = e.target.value.replace(/[^0-9.-]/g, ""); onChange(s === "" ? null : Number(s)); }} />;
}

/** A no-login link with copy, SMS and WhatsApp buttons. */
export function ShareLink({ url, phone, text, label = "Link" }: { url: string; phone?: string | null; text: string; label?: string }) {
  const [to, setTo] = useState(phone || "");
  const sms = async () => {
    if (!to.trim()) return toast.error("Enter the phone number");
    const r = await sendShopMessage("sms", to.trim(), `${text} ${url}`);
    if (r && r.ok === false) toast.error(r.error || "SMS not sent"); else toast.success("Link sent by SMS");
  };
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={url} className="fi h-8 min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}><Copy className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="fi h-8 w-40 text-sm" placeholder="07XXXXXXXX" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className={btn} onClick={() => void sms()}><MessageSquare className="h-4 w-4" /> SMS</button>
        <button type="button" className={btn} onClick={() => shareOnWhatsApp(to || null, `${text} ${url}`)}><Share2 className="h-4 w-4" /> WhatsApp</button>
      </div>
    </div>
  );
}

/** Photos stored in the public images store (yard listings). Returns public URLs. */
export function PublicPhotos({ folder, value, onChange, max = 20 }: { folder: string; value: string[]; onChange: (urls: string[]) => void; max?: number }) {
  const tenantId = useTenantId();
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files?.length || !tenantId) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, Math.max(0, max - value.length))) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: photos up to 8 MB`); continue; }
        const path = `${tenantId}/garage/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
        const { error } = await supabase.storage.from("product-images").upload(path, f, { contentType: f.type });
        if (error) throw error;
        urls.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
      }
      onChange([...value, ...urls]);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {value.map((u, i) => (
        <div key={u} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted">
          <img src={u} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
          {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">Main</span>}
          <div className="absolute right-1 top-1 flex gap-1">
            {i > 0 && <button type="button" onClick={() => onChange([u, ...value.filter((x) => x !== u)])} className="rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">Main</button>}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== u))} className="rounded bg-black/60 p-0.5 text-white" aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      {value.length < max && (
        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:bg-muted">
          <ImagePlus className="h-5 w-5" /> {busy ? "Uploading…" : "Add photos"}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
        </label>
      )}
    </div>
  );
}

/** Simple read-only table of records with a link per row. */
export function RecTable({ rows, cols, to, empty = "Nothing here yet." }: { rows: Rec[]; cols: { label: string; get: (r: Rec) => ReactNode; num?: boolean }[]; to: (r: Rec) => string; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead><tr>{cols.map((c) => <th key={c.label} className={cn(c.num && "num")}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c, i) => (
                <td key={c.label} data-label={c.label} className={cn(c.num && "num")}>
                  {i === 0 ? <Link to={to(r)} className="font-medium text-primary hover:underline">{c.get(r)}</Link> : c.get(r)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length} className="py-6 text-center text-sm text-muted-foreground">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export { Panel };
export const sumBy = <T,>(rows: T[], f: (r: T) => unknown) => rows.reduce((a, r) => a + num(f(r)), 0);
