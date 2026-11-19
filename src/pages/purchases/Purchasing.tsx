import { useEffect, useMemo, useRef, useState } from "react";
import { useMoneyAccounts } from "@/hooks/useMoneyAccounts";
import { erpApi as erpApiB } from "@/lib/erpApi";
import { ShieldCheck } from "lucide-react";
import { useTaxSettings } from "@/lib/tax";
import { MakeRecurringModal } from "@/pages/sales/RecurringInvoices";
import { ViewJournalModal } from "@/components/books/ViewJournal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Repeat, CalendarClock, BookOpenCheck, MoreHorizontal, Copy } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Plus, Search, X, Pencil, PackageCheck, Receipt, CheckSquare, Ban, Trash2, Printer, Wallet, CheckCircle2, Send, FileText, Truck, Download, Paperclip,
} from "lucide-react";
import { linkToContract } from "@/lib/contractLink";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings, useLocations } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, Pill, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import DocumentsPanel, { uploadDocument } from "@/components/DocumentsPanel";
import { DocPane, SplitView } from "@/components/books/DocPane";
import { readSupplierInvoice, vendorFor, billLinesFrom } from "@/lib/readInvoice";
import { Sparkles, UploadCloud, ChevronDown } from "lucide-react";

import { SupplierShare, ReceiveDetail, useSupplier } from "./PurchaseDocs";
import { FileMinus, AlertTriangle } from "lucide-react";
import { AutoGrowText, ItemTable, editTotals, newLine, toEditLines, toStoredLines, type EditLine, type Adjustments } from "@/components/books/ItemTable";
import { confirmAction } from "@/components/books/confirm";
import ImportExport from "@/components/ImportExport";
import { useUnsavedGuard } from "@/lib/unsaved";
import { useApprovalRule, submitForApproval } from "@/lib/approvals";
import { currencyCode, formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { SignBanner } from "@/components/books/SignBanner";
import { useDocSignature, useSigningRule } from "@/lib/signing";
import { cn } from "@/lib/utils";
import { CustomFieldInputs, missingCustomField, useCustomFields, type CustomValues } from "@/lib/customFields";
import { TagPickers, cleanTags, missingTag, useModuleTags, type TagValues } from "@/lib/reportingTags";
import { PhoneDocCards } from "@/components/books/PhoneDocCards";

const sb: any = supabase;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);

function useSuppliers() {
  const tenantId = useTenantId();
  return useQuery({ queryKey: ["suppliers-list", tenantId], enabled: !!tenantId, queryFn: async () => ((await sb.from("suppliers").select("id,name,email,phone,payment_terms").eq("tenant_id", tenantId).order("name")).data || []) as any[] });
}

/* ───────────────────────────── Purchase orders ───────────────────────────── */

const PO_STATUS: Record<string, [string, "muted" | "info" | "warning" | "success" | "danger" | "primary"]> = {
  draft: ["Draft", "muted"], pending: ["Issued", "info"], partially_received: ["Partly received", "warning"], received: ["Received", "success"], cancelled: ["Cancelled", "danger"], closed: ["Closed", "success"],
};
function poStatus(po: any) {
  if (po.approval_status === "pending") return ["Pending approval", "warning"] as const;
  if (po.approval_status === "rejected") return ["Rejected", "danger"] as const;
  if (po.billed && po.status === "received") return ["Billed", "primary"] as const;
  return PO_STATUS[po.status] || [po.status, "muted"];
}

export function usePurchaseOrders() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["purchase-orders-z", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("purchases").select("*, purchase_items(*, products(name, unit))").eq("tenant_id", tenantId).order("order_date", { ascending: false, nullsFirst: false }).order("po_number", { ascending: false }).order("created_at", { ascending: false }).limit(3000)).data || []) as any[],
  });
}

/** Bulk status change / delete on purchase orders or bills, with a confirmation and a toast. */
function useBulkDocs(table: "purchases" | "bills", keys: string[]) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return {
    set: async (ids: string[], patch: Record<string, unknown>, msg: string) => {
      if (!ids.length) { toast({ title: "None of the selected records can change to that", variant: "destructive" }); return false; }
      const { error } = await sb.from(table).update(patch).in("id", ids);
      if (error) { toast({ title: "Not changed", description: error.message, variant: "destructive" }); return false; }
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast({ title: `${ids.length} ${msg}` }); return true;
    },
    remove: async (ids: string[], what: string) => {
      if (!ids.length) { toast({ title: "Only drafts can be deleted", variant: "destructive" }); return false; }
      if (!(await confirmAction({ title: `Delete ${ids.length} draft ${what}${ids.length === 1 ? "" : "s"}?`, danger: true, confirmLabel: "Delete" }))) return false;
      const { error } = await sb.from(table).delete().in("id", ids);
      if (error) { toast({ title: "Not deleted", description: error.message, variant: "destructive" }); return false; }
      keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast({ title: `${ids.length} deleted` }); return true;
    },
  };
}

export function PurchaseOrders() {
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: pos = [], isLoading } = usePurchaseOrders();
  const [q, setQ] = useState("");
  const [view, setView] = useState("all");
  const editing = params.get("edit");
  const rows = useMemo(() => pos.filter((p) => {
    const [label] = poStatus(p);
    if (view !== "all" && label.toLowerCase() !== view) return false;
    const s = q.trim().toLowerCase();
    return !s || `${p.po_number} ${p.supplier_name} ${p.reference || ""}`.toLowerCase().includes(s);
  }), [pos, q, view]);
  const paged = usePaged(rows, 20);
  const sel = useSelection(paged.rows.map((p: any) => p.id));
  const bulk = useBulkDocs("purchases", ["purchase-orders-z"]);
  const picked = pos.filter((p) => sel.has(p.id));
  const signRule = useSigningRule("purchase_order");
  if (isLoading) return <OrbLoader label="Loading purchase orders…" />;
  if (id === "new" || editing) return <PoForm existing={editing ? pos.find((p) => p.id === editing) : null} copy={params.get("clone") ? pos.find((p) => p.id === params.get("clone")) : null} onDone={(pid, send) => navigate(pid ? `/purchases/orders/${pid}${send ? "?send=1" : ""}` : "/purchases/orders")} />;
  const selected = id ? pos.find((p) => p.id === id) : null;
  if (selected) return (
    <div className="flex h-[calc(100svh-8.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="hidden w-[300px] shrink-0 flex-col border-r border-border xl:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5"><p className="flex-1 font-display font-bold">All Purchase Orders</p><Button size="sm" onClick={() => navigate("/purchases/orders/new")}><Plus /></Button></div>
        <ul className="min-h-0 flex-1 overflow-y-auto">{rows.map((p: any) => { const [label] = poStatus(p); return (
          <li key={p.id}><Link to={`/purchases/orders/${p.id}`} className={cn("block border-b border-border px-3 py-2.5 hover:bg-muted/50", p.id === selected.id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
            <div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{p.supplier_name}</span><span className="text-sm tabular-nums">{formatKES(Number(p.total))}</span></div>
            <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground"><span>{p.po_number} · {fmtDate(p.order_date || p.created_at)}</span><span className="font-semibold uppercase">{label}</span></div>
          </Link></li>
        ); })}</ul>
      </div>
      <PoDetail po={selected} onClose={() => navigate("/purchases/orders")} />
    </div>
  );
  const open = pos.filter((p) => ["pending", "partially_received"].includes(p.status));
  const views = ["all", "draft", "pending approval", "issued", "partly received", "received", "billed", "cancelled"];
  return (
    <div className="space-y-5">
      <PageHeader title="Purchase Orders" icon={ShoppingBag} description="Order stock from suppliers, receive it and turn it into a bill."
        actions={<>
          <ImportExport entity="purchase_orders" rows={pos.map((p) => ({ po_number: p.po_number, supplier: p.supplier_name, order_date: p.order_date, expected_date: p.expected_date, status: poStatus(p)[0], total: p.total, paid: p.amount_paid }))} />
          <Button onClick={() => navigate("/purchases/orders/new")}><Plus /> New purchase order</Button>
        </>} />
      <StatGrid>
        <StatTile label="Open orders" value={open.length} icon={ShoppingBag} tone="primary" hint={formatKES(open.reduce((a, p) => a + Number(p.total), 0))} />
        <StatTile label="Waiting for approval" value={pos.filter((p) => p.approval_status === "pending").length} icon={CheckSquare} tone="warning" />
        <StatTile label="Received, not billed" value={pos.filter((p) => p.status === "received" && !p.billed).length} icon={PackageCheck} tone="info" />
        <StatTile label="This month" value={formatKES(pos.filter((p) => String(p.order_date).slice(0, 7) === today().slice(0, 7) && p.status !== "cancelled").reduce((a, p) => a + Number(p.total), 0))} icon={Receipt} tone="success" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <select className="fi w-auto capitalize" value={view} onChange={(e) => setView(e.target.value)}>{views.map((v) => <option key={v} value={v}>{v === "all" ? "All purchase orders" : v}</option>)}</select>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="PO#, supplier or reference…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={ShoppingBag} title="No purchase orders" description="Create one to order stock from a supplier." /> : <>
          <BulkBar sel={sel} noun="purchase order">
            {!signRule.enabled && <Button size="sm" variant="outline" onClick={async () => { if (await bulk.set(picked.filter((p) => p.status === "draft" && !["pending", "rejected"].includes(p.approval_status)).map((p) => p.id), { status: "pending", updated_at: new Date().toISOString() }, "issued to suppliers")) sel.clear(); }}><Send /> Issue drafts</Button>}
            <Button size="sm" variant="outline" onClick={async () => { if (await confirmAction({ title: "Cancel the selected orders?", message: "Orders with goods received are skipped.", danger: true, confirmLabel: "Cancel orders" }) && await bulk.set(picked.filter((p) => ["draft", "pending"].includes(p.status) && !(p.purchase_items || []).some((i: any) => Number(i.received_quantity) > 0)).map((p) => p.id), { status: "cancelled" }, "cancelled")) sel.clear(); }}><Ban /> Cancel</Button>
            <Button size="sm" variant="outline" onClick={() => downloadCsv("purchase-orders.csv", ["PO#", "Date", "Supplier", "Expected", "Status", "Total"], picked.map((p) => [p.po_number, p.order_date, p.supplier_name, p.expected_date, poStatus(p)[0], p.total]))}><Download /> Export</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={async () => { if (await bulk.remove(picked.filter((p) => p.status === "draft").map((p) => p.id), "order")) sel.clear(); }}><Trash2 /> Delete drafts</Button>
          </BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Date</th><th>PO#</th><th>Supplier</th><th className="hidden md:table-cell">Expected</th><th>Status</th><th className="hidden sm:table-cell">Received</th><th className="num">Amount</th></tr></thead>
            <tbody>{paged.rows.map((p: any) => {
              const [label, tone] = poStatus(p);
              const ord = (p.purchase_items || []).reduce((a: number, i: any) => a + Number(i.quantity), 0);
              const rec = (p.purchase_items || []).reduce((a: number, i: any) => a + Number(i.received_quantity), 0);
              return (
                <tr key={p.id} className={cn("cursor-pointer", sel.has(p.id) && "bg-primary/5")} onClick={() => navigate(`/purchases/orders/${p.id}`)}>
                  <td data-label=""><Tick on={sel.has(p.id)} onChange={() => sel.toggle(p.id)} /></td>
                  <td className="whitespace-nowrap">{fmtDate(p.order_date || p.created_at)}</td>
                  <td className="font-semibold text-primary">{p.po_number || "—"}</td>
                  <td>{p.supplier_name}</td>
                  <td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{p.expected_date ? fmtDate(p.expected_date) : "—"}</td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                  <td className="hidden sm:table-cell"><span className="text-xs text-muted-foreground">{rec}/{ord}</span></td>
                  <td className="num font-semibold">{formatKES(Number(p.total))}</td>
                </tr>
              );
            })}</tbody>
          </table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>

    </div>
  );
}

/** New / edit purchase order, laid out like Zoho's: vendor and location, where it is delivered, the order details, items, notes, terms and files. */
function PoForm({ existing, copy, onDone }: { existing?: any; copy?: any; onDone: (id?: string, send?: boolean) => void }) {
  const customFields = useCustomFields("purchase_order");
  const [custom, setCustom] = useState<CustomValues>((existing || copy)?.custom || {});
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const { data: suppliers = [] } = useSuppliers();
  const { data: locations = [] } = useLocations();
  const { data: customers = [] } = useQuery({ queryKey: ["po-customers", tenantId], enabled: !!tenantId, queryFn: async () => ((await sb.from("customers").select("id,name,company_name,phone,address").eq("tenant_id", tenantId).order("name").limit(2000)).data || []) as any[] });
  const approval = useApprovalRule("purchase_order");
  const [params] = useSearchParams();
  const init = existing || copy;
  const [f, setF] = useState(() => ({
    supplier_id: init?.supplier_id || params.get("supplier") || "", location_id: init?.location_id || "", order_date: existing?.order_date || today(),
    expected: existing?.expected_date || "", reference: init?.reference || "", notes: init?.notes || "", terms: init?.terms || "",
    payment_terms: init?.payment_terms || "Due on Receipt", shipment: init?.shipment_preference || "", deliver_to: (init?.deliver_to || "location") as "location" | "customer",
    delivery_customer_id: init?.delivery_customer_id || "", delivery_address: init?.delivery_address || "",
  }));
  const [poNumber, setPoNumber] = useState<string>(existing?.po_number || "");
  const [lines, setLines] = useState<EditLine[]>(() => init ? toEditLines((init.purchase_items || []).map((i: any) => ({ item_id: i.product_id, name: i.products?.name, quantity: i.quantity, rate: i.unit_cost, unit: i.products?.unit }))) : [newLine()]);
  const [adj, setAdj] = useState<Adjustments>({ discount: 0, shipping: 0, adjustment: 0 });
  const taxDefaults = useTaxSettings();
  const [inclusive, setInclusive] = useState<boolean>(() => (init ? !!init.prices_include_tax : !!taxDefaults.pricesIncludeTax));
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState("");
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty && !saving);
  useEffect(() => { if (!f.location_id && (locations as any[]).length) setF((x) => ({ ...x, location_id: ((locations as any[]).find((l) => l.is_main) || (locations as any[])[0]).id })); }, [locations]); // eslint-disable-line react-hooks/exhaustive-deps
  // The next number is shown as Zoho does (it is taken for real when the order is saved).
  useEffect(() => { if (!existing && tenantId) void sb.rpc("peek_doc_number", { p_kind: "po" }).then(({ data }: any) => { if (data) setPoNumber(String(data)); }); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<typeof f>) => { setDirty(true); setF((x) => ({ ...x, ...p })); };
  const loc = (locations as any[]).find((l) => l.id === f.location_id);
  const cust = customers.find((c) => c.id === f.delivery_customer_id);
  const addressText = f.deliver_to === "customer"
    ? f.delivery_address || [cust?.company_name || cust?.name, cust?.address, cust?.phone].filter(Boolean).join("\n")
    : [biz?.business_name, loc?.name, (biz as any)?.business_address, biz?.business_phone].filter(Boolean).join("\n");

  const save = async (mode: "draft" | "issue", send = false) => {
    const supplier = (suppliers as any[]).find((s) => s.id === f.supplier_id);
    if (!supplier) return toast({ title: "Choose the vendor", variant: "destructive" });
    if (f.deliver_to === "customer" && !f.delivery_customer_id) return toast({ title: "Choose the customer to deliver to", variant: "destructive" });
    const stored = toStoredLines(lines);
    if (!stored.length) return toast({ title: "Add at least one item", variant: "destructive" });
    if (stored.some((l) => !l.item_id)) return toast({ title: "Pick each line from your items", description: "Purchase orders are for items. Use a requisition for other things (e.g. office chairs, milk).", variant: "destructive" });
    if (existing && existing.status !== "draft" && (existing.purchase_items || []).some((i: any) => Number(i.received_quantity) > 0)) return toast({ title: "Part of this order was received", description: "It can no longer be edited.", variant: "destructive" });
    const missingCustom = missingCustomField(customFields, custom);
    if (missingCustom) return toast({ title: `Fill in ${missingCustom}`, variant: "destructive" });
    setSaving(send ? "send" : mode);
    try {
      const t = editTotals(lines, adj, inclusive);
      const needs = approval.needs(t.total);
      let num = existing?.po_number;
      if (!num) { const { data, error } = await sb.rpc("next_doc_number", { p_kind: "po" }); if (error) throw error; num = data; }
      const payload: any = {
        custom, tenant_id: tenantId, po_number: num, supplier_id: supplier.id, supplier_name: supplier.name, location_id: f.location_id || null, order_date: f.order_date,
        expected_date: f.expected || null, reference: f.reference.trim() || null, notes: f.notes.trim() || null, terms: f.terms.trim() || null,
        payment_terms: f.payment_terms, shipment_preference: f.shipment.trim() || null, deliver_to: f.deliver_to,
        delivery_customer_id: f.deliver_to === "customer" ? f.delivery_customer_id : null, delivery_address: f.deliver_to === "customer" ? addressText : null,
        subtotal: t.subtotal, tax: t.tax, total: t.total, prices_include_tax: inclusive, status: mode === "issue" && !needs ? "pending" : "draft", updated_at: new Date().toISOString(),
      };
      if (!existing) payload.created_by = user?.id;
      const r = existing ? await sb.from("purchases").update(payload).eq("id", existing.id).select("id").single() : await sb.from("purchases").insert(payload).select("id").single();
      if (r.error) throw r.error;
      const pid = r.data.id;
      if (existing) await sb.from("purchase_items").delete().eq("purchase_id", pid);
      const { error: iErr } = await sb.from("purchase_items").insert(stored.map((l) => ({ purchase_id: pid, product_id: l.item_id, quantity: Math.round(l.quantity), unit_cost: l.rate, total: l.amount })));
      if (iErr) throw iErr;
      for (const file of files) await uploadDocument(tenantId!, file, { entity_type: "purchase_order", entity_id: pid, entity_name: num, category: "Attachment", name: file.name }).catch(() => null);
      if (needs) { await submitForApproval("purchase_order", pid, num, supplier.name, t.total); toast({ title: `${num} sent for approval`, description: send ? "It can be sent to the vendor once approved." : undefined }); }
      else toast({ title: `${num} ${mode === "issue" ? "saved" : "saved as draft"}` });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["purchase-orders-z"] }); qc.invalidateQueries({ queryKey: ["documents"] });
      if (!existing) await linkToContract("purchase_order", pid);
      onDone(pid, send && !needs);
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setSaving(""); }
  };

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <ShoppingBag className="h-5 w-5 text-primary" />
        <h1 className="flex-1 font-display text-xl font-bold">{existing ? `Edit ${existing.po_number}` : "New Purchase Order"}</h1>
        <Button size="icon" variant="ghost" onClick={async () => { if (!dirty || await confirmAction({ title: "Leave without saving?", message: "Your changes will be lost.", confirmLabel: "Leave", danger: true })) onDone(existing?.id); }} aria-label="Close"><X /></Button>
      </div>
      <div className="flex-1 space-y-6 bg-card px-4 py-6 sm:px-6">
        <section className="space-y-3 rounded-2xl bg-muted/40 p-4">
          <BillRow label="Vendor Name" req>
            <div className="flex max-w-xl gap-2">
              <select className="fi" value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}><option value="">Select a Vendor</option>{(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <Button variant="outline" asChild><Link to="/purchases/suppliers/new"><Plus /> New</Link></Button>
            </div>
          </BillRow>
          <BillRow label="Location"><select className="fi max-w-xs" value={f.location_id} onChange={(e) => set({ location_id: e.target.value })}>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></BillRow>
        </section>
        <section className="max-w-3xl space-y-3">
          <BillRow label="Delivery Address" req>
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">{(["location", "customer"] as const).map((k) => <label key={k} className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={f.deliver_to === k} onChange={() => set({ deliver_to: k })} /> {k === "location" ? "Locations" : "Customer"}</label>)}</div>
              {f.deliver_to === "customer" && <select className="fi max-w-xs" value={f.delivery_customer_id} onChange={(e) => set({ delivery_customer_id: e.target.value, delivery_address: "" })}><option value="">Select a customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
              {f.deliver_to === "customer"
                ? <AutoGrowText className="fi max-w-md" value={addressText} onChange={(e) => set({ delivery_address: e.target.value })} placeholder="Delivery address" />
                : <p className="whitespace-pre-line rounded-xl bg-muted/50 px-3 py-2 text-sm">{addressText || "Add the branch address under Locations."}</p>}
            </div>
          </BillRow>
          <BillRow label="Purchase Order#" req><input className="fi max-w-xs bg-muted/40" value={poNumber || "Created when saved"} readOnly title="Numbering is set under Settings → Templates and numbering" /></BillRow>
          <BillRow label="Reference#"><input className="fi max-w-xs" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></BillRow>
          <BillRow label="Date" req><input className="fi max-w-xs" type="date" value={f.order_date} onChange={(e) => set({ order_date: e.target.value })} /></BillRow>
          <div className="grid gap-3 sm:grid-cols-2">
            <BillRow label="Delivery Date"><input className="fi" type="date" value={f.expected} onChange={(e) => set({ expected: e.target.value })} /></BillRow>
            <div className="grid items-start gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"><span className="pt-2 text-sm">Payment Terms</span><select className="fi" value={f.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })}>{TERMS.filter(([l]) => l !== "Custom").map(([l]) => <option key={l}>{l}</option>)}</select></div>
          </div>
          <BillRow label="Shipment Preference"><input className="fi max-w-xs" list="po-shipment" value={f.shipment} onChange={(e) => set({ shipment: e.target.value })} placeholder="Choose or type" />
            <datalist id="po-shipment">{["Vendor delivers", "We collect", "Courier", "Road freight", "Air freight", "Sea freight", "G4S", "Wells Fargo", "Fargo Courier"].map((x) => <option key={x} value={x} />)}</datalist></BillRow>
        </section>
        <ItemTable inclusive={inclusive} onInclusive={(v) => { setDirty(true); setInclusive(v); }} lines={lines} onChange={(v) => { setDirty(true); setLines(v); }} adjustments={adj} onAdjustments={(v) => { setDirty(true); setAdj(v); }} defaultVat={Number((biz as any)?.default_vat_rate || 16)} currency={currencyCode() || "KES"} priceField="cost_price" productsOnly />
        <CustomFieldInputs entity="purchase_order" values={custom} onChange={(v) => { setDirty(true); setCustom(v); }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Field label="Notes" hint="Shown on the purchase order"><AutoGrowText className="fi" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          <Field label="Terms & Conditions"><AutoGrowText className="fi" value={f.terms} onChange={(e) => set({ terms: e.target.value })} placeholder="Delivery, payment and quality terms for the vendor" /></Field>
        </div>
        <div className="max-w-md">
          <p className="mb-1.5 text-sm font-medium">Attach File(s) to Purchase Order</p>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm hover:border-primary"><Paperclip className="h-4 w-4 text-muted-foreground" /> Upload File
            <input type="file" multiple className="hidden" onChange={(e) => { const add = Array.from(e.target.files || []).filter((x) => x.size <= 10 * 1024 * 1024); setFiles((cur) => [...cur, ...add].slice(0, 10)); e.target.value = ""; }} /></label>
          <p className="mt-1 text-xs text-muted-foreground">You can upload a maximum of 10 files, 10MB each.</p>
          {files.length > 0 && <ul className="mt-2 space-y-1 text-sm">{files.map((x, i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1"><Paperclip className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{x.name}</span><button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button></li>)}</ul>}
        </div>
        {approval.rule.enabled && <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckSquare className="h-4 w-4" /> Purchase orders{approval.rule.min_amount ? ` from ${formatKES(Number(approval.rule.min_amount))}` : ""} go for approval before they can be sent.</p>}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6 md:bottom-0">
        <Button variant="outline" onClick={() => save("draft")} disabled={!!saving}>{saving === "draft" && <OrbSpinner />} Save as Draft</Button>
        <Button onClick={() => save("issue", true)} disabled={!!saving}>{saving === "send" && <OrbSpinner />} {approval.rule.enabled ? "Save and Submit" : "Save and Send"}</Button>
        <Button variant="ghost" onClick={() => onDone(existing?.id)}>Cancel</Button>
      </div>
    </div>
  );
}

function PoDetail({ po, onClose }: { po: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const poTenant = useTenantId();
  // Attach: vendors' quotations (or any file) kept with the purchase order.
  const attachInput = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const attach = async (files: FileList | null) => {
    if (!files?.length || !poTenant) return;
    setAttaching(true);
    try {
      for (const f of Array.from(files)) await uploadDocument(poTenant, f, { entity_type: "purchase_order", entity_id: po.id, entity_name: String(po.po_number || ""), category: "Quotation", name: f.name });
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: files.length === 1 ? "File attached" : `${files.length} files attached` });
    } catch (e: any) { toast({ title: "Not attached", description: e.message, variant: "destructive" }); }
    finally { setAttaching(false); if (attachInput.current) attachInput.current.value = ""; }
  };
  const { data: biz } = useBusinessSettings();
  const [receive, setReceive] = useState(false);
  const { data: supplier } = useSupplier(po.supplier_id);
  const [poParams] = useSearchParams();
  const [bill, setBill] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [bf, setBf] = useState({ bill_date: today(), due_date: addDays(today(), 30), reference: "" });
  const [busy, setBusy] = useState("");
  const [label, tone] = poStatus(po);
  const items = po.purchase_items || [];
  const sig = useDocSignature("purchase_order", po.id);
  // Not approved yet, or must be signed first: it cannot go to the supplier.
  const blocked = ["pending", "rejected"].includes(po.approval_status) || sig.blocked;
  const { data: receives = [] } = useQuery({ queryKey: ["po-receives", po.id], queryFn: async () => (await sb.from("purchase_receives").select("*").eq("purchase_id", po.id).order("created_at")).data || [] });
  const { data: bills = [] } = useQuery({ queryKey: ["po-bills", po.id], queryFn: async () => (await sb.from("bills").select("id,bill_number,status,amount,amount_paid,bill_date").eq("purchase_id", po.id)).data || [] });
  const refresh = () => ["purchase-orders-z", "po-receives", "po-bills", "bills-z", "purchase-receives", "products", "product-stocks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const setStatus = async (status: string, msg: string) => {
    const { error } = await sb.from("purchases").update({ status, updated_at: new Date().toISOString() }).eq("id", po.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    toast({ title: msg }); refresh();
  };
  const doReceive = async () => {
    setBusy("receive");
    const lines = items.map((i: any) => ({ item_id: i.id, quantity: Number(qty[i.id] ?? (i.quantity - i.received_quantity)) || 0 }));
    const { data, error } = await sb.rpc("receive_purchase", { p_purchase: po.id, p_lines: lines, p_update_cost: true });
    setBusy("");
    if (error) return toast({ title: "Not received", description: error.message, variant: "destructive" });
    toast({ title: `Received · ${data?.receive_number || ""}`, description: "Stock was added." }); setReceive(false); refresh();
  };
  useEffect(() => { if (poParams.get("bill") && !po.billed) setBill(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const doBill = async (status: "draft" | "open") => {
    setBusy(status);
    const { data, error } = await sb.rpc("convert_po_to_bill", { p_purchase: po.id, p_status: status, p_bill_date: bf.bill_date, p_due_date: bf.due_date || null, p_reference: bf.reference });
    setBusy("");
    if (error) return toast({ title: "Bill not created", description: error.message, variant: "destructive" });
    toast({ title: status === "draft" ? "Bill saved as draft" : "Bill created" }); setBill(false); refresh(); navigate(`/purchases/bills/${data}`);
  };
  // Cancel items: quantities the supplier will not deliver come off the order.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cq, setCq] = useState<Record<string, string>>({});
  const [cReason, setCReason] = useState("");
  const leftOf = (i: any) => Math.max(0, Number(i.quantity) - Number(i.received_quantity) - Number(i.cancelled_quantity || 0));
  const doCancelItems = async () => {
    setBusy("cancel");
    for (const i of items) {
      const n = Math.min(leftOf(i), Math.max(0, Number(cq[i.id] ?? leftOf(i)) || 0));
      if (!n) continue;
      const { error } = await sb.from("purchase_items").update({ cancelled_quantity: Number(i.cancelled_quantity || 0) + n, short_reason: cReason || i.short_reason || "Cancelled" }).eq("id", i.id);
      if (error) { setBusy(""); return toast({ title: "Not cancelled", description: error.message, variant: "destructive" }); }
    }
    const anyReceived = items.some((i: any) => Number(i.received_quantity) > 0);
    const { data: fresh } = await sb.from("purchase_items").select("quantity, received_quantity, cancelled_quantity").eq("purchase_id", po.id);
    const nothingLeft = ((fresh || []) as any[]).every((i) => Number(i.quantity) - Number(i.received_quantity) - Number(i.cancelled_quantity || 0) <= 0);
    if (nothingLeft) await sb.from("purchases").update({ status: anyReceived ? "received" : "cancelled", updated_at: new Date().toISOString() }).eq("id", po.id);
    setBusy(""); setCancelOpen(false); toast({ title: "Items cancelled" }); refresh();
  };
  const remove = async () => {
    if (items.some((i: any) => Number(i.received_quantity) > 0)) return toast({ title: "Part of this order was received", description: "Cancel it instead.", variant: "destructive" });
    if (!(await confirmAction({ title: `Delete ${po.po_number}?`, message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("purchases").delete().eq("id", po.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    toast({ title: "Purchase order deleted" }); refresh(); onClose();
  };
  return (
    <DocPane title={po.po_number || "Purchase order"} subtitle={`${po.supplier_name} · ${fmtDate(po.order_date)}`} onClose={onClose}
      actions={<>
        {po.status === "draft" && !blocked && <Button onClick={() => setStatus("pending", "Purchase order issued")}><Send /> Issue to supplier</Button>}
        {["pending", "partially_received"].includes(po.status) && !blocked && <Button onClick={() => navigate(`/purchases/receives/new?po=${po.id}`)}><PackageCheck /> Receive</Button>}
        {po.status !== "draft" && !blocked && <SupplierShare autoOpen={poParams.get("send") === "1"} kind="po" id={po.id} supplier={supplier} subject={`Purchase order ${po.po_number} from ${biz?.business_name || "us"}`} message={`Hello ${po.supplier_name || ""},\n\nPlease find attached our purchase order ${po.po_number} for ${formatKES(Number(po.total))}.${po.expected_date ? ` We expect delivery by ${fmtDate(po.expected_date)}.` : ""} Kindly confirm availability and delivery.\n\nRegards,\n${biz?.business_name || ""}`} />}
        {!po.billed && !blocked && po.status !== "cancelled" && po.status !== "draft" && <Button variant="outline" onClick={() => setBill(true)}><Receipt /> Convert to bill</Button>}
        {(po.approval_status === "rejected") && <Button variant="outline" onClick={async () => { await submitForApproval("purchase_order", po.id, po.po_number, po.supplier_name, Number(po.total)); refresh(); toast({ title: "Sent for approval" }); }}><CheckSquare /> Submit for approval</Button>}
        {["draft", "pending"].includes(po.status) && !items.some((i: any) => Number(i.received_quantity) > 0) && <Button variant="outline" onClick={() => navigate(`/purchases/orders?edit=${po.id}`)}><Pencil /> Edit</Button>}
        {["draft", "pending"].includes(po.status) && <Button variant="ghost" onClick={async () => { if (await confirmAction({ title: `Cancel ${po.po_number}?`, confirmLabel: "Cancel order", danger: true })) void setStatus("cancelled", "Purchase order cancelled"); }}><Ban /> Cancel</Button>}
        <input ref={attachInput} type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => void attach(e.target.files)} />
        <Button variant="outline" onClick={() => attachInput.current?.click()} disabled={attaching}>{attaching ? <OrbSpinner /> : <Paperclip />} Attach quotes</Button>
        <Button variant="outline" onClick={() => navigate(`/purchases/orders/new?clone=${po.id}`)}><Copy /> Clone</Button>
        {["pending", "partially_received"].includes(po.status) && items.some((i: any) => leftOf(i) > 0) && <Button variant="outline" onClick={() => { setCq({}); setCancelOpen(true); }}><Ban /> Cancel items</Button>}
        {!po.billed && !items.some((i: any) => Number(i.received_quantity) > 0) && <Button variant="ghost" className="ml-auto text-destructive" onClick={remove}><Trash2 /> Delete</Button>}
      </>}>
      <div className="space-y-4">
        <SignBanner sig={sig} number={po.po_number || null} title={`Purchase order ${po.po_number || ""} · ${po.supplier_name || ""}`} amount={Number(po.total || 0)} />
        {cancelOpen && (
          <Modal open onClose={() => setCancelOpen(false)} title="Cancel items" icon={Ban} description="Quantities the supplier will not deliver come off this order. Received items are not affected."
            footer={<Button onClick={() => void doCancelItems()} disabled={busy === "cancel"}>{busy === "cancel" && <OrbSpinner />} Cancel these quantities</Button>}>
            <div className="space-y-2">
              {items.filter((i: any) => leftOf(i) > 0).map((i: any) => (
                <div key={i.id} className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.products?.name}<span className="block text-xs text-muted-foreground">{leftOf(i)} still to come</span></span>
                  <input className="fi h-9 w-24 text-right" type="number" min={0} max={leftOf(i)} value={cq[i.id] ?? String(leftOf(i))} onChange={(e) => setCq({ ...cq, [i.id]: e.target.value })} aria-label={`Cancel quantity for ${i.products?.name}`} />
                </div>
              ))}
              <Field label="Reason"><input className="fi" value={cReason} onChange={(e) => setCReason(e.target.value)} placeholder="Out of stock at the supplier" /></Field>
            </div>
          </Modal>
        )}
        <div className="flex flex-wrap items-center gap-2"><Pill tone={tone}>{label}</Pill>{po.payment_status !== "unpaid" && <Pill tone={po.payment_status === "paid" ? "success" : "info"}>{po.payment_status === "paid" ? "Paid" : "Part paid"}</Pill>}</div>
        {po.approval_status === "pending" && <p className="rounded-xl bg-warning/10 px-3 py-2 text-sm">Waiting for approval. It can be issued and received once approved. <Link className="font-semibold text-primary" to="/approvals">Approvals →</Link></p>}
        <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold">{[["Created", true], ["Approved / issued", po.status !== "draft"], ["Received", ["partially_received", "received"].includes(po.status)], ["Billed", po.billed], ["Paid", po.payment_status === "paid"]].map(([l, on], i) => (
          <li key={String(l)} className="flex items-center gap-2"><span className={cn("rounded-full px-3 py-1", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l as string}</span>{i < 4 && <span className="h-px w-4 bg-border" />}</li>
        ))}</ol>
        <TableWrap><table className="dt"><thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Cancelled</th><th className="num">To come</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
          <tbody>{items.map((i: any) => { const left = Number(i.quantity) - Number(i.received_quantity) - Number(i.cancelled_quantity || 0); return <tr key={i.id}><td className="font-medium">{i.products?.name}{i.short_reason && <span className="block text-xs text-muted-foreground">{i.short_reason}</span>}</td><td className="num">{i.quantity}</td><td className="num">{Number(i.received_quantity)}</td><td className="num">{Number(i.cancelled_quantity || 0) || "—"}</td><td className={cn("num", left > 0 && po.status !== "draft" && "font-semibold text-warning")}>{left}</td><td className="num">{formatKES(Number(i.unit_cost))}</td><td className="num">{formatKES(Number(i.total))}</td></tr>; })}</tbody>
          <tfoot><tr><td colSpan={6}>Total</td><td className="num">{formatKES(Number(po.total))}</td></tr></tfoot></table></TableWrap>
        {po.status === "partially_received" && po.expected_date && <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm"><AlertTriangle className="h-4 w-4 text-warning" /> The rest is expected on <b>{fmtDate(po.expected_date)}</b>. You will be reminded that day.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-1 text-sm font-semibold">Purchase receives</p>{(receives as any[]).length === 0 ? <p className="text-sm text-muted-foreground">Nothing received yet.</p> :
            <ul className="space-y-1 text-sm">{(receives as any[]).map((r) => <li key={r.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><Link to={`/purchases/receives?open=${r.id}`} className="font-semibold text-primary">{r.receive_number}</Link><span>{fmtDate(r.received_date)} · {(r.items || []).reduce((a: number, x: any) => a + Number(x.quantity), 0)} items</span></li>)}</ul>}</div>
          <div><p className="mb-1 text-sm font-semibold">Bills</p>{(bills as any[]).length === 0 ? <p className="text-sm text-muted-foreground">Not billed yet.</p> :
            <ul className="space-y-1 text-sm">{(bills as any[]).map((b) => <li key={b.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><Link to={`/purchases/bills/${b.id}`} className="font-semibold text-primary">{b.bill_number || "Bill"}</Link><span className="capitalize">{billLabel(b)} · {formatKES(Number(b.amount))}</span></li>)}</ul>}</div>
        </div>
        {po.notes && <p className="text-sm"><b>Notes:</b> {po.notes}</p>}
        <DocumentPreview kind="po" id={po.id} version={`${po.status}-${po.updated_at || ""}`} />
        <div className="mt-4"><DocumentsPanel entityType="purchase_order" entityId={po.id} entityName={String(po.po_number || "")} /></div>
      </div>

      <Modal open={receive} onClose={() => setReceive(false)} title="Receive items" description={`${po.po_number} · ${po.supplier_name}`} icon={PackageCheck} size="lg"
        footer={<Button onClick={doReceive} disabled={busy === "receive"}>{busy === "receive" && <OrbSpinner />} Save receive</Button>}>
        <p className="mb-3 text-sm text-muted-foreground">Enter what actually arrived. Stock goes up straight away; the rest stays open on the order.</p>
        <div className="space-y-2">{items.filter((i: any) => i.quantity - i.received_quantity > 0).map((i: any) => (
          <div key={i.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0 flex-1"><p className="font-medium">{i.products?.name}</p><p className="text-xs text-muted-foreground">Ordered {i.quantity} · received {Number(i.received_quantity)} · to come {i.quantity - i.received_quantity}</p></div>
            <input className="fi w-24 text-right" type="number" min={0} max={i.quantity - i.received_quantity} value={qty[i.id] ?? String(i.quantity - i.received_quantity)} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
          </div>
        ))}</div>
      </Modal>
      <Modal open={bill} onClose={() => setBill(false)} title="Convert to bill" description={`${po.po_number} · ${formatKES(Number(po.total))}`} icon={Receipt}
        footer={<><Button variant="outline" onClick={() => doBill("draft")} disabled={!!busy}>{busy === "draft" && <OrbSpinner />} Save as draft</Button><Button onClick={() => doBill("open")} disabled={!!busy}>{busy === "open" && <OrbSpinner />} Save as open</Button></>}>
        <div className="space-y-3">
          <p className="rounded-xl bg-muted/60 p-3 text-sm">{items.some((i: any) => Number(i.received_quantity) > 0) ? "The bill uses the quantities received." : "Nothing was received yet, so the bill uses the quantities ordered."}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill date"><input className="fi" type="date" value={bf.bill_date} onChange={(e) => setBf({ ...bf, bill_date: e.target.value })} /></Field>
            <Field label="Due date"><input className="fi" type="date" value={bf.due_date} onChange={(e) => setBf({ ...bf, due_date: e.target.value })} /></Field>
          </div>
          <Field label="Supplier's invoice number"><input className="fi" value={bf.reference} onChange={(e) => setBf({ ...bf, reference: e.target.value })} /></Field>
        </div>
      </Modal>
    </DocPane>
  );
}

/* ───────────────────────────── Purchase receives ───────────────────────────── */

export function PurchaseReceives() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["purchase-receives", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("purchase_receives").select("*, purchases(po_number)").eq("tenant_id", tenantId).order("received_date", { ascending: false, nullsFirst: false }).order("receive_number", { ascending: false }).order("created_at", { ascending: false }).limit(3000)).data || []) as any[],
  });
  const rows = data.filter((r) => !q.trim() || `${r.receive_number} ${r.supplier_name} ${r.purchases?.po_number}`.toLowerCase().includes(q.trim().toLowerCase()));
  const paged = usePaged(rows, 20);
  const [open, setOpen] = useState<any>(null);
  const [rp] = useSearchParams();
  const openId = rp.get("open");
  const shown = open || (openId ? data.find((r) => r.id === openId) : null);
  const [pickPo, setPickPo] = useState(false);
  const { data: openPos = [] } = useQuery({ queryKey: ["receivable-pos", tenantId], enabled: !!tenantId && pickPo,
    queryFn: async () => ((await sb.from("purchases").select("id,po_number,supplier_name,order_date,total").eq("tenant_id", tenantId).in("status", ["pending", "partially_received"]).order("order_date", { ascending: false }).limit(200)).data || []) as any[] });
  if (isLoading) return <OrbLoader label="Loading receives…" />;
  if (shown) return (
    <SplitView heading="All Purchase Receives" rows={rows.map((r: any) => ({ id: r.id, href: `/purchases/receives?open=${r.id}`, title: r.supplier_name || "—", sub: `${r.receive_number} · ${r.purchases?.po_number || ""} · ${fmtDate(r.received_date)}`, status: (r.shortfall || []).length ? "short" : "received", tone: (r.shortfall || []).length ? "danger" : "success" }))} activeId={shown.id}>
      <ReceiveDetail r={shown} onClose={() => { setOpen(null); navigate("/purchases/receives"); }} />
    </SplitView>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Purchase Receives" icon={PackageCheck} description="Goods received against purchase orders (GRNs). Receive from a purchase order."
        actions={<><ImportExport entity="purchase_receives" rows={data.map((r) => ({ receive_number: r.receive_number, po_number: r.purchases?.po_number, supplier: r.supplier_name, date: r.received_date, items: (r.items || []).map((i: any) => `${i.quantity}× ${i.name}`).join("; "), received_by: r.created_by_name }))} /><Button onClick={() => setPickPo(true)}><Plus /> New</Button></>} />
      {pickPo && (
        <Modal open onClose={() => setPickPo(false)} title="New purchase receive" icon={PackageCheck} description="Choose the purchase order the goods came for.">
          {!openPos.length ? <p className="text-sm text-muted-foreground">No purchase order is waiting for goods. Issue one first.</p> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">{openPos.map((o: any) => (
              <li key={o.id}><button type="button" className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left text-sm hover:border-primary" onClick={() => navigate(`/purchases/receives/new?po=${o.id}`)}>
                <span className="flex-1"><b>{o.po_number}</b> · {o.supplier_name}<span className="block text-xs text-muted-foreground">{fmtDate(o.order_date)}</span></span><span className="tabular-nums">{formatKES(Number(o.total))}</span></button></li>
            ))}</ul>
          )}
        </Modal>
      )}
      <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Receive#, PO# or supplier…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={PackageCheck} title="Nothing received yet" description="Open a purchase order and press Receive when the goods arrive." /> : <>
          <TableWrap><table className="dt"><thead><tr><th>Date</th><th>Receive#</th><th>PO#</th><th>Supplier</th><th className="num">Items</th><th>Delivery</th><th className="hidden md:table-cell">Received by</th></tr></thead>
            <tbody>{paged.rows.map((r: any) => <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/purchases/receives?open=${r.id}`)}><td>{fmtDate(r.received_date)}</td><td className="font-semibold text-primary">{r.receive_number}</td><td><Link onClick={(e) => e.stopPropagation()} to={`/purchases/orders/${r.purchase_id}`} className="hover:text-primary">{r.purchases?.po_number}</Link></td><td>{r.supplier_name}</td><td className="num">{(r.items || []).reduce((a: number, i: any) => a + Number(i.quantity), 0)}</td><td>{(r.shortfall || []).length ? <Pill tone="warning">{(r.shortfall || []).reduce((a: number, x: any) => a + Number(x.quantity), 0)} short</Pill> : <Pill tone="success">Complete</Pill>}</td><td className="hidden md:table-cell">{r.created_by_name || "—"}</td></tr>)}</tbody></table></TableWrap>
          <Pager {...paged.pager} />
        </>}
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Bills ───────────────────────────── */

export function billLabel(b: any) {
  if (b.status === "draft") return "draft";
  if (b.status === "void") return "void";
  if (b.status === "paid") return "paid";
  if (b.due_date && b.due_date < today() && Number(b.amount) - Number(b.amount_paid) > 0.005) return "overdue";
  if (b.status === "partial") return "partially paid";
  return "open";
}
const BILL_TONE: Record<string, "muted" | "info" | "warning" | "success" | "danger"> = { draft: "muted", open: "info", "partially paid": "warning", overdue: "danger", paid: "success", void: "muted" };

export function Bills() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const [q, setQ] = useState("");
  const [view, setView] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["bills-z", tenantId], enabled: !!tenantId,
    queryFn: async () => ((await sb.from("bills").select("*, suppliers(name)").eq("tenant_id", tenantId).order("bill_date", { ascending: false, nullsFirst: false }).order("bill_number", { ascending: false }).order("created_at", { ascending: false }).limit(3000)).data || []) as any[],
  });
  const rows = data.filter((b) => (view === "all" || billLabel(b) === view) && (!q.trim() || `${b.bill_number} ${b.name} ${b.suppliers?.name || ""} ${b.reference || ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const paged = usePaged(rows, 20);
  const sel = useSelection(paged.rows.map((b: any) => b.id));
  const bulk = useBulkDocs("bills", ["bills-z"]);
  const picked = data.filter((b) => sel.has(b.id));
  const signRule = useSigningRule("bill");
  if (isLoading) return <OrbLoader label="Loading bills…" />;
  if (id === "new") {
    const src = data.find((b) => b.id === new URLSearchParams(window.location.search).get("clone"));
    return <BillForm source={src} onDone={(bid) => navigate(bid ? `/purchases/bills/${bid}` : "/purchases/bills")} />;
  }
  const editing = new URLSearchParams(window.location.search).get("edit") === "1" ? data.find((b) => b.id === id) : null;
  if (editing) return <BillForm source={editing} existing onDone={(bid) => navigate(`/purchases/bills/${bid || editing.id}`)} />;
  const selected = id ? data.find((b) => b.id === id) : null;
  const owed = data.filter((b) => !["draft", "void", "paid"].includes(b.status));
  const views: [string, string][] = [["all", "All Bills"], ["draft", "Draft"], ["open", "Open"], ["partially paid", "Partially Paid"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]];
  const totalAmt = rows.reduce((acc, x) => acc + Number(x.amount || 0), 0);
  const totalDue = rows.reduce((acc, x) => acc + Math.max(0, Number(x.amount) - Number(x.amount_paid)), 0);
  // Laid out like the invoices page: one panel, the list in full, or a narrow list beside the open bill.
  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="inline-flex items-center gap-1.5 font-display text-lg font-bold">{views.find(([v]) => v === view)?.[1]} <ChevronDown className="h-4 w-4 text-primary" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">{views.map(([v, l]) => <DropdownMenuItem key={v} onSelect={() => setView(v)} className={cn(view === v && "font-semibold text-primary")}>{l}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {!selected && (
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bills…" className="fi h-9 w-64 rounded-full pl-9" />
          </div>
        )}
        {!selected && <ImportExport entity="bills" rows={data.map((x) => ({ bill_number: x.bill_number, supplier: x.suppliers?.name, bill_date: x.bill_date, due_date: x.due_date, status: billLabel(x), amount: x.amount, paid: x.amount_paid, reference: x.reference }))} />}
        <Button size="sm" onClick={() => navigate("/purchases/bills/new")}><Plus /> New</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 xl:block" : "w-full")}>
          {rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No bills yet" description="Record what you owe your vendors: upload their invoice and the bill fills itself in." className="m-6" />
          ) : selected ? (
            <ul>{(paged.rows as any[]).map((x) => { const st = billLabel(x); return (
              <li key={x.id}><Link to={`/purchases/bills/${x.id}`} className={cn("block border-b border-border px-4 py-3 transition-colors hover:bg-muted/50", x.id === selected.id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{x.suppliers?.name || "Vendor"}</span><span className="text-sm font-semibold tabular-nums">{formatKES(Number(x.amount || 0))}</span></div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{x.bill_number || x.name} · {fmtDate(x.bill_date || x.created_at)}</span><Pill tone={BILL_TONE[st]}>{st}</Pill></div>
              </Link></li>
            ); })}<li><Pager {...paged.pager} /></li></ul>
          ) : (
            <>
              <BulkBar sel={sel} noun="bill">
                {!signRule.enabled && <Button size="sm" variant="outline" onClick={async () => { if (await bulk.set(picked.filter((x) => x.status === "draft").map((x) => x.id), { status: "open" }, "marked open")) sel.clear(); }}><CheckCircle2 /> Mark open</Button>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline">More <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => downloadCsv("bills.csv", ["Bill#", "Date", "Vendor", "Due", "Status", "Amount", "Paid", "Balance"], picked.map((x) => [x.bill_number || x.name, x.bill_date, x.suppliers?.name, x.due_date, billLabel(x), x.amount, x.amount_paid, Number(x.amount) - Number(x.amount_paid)]))}><Download /> Export selected</DropdownMenuItem>
                    <DropdownMenuItem onSelect={async () => { if (await confirmAction({ title: "Void the selected bills?", message: "Bills with payments are skipped.", danger: true, confirmLabel: "Void" }) && await bulk.set(picked.filter((x) => Number(x.amount_paid) <= 0 && x.status !== "void").map((x) => x.id), { status: "void" }, "voided")) sel.clear(); }}><Ban /> Void</DropdownMenuItem>
                    <DropdownMenuItem danger onSelect={async () => { if (await bulk.remove(picked.filter((x) => x.status === "draft").map((x) => x.id), "bill")) sel.clear(); }}><Trash2 /> Delete drafts</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </BulkBar>
              <PhoneDocCards onOpen={(rid) => navigate(`/purchases/bills/${rid}`)} rows={(paged.rows as any[]).map((x) => { const st = billLabel(x); return {
                id: x.id, number: x.bill_number || x.name, party: x.suppliers?.name || "", date: fmtDate(x.bill_date || x.created_at),
                due: x.due_date ? fmtDate(x.due_date) : null, amount: formatKES(Number(x.amount || 0)),
                balance: !["paid", "void"].includes(st) ? formatKES(Math.max(0, Number(x.amount) - Number(x.amount_paid))) : null,
                status: <span className={cn("text-[11px] font-semibold uppercase", st === "overdue" && "text-destructive", st === "paid" && "text-success", st === "draft" && "text-muted-foreground", st === "open" && "text-info")}>{st}</span>,
              }; })} />
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[800px] text-sm">
                  <thead className="sticky top-0 z-[1] bg-card"><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="w-10 px-3 py-2.5 text-left"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} label="Select all on this page" /></th>
                    <th className="px-4 py-2.5 text-left">Date</th><th className="px-4 py-2.5 text-left">Bill#</th><th className="px-4 py-2.5 text-left">Reference Number</th><th className="px-4 py-2.5 text-left">Vendor Name</th>
                    <th className="px-4 py-2.5 text-left">Status</th><th className="px-4 py-2.5 text-left">Due Date</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Balance Due</th>
                  </tr></thead>
                  <tbody>{(paged.rows as any[]).map((x) => { const st = billLabel(x); return (
                    <tr key={x.id} onClick={() => navigate(`/purchases/bills/${x.id}`)} className={cn("cursor-pointer border-b border-border transition-colors hover:bg-muted/40", sel.has(x.id) && "bg-primary/5")}>
                      <td className="w-10 px-3 py-3"><Tick on={sel.has(x.id)} onChange={() => sel.toggle(x.id)} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(x.bill_date || x.created_at)}</td>
                      <td className="px-4 py-3 font-semibold text-primary">{x.bill_number || x.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{x.reference || ""}</td>
                      <td className="px-4 py-3 font-medium">{x.suppliers?.name || "—"}</td>
                      <td className="px-4 py-3"><span className={cn("text-xs font-semibold uppercase", st === "overdue" && "text-destructive", st === "paid" && "text-success", st === "draft" && "text-muted-foreground", st === "open" && "text-info")}>{st}</span></td>
                      <td className="px-4 py-3 text-muted-foreground">{x.due_date ? fmtDate(x.due_date) : "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKES(Number(x.amount || 0))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(Math.max(0, Number(x.amount) - Number(x.amount_paid)))}</td>
                    </tr>
                  ); })}</tbody>
                </table>
              </div>
              <Pager {...paged.pager} summary={<>
                <span>Total <b className="text-foreground">{formatKES(totalAmt)}</b></span>
                <span>Balance due <b className="text-foreground">{formatKES(totalDue)}</b></span>
                <span>Overdue <b className="text-destructive">{formatKES(data.filter((x) => billLabel(x) === "overdue").reduce((acc, x) => acc + Number(x.amount) - Number(x.amount_paid), 0))}</b></span>
              </>} />
            </>
          )}
        </div>
        {selected && <BillDetail bill={selected} onClose={() => navigate("/purchases/bills")} />}
        {id && id !== "new" && !selected && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">That bill was not found.</div>}
      </div>
    </div>
  );
}

/** A label on the left, the field on the right (Zoho's form layout). */
function BillRow({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div className="grid items-start gap-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4"><span className={cn("pt-2 text-sm", req && "text-destructive")}>{label}{req ? "*" : ""}</span><div>{children}</div></div>;
}
const TERMS: [string, number][] = [["Due on Receipt", 0], ["Net 7", 7], ["Net 15", 15], ["Net 30", 30], ["Net 45", 45], ["Net 60", 60], ["Due end of the month", -1], ["Due end of next month", -2], ["Custom", -3]];
const dueFor = (from: string, term: string) => {
  const t = TERMS.find(([l]) => l === term)?.[1];
  if (t === undefined || t === -3) return null;
  const d = new Date(`${from}T00:00:00`);
  if (t === -1) return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  if (t === -2) return new Date(d.getFullYear(), d.getMonth() + 2, 0).toISOString().slice(0, 10);
  return addDays(from, t);
};

/**
 * New / edit bill, laid out like Zoho's: the vendor's invoice can be dropped at the top (Garage AI fills the bill in and
 * the document stays beside the form to check against), or skipped to type it. Files are attached to the bill.
 */
function BillForm({ onDone, source, existing }: { onDone: (id?: string) => void; source?: any; existing?: boolean }) {
  const customFields = useCustomFields("bill");
  const [custom, setCustom] = useState<CustomValues>(source?.custom || {});
  const billTags = useModuleTags("bills");
  const [tags, setTags] = useState<TagValues>(source?.tags || {});
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: biz } = useBusinessSettings();
  const { data: suppliers = [] } = useSuppliers();
  const { data: locations = [] } = useLocations();
  const approval = useApprovalRule("bill");
  const fresh = !source;
  const [f, setF] = useState(() => source ? {
    supplier_id: source.supplier_id || "", location_id: source.location_id || "", bill_date: existing ? source.bill_date || today() : today(),
    due_date: existing ? source.due_date || "" : addDays(today(), 30), terms: source.payment_terms || "Net 30", reference: existing ? source.reference || "" : "",
    order_number: existing ? source.order_number || "" : "", subject: source.subject || "", notes: source.notes || "", category: source.category || "Supplies",
  } : { supplier_id: new URLSearchParams(window.location.search).get("supplier") || "", location_id: "", bill_date: today(), due_date: today(), terms: "Due on Receipt", reference: "", order_number: "", subject: "", notes: "", category: "Supplies" });
  const [lines, setLines] = useState<EditLine[]>(() => source && Array.isArray(source.items) && source.items.length ? toEditLines(source.items) : [newLine()]);
  const [adj, setAdj] = useState<Adjustments>({ discount: 0, shipping: 0, adjustment: 0 });
  const taxDefaultsB = useTaxSettings();
  const [inclusive, setInclusive] = useState<boolean>(() => (source ? !!source.prices_include_tax : !!taxDefaultsB.pricesIncludeTax));
  const [busy, setBusy] = useState("");
  // The vendor's document: dropped at the top, read by Garage AI, shown beside the form, attached on save.
  const [doc, setDoc] = useState<{ file: File; url: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [skipUpload, setSkipUpload] = useState(!fresh);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [readNote, setReadNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!f.location_id && (locations as any[]).length) setF((x) => ({ ...x, location_id: ((locations as any[]).find((l) => l.is_main) || (locations as any[])[0]).id })); }, [locations]); // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedGuard(!busy && (lines.some((l) => l.name) || !!doc));
  const set = (p: Partial<typeof f>) => setF((x) => {
    const n = { ...x, ...p };
    if ((p.bill_date !== undefined || p.terms !== undefined) && n.terms !== "Custom") { const d = dueFor(n.bill_date, n.terms); if (d) n.due_date = d; }
    return n;
  });

  const readFile = async (file: File) => {
    if (!/^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(file.type)) return toast({ title: "Upload a PDF or a photo (JPG, PNG)", variant: "destructive" });
    setDoc({ file, url: URL.createObjectURL(file) });
    setSkipUpload(true);
    if (!tenantId) return;
    setReading(true); setReadNote("");
    try {
      const x = await readSupplierInvoice(file);
      const v = await vendorFor(tenantId, x);
      if (v?.added) { void qc.invalidateQueries({ queryKey: ["suppliers"] }); void qc.invalidateQueries({ queryKey: ["suppliers-z"] }); void qc.invalidateQueries({ queryKey: ["suppliers-list"] }); void qc.invalidateQueries({ queryKey: ["purchase-suppliers"] }); }
      const r = billLinesFrom(x);
      const date = r.date || today();
      const days = r.due && r.date ? Math.round((Date.parse(r.due) - Date.parse(r.date)) / 86400000) : null;
      const term = days === null ? "Due on Receipt" : TERMS.find(([, d]) => d === days)?.[0] || "Custom";
      setF((s) => ({ ...s, supplier_id: v?.id || s.supplier_id, bill_date: date, due_date: r.due || date, terms: term, reference: r.reference || s.reference, category: r.category || s.category, subject: s.subject || String(x.description || "").slice(0, 200) }));
      setLines(r.lines.map((l) => ({ ...newLine(), ...l })));
      setReadNote(`${v?.added ? `${v.name} was added to Vendors. ` : ""}Check the details against the document, then save.`);
    } catch (e: any) {
      setReadNote(`Garage AI could not read it (${e.message}). The document is attached: fill the bill in beside it.`);
    } finally { setReading(false); }
  };

  const save = async (status: "draft" | "open") => {
    const sup = (suppliers as any[]).find((s) => s.id === f.supplier_id);
    if (!sup) return toast({ title: "Choose the vendor", variant: "destructive" });
    if (!f.reference.trim() && status === "open") return toast({ title: "Enter the Bill# (the vendor's invoice number)", variant: "destructive" });
    const stored = toStoredLines(lines);
    if (!stored.length) return toast({ title: "Add at least one line", variant: "destructive" });
    const missingCustom = missingCustomField(customFields, custom);
    if (missingCustom) return toast({ title: `Fill in ${missingCustom}`, variant: "destructive" });
    const missingT = missingTag(billTags, "bills", tags);
    if (missingT) return toast({ title: `Choose ${missingT}`, variant: "destructive" });
    setBusy(status);
    try {
      const t = editTotals(lines, adj, inclusive);
      const head = {
        category: f.category, amount: t.total, subtotal: t.subtotal, tax: t.tax, prices_include_tax: inclusive, items: stored, supplier_id: sup.id, location_id: f.location_id || null,
        bill_date: f.bill_date, due_date: f.due_date || null, payment_terms: f.terms, reference: f.reference.trim() || null, order_number: f.order_number.trim() || null,
        subject: f.subject.trim() || null, notes: f.notes || null, custom, tags: cleanTags(tags),
      };
      let billId = source?.id as string | undefined; let num = source?.bill_number as string | undefined;
      if (existing && source) {
        const { error } = await sb.from("bills").update({ ...head, name: `${sup.name} · ${source.bill_number || ""}`, status: status === "draft" ? "draft" : source.status === "draft" ? "pending" : source.status }).eq("id", source.id);
        if (error) throw error;
      } else {
        const { data: n, error: nErr } = await sb.rpc("next_doc_number", { p_kind: "bill" });
        if (nErr) throw nErr;
        num = n;
        const { data, error } = await sb.from("bills").insert({ ...head, tenant_id: tenantId, name: `${sup.name} · ${num}`, bill_number: num, status: status === "draft" ? "draft" : "pending", created_by: user?.id }).select("id").single();
        if (error) throw error;
        billId = data.id;
        if (approval.needs(t.total)) await submitForApproval("bill", data.id, num!, sup.name, t.total);
        await linkToContract("bill", data.id);
      }
      // The vendor's invoice and any other files stay with the bill.
      const toAttach = [...(doc ? [doc.file] : []), ...files];
      for (const file of toAttach) await uploadDocument(tenantId!, file, { entity_type: "bill", entity_id: billId!, entity_name: num || "", category: file === doc?.file ? "Vendor invoice" : "Attachment", name: file.name }).catch(() => null);
      qc.invalidateQueries({ queryKey: ["bills-z"] }); qc.invalidateQueries({ queryKey: ["documents"] }); qc.invalidateQueries({ queryKey: ["payables"] });
      toast({ title: existing ? `Bill ${num || ""} updated` : `Bill ${num} saved`, description: toAttach.length ? `${toAttach.length} file${toAttach.length === 1 ? "" : "s"} attached` : undefined });
      onDone(billId);
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  };

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6"><Receipt className="h-5 w-5 text-primary" /><h1 className="flex-1 font-display text-xl font-bold">{existing ? `Edit ${source?.bill_number || "bill"}` : "New Bill"}</h1><Button size="icon" variant="ghost" onClick={() => onDone()} aria-label="Close"><X /></Button></div>
      <div className={cn("flex-1 gap-6 bg-card px-4 py-6 sm:px-6", doc && "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(360px,42%)]")}>
        <div className="min-w-0 space-y-6">
          {!skipUpload && (
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files?.[0]; if (file) void readFile(file); }}
              className={cn("flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors", drag ? "border-primary bg-primary/10" : "border-primary/40 bg-primary/[0.03]")}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><UploadCloud className="h-6 w-6" /></span>
              <div><p className="font-display text-lg font-bold">Drop the vendor's invoice here</p>
                <p className="text-sm text-muted-foreground">PDF or photo. Garage AI fills in the vendor (added if new), Bill#, dates, lines and VAT. You check and save.</p></div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => fileInput.current?.click()}><Sparkles /> Upload invoice</Button>
                <Button variant="outline" onClick={() => setSkipUpload(true)}>Skip, I'll fill it in</Button>
              </div>
              <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); e.target.value = ""; }} />
            </div>
          )}
          {reading && <p className="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm"><OrbSpinner state="working" /> Garage AI is reading {doc?.file.name}…</p>}
          {readNote && !reading && <p className="rounded-xl bg-success/10 px-3 py-2 text-sm">{readNote}</p>}
          {skipUpload && !doc && fresh && <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary" onClick={() => setSkipUpload(false)}><UploadCloud className="h-4 w-4" /> Upload the vendor's invoice instead</button>}

          <section className="space-y-3 rounded-2xl bg-muted/40 p-4">
            <BillRow label="Vendor Name" req><select className="fi" value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}><option value="">Select a Vendor</option>{(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></BillRow>
            {(locations as any[]).length > 1 && <BillRow label="Location"><select className="fi" value={f.location_id} onChange={(e) => set({ location_id: e.target.value })}>{(locations as any[]).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></BillRow>}
          </section>
          <section className="max-w-3xl space-y-3">
            <BillRow label="Bill#" req><input className="fi" value={f.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="The vendor's invoice number" /></BillRow>
            <BillRow label="Order Number"><input className="fi" value={f.order_number} onChange={(e) => set({ order_number: e.target.value })} /></BillRow>
            <BillRow label="Bill Date" req><input className="fi" type="date" value={f.bill_date} onChange={(e) => set({ bill_date: e.target.value })} /></BillRow>
            <div className="grid gap-3 sm:grid-cols-2">
              <BillRow label="Due Date"><input className="fi" type="date" value={f.due_date} onChange={(e) => setF((x) => ({ ...x, due_date: e.target.value, terms: "Custom" }))} /></BillRow>
              <div className="grid items-start gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"><span className="pt-2 text-sm">Payment Terms</span><select className="fi" value={f.terms} onChange={(e) => set({ terms: e.target.value })}>{TERMS.map(([l]) => <option key={l}>{l}</option>)}</select></div>
            </div>
            <BillRow label="Description"><AutoGrowText className="fi" value={f.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="What this bill is for" /></BillRow>
            <BillRow label="Category"><input className="fi" value={f.category} onChange={(e) => set({ category: e.target.value })} /></BillRow>
          </section>
          <ItemTable inclusive={inclusive} onInclusive={setInclusive} lines={lines} onChange={setLines} adjustments={adj} onAdjustments={setAdj} defaultVat={Number((biz as any)?.default_vat_rate || 16)} currency={currencyCode() || "KES"} priceField="cost_price" />
          <CustomFieldInputs entity="bill" values={custom} onChange={setCustom} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />
          <TagPickers module="bills" values={tags} onChange={setTags} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Field label="Notes" hint="It will not be shown in the PDF"><AutoGrowText className="fi" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Attach File(s) to Bill</p>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm hover:border-primary"><Paperclip className="h-4 w-4 text-muted-foreground" /> Upload File
                <input type="file" multiple className="hidden" onChange={(e) => { const add = Array.from(e.target.files || []).filter((x) => x.size <= 10 * 1024 * 1024); setFiles((cur) => [...cur, ...add].slice(0, doc ? 4 : 5)); e.target.value = ""; }} /></label>
              <p className="mt-1 text-xs text-muted-foreground">You can upload a maximum of 5 files, 10MB each.</p>
              {(doc || files.length > 0) && <ul className="mt-2 space-y-1 text-sm">
                {doc && <li className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1"><FileText className="h-4 w-4 text-primary" /><span className="flex-1 truncate">{doc.file.name}</span><span className="text-xs text-muted-foreground">vendor invoice</span></li>}
                {files.map((x, i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1"><Paperclip className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{x.name}</span><button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button></li>)}
              </ul>}
            </div>
          </div>
        </div>
        {doc && (
          <aside className="mt-6 min-w-0 xl:mt-0">
            <div className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-muted/30">
              <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 text-sm"><FileText className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate font-medium">{doc.file.name}</span>
                <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-destructive" onClick={() => { URL.revokeObjectURL(doc.url); setDoc(null); setReadNote(""); setSkipUpload(false); }}>Remove</button></div>
              {doc.file.type === "application/pdf"
                ? <iframe src={doc.url} title="Vendor invoice" className="h-[calc(100svh-14rem)] min-h-[520px] w-full bg-white" />
                : <img src={doc.url} alt="Vendor invoice" className="max-h-[calc(100svh-14rem)] w-full object-contain" />}
            </div>
          </aside>
        )}
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6 md:bottom-0">
        <Button variant="outline" onClick={() => save("draft")} disabled={!!busy || reading}>{busy === "draft" && <OrbSpinner />} Save as Draft</Button>
        <Button onClick={() => save("open")} disabled={!!busy || reading}>{busy === "open" && <OrbSpinner />} Save as Open</Button>
        <Button variant="ghost" onClick={() => onDone()}>Cancel</Button>
      </div>
    </div>
  );
}

function BillDetail({ bill, onClose }: { bill: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pay, setPay] = useState(false);
  const [p, setP] = useState({ amount: String(Math.max(0, Number(bill.amount) - Number(bill.amount_paid))), method: "mpesa", reference: "", paid_on: today(), through: "" });
  const { data: moneyAccounts = [] } = useMoneyAccounts();
  const [busy, setBusy] = useState(false);
  const st = billLabel(bill);
  const balance = Math.max(0, Number(bill.amount) - Number(bill.amount_paid));
  const sig = useDocSignature("bill", bill.id);
  const blocked = ["pending", "rejected"].includes(bill.approval_status) || sig.blocked;
  const { data: payments = [] } = useQuery({ queryKey: ["bill-payments", bill.id], queryFn: async () => (await sb.from("supplier_payments").select("*").eq("bill_id", bill.id).order("paid_on")).data || [] });
  const { data: credits = [] } = useQuery({ queryKey: ["vendor-credits", "for-bill", bill.supplier_id], enabled: !!bill.supplier_id, queryFn: async () => ((await sb.from("vendor_credits").select("id,credit_number,amount,amount_applied,amount_refunded").eq("supplier_id", bill.supplier_id).eq("status", "open")).data || []) as any[] });
  const navigateB = useNavigate();
  const [recurOpen, setRecurOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [expectOpen, setExpectOpen] = useState(false);
  const [expected, setExpected] = useState(bill.expected_payment_date || bill.due_date || today());
  const { data: supplierB } = useSupplier(bill.supplier_id);
  const taxB = useTaxSettings();
  const applyCredit = async (c: any) => {
    const left = Number(c.amount) - Number(c.amount_applied) - Number(c.amount_refunded);
    const amt = Math.min(left, balance);
    if (!(amt > 0)) return;
    if (!(await confirmAction({ title: `Apply ${formatKES(amt)} from ${c.credit_number}?`, message: "It reduces what you owe on this bill." }))) return;
    const { error } = await sb.rpc("apply_vendor_credit", { p_credit: c.id, p_bill: bill.id, p_amount: amt });
    if (error) return toast({ title: "Not applied", description: error.message, variant: "destructive" });
    toast({ title: "Vendor credit applied" }); refresh(); qc.invalidateQueries({ queryKey: ["vendor-credits"] });
  };
  const refresh = () => ["bills-z", "bill-payments", "supplier-payments", "purchase-orders-z"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const update = async (patch: any, msg: string) => { const { error } = await sb.from("bills").update(patch).eq("id", bill.id); if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" }); toast({ title: msg }); refresh(); };
  // Withholding VAT we keep from a vendor marked as withholding (paid to KRA); the bill is settled in full.
  const whOn = taxB.withholding.enabled && taxB.withholding.appliesTo !== "customers" && !!(supplierB as any)?.withholding_vat;
  const [withheld, setWithheld] = useState("");
  const openPay = () => {
    if (whOn) {
      const share = Number(bill.amount) > 0 && Number(bill.subtotal) > 0 ? Number(bill.subtotal) / Number(bill.amount) : 1 / 1.16;
      const w = Math.round(balance * share * taxB.withholding.rate) / 100;
      setWithheld(String(w)); setP((x) => ({ ...x, amount: String(Math.round((balance - w) * 100) / 100) }));
    }
    setPay(true);
  };
  const doPay = async () => {
    setBusy(true);
    const wht = whOn ? Math.max(0, Number(withheld) || 0) : 0;
    const { error } = await sb.rpc("record_bill_payment", { p_bill: bill.id, p_amount: Number(p.amount) + wht, p_method: p.method, p_reference: p.reference || null, p_paid_on: p.paid_on, p_notes: null });
    // Withholding VAT and the account paid from are set on the new payment (it re-posts to the books).
    if (!error && (wht > 0 || p.through)) {
      const { data: last } = await sb.from("supplier_payments").select("id").eq("bill_id", bill.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (last?.id) await sb.from("supplier_payments").update({ ...(wht > 0 ? { withholding_vat: wht } : {}), ...(p.through ? { paid_through: p.through } : {}) }).eq("id", last.id);
    }
    setBusy(false);
    if (error) return toast({ title: "Payment not recorded", description: error.message, variant: "destructive" });
    toast({ title: "Payment recorded" }); setPay(false); refresh();
  };
  return (
    <DocPane title={bill.bill_number || bill.name} subtitle={`${bill.suppliers?.name || ""} · ${fmtDate(bill.bill_date || bill.created_at)}`} onClose={onClose}
      actions={<>
        {bill.status === "draft" && !blocked && <Button onClick={() => update({ status: "pending" }, "Bill opened")}><CheckCircle2 /> Mark as open</Button>}
        {!["draft", "void", "paid"].includes(bill.status) && balance > 0 && !blocked && <Button onClick={openPay}><Wallet /> Record payment</Button>}
        {bill.approval_status === "rejected" && <Button variant="outline" onClick={async () => { await submitForApproval("bill", bill.id, bill.bill_number, bill.suppliers?.name || "", Number(bill.amount)); refresh(); }}><CheckSquare /> Submit for approval</Button>}
        {bill.status !== "void" && <Button variant="outline" onClick={() => navigateB(`/purchases/vendor-credits/new?bill=${bill.id}`)}><FileMinus /> Vendor credit</Button>}
        {!["draft", "void"].includes(bill.status) && bill.etims_status !== "signed" && <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await erpApiB("etims/report-bill", { id: bill.id }); toast({ title: "Reported to KRA eTIMS" }); refresh(); }
          catch (e: any) { toast({ title: "Not reported to KRA", description: e.message, variant: "destructive" }); }
          finally { setBusy(false); }
        }}><ShieldCheck /> Report to KRA</Button>}
        <SupplierShare kind="bill" id={bill.id} supplier={supplierB} subject={`Bill ${bill.bill_number || ""}`} message={`Hello ${bill.suppliers?.name || ""},\n\nWe have recorded your invoice ${bill.reference || ""} as bill ${bill.bill_number || ""} for ${formatKES(Number(bill.amount))}${bill.due_date ? `, due ${fmtDate(bill.due_date)}` : ""}. Balance: ${formatKES(balance)}.\n\nThank you.`} compact />
        {Number(bill.amount_paid) === 0 && bill.status !== "void" && <Button variant="outline" onClick={() => navigateB(`/purchases/bills/${bill.id}?edit=1`)}><Pencil /> Edit</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="font-semibold" aria-label="More actions"><MoreHorizontal className="!h-5 !w-5" /> More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!bill.is_recurring && bill.status !== "void" && <DropdownMenuItem onSelect={() => setRecurOpen(true)}><Repeat /> Make Recurring</DropdownMenuItem>}
            {!["paid", "void"].includes(bill.status) && <DropdownMenuItem onSelect={() => setExpectOpen(true)}><CalendarClock /> Expected Payment Date</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => navigateB(`/purchases/bills/new?clone=${bill.id}`)}><Copy /> Clone</DropdownMenuItem>
            {bill.purchase_id && <DropdownMenuItem onSelect={() => navigateB(`/purchases/orders/${bill.purchase_id}`)}><ShoppingBag /> View Purchase Order</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => setJournalOpen(true)}><BookOpenCheck /> View Journal</DropdownMenuItem>
            {Number(bill.amount_paid) === 0 && <DropdownMenuItem danger onSelect={async () => { if (await confirmAction({ title: `Delete ${bill.bill_number || "this bill"}?`, message: "Its journal entry is removed too.", danger: true, confirmLabel: "Delete" })) { const { error } = await sb.from("bills").delete().eq("id", bill.id); if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" }); refresh(); onClose(); } }}><Trash2 /> Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        {Number(bill.amount_paid) === 0 && bill.status !== "void" && <Button variant="ghost" onClick={async () => { if (await confirmAction({ title: "Void this bill?", danger: true, confirmLabel: "Void" })) { await update({ status: "void" }, "Bill voided"); if (bill.purchase_id) await sb.from("purchases").update({ billed: false }).eq("id", bill.purchase_id); } }}><Ban /> Void</Button>}
      </>}>
      <div className="space-y-4">
        <SignBanner sig={sig} number={bill.bill_number || null} title={`Bill ${bill.bill_number || ""} · ${bill.suppliers?.name || ""}`} amount={Number(bill.amount || bill.total || 0)} />
        {recurOpen && <MakeRecurringModal kind="bill" id={bill.id} onClose={() => { setRecurOpen(false); refresh(); }} />}
        {journalOpen && <ViewJournalModal sourceType="bill" sourceId={bill.id} title={String(bill.bill_number || bill.name)} onClose={() => setJournalOpen(false)} />}
        {expectOpen && (
          <Modal open onClose={() => setExpectOpen(false)} title="Expected payment date" icon={CalendarClock}
            footer={<Button onClick={async () => { await update({ expected_payment_date: expected || null }, "Expected payment date saved"); setExpectOpen(false); }}>Save</Button>}>
            <Field label="When you expect to pay"><input type="date" className="fi" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          </Modal>
        )}
        <div className="flex flex-wrap items-center gap-2"><Pill tone={BILL_TONE[st]}>{st}</Pill>{bill.expected_payment_date && <Pill tone="info">Expected payment {fmtDate(bill.expected_payment_date)}</Pill>}{bill.is_recurring && <Pill tone="primary">Recurring</Pill>}{bill.etims_status === "signed" && <Pill tone="success">Reported to KRA</Pill>}{bill.etims_status === "failed" && <Pill tone="danger">KRA: not accepted{bill.etims_error ? ` · ${bill.etims_error}` : ""}</Pill>}{bill.approval_status === "pending" && <Pill tone="warning">Waiting for approval</Pill>}{bill.purchase_id && <Link className="text-sm text-primary" to={`/purchases/orders/${bill.purchase_id}`}><Truck className="mr-1 inline h-4 w-4" />Purchase order</Link>}</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Total", Number(bill.amount)], ["Paid", Number(bill.amount_paid)], ["Balance", balance]].map(([l, v]) => <div key={String(l)} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="font-display text-lg font-bold">{formatKES(v as number)}</p></div>)}
          <div className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">Due</p><p className="font-display text-lg font-bold">{bill.due_date ? fmtDate(bill.due_date) : "—"}</p></div>
        </div>
        {(bill.items || []).length > 0 && <TableWrap><table className="dt"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead><tbody>{bill.items.map((i: any, n: number) => <tr key={n}><td>{i.name}</td><td className="num">{i.quantity}</td><td className="num">{formatKES(Number(i.rate))}</td><td className="num">{formatKES(Number(i.amount))}</td></tr>)}</tbody></table></TableWrap>}
        <div><p className="mb-1 text-sm font-semibold">Payments made</p>{(payments as any[]).length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : <ul className="space-y-1 text-sm">{(payments as any[]).map((x) => <li key={x.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><span className="capitalize">{fmtDate(x.paid_on)} · {String(x.method).replace("_", " ")}{x.reference ? ` · ${x.reference}` : ""}</span><b>{formatKES(Number(x.amount))}</b></li>)}</ul>}</div>
        {bill.reference && <p className="text-sm"><b>Supplier's invoice:</b> {bill.reference}</p>}
        {balance > 0 && (credits as any[]).some((c) => Number(c.amount) - Number(c.amount_applied) - Number(c.amount_refunded) > 0) && (
          <div className="rounded-xl border border-info/30 bg-info/5 p-3 text-sm">
            <p className="mb-2 font-semibold">This supplier owes you credit</p>
            <ul className="space-y-1">{(credits as any[]).map((c) => { const left = Number(c.amount) - Number(c.amount_applied) - Number(c.amount_refunded); return left > 0 ? <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.credit_number} · {formatKES(left)} left</span><Button size="sm" variant="outline" onClick={() => applyCredit(c)}>Apply</Button></li> : null; })}</ul>
          </div>
        )}
        <DocumentPreview kind="bill" id={bill.id} version={`${bill.status}-${bill.amount_paid}`} />
        <div className="mt-4"><DocumentsPanel entityType="bill" entityId={bill.id} entityName={String(bill.bill_number || "")} /></div>
      </div>
      <Modal open={pay} onClose={() => setPay(false)} title="Record payment" description={`Balance ${formatKES(balance)}`} icon={Wallet} footer={<Button onClick={doPay} disabled={busy}>{busy && <OrbSpinner />} Save payment</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount"><input className="fi" type="number" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
          <Field label="Date"><input className="fi" type="date" value={p.paid_on} onChange={(e) => setP({ ...p, paid_on: e.target.value })} /></Field>
          <Field label="Paid by"><select className="fi" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}><option value="mpesa">M-Pesa</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></Field>
          <Field label="Reference"><input className="fi" value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></Field>
          <Field label="Paid from" className="sm:col-span-2"><select className="fi" value={p.through} onChange={(e) => setP({ ...p, through: e.target.value })}><option value="">Usual account for this payment mode</option>{moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {whOn && <Field label={`Withholding VAT (${taxB.withholding.rate}%)`} hint={`Settles ${formatKES((Number(p.amount) || 0) + (Number(withheld) || 0))} on the bill. Remit it to KRA.`} className="sm:col-span-2"><input className="fi" type="number" min={0} step="any" value={withheld} onChange={(e) => setWithheld(e.target.value)} /></Field>}
        </div>
      </Modal>
    </DocPane>
  );
}
