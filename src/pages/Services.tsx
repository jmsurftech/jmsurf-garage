import { PageHeader, PageLoader, Toolbar, SearchBox, Panel, TableWrap, EmptyState, Field, Modal, StatTile, StatGrid } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useBusinessSettings } from "@/hooks/useData";
import { useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { Plus, Edit, Trash2, Save, Wrench, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { formatKES, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const sb: any = supabase;
      const { data, error } = await sb.from("services").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data as any[];
    },
  });
}

interface ServiceFormData {
  name: string; description: string; price: string; cost_price: string;
  category: string; vat_rate: string;
}

export function ServiceFormModal({ service, onClose }: { service?: any; onClose: () => void }) {
  const isEdit = !!service;
  const { toast } = useToast();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data: invSettings } = useInventorySettings();
  const { data: biz } = useBusinessSettings();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ServiceFormData>({
    name: service?.name || "",
    description: service?.description || "",
    price: service ? String(service.price) : "",
    cost_price: service ? String(service.cost_price) : "0",
    category: service?.category || "General",
    vat_rate: service ? String(service.vat_rate ?? 0) : String((biz as any)?.default_vat_rate ?? 16),
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && !profile?.tenant_id) {
      toast({ title: "Workspace not ready", description: "Please refresh and try again.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const sb: any = supabase;
    const payload: any = {
      name: form.name, description: form.description,
      price: parseFloat(form.price) || 0,
      cost_price: parseFloat(form.cost_price) || 0,
      category: form.category,
      vat_rate: Number.isFinite(parseFloat(form.vat_rate)) ? Math.max(0, parseFloat(form.vat_rate)) : 0,
    };
    if (!isEdit) payload.tenant_id = profile?.tenant_id;
    const { error } = isEdit
      ? await sb.from("services").update(payload).eq("id", service.id)
      : await sb.from("services").insert(payload);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["services"] });
    toast({ title: isEdit ? "Service updated" : "Service added" });
    onClose();
  };

  const categories = invSettings?.categories || ["General"];

  const price = parseFloat(form.price) || 0;
  const cost = parseFloat(form.cost_price) || 0;
  return (
    <Modal open onClose={onClose} locked={saving} icon={Wrench} title={isEdit ? "Edit service" : "Add a service"}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="service-form" disabled={saving}><Save /> {saving ? "Saving…" : isEdit ? "Save changes" : "Add service"}</Button>
      </>}>
      <form id="service-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name" required className="sm:col-span-2"><input required value={form.name} onChange={(e) => set("name", e.target.value)} className="fi" autoFocus /></Field>
        <Field label="Description" hint="Optional" className="sm:col-span-2"><textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="fi" /></Field>
        <Field label={`Price (${currencyCode()})`} required><input required type="number" step="0.01" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} className="fi" /></Field>
        <Field label={`Cost to you (${currencyCode()})`} hint={price > 0 ? `Margin ${(((price - cost) / price) * 100).toFixed(0)}%` : undefined}><input type="number" step="0.01" min="0" value={form.cost_price} onChange={(e) => set("cost_price", e.target.value)} className="fi" /></Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className="fi">
            <option value="General">General</option>
            {categories.filter((c) => c !== "General").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="VAT / tax (%)"><input type="number" step="0.01" min="0" max="100" value={form.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} className="fi" /></Field>
      </form>
    </Modal>
  );
}

export default function Services() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editService, setEditService] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const { data: services = [], isLoading } = useServices();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("services_delete");

  const filtered = useMemo(() =>
    services.filter((s: any) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase())
    ), [services, search]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const sb: any = supabase;
    const { error } = await sb.from("services").update({ is_active: false }).eq("id", deleteTarget.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Service deleted" }); qc.invalidateQueries({ queryKey: ["services"] }); }
    setDeleteTarget(null);
  };

  if (isLoading) return <PageLoader />;

  const openNew = () => { setEditService(null); setShowForm(true); };
  const avgMargin = services.length ? services.reduce((a: number, x: any) => a + (Number(x.price) > 0 ? (Number(x.price) - Number(x.cost_price || 0)) / Number(x.price) : 0), 0) / services.length * 100 : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Services" icon={Wrench} description="Work you charge for that isn't stock — repairs, labour, delivery and so on."
        actions={<Button onClick={openNew}><Plus /> Add service</Button>} />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Services" value={services.length} icon={Wrench} tone="primary" />
        <StatTile label="Average margin" value={`${avgMargin.toFixed(0)}%`} icon={TrendingUp} tone="success" />
        <StatTile label="Categories" value={new Set(services.map((x: any) => x.category)).size} icon={Wrench} tone="muted" className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Service or category…" /></Toolbar>

      <Panel flush>
        {filtered.length === 0 ? (
          <EmptyState icon={Wrench} title={services.length ? "No services match" : "No services yet"}
            description={services.length ? undefined : "Add services to sell them from the till and put them on quotes and invoices."}
            action={!services.length ? <Button onClick={openNew}><Plus /> Add service</Button> : undefined} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Service</th><th className="hidden sm:table-cell">Category</th><th className="num">Price</th><th className="num hidden md:table-cell">Margin</th><th className="text-center hidden md:table-cell">VAT</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={6}>{(pageRows) => pageRows.map((sv: any) => {
                  const pr = Number(sv.price) || 0; const m = pr > 0 ? ((pr - Number(sv.cost_price || 0)) / pr) * 100 : 0;
                  return (
                    <tr key={sv.id}>
                      <td><p className="font-medium">{sv.name}</p>{sv.description && <p className="max-w-[260px] truncate text-xs text-muted-foreground">{sv.description}</p>}</td>
                      <td className="hidden text-muted-foreground sm:table-cell">{sv.category}</td>
                      <td className="num font-semibold">{formatKES(pr)}</td>
                      <td className={`num hidden md:table-cell ${m < 10 ? "text-warning" : "text-success"}`}>{m.toFixed(0)}%</td>
                      <td className="hidden text-center text-muted-foreground md:table-cell">{Number(sv.vat_rate ?? 0)}%</td>
                      <td>
                        <div className="flex justify-end gap-0.5">
                          <button className="icon-btn" onClick={() => { setEditService(sv); setShowForm(true); }} title="Edit"><Edit className="h-4 w-4" /></button>
                          {canDelete && <button className="icon-btn-danger" onClick={() => setDeleteTarget(sv)} title="Delete"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      {showForm && <ServiceFormModal service={editService} onClose={() => { setShowForm(false); setEditService(null); }} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.name}" will be removed from active services. This can be undone by an admin.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
