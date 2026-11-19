import { useEffect, useState } from "react";
import { Settings2, Plus, Trash2, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { PageHeader, Panel, Segmented, Field } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { useLocations, useProducts } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { useTenantId } from "@/hooks/useTenantId";
import { sb, must } from "../lib/api";
import { saveGarageSettings, useBays, useGarageSettings, useInspectionTemplates, useJobTemplates, useRefresh, useServiceMenus } from "../lib/data";
import { DEFAULT_QC, STARTER_TEMPLATES } from "../lib/checklists";
import { money } from "../components/bits";

type Tab = "general" | "bays" | "booking" | "qc" | "checklists" | "menus" | "templates";
const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [add, setAdd] = useState("");
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className="fi h-9" value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" onClick={() => i > 0 && onChange(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} className="rounded-lg border border-border p-1.5" aria-label="Up"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => i < items.length - 1 && onChange(items.map((x, j) => (j === i + 1 ? items[i] : j === i ? items[i + 1] : x)))} className="rounded-lg border border-border p-1.5" aria-label="Down"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded-lg border border-border p-1.5 text-destructive" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="flex gap-1.5"><input className="fi h-9" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && add.trim()) { onChange([...items, add.trim()]); setAdd(""); } }} placeholder={placeholder} />
        <button type="button" onClick={() => { if (add.trim()) { onChange([...items, add.trim()]); setAdd(""); } }} className="h-9 rounded-xl border border-border px-3 text-sm">Add</button></div>
    </div>
  );
}

function Checklists() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: list = [], refetch } = useInspectionTemplates();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const addStarters = async () => {
    const have = new Set((list as any[]).map((t) => t.name));
    const rows = STARTER_TEMPLATES.filter((t) => !have.has(t.name)).map((t) => ({ tenant_id: tenantId, ...t }));
    if (!rows.length) return toast({ title: "The ready-made checklists are already here" });
    const r = await sb.from("garage_inspection_templates").insert(rows);
    toast({ title: r.error ? "Not added" : `${rows.length} checklist(s) added`, description: r.error?.message, variant: r.error ? "destructive" : undefined });
    void refetch();
  };
  const save = async () => {
    const items = String(draft.text || "").split("\n").map((line: string) => line.trim()).filter(Boolean).reduce((acc: any[], line: string) => {
      if (line.startsWith("#")) { acc.push({ section: line.replace(/^#+\s*/, ""), label: null }); return acc; }
      const section = [...acc].reverse().find((x) => x.section && x.label === null)?.section || "General";
      acc.push({ section, label: line }); return acc;
    }, []).filter((x: any) => x.label);
    const row = { name: draft.name, kind: draft.kind, items, active: draft.active !== false };
    const r = draft.id ? await sb.from("garage_inspection_templates").update(row).eq("id", draft.id) : await sb.from("garage_inspection_templates").insert({ tenant_id: tenantId, ...row });
    if (r.error) return toast({ title: "Not saved", description: r.error.message, variant: "destructive" });
    toast({ title: "Checklist saved" }); setDraft(null); setOpen(null); void refetch();
  };
  const edit = (t: any) => {
    let last = "";
    const text = (t.items || []).map((i: any) => { const head = i.section !== last ? `# ${i.section}\n` : ""; last = i.section; return head + i.label; }).join("\n");
    setOpen(t.id); setDraft({ ...t, text });
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addStarters} className="h-9 rounded-xl border border-border px-3 text-sm">Add the ready-made checklists</button>
        <button type="button" onClick={() => { setOpen("new"); setDraft({ name: "", kind: "multi_point", text: "# Section\n" }); }} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />New checklist</button>
      </div>
      {(list as any[]).map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
          <span className="flex-1 font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{(t.items || []).length} items</span>
          <button type="button" onClick={() => edit(t)} className="text-xs text-primary">Edit</button>
          <button type="button" onClick={async () => { await sb.from("garage_inspection_templates").delete().eq("id", t.id); void refetch(); }} className="text-xs text-destructive">Delete</button>
        </div>
      ))}
      {open && draft && (
        <div className="space-y-2 rounded-xl border border-primary/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="fi" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Enter checklist name" />
            <select className="fi" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option value="multi_point">Multi-point inspection</option><option value="pre_purchase">Pre-purchase</option><option value="ntsa">NTSA inspection prep</option><option value="other">Other</option></select>
          </div>
          <textarea className="fi font-mono text-xs" rows={12} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">One item per line. Start a line with # for a section heading.</p>
          <div className="flex gap-2"><button type="button" onClick={save} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Save checklist</button><button type="button" onClick={() => { setOpen(null); setDraft(null); }} className="h-9 rounded-xl border border-border px-3 text-sm">Cancel</button></div>
        </div>
      )}
    </div>
  );
}

function Menus() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const { data: menus = [], refetch } = useServiceMenus();
  const { data: products = [] } = useProducts();
  const [d, setD] = useState<any>(null);
  const save = async () => {
    if (!d.name) return toast({ title: "Enter the service name", variant: "destructive" });
    const row = { name: d.name, make: d.make || null, model: d.model || null, engine: d.engine || null, labour_hours: Number(d.labour_hours) || null, labour_price: Number(d.labour_price) || 0, parts: d.parts || [], interval_months: Number(d.interval_months) || null, interval_km: Number(d.interval_km) || null };
    const r = d.id ? await sb.from("garage_service_menus").update(row).eq("id", d.id) : await sb.from("garage_service_menus").insert({ tenant_id: tenantId, ...row });
    if (r.error) return toast({ title: "Not saved", description: r.error.message, variant: "destructive" });
    setD(null); void refetch();
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setD({ parts: [] })} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />New service package</button>
      {(menus as any[]).map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
          <span className="flex-1 font-medium">{m.name}<span className="ml-1 text-xs text-muted-foreground">{[m.make, m.model, m.engine].filter(Boolean).join(" ") || "Any vehicle"}</span></span>
          <span className="text-xs">Labour {money(m.labour_price)}{m.labour_hours ? ` (${m.labour_hours} h)` : ""} · {(m.parts || []).length} parts</span>
          <button type="button" onClick={() => setD(m)} className="text-xs text-primary">Edit</button>
          <button type="button" onClick={async () => { await sb.from("garage_service_menus").update({ active: false }).eq("id", m.id); void refetch(); }} className="text-xs text-destructive">Remove</button>
        </div>
      ))}
      {d && (
        <div className="space-y-2 rounded-xl border border-primary/40 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className="fi col-span-2" value={d.name || ""} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Enter name (e.g. Full service 1.5L)" />
            <input className="fi" value={d.make || ""} onChange={(e) => setD({ ...d, make: e.target.value })} placeholder="Make (blank = any)" />
            <input className="fi" value={d.model || ""} onChange={(e) => setD({ ...d, model: e.target.value })} placeholder="Model (blank = any)" />
            <input className="fi" value={d.engine || ""} onChange={(e) => setD({ ...d, engine: e.target.value })} placeholder="Engine (optional)" />
            <input className="fi" inputMode="decimal" value={d.labour_price ?? ""} onChange={(e) => setD({ ...d, labour_price: e.target.value })} placeholder="Labour price" />
            <input className="fi" inputMode="decimal" value={d.labour_hours ?? ""} onChange={(e) => setD({ ...d, labour_hours: e.target.value })} placeholder="Labour hours" />
            <input className="fi" inputMode="numeric" value={d.interval_km ?? ""} onChange={(e) => setD({ ...d, interval_km: e.target.value })} placeholder="Repeat every (km)" />
          </div>
          <p className="text-xs font-semibold">Parts in this package</p>
          {(d.parts || []).map((p: any, i: number) => (
            <div key={i} className="flex gap-1.5">
              <select className="fi" value={p.item_id || ""} onChange={(e) => { const pr = (products as any[]).find((x) => x.id === e.target.value); setD({ ...d, parts: d.parts.map((x: any, j: number) => (j === i ? { ...x, item_id: pr?.id || null, name: pr?.name || x.name, rate: pr?.price ?? x.rate, tax_rate: pr?.vat_rate ?? 0 } : x)) }); }}>
                <option value="">Choose an item</option>{(products as any[]).map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
              <input className="fi w-20" inputMode="decimal" value={p.qty ?? 1} onChange={(e) => setD({ ...d, parts: d.parts.map((x: any, j: number) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)) })} />
              <button type="button" onClick={() => setD({ ...d, parts: d.parts.filter((_: any, j: number) => j !== i) })} className="rounded-lg border border-border px-2 text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setD({ ...d, parts: [...(d.parts || []), { item_id: null, qty: 1 }] })} className="text-xs text-primary">+ Add a part</button>
          <div className="flex gap-2"><button type="button" onClick={save} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Save package</button><button type="button" onClick={() => setD(null)} className="h-9 rounded-xl border border-border px-3 text-sm">Cancel</button></div>
        </div>
      )}
    </div>
  );
}

export default function WorkshopSettings() {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const refresh = useRefresh();
  const { data: settings } = useGarageSettings();
  const { data: bays = [], refetch: refetchBays } = useBays();
  const { data: locations = [] } = useLocations();
  const { data: templates = [], refetch: refetchTpl } = useJobTemplates();
  const [tab, setTab] = useState<Tab>("general");
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [bay, setBay] = useState({ name: "", kind: "bay" });
  useEffect(() => { if (settings && !s) setS({ ...settings, qc_checklist: settings.qc_checklist?.length ? settings.qc_checklist : DEFAULT_QC }); }, [settings, s]);
  if (!s) return null;
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      const { reminders: _r, ...rest } = s;
      void _r;
      await saveGarageSettings(tenantId!, {
        ...rest, slot_minutes: Number(rest.slot_minutes) || 60, open_hour: Number(rest.open_hour) || 8, close_hour: Number(rest.close_hour) || 17,
        service_interval_months: Number(rest.service_interval_months) || 6, service_interval_km: Number(rest.service_interval_km) || 5000,
        estimate_valid_days: Number(rest.estimate_valid_days) || 14, labour_rate: Number(rest.labour_rate) || 0, default_location_id: rest.default_location_id || null,
      });
      toast({ title: "Workshop settings saved" }); refresh();
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  const addBay = async () => {
    if (!bay.name.trim()) return;
    const r = await sb.from("garage_bays").insert({ tenant_id: tenantId, name: bay.name.trim(), kind: bay.kind, sort: (bays as any[]).length });
    if (r.error) return toast({ title: "Not added", description: r.error.message, variant: "destructive" });
    setBay({ name: "", kind: bay.kind }); void refetchBays();
  };
  const saveBtn = <button type="button" disabled={saving} onClick={save} className="inline-flex h-9 items-center gap-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>;

  return (
    <div className="space-y-3">
      <PageHeader title="Workshop settings" icon={Settings2} actions={["general", "booking", "qc"].includes(tab) ? saveBtn : undefined} />
      <div className="overflow-x-auto"><Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} options={[
        { value: "general", label: "General" }, { value: "bays", label: "Bays and lifts" }, { value: "booking", label: "Online booking" }, { value: "qc", label: "Quality check" },
        { value: "checklists", label: "Inspection checklists" }, { value: "menus", label: "Service packages" }, { value: "templates", label: "Job templates" },
      ]} /></div>

      {tab === "general" && (
        <Panel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Labour rate per hour"><input className="fi" inputMode="decimal" value={s.labour_rate ?? ""} onChange={(e) => set("labour_rate", e.target.value)} placeholder="Enter rate" /></Field>
            <Field label="Next service after (months)"><input className="fi" inputMode="numeric" value={s.service_interval_months ?? ""} onChange={(e) => set("service_interval_months", e.target.value)} /></Field>
            <Field label="Next service after (km)"><input className="fi" inputMode="numeric" value={s.service_interval_km ?? ""} onChange={(e) => set("service_interval_km", e.target.value)} /></Field>
            <Field label="Estimates valid for (days)"><input className="fi" inputMode="numeric" value={s.estimate_valid_days ?? ""} onChange={(e) => set("estimate_valid_days", e.target.value)} /></Field>
            <Field label="Store for job parts"><select className="fi" value={s.default_location_id || ""} onChange={(e) => set("default_location_id", e.target.value)}><option value="">First store</option>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          </div>
          <Field label="Check-in terms the customer signs" className="mt-3"><textarea className="fi" rows={4} value={s.checkin_terms || ""} onChange={(e) => set("checkin_terms", e.target.value)} placeholder="Enter your terms (leave blank to use the standard wording)" /></Field>
        </Panel>
      )}

      {tab === "bays" && (
        <Panel>
          <div className="space-y-1.5">
            {(bays as any[]).map((b) => (
              <div key={b.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm">
                <input className="fi h-8 flex-1" defaultValue={b.name} onBlur={async (e) => { if (e.target.value !== b.name) { await sb.from("garage_bays").update({ name: e.target.value }).eq("id", b.id); void refetchBays(); } }} />
                <select className="fi h-8 w-36 py-0" value={b.kind} onChange={async (e) => { await sb.from("garage_bays").update({ kind: e.target.value }).eq("id", b.id); void refetchBays(); }}><option value="bay">Bay</option><option value="lift">Lift</option><option value="pit">Pit</option><option value="wash">Wash bay</option><option value="paint_booth">Paint booth</option><option value="outside">Outside</option></select>
                <label className="flex items-center gap-1 text-xs"><Switch checked={b.active} onCheckedChange={async (v) => { await sb.from("garage_bays").update({ active: v }).eq("id", b.id); void refetchBays(); }} />In use</label>
                <button type="button" onClick={async () => { await sb.from("garage_bays").delete().eq("id", b.id); void refetchBays(); }} className="text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex gap-2"><input className="fi" value={bay.name} onChange={(e) => setBay({ ...bay, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addBay()} placeholder="Enter bay name (e.g. Bay 1, Lift A)" />
              <select className="fi w-36" value={bay.kind} onChange={(e) => setBay({ ...bay, kind: e.target.value })}><option value="bay">Bay</option><option value="lift">Lift</option><option value="pit">Pit</option><option value="wash">Wash bay</option><option value="paint_booth">Paint booth</option><option value="outside">Outside</option></select>
              <button type="button" onClick={addBay} className="h-10 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground">Add</button></div>
            <p className="text-[11px] text-muted-foreground">The number of bays in use is how many cars can be booked online at the same time.</p>
          </div>
        </Panel>
      )}

      {tab === "booking" && (
        <Panel>
          <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={!!s.booking_enabled} onCheckedChange={(v) => set("booking_enabled", v)} />Take bookings online</label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Opens (hour)"><input className="fi" inputMode="numeric" value={s.open_hour ?? 8} onChange={(e) => set("open_hour", e.target.value)} /></Field>
            <Field label="Closes (hour)"><input className="fi" inputMode="numeric" value={s.close_hour ?? 17} onChange={(e) => set("close_hour", e.target.value)} /></Field>
            <Field label="Slot length (minutes)"><input className="fi" inputMode="numeric" value={s.slot_minutes ?? 60} onChange={(e) => set("slot_minutes", e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{DAYS.map(([n, l]) => { const on = (s.open_days || []).includes(n); return <button key={n} type="button" onClick={() => set("open_days", on ? s.open_days.filter((x: number) => x !== n) : [...(s.open_days || []), n].sort())} className={`h-8 rounded-xl border px-3 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{l}</button>; })}</div>
          <Field label="Welcome text on the booking page" className="mt-3"><textarea className="fi" rows={2} value={s.booking_intro || ""} onChange={(e) => set("booking_intro", e.target.value)} placeholder="Enter a short welcome (optional)" /></Field>
          <div className="mt-3"><p className="mb-1 text-sm font-medium">Services customers can choose</p><ListEditor items={s.booking_services || []} onChange={(v) => set("booking_services", v)} placeholder="Enter a service (e.g. Full service)" /></div>
        </Panel>
      )}

      {tab === "qc" && <Panel title="Quality check before a car is ready"><ListEditor items={s.qc_checklist || []} onChange={(v) => set("qc_checklist", v)} placeholder="Enter a check" /></Panel>}
      {tab === "checklists" && <Panel><Checklists /></Panel>}
      {tab === "menus" && <Panel description="Service packages per make / model / engine. Adding one to a job adds its labour and parts in one tap."><Menus /></Panel>}
      {tab === "templates" && (
        <Panel description="Templates are saved from a job card (Save as template) and picked at check-in.">
          {!(templates as any[]).length && <p className="text-sm text-muted-foreground">No templates yet. Open a job card and use "Save as template".</p>}
          {(templates as any[]).map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b border-border py-2 text-sm last:border-0">
              <span className="flex-1 font-medium">{t.name}</span><span className="text-xs text-muted-foreground">{(t.lines || []).length} lines</span>
              <button type="button" onClick={async () => { await sb.from("garage_job_templates").delete().eq("id", t.id); void refetchTpl(); }} className="text-xs text-destructive">Delete</button>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
