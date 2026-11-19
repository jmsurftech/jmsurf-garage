import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ReceiptText, Wallet, History, RotateCcw, AlertTriangle, CheckCircle2, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocations } from "@/hooks/useData";
import { useSuppliers } from "@/pages/Suppliers";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { formatKES, currencyCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader, Toolbar, SearchBox, Segmented, Panel, TableWrap, EmptyState, StatTile, StatGrid, PageLoader, Modal, Field, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { PagedRows } from "@/components/Pager";
import { OrbSpinner } from "@/components/orbs";
import { confirmAction } from "@/components/books/confirm";

const sb: any = supabase;

export const PAY_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa / mobile money" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];
const methodLabel = (m: string) => PAY_METHODS.find((x) => x.value === m)?.label || m;

function useBills() {
  return useQuery({
    queryKey: ["bills"],
    queryFn: async () => {
      const { data, error } = await sb.from("bills").select("*").order("bill_date", { ascending: false, nullsFirst: false }).order("bill_number", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useBillCategories() {
  return useQuery({
    queryKey: ["bill-categories"],
    queryFn: async () => {
      const { data } = await sb.from("bill_categories").select("*").eq("is_active", true).order("name");
      return (data || []) as any[];
    },
  });
}

const balanceOf = (b: any) => Math.max(0, Math.round((Number(b.amount) - Number(b.amount_paid || 0)) * 100) / 100);
const isOverdue = (b: any) => balanceOf(b) > 0 && b.next_due_date && new Date(b.next_due_date) < new Date(new Date().toDateString());

/** Record a payment on a bill (part or full). */
export function PayBillModal({ bill, onClose, onPaid }: { bill: any; onClose: () => void; onPaid?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const due = balanceOf(bill);
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) { toast({ title: "Enter the amount paid", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await sb.rpc("record_bill_payment", { p_bill: bill.id, p_amount: n, p_method: method, p_reference: reference || null, p_paid_on: paidOn, p_notes: notes || null });
    setSaving(false);
    if (error) { toast({ title: "Payment not saved", description: error.message, variant: "destructive" }); return; }
    ["bills", "purchases", "supplier-payments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title: n >= due ? "Bill paid in full" : "Part payment recorded", description: `${formatKES(n)} to ${bill.name}` });
    onPaid?.();
    onClose();
  };

  return (
    <Modal open onClose={() => !saving && onClose()} icon={Wallet} title="Record payment" description={`${bill.name} · ${formatKES(due)} still owed`}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving && <OrbSpinner />} Save payment</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Amount (${currencyCode()})`} hint="Pay less to record a part payment">
          <input className="fi text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Paid on"><input className="fi" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Paid by">
          <select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        </Field>
        <Field label="Reference" hint="M-Pesa code, cheque or bank ref"><input className="fi" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="fi" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function HistoryModal({ bill, onClose }: { bill: any; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["supplier-payments", bill.id],
    queryFn: async () => {
      const { data } = await sb.from("supplier_payments").select("*").eq("bill_id", bill.id).order("paid_on", { ascending: false });
      return (data || []) as any[];
    },
  });
  return (
    <Modal open onClose={onClose} icon={History} title="Payment history" description={`${bill.name} · ${formatKES(Number(bill.amount))} total`} size="lg">
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : data.length === 0 ? <EmptyState title="No payments yet" className="py-8" /> : (
        <ul className="divide-y divide-border">
          <PagedRows rows={data} list>{(pageRows) => pageRows.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium">{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""}</p>
                <p className="text-xs text-muted-foreground">{new Date(p.paid_on).toLocaleDateString()}{p.recorded_by_name ? ` · ${p.recorded_by_name}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
              </div>
              <span className="font-semibold tabular-nums text-success">{formatKES(Number(p.amount))}</span>
            </li>
          ))}</PagedRows>
        </ul>
      )}
    </Modal>
  );
}

function AddBillModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { data: locations = [] } = useLocations();
  const { data: suppliers = [] } = useSuppliers();
  const { data: categories = [] } = useBillCategories();
  const [f, setF] = useState({ name: "", category: "", amount: "", supplier_id: "", location_id: "", next_due_date: "", is_recurring: false, recurrence_interval: "1", recurrence_unit: "months", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (!f.location_id && locations[0]) set("location_id", (locations[0] as any).id); }, [locations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!f.name.trim() || !(Number(f.amount) > 0)) { toast({ title: "Enter a name and an amount", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await sb.from("bills").insert({
      name: f.name.trim(), category: f.category || "Other", amount: Number(f.amount), status: "pending",
      supplier_id: f.supplier_id || null, location_id: f.location_id || null, next_due_date: f.next_due_date || null,
      is_recurring: f.is_recurring, recurrence_interval: Number(f.recurrence_interval) || 1, recurrence_unit: f.recurrence_unit,
      notes: f.notes, created_by: user?.id, tenant_id: profile?.tenant_id,
    });
    setSaving(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["bills"] });
    toast({ title: "Bill added" });
    onClose();
  };

  return (
    <Modal open onClose={() => !saving && onClose()} icon={ReceiptText} title="Add a bill" description="Rent, utilities, a supplier invoice or anything you need to pay."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <OrbSpinner />} Save bill</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What for" required className="sm:col-span-2"><input className="fi" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Electricity, Rent" /></Field>
        <Field label={`Amount (${currencyCode()})`} required><input className="fi text-right" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <Field label="Due date"><input className="fi" type="date" value={f.next_due_date} onChange={(e) => set("next_due_date", e.target.value)} /></Field>
        <Field label="Category">
          <select className="fi" value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">Other</option>{categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Supplier (optional)">
          <select className="fi" value={f.supplier_id} onChange={(e) => set("supplier_id", e.target.value)}>
            <option value="">None</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {locations.length > 1 && (
          <Field label="Branch">
            <select className="fi" value={f.location_id} onChange={(e) => set("location_id", e.target.value)}>{locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.is_recurring} onChange={(e) => set("is_recurring", e.target.checked)} /> Repeats (e.g. monthly rent)</label>
        {f.is_recurring && (
          <Field label="Every" className="sm:col-span-2">
            <div className="flex gap-2">
              <input className="fi w-20 text-right" inputMode="numeric" value={f.recurrence_interval} onChange={(e) => set("recurrence_interval", e.target.value)} />
              <select className="fi w-auto" value={f.recurrence_unit} onChange={(e) => set("recurrence_unit", e.target.value)}>
                <option value="days">days</option><option value="weeks">weeks</option><option value="months">months</option><option value="years">years</option>
              </select>
            </div>
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2"><textarea className="fi" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Bills: what the shop owes (supplier purchase orders and other bills) and what it has paid. */
export default function Bills() {
  const { data: bills = [], isLoading } = useBills();
  const { data: locations = [] } = useLocations();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("bills_delete");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("owed");
  const [source, setSource] = useState("all");
  const [branch, setBranch] = useState("__all__");
  const [paying, setPaying] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [adding, setAdding] = useState(false);

  const scoped = useMemo(() => bills.filter((b) => (branch === "__all__" || b.location_id === branch)
    && (source === "all" || (source === "po" ? !!b.purchase_id : !b.purchase_id))), [bills, branch, source]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scoped.filter((b) => {
      const bal = balanceOf(b);
      const st = status === "all" ? true : status === "owed" ? bal > 0 : status === "partial" ? bal > 0 && Number(b.amount_paid) > 0 : status === "overdue" ? isOverdue(b) : bal === 0;
      return st && (!s || `${b.name} ${b.category}`.toLowerCase().includes(s));
    });
  }, [scoped, q, status]);

  const owed = scoped.reduce((a, b) => a + balanceOf(b), 0);
  const overdue = scoped.filter(isOverdue);
  const fromPOs = scoped.filter((b) => b.purchase_id && balanceOf(b) > 0).reduce((a, b) => a + balanceOf(b), 0);
  const { data: paidThisMonth = 0 } = useQuery({
    queryKey: ["supplier-payments", "month"],
    queryFn: async () => {
      const start = new Date(); start.setDate(1);
      const { data } = await sb.from("supplier_payments").select("amount").gte("paid_on", start.toISOString().slice(0, 10));
      return (data || []).reduce((a: number, p: any) => a + Number(p.amount), 0);
    },
  });

  const remove = async (b: any) => {
    if (Number(b.amount_paid) > 0) { toast({ title: "This bill has payments", description: "Bills with payments are kept for your records.", variant: "destructive" }); return; }
    if (b.purchase_id) { toast({ title: "This bill belongs to a purchase order", description: "Delete or edit the purchase order instead.", variant: "destructive" }); return; }
    if (!(await confirmAction({ title: `Delete "${b.name}"?`, message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await sb.from("bills").delete().eq("id", b.id);
    if (error) toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    else { qc.invalidateQueries({ queryKey: ["bills"] }); toast({ title: "Bill deleted" }); }
  };

  if (isLoading) return <PageLoader label="Loading bills…" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Bills" icon={ReceiptText} description="Supplier purchase orders and other bills: what you owe and what you have paid."
        actions={<>
          {locations.length > 1 && (
            <select className="fi w-auto" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="__all__">All branches</option>{locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <Button onClick={() => setAdding(true)}><Plus /> Add bill</Button>
        </>} />

      <StatGrid>
        <StatTile label="Owed now" value={formatKES(owed)} icon={Wallet} tone={owed > 0 ? "warning" : "success"} />
        <StatTile label="Owed to suppliers (POs)" value={formatKES(fromPOs)} icon={ShoppingBag} tone="info" />
        <StatTile label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "muted"} hint={overdue.length ? formatKES(overdue.reduce((a, b) => a + balanceOf(b), 0)) : "Nothing late"} />
        <StatTile label="Paid this month" value={formatKES(Number(paidThisMonth))} icon={CheckCircle2} tone="success" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Bill or supplier…" />
        <Segmented value={status} onChange={setStatus} options={[
          { value: "owed", label: "To pay", count: scoped.filter((b) => balanceOf(b) > 0).length },
          { value: "partial", label: "Part paid" },
          { value: "overdue", label: "Overdue", count: overdue.length },
          { value: "paid", label: "Paid" },
          { value: "all", label: "All" },
        ]} />
        <select className="fi w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All bills</option><option value="po">From purchase orders</option><option value="other">Other bills</option>
        </select>
      </Toolbar>

      <Panel flush>
        {visible.length === 0 ? (
          <EmptyState icon={ReceiptText} title={bills.length ? "No bills here" : "No bills yet"}
            description={bills.length ? "Try another filter." : "Receiving a purchase order creates its bill here. You can also add rent, utilities and other bills."} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Bill</th><th>Due</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                <PagedRows rows={visible} colSpan={7}>{(rows) => rows.map((b: any) => {
                  const bal = balanceOf(b);
                  const late = isOverdue(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        <p className="font-medium">{b.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.purchase_id ? "Purchase order" : b.category}
                          {b.is_recurring && <span className="ml-1 inline-flex items-center gap-0.5"><RotateCcw className="h-3 w-3" /> every {b.recurrence_interval} {b.recurrence_unit}</span>}
                        </p>
                      </td>
                      <td className={cn("whitespace-nowrap text-sm", late ? "font-semibold text-destructive" : "text-muted-foreground")}>{b.next_due_date ? new Date(b.next_due_date).toLocaleDateString() : "—"}</td>
                      <td className="num">{formatKES(Number(b.amount))}</td>
                      <td className="num text-success">{Number(b.amount_paid) > 0 ? formatKES(Number(b.amount_paid)) : "—"}</td>
                      <td className="num font-semibold">{formatKES(bal)}</td>
                      <td>{bal === 0 ? <Pill tone="success">Paid</Pill> : late ? <Pill tone="danger">Overdue</Pill> : Number(b.amount_paid) > 0 ? <Pill tone="info">Part paid</Pill> : <Pill tone="warning">To pay</Pill>}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {bal > 0 && <Button size="sm" onClick={() => setPaying(b)}><Wallet /> Pay</Button>}
                          <Button size="sm" variant="outline" onClick={() => setHistory(b)}><History /> History</Button>
                          {canDelete && !b.purchase_id && Number(b.amount_paid) === 0 && (
                            <button className="icon-btn-danger" onClick={() => remove(b)} aria-label={`Delete ${b.name}`} title="Delete"><Trash2 className="h-4 w-4" /></button>
                          )}
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

      {paying && <PayBillModal bill={paying} onClose={() => setPaying(null)} />}
      {history && <HistoryModal bill={history} onClose={() => setHistory(null)} />}
      {adding && <AddBillModal onClose={() => setAdding(false)} />}
    </div>
  );
}
