import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, X, Pencil, Send, CheckCircle2, XCircle, Mail, MessageCircle, Trash2, ClipboardList, PackagePlus,
  ShoppingBag, History, PhoneCall, Search, AlertTriangle, Receipt, FileQuestion,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useProducts, useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, Modal, Field } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { ZStatus } from "@/components/books/ZStatus";
import { confirmAction } from "@/components/books/confirm";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import { emailDocument, shareOnWhatsApp } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const VIEWS = [["mine", "Needs my action"], ["all", "All Requisitions"], ["draft", "Drafts"], ["pending_approval", "Waiting approval"], ["approved", "Approved (send)"], ["sent", "Sent to supplier"], ["ordered", "Ordered"], ["received", "Received"], ["rejected", "Returned"]] as const;
const LABEL: Record<string, string> = { pending_approval: "waiting approval", approved: "approved", rejected: "returned" };
type ReqKind = "expense" | "purchase" | "restock";
const KINDS: [ReqKind, string, string][] = [
  ["expense", "Company expense", "Rent, airtime, fuel allowance, utilities. Recorded in Expenses once approved."],
  ["purchase", "Purchase", "Things the company uses: computers, furniture, equipment."],
  ["restock", "Restock", "Items you sell. Becomes a purchase order, or a request for quotation."],
];
const KIND_LABEL: Record<string, string> = { expense: "Expense", purchase: "Purchase", restock: "Restock" };

function useSuppliers() {
  const tenantId = useTenantId();
  return useQuery({ queryKey: ["suppliers-lite", tenantId], enabled: !!tenantId, queryFn: async () => (await sb.from("suppliers").select("id, name, phone, email").eq("tenant_id", tenantId).eq("is_active", true).order("name")).data || [] });
}

export default function Requisitions() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const { user, role } = useAuth() as any;
  const isManager = ["admin", "manager", "super_admin"].includes(role);
  const [view, setView] = useState<string>("mine");
  const [q, setQ] = useState("");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["requisitions", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("requisitions").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500)).data || [],
  });
  const today = new Date().toISOString().slice(0, 10);
  const mine = (r: any) => (isManager && r.status === "pending_approval")
    || (r.requested_by === user?.id && ["draft", "rejected", "approved"].includes(r.status))
    || (["sent", "acknowledged"].includes(r.status) && r.follow_up_on && r.follow_up_on <= today);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows as any[]).filter((r) => (view === "all" || (view === "mine" ? mine(r) : view === "sent" ? ["sent", "acknowledged"].includes(r.status) : r.status === view))
      && (!s || `${r.number || ""} ${r.supplier_name || ""} ${r.requested_by_name || ""}`.toLowerCase().includes(s)));
  }, [rows, view, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = id && id !== "new" ? (rows as any[]).find((r) => r.id === id) : null;
  const actionCount = (rows as any[]).filter(mine).length;

  if (id === "new" || (id && window.location.pathname.endsWith("/edit"))) return <RequisitionForm id={id === "new" ? undefined : id} />;
  if (isLoading) return <OrbLoader label="Loading requisitions…" />;
  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="inline-flex items-center gap-1.5 font-display text-lg font-bold">{VIEWS.find(([v]) => v === view)?.[1]} {view === "mine" && actionCount > 0 && <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{actionCount}</span>}<ChevronDown className="h-4 w-4 text-primary" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">{VIEWS.map(([v, l]) => <DropdownMenuItem key={v} onSelect={() => setView(v)} className={cn(view === v && "font-semibold text-primary")}>{l}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {!selected && (
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requisitions…" className="fi h-9 w-64 rounded-full pl-9" />
          </div>
        )}
        <Button size="sm" onClick={() => navigate("/purchases/requisitions/new")}><Plus /> New</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 xl:block" : "w-full")}>
          {list.length === 0 ? (
            <EmptyState icon={ClipboardList} title={view === "mine" ? "Nothing needs your action" : "No requisitions here"} description="Ask for expenses, purchases or restocking." className="m-6" />
          ) : selected ? (
            <ul>{list.map((r: any) => (
              <li key={r.id}><Link to={`/purchases/requisitions/${r.id}`} className={cn("block border-b border-border px-4 py-3 hover:bg-muted/50", r.id === id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                <div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{r.supplier_name || KIND_LABEL[r.kind] || "No vendor"}</span><span className="text-sm tabular-nums">{formatKES(Number(r.total_estimate || 0))}</span></div>
                <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground"><span>{r.number || "Draft"} · {fmtDate(r.created_at)}</span><ZStatus status={LABEL[r.status] ? r.status : r.status} /></div>
              </Link></li>
            ))}</ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 text-left">Date</th><th className="px-4 py-2.5 text-left">Requisition#</th><th className="px-4 py-2.5 text-left">Type</th><th className="px-4 py-2.5 text-left">Vendor</th>
                  <th className="px-4 py-2.5 text-left">Requested By</th><th className="px-4 py-2.5 text-left">Needed By</th><th className="px-4 py-2.5 text-left">Status</th><th className="px-4 py-2.5 text-right">Estimate</th>
                </tr></thead>
                <tbody><PagedRows rows={list} colSpan={8}>{(pageRows) => pageRows.map((r: any) => (
                  <tr key={r.id} onClick={() => navigate(`/purchases/requisitions/${r.id}`)} className="cursor-pointer border-b border-border hover:bg-muted/40">
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{r.number || "Draft"}</td>
                    <td className="px-4 py-3">{KIND_LABEL[r.kind] || "Purchase"}</td>
                    <td className="px-4 py-3">{r.supplier_name || "—"}</td>
                    <td className="px-4 py-3">{r.requested_by_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.needed_by ? fmtDate(r.needed_by) : "—"}</td>
                    <td className="px-4 py-3"><ZStatus status={r.status} />{["sent", "acknowledged"].includes(r.status) && r.follow_up_on && r.follow_up_on <= today && <span className="ml-2 text-[11px] font-semibold text-destructive">follow up</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKES(Number(r.total_estimate || 0))}</td>
                  </tr>
                ))}</PagedRows></tbody>
              </table>
            </div>
          )}
        </div>
        {selected && <RequisitionDetail r={selected} onClose={() => navigate("/purchases/requisitions")} />}
      </div>
    </div>
  );
}

function RequisitionDetail({ r, onClose }: { r: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, role } = useAuth() as any;
  const { data: biz } = useBusinessSettings();
  const isManager = ["admin", "manager", "super_admin"].includes(role);
  const mineDraft = r.requested_by === user?.id && ["draft", "rejected"].includes(r.status);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "approve" | "reject" | "email" | "followup" | "expense">(null);
  const isExpense = r.kind === "expense";
  const { data: items = [] } = useQuery({ queryKey: ["req-items", r.id], queryFn: async () => (await sb.from("requisition_items").select("*").eq("requisition_id", r.id).order("sort")).data || [] });
  const { data: events = [] } = useQuery({ queryKey: ["req-events", r.id, r.updated_at], queryFn: async () => (await sb.from("requisition_events").select("*").eq("requisition_id", r.id).order("created_at")).data || [] });
  const { data: supplier } = useQuery({ queryKey: ["supplier", r.supplier_id], enabled: !!r.supplier_id, queryFn: async () => (await sb.from("suppliers").select("*").eq("id", r.supplier_id).maybeSingle()).data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["requisitions"] }); qc.invalidateQueries({ queryKey: ["req-items", r.id] }); qc.invalidateQueries({ queryKey: ["doc-model"] }); qc.invalidateQueries({ queryKey: ["approvals-reqs"] }); qc.invalidateQueries({ queryKey: ["approvals-badge"] }); };
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { data, error } = await sb.rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: "Not done", description: error.message, variant: "destructive" }); return null; }
    toast({ title: ok });
    refresh();
    return data ?? true;
  };
  const shop = biz?.business_name || "JMSURF Garage";
  const whatsapp = async () => {
    const lines = (items as any[]).filter((l) => Number(l.qty_approved ?? l.qty_requested) > 0).map((l) => `• ${l.name}: ${Number(l.qty_approved ?? l.qty_requested)} ${l.unit || ""}`.trim()).join("\n");
    shareOnWhatsApp(supplier?.phone, `Hello ${supplier?.name || r.supplier_name || ""}, ${shop} would like to order (${r.number}):\n${lines}${r.needed_by ? `\nNeeded by ${fmtDate(r.needed_by)}.` : ""}\nPlease confirm availability, price and delivery. Thank you.`);
    await rpc("requisition_mark_sent", { p_req: r.id, p_via: "whatsapp", p_follow_up: null }, "Marked as sent on WhatsApp");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto"><p className="text-xs text-muted-foreground">{r.supplier_name || "No supplier yet"} · by {r.requested_by_name}</p><h2 className="truncate font-display text-xl font-bold">{r.number || "Draft requisition"}</h2></div>
        {mineDraft && <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/requisitions/${r.id}/edit`)}><Pencil /> Edit</Button>}
        {mineDraft && <Button size="sm" onClick={() => rpc("requisition_submit", { p_req: r.id }, "Sent for approval")} disabled={busy}><Send /> Submit for approval</Button>}
        {isManager && r.status === "pending_approval" && <>
          <Button size="sm" variant="outline" onClick={() => setModal("reject")}><XCircle /> Return</Button>
          <Button size="sm" onClick={() => setModal("approve")}><CheckCircle2 /> Review & approve</Button>
        </>}
        {isExpense && ["approved", "sent", "acknowledged"].includes(r.status) && !r.expense_id && <Button size="sm" onClick={() => setModal("expense")} disabled={busy}><Receipt /> Record as expense</Button>}
        {r.expense_id && <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/expenses/${r.expense_id}`)}><Receipt /> View expense</Button>}
        {!isExpense && !r.supplier_name && !r.rfq_id && r.status === "approved" && <Button size="sm" onClick={async () => { const q = await rpc("requisition_to_rfq", { p_req: r.id }, "Request for quotation created: send it to vendors"); if (q) navigate(`/purchases/rfqs?open=${q}`); }} disabled={busy}><FileQuestion /> Create RFQ</Button>}
        {r.rfq_id && !r.purchase_id && <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/rfqs?open=${r.rfq_id}`)}><FileQuestion /> Open RFQ</Button>}
        {!isExpense && !r.rfq_id && ["approved", "sent", "acknowledged"].includes(r.status) && <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant={r.status === "approved" ? "default" : "outline"}><Send /> Send to supplier <ChevronDown className="opacity-70" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setModal("email")}><Mail /> Email with PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={whatsapp}><MessageCircle /> WhatsApp</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {r.status !== "approved" && <Button size="sm" variant="outline" onClick={() => setModal("followup")}><PhoneCall /> Follow up</Button>}
          {r.supplier_name && <Button size="sm" variant="outline" onClick={async () => { const po = await rpc("requisition_to_po", { p_req: r.id }, "Purchase order created"); if (po) navigate(`/purchases/orders/${po}`); }} disabled={busy}><ShoppingBag /> Create purchase order</Button>}
        </>}
        {r.purchase_id && <Button size="sm" variant="outline" onClick={() => navigate(`/purchases/orders/${r.purchase_id}`)}><ShoppingBag /> View purchase order</Button>}
        {r.status === "draft" && r.requested_by === user?.id && (
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Delete" onClick={async () => { if (await confirmAction({ title: "Delete this draft?", danger: true, confirmLabel: "Delete" })) { await sb.from("requisitions").delete().eq("id", r.id); refresh(); onClose(); } }}><Trash2 /></Button>
        )}
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
        {r.status === "rejected" && <div className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /><span><b>Returned by the manager:</b> {r.rejection_reason}. Edit it and submit again.</span></div>}
        {r.status === "approved" && <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm"><b className="text-primary">Approved by {r.approved_by_name}.</b> {isExpense ? "Record it as an expense when it is paid." : r.supplier_name ? "Create the purchase order, or send it to the vendor and follow up." : "No vendor yet: create a request for quotation and send it to vendors."}{r.manager_notes ? ` Manager's note: ${r.manager_notes}` : ""}</div>}
        {r.expense_id && <div className="rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-sm">Recorded in Expenses.</div>}
        {["sent", "acknowledged"].includes(r.status) && <div className="rounded-2xl border border-info/30 bg-info/5 px-4 py-3 text-sm">Sent {r.sent_at ? fmtDate(r.sent_at) : ""} by {r.sent_via}. {r.status === "acknowledged" ? "The supplier confirmed." : `Follow up${r.follow_up_on ? ` on ${fmtDate(r.follow_up_on)}` : ""}.`} When the goods arrive, create the purchase order and receive it.</div>}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <DocumentPreview kind="requisition" id={r.id} version={r.updated_at} />
          <section className="h-fit rounded-2xl border border-border bg-card">
            <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold"><History className="h-4 w-4 text-primary" /> Timeline</p>
            <ol className="space-y-3 px-4 py-3 text-sm">
              <li><p className="font-medium">Created</p><p className="text-xs text-muted-foreground">{r.requested_by_name} · {fmtDate(r.created_at)}</p></li>
              {(events as any[]).map((e) => <li key={e.id}><p className="font-medium capitalize">{String(e.kind).replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{e.by_name} · {fmtDate(e.created_at)}</p>{e.note && <p className="mt-0.5 text-xs">{e.note}</p>}</li>)}
            </ol>
          </section>
        </div>
      </div>
      {modal === "approve" && <ApproveModal r={r} items={items as any[]} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "reject" && <NoteModal title="Return to the attendant" label="What needs changing?" confirm="Return" onClose={() => setModal(null)} onSave={async (note) => { if (await rpc("requisition_decide", { p_req: r.id, p_approve: false, p_note: note, p_lines: [], p_supplier: null }, "Returned to the attendant")) setModal(null); }} />}
      {modal === "expense" && <ExpenseFromReq r={r} items={items as any[]} onClose={() => setModal(null)} onSave={async (m, through, date, ref) => { const e = await rpc("requisition_to_expense", { p_req: r.id, p_method: m, p_paid_through: through, p_date: date, p_reference: ref || null }, "Recorded in Expenses"); if (e) { setModal(null); qc.invalidateQueries({ queryKey: ["expenses"] }); } }} />}
      {modal === "followup" && <FollowUpModal onClose={() => setModal(null)} onSave={async (note, ack, next) => { if (await rpc("requisition_follow_up", { p_req: r.id, p_note: note, p_acknowledged: ack, p_next: next || null }, "Follow-up saved")) setModal(null); }} />}
      {modal === "email" && <EmailSupplier r={r} supplier={supplier} shop={shop} onClose={() => setModal(null)} onSent={async () => { setModal(null); await rpc("requisition_mark_sent", { p_req: r.id, p_via: "email", p_follow_up: null }, "Emailed to the supplier"); }} />}
    </div>
  );
}

function ApproveModal({ r, items, onClose, onDone }: { r: any; items: any[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { data: suppliers = [] } = useSuppliers();
  const [lines, setLines] = useState(() => items.map((l) => ({ id: l.id, name: l.name, unit: l.unit, req: Number(l.qty_requested), qty: String(l.qty_approved ?? l.qty_requested), cost: String(l.est_unit_cost) })));
  const [supplier, setSupplier] = useState<string>(r.supplier_id || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.cost || 0), 0);
  const approve = async () => {
    setBusy(true);
    const { error } = await sb.rpc("requisition_decide", { p_req: r.id, p_approve: true, p_note: note, p_lines: lines.map((l) => ({ id: l.id, qty_approved: Number(l.qty) || 0, est_unit_cost: Number(l.cost) || 0 })), p_supplier: supplier || null });
    setBusy(false);
    if (error) return toast({ title: "Not approved", description: error.message, variant: "destructive" });
    toast({ title: "Approved. The attendant has been told to send it." });
    onDone();
  };
  return (
    <Modal open onClose={onClose} size="xl" icon={CheckCircle2} title={`Approve ${r.number}`} description="Change quantities, costs or the supplier before approving. Set a quantity to 0 to drop a line." locked={busy}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={approve} disabled={busy}>{busy && <OrbSpinner state="working" />} Approve · {formatKES(total)}</Button></>}>
      <div className="space-y-3">
        <Field label="Supplier"><select className="fi" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Keep: {r.supplier_name || "none"}</option>{(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <table className="dt dt-keep"><thead><tr><th>Item</th><th className="num">Asked</th><th className="num">Approve</th><th className="num">Est. cost</th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.id}><td>{l.name}{l.unit && <span className="text-xs text-muted-foreground"> · {l.unit}</span>}</td><td className="num">{l.req}</td>
              <td className="num"><input className="fi h-8 w-20 text-right" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td className="num"><input className="fi h-8 w-24 text-right" type="number" min={0} step="any" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></td></tr>
          ))}</tbody></table>
        <Field label="Note to the attendant (optional)"><textarea className="fi" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ExpenseFromReq({ r, items, onClose, onSave }: { r: any; items: any[]; onClose: () => void; onSave: (method: string, through: string, date: string, ref: string) => void }) {
  const [method, setMethod] = useState("mpesa");
  const [through, setThrough] = useState("M-Pesa till / paybill");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  const total = items.reduce((a, l) => a + Number(l.qty_approved ?? l.qty_requested) * Number(l.est_unit_cost || 0), 0);
  return (
    <Modal open onClose={onClose} icon={Receipt} title={`Record ${r.number} as an expense`} description={`${formatKES(total)} · approved by ${r.approved_by_name || "the manager"}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(method, through, date, ref)}><Receipt /> Record expense</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid by"><select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>{[["cash", "Cash"], ["mpesa", "M-Pesa"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["cheque", "Cheque"], ["petty_cash", "Petty cash"], ["credit", "On credit (unpaid)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Paid through"><select className="fi" value={through} onChange={(e) => setThrough(e.target.value)}>{["Cash in till", "Petty cash", "M-Pesa till / paybill", "Bank account", "Owner's money", "Company card"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Date"><input className="fi" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reference (M-Pesa code, cheque#)"><input className="fi uppercase" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function NoteModal({ title, label, confirm, onClose, onSave }: { title: string; label: string; confirm: string; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={() => onSave(note)} disabled={!note.trim()}>{confirm}</Button></>}>
      <Field label={label} required><textarea className="fi" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function FollowUpModal({ onClose, onSave }: { onClose: () => void; onSave: (note: string, ack: boolean, next: string) => void }) {
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [next, setNext] = useState(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10));
  return (
    <Modal open onClose={onClose} title="Follow up with the supplier" icon={PhoneCall} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(note, ack, ack ? "" : next)}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="What did the supplier say?" required><textarea className="fi" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" /> The supplier confirmed the order</label>
        {!ack && <Field label="Follow up again on"><input className="fi" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function EmailSupplier({ r, supplier, shop, onClose, onSent }: { r: any; supplier: any; shop: string; onClose: () => void; onSent: () => void }) {
  const { toast } = useToast();
  const [to, setTo] = useState(supplier?.email || "");
  const [subject, setSubject] = useState(`Order request ${r.number} from ${shop}`);
  const [message, setMessage] = useState(`Dear ${supplier?.name || r.supplier_name || "Supplier"},\n\nPlease find attached our order request ${r.number}${r.needed_by ? `, needed by ${fmtDate(r.needed_by)}` : ""}. Kindly confirm availability, prices and the delivery date.\n\nThank you,\n${shop}`);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!to.trim()) return toast({ title: "Enter the supplier's email", variant: "destructive" });
    setBusy(true);
    try { await emailDocument({ kind: "requisition", id: r.id, to: to.split(/[,;\s]+/).filter(Boolean), subject, message }); onSent(); }
    catch (e: any) { toast({ title: "Email not sent", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" icon={Mail} title="Email the supplier" locked={busy} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={send} disabled={busy}>{busy ? <OrbSpinner state="connecting" /> : <Send />} Send</Button></>}>
      <div className="space-y-3">
        <Field label="To" required><input className="fi" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Subject"><input className="fi" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="fi min-h-[160px]" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">{r.number}.pdf is attached.</p>
      </div>
    </Modal>
  );
}

/** New / edit a draft requisition. */
function RequisitionForm({ id }: { id?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const { data: suppliers = [] } = useSuppliers();
  const { data: products = [] } = useProducts();
  const [supplier, setSupplier] = useState("");
  const [kind, setKind] = useState<ReqKind>(() => (new URLSearchParams(window.location.search).get("kind") as ReqKind) || "expense");
  const [category, setCategory] = useState("");
  const { data: categories = [] } = useQuery({ queryKey: ["expense-categories"], queryFn: async () => (await sb.from("expense_categories").select("*").eq("is_active", true).order("name")).data || [] });
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ product_id: string | null; name: string; unit: string; qty: string; cost: string }[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const realId = id?.replace(/\/edit$/, "");

  useEffect(() => {
    if (!realId) return;
    (async () => {
      const { data } = await sb.from("requisitions").select("*, requisition_items(*)").eq("id", realId).maybeSingle();
      setLoading(false);
      if (!data) return navigate("/purchases/requisitions");
      setSupplier(data.supplier_id || ""); setNeededBy(data.needed_by || ""); setNotes(data.notes || ""); setKind(data.kind || "purchase"); setCategory(data.expense_category_id || "");
      setLines((data.requisition_items || []).sort((a: any, b: any) => a.sort - b.sort).map((l: any) => ({ product_id: l.product_id, name: l.name, unit: l.unit || "", qty: String(l.qty_requested), cost: String(l.est_unit_cost) })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realId]);

  const addLowStock = () => {
    const low = (products as any[]).filter((p) => Number(p.stock) <= Number(p.reorder_level || 0) && (!supplier || !p.preferred_supplier_id || p.preferred_supplier_id === supplier));
    if (!low.length) return toast({ title: "Nothing is below its reorder point" });
    const have = new Set(lines.map((l) => l.product_id));
    setLines([...lines, ...low.filter((p) => !have.has(p.id)).map((p) => ({ product_id: p.id, name: p.name, unit: p.unit || "", qty: String(Math.max(1, Number(p.reorder_level || 0) * 2 - Number(p.stock || 0))), cost: String(Number(p.cost_price || 0)) }))]);
  };

  const save = async (submit: boolean) => {
    const clean = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
    const stockNames = new Set((products as any[]).map((p) => p.name.trim().toLowerCase()));
    const stock = clean.filter((l) => l.product_id || stockNames.has(l.name.trim().toLowerCase()));
    if (kind !== "restock" && stock.length) return toast({ title: "Stock items found", description: `${stock.map((l) => l.name).join(", ")} ${stock.length === 1 ? "is an item" : "are items"} you sell. Choose "Restock" for stock.`, variant: "destructive" });
    if (kind === "restock" && clean.some((l) => !l.product_id)) return toast({ title: "Pick each item from Items", description: "Restock lines must be items you keep in stock.", variant: "destructive" });
    if (kind === "expense" && !category) return toast({ title: "Choose the expense category", description: "e.g. Rent, Airtime, Fuel allowance", variant: "destructive" });
    if (!clean.length) return toast({ title: "Add at least one item with a quantity", variant: "destructive" });
    setSaving(true);
    try {
      const sup = (suppliers as any[]).find((s) => s.id === supplier);
      const head = { kind, expense_category_id: kind === "expense" ? category || null : null, supplier_id: supplier || null, supplier_name: sup?.name || null, needed_by: neededBy || null, notes: notes.trim() || null, updated_at: new Date().toISOString() };
      let reqId = realId;
      if (reqId) {
        const { error } = await sb.from("requisitions").update(head).eq("id", reqId);
        if (error) throw error;
        await sb.from("requisition_items").delete().eq("requisition_id", reqId);
      } else {
        const { data, error } = await sb.from("requisitions").insert({ ...head, tenant_id: tenantId, status: "draft", requested_by: user?.id, requested_by_name: profile?.display_name || "Staff" }).select("id").single();
        if (error) throw error;
        reqId = data.id;
      }
      const { error: iErr } = await sb.from("requisition_items").insert(clean.map((l, i) => ({ requisition_id: reqId, tenant_id: tenantId, product_id: l.product_id, name: l.name.trim(), unit: l.unit || null, qty_requested: Number(l.qty), est_unit_cost: Number(l.cost) || 0, sort: i })));
      if (iErr) throw iErr;
      if (submit) { const { error } = await sb.rpc("requisition_submit", { p_req: reqId }); if (error) throw error; }
      qc.invalidateQueries({ queryKey: ["requisitions"] }); qc.invalidateQueries({ queryKey: ["approvals-reqs"] }); qc.invalidateQueries({ queryKey: ["approvals-badge"] });
      toast({ title: submit ? "Sent to the manager for approval" : "Draft saved" });
      navigate(`/purchases/requisitions/${reqId}`);
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (loading) return <OrbLoader label="Loading…" />;
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Number(l.cost || 0), 0);
  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <ClipboardList className="h-5 w-5 text-primary" /><h1 className="flex-1 font-display text-xl font-bold">{realId ? "Edit Requisition" : "New Requisition"}</h1>
        <Button size="icon" variant="ghost" onClick={() => navigate(realId ? `/purchases/requisitions/${realId}` : "/purchases/requisitions")} aria-label="Close"><X /></Button>
      </div>
      <div className="flex-1 space-y-6 bg-card px-4 py-6 sm:px-6">
        <div className="max-w-3xl">
          <p className="mb-2 text-sm font-medium">What is it for?</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Requisition type">
            {KINDS.map(([k, l, d]) => (
              <label key={k} className={cn("flex cursor-pointer gap-3 rounded-xl border-2 p-3", kind === k ? "border-primary bg-primary/5" : "border-border")}>
                <input type="radio" className="mt-1 accent-primary" checked={kind === k} onChange={() => { setKind(k); if (k === "restock") setLines(lines.filter((x) => x.product_id)); }} />
                <span><span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {kind === "expense" && <Field label="Expense category" required><select className="fi" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Choose…</option>{(categories as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <Field label={kind === "expense" ? "Paid to (optional)" : "Vendor"} hint={kind === "expense" ? undefined : supplier ? "Becomes a purchase order once approved" : "No vendor yet? It becomes a request for quotation to share with vendors"}><select className="fi" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">{kind === "expense" ? "Nobody in particular" : "No vendor yet: ask for quotes"}</option>{(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Needed by"><input className="fi" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
          <Field label="Notes for the manager / supplier" className="sm:col-span-2"><textarea className="fi" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
            <p className="flex-1 text-sm font-semibold">{kind === "expense" ? "What is needed" : "Items needed"}</p>
            {kind === "restock" && <Button size="sm" variant="outline" onClick={addLowStock}><PackagePlus /> Add items below reorder level</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">{kind === "expense" ? "Description" : "Item"}</th><th className="w-28 px-3 py-2 text-right">Quantity</th><th className="w-24 px-3 py-2 text-left">Unit</th><th className="w-32 px-3 py-2 text-right">{kind === "expense" ? "Amount each" : "Est. unit cost"}</th><th className="w-10" /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">
                    {kind === "restock" ? (
                      <select className="fi h-9" value={l.product_id || ""} onChange={(e) => { const p = (products as any[]).find((x) => x.id === e.target.value); setLines(lines.map((x, j) => (j === i ? { ...x, product_id: p?.id || null, name: p?.name || "", unit: p?.unit || x.unit, cost: p ? String(Number(p.cost_price || 0)) : x.cost } : x))); }}>
                        <option value="">Choose an item…</option>{(products as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""} (in stock {Number(p.stock || 0)})</option>)}
                      </select>
                    ) : (
                    <input className="fi h-9" value={l.name} placeholder={kind === "expense" ? "e.g. Rent for November, staff airtime, fuel allowance" : "e.g. Laptop, office chair, printer"}
                      onChange={(e) => { const v = e.target.value; const p = (products as any[]).find((x) => x.name.toLowerCase() === v.trim().toLowerCase()); setLines(lines.map((x, j) => (j === i ? { ...x, name: v, product_id: null } : x))); if (p) toast({ title: `${p.name} is a stock item`, description: "Choose Restock to order stock.", variant: "destructive" }); }} />
                    )}
                  </td>
                  <td className="px-2 py-2"><input className="fi h-9 text-right" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td className="px-2 py-2"><input className="fi h-9" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} /></td>
                  <td className="px-2 py-2"><input className="fi h-9 text-right" type="number" min={0} step="any" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></td>
                  <td className="pr-2"><button className="icon-btn-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}</tbody>
            </table>

          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <button className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary" onClick={() => setLines([...lines, { product_id: null, name: "", unit: "", qty: "1", cost: "0" }])}><Plus className="h-4 w-4" /> Add row</button>
            <p className="text-sm">Estimate <b className="tabular-nums">{formatKES(total)}</b></p>
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Button variant="outline" onClick={() => save(false)} disabled={saving}>Save as draft</Button>
        <Button onClick={() => save(true)} disabled={saving}>{saving && <OrbSpinner state="working" />} Submit for approval</Button>
      </div>
    </div>
  );
}
