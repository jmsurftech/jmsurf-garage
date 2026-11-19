import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen, Folder, FolderPlus, Upload, Search, Eye, Trash2, FileText, FileWarning, Users, Truck, Pencil, ChevronRight, ArrowLeft,
  UserRound, CalendarOff, Wallet, FileCheck, Receipt, ShoppingCart, Package, Building2, CreditCard, LayoutGrid, Files, FileSignature, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap, Segmented } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import ImportExport from "@/components/ImportExport";
import { confirmAction } from "@/components/books/confirm";
import { uploadDocument, openDocument, docEntityLabel, type DocRow } from "@/components/DocumentsPanel";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";

const sb: any = supabase;

/** The modules whose records carry files, as in the Documents "By module" view. */
const MODULES: { key: string; label: string; description: string; icon: LucideIcon; link?: (id: string) => string }[] = [
  { key: "contract", label: "Contracts", description: "Contracts, signed copies and amendments: a folder per contract", icon: FileSignature, link: (id) => `/contracts/${id}` },
  { key: "customer", label: "Customers", description: "KYC, agreements and correspondence", icon: Users, link: (id) => `/customers/${id}` },
  { key: "supplier", label: "Suppliers", description: "Registration and onboarding papers", icon: Truck, link: (id) => `/purchases/suppliers?open=${id}` },
  { key: "employee", label: "Employees", description: "Contracts, IDs and certificates", icon: UserRound, link: (id) => `/hrm/employees/${id}` },
  { key: "leave", label: "Leave", description: "Sick notes and leave attachments", icon: CalendarOff, link: () => "/hrm/leave" },
  { key: "expense", label: "Expenses", description: "Receipts for recorded expenses", icon: Wallet, link: () => "/purchases/expenses" },
  { key: "invoice", label: "Invoices", description: "Attachments on invoices", icon: FileCheck, link: (id) => `/sales/invoices/${id}` },
  { key: "bill", label: "Bills", description: "Supplier invoices and receipts", icon: Receipt, link: (id) => `/purchases/bills/${id}` },
  { key: "purchase_order", label: "Purchase orders", description: "Quotes and documents on orders", icon: ShoppingCart, link: (id) => `/purchases/orders/${id}` },
  { key: "product", label: "Items", description: "Item sheets and images", icon: Package, link: (id) => `/inventory/products/${id}` },
  { key: "transaction", label: "Sales receipts", description: "Files attached to till sales", icon: CreditCard },
  { key: "general", label: "Company", description: "Permits, leases, insurance and other company papers", icon: Building2 },
];

type Folder = { id: string; parent_id: string | null; name: string };

/** Every file in the business, organised by module and in the company's own folders. */
export default function Documents() {
  const tenantId = useTenantId();
  const [tab, setTab] = useState<"modules" | "folders" | "all">("modules");
  const { data = [], isLoading } = useQuery({
    queryKey: ["documents", "all", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("documents").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000)).data || []) as DocRow[],
  });
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  if (isLoading) return <OrbLoader label="Loading documents…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Documents" icon={FolderOpen} description="Every file in the business, by module and record, and in your own folders."
        actions={<ImportExport entity="documents" rows={data.map((d) => ({ name: d.name, type: d.category, belongs_to: `${docEntityLabel[d.entity_type] || d.entity_type}: ${d.entity_name || ""}`, uploaded: d.created_at.slice(0, 10), uploaded_by: d.uploaded_by_name, expires: d.expires_on }))} />} />
      <StatGrid>
        <StatTile label="Documents" value={data.length} icon={FileText} tone="primary" />
        <StatTile label="Contracts" value={data.filter((d) => d.entity_type === "contract").length} icon={FileSignature} tone="info" />
        <StatTile label="Customers & staff" value={data.filter((d) => ["customer", "employee"].includes(d.entity_type)).length} icon={Users} tone="success" />
        <StatTile label="Expired or expiring" value={data.filter((d) => d.expires_on && d.expires_on <= soon).length} icon={FileWarning} tone="danger" />
      </StatGrid>
      <Segmented value={tab} onChange={(v) => setTab(v as any)} options={[
        { value: "modules", label: <><LayoutGrid className="h-4 w-4" /> By module</> },
        { value: "folders", label: <><Folder className="h-4 w-4" /> My folders</> },
        { value: "all", label: <><Files className="h-4 w-4" /> All files</> },
      ]} />
      {tab === "modules" ? <ModulesTab docs={data} /> : tab === "folders" ? <FoldersTab docs={data} /> : <AllFiles docs={data} />}
    </div>
  );
}

/* ------------------------------------------------------------- shared bits */

function useDocActions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["documents"] });
  const view = (d: DocRow) => openDocument(d).catch((e) => toast({ title: "Could not open", description: e.message, variant: "destructive" }));
  const remove = async (d: DocRow) => {
    if (!(await confirmAction({ title: `Delete ${d.name}?`, message: "The file is removed for good.", danger: true, confirmLabel: "Delete" }))) return;
    if (d.path) await supabase.storage.from("documents").remove([d.path]);
    const { error } = await sb.from("documents").delete().eq("id", d.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    toast({ title: "Document deleted" }); refresh();
  };
  return { view, remove, refresh, toast };
}

const size = (b?: number | null) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

function FileRows({ rows, onEdit, showOwner }: { rows: DocRow[]; onEdit: (d: DocRow) => void; showOwner?: boolean }) {
  const { view, remove } = useDocActions();
  const today = new Date().toISOString().slice(0, 10);
  const paged = usePaged(rows, 20);
  if (!rows.length) return <EmptyState icon={FileText} title="No files here yet" />;
  return (
    <>
      <TableWrap><table className="dt">
        <thead><tr><th>Document</th>{showOwner && <th className="hidden md:table-cell">Belongs to</th>}<th className="hidden sm:table-cell">Uploaded</th><th className="hidden lg:table-cell">Expires</th><th /></tr></thead>
        <tbody>{paged.rows.map((d: DocRow) => {
          const to = d.entity_id ? MODULES.find((m) => m.key === d.entity_type)?.link?.(d.entity_id) : undefined;
          return (
            <tr key={d.id}>
              <td><button onClick={() => void view(d)} className="flex items-center gap-2 text-left"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate font-medium hover:text-primary">{d.name}</span><span className="text-xs text-muted-foreground">{[d.category || "Other", size(d.size_bytes)].filter(Boolean).join(" · ")}</span></span></button></td>
              {showOwner && <td className="hidden md:table-cell">{docEntityLabel[d.entity_type] || d.entity_type}{d.entity_name ? <> · {to ? <Link to={to} className="text-primary hover:underline">{d.entity_name}</Link> : d.entity_name}</> : null}</td>}
              <td className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fmtDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}</td>
              <td className={cn("hidden whitespace-nowrap lg:table-cell", d.expires_on && d.expires_on < today && "font-semibold text-destructive")}>{d.expires_on ? fmtDate(d.expires_on) : "—"}</td>
              <td><span className="flex justify-end gap-1">
                <button className="icon-btn" onClick={() => void view(d)} aria-label="View"><Eye className="h-4 w-4" /></button>
                <button className="icon-btn" onClick={() => onEdit(d)} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                <button className="icon-btn-danger" onClick={() => void remove(d)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </span></td>
            </tr>
          );
        })}</tbody>
      </table></TableWrap>
      <Pager {...paged.pager} />
    </>
  );
}

function EditDoc({ doc, onClose }: { doc: DocRow | null; onClose: () => void }) {
  const { toast, refresh } = useDocActions();
  const [d, setD] = useState<DocRow | null>(doc);
  if (doc && d?.id !== doc.id) setD(doc);
  const save = async () => {
    if (!d) return;
    const { error } = await sb.from("documents").update({ name: d.name, category: d.category, expires_on: d.expires_on || null, notes: d.notes }).eq("id", d.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: "Saved" }); refresh(); onClose();
  };
  return (
    <Modal open={!!doc} onClose={onClose} title="Edit document" icon={Pencil} footer={<Button onClick={save}>Save</Button>}>
      {d && <div className="space-y-3">
        <Field label="Name"><input className="fi" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Type"><input className="fi" value={d.category || ""} onChange={(e) => setD({ ...d, category: e.target.value })} /></Field>
        <Field label="Expires on"><input className="fi" type="date" value={d.expires_on || ""} onChange={(e) => setD({ ...d, expires_on: e.target.value })} /></Field>
        <Field label="Notes"><textarea className="fi" value={d.notes || ""} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
      </div>}
    </Modal>
  );
}

/** Upload button + details dialog, filing into a folder when given. */
function UploadButton({ folderId, label = "Upload" }: { folderId?: string | null; label?: string }) {
  const tenantId = useTenantId();
  const { profile } = useAuth() as any;
  const { toast, refresh } = useDocActions();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; category: string; expires_on: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!pending || !tenantId) return;
    setBusy(true);
    try {
      await uploadDocument(tenantId, pending.file, { entity_type: "general", entity_name: "Company", category: pending.category || null, name: pending.file.name, expires_on: pending.expires_on || null, notes: pending.notes || null, uploaded_by_name: profile?.display_name, folder_id: folderId || null });
      toast({ title: "Document uploaded" }); setPending(null); refresh();
    } catch (e: any) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button onClick={() => input.current?.click()}><Upload /> {label}</Button>
      <input ref={input} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPending({ file: f, category: "", expires_on: "", notes: "" }); e.target.value = ""; }} />
      <Modal open={!!pending} onClose={() => setPending(null)} title="Upload a document" description={pending?.file.name} icon={Upload} footer={<Button onClick={upload} disabled={busy}>{busy && <OrbSpinner />} Upload</Button>}>
        {pending && <div className="space-y-3">
          <Field label="Type"><input className="fi" value={pending.category} onChange={(e) => setPending({ ...pending, category: e.target.value })} placeholder="e.g. Business permit, Lease, Insurance" /></Field>
          <Field label="Expires on"><input className="fi" type="date" value={pending.expires_on} onChange={(e) => setPending({ ...pending, expires_on: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="fi" value={pending.notes} onChange={(e) => setPending({ ...pending, notes: e.target.value })} /></Field>
        </div>}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------- by module */

function ModulesTab({ docs }: { docs: DocRow[] }) {
  const [mod, setMod] = useState<string | null>(null);
  const [rec, setRec] = useState<{ id: string; name: string } | null>(null);
  const [edit, setEdit] = useState<DocRow | null>(null);
  const [q, setQ] = useState("");
  const m = MODULES.find((x) => x.key === mod);
  const inModule = docs.filter((d) => d.entity_type === mod && (mod !== "general" || !d.folder_id));
  const records = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; last: string }>();
    for (const d of inModule) {
      const id = d.entity_id || "none";
      const cur = map.get(id) || { id, name: d.entity_name || (mod === "general" ? "Company files" : "Not linked"), count: 0, last: d.created_at };
      cur.count++; if (d.created_at > cur.last) cur.last = d.created_at;
      map.set(id, cur);
    }
    return [...map.values()].filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  }, [inModule, q, mod]);

  if (!m) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((x) => {
          const n = docs.filter((d) => d.entity_type === x.key && (x.key !== "general" || !d.folder_id)).length;
          return (
            <button key={x.key} onClick={() => { setMod(x.key); setRec(null); setQ(""); }}
              className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><x.icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b>{x.label}</b><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{n}</span></span><span className="mt-0.5 block text-sm text-muted-foreground">{x.description}</span></span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <Panel flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
        <Button size="sm" variant="ghost" onClick={() => { if (rec) setRec(null); else setMod(null); }}><ArrowLeft /> Back</Button>
        <button onClick={() => { setMod(null); setRec(null); }} className="font-medium text-muted-foreground hover:text-foreground">Modules</button>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <button onClick={() => setRec(null)} className={cn("font-medium", rec ? "text-muted-foreground hover:text-foreground" : "text-foreground")}>{m.label}</button>
        {rec && <><ChevronRight className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">{rec.name}</span>
          {rec.id !== "none" && m.link && <Link to={m.link(rec.id)} className="ml-1 text-xs text-primary hover:underline">Open record</Link>}</>}
        {!rec && <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi h-9 pl-9" placeholder={`Find in ${m.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>}
        {mod === "general" && !rec && <UploadButton />}
      </div>
      {rec ? <FileRows rows={inModule.filter((d) => (d.entity_id || "none") === rec.id)} onEdit={setEdit} /> : !records.length ? <EmptyState icon={Folder} title={`No ${m.label.toLowerCase()} files yet`} description={mod === "general" ? "Upload company papers here." : `Add files on a ${m.label.toLowerCase().replace(/s$/, "")} to see them here.`} /> : (
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <PagedRows rows={records} gridSpan>{(pageRows) => pageRows.map((r) => (
            <button key={r.id} onClick={() => setRec({ id: r.id, name: r.name })} className="flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-primary/40 hover:bg-primary/5">
              <Folder className="h-5 w-5 shrink-0 fill-primary/15 text-primary" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.count} file{r.count === 1 ? "" : "s"} · {fmtDate(r.last)}</span></span>
            </button>
          ))}</PagedRows>
        </div>
      )}
      <EditDoc doc={edit} onClose={() => setEdit(null)} />
    </Panel>
  );
}

/* ------------------------------------------------------------- my folders */

function FoldersTab({ docs }: { docs: DocRow[] }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [crumbs, setCrumbs] = useState<Folder[]>([]);
  const [edit, setEdit] = useState<DocRow | null>(null);
  const [naming, setNaming] = useState<{ folder?: Folder; name: string } | null>(null);
  const current = crumbs[crumbs.length - 1] || null;
  const { data: folders = [] } = useQuery({
    queryKey: ["doc-folders", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("doc_folders").select("id,parent_id,name").order("name")).data || []) as Folder[],
  });
  const here = folders.filter((f) => (f.parent_id || null) === (current?.id || null));
  const files = docs.filter((d) => (current ? d.folder_id === current.id : false));
  const countIn = (id: string) => docs.filter((d) => d.folder_id === id).length + folders.filter((f) => f.parent_id === id).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["doc-folders"] });
  const saveName = async () => {
    if (!naming?.name.trim()) return;
    const { error } = naming.folder
      ? await sb.from("doc_folders").update({ name: naming.name.trim() }).eq("id", naming.folder.id)
      : await sb.from("doc_folders").insert({ name: naming.name.trim(), parent_id: current?.id || null });
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: naming.folder ? "Folder renamed" : "Folder created" }); setNaming(null); refresh();
  };
  const removeFolder = async (f: Folder) => {
    if (!(await confirmAction({ title: `Delete the folder ${f.name}?`, message: "Folders inside it are deleted too. Its files are kept and move to Company files.", danger: true, confirmLabel: "Delete folder" }))) return;
    const { error } = await sb.from("doc_folders").delete().eq("id", f.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    toast({ title: "Folder deleted" }); refresh(); qc.invalidateQueries({ queryKey: ["documents"] });
  };
  return (
    <Panel flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
        {current && <Button size="sm" variant="ghost" onClick={() => setCrumbs(crumbs.slice(0, -1))}><ArrowLeft /> Back</Button>}
        <button onClick={() => setCrumbs([])} className={cn("font-medium", current ? "text-muted-foreground hover:text-foreground" : "")}>My folders</button>
        {crumbs.map((c, i) => <span key={c.id} className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-muted-foreground" /><button onClick={() => setCrumbs(crumbs.slice(0, i + 1))} className={cn("font-medium", i === crumbs.length - 1 ? "" : "text-muted-foreground hover:text-foreground")}>{c.name}</button></span>)}
        <span className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setNaming({ name: "" })}><FolderPlus /> New folder</Button>
          {current && <UploadButton folderId={current.id} />}
        </span>
      </div>
      {!here.length && !files.length ? (
        <EmptyState icon={Folder} title={current ? "This folder is empty" : "No folders yet"} description={current ? "Upload files or add a folder inside it." : "Create folders for contracts, permits, tenders or anything else your team files."} />
      ) : (
        <>
          {!!here.length && (
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <PagedRows rows={here} gridSpan>{(pageRows) => pageRows.map((f) => (
                <div key={f.id} className="group flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary/40 hover:bg-primary/5">
                  <button onClick={() => setCrumbs([...crumbs, f])} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <Folder className="h-5 w-5 shrink-0 fill-primary/15 text-primary" />
                    <span className="min-w-0"><span className="block truncate font-medium">{f.name}</span><span className="text-xs text-muted-foreground">{countIn(f.id)} item{countIn(f.id) === 1 ? "" : "s"}</span></span>
                  </button>
                  <button className="icon-btn opacity-0 group-hover:opacity-100" onClick={() => setNaming({ folder: f, name: f.name })} aria-label="Rename"><Pencil className="h-4 w-4" /></button>
                  <button className="icon-btn-danger opacity-0 group-hover:opacity-100" onClick={() => void removeFolder(f)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}</PagedRows>
            </div>
          )}
          {!!files.length && <FileRows rows={files} onEdit={setEdit} />}
        </>
      )}
      <Modal open={!!naming} onClose={() => setNaming(null)} title={naming?.folder ? "Rename folder" : "New folder"} icon={FolderPlus} center size="sm" footer={<Button onClick={saveName}>{naming?.folder ? "Rename" : "Create"}</Button>}>
        <Field label="Folder name"><input className="fi" autoFocus value={naming?.name || ""} onChange={(e) => setNaming(naming ? { ...naming, name: e.target.value } : null)} onKeyDown={(e) => { if (e.key === "Enter") void saveName(); }} /></Field>
      </Modal>
      <EditDoc doc={edit} onClose={() => setEdit(null)} />
    </Panel>
  );
}

/* ------------------------------------------------------------- all files */

function AllFiles({ docs }: { docs: DocRow[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [expiry, setExpiry] = useState("");
  const [edit, setEdit] = useState<DocRow | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const rows = useMemo(() => docs.filter((d) => (!type || d.entity_type === type)
    && (!expiry || (expiry === "expired" ? d.expires_on && d.expires_on < today : d.expires_on && d.expires_on >= today && d.expires_on <= soon))
    && (!q.trim() || `${d.name} ${d.category} ${d.entity_name}`.toLowerCase().includes(q.trim().toLowerCase()))), [docs, q, type, expiry, today, soon]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">Everything</option>{Object.entries(docEntityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="fi w-auto" value={expiry} onChange={(e) => setExpiry(e.target.value)}><option value="">Any expiry</option><option value="soon">Expiring in 30 days</option><option value="expired">Expired</option></select>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, type or owner…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <UploadButton />
      </div>
      <Panel flush><FileRows rows={rows} onEdit={setEdit} showOwner /></Panel>
      <EditDoc doc={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
