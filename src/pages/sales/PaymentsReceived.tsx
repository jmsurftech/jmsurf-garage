import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X, Trash2, Wallet, MoreHorizontal, CalendarDays, HandCoins, PiggyBank, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, Modal, Field, StatGrid, StatTile } from "@/components/kit";
import { useDebts } from "@/pages/sales/Debts";
import { OrbLoader } from "@/components/orbs";
import { DocumentPreview } from "@/components/print/document-pdf-view";
import { CustomerPicker, type PickedCustomer } from "@/components/books/CustomerPicker";
import { RecordPaymentModal, PAYMENT_MODES } from "@/components/books/RecordPayment";
import { confirmAction } from "@/components/books/confirm";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import Pager, { usePaged } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";

const sb: any = supabase;
const modeLabel = (m: string) => PAYMENT_MODES.find((x) => x.value === m)?.label || m.replace(/_/g, " ");

export default function PaymentsReceived() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(false);
  const [payFor, setPayFor] = useState<PickedCustomer | null>(null);
  const { data: debts = [] } = useDebts();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payments-received", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("payments_received").select("*, payment_allocations(amount, invoices(invoice_number))").eq("tenant_id", tenantId).order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000)).data || [],
  });
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows as any[]).filter((p) => !s || `${p.payment_number} ${p.customer_name || ""} ${p.reference || ""}`.toLowerCase().includes(s));
  }, [rows, q]);
  const selected = id ? (rows as any[]).find((p) => p.id === id) : null;
  const paged = usePaged(list, 50);
  const sel = useSelection(paged.rows.map((p: any) => p.id));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["payments-received"] }); qc.invalidateQueries({ queryKey: ["zdocs"] }); qc.invalidateQueries({ queryKey: ["doc-model"] }); qc.invalidateQueries({ queryKey: ["doc-payments"] }); };

  const remove = async (p: any) => {
    if (!(await confirmAction({ title: `Delete payment ${p.payment_number}?`, message: "Invoices it paid become unpaid again.", confirmLabel: "Delete", danger: true }))) return;
    const { error } = await sb.from("payments_received").delete().eq("id", p.id);
    if (error) return toast({ title: "Not deleted", description: error.message, variant: "destructive" });
    refresh();
    toast({ title: "Payment deleted" });
    navigate("/sales/payments");
  };

  if (isLoading) return <OrbLoader label="Loading payments…" />;
  const applied = (p: any) => (p.payment_allocations || []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
  // Overview: money in this month and last, credit not yet used, what customers still owe, and how they pay.
  const ym = new Date().toISOString().slice(0, 7);
  const lastYm = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const sumOf = (xs: any[]) => xs.reduce((a, p) => a + Number(p.amount || 0), 0);
  const thisMonth = (rows as any[]).filter((p) => String(p.payment_date).startsWith(ym));
  const lastMonth = sumOf((rows as any[]).filter((p) => String(p.payment_date).startsWith(lastYm)));
  const unused = (rows as any[]).reduce((a, p) => a + Math.max(0, Number(p.amount) - applied(p)), 0);
  const owed = debts.reduce((a, d) => a + Number(d.balance || 0), 0);
  const overdueOwed = debts.filter((d) => d.days_overdue > 0).reduce((a, d) => a + Number(d.balance || 0), 0);
  const modes = new Map<string, number>();
  for (const p of thisMonth.length ? thisMonth : (rows as any[])) modes.set(p.method, (modes.get(p.method) || 0) + Number(p.amount || 0));
  const topMode = [...modes.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <h1 className="font-display text-lg font-bold">Payments Received</h1>
        <span className="flex-1" />
        {!selected && (
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payments…" className="fi h-9 w-64 rounded-full pl-9" />
          </div>
        )}
        <Button size="sm" onClick={() => setPick(true)}><Plus /> New</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 xl:block" : "w-full")}>
          {list.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments yet" description="Payments you record against invoices appear here." className="m-6" />
          ) : selected ? (
            <ul>{(paged.rows as any[]).map((p: any) => (
              <li key={p.id}><Link to={`/sales/payments/${p.id}`} className={cn("block border-b border-border px-4 py-3 hover:bg-muted/50", p.id === id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                <div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{p.customer_name}</span><span className="text-sm font-semibold tabular-nums">{formatKES(Number(p.amount))}</span></div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.payment_number} · {fmtDate(p.payment_date)} · {modeLabel(p.method)}</p>
              </Link></li>
            ))}<li><Pager {...paged.pager} /></li></ul>
          ) : (
            <div className="overflow-x-auto">
              <div className="p-3 sm:p-4">
                <StatGrid className="lg:grid-cols-4">
                  <StatTile label="Received this month" value={formatKES(sumOf(thisMonth))} icon={CalendarDays} tone="success" hint={`${thisMonth.length} payment${thisMonth.length === 1 ? "" : "s"} · last month ${formatKES(lastMonth)}`} />
                  <StatTile label="Customers still owe" value={formatKES(owed)} icon={HandCoins} tone="warning" hint={overdueOwed > 0 ? `${formatKES(overdueOwed)} overdue` : "Nothing overdue"} />
                  <StatTile label="Unused credit" value={formatKES(unused)} icon={PiggyBank} tone="info" hint="Paid but not applied to an invoice" />
                  <StatTile label="Most used mode" value={topMode ? modeLabel(topMode[0]) : "—"} icon={Smartphone} tone="muted" hint={topMode ? `${formatKES(topMode[1])} ${thisMonth.length ? "this month" : "in total"}` : undefined} />
                </StatGrid>
              </div>
              <BulkBar sel={sel} noun="payment">
                <Button size="sm" variant="outline" onClick={() => downloadCsv("payments-received.csv", ["Payment#", "Date", "Customer", "Mode", "Reference", "Amount", "Invoices"], (rows as any[]).filter((p) => sel.has(p.id)).map((p) => [p.payment_number, p.payment_date, p.customer_name, modeLabel(p.method), p.reference, p.amount, (p.payment_allocations || []).map((a: any) => a.invoices?.invoice_number).filter(Boolean).join(" ")]))}>Export selected</Button>
              </BulkBar>
              <table className="w-full min-w-[800px] text-sm">
                <thead className="sticky top-0 bg-card"><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 px-3 py-2.5 text-left"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} /></th><th className="px-4 py-2.5 text-left">Date</th><th className="px-4 py-2.5 text-left">Payment#</th><th className="px-4 py-2.5 text-left">Reference Number</th>
                  <th className="px-4 py-2.5 text-left">Customer Name</th><th className="px-4 py-2.5 text-left">Invoice#</th><th className="px-4 py-2.5 text-left">Mode</th>
                  <th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Unused Amount</th>
                </tr></thead>
                <tbody>{(paged.rows as any[]).map((p: any) => (
                  <tr key={p.id} onClick={() => navigate(`/sales/payments/${p.id}`)} className={cn("cursor-pointer border-b border-border hover:bg-muted/40", sel.has(p.id) && "bg-primary/5")}>
                    <td className="w-10 px-3 py-3"><Tick on={sel.has(p.id)} onChange={() => sel.toggle(p.id)} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(p.payment_date)}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{p.payment_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.reference || ""}</td>
                    <td className="px-4 py-3 font-medium">{p.customer_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{(p.payment_allocations || []).map((a: any) => a.invoices?.invoice_number).filter(Boolean).join(", ")}</td>
                    <td className="px-4 py-3">{modeLabel(p.method)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKES(Number(p.amount))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatKES(Math.max(0, Number(p.amount) - applied(p)))}</td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager {...paged.pager} />
            </div>
          )}
        </div>
        {selected && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30">
            <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
              <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{selected.customer_name}</p><h2 className="font-display text-xl font-bold">{selected.payment_number}</h2></div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" className="h-9 gap-1.5 px-3 font-semibold" aria-label="More actions"><MoreHorizontal className="!h-5 !w-5" /> More</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuItem danger onSelect={() => remove(selected)}><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => navigate("/sales/payments")} aria-label="Close"><X /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5"><DocumentPreview kind="payment" id={selected.id} version={selected.created_at} /></div>
          </div>
        )}
      </div>

      {pick && (
        <Modal open onClose={() => { setPick(false); setPayFor(null); }} title="Record payment" icon={Wallet} description="Who paid?"
          footer={<><Button variant="outline" onClick={() => { setPick(false); setPayFor(null); }}>Cancel</Button><Button disabled={!payFor} onClick={() => setPick(false)}>Continue</Button></>}>
          <Field label="Customer" required><CustomerPicker value={payFor} onChange={setPayFor} /></Field>
          <p className="mt-2 text-xs text-muted-foreground">The payment is applied to this customer's oldest unpaid invoices first. Anything extra stays as credit.</p>
        </Modal>
      )}
      {!pick && payFor && (
        <RecordPaymentModal customer={payFor} onClose={() => setPayFor(null)} onSaved={(pid) => { setPayFor(null); refresh(); navigate(`/sales/payments/${pid}`); }} />
      )}
    </div>
  );
}
