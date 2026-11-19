import { useEffect, useMemo, useState } from "react";
import { EtimsPush } from "@/components/books/EtimsPush";
import { SignBanner } from "@/components/books/SignBanner";
import { signatureUrl, useDocSignature } from "@/lib/signing";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DocPane, SplitView } from "@/components/books/DocPane";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileMinus, Plus, X, Search, Ban, Wallet, Undo2, Pencil, Mail, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { erpApi } from "@/lib/erpApi";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { AutoGrowText, ItemTable, editTotals, newLine, toEditLines, toStoredLines, type EditLine, type Adjustments } from "@/components/books/ItemTable";
import { useTaxSettings } from "@/lib/tax";
import { confirmAction } from "@/components/books/confirm";
import { currencyCode, formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import Pager, { usePaged } from "@/components/Pager";
import { TagPickers, cleanTags, missingTag, useModuleTags, type TagValues } from "@/lib/reportingTags";

const sb: any = supabase;
const today = () => new Date().toISOString().slice(0, 10);
const left = (n: any) => Math.max(0, Number(n.total) - Number(n.amount_applied) - Number(n.amount_refunded));
const STATUS: Record<string, string> = { draft: "bg-muted text-muted-foreground", open: "bg-info/10 text-info", closed: "bg-success/10 text-success", void: "bg-destructive/10 text-destructive" };
const REASONS = ["Goods returned", "Damaged goods", "Overcharged / price correction", "Discount after sale", "Order cancelled", "Other"];

function useNotes() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["credit-notes", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await sb.from("credit_notes").select("*").eq("tenant_id", tenantId).order("issue_date", { ascending: false, nullsFirst: false }).order("credit_note_number", { ascending: false }).order("created_at", { ascending: false }).limit(1000)).data || []) as any[],
  });
}

/** Sales → Credit Notes: list, create/edit, apply to invoices, refund, void, print. */
export default function CreditNotes() {
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: notes = [], isLoading } = useNotes();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "open" | "closed" | "draft" | "void">("all");
  const creating = id === "new" || !!params.get("invoice");
  const editing = params.get("edit");
  const selected = id && id !== "new" ? notes.find((n) => n.id === id) : null;

  const rows = useMemo(() => notes.filter((n) => (view === "all" || n.status === view) && (!q.trim() || `${n.credit_note_number} ${n.customer_name} ${n.reference || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [notes, q, view]);
  const open = notes.filter((n) => n.status === "open");

  const paged = usePaged(rows, 25);
  const sel = useSelection(paged.rows.map((n: any) => n.id));
  if (isLoading) return <OrbLoader label="Loading credit notes…" />;
  if (creating || editing) return <CreditNoteForm existing={editing ? notes.find((n) => n.id === editing) : null} invoiceId={params.get("invoice")} onDone={(nid) => navigate(nid ? `/sales/credit-notes/${nid}` : "/sales/credit-notes")} />;

  if (selected) return (
    <SplitView heading="All Credit Notes" newHref="/sales/credit-notes/new" activeId={selected.id}
      rows={notes.map((n: any) => ({ id: n.id, href: `/sales/credit-notes/${n.id}`, title: n.customer_name || "—", amount: formatKES(Number(n.total)), sub: `${n.credit_note_number} · ${fmtDate(n.issue_date)}`, status: n.status, tone: n.status === "closed" ? "success" : n.status === "void" ? "danger" : undefined }))}>
      <NoteDetail note={selected} onClose={() => navigate("/sales/credit-notes")} />
    </SplitView>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Credit Notes" icon={FileMinus} description="Credit for returns, overcharges or discounts. Apply it to the customer's invoices or refund it."
        actions={<Button onClick={() => navigate("/sales/credit-notes/new")}><Plus /> New credit note</Button>} />
      <StatGrid>
        <StatTile label="Open credit" value={formatKES(open.reduce((a, n) => a + left(n), 0))} icon={Wallet} tone="info" hint={`${open.length} note${open.length === 1 ? "" : "s"}`} />
        <StatTile label="Issued this month" value={formatKES(notes.filter((n) => n.status !== "void" && String(n.issue_date).slice(0, 7) === today().slice(0, 7)).reduce((a, n) => a + Number(n.total), 0))} icon={FileMinus} tone="primary" />
        <StatTile label="Refunded" value={formatKES(notes.reduce((a, n) => a + Number(n.amount_refunded || 0), 0))} icon={Undo2} tone="muted" />
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {(["all", "open", "closed", "draft", "void"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5 text-sm capitalize", view === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{v}</button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={FileMinus} title="No credit notes" description="Issue one when goods come back or a customer was overcharged." /> : (<>
          <BulkBar sel={sel} noun="credit note">
            <Button size="sm" variant="outline" onClick={() => downloadCsv("credit-notes.csv", ["Number", "Date", "Customer", "Reason", "Status", "Amount", "Balance"], notes.filter((n) => sel.has(n.id)).map((n) => [n.credit_note_number, n.issue_date, n.customer_name, n.reason, n.status, n.total, left(n)]))}>Export</Button>
          </BulkBar>
          <TableWrap>
            <table className="dt">
              <thead><tr><th className="w-10"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th>Date</th><th>Credit Note#</th><th>Customer</th><th className="hidden md:table-cell">Reason</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
              <tbody>{(paged.rows as any[]).map((n) => (
                <tr key={n.id} className={cn("cursor-pointer", sel.has(n.id) && "bg-primary/5")} onClick={() => navigate(`/sales/credit-notes/${n.id}`)}>
                  <td data-label=""><Tick on={sel.has(n.id)} onChange={() => sel.toggle(n.id)} /></td>
                  <td className="whitespace-nowrap">{fmtDate(n.issue_date)}</td>
                  <td className="font-semibold text-primary">{n.credit_note_number}</td>
                  <td>{n.customer_name}</td>
                  <td className="hidden max-w-[220px] truncate text-muted-foreground md:table-cell">{n.reason}</td>
                  <td><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase", STATUS[n.status])}>{n.status}</span></td>
                  <td className="num">{formatKES(Number(n.total))}</td>
                  <td className="num font-semibold">{formatKES(left(n))}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>
          <Pager {...paged.pager} />
        </>)}
      </Panel>
    </div>
  );
}

function CreditNoteForm({ existing, invoiceId, onDone }: { existing?: any; invoiceId: string | null; onDone: (id?: string) => void }) {
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const { data: biz } = useBusinessSettings();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<PickedCustomer | null>(existing?.customer_id ? { id: existing.customer_id, name: existing.customer_name, email: existing.customer_email } : null);
  const [invoice, setInvoice] = useState<string>(existing?.invoice_id || invoiceId || "");
  const [issueDate, setIssueDate] = useState(existing?.issue_date || today());
  const [reference, setReference] = useState(existing?.reference || "");
  const [reason, setReason] = useState(existing?.reason || REASONS[0]);
  // Goods that came back go back into stock (and their cost leaves cost of sales).
  const RESTOCK_REASONS = ["Goods returned", "Order cancelled"];
  const [restock, setRestock] = useState<boolean>(existing ? !!existing.restock : true);
  const pickReason = (r: string) => { setReason(r); if (!existing) setRestock(RESTOCK_REASONS.includes(r)); };
  const [lines, setLines] = useState<EditLine[]>(existing ? toEditLines(existing.items) : [newLine()]);
  const [adj, setAdj] = useState<Adjustments>({ discount: Number(existing?.discount || 0), shipping: 0, adjustment: Number(existing?.adjustment || 0) });
  const taxDefaults = useTaxSettings();
  const [inclusive, setInclusive] = useState<boolean>(() => (existing ? !!existing.prices_include_tax : !!taxDefaults.pricesIncludeTax));
  const [notes, setNotes] = useState(existing?.notes || "");
  const cnTags = useModuleTags("credit_notes");
  const [tags, setTags] = useState<TagValues>(existing?.tags || {});
  const [saving, setSaving] = useState<"" | "draft" | "open">("");

  // Started from an invoice: its customer and items.
  useEffect(() => {
    if (!invoiceId || existing) return;
    void sb.from("invoices").select("id,customer_id,customer_name,customer_email,items,invoice_number").eq("id", invoiceId).maybeSingle().then(({ data }: any) => {
      if (!data) return;
      if (data.customer_id) setCustomer({ id: data.customer_id, name: data.customer_name, email: data.customer_email });
      const l = toEditLines(data.items);
      if (l.length) setLines(l);
      setReference(data.invoice_number);
    });
  }, [invoiceId, existing]);

  const { data: invoices = [] } = useQuery({
    queryKey: ["cn-invoices", customer?.id],
    enabled: !!customer?.id,
    queryFn: async () => (await sb.from("invoices").select("id,invoice_number,total,amount_paid,issue_date").eq("customer_id", customer!.id).not("status", "in", "(draft,void)").order("issue_date", { ascending: false }).limit(100)).data || [],
  });

  const save = async (status: "draft" | "open") => {
    if (!customer) return toast({ title: "Select a customer", variant: "destructive" });
    const stored = toStoredLines(lines);
    if (!stored.length) return toast({ title: "Add at least one item", variant: "destructive" });
    const t = editTotals(lines, adj, inclusive);
    if (t.total <= 0) return toast({ title: "The total must be more than zero", variant: "destructive" });
    const missingT = missingTag(cnTags, "credit_notes", tags);
    if (missingT) return toast({ title: `Choose ${missingT}`, variant: "destructive" });
    setSaving(status);
    try {
      let num = existing?.credit_note_number;
      if (!num) { const { data, error } = await sb.rpc("next_doc_number", { p_kind: "credit_note" }); if (error) throw error; num = data; }
      const payload = {
        tenant_id: tenantId, credit_note_number: num, customer_id: customer.id, customer_name: customer.name, customer_email: customer.email || null,
        invoice_id: invoice || null, issue_date: issueDate, reference: reference.trim() || null, reason, restock, items: stored,
        subtotal: t.subtotal, tax: t.tax, discount: adj.discount, adjustment: adj.adjustment, total: t.total, prices_include_tax: inclusive, notes: notes.trim() || null,
        status: existing && existing.status !== "draft" ? existing.status : status, salesperson_id: user?.id, salesperson_name: profile?.display_name || null, updated_at: new Date().toISOString(),
        tags: cleanTags(tags),
      };
      const r = existing ? await sb.from("credit_notes").update(payload).eq("id", existing.id).select("id").single() : await sb.from("credit_notes").insert(payload).select("id").single();
      if (r.error) throw r.error;
      // Straight onto the invoice it was raised against, as far as that invoice still owes.
      if (!existing && status === "open" && invoice) {
        const inv = (invoices as any[]).find((i) => i.id === invoice) || (await sb.from("invoices").select("total,amount_paid").eq("id", invoice).maybeSingle()).data;
        const owe = inv ? Number(inv.total) - Number(inv.amount_paid) : 0;
        const amt = Math.min(owe, t.total);
        if (amt > 0.005) { const { error } = await sb.rpc("apply_credit_note", { p_note: r.data.id, p_invoice: invoice, p_amount: Math.round(amt * 100) / 100 }); if (error) toast({ title: "Saved, but not applied to the invoice", description: error.message, variant: "destructive" }); }
      }
      qc.invalidateQueries({ queryKey: ["credit-notes"] });
      qc.invalidateQueries({ queryKey: ["zdocs"] });
      toast({ title: `Credit note ${num} ${existing ? "updated" : "saved"}` });
      onDone(r.data.id);
    } catch (e: any) { toast({ title: "Not saved", description: e.message, variant: "destructive" }); }
    finally { setSaving(""); }
  };

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <FileMinus className="h-5 w-5 text-primary" />
        <h1 className="flex-1 font-display text-xl font-bold">{existing ? `Edit ${existing.credit_note_number}` : "New Credit Note"}</h1>
        <Button size="icon" variant="ghost" onClick={() => onDone(existing?.id)} aria-label="Close"><X /></Button>
      </div>
      <div className="flex-1 space-y-6 bg-card px-4 py-6 sm:px-6">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <Field label="Customer" required className="sm:col-span-2"><CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setInvoice(""); }} /></Field>
          <Field label="Against invoice" hint="Optional. The credit is applied to it when you save.">
            <select className="fi" value={invoice} onChange={(e) => setInvoice(e.target.value)} disabled={!customer}>
              <option value="">No invoice (keep as credit)</option>
              {(invoices as any[]).map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {fmtDate(i.issue_date)} · owes {formatKES(Number(i.total) - Number(i.amount_paid))}</option>)}
            </select>
          </Field>
          <Field label="Credit note date" required><input className="fi" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
          <Field label="Reason">
            <select className="fi" value={reason} onChange={(e) => pickReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}{!REASONS.includes(reason) && <option>{reason}</option>}</select>
          </Field>
          <Field label="Reference#"><input className="fi" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        <TagPickers module="credit_notes" values={tags} onChange={setTags} className="grid max-w-4xl gap-4 sm:grid-cols-2" />
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Put the items back into stock <span className="text-xs text-muted-foreground">(goods came back and can be sold again)</span>
        </label>
        <ItemTable inclusive={inclusive} onInclusive={setInclusive} lines={lines} onChange={setLines} adjustments={adj} onAdjustments={setAdj} defaultVat={Number((biz as any)?.default_vat_rate || 16)} currency={currencyCode() || "KES"} />
        <Field label="Notes (shown on the credit note)" className="max-w-2xl"><AutoGrowText className="fi" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        {(!existing || existing.status === "draft") && <Button variant="outline" onClick={() => save("draft")} disabled={!!saving}>{saving === "draft" && <OrbSpinner />} Save as Draft</Button>}
        <Button onClick={() => save("open")} disabled={!!saving}>{saving === "open" && <OrbSpinner />} Save{existing && existing.status !== "draft" ? "" : " and Open"}</Button>
        <Button variant="ghost" onClick={() => onDone(existing?.id)}>Cancel</Button>
      </div>
    </div>
  );
}

function NoteDetail({ note, onClose }: { note: any; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: biz } = useBusinessSettings();
  const [apply, setApply] = useState(false);
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rf, setRf] = useState({ amount: String(left(note)), method: "mpesa", reference: "" });
  const sig = useDocSignature("credit_note", note.id);
  const { data: apps = [] } = useQuery({
    queryKey: ["cn-apps", note.id],
    queryFn: async () => (await sb.from("credit_note_applications").select("id,amount,applied_at,invoices(invoice_number)").eq("credit_note_id", note.id).order("created_at")).data || [],
  });
  const { data: openInv = [] } = useQuery({
    queryKey: ["cn-open-inv", note.customer_id, apply],
    enabled: apply && !!note.customer_id,
    queryFn: async () => ((await sb.from("invoices").select("id,invoice_number,issue_date,total,amount_paid").eq("customer_id", note.customer_id).not("status", "in", "(draft,void,paid)").order("issue_date")).data || []).filter((i: any) => Number(i.total) - Number(i.amount_paid) > 0.005),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["credit-notes"] }); qc.invalidateQueries({ queryKey: ["cn-apps", note.id] }); qc.invalidateQueries({ queryKey: ["zdocs"] }); };
  const doApply = async () => {
    setBusy(true);
    try {
      for (const [inv, v] of Object.entries(amounts)) {
        const a = Number(v);
        if (a > 0) { const { error } = await sb.rpc("apply_credit_note", { p_note: note.id, p_invoice: inv, p_amount: a }); if (error) throw error; }
      }
      toast({ title: "Credit applied" }); setApply(false); setAmounts({}); refresh();
    } catch (e: any) { toast({ title: "Not applied", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const doRefund = async () => {
    setBusy(true);
    const { error } = await sb.rpc("refund_credit_note", { p_note: note.id, p_amount: Number(rf.amount), p_method: rf.method, p_reference: rf.reference.trim() || null });
    setBusy(false);
    if (error) return toast({ title: "Refund not recorded", description: error.message, variant: "destructive" });
    toast({ title: "Refund recorded" }); setRefund(false); refresh();
  };
  const doVoid = async () => {
    if (!(await confirmAction({ title: `Void ${note.credit_note_number}?`, message: "Credit already applied to invoices is taken back off them.", danger: true, confirmLabel: "Void" }))) return;
    const { error: e1 } = await sb.from("credit_note_applications").delete().eq("credit_note_id", note.id);
    const { error } = e1 ? { error: e1 } : await sb.from("credit_notes").update({ status: "void", updated_at: new Date().toISOString() }).eq("id", note.id);
    if (error) return toast({ title: "Not voided", description: error.message, variant: "destructive" });
    toast({ title: "Credit note voided" }); refresh();
  };

  return (
    <DocPane title={note.credit_note_number} subtitle={`${note.customer_name} · ${fmtDate(note.issue_date)}`} onClose={onClose}
      actions={<>
        {note.status === "open" && left(note) > 0 && <Button onClick={() => setApply(true)}><Wallet /> Apply to invoices</Button>}
        {note.status === "open" && left(note) > 0 && <Button variant="outline" onClick={() => setRefund(true)}><Undo2 /> Refund</Button>}
        {note.status === "draft" && <Button onClick={async () => { await sb.from("credit_notes").update({ status: "open" }).eq("id", note.id); refresh(); }}>Open it</Button>}
        {["draft", "open"].includes(note.status) && Number(note.amount_applied) === 0 && Number(note.amount_refunded) === 0 && <Button variant="outline" onClick={() => navigate(`/sales/credit-notes?edit=${note.id}`)}><Pencil /> Edit</Button>}
        {!["draft", "void"].includes(note.status) && <EtimsPush kind="credit_note" doc={note} onDone={refresh} />}
        {note.customer_email && !sig.blocked && <Button variant="outline" asChild><a href={`mailto:${note.customer_email}?subject=${encodeURIComponent(`Credit note ${note.credit_note_number}`)}&body=${encodeURIComponent(`Dear ${note.customer_name},\n\nWe have issued credit note ${note.credit_note_number} for ${formatKES(Number(note.total))}.\n\nThank you.`)}`}><Mail /> Email</a></Button>}
        {note.status !== "void" && <Button variant="ghost" className="text-destructive" onClick={doVoid}><Ban /> Void</Button>}
      </>}>
      <div className="space-y-4">
        <SignBanner sig={sig} number={note.credit_note_number} title={`Credit note ${note.credit_note_number} · ${note.customer_name || ""}`} amount={Number(note.total || 0)} />
        {note.etims_status === "signed" && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Signed with KRA eTIMS{note.etims_rcpt_no ? <> · receipt {note.etims_rcpt_no}</> : null}{note.etims_qr_url && <a href={note.etims_qr_url} target="_blank" rel="noopener noreferrer" className="ml-auto font-semibold underline">Verify on KRA</a>}</div>}
        {note.etims_status === "failed" && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">KRA eTIMS did not sign this credit note: {note.etims_error}</div>}
        <DocumentPreview kind="credit_note" id={note.id} version={note.updated_at} />
        {(apps as any[]).length > 0 && (
          <div><p className="mb-1 text-sm font-semibold">Applied to</p>
            <ul className="space-y-1 text-sm">{(apps as any[]).map((a) => <li key={a.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-1.5"><span>{a.invoices?.invoice_number} · {fmtDate(a.applied_at)}</span><b>{formatKES(Number(a.amount))}</b></li>)}</ul></div>
        )}
      </div>

      <Modal open={apply} onClose={() => setApply(false)} title="Apply credit to invoices" description={`${formatKES(left(note))} available`} size="lg"
        footer={<Button onClick={doApply} disabled={busy}>{busy && <OrbSpinner />} Apply</Button>}>
        {(openInv as any[]).length === 0 ? <p className="text-sm text-muted-foreground">This customer has no unpaid invoices.</p> : (
          <div className="space-y-2">{(openInv as any[]).map((i) => {
            const owe = Number(i.total) - Number(i.amount_paid);
            return (
              <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1"><p className="font-semibold">{i.invoice_number}</p><p className="text-xs text-muted-foreground">{fmtDate(i.issue_date)} · owes {formatKES(owe)}</p></div>
                <input className="fi w-32" type="number" min={0} step="0.01" placeholder="0.00" value={amounts[i.id] || ""} onChange={(e) => setAmounts({ ...amounts, [i.id]: e.target.value })} />
                <Button size="sm" variant="ghost" onClick={() => setAmounts({ ...amounts, [i.id]: String(Math.min(owe, left(note)).toFixed(2)) })}>Max</Button>
              </div>
            );
          })}</div>
        )}
      </Modal>
      <Modal open={refund} onClose={() => setRefund(false)} title="Refund from this credit note" size="md"
        footer={<Button onClick={doRefund} disabled={busy}>{busy && <OrbSpinner />} Record refund</Button>}>
        <div className="space-y-3">
          <Field label="Amount"><input className="fi" type="number" min={0} step="0.01" value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} /></Field>
          <Field label="Paid by"><select className="fi" value={rf.method} onChange={(e) => setRf({ ...rf, method: e.target.value })}><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></Field>
          <Field label="Reference"><input className="fi" value={rf.reference} onChange={(e) => setRf({ ...rf, reference: e.target.value })} placeholder="M-Pesa code or bank ref" /></Field>
        </div>
      </Modal>
    </DocPane>
  );
}
