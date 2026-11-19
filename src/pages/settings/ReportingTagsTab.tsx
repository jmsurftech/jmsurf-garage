/** System → Reporting tags: a company's own dimensions (e.g. Region, Project line) for documents and reports. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tags, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { Panel, Pill, EmptyState, Modal, Field, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/books/confirm";
import { friendlyError } from "@/lib/friendlyError";
import { TAG_MODULES, useReportingTags, type ReportingTag, type TagMode, type TagModule } from "@/lib/reportingTags";

const sb: any = supabase;
type Draft = { id?: string; name: string; options: string; modules: Partial<Record<TagModule, TagMode>>; is_active: boolean; sort: number };
const blank = (): Draft => ({ name: "", options: "", modules: { invoices: "optional", bills: "optional", expenses: "optional", journals: "optional", credit_notes: "optional" }, is_active: true, sort: 0 });

export default function ReportingTagsTab({ canManage }: { canManage: boolean }) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useReportingTags();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["reporting-tags"] });

  const open = (t?: ReportingTag) => setEdit(t ? { id: t.id, name: t.name, options: (t.options || []).join("\n"), modules: t.modules || {}, is_active: t.is_active, sort: t.sort } : { ...blank(), sort: tags.length });
  const save = async () => {
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) return toast.error("Enter the tag name");
    const options = [...new Set(edit.options.split(/\n|,/).map((x) => x.trim()).filter(Boolean))].slice(0, 200);
    if (!options.length) return toast.error("Add at least one value");
    const modules = Object.fromEntries(Object.entries(edit.modules).filter(([, m]) => m === "optional" || m === "mandatory"));
    setBusy(true);
    const row = { name, options, modules, is_active: edit.is_active, sort: edit.sort, updated_at: new Date().toISOString() };
    const { error } = edit.id ? await sb.from("reporting_tags").update(row).eq("id", edit.id) : await sb.from("reporting_tags").insert({ ...row, tenant_id: tenantId });
    setBusy(false);
    if (error) return toast.error(/duplicate|unique/i.test(error.message) ? "You already have a tag with that name" : friendlyError(error));
    toast.success("Tag saved"); setEdit(null); void refresh();
  };
  const remove = async (t: ReportingTag) => {
    if (!(await confirmAction({ title: `Delete ${t.name}?`, message: "Documents keep the values already chosen, but you can no longer pick or report on this tag. Switch it off instead to hide it.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("reporting_tags").delete().eq("id", t.id);
    if (error) return toast.error(friendlyError(error));
    void refresh();
  };

  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-5">
      <Panel title="Reporting tags" icon={Tags} description="Tag invoices, bills, expenses, journals and credit notes with your own values, e.g. Region: Nairobi or Mombasa. Then filter and group the profit and loss and your lists by them."
        actions={canManage && <Button size="sm" onClick={() => open()}><Plus /> New tag</Button>} flush>
        {!tags.length ? (
          <EmptyState icon={Tags} title="No reporting tags yet" description="For example Region (Nairobi, Mombasa, Kisumu) or Project line." action={canManage && <Button onClick={() => open()}><Plus /> New tag</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {tags.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">{t.name}{!t.is_active && <Pill>Off</Pill>}</p>
                  <p className="truncate text-xs text-muted-foreground">{(t.options || []).join(" · ")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {TAG_MODULES.filter((m) => t.modules?.[m.value]).map((m) => <Pill key={m.value} tone={t.modules[m.value] === "mandatory" ? "warning" : "info"}>{m.label}{t.modules[m.value] === "mandatory" ? " · required" : ""}</Pill>)}
                  </div>
                </div>
                {canManage && <>
                  <button className="icon-btn" title="Edit" onClick={() => open(t)}><Pencil className="h-4 w-4" /></button>
                  <button className="icon-btn-danger" title="Delete" onClick={() => void remove(t)}><Trash2 className="h-4 w-4" /></button>
                </>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {edit && (
        <Modal open onClose={() => setEdit(null)} locked={busy} icon={Tags} title={edit.id ? "Edit tag" : "New tag"}
          footer={<><Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Tag name" required><input className="fi" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Region" /></Field>
            <Field label="Values" required hint="One per line"><textarea className="fi min-h-[110px]" value={edit.options} onChange={(e) => setEdit({ ...edit, options: e.target.value })} placeholder={"Nairobi\nMombasa\nKisumu"} /></Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Use on</p>
              <div className="divide-y divide-border rounded-xl border border-border">
                {TAG_MODULES.map((m) => (
                  <div key={m.value} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1">{m.label}</span>
                    <select className="fi h-9 w-40" value={edit.modules[m.value] || ""} onChange={(e) => setEdit({ ...edit, modules: { ...edit.modules, [m.value]: (e.target.value || undefined) as TagMode | undefined } })}>
                      <option value="">Not used</option><option value="optional">Optional</option><option value="mandatory">Required</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> On (shown on forms)</label>
          </div>
        </Modal>
      )}
    </div>
  );
}
