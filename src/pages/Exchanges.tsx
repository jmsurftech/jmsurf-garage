import { PageHeader, Panel, TableWrap, EmptyState, Field, Modal, PageLoader, Toolbar, SearchBox } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useProducts, useLocations } from "@/hooks/useData";
import { useVariantsByProduct } from "@/hooks/useVariants";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";

const sb: any = supabase;

/** Clothe Line: swap a garment for a different size or colour. */
export default function Exchanges() {
  const tenantId = useTenantId();
  const { user } = useAuth() as any;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const { data: locations = [] } = useLocations();
  const { map } = useVariantsByProduct();

  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [customer, setCustomer] = useState("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState("1");

  const variants = map[productId] || [];
  const fromV = variants.find((v) => v.id === fromId);
  const toV = variants.find((v) => v.id === toId);
  const priceDiff = useMemo(
    () => (Number(toV?.price ?? 0) - Number(fromV?.price ?? 0)) * (parseFloat(qty) || 1),
    [fromV, toV, qty],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["variant-exchanges", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("variant_exchanges")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const quantity = Math.max(1, parseFloat(qty) || 1);
  const stockProblem = toV && Number(toV.stock) < quantity ? `Only ${Number(toV.stock)} of that option in stock.` : null;
  const sameOption = fromId && toId && fromId === toId;
  const canSave = !!productId && !!fromId && !!toId && !sameOption && !stockProblem;
  const [search, setSearch] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const quantity = parseFloat(qty) || 1;
      const { error } = await sb.from("variant_exchanges").insert({
        tenant_id: tenantId,
        location_id: locations[0]?.id ?? null,
        product_id: productId,
        from_variant_id: fromId,
        to_variant_id: toId,
        customer_name: customer || null,
        quantity,
        price_difference: priceDiff,
        reason: reason || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      // Move the stock: returned item back in, new item out.
      if (fromV) await sb.from("product_variants").update({ stock: Number(fromV.stock) + quantity }).eq("id", fromV.id);
      if (toV) await sb.from("product_variants").update({ stock: Math.max(0, Number(toV.stock) - quantity) }).eq("id", toV.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variant-exchanges"] });
      qc.invalidateQueries({ queryKey: ["product-variants"] });
      setOpen(false);
      setProductId(""); setFromId(""); setToId(""); setCustomer(""); setReason(""); setQty("1");
      toast({ title: "Exchange recorded" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const nameOf = (pid: string) => products.find((p: any) => p.id === pid)?.name || "Item";
  const labelOf = (pid: string, vid: string) => {
    const v = (map[pid] || []).find((x) => x.id === vid);
    return v ? [v.size, v.color].filter(Boolean).join(" / ") || "—" : "—";
  };

  const shown = rows.filter((r: any) => !search.trim() || `${r.customer_name || ""} ${nameOf(r.product_id)} ${r.reason || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const close = () => setOpen(false);

  if (isLoading) return <PageLoader label="Loading exchanges…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Exchanges" icon={ArrowLeftRight} description="Swap a size or colour and keep stock correct."
        actions={<Button onClick={() => setOpen(true)}><Plus /> New exchange</Button>} />

      {rows.length > 0 && <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Customer, item or reason…" /></Toolbar>}

      <Panel flush>
        {shown.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title={rows.length ? "No exchanges match" : "No exchanges yet"}
            description={rows.length ? undefined : "When a customer swaps a size or colour, record it here so stock stays right."}
            action={!rows.length ? <Button onClick={() => setOpen(true)}><Plus /> New exchange</Button> : undefined} />
        ) : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Date</th><th>Customer</th><th>Item</th><th>Swapped</th><th className="hidden md:table-cell">Reason</th><th className="num">Difference</th></tr></thead>
              <tbody>
                <PagedRows rows={shown} colSpan={6}>{(pageRows) => pageRows.map((r: any) => {
                  const d = Number(r.price_difference || 0);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td>{r.customer_name || "Walk-in"}</td>
                      <td className="font-medium">{nameOf(r.product_id)}{Number(r.quantity) > 1 && <span className="text-muted-foreground"> × {r.quantity}</span>}</td>
                      <td className="whitespace-nowrap">{labelOf(r.product_id, r.from_variant_id)} <span className="text-muted-foreground">→</span> {labelOf(r.product_id, r.to_variant_id)}</td>
                      <td className="hidden max-w-[200px] truncate text-muted-foreground md:table-cell">{r.reason || "—"}</td>
                      <td className={`num font-semibold ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : ""}`}>{d > 0 ? "+" : ""}{formatKES(d)}</td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Modal open={open} onClose={close} icon={ArrowLeftRight} title="New exchange" description="The returned item goes back into stock; the new one comes out."
        footer={<>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>{save.isPending ? "Saving…" : "Save exchange"}</Button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item" required className="sm:col-span-2">
            <select value={productId} onChange={(e) => { setProductId(e.target.value); setFromId(""); setToId(""); }} className="fi">
              <option value="">Choose the item…</option>
              {products.filter((p: any) => (map[p.id] || []).length > 0).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Customer returns" required>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="fi" disabled={!productId}>
              <option value="">Size / colour…</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{[v.size, v.color].filter(Boolean).join(" / ") || "Default"}</option>)}
            </select>
          </Field>
          <Field label="Customer takes" required error={sameOption ? "Pick a different option." : stockProblem}>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className="fi" disabled={!productId}>
              <option value="">Size / colour…</option>
              {variants.map((v) => <option key={v.id} value={v.id} disabled={Number(v.stock) <= 0}>{[v.size, v.color].filter(Boolean).join(" / ") || "Default"} — {Number(v.stock)} left</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="1" className="fi" /></Field>
          <Field label="Customer" hint="Optional"><input value={customer} onChange={(e) => setCustomer(e.target.value)} className="fi" /></Field>
          <Field label="Reason" hint="e.g. wrong size" className="sm:col-span-2"><input value={reason} onChange={(e) => setReason(e.target.value)} className="fi" /></Field>
        </div>
        {fromV && toV && !sameOption && (
          <div className={`mt-4 rounded-xl p-3 text-sm font-medium ${priceDiff > 0 ? "bg-success/10 text-success" : priceDiff < 0 ? "bg-warning/15" : "bg-muted"}`}>
            {priceDiff > 0 ? `Customer pays ${formatKES(priceDiff)} more.` : priceDiff < 0 ? `Give the customer ${formatKES(-priceDiff)} back.` : "Same price — nothing to pay."}
          </div>
        )}
      </Modal>
    </div>
  );
}
