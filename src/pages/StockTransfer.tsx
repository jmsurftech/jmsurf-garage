import { PageHeader, Toolbar, SearchBox, Panel, TableWrap, EmptyState, Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { PagedRows } from "@/components/Pager";
import { ArrowRightLeft, MapPin, Search, Send, Minus, Plus, Package } from "lucide-react";
import { useLocations, useProductStocks } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export default function StockTransfer() {
  const { data: locations = [] } = useLocations();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [transferItems, setTransferItems] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: fromProducts = [] } = useProductStocks(fromLocationId);

  useEffect(() => {
    if (!fromLocationId && locations[0]?.id) setFromLocationId(locations[0].id);
  }, [fromLocationId, locations]);

  const filtered = useMemo(() => {
    return fromProducts.filter((p: any) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [fromProducts, search]);

  const hasItems = Object.values(transferItems).some((q) => q > 0);

  const handleTransfer = async () => {
    if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      toast({ title: "Select different source and destination locations", variant: "destructive" });
      return;
    }

    const items = Object.entries(transferItems).filter(([, qty]) => qty > 0);
    if (items.length === 0) {
      toast({ title: "Select items to transfer", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc("transfer_product_stock", {
      p_from_location_id: fromLocationId,
      p_to_location_id: toLocationId,
      p_items: items.map(([productId, quantity]) => ({ product_id: productId, quantity })),
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    setTransferItems({});
    queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    toast({ title: `${data} item(s) transferred successfully` });
  };

  const selected = Object.entries(transferItems).filter(([, q]) => q > 0);
  const units = selected.reduce((sum, [, q]) => sum + q, 0);
  const setQty = (p: any, v: number) => setTransferItems((prev) => ({ ...prev, [p.id]: Math.max(0, Math.min(Math.floor(v) || 0, Number(p.stock) || 0)) }));
  const fromName = locations.find((l) => l.id === fromLocationId)?.name;
  const toName = locations.find((l) => l.id === toLocationId)?.name;

  if (locations.length < 2) {
    return (
      <div className="space-y-5">
        <PageHeader title="Stock transfer" icon={ArrowRightLeft} description="Move products between branches." />
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={MapPin} title="You need at least two branches" description="Add another branch in System → Business settings → Locations to move stock between them." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="Stock transfer" icon={ArrowRightLeft} description="Move products between branches. Stock leaves one and arrives at the other straight away." />

      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="From">
          <select value={fromLocationId} onChange={(e) => { setFromLocationId(e.target.value); setTransferItems({}); if (e.target.value === toLocationId) setToLocationId(""); }} className="fi h-12">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <span className="mx-auto mt-6 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary sm:mt-6"><ArrowRightLeft className="h-5 w-5" /></span>
        <Field label="To">
          <select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} className="fi h-12">
            <option value="" disabled>Choose a branch…</option>
            {locations.filter((l) => l.id !== fromLocationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>

      <Toolbar><SearchBox value={search} onChange={setSearch} placeholder="Product name or barcode…" /></Toolbar>

      <Panel flush>
        {filtered.length === 0 ? <EmptyState icon={Package} title="No products at this branch" /> : (
          <TableWrap>
            <table className="dt">
              <thead><tr><th>Product</th><th className="text-center">Available</th><th className="text-center">Move</th></tr></thead>
              <tbody>
                <PagedRows rows={filtered} colSpan={3}>{(pageRows) => pageRows.map((p: any) => {
                  const q = transferItems[p.id] || 0;
                  return (
                    <tr key={p.id} className={q > 0 ? "bg-primary/5" : undefined}>
                      <td className="font-medium">{p.name}{p.barcode && <span className="block font-mono text-[11px] text-muted-foreground">{p.barcode}</span>}</td>
                      <td className="text-center tabular-nums">{p.stock}</td>
                      <td>
                        <div className="mx-auto flex w-fit items-center gap-1">
                          <button type="button" className="icon-btn border border-border" onClick={() => setQty(p, q - 1)} disabled={q <= 0} aria-label="Less"><Minus className="h-3.5 w-3.5" /></button>
                          <input type="number" min={0} max={p.stock} value={q || ""} placeholder="0" onChange={(e) => setQty(p, parseInt(e.target.value))} className="fi h-8 w-16 px-1 text-center" aria-label={`Quantity of ${p.name}`} />
                          <button type="button" className="icon-btn border border-border" onClick={() => setQty(p, q + 1)} disabled={q >= Number(p.stock)} aria-label="More"><Plus className="h-3.5 w-3.5" /></button>
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

      {hasItems && (
        <div className="fixed inset-x-3 bottom-[104px] md:bottom-20 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-2xl md:bottom-4">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{selected.length} product{selected.length === 1 ? "" : "s"} · {units} unit{units === 1 ? "" : "s"}</p>
            <p className="truncate text-xs text-muted-foreground">{fromName} → {toName || "choose a branch"}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTransferItems({})}>Clear</Button>
          <Button onClick={handleTransfer} disabled={submitting || !toLocationId}><Send /> {submitting ? "Moving…" : "Transfer"}</Button>
        </div>
      )}
    </div>
  );
}
