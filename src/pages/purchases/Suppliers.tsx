import { useEffect, useMemo, useState } from "react";
import { MergeContactModal } from "@/components/books/MergeContacts";
import { useTaxSettings } from "@/lib/tax";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, ShoppingBag, Receipt, Wallet, FileText, X, Building2, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import ImportExport from "@/components/ImportExport";
import DocumentsPanel, { SUPPLIER_DOCS, uploadDocument } from "@/components/DocumentsPanel";
import { confirmAction } from "@/components/books/confirm";
import { useUnsavedGuard } from "@/lib/unsaved";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { billLabel } from "./Purchasing";
import { cn } from "@/lib/utils";
import { CustomFieldInputs, CustomFieldsView, missingCustomField, useCustomFields, type CustomValues } from "@/lib/customFields";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const sb: any = supabase;
const BLANK = { supplier_type: "company", name: "", contact_person: "", phone: "", email: "", address: "", kra_pin: "", registration_no: "", website: "", payment_terms: "Net 30", bank_details: "", category: "", notes: "", onboarding_status: "pending", withholding_vat: false };
const ONBOARD: Record<string, [string, "warning" | "success" | "danger" | "muted"]> = { pending: ["Onboarding", "warning"], active: ["Approved", "success"], suspended: ["Suspended", "danger"] };

function useSupplierData() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["suppliers-z", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const [s, b, d] = await Promise.all([
        sb.from("suppliers").select("*").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
        sb.from("bills").select("supplier_id,amount,amount_paid,status").eq("tenant_id", tenantId).not("status", "in", "(void,draft)"),
        sb.from("documents").select("entity_id,category").eq("tenant_id", tenantId).eq("entity_type", "supplier"),
      ]);
      const owed = new Map<string, number>();
      for (const x of (b.data || []) as any[]) owed.set(x.supplier_id, (owed.get(x.supplier_id) || 0) + Number(x.amount) - Number(x.amount_paid));
      const docs = new Map<string, Set<string>>();
      for (const x of (d.data || []) as any[]) { const set = docs.get(x.entity_id) || new Set(); set.add(x.category); docs.set(x.entity_id, set); }
      return ((s.data || []) as any[]).map((x) => ({ ...x, _owed: owed.get(x.id) || 0, _docs: SUPPLIER_DOCS.filter((c) => docs.get(x.id)?.has(c)).length }));
    },
  });
}

export default function Suppliers() {
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: list = [], isLoading } = useSupplierData();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const rows = useMemo(() => list.filter((s) => (!status || s.onboarding_status === status) && (!kind || (s.supplier_type || "company") === kind) && (!q.trim() || `${s.name} ${s.contact_person || ""} ${s.phone || ""} ${s.email || ""} ${s.kra_pin || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [list, q, status, kind]);
  const paged = usePaged(rows, 20);
  const sel = useSelection(paged.rows.map((s: any) => s.id));
  const qcB = useQueryClient();
  const { toast: toastB } = useToast();
  const bulkSet = async (patch: Record<string, unknown>, msg: string) => {
    const { error } = await (supabase as any).from("suppliers").update(patch).in("id", sel.ids);
    if (error) return toastB({ title: "Not changed", description: error.message, variant: "destructive" });
    sel.clear(); qcB.invalidateQueries(); toastB({ title: msg });
  };
  const bulkDelete = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} supplier${sel.count === 1 ? "" : "s"}?`, message: "Suppliers with orders or bills are kept and marked inactive instead.", danger: true, confirmLabel: "Delete" }))) return;
    let gone = 0, kept = 0;
    for (const sid of sel.ids) { const { error } = await (supabase as any).from("suppliers").delete().eq("id", sid); if (error) { kept++; await (supabase as any).from("suppliers").update({ is_active: false }).eq("id", sid); } else gone++; }
    sel.clear(); qcB.invalidateQueries(); toastB({ title: `${gone} deleted${kept ? `, ${kept} marked inactive` : ""}` });
  };
  const openId = params.get("open");
  if (isLoading) return <OrbLoader label="Loading suppliers…" />;
  if (id === "new" || (id && params.get("edit") !== null) || window.location.pathname.endsWith("/edit")) {
    const existing = id && id !== "new" ? list.find((s) => s.id === id) : null;
    // Clone: a new vendor that starts from another one's details.
    const copy = !existing && params.get("clone") ? list.find((s) => s.id === params.get("clone")) : null;
    return <SupplierForm existing={existing} copy={copy ? { ...copy, id: undefined, name: `${copy.name} (Copy)`, onboarding_status: "pending" } : null} onDone={(sid) => navigate(sid ? `/purchases/suppliers?open=${sid}` : "/purchases/suppliers")} />;
  }
  const selected = openId ? list.find((s) => s.id === openId) : null;
  return (
    <div className="space-y-5">
      <PageHeader title="Suppliers" icon={Truck} description="Who you buy from: contacts, onboarding documents, orders, bills and what you owe."
        actions={<>
          <ImportExport entity="suppliers" rows={list.map((s) => ({ name: s.name, contact_person: s.contact_person, phone: s.phone, email: s.email, kra_pin: s.kra_pin, registration_no: s.registration_no, payment_terms: s.payment_terms, category: s.category, address: s.address, owed: s._owed, status: ONBOARD[s.onboarding_status]?.[0] }))}
            spec={{ table: "suppliers", columns: [{ key: "name", label: "Name", required: true }, { key: "contact_person", label: "Contact person" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "kra_pin", label: "KRA PIN" }, { key: "registration_no", label: "Registration number" }, { key: "payment_terms", label: "Payment terms" }, { key: "category", label: "Category" }, { key: "address", label: "Address" }], toRecord: (r) => ({ ...r, is_active: true, onboarding_status: "pending" }) }} />
          <Button onClick={() => navigate("/purchases/suppliers/new")}><Plus /> New supplier</Button>
        </>} />
      <StatGrid>
        <StatTile label="Onboarding" value={list.filter((s) => s.onboarding_status === "pending").length} icon={Clock} tone="warning" hint="Waiting for documents or approval" />
        <StatTile label="Owed to suppliers" value={formatKES(list.reduce((a, s) => a + s._owed, 0))} icon={Wallet} tone="danger" />
        <StatTile label="Documents complete" value={list.filter((s) => s._docs >= SUPPLIER_DOCS.length - 2).length} icon={CheckCircle2} tone="success" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All suppliers</option>{Object.entries(ONBOARD).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="fi w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Vendor type"><option value="">Companies and individuals</option><option value="company">Companies</option><option value="individual">Individuals</option></select>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Name, contact, phone or PIN…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Truck} title="No suppliers" /> : <>
          <BulkBar sel={sel} noun="supplier">
            <select className="fi h-8 w-52 text-sm" value="" onChange={(e) => e.target.value && bulkSet({ onboarding_status: e.target.value }, "Status changed")}><option value="">Set onboarding status…</option>{Object.entries(ONBOARD).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            <Button size="sm" variant="outline" onClick={() => downloadCsv("suppliers-selected.csv", ["Name", "Contact", "Phone", "Email", "KRA PIN", "Terms", "Category", "Owed"], list.filter((s) => sel.has(s.id)).map((s) => [s.name, s.contact_person, s.phone, s.email, s.kra_pin, s.payment_terms, s.category, s._owed]))}>Export</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={bulkDelete}><Trash2 /> Delete</Button>
          </BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Supplier</th><th className="hidden md:table-cell">Contact</th><th className="hidden lg:table-cell">KRA PIN</th><th>Status</th><th className="hidden sm:table-cell">Documents</th><th className="num">Owed</th><th /></tr></thead>
            <tbody>{paged.rows.map((s: any) => (
              <tr key={s.id} className={cn("cursor-pointer", sel.has(s.id) && "bg-primary/5")} onClick={() => navigate(`/purchases/suppliers?open=${s.id}`)}>
                <td data-label=""><Tick on={sel.has(s.id)} onChange={() => sel.toggle(s.id)} /></td>
                <td><span className="font-semibold text-primary">{s.name}</span>{s.supplier_type === "individual" && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Individual</span>}{s.category && <span className="block text-xs text-muted-foreground">{s.category}</span>}</td>
                <td className="hidden md:table-cell">{s.contact_person || "—"}<span className="block text-xs text-muted-foreground">{s.phone || s.email || ""}</span></td>
                <td className="hidden font-mono text-xs lg:table-cell">{s.kra_pin || "—"}</td>
                <td><Pill tone={ONBOARD[s.onboarding_status]?.[1] || "muted"}>{ONBOARD[s.onboarding_status]?.[0] || s.onboarding_status}</Pill></td>
                <td className="hidden sm:table-cell"><span className="text-xs">{s._docs}/{SUPPLIER_DOCS.length}</span></td>
                <td className="num font-semibold">{formatKES(s._owed)}</td>
                <td onClick={(e) => e.stopPropagation()}><span className="flex justify-end gap-1"><button className="icon-btn" onClick={() => navigate(`/purchases/suppliers/${s.id}/edit`)} aria-label="Edit"><Pencil className="h-4 w-4" /></button></span></td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>
      {selected && <SupplierProfile s={selected} onClose={() => navigate("/purchases/suppliers")} />}
    </div>
  );
}

function SupplierForm({ existing, copy, onDone }: { existing?: any; copy?: any; onDone: (id?: string) => void }) {
  const tenantId = useTenantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<any>({ ...BLANK, ...(existing || copy || {}) });
  const customFields = useCustomFields("supplier");
  const [custom, setCustom] = useState<CustomValues>((existing || copy)?.custom || {});
  const taxSet = useTaxSettings();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty && !busy);
  useEffect(() => { if (existing) setF({ ...BLANK, ...existing }); }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const up = (p: any) => { setDirty(true); setF((x: any) => ({ ...x, ...p })); };
  const save = async () => {
    if (!f.name.trim()) return toast({ title: f.supplier_type === "individual" ? "Enter the vendor's full name" : "Enter the company name", variant: "destructive" });
    if (f.kra_pin && !/^[AP]\d{9}[A-Z]$/i.test(f.kra_pin.trim())) return toast({ title: "KRA PIN looks wrong", description: "e.g. P051234567Q", variant: "destructive" });
    const missing = missingCustomField(customFields, custom);
    if (missing) return toast({ title: `Fill in ${missing}`, variant: "destructive" });
    setBusy(true);
    try {
      const payload: any = { custom };
      for (const k of Object.keys(BLANK)) payload[k] = typeof f[k] === "string" ? f[k].trim() || null : f[k];
      payload.name = f.name.trim(); payload.kra_pin = f.kra_pin ? f.kra_pin.trim().toUpperCase() : null; payload.onboarding_status = f.onboarding_status || "pending"; payload.updated_at = new Date().toISOString();
      const r = existing ? await sb.from("suppliers").update(payload).eq("id", existing.id).select("id").single() : await sb.from("suppliers").insert({ ...payload, tenant_id: tenantId, is_active: true }).select("id").single();
      if (r.error) throw r.error;
      for (const [cat, file] of Object.entries(files)) await uploadDocument(tenantId!, file, { entity_type: "supplier", entity_id: r.data.id, entity_name: payload.name, category: cat, name: `${cat} · ${file.name}` });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["suppliers-z"] }); qc.invalidateQueries({ queryKey: ["suppliers-list"] }); qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: existing ? "Supplier updated" : "Supplier added", description: Object.keys(files).length ? `${Object.keys(files).length} documents uploaded` : undefined });
      onDone(r.data.id);
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const T = (k: string, l: string, p: any = {}) => <Field label={l} hint={p.hint}>{p.area ? <textarea className="fi" value={f[k] || ""} onChange={(e) => up({ [k]: e.target.value })} /> : <input className="fi" type={p.type || "text"} value={f[k] || ""} placeholder={p.ph} onChange={(e) => up({ [k]: e.target.value })} />}</Field>;
  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6"><Truck className="h-5 w-5 text-primary" /><h1 className="flex-1 font-display text-xl font-bold">{existing ? `Edit ${existing.name}` : "New Vendor"}</h1><Button size="icon" variant="ghost" onClick={async () => { if (!dirty || await confirmAction({ title: "Leave without saving?", confirmLabel: "Leave", danger: true })) onDone(existing?.id); }} aria-label="Close"><X /></Button></div>
      <div className="flex-1 space-y-6 bg-card px-4 py-6 sm:px-6">
        <section className="max-w-4xl space-y-4"><h2 className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-primary" /> Vendor</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Vendor type">
            {([["company", "Company"], ["individual", "Individual"]] as const).map(([v, l]) => (
              <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-semibold", f.supplier_type === v ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" className="accent-primary" checked={f.supplier_type === v} onChange={() => up({ supplier_type: v })} /> {l}
              </label>
            ))}
          </div>
          {f.supplier_type === "individual"
            ? <div className="grid gap-4 sm:grid-cols-2">{T("name", "Full name *")}{T("category", "What they supply", { ph: "Transport, casual labour, produce…" })}{T("kra_pin", "KRA PIN", { ph: "A012345678Z" })}{T("address", "Address")}</div>
            : <div className="grid gap-4 sm:grid-cols-2">{T("name", "Company name *")}{T("category", "What they supply", { ph: "Office supplies, medicine, accessories…" })}{T("kra_pin", "KRA PIN", { ph: "P051234567Q" })}{T("registration_no", "Business registration number")}{T("website", "Website")}{T("address", "Address")}</div>}</section>
        <section className="max-w-4xl space-y-4"><h2 className="flex items-center gap-2 font-semibold"><Phone className="h-4 w-4 text-primary" /> Contact</h2>
          <div className="grid gap-4 sm:grid-cols-3">{f.supplier_type !== "individual" && T("contact_person", "Contact person")}{T("phone", "Phone")}{T("email", "Email", { type: "email" })}</div></section>
        <section className="max-w-4xl space-y-4"><h2 className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-primary" /> Payment</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment terms"><select className="fi" value={f.payment_terms || ""} onChange={(e) => up({ payment_terms: e.target.value })}>{["Due on receipt", "Net 7", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Onboarding status"><select className="fi" value={f.onboarding_status} onChange={(e) => up({ onboarding_status: e.target.value })}>{Object.entries(ONBOARD).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <div className="sm:col-span-2">{T("bank_details", "Bank / M-Pesa details", { area: true, ph: "Bank, branch, account name and number, or Paybill/Till" })}</div>
            <CustomFieldInputs entity="supplier" values={custom} onChange={(v) => { setDirty(true); setCustom(v); }} className="contents" />
            <div className="sm:col-span-2">{T("notes", "Notes", { area: true })}</div>
            {taxSet.withholding.enabled && taxSet.withholding.appliesTo !== "customers" && (
              <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!!f.withholding_vat} onChange={(e) => up({ withholding_vat: e.target.checked })} /> Withhold VAT ({taxSet.withholding.rate}%) when paying this vendor</label>
            )}
          </div></section>
        {!existing && <section className="max-w-4xl space-y-3"><h2 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-primary" /> Onboarding documents</h2>
          <p className="text-sm text-muted-foreground">Upload what you have now; the rest can be added on the supplier later.</p>
          <div className="grid gap-2 sm:grid-cols-2">{SUPPLIER_DOCS.map((c) => (
            <label key={c} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm", files[c] ? "border-success/40 bg-success/5" : "border-border hover:border-primary")}>
              {files[c] ? <CheckCircle2 className="h-4 w-4 text-success" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="block">{c}</span>{files[c] && <span className="block truncate text-xs text-muted-foreground">{files[c].name}</span>}</span>
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setDirty(true); setFiles((x) => ({ ...x, [c]: file })); } }} />
            </label>
          ))}</div></section>}
      </div>
      <div className="sticky bottom-0 z-10 flex gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6 md:bottom-0">
        <Button onClick={save} disabled={busy}>{busy && <OrbSpinner />} {existing ? "Save changes" : "Save supplier"}</Button>
        <Button variant="ghost" onClick={() => onDone(existing?.id)}>Cancel</Button>
      </div>
    </div>
  );
}

function SupplierProfile({ s, onClose }: { s: any; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "documents" | "orders" | "bills">("overview");
  const { data } = useQuery({
    queryKey: ["supplier-activity", s.id],
    queryFn: async () => {
      const [po, b, p] = await Promise.all([
        sb.from("purchases").select("id,po_number,order_date,total,status,approval_status,billed").eq("supplier_id", s.id).order("order_date", { ascending: false, nullsFirst: false }).order("po_number", { ascending: false }).order("created_at", { ascending: false }).limit(200),
        sb.from("bills").select("id,bill_number,name,bill_date,due_date,amount,amount_paid,status").eq("supplier_id", s.id).order("bill_date", { ascending: false, nullsFirst: false }).order("bill_number", { ascending: false }).order("created_at", { ascending: false }).limit(200),
        sb.from("supplier_payments").select("amount,paid_on").eq("supplier_id", s.id),
      ]);
      return { pos: (po.data || []) as any[], bills: (b.data || []) as any[], paid: ((p.data || []) as any[]).reduce((a, x) => a + Number(x.amount), 0) };
    },
  });
  const [mergeOpen, setMergeOpen] = useState(false);
  const remove = async () => {
    if (!(await confirmAction({ title: `Remove ${s.name}?`, message: "The supplier is hidden; past orders and bills stay.", danger: true, confirmLabel: "Remove" }))) return;
    const { error } = await sb.from("suppliers").update({ is_active: false }).eq("id", s.id);
    if (error) return toast({ title: "Not removed", description: error.message, variant: "destructive" });
    toast({ title: "Supplier removed" }); qc.invalidateQueries({ queryKey: ["suppliers-z"] }); onClose();
  };
  const approve = async () => {
    const { error } = await sb.from("suppliers").update({ onboarding_status: "active" }).eq("id", s.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: `${s.name} approved` }); qc.invalidateQueries({ queryKey: ["suppliers-z"] });
  };
  return (
    <Modal open onClose={onClose} title={s.name} description={s.category || "Supplier"} icon={Truck} size="2xl"
      footer={<div className="flex w-full flex-wrap gap-2">
        {mergeOpen && <MergeContactModal kind="supplier" keep={{ id: s.id, name: s.name }} onClose={() => setMergeOpen(false)} />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button><Plus /> New Transaction</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => navigate("/purchases/bills/new")}><Receipt /> Bill</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/payments")}><Wallet /> Bill Payment</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/expenses?new=1")}><Wallet /> Expense</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/recurring-bills")}><Receipt /> Recurring Bill</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/recurring-expenses")}><Wallet /> Recurring Expense</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`/purchases/orders/new?supplier=${s.id}`)}><ShoppingBag /> Purchase Order</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/receives/new")}><ShoppingBag /> Purchase Receive</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/purchases/vendor-credits/new")}><FileText /> Vendor Credit</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/accounting/journals?new=1")}><FileText /> Journal</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {s.email && <DropdownMenuItem onSelect={() => { window.location.href = `mailto:${s.email}`; }}><Mail /> Email Vendor</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => navigate(`/purchases/suppliers/new?clone=${s.id}`)}><Plus /> Clone</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMergeOpen(true)}><Truck /> Merge vendors</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {s.onboarding_status !== "active" && <Button variant="outline" onClick={approve}><CheckCircle2 /> Approve supplier</Button>}
        <Button variant="outline" onClick={() => navigate(`/purchases/suppliers/${s.id}/edit`)}><Pencil /> Edit</Button>
        <Button variant="ghost" className="ml-auto text-destructive" onClick={remove}><Trash2 /> Mark as Inactive</Button>
      </div>}>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">{([["overview", "Overview"], ["documents", `Documents (${s._docs}/${SUPPLIER_DOCS.length})`], ["orders", "Purchase orders"], ["bills", "Bills"]] as const).map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm", tab === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
      {tab === "overview" && <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Owed", formatKES(s._owed)], ["Paid to date", formatKES(data?.paid || 0)], ["Orders", String(data?.pos.length || 0)], ["Status", ONBOARD[s.onboarding_status]?.[0] || "—"]].map(([l, v]) => <div key={l} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="font-display text-lg font-bold">{v}</p></div>)}
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          {[[Phone, "Contact", `${s.contact_person || "—"} · ${s.phone || ""}`], [Mail, "Email", s.email || "—"], [MapPin, "Address", s.address || "—"], [Building2, "KRA PIN · Reg. no.", `${s.kra_pin || "—"} · ${s.registration_no || "—"}`], [Wallet, "Payment terms", s.payment_terms || "—"], [Receipt, "Bank / M-Pesa", s.bank_details || "—"]].map(([I, l, v]: any) => (
            <div key={l} className="rounded-xl border border-border p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><I className="h-3.5 w-3.5" />{l}</p><p className="mt-0.5 whitespace-pre-line font-medium">{v}</p></div>
          ))}
        </div>
        <CustomFieldsView entity="supplier" values={s.custom} className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" />
      </div>}
      {tab === "documents" && <DocumentsPanel entityType="supplier" entityId={s.id} entityName={s.name} checklist={SUPPLIER_DOCS} />}
      {tab === "orders" && ((data?.pos || []).length === 0 ? <p className="text-sm text-muted-foreground">No purchase orders yet.</p> :
        <TableWrap><table className="dt"><thead><tr><th>Date</th><th>PO#</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody><PagedRows rows={data!.pos} colSpan={4}>{(pageRows) => pageRows.map((p) => <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/purchases/orders/${p.id}`)}><td>{fmtDate(p.order_date)}</td><td className="font-semibold text-primary">{p.po_number}</td><td className="capitalize">{p.approval_status === "pending" ? "pending approval" : p.status.replace("_", " ")}</td><td className="num">{formatKES(Number(p.total))}</td></tr>)}</PagedRows></tbody></table></TableWrap>)}
      {tab === "bills" && ((data?.bills || []).length === 0 ? <p className="text-sm text-muted-foreground">No bills yet.</p> :
        <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Bill#</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead><tbody><PagedRows rows={data!.bills} colSpan={5}>{(pageRows) => pageRows.map((b) => <tr key={b.id} className="cursor-pointer" onClick={() => navigate(`/purchases/bills/${b.id}`)}><td>{fmtDate(b.bill_date)}</td><td className="font-semibold text-primary">{b.bill_number || b.name}</td><td className="capitalize">{billLabel(b)}</td><td className="num">{formatKES(Number(b.amount))}</td><td className="num">{formatKES(Number(b.amount) - Number(b.amount_paid))}</td></tr>)}</PagedRows></tbody></table></TableWrap>)}
    </Modal>
  );
}
