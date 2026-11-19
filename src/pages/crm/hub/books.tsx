import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Mail, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Panel, StatusPill } from "@/components/kit";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sb, type RelatedType } from "./modules";

type Tab = "quotes" | "orders" | "invoices" | "payments" | "products";

/**
 * The record's side of the books, read live from Books: quotes, sales orders, invoices, payments
 * and the products on them. For a deal: the documents made for it; for an account (or a contact's
 * account): every document of that customer.
 */
export function BooksPanel({ dealId, customerId, compact }: { dealId?: string; customerId?: string | null; compact?: boolean }) {
  const tenantId = useTenantId();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("quotes");
  const { data } = useQuery({
    queryKey: ["crm-hub-books", tenantId, dealId || "", customerId || ""],
    enabled: !!tenantId && !!(dealId || customerId),
    queryFn: async () => {
      const by = (q: any) => (dealId ? q.eq("deal_id", dealId) : q.eq("customer_id", customerId));
      const [q, o, i, p] = await Promise.all([
        by(sb.from("quotes").select("id,quote_number,total,status,created_at,items").eq("tenant_id", tenantId)).order("created_at", { ascending: false }).limit(100),
        by(sb.from("sales_orders").select("id,quote_number,total,status,created_at,items").eq("tenant_id", tenantId)).order("created_at", { ascending: false }).limit(100),
        by(sb.from("invoices").select("id,invoice_number,total,amount_paid,status,due_date,created_at,items").eq("tenant_id", tenantId)).order("created_at", { ascending: false }).limit(200),
        customerId && !dealId ? sb.from("payments_received").select("id,payment_number,amount,payment_date,method,reference").eq("tenant_id", tenantId).eq("customer_id", customerId).order("payment_date", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
      ]);
      return { quotes: (q.data || []) as any[], orders: (o.data || []) as any[], invoices: (i.data || []) as any[], payments: (p.data || []) as any[] };
    },
  });
  const d = data || { quotes: [], orders: [], invoices: [], payments: [] };
  // Products: from invoices when there are any, else from orders, else quotes (what was sold or offered).
  const products = useMemo(() => {
    const src = d.invoices.length ? d.invoices : d.orders.length ? d.orders : d.quotes;
    const m = new Map<string, { name: string; qty: number; amount: number; item_id?: string }>();
    for (const doc of src) for (const li of Array.isArray(doc.items) ? doc.items : []) {
      const k = li.item_id || li.name || "Item";
      const cur = m.get(k) || { name: li.name || li.description || "Item", qty: 0, amount: 0, item_id: li.item_id };
      cur.qty += Number(li.quantity || 0); cur.amount += Number(li.amount ?? Number(li.quantity || 0) * Number(li.rate ?? li.price ?? 0));
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [d]);
  const invoiced = d.invoices.filter((x) => x.status !== "void").reduce((a, x) => a + Number(x.total || 0), 0);
  const paid = d.invoices.filter((x) => x.status !== "void").reduce((a, x) => a + Number(x.amount_paid || 0), 0);
  const q = new URLSearchParams({ ...(customerId ? { customer: customerId } : {}), ...(dealId ? { deal: dealId } : {}) }).toString();
  const tabs: [Tab, string, number][] = [["quotes", "Quotes", d.quotes.length], ["orders", "Sales orders", d.orders.length], ["invoices", "Invoices", d.invoices.length],
    ...(customerId && !dealId ? [["payments", "Payments", d.payments.length] as [Tab, string, number]] : []), ["products", "Products", products.length]];
  const open = (path: string) => nav(path);

  return (
    <Panel flush title="Books" icon={BookOpen}
      description={`Invoiced ${formatKES(invoiced)} · paid ${formatKES(paid)} · due ${formatKES(Math.max(0, invoiced - paid))}`}
      actions={<div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" asChild><Link to={`/sales/quotes/new?${q}`}><Plus /> Quote</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to={`/sales/orders/new?${q}`}><Plus /> Order</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to={`/sales/invoices/new?${q}`}><Plus /> Invoice</Link></Button>
      </div>}>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2">
        {tabs.map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("whitespace-nowrap border-b-2 px-3 pb-2 text-[13px] font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {l} <span className="ml-0.5 text-[11px] text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>
      {tab === "products" ? (
        products.length ? (
          <table className="dt"><thead><tr><th>Product</th><th className="text-right">Quantity</th><th className="text-right">Amount</th></tr></thead><tbody>
            {products.slice(0, compact ? 10 : 50).map((p) => <tr key={p.item_id || p.name} className={p.item_id ? "cursor-pointer" : ""} onClick={() => p.item_id && open(`/inventory/products/${p.item_id}`)}><td className="font-medium">{p.name}</td><td className="text-right tabular-nums">{p.qty.toLocaleString()}</td><td className="text-right tabular-nums">{formatKES(p.amount)}</td></tr>)}
          </tbody></table>
        ) : <p className="px-4 py-4 text-[13px] text-muted-foreground">No products on its documents yet.</p>
      ) : tab === "payments" ? (
        d.payments.length ? (
          <table className="dt"><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th className="text-right">Amount</th></tr></thead><tbody>
            {d.payments.map((p) => <tr key={p.id} className="cursor-pointer" onClick={() => open("/sales/payments")}><td className="font-medium text-primary">{p.payment_number || p.reference || "Payment"}</td><td className="text-xs">{p.payment_date}</td><td className="text-xs capitalize">{p.method || "—"}</td><td className="text-right tabular-nums">{formatKES(Number(p.amount || 0))}</td></tr>)}
          </tbody></table>
        ) : <p className="px-4 py-4 text-[13px] text-muted-foreground">No payments yet.</p>
      ) : (() => {
        const list = tab === "quotes" ? d.quotes : tab === "orders" ? d.orders : d.invoices;
        const base = tab === "quotes" ? "/sales/quotes" : tab === "orders" ? "/sales/orders" : "/sales/invoices";
        return list.length ? (
          <table className="dt"><thead><tr><th>Number</th><th>Date</th><th>Status</th><th className="text-right">Total</th>{tab === "invoices" && <th className="text-right">Due</th>}</tr></thead><tbody>
            {list.map((x) => (
              <tr key={x.id} className="cursor-pointer" onClick={() => open(`${base}/${x.id}`)}>
                <td className="font-medium text-primary">{x.invoice_number || x.quote_number}</td><td className="text-xs">{String(x.created_at).slice(0, 10)}</td><td><StatusPill status={x.status} /></td>
                <td className="text-right tabular-nums">{formatKES(Number(x.total || 0))}</td>{tab === "invoices" && <td className="text-right tabular-nums">{formatKES(Math.max(0, Number(x.total || 0) - Number(x.amount_paid || 0)))}</td>}
              </tr>))}
          </tbody></table>
        ) : <p className="px-4 py-4 text-[13px] text-muted-foreground">None yet.{dealId ? " Documents made from this deal show here, and move the deal on: a quote to Proposal, an accepted quote or an order to Negotiation, an invoice to Won." : ""}</p>;
      })()}
    </Panel>
  );
}

/** Write an email to the record from the company's own sender, kept on the record as a note. */
export function EmailComposer({ open, onClose, to, name, related, relatedId, onSent }: {
  open: boolean; onClose: () => void; to: string; name: string; related: RelatedType; relatedId: string; onSent: () => void;
}) {
  const tenantId = useTenantId();
  const [f, setF] = useState({ to: "", cc: "", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const first = String(name || "").split(" ")[0] || "";
  useEffect(() => { if (open) setF({ to, cc: "", subject: "", message: `Dear ${first},\n\n` }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    const list = [...f.to.split(/[\s,;]+/), ...f.cc.split(/[\s,;]+/)].map((x) => x.trim()).filter(Boolean);
    if (!list.length || !f.subject.trim() || !f.message.trim()) return toast.error("Enter the address, a subject and a message");
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch("/api/email/document", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token || ""}` },
        body: JSON.stringify({ to: list, subject: f.subject.trim(), message: f.message.trim(), purpose: "other" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || "The email was not sent");
      await sb.from("crm_notes").insert({ tenant_id: tenantId, related_type: related, related_id: relatedId, title: `Email sent: ${f.subject.trim()}`, body: `To: ${list.join(", ")}\n\n${f.message.trim()}` });
      toast.success("Email sent"); onSent(); onClose();
    } catch (e: any) { toast.error(e.message || "The email was not sent"); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="md" icon={Mail} title="Send an email" description="Sent from your company's sender for general email (Settings → Email & senders). A copy is kept in the record's notes."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={busy}><Send /> {busy ? "Sending…" : "Send"}</Button></>}>
      <div className="space-y-3">
        <Field label="To" required><input className="fi" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Cc"><input className="fi" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} placeholder="Optional, separate with commas" /></Field>
        <Field label="Subject" required><input className="fi" autoFocus value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Message" required><textarea className="fi min-h-[180px]" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
