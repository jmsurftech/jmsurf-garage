import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field, Modal, Panel, Pill, Segmented } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/books/confirm";
import { useTenantId } from "@/hooks/useTenantId";
import { friendlyError } from "@/lib/friendlyError";
import { CUSTOM_ENTITIES, type CustomEntity, type CustomField } from "@/lib/customFields";

const sb: any = supabase;
const TYPES: [CustomField["field_type"], string][] = [["text", "Text"], ["number", "Number"], ["date", "Date"], ["dropdown", "Dropdown"], ["checkbox", "Yes / no"]];
const PRINTED: CustomEntity[] = ["quote", "sales_order", "invoice", "purchase_order", "bill"];

/** System → Custom fields: a company's own fields on customers, suppliers, items and documents. */
export default function CustomFieldsTab({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<CustomEntity>("customer");
  const [editing, setEditing] = useState<Partial<CustomField> | null>(null);
  const q = useQuery({
    queryKey: ["custom-fields", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("custom_fields").select("*").eq("tenant_id", tenantId).order("sort").order("created_at")).data || []) as CustomField[],
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["custom-fields", tenantId] });
  const fields = (q.data || []).filter((f) => f.entity === entity);
  if (q.isLoading) return <OrbLoader label="Loading custom fields…" />;

  const save = async () => {
    const f = editing!;
    const label = (f.label || "").trim();
    if (!label) return toast.error("Give the field a name");
    const options = f.field_type === "dropdown" ? (f.options || []).map((o) => o.trim()).filter(Boolean) : [];
    if (f.field_type === "dropdown" && !options.length) return toast.error("Add at least one choice");
    const row = { label, field_type: f.field_type, options, required: !!f.required, show_on_pdf: !!f.show_on_pdf && PRINTED.includes(entity), is_active: f.is_active !== false };
    const { error } = f.id
      ? await sb.from("custom_fields").update(row).eq("id", f.id)
      : await sb.from("custom_fields").insert({ ...row, tenant_id: tenantId, entity, sort: fields.length ? Math.max(...fields.map((x) => x.sort)) + 1 : 0 });
    if (error) return toast.error(friendlyError(error));
    setEditing(null); void refresh();
  };
  const remove = async (f: CustomField) => {
    if (!(await confirmAction({ title: `Delete "${f.label}"?`, message: "It disappears from every form and document, and what was typed into it can no longer be seen.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("custom_fields").delete().eq("id", f.id);
    if (error) return toast.error(friendlyError(error));
    void refresh();
  };
  const move = async (i: number, by: number) => {
    const next = [...fields];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    await Promise.all(next.map((f, sort) => (f.sort === sort ? null : sb.from("custom_fields").update({ sort }).eq("id", f.id))));
    void refresh();
  };

  return (
    <Panel title="Custom fields" icon={SlidersHorizontal}
      actions={canManage && <Button size="sm" onClick={() => setEditing({ field_type: "text", options: [], required: false, show_on_pdf: false, is_active: true })}><Plus /> New field</Button>}>
      <Segmented value={entity} onChange={(v) => setEntity(v as CustomEntity)} options={CUSTOM_ENTITIES} />
      {fields.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No custom fields here yet.</p> : (
        <table className="dt mt-2">
          <thead><tr><th>Name</th><th>Type</th><th>Options</th><th /></tr></thead>
          <tbody>{fields.map((f, i) => (
            <tr key={f.id} className={f.is_active ? "" : "opacity-60"}>
              <td className="font-medium">{f.label}</td>
              <td>{TYPES.find(([k]) => k === f.field_type)?.[1]}</td>
              <td><span className="flex flex-wrap gap-1">
                {f.required && <Pill tone="warning">Required</Pill>}
                {f.show_on_pdf && <Pill tone="info">Printed</Pill>}
                {!f.is_active && <Pill>Off</Pill>}
              </span></td>
              <td className="text-right">{canManage && <span className="inline-flex gap-0.5">
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                <button className="icon-btn" title="Move down" disabled={i === fields.length - 1} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                <button className="icon-btn" title="Edit" onClick={() => setEditing({ ...f })}><Pencil className="h-4 w-4" /></button>
                <button className="icon-btn" title="Delete" onClick={() => void remove(f)}><Trash2 className="h-4 w-4" /></button>
              </span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit field" : "New field"} icon={SlidersHorizontal}
          footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Name" required><input className="fi" autoFocus value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
            <Field label="Type">
              <select className="fi" value={editing.field_type} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, field_type: e.target.value as CustomField["field_type"] })}>
                {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            {editing.field_type === "dropdown" && (
              <Field label="Choices, one on each line">
                <textarea className="fi" rows={4} value={(editing.options || []).join("\n")} onChange={(e) => setEditing({ ...editing, options: e.target.value.split("\n") })} />
              </Field>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!editing.required} onChange={(e) => setEditing({ ...editing, required: e.target.checked })} /> Required</label>
              {PRINTED.includes(entity) && <label className="flex items-center gap-2"><input type="checkbox" checked={!!editing.show_on_pdf} onChange={(e) => setEditing({ ...editing, show_on_pdf: e.target.checked })} /> Print on the document</label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.is_active !== false} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> In use</label>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
