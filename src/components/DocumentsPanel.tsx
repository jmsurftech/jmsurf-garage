import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Eye, Trash2, CheckCircle2, Circle, Pencil, FileWarning, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";
import { fmtDate } from "@/lib/doc-pdf";
import { viewDocument } from "@/components/DocViewer";


const sb: any = supabase;
export type DocRow = { folder_id?: string | null; id: string; entity_type: string; entity_id: string | null; entity_name: string | null; name: string; category: string | null; path: string | null; url: string | null; mime_type: string | null; size_bytes: number | null; expires_on: string | null; notes: string | null; uploaded_by_name: string | null; created_at: string; shared_with_customer?: boolean | null };

/** Documents a supplier is asked for during onboarding (Kenya). */
export const SUPPLIER_DOCS = ["KRA PIN certificate", "Certificate of incorporation / business registration", "Single business permit", "Tax compliance certificate", "CR12 (directors)", "Bank details letter", "Director's ID copy"];
export const CUSTOMER_DOCS = ["KRA PIN certificate", "ID / passport copy", "Certificate of incorporation", "Credit application form", "Signed agreement"];
export const EMPLOYEE_DOCS = ["Employment contract", "ID copy", "KRA PIN certificate", "NSSF card", "SHA card", "Academic certificates", "Certificate of good conduct", "Bank details"];

/** Uploads a file to the private documents store and records it. */
export async function uploadDocument(tenantId: string, file: File, meta: { entity_type: string; entity_id?: string | null; entity_name?: string | null; name?: string; category?: string | null; expires_on?: string | null; notes?: string | null; uploaded_by_name?: string | null; folder_id?: string | null }) {
  if (file.size > 20 * 1024 * 1024) throw new Error("Files up to 20 MB");
  const safe = file.name.replace(/[^a-z0-9.]+/gi, "-").toLowerCase();
  const path = `${tenantId}/${meta.entity_type}/${meta.entity_id || "general"}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  const { data, error: e2 } = await sb.from("documents").insert({
    tenant_id: tenantId, entity_type: meta.entity_type, entity_id: meta.entity_id || null, entity_name: meta.entity_name || null,
    name: meta.name || file.name, category: meta.category || null, path, mime_type: file.type || null, size_bytes: file.size,
    expires_on: meta.expires_on || null, notes: meta.notes || null, uploaded_by_name: meta.uploaded_by_name || null, folder_id: meta.folder_id || null,
  }).select("*").single();
  if (e2) throw e2;
  return data as DocRow;
}

/** Opens a stored document in the in-app viewer (with download), using a short-lived link. */
export async function openDocument(d: Pick<DocRow, "path" | "url"> & { name?: string | null; mime_type?: string | null }) {
  if (d.url) return viewDocument({ url: d.url, name: d.name || undefined, mime: d.mime_type });
  if (!d.path) return;
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(d.path, 600);
  if (error || !data?.signedUrl) throw error || new Error("Could not open the file");
  viewDocument({ url: data.signedUrl, name: d.name || d.path.split("/").pop()?.replace(/^\d+-/, ""), mime: d.mime_type });
}

export function useEntityDocuments(entityType: string, entityId?: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["documents", entityType, entityId],
    enabled: !!tenantId && !!entityId,
    queryFn: async () => ((await sb.from("documents").select("*").eq("tenant_id", tenantId).eq("entity_type", entityType).eq("entity_id", entityId).order("created_at", { ascending: false })).data || []) as DocRow[],
  });
}

/** Documents of one customer, supplier or employee, with a checklist of the usual ones. */
export default function DocumentsPanel({ entityType, entityId, entityName, checklist = [], noDelete, shareable }: { entityType: string; entityId: string; entityName: string; checklist?: string[]; /** Staff in My Space add files but cannot delete them. */ noDelete?: boolean; /** Customer page: files can be shared in the customer portal. */ shareable?: boolean }) {
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: docs = [] } = useEntityDocuments(entityType, entityId);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; category: string; expires_on: string; notes: string } | null>(null);
  const [edit, setEdit] = useState<DocRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("");
  const startUpload = (cat: string) => { setCategory(cat); input.current?.click(); };
  const upload = async () => {
    if (!pending || !tenantId) return;
    setBusy(true);
    try {
      await uploadDocument(tenantId, pending.file, { entity_type: entityType, entity_id: entityId, entity_name: entityName, category: pending.category || null, name: pending.category ? `${pending.category} · ${pending.file.name}` : pending.file.name, expires_on: pending.expires_on || null, notes: pending.notes || null, uploaded_by_name: profile?.display_name });
      toast({ title: "Document uploaded" });
      setPending(null);
      qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const remove = async (d: DocRow) => {
    if (!(await confirmAction({ title: `Delete ${d.name}?`, message: "The file is removed for good.", danger: true, confirmLabel: "Delete" }))) return;
    if (d.path) await supabase.storage.from("documents").remove([d.path]);
    const { error } = await sb.from("documents").delete().eq("id", d.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    toast({ title: "Document deleted" });
    qc.invalidateQueries({ queryKey: ["documents"] });
  };
  const saveEdit = async () => {
    if (!edit) return;
    const { error } = await sb.from("documents").update({ name: edit.name, category: edit.category, expires_on: edit.expires_on || null, notes: edit.notes }).eq("id", edit.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Saved" }); setEdit(null); qc.invalidateQueries({ queryKey: ["documents"] });
  };
  const share = async (d: DocRow) => {
    const on = !d.shared_with_customer;
    const { error } = await sb.from("documents").update({ shared_with_customer: on, shared_at: on ? new Date().toISOString() : null }).eq("id", d.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: on ? "Shared: the customer sees it in their portal" : "No longer shared" });
    qc.invalidateQueries({ queryKey: ["documents"] });
  };
  const has = (c: string) => docs.some((d) => d.category === c);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      {checklist.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">Required documents</p><span className="text-xs text-muted-foreground">{checklist.filter(has).length} of {checklist.length}</span></div>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${(checklist.filter(has).length / checklist.length) * 100}%` }} /></div>
          <ul className="grid gap-2 sm:grid-cols-2">{checklist.map((c) => (
            <li key={c} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              {has(c) ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="flex-1">{c}</span>
              {!has(c) && <Button size="sm" variant="ghost" onClick={() => startUpload(c)}><Upload /> Upload</Button>}
            </li>
          ))}</ul>
        </div>
      )}
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">All documents ({docs.length})</p><Button size="sm" onClick={() => startUpload("")}><Upload /> Upload a document</Button></div>
      {docs.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No documents yet.</p> : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.category || "Other"} · {fmtDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}{d.expires_on ? ` · expires ${fmtDate(d.expires_on)}` : ""}</p></div>
            {shareable && d.shared_with_customer && <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Shared with customer</span>}
            {d.expires_on && d.expires_on < today && <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"><FileWarning className="h-3.5 w-3.5" /> Expired</span>}
            <span className="flex gap-1">
              <button className="icon-btn" onClick={() => openDocument(d).catch((e) => toast({ title: "Could not open", description: e.message, variant: "destructive" }))} aria-label="View"><Eye className="h-4 w-4" /></button>
              {shareable && <button className={d.shared_with_customer ? "icon-btn text-success" : "icon-btn"} onClick={() => void share(d)} aria-label={d.shared_with_customer ? "Stop sharing with the customer" : "Share with the customer"} title={d.shared_with_customer ? "Stop sharing with the customer" : "Share with the customer (portal)"}><Share2 className="h-4 w-4" /></button>}
              <button className="icon-btn" onClick={() => setEdit(d)} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              {!noDelete && <button className="icon-btn-danger" onClick={() => remove(d)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
            </span>
          </li>
        ))}</ul>
      )}
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending({ file: f, category, expires_on: "", notes: "" }); e.target.value = ""; }} />
      <Modal open={!!pending} onClose={() => setPending(null)} title="Upload document" description={pending?.file.name} icon={Upload}
        footer={<Button onClick={upload} disabled={busy}>{busy && <OrbSpinner />} Upload</Button>}>
        {pending && <div className="space-y-3">
          <Field label="Type of document"><input className="fi" list="doc-cats" value={pending.category} onChange={(e) => setPending({ ...pending, category: e.target.value })} placeholder="e.g. KRA PIN certificate" /><datalist id="doc-cats">{checklist.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Expires on (optional)" hint="Shown under Expired or expiring on the Documents page, so you renew it in time."><input className="fi" type="date" value={pending.expires_on} onChange={(e) => setPending({ ...pending, expires_on: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="fi" value={pending.notes} onChange={(e) => setPending({ ...pending, notes: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit document" icon={Pencil} footer={<Button onClick={saveEdit}>Save</Button>}>
        {edit && <div className="space-y-3">
          <Field label="Name"><input className="fi" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Type"><input className="fi" value={edit.category || ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
          <Field label="Expires on"><input className="fi" type="date" value={edit.expires_on || ""} onChange={(e) => setEdit({ ...edit, expires_on: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="fi" value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

export const docEntityLabel: Record<string, string> = { contract: "Contract", customer: "Customer", supplier: "Supplier", employee: "Employee", leave: "Leave", expense: "Expense", general: "Company", invoice: "Invoice", bill: "Bill", purchase_order: "Purchase order", quote: "Quote", sales_order: "Sales order", credit_note: "Credit note", vendor_credit: "Vendor credit", journal: "Journal", project: "Project", applicant: "Candidate", hr_registration: "Staff registration" };
