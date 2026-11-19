import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Plus, Trash2, ArrowRight, ArrowUp, ArrowDown, Save, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, Field, EmptyState, Pill } from "@/components/kit";
import { useModules } from "@/hooks/useModules";
import { useTenantId } from "@/hooks/useTenantId";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FieldDef, FieldType, KindDef, StageDef } from "./types";

import { PagedRows } from "@/components/Pager";
const sb = supabase as any;
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";

const FIELD_TYPES: [FieldType, string][] = [
  ["text", "Text"], ["textarea", "Long text"], ["number", "Number"], ["money", "Money"], ["percent", "Percent"], ["date", "Date"], ["datetime", "Date & time"],
  ["select", "Dropdown"], ["multiselect", "Multiple choice"], ["checkbox", "Yes / no"], ["email", "Email"], ["phone", "Phone"], ["url", "Link"], ["rating", "Rating"],
  ["customer", "Customer"], ["supplier", "Supplier"], ["employee", "Employee"], ["product", "Item"], ["user", "Staff member"], ["lines", "Table of lines"], ["signature", "Signature"],
];
const TONES: StageDef["tone"][] = ["slate", "blue", "amber", "violet", "green", "red", "cyan", "pink"];
/** Fields that map to native columns (sortable, filterable, used by the calendar). */
const NATIVE: Partial<Record<FieldType, FieldDef["column"]>> = { customer: "customer_id", supplier: "supplier_id", employee: "employee_id", product: "product_id", user: "assigned_to" };

interface Draft { id?: string; app_key: string; name: string; color: string; kinds: KindDef[] }

const blankKind = (label = "Record"): KindDef => ({
  key: slug(label), label, plural: `${label}s`, prefix: `${label.slice(0, 3).toUpperCase()}-`, titleLabel: "Name", views: ["list", "kanban"],
  stages: [{ key: "new", label: "New", tone: "blue" }, { key: "in_progress", label: "In progress", tone: "amber" }, { key: "done", label: "Done", tone: "green", done: true }],
  fields: [{ key: "notes", label: "Notes", type: "textarea" }],
});

/** Gives each field a native column where one fits (first date → starts_at, first money → amount…). */
function normalize(kind: KindDef): KindDef {
  const used = new Set<string>();
  const fields = kind.fields.map((f) => {
    const out: FieldDef = { ...f, key: f.key || slug(f.label) };
    let col = NATIVE[f.type];
    if (!col && (f.type === "date" || f.type === "datetime")) col = used.has("starts_at") ? (used.has("due_date") ? undefined : "due_date") : "starts_at";
    if (!col && f.type === "money") col = used.has("amount") ? undefined : "amount";
    if (!col && f.type === "number") col = used.has("quantity") ? undefined : "quantity";
    if (col === "due_date" && f.type === "datetime") col = undefined;
    if (col && !used.has(col)) { used.add(col); out.column = col; } else delete out.column;
    return out;
  });
  return { ...kind, key: kind.key || slug(kind.label), fields };
}

export default function Studio() {
  const { has } = useModules();
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data: apps = [] } = useQuery({
    queryKey: ["app-definitions", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("app_definitions").select("*").order("name")).data || [],
  });

  if (!has("studio")) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Blocks className="h-8 w-8" /></span>
        <h1 className="mt-4 font-display text-2xl font-bold">Build your own apps with Studio</h1>
        <p className="mt-2 text-muted-foreground">Design record types, fields, stages and views for anything your business tracks: no code. They appear in your menu like every other app.</p>
        <Link to="/modules?app=studio" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Try Studio free for 14 days</Link>
      </div>
    );
  }

  const save = async () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) return toast.error("Name the app");
    if (!draft.kinds.length) return toast.error("Add at least one record type");
    const kinds = draft.kinds.map(normalize);
    const keys = kinds.map((k) => k.key);
    if (new Set(keys).size !== keys.length) return toast.error("Two record types have the same name");
    const row = { app_key: draft.app_key || slug(draft.name), name: draft.name.trim(), color: draft.color, definition: { kinds }, updated_at: new Date().toISOString() };
    const { error } = draft.id ? await sb.from("app_definitions").update(row).eq("id", draft.id) : await sb.from("app_definitions").insert(row);
    if (error) return toast.error(friendlyError(error));
    void qc.invalidateQueries({ queryKey: ["app-definitions"] }); void qc.invalidateQueries({ queryKey: ["app-definition"] }); void qc.invalidateQueries({ queryKey: ["app-definitions-nav"] });
    toast.success(`${row.name} saved`, { action: { label: "Open", onClick: () => nav(`/apps/studio:${row.app_key}`) } });
    setDraft(null);
  };
  const remove = async (a: any) => {
    if (!(await confirmAction({ title: `Delete ${a.name}?`, message: "Its records are archived, not deleted. Recreate the app with the same name to see them again.", danger: true, confirmLabel: "Delete" }))) return;
    await sb.from("app_definitions").delete().eq("id", a.id);
    void qc.invalidateQueries({ queryKey: ["app-definitions"] });
  };

  if (draft) return <Builder draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Studio" icon={Blocks} description="Build apps for anything your business tracks: inspections, orders, members, properties, cases…"
        actions={<button onClick={() => setDraft({ app_key: "", name: "", color: "#a8121b", kinds: [blankKind("Record")] })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> New app</button>} />
      {!(apps as any[]).length ? (
        <Panel><EmptyState icon={Blocks} title="No custom apps yet" description="Start with a name, then add record types, fields and stages." /></Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <PagedRows rows={(apps as any[])} gridSpan>{(pageRows) => pageRows.map((a) => (
            <div key={a.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: a.color || "#a8121b" }}>{a.name[0]}</span>
                <div className="min-w-0 flex-1"><p className="font-display font-bold">{a.name}</p><p className="text-xs text-muted-foreground">{(a.definition?.kinds || []).map((k: KindDef) => k.plural).join(" · ")}</p></div>
              </div>
              <div className="mt-4 flex gap-2">
                <Link to={`/apps/studio:${a.app_key}`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground">Open <ArrowRight className="h-4 w-4" /></Link>
                <button onClick={() => setDraft({ id: a.id, app_key: a.app_key, name: a.name, color: a.color || "#a8121b", kinds: a.definition?.kinds || [] })} className="rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">Edit</button>
                <button onClick={() => void remove(a)} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}</PagedRows>
        </div>
      )}
    </div>
  );
}

function Builder({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const [ki, setKi] = useState(0);
  const kind = draft.kinds[ki];
  const setKind = (k: KindDef) => setDraft({ ...draft, kinds: draft.kinds.map((x, i) => (i === ki ? k : x)) });
  const setField = (i: number, f: Partial<FieldDef>) => setKind({ ...kind, fields: kind.fields.map((x, j) => (j === i ? { ...x, ...f } : x)) });
  const move = (i: number, d: number) => { const f = [...kind.fields]; const [x] = f.splice(i, 1); f.splice(i + d, 0, x); setKind({ ...kind, fields: f }); };
  const setStage = (i: number, s: Partial<StageDef>) => setKind({ ...kind, stages: (kind.stages || []).map((x, j) => (j === i ? { ...x, ...s } : x)) });
  return (
    <div className="space-y-5">
      <PageHeader title={draft.id ? `Edit ${draft.name}` : "New app"} icon={Blocks}
        actions={<><button onClick={onCancel} className="rounded-xl border border-border px-4 py-2 text-sm">Cancel</button><button onClick={onSave} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Save className="h-4 w-4" /> Save app</button></>} />
      <Panel title="App">
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="App name" required><input className="fi" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value, app_key: draft.id ? draft.app_key : slug(e.target.value) })} placeholder="e.g. Property Management" /></Field>
          <Field label="Colour"><input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-input bg-background p-1" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></Field>
        </div>
        {draft.id && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" /> Address: /apps/studio:{draft.app_key}</p>}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        {draft.kinds.map((k, i) => (
          <button key={i} onClick={() => setKi(i)} className={cn("rounded-full px-4 py-2 text-sm font-semibold", i === ki ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70")}>{k.plural || "Record type"}</button>
        ))}
        <button onClick={() => { setDraft({ ...draft, kinds: [...draft.kinds, blankKind(`Type ${draft.kinds.length + 1}`)] }); setKi(draft.kinds.length); }} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-4 py-2 text-sm"><Plus className="h-4 w-4" /> Record type</button>
      </div>

      {kind && (
        <>
          <Panel title="Record type" actions={draft.kinds.length > 1 && <button onClick={() => { setDraft({ ...draft, kinds: draft.kinds.filter((_, i) => i !== ki) }); setKi(0); }} className="text-sm text-destructive">Remove</button>}>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Singular"><input className="fi" value={kind.label} onChange={(e) => setKind({ ...kind, label: e.target.value, key: draft.id ? kind.key : slug(e.target.value) })} /></Field>
              <Field label="Plural"><input className="fi" value={kind.plural} onChange={(e) => setKind({ ...kind, plural: e.target.value })} /></Field>
              <Field label="Name field label"><input className="fi" value={kind.titleLabel || ""} onChange={(e) => setKind({ ...kind, titleLabel: e.target.value })} /></Field>
              <Field label="Number prefix" hint="Empty: no numbers"><input className="fi" value={kind.prefix || ""} onChange={(e) => setKind({ ...kind, prefix: e.target.value.toUpperCase() })} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {(["list", "kanban", "calendar"] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-2"><input type="checkbox" checked={(kind.views || []).includes(v)} onChange={(e) => setKind({ ...kind, views: e.target.checked ? [...(kind.views || []), v] : (kind.views || []).filter((x) => x !== v) })} /> {v[0].toUpperCase() + v.slice(1)} view</label>
              ))}
            </div>
          </Panel>

          <Panel title="Fields" flush>
            <div className="overflow-x-auto">
              <table className="dt dt-keep min-w-[760px]">
                <thead><tr><th>Label</th><th>Type</th><th>Choices (dropdowns)</th><th>In list</th><th>Required</th><th>Half width</th><th /></tr></thead>
                <tbody>
                  {kind.fields.map((f, i) => (
                    <tr key={i}>
                      <td className="!py-1.5"><input className="fi h-9" value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: draft.id && f.key ? f.key : slug(e.target.value) })} /></td>
                      <td className="!py-1.5"><select className="fi h-9" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType, lineFields: e.target.value === "lines" ? [{ key: "item", label: "Item", type: "text" }, { key: "qty", label: "Qty", type: "number" }, { key: "amount", label: "Amount", type: "money" }] : undefined })}>{FIELD_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></td>
                      <td className="!py-1.5">{(f.type === "select" || f.type === "multiselect") ? <input className="fi h-9" value={(f.options || []).join(", ")} onChange={(e) => setField(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Option 1, Option 2" /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      <td className="text-center"><input type="checkbox" checked={!!f.list} onChange={(e) => setField(i, { list: e.target.checked })} /></td>
                      <td className="text-center"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} /></td>
                      <td className="text-center"><input type="checkbox" checked={!!f.half} onChange={(e) => setField(i, { half: e.target.checked })} /></td>
                      <td className="whitespace-nowrap text-right">
                        <button disabled={i === 0} onClick={() => move(i, -1)} className="icon-btn"><ArrowUp className="h-4 w-4" /></button>
                        <button disabled={i === kind.fields.length - 1} onClick={() => move(i, 1)} className="icon-btn"><ArrowDown className="h-4 w-4" /></button>
                        <button onClick={() => setKind({ ...kind, fields: kind.fields.filter((_, j) => j !== i) })} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setKind({ ...kind, fields: [...kind.fields, { key: `field_${kind.fields.length + 1}`, label: `Field ${kind.fields.length + 1}`, type: "text", list: true, half: true }] })} className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm font-medium text-primary hover:bg-primary/5"><Plus className="h-4 w-4" /> Add field</button>
          </Panel>

          <Panel title="Stages" description="The status bar and the kanban columns. Leave empty for records without a status.">
            <div className="space-y-2">
              {(kind.stages || []).map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className="fi h-9 w-48" value={s.label} onChange={(e) => setStage(i, { label: e.target.value, key: slug(e.target.value) })} />
                  <select className="fi h-9 w-32" value={s.tone} onChange={(e) => setStage(i, { tone: e.target.value as StageDef["tone"] })}>{TONES.map((t) => <option key={t}>{t}</option>)}</select>
                  <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!s.done} onChange={(e) => setStage(i, { done: e.target.checked })} /> Closed stage</label>
                  <button onClick={() => setKind({ ...kind, stages: (kind.stages || []).filter((_, j) => j !== i) })} className="icon-btn-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button onClick={() => setKind({ ...kind, stages: [...(kind.stages || []), { key: `stage_${(kind.stages || []).length + 1}`, label: "Stage", tone: "slate" }] })} className="inline-flex items-center gap-1 text-sm font-medium text-primary"><Plus className="h-4 w-4" /> Add stage</button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground"><Pill>Tip</Pill> Customer, Supplier, Employee, Item and Staff fields link to your real records; the first Date field drives the calendar.</p>
          </Panel>
        </>
      )}
    </div>
  );
}
