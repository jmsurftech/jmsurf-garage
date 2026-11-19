import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Barcode, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/kit";
import { fmtDate } from "@/lib/doc-pdf";
import { cn } from "@/lib/utils";

const sb: any = supabase;

export type LineLot = { batch: string | null; expiry: string | null; qty: number };

/** Batches in stock for an item, earliest expiry first (all branches unless one is given). */
function useItemLots(productId: string | null | undefined, locationId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["item-lots", productId, locationId || null],
    enabled: !!productId && enabled,
    queryFn: async () => ((await sb.rpc("item_lots", { p_product: productId, p_location: locationId || null })).data || []) as
      { batch_number: string | null; expiry_date: string | null; available: number; location_id: string; location_name: string | null }[],
  });
}

function useInStockSerials(productId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["product-serials", "in-stock", productId],
    enabled: !!productId && enabled,
    queryFn: async () => ((await sb.from("product_serials").select("serial_number, batch_number, location_id, status").eq("product_id", productId).in("status", ["in_stock", "returned"]).order("serial_number").limit(2000)).data || []) as
      { serial_number: string; batch_number: string | null }[],
  });
}

const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/**
 * Under an invoice line: which batches and serial numbers it sells.
 * No batches chosen = the earliest expiry is taken first when the invoice is issued.
 */
export function TraceLink({ product, quantity, lots, serials, locationId, onChange }: {
  product: { id: string; name: string; track_batches?: boolean; track_serials?: boolean };
  quantity: number;
  lots?: LineLot[] | null;
  serials?: string[] | null;
  locationId?: string | null;
  onChange: (patch: { lots: LineLot[] | null; serials: string[] | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: lotRows = [] } = useItemLots(product.id, locationId, !!product.track_batches || open);
  const hasLots = lotRows.some((l) => l.batch_number || l.expiry_date);
  if (!product.track_batches && !product.track_serials && !hasLots) return null;
  const chosen = (lots || []).filter((l) => l.qty > 0);
  const nSerials = (serials || []).length;
  const serialsShort = !!product.track_serials && nSerials !== quantity;
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-2 text-[11px]">
        {(product.track_batches || hasLots) && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            <Layers className="h-3 w-3" />
            {chosen.length ? chosen.map((l) => `${l.batch || "No batch"} × ${qtyFmt(l.qty)}`).join(", ") : "Select batches (or earliest expiry first)"}
          </button>
        )}
        {product.track_serials && (
          <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex items-center gap-1 font-semibold hover:underline", serialsShort ? "text-destructive" : "text-primary")}>
            <Barcode className="h-3 w-3" /> Serial numbers: {nSerials} of {qtyFmt(quantity)}
          </button>
        )}
      </div>
      {open && <TraceModal product={product} quantity={quantity} lots={lots} serials={serials} lotRows={lotRows} onClose={() => setOpen(false)} onSave={(p) => { onChange(p); setOpen(false); }} />}
    </>
  );
}

function TraceModal({ product, quantity, lots, serials, lotRows, onClose, onSave }: {
  product: { id: string; name: string; track_batches?: boolean; track_serials?: boolean };
  quantity: number;
  lots?: LineLot[] | null;
  serials?: string[] | null;
  lotRows: { batch_number: string | null; expiry_date: string | null; available: number; location_name: string | null }[];
  onClose: () => void;
  onSave: (p: { lots: LineLot[] | null; serials: string[] | null }) => void;
}) {
  const key = (b: string | null, e: string | null) => `${b || ""}|${e || ""}`;
  // The same batch can sit in several branches: one row per batch + expiry.
  const rows = useMemo(() => {
    const m = new Map<string, { batch: string | null; expiry: string | null; available: number; where: string[] }>();
    for (const r of lotRows) {
      const k = key(r.batch_number, r.expiry_date);
      const x = m.get(k) || { batch: r.batch_number, expiry: r.expiry_date, available: 0, where: [] };
      x.available += Number(r.available) || 0;
      if (r.location_name && !x.where.includes(r.location_name)) x.where.push(r.location_name);
      m.set(k, x);
    }
    return [...m.values()];
  }, [lotRows]);
  const [take, setTake] = useState<Record<string, string>>(() => Object.fromEntries((lots || []).map((l) => [key(l.batch, l.expiry), String(l.qty)])));
  const [picked, setPicked] = useState<string[]>(serials || []);
  const [scan, setScan] = useState("");
  const { data: inStock = [] } = useInStockSerials(product.id, !!product.track_serials);
  const total = Object.values(take).reduce((a, v) => a + (Number(v) || 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  const fefo = () => {
    let left = quantity;
    const next: Record<string, string> = {};
    for (const r of [...rows].sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"))) {
      if (left <= 0) break;
      const t = Math.min(left, r.available);
      if (t > 0) { next[key(r.batch, r.expiry)] = String(t); left -= t; }
    }
    setTake(next);
  };
  const addScan = () => {
    const vals = scan.split(/[\n,;\t]+/).map((x) => x.trim()).filter(Boolean);
    if (!vals.length) return;
    setPicked((p) => [...new Set([...p, ...vals])]);
    setScan("");
  };
  const unknown = picked.filter((s) => !inStock.some((x) => x.serial_number === s));
  const save = () => {
    const out: LineLot[] = rows.filter((r) => Number(take[key(r.batch, r.expiry)]) > 0).map((r) => ({ batch: r.batch, expiry: r.expiry, qty: Number(take[key(r.batch, r.expiry)]) }));
    onSave({ lots: out.length ? out : null, serials: product.track_serials ? (picked.length ? picked : null) : null });
  };

  return (
    <Modal open onClose={onClose} title={product.name} description={`Quantity on this line: ${qtyFmt(quantity)}`} icon={Layers} size="lg"
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        <Button onClick={save} disabled={total > quantity + 0.0001}>Done</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <span className="ml-auto text-xs text-muted-foreground">{total > quantity + 0.0001 ? <b className="text-destructive">Batches are more than the line quantity</b> : total < quantity ? `${qtyFmt(quantity - total)} not assigned: taken earliest expiry first` : "All assigned"}</span>
      </div>}>
      <div className="space-y-5">
        {(product.track_batches || rows.length > 0) && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Batches</h3>
              <Button size="sm" variant="ghost" onClick={fefo}><Wand2 /> Earliest expiry first</Button>
            </div>
            {rows.length === 0 ? <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">No batches in stock for this item.</p> : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="dt dt-keep">
                  <thead><tr><th>Batch</th><th>Expiry</th><th className="num">In stock</th><th className="num">Take</th></tr></thead>
                  <tbody>{rows.map((r) => {
                    const k = key(r.batch, r.expiry);
                    const expired = !!r.expiry && r.expiry < today;
                    return (
                      <tr key={k} className={cn(expired && "bg-destructive/5")}>
                        <td><span className="font-medium">{r.batch || "No batch"}</span>{r.where.length > 0 && <span className="block text-[11px] text-muted-foreground">{r.where.join(", ")}</span>}</td>
                        <td className={cn(expired && "font-semibold text-destructive")}>{r.expiry ? fmtDate(r.expiry) : "—"}{expired ? " · expired" : ""}</td>
                        <td className="num">{qtyFmt(r.available)}</td>
                        <td className="num"><input className="fi h-9 w-28 text-right" type="number" min={0} max={r.available} step="any" value={take[k] || ""} onChange={(e) => setTake({ ...take, [k]: e.target.value })} aria-label={`Quantity from batch ${r.batch || ""}`} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {product.track_serials && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Serial numbers <span className={cn("ml-1 text-xs", picked.length !== quantity ? "text-destructive" : "text-muted-foreground")}>{picked.length} of {qtyFmt(quantity)}</span></h3>
            <div className="flex gap-2">
              <input className="fi" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addScan(); } }} placeholder="Scan or type a serial number, then Enter" aria-label="Scan serial number" />
              <Button variant="outline" onClick={addScan}>Add</Button>
            </div>
            {unknown.length > 0 && <p className="text-xs text-destructive">Not in stock: {unknown.join(", ")}</p>}
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border p-2">
              {inStock.length === 0 ? <p className="px-1 py-2 text-sm text-muted-foreground">No serial numbers in stock for this item.</p> : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {inStock.map((x) => (
                    <label key={x.serial_number} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/60">
                      <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={picked.includes(x.serial_number)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, x.serial_number] : p.filter((s) => s !== x.serial_number)))} />
                      <span className="font-mono">{x.serial_number}</span>
                      {x.batch_number && <span className="text-[11px] text-muted-foreground">Batch {x.batch_number}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
