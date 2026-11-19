import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTaxSettings } from "@/lib/tax";
import { Wallet, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/kit";
import { OrbSpinner } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";
import { useTenantId } from "@/hooks/useTenantId";
import { uploadDocument } from "@/components/DocumentsPanel";
import { useMoneyAccounts } from "@/hooks/useMoneyAccounts";

const sb = supabase as any;

/** Payment modes offered everywhere ("Payment Mode"). PDQ = card machine. */
export const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "pdq_card", label: "Card (PDQ)" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

type Unpaid = { id: string; invoice_number: string; issue_date: string | null; due_date: string | null; total: number; amount_paid: number; due: number; overdue: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysLate = (due: string | null) => (due ? Math.floor((Date.parse(todayIso()) - Date.parse(due)) / 86400000) : 0);

/**
 * Records money received from a customer: the full amount or a part payment, split across their unpaid
 * invoices (the given invoice first, then the oldest due), overdue ones marked. What is not applied stays
 * as the customer's credit. Their statement follows from the same records.
 */
export function RecordPaymentModal({ customer, invoice, onClose, onSaved }: {
  customer: { id: string | null; name?: string | null };
  invoice?: { id: string; number: string; balance: number } | null;
  onClose: () => void;
  onSaved: (paymentId: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"full" | "part">("full");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("mpesa");
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Zoho's extras: bank charges, the account the money went to, and attachments (e.g. the M-Pesa message or bank slip).
  const [charges, setCharges] = useState("");
  // "" = the usual account for the payment mode; otherwise a bank / M-Pesa / cash account id.
  const [depositTo, setDepositTo] = useState("");
  const { data: moneyAccounts = [] } = useMoneyAccounts();
  const [files, setFiles] = useState<File[]>([]);
  const payTenant = useTenantId();
  const [split, setSplit] = useState<Record<string, string>>({});
  const [splitEdited, setSplitEdited] = useState(false);

  // The customer's unpaid invoices: the one being paid first, then the oldest due.
  const { data: unpaid = [], isLoading } = useQuery({
    queryKey: ["pay-unpaid", customer.id], enabled: !!customer.id,
    queryFn: async (): Promise<Unpaid[]> => {
      const { data } = await sb.from("invoices").select("id,invoice_number,issue_date,due_date,total,amount_paid,status")
        .eq("customer_id", customer.id).not("status", "in", "(draft,void,paid)").order("due_date", { ascending: true, nullsFirst: false }).limit(200);
      const rows = ((data || []) as any[]).map((i) => ({ ...i, total: Number(i.total || 0), amount_paid: Number(i.amount_paid || 0), due: r2(Number(i.total || 0) - Number(i.amount_paid || 0)), overdue: daysLate(i.due_date) }))
        .filter((i) => i.due > 0.005);
      return invoice ? [...rows.filter((i) => i.id === invoice.id), ...rows.filter((i) => i.id !== invoice.id)] : rows;
    },
  });
  const outstanding = r2(unpaid.reduce((a, i) => a + i.due, 0));
  const overdueRows = unpaid.filter((i) => i.overdue > 0);
  const overdueTotal = r2(overdueRows.reduce((a, i) => a + i.due, 0));
  // "Full amount": this invoice's balance, or everything the customer owes.
  const fullAmount = invoice ? (unpaid.find((i) => i.id === invoice.id)?.due ?? invoice.balance) : outstanding;

  // Withholding VAT: a customer marked as withholding keeps part of the VAT (usually 2% of the amount before
  // VAT) and pays it to KRA; the invoice is still settled in full.
  const tax = useTaxSettings();
  const [whOn, setWhOn] = useState(false);
  const [withheld, setWithheld] = useState("");
  useEffect(() => {
    if (!customer.id || !tax.withholding.enabled || tax.withholding.appliesTo === "vendors") return;
    void (async () => {
      const { data: c } = await sb.from("customers").select("withholding_vat").eq("id", customer.id).maybeSingle();
      if (!c?.withholding_vat) return;
      setWhOn(true);
      if (invoice) {
        const { data: inv } = await sb.from("invoices").select("subtotal, total").eq("id", invoice.id).maybeSingle();
        const share = inv && Number(inv.total) > 0 ? Number(inv.subtotal) / Number(inv.total) : 1 / 1.16;
        setWithheld(String(Math.round(invoice.balance * share * tax.withholding.rate) / 100));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id, invoice?.id, tax.withholding.enabled]);
  const wht = whOn ? Math.max(0, Number(withheld) || 0) : 0;

  // The money received, and what it settles (received + withholding VAT).
  const received = mode === "full" ? r2(Math.max(0, fullAmount - wht)) : Math.max(0, Number(amount) || 0);
  const settles = r2(received + wht);

  // Split: unless changed by hand, fill each invoice in order until the money runs out.
  const autoSplit = useMemo(() => {
    let left = settles; const out: Record<string, string> = {};
    for (const i of unpaid) { const take = r2(Math.min(left, i.due)); out[i.id] = take > 0 ? String(take) : ""; left = r2(left - take); }
    return out;
  }, [settles, unpaid]);
  useEffect(() => { if (!splitEdited) setSplit(autoSplit); }, [autoSplit, splitEdited]);
  const applied = r2(unpaid.reduce((a, i) => a + Math.min(i.due, Math.max(0, Number(split[i.id]) || 0)), 0));
  const credit = r2(settles - applied);
  const overApplied = applied > settles + 0.005;

  const save = async () => {
    if (!customer.id) return toast({ title: "This document has no customer", description: "Pick a customer on it first.", variant: "destructive" });
    if (!(settles > 0)) return toast({ title: "Enter the amount received", variant: "destructive" });
    if (overApplied) return toast({ title: "The split is more than the payment", description: `Applied ${formatKES(applied)} of ${formatKES(settles)}.`, variant: "destructive" });
    if (method === "mpesa" && reference && !/^[A-Z0-9]{8,12}$/i.test(reference.trim())) {
      return toast({ title: "Check the M-Pesa code", description: "M-Pesa codes look like SJK4H2L9QX.", variant: "destructive" });
    }
    setBusy(true);
    const allocations = unpaid.map((i) => ({ invoice_id: i.id, amount: Math.min(i.due, Math.max(0, Number(split[i.id]) || 0)) })).filter((a) => a.amount > 0);
    const { data, error } = await sb.rpc("record_customer_payment_split", {
      p_customer: customer.id, p_amount: settles, p_method: method, p_reference: reference.trim().toUpperCase() || null,
      p_notes: notes.trim() || null, p_date: date, p_allocations: allocations,
    });
    if (!error) {
      const extra: Record<string, unknown> = { deposit_to: depositTo || null, bank_charges: Math.max(0, Number(charges) || 0) };
      if (wht > 0) extra.withholding_vat = wht;
      await sb.from("payments_received").update(extra).eq("id", data);
      for (const file of files) await uploadDocument(payTenant!, file, { entity_type: "payment", entity_id: data as string, entity_name: "Payment", category: "Attachment", name: file.name }).catch(() => null);
    }
    setBusy(false);
    if (error) return toast({ title: "Payment not recorded", description: error.message, variant: "destructive" });
    // Invoices, the customer's statement and balances read the same records: refresh them everywhere.
    ["zdocs", "invoices", "payments-received", "customer-ledger", "customer-account", "customer-accounts", "customer-history", "customer", "customers", "pay-unpaid", "doc-payments", "books-overview", "dash-home"]
      .forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    const left = r2(outstanding - applied);
    toast({
      title: `Payment of ${formatKES(received)} recorded${wht ? ` + ${formatKES(wht)} withholding VAT` : ""}`,
      description: `${customer.name || "The customer"} now owes ${formatKES(Math.max(0, left))}${credit > 0.005 ? ` and has ${formatKES(credit)} credit` : ""}. Their statement is updated.`,
    });
    onSaved(data as string);
  };

  return (
    <Modal open onClose={onClose} locked={busy} icon={Wallet} size="xl" title={invoice ? `Record payment for ${invoice.number}` : "Record payment"}
      description={customer.name || undefined}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || overApplied}>{busy ? <OrbSpinner state="working" /> : null} Save payment</Button></>}>
      <div className="space-y-4">
        {/* What the customer owes, and how much of it is overdue. */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Total owed</p><p className="font-display text-lg font-bold tabular-nums">{formatKES(outstanding)}</p><p className="text-xs text-muted-foreground">{unpaid.length} unpaid invoice{unpaid.length === 1 ? "" : "s"}</p></div>
          <div className={cn("rounded-xl p-3", overdueTotal > 0 ? "bg-destructive/10" : "bg-muted/60")}><p className="text-xs text-muted-foreground">Overdue</p><p className={cn("font-display text-lg font-bold tabular-nums", overdueTotal > 0 && "text-destructive")}>{formatKES(overdueTotal)}</p><p className="text-xs text-muted-foreground">{overdueRows.length} invoice{overdueRows.length === 1 ? "" : "s"} past due</p></div>
          {invoice && <div className="rounded-xl bg-primary/5 p-3"><p className="text-xs text-muted-foreground">{invoice.number} balance</p><p className="font-display text-lg font-bold tabular-nums">{formatKES(fullAmount)}</p></div>}
        </div>

        {/* Amount: full amount or a part payment. */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Amount received <span className="text-destructive">*</span></p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3", mode === "full" ? "border-primary bg-primary/5" : "border-border")}>
              <input type="radio" className="accent-primary" checked={mode === "full"} onChange={() => { setMode("full"); setSplitEdited(false); }} />
              <span className="min-w-0"><span className="block text-sm font-semibold">Full amount</span><span className="block text-base font-bold tabular-nums">{formatKES(Math.max(0, fullAmount - wht))}</span>
                <span className="block text-xs text-muted-foreground">{invoice ? `Settles ${invoice.number}` : "Settles every unpaid invoice"}</span></span>
            </label>
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3", mode === "part" ? "border-primary bg-primary/5" : "border-border")}>
              <input type="radio" className="accent-primary" checked={mode === "part"} onChange={() => { setMode("part"); setSplitEdited(false); }} />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Part payment</span>
                <input className="fi mt-1 h-9 text-base font-semibold" type="number" min={0} step="any" placeholder="Amount paid" value={amount}
                  onFocus={() => setMode("part")} onChange={(e) => { setMode("part"); setSplitEdited(false); setAmount(e.target.value); }} /></span>
            </label>
          </div>
        </div>
        {whOn && (
          <Field label={`Withholding VAT (${tax.withholding.rate}%)`} hint={`Settles ${formatKES(settles)} on the invoices. Keep the customer's withholding certificate.`}>
            <input className="fi" type="number" min={0} step="any" value={withheld} onChange={(e) => { setWithheld(e.target.value); setSplitEdited(false); }} />
          </Field>
        )}

        {/* Split across the unpaid invoices. */}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Apply to invoices</span>
            {splitEdited && <button type="button" className="font-semibold normal-case tracking-normal text-primary" onClick={() => setSplitEdited(false)}>Split automatically</button>}
          </div>
          {isLoading ? <p className="p-3 text-sm text-muted-foreground">Loading invoices…</p> : unpaid.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No unpaid invoices: the whole payment is kept as credit.</p> : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Owing</th><th className="w-36 px-3 py-2 text-right">Payment</th></tr></thead>
                <tbody>{unpaid.map((i) => (
                  <tr key={i.id} className={cn("border-t border-border", i.id === invoice?.id && "bg-primary/5")}>
                    <td className="px-3 py-2"><b>{i.invoice_number}</b><span className="block text-xs text-muted-foreground">{fmtDate(i.issue_date)}</span></td>
                    <td className="px-3 py-2">{i.due_date ? fmtDate(i.due_date) : "—"}
                      {i.overdue > 0 && <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3 w-3" /> {i.overdue} day{i.overdue === 1 ? "" : "s"} overdue</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKES(i.due)}</td>
                    <td className="px-3 py-2 text-right">
                      <input className="fi h-8 text-right tabular-nums" type="number" min={0} max={i.due} step="any" value={split[i.id] ?? ""}
                        onChange={(e) => { setSplitEdited(true); setSplit({ ...split, [i.id]: e.target.value }); }} aria-label={`Payment for ${i.invoice_number}`} />
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-border bg-muted/30 px-3 py-2 text-sm">
            <span>Applied <b className="tabular-nums">{formatKES(applied)}</b> of <b className="tabular-nums">{formatKES(settles)}</b></span>
            {overApplied ? <span className="font-semibold text-destructive">More than the payment</span>
              : credit > 0.005 ? <span className="text-muted-foreground">{formatKES(credit)} kept as credit for {customer.name || "the customer"}</span>
              : <span className="text-muted-foreground">Still owed after this: <b className="tabular-nums">{formatKES(Math.max(0, outstanding - applied))}</b></span>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment date" required><input className="fi" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Payment mode" required>
            <select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label={method === "mpesa" ? "M-Pesa code" : method === "pdq_card" ? "Card slip / approval code" : method === "cheque" ? "Cheque number" : "Reference#"}>
            <input className="fi uppercase" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "mpesa" ? "SJK4H2L9QX" : ""} />
          </Field>
          <Field label="Deposit To"><select className="fi" value={depositTo} onChange={(e) => setDepositTo(e.target.value)}><option value="">Usual account for this payment mode</option>{moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Bank Charges (if any)"><input className="fi" type="number" min={0} step="any" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Notes" hint="Internal use. Not visible to the customer"><input className="fi" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <Field label="Attachments" hint="Up to 5 files, 5MB each">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm hover:border-primary">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Upload File"}
              <input type="file" multiple className="hidden" onChange={(e) => { const add = Array.from(e.target.files || []).filter((x) => x.size <= 5 * 1024 * 1024); setFiles((cur) => [...cur, ...add].slice(0, 5)); e.target.value = ""; }} /></label>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
