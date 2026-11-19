import { useMemo, useState } from "react";
import Pager, { usePaged } from "@/components/Pager";
import { cn } from "@/lib/utils";
import { useSelection, BulkBar, TickAllCell, TickCell, downloadCsv } from "@/components/Bulk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Plus, Search, Download, AlertTriangle, Truck, Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, EmptyState, Modal, Field, StatGrid, StatTile, TableWrap } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { formatKES } from "@/lib/format";
import { fmtDate } from "@/lib/doc-pdf";
import { saveFile } from "@/lib/erpApi";

const sb: any = supabase;
const METHODS: Record<string, string> = { mpesa: "M-Pesa", cash: "Cash", bank_transfer: "Bank transfer", cheque: "Cheque", card: "Card" };

/** Purchases → Payments: money paid out to suppliers and against bills. */
export default function SupplierPayments() {
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-payments", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [sp, sup, bills] = await Promise.all([
        sb.from("supplier_payments").select("*").eq("tenant_id", tenantId).order("paid_on", { ascending: false }).limit(3000),
        sb.from("suppliers").select("id,name").eq("tenant_id", tenantId).order("name"),
        sb.from("bills").select("id,name,bill_number,amount,amount_paid,status,supplier_id,due_date,bill_date,created_at").not("status", "in", "(draft,void)").eq("tenant_id", tenantId).limit(3000),
      ]);
      return { pays: (sp.data || []) as any[], suppliers: (sup.data || []) as any[], bills: (bills.data || []) as any[] };
    },
  });
  const sName = useMemo(() => new Map((data?.suppliers || []).map((s) => [s.id, s.name])), [data]);
  const bName = useMemo(() => new Map((data?.bills || []).map((b) => [b.id, b.name])), [data]);
  const rows = (data?.pays || []).filter((p) => (!month || String(p.paid_on).startsWith(month)) && (!q.trim() || `${sName.get(p.supplier_id) || ""} ${bName.get(p.bill_id) || ""} ${p.reference || ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const paged = usePaged(rows, 25);
  const total = rows.reduce((a, p) => a + Number(p.amount), 0);
  const psel = useSelection(rows.map((p: any) => p.id));
  const picked = rows.filter((p: any) => psel.has(p.id));
  const unpaidBills = (data?.bills || []).filter((b) => Number(b.amount) - Number(b.amount_paid || 0) > 0.005);
  const owedOn = (b: any) => Number(b.amount) - Number(b.amount_paid || 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueBills = unpaidBills.filter((b) => b.due_date && b.due_date < todayIso);
  const withheld = rows.reduce((a, p) => a + Number(p.withholding_vat || 0), 0);
  const bySupplier = new Map<string, number>();
  for (const p of rows) if (p.supplier_id) bySupplier.set(p.supplier_id, (bySupplier.get(p.supplier_id) || 0) + Number(p.amount));
  const topSupplier = [...bySupplier.entries()].sort((a, b) => b[1] - a[1])[0];

  if (isLoading) return <OrbLoader label="Loading payments…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Payments Made" icon={Banknote} description="Money paid to suppliers and against bills."
        actions={<Button onClick={() => setOpen(true)}><Plus /> Record payment</Button>} />
      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Bills still owed" value={formatKES(unpaidBills.reduce((a, b) => a + owedOn(b), 0))} icon={Banknote} tone="warning" hint={`${unpaidBills.length} bill${unpaidBills.length === 1 ? "" : "s"}`} />
        <StatTile label="Overdue bills" value={formatKES(overdueBills.reduce((a, b) => a + owedOn(b), 0))} icon={AlertTriangle} tone={overdueBills.length ? "danger" : "muted"} hint={overdueBills.length ? `${overdueBills.length} past the due date` : "Nothing overdue"} />
        <StatTile label="Paid most to" value={topSupplier ? sName.get(topSupplier[0]) || "—" : "—"} icon={Truck} tone="info" hint={topSupplier ? formatKES(topSupplier[1]) : undefined} />
        {withheld > 0 && <StatTile label="Withholding VAT kept" value={formatKES(withheld)} icon={Percent} tone="muted" hint="Pay it to KRA" />}
      </StatGrid>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className="fi w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Button variant="ghost" size="sm" onClick={() => setMonth("")}>All time</Button>
        <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className="fi pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button variant="outline" size="sm" onClick={() => saveFile("supplier-payments.csv", ["Date,Supplier,Bill,Method,Reference,Amount", ...rows.map((p) => [p.paid_on, sName.get(p.supplier_id) || "", bName.get(p.bill_id) || "", METHODS[p.method] || p.method, p.reference || "", p.amount].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n"), "text/csv")}><Download /> CSV</Button>
      </div>
      <Panel flush>
        {rows.length === 0 ? <EmptyState icon={Banknote} title="No payments in this period" /> : (
          <><BulkBar sel={psel} noun="payment">
            <button className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold" onClick={() => downloadCsv("payments-made.csv", ["Date", "Supplier", "Bill", "Method", "Reference", "Amount", "Withholding VAT"], picked.map((p: any) => [p.paid_on, sName.get(p.supplier_id) || "", bName.get(p.bill_id) || "", METHODS[p.method] || p.method, p.reference || "", Number(p.amount), Number(p.withholding_vat || 0)]))}>Export</button>
            <span className="text-xs text-muted-foreground">Total {formatKES(picked.reduce((a: number, p: any) => a + Number(p.amount), 0))}</span>
          </BulkBar>
          <TableWrap><table className="dt">
            <thead><tr><TickAllCell sel={psel} /><th>Date</th><th>Payment#</th><th>Vendor</th><th className="hidden md:table-cell">Bill</th><th className="hidden sm:table-cell">Method</th><th className="hidden lg:table-cell">Reference</th><th className="num">Amount</th></tr></thead>
            <tbody>{paged.rows.map((p) => (
              <tr key={p.id} className={psel.has(p.id) ? "bg-primary/5" : undefined}><TickCell sel={psel} id={p.id} /><td className="whitespace-nowrap">{fmtDate(p.paid_on)}</td><td className="font-semibold text-primary">{p.payment_number || "—"}</td><td className="font-medium">{sName.get(p.supplier_id) || "—"}</td><td className="hidden text-muted-foreground md:table-cell">{bName.get(p.bill_id) || "—"}</td><td className="hidden sm:table-cell">{METHODS[p.method] || p.method}</td><td className="hidden text-muted-foreground lg:table-cell">{p.reference || "—"}</td><td className="num font-semibold">{formatKES(Number(p.amount))}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={7}>Total</td><td className="num">{formatKES(total)}</td></tr></tfoot>
          </table></TableWrap><Pager {...paged.pager} /></>
        )}
      </Panel>
      {open && <VendorPaymentForm suppliers={data?.suppliers || []} bills={unpaidBills} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["supplier-payments"] }); qc.invalidateQueries({ queryKey: ["bills-z"] }); qc.invalidateQueries({ queryKey: ["payables"] }); qc.invalidateQueries({ queryKey: ["purchase-orders-z"] }); }} />}
    </div>
  );
}

const MODES: [string, string][] = [["mpesa", "M-Pesa"], ["bank_transfer", "Bank transfer"], ["cash", "Cash"], ["cheque", "Cheque"], ["card", "Card"]];
const PAID_THROUGH = ["M-Pesa till / paybill", "Bank account", "Petty cash", "Cash in till", "Owner's money", "Company card"];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Payments Made → New, as in Zoho: the vendor, how much, when and how, and how it is spread over their unpaid bills. */
function VendorPaymentForm({ suppliers, bills, onClose, onSaved }: { suppliers: any[]; bills: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [vendor, setVendor] = useState("");
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState("");
  const [f, setF] = useState({ method: "mpesa", paid_through: "M-Pesa till / paybill", reference: "", paid_on: new Date().toISOString().slice(0, 10), notes: "" });
  const [split, setSplit] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = new Date().toISOString().slice(0, 10);
  const owed = (b: any) => r2(Number(b.amount) - Number(b.amount_paid || 0));
  const mine = bills.filter((b) => b.supplier_id === vendor).sort((x, y) => String(x.due_date || "9").localeCompare(String(y.due_date || "9")));
  const totalOwed = r2(mine.reduce((acc, b) => acc + owed(b), 0));
  const pay = full ? totalOwed : Math.max(0, Number(amount) || 0);
  const auto = useMemo(() => { let left = pay; const o: Record<string, string> = {}; for (const b of mine) { const x = r2(Math.min(left, owed(b))); o[b.id] = x > 0 ? String(x) : ""; left = r2(left - x); } return o; }, [pay, vendor, bills]); // eslint-disable-line react-hooks/exhaustive-deps
  const use = edited ? split : auto;
  const applied = r2(mine.reduce((acc, b) => acc + Math.min(owed(b), Math.max(0, Number(use[b.id]) || 0)), 0));
  const save = async () => {
    if (!vendor) return toast({ title: "Choose the vendor", variant: "destructive" });
    if (!(pay > 0)) return toast({ title: "Enter the amount paid", variant: "destructive" });
    if (Math.abs(applied - pay) > 0.005) return toast({ title: "Spread the whole payment over the bills", description: `Applied ${formatKES(applied)} of ${formatKES(pay)}.`, variant: "destructive" });
    setBusy(true);
    const { data: num, error } = await sb.rpc("record_vendor_payment", {
      p_supplier: vendor, p_amount: pay, p_method: f.method, p_reference: f.reference.trim() || null, p_paid_on: f.paid_on, p_notes: f.notes.trim() || null, p_paid_through: f.paid_through,
      p_allocations: mine.map((b) => ({ bill_id: b.id, amount: Math.min(owed(b), Math.max(0, Number(use[b.id]) || 0)) })).filter((x) => x.amount > 0),
    });
    setBusy(false);
    if (error) return toast({ title: "Payment not recorded", description: error.message, variant: "destructive" });
    toast({ title: `Payment ${num} recorded`, description: `${formatKES(pay)} to ${suppliers.find((x) => x.id === vendor)?.name || "the vendor"}. Still owed: ${formatKES(Math.max(0, totalOwed - pay))}.` });
    onSaved();
  };
  return (
    <Modal open onClose={onClose} size="xl" title="Record payment made" icon={Banknote} locked={busy}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy}>{busy && <OrbSpinner />} Save payment</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor Name" required className="sm:col-span-2"><select className="fi" value={vendor} onChange={(e) => { setVendor(e.target.value); setEdited(false); }}><option value="">Select a Vendor</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        </div>
        {vendor && <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3", full ? "border-primary bg-primary/5" : "border-border")}><input type="radio" className="accent-primary" checked={full} onChange={() => { setFull(true); setEdited(false); }} />
              <span><span className="block text-sm font-semibold">Pay in full</span><span className="block text-base font-bold tabular-nums">{formatKES(totalOwed)}</span><span className="block text-xs text-muted-foreground">{mine.length} unpaid bill{mine.length === 1 ? "" : "s"}</span></span></label>
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3", !full ? "border-primary bg-primary/5" : "border-border")}><input type="radio" className="accent-primary" checked={!full} onChange={() => { setFull(false); setEdited(false); }} />
              <span className="flex-1"><span className="block text-sm font-semibold">Part payment</span><input className="fi mt-1 h-9 font-semibold" type="number" min={0} step="any" placeholder="Payment Made" value={amount} onFocus={() => setFull(false)} onChange={(e) => { setFull(false); setEdited(false); setAmount(e.target.value); }} /></span></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Payment Date" required><input className="fi" type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
            <Field label="Payment Mode"><select className="fi" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Paid Through"><select className="fi" value={f.paid_through} onChange={(e) => setF({ ...f, paid_through: e.target.value })}>{PAID_THROUGH.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Reference#"><input className="fi uppercase" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={f.method === "mpesa" ? "M-Pesa code" : ""} /></Field>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><span>Bills</span>{edited && <button type="button" className="font-semibold normal-case tracking-normal text-primary" onClick={() => setEdited(false)}>Split automatically</button>}</div>
            {!mine.length ? <p className="p-3 text-sm text-muted-foreground">This vendor has no unpaid bills.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Bill#</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Amount Due</th><th className="w-36 px-3 py-2 text-right">Payment</th></tr></thead>
                <tbody>{mine.map((b) => { const late = b.due_date && b.due_date < t ? Math.floor((Date.parse(t) - Date.parse(b.due_date)) / 86400000) : 0; return (
                  <tr key={b.id} className="border-t border-border">
                    <td className="px-3 py-2">{fmtDate(b.bill_date || b.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{b.bill_number || b.name}</td>
                    <td className="px-3 py-2">{b.due_date ? fmtDate(b.due_date) : "—"}{late > 0 && <span className="block text-xs font-semibold text-destructive">{late} days overdue</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKES(owed(b))}</td>
                    <td className="px-3 py-2 text-right"><input className="fi h-8 text-right tabular-nums" type="number" min={0} max={owed(b)} step="any" value={use[b.id] ?? ""} onChange={(e) => { setEdited(true); setSplit({ ...use, [b.id]: e.target.value }); }} aria-label={`Payment for ${b.bill_number || b.name}`} /></td>
                  </tr>
                ); })}</tbody>
              </table>
            )}
            <div className="flex justify-between border-t border-border bg-muted/30 px-3 py-2 text-sm"><span>Applied <b className="tabular-nums">{formatKES(applied)}</b> of <b className="tabular-nums">{formatKES(pay)}</b></span><span className="text-muted-foreground">Still owed after this: <b className="tabular-nums">{formatKES(Math.max(0, totalOwed - applied))}</b></span></div>
          </div>
          <Field label="Notes"><textarea className="fi" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </>}
      </div>
    </Modal>
  );
}
