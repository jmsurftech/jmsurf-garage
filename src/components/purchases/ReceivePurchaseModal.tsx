import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import { Modal, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAY_METHODS } from "@/pages/Bills";
import { OrbSpinner } from "@/components/orbs";

const sb: any = supabase;

/** Receive some or all of a purchase order: tick what arrived and how many. */
export function ReceivePurchaseModal({ po, productMap, onClose }: { po: any; productMap: Record<string, any>; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [lines, setLines] = useState<any[]>([]);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [take, setTake] = useState<Record<string, { on: boolean; qty: string }>>({});
  const [updateCost, setUpdateCost] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sb.from("purchase_items").select("*").eq("purchase_id", po.id).order("created_at").then(async ({ data }: any) => {
      const items = data || [];
      setLines(items);
      const vIds = items.map((i: any) => i.variant_id).filter(Boolean);
      if (vIds.length) {
        const { data: vs } = await sb.from("product_variants").select("id,size,color").in("id", vIds);
        setVariants(Object.fromEntries((vs || []).map((v: any) => [v.id, [v.size, v.color].filter(Boolean).join(" · ")])));
      }
      setTake(Object.fromEntries(items.map((i: any) => {
        const left = Number(i.quantity) - Number(i.received_quantity || 0);
        return [i.id, { on: left > 0, qty: left > 0 ? String(left) : "0" }];
      })));
    });
  }, [po.id]);

  const plan = useMemo(() => lines.map((i) => {
    const left = Number(i.quantity) - Number(i.received_quantity || 0);
    const t = take[i.id] || { on: false, qty: "0" };
    const qty = t.on ? Number(t.qty) : 0;
    const bad = t.on && (!Number.isFinite(qty) || qty < 0 || qty > left);
    return { ...i, left, qty: bad ? 0 : qty, bad, on: t.on };
  }), [lines, take]);

  const chosen = plan.filter((p) => p.on && p.qty > 0);
  const value = chosen.reduce((a, p) => a + p.qty * Number(p.unit_cost), 0);
  const allIn = plan.every((p) => p.left === 0 || (p.on && p.qty === p.left));

  const save = async () => {
    if (plan.some((p) => p.bad)) { toast({ title: "A quantity is more than what is still to come", variant: "destructive" }); return; }
    if (!chosen.length) { toast({ title: "Tick at least one item that arrived", variant: "destructive" }); return; }
    setSaving(true);
    const { data, error } = await sb.rpc("receive_purchase", {
      p_purchase: po.id, p_lines: chosen.map((p) => ({ item_id: p.id, quantity: p.qty })), p_update_cost: updateCost,
    });
    setSaving(false);
    if (error) { toast({ title: "Not received", description: error.message, variant: "destructive" }); return; }
    ["purchases", "purchase_items_summary", "product-stocks", "products", "product-variants", "bills", "stock-adjustments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({
      title: data?.status === "received" ? "Order fully received" : "Part of the order received",
      description: data?.status === "received" ? "Stock added and the supplier bill updated." : `Stock added. ${data?.remaining} unit(s) still to come.`,
    });
    onClose();
  };

  return (
    <Modal open onClose={() => !saving && onClose()} size="2xl" icon={PackageCheck} title={`Receive PO #${po.id.slice(0, 8).toUpperCase()}`}
      description={`${po.supplier_name || "Supplier"} · untick anything that was not delivered, or change the quantity that arrived.`}
      footer={<>
        <span className="mr-auto text-sm text-muted-foreground">Receiving {formatKES(value)}{allIn ? " · completes the order" : ""}</span>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving || !chosen.length}>{saving && <OrbSpinner />} Receive {chosen.length} line{chosen.length === 1 ? "" : "s"}</Button>
      </>}>
      <div className="space-y-3">
        <div className="max-h-[55vh] overflow-auto rounded-xl border border-border">
          <table className="dt">
            <thead><tr><th className="w-10" /><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num w-36">Arrived now</th><th className="num">Value</th></tr></thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.id} className={cn(p.left === 0 && "opacity-50", p.bad && "bg-destructive/5")}>
                  <td className="!px-3">
                    <input type="checkbox" className="h-4 w-4 accent-primary" disabled={p.left === 0} checked={p.on && p.left > 0}
                      onChange={(e) => setTake((t) => ({ ...t, [p.id]: { ...(t[p.id] || { qty: String(p.left) }), on: e.target.checked } }))} />
                  </td>
                  <td>
                    <p className="font-medium">{productMap[p.product_id]?.name || "Item"}</p>
                    {p.variant_id && variants[p.variant_id] && <p className="text-xs text-muted-foreground">{variants[p.variant_id]}</p>}
                  </td>
                  <td className="num">{Number(p.quantity)}</td>
                  <td className="num text-muted-foreground">{Number(p.received_quantity || 0)}</td>
                  <td className="num !py-1">
                    {p.left === 0 ? <span className="text-xs text-success">All in</span> : (
                      <input className={cn("fi h-9 text-right tabular-nums", p.bad && "border-destructive")} inputMode="decimal" disabled={!p.on}
                        value={take[p.id]?.qty ?? ""} onChange={(e) => setTake((t) => ({ ...t, [p.id]: { on: true, qty: e.target.value } }))} />
                    )}
                  </td>
                  <td className="num">{p.qty ? formatKES(p.qty * Number(p.unit_cost)) : "—"}</td>
                </tr>
              ))}
              {!plan.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
          Update each product's buying price to this order's cost{po.currency ? ` (converted to your currency at ${po.exchange_rate})` : ""}
        </label>
      </div>
    </Modal>
  );
}

/** Mark a purchase order as paid: pays what is still owed on its supplier bill. */
export function PayPurchaseModal({ po, onClose }: { po: any; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [bill, setBill] = useState<any>(null);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sb.from("bills").select("amount, amount_paid").eq("purchase_id", po.id).maybeSingle().then(({ data }: any) => setBill(data));
  }, [po.id]);
  const due = bill ? Math.max(0, Number(bill.amount) - Number(bill.amount_paid)) : Math.max(0, Number(po.total) - Number(po.amount_paid || 0));

  const save = async () => {
    setSaving(true);
    const { error } = await sb.rpc("pay_purchase", { p_purchase: po.id, p_method: method, p_reference: reference || null, p_paid_on: paidOn });
    setSaving(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    ["purchases", "bills", "supplier-payments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast({ title: "Purchase order paid", description: `${formatKES(due)} to ${po.supplier_name || "the supplier"}` });
    onClose();
  };

  return (
    <Modal open onClose={() => !saving && onClose()} icon={Wallet} title="Mark as paid"
      description={`${po.supplier_name || "Supplier"} · ${formatKES(due)} to pay${po.status === "pending" ? " (full order; nothing received yet)" : ""}. For a part payment use Bills.`}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving || due <= 0}>{saving && <OrbSpinner />} Pay {formatKES(due)}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid by">
          <select className="fi" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        </Field>
        <Field label="Paid on"><input className="fi" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
        <Field label="Reference" hint="M-Pesa code, cheque or bank ref" className="sm:col-span-2"><input className="fi" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
