import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Truck, Store, Phone, MessageCircle, Wallet, PackageCheck, XCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader, StatGrid, StatTile, EmptyState, Modal, Field } from "@/components/kit";
import { OrbLoader } from "@/components/orbs";
import { ZStatus } from "@/components/books/ZStatus";
import { confirmAction } from "@/components/books/confirm";
import { PAYMENT_MODES } from "@/components/books/RecordPayment";
import { shareOnWhatsApp } from "@/lib/docSend";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const FLOW = ["paid", "processing", "ready", "out_for_delivery", "delivered", "completed"] as const;
const LABEL: Record<string, string> = { pending_payment: "Awaiting payment", paid: "Paid", processing: "Packing", ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered", completed: "Completed", cancelled: "Cancelled" };

export default function OnlineOrders() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState("open");
  const [paying, setPaying] = useState<any>(null);
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["online-orders", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => (await sb.from("online_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500)).data || [],
  });
  const list = useMemo(() => (orders as any[]).filter((o) => view === "all" || (view === "open" ? !["completed", "cancelled", "delivered"].includes(o.status) : view === "unpaid" ? o.status === "pending_payment" : o.status === view)), [orders, view]);
  const setStatus = async (o: any, status: string) => {
    const { error } = await sb.from("online_orders").update({ status, updated_at: new Date().toISOString(), ...(status === "cancelled" ? { cancelled_at: new Date().toISOString() } : {}) }).eq("id", o.id);
    if (error) return toast({ title: "Not updated", description: error.message, variant: "destructive" });
    if (status === "cancelled" && o.transaction_id) await sb.from("transactions").update({ status: "cancelled" }).eq("id", o.transaction_id).eq("status", "pending");
    qc.invalidateQueries({ queryKey: ["online-orders"] });
  };
  const next = (s: string) => FLOW[FLOW.indexOf(s as any) + 1];
  const count = (f: (o: any) => boolean) => (orders as any[]).filter(f).length;
  if (isLoading) return <OrbLoader label="Loading online orders…" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Online Orders" icon={Globe} description="Orders from the website company. Paying for an order deducts its stock like a till sale."
        actions={<Button variant="outline" asChild><a href="/shop" target="_blank" rel="noopener noreferrer"><ExternalLink /> Open the company</a></Button>} />
      <StatGrid className="lg:grid-cols-4">
        <StatTile label="To pack / deliver" value={String(count((o) => ["paid", "processing", "ready", "out_for_delivery"].includes(o.status)))} icon={PackageCheck} />
        <StatTile label="Awaiting payment" value={String(count((o) => o.status === "pending_payment"))} icon={Wallet} tone="warning" />
        <StatTile label="Today" value={formatKES((orders as any[]).filter((o) => o.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10) && o.status !== "cancelled").reduce((a, o) => a + Number(o.total), 0))} icon={Globe} tone="info" />
        <StatTile label="All time" value={String((orders as any[]).length)} icon={Truck} tone="muted" />
      </StatGrid>
      <div className="flex flex-wrap gap-2">
        {[["open", "Open"], ["unpaid", "Awaiting payment"], ["ready", "Ready"], ["delivered", "Delivered"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => <button key={k} onClick={() => setView(k)} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", view === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l}</button>)}
      </div>
      {list.length === 0 ? <EmptyState icon={Globe} title="No orders here" description="Orders placed on the website company appear here, with a bell alert." /> : (
        <div className="space-y-3"><PagedRows rows={list}>{(pageRows) => pageRows.map((o: any) => (
          <div key={o.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-lg font-bold">{o.order_no}</p>
              <ZStatus status={o.status === "pending_payment" ? "pending" : o.status} className="ml-1" />
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{LABEL[o.status]}</span>
              <span className="text-sm text-muted-foreground">· {fmtDate(o.created_at)} {new Date(o.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="flex-1" />
              <p className="font-display text-xl font-bold">{formatKES(Number(o.total))}</p>
            </div>
            <div className="mt-2 grid gap-3 text-sm md:grid-cols-[1fr_1fr_auto]">
              <div>
                <p className="font-semibold">{o.customer_id ? <Link to={`/customers/${o.customer_id}`} className="hover:text-primary">{o.customer_name}</Link> : o.customer_name}</p>
                <p className="text-muted-foreground"><Phone className="mr-1 inline h-3.5 w-3.5" />{o.phone}{o.email ? ` · ${o.email}` : ""}</p>
                <p className="mt-1 flex items-center gap-1 text-muted-foreground">{o.delivery_method === "delivery" ? <><Truck className="h-3.5 w-3.5" /> Deliver to: {o.address}</> : <><Store className="h-3.5 w-3.5" /> Pickup at the company</>}</p>
                {o.notes && <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1 text-xs">{o.notes}</p>}
              </div>
              <ul className="text-sm">{(o.items || []).map((i: any, k: number) => <li key={k} className="flex justify-between gap-2"><span>{i.name} × {i.quantity}</span><span className="text-muted-foreground">{formatKES(i.price * i.quantity)}</span></li>)}</ul>
              <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-end">
                {o.status === "pending_payment" && <Button size="sm" onClick={() => setPaying(o)}><Wallet /> Record payment</Button>}
                {next(o.status) && o.status !== "pending_payment" && <Button size="sm" onClick={() => setStatus(o, next(o.status)!)}>Mark {LABEL[next(o.status)!].toLowerCase()}</Button>}
                <Button size="sm" variant="outline" onClick={() => shareOnWhatsApp(o.phone, `Hello ${o.customer_name}, about your order ${o.order_no}: `)}><MessageCircle /> WhatsApp</Button>
                {!["completed", "cancelled", "delivered"].includes(o.status) && <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction({ title: `Cancel ${o.order_no}?`, message: o.status === "pending_payment" ? "Nothing was paid; the stock stays." : "It was paid: refund it from Returns & Refunds.", danger: true, confirmLabel: "Cancel order" })) void setStatus(o, "cancelled"); }}><XCircle /> Cancel</Button>}
              </div>
            </div>
          </div>
        ))}</PagedRows></div>
      )}
      {paying && <PayModal order={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); qc.invalidateQueries({ queryKey: ["online-orders"] }); }} />}
    </div>
  );
}

function PayModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [method, setMethod] = useState("cash");
  const [ref, setRef] = useState("");
  const save = async () => {
    // Completing the order's sale deducts its stock and marks the order paid (database triggers).
    const { error } = await sb.from("transactions").update({ status: "completed", payment_method: method === "mpesa" ? "mobile_money" : method, ...(ref ? { mpesa_ref: ref.toUpperCase() } : {}) }).eq("id", order.transaction_id);
    if (error) return toast({ title: "Not recorded", description: error.message, variant: "destructive" });
    toast({ title: `${order.order_no} paid`, description: "Stock was deducted." });
    onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Record payment for ${order.order_no}`} icon={Wallet} description={formatKES(Number(order.total))}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Mark paid</Button></>}>
      <div className="space-y-3">
        <Field label="Paid by"><select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_MODES.filter((m) => m.value !== "other").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        <Field label="Reference (M-Pesa code, slip…)"><input className="fi uppercase" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
