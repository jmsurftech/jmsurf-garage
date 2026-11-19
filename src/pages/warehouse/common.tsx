import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const sb = supabase as any;
export const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const n = (v: unknown) => Number(v ?? 0) || 0;

export interface Loc { id: string; name: string; location_type: string; parent_id: string | null; is_main: boolean; is_active: boolean; manager_id: string | null; phone?: string | null; city?: string | null; code?: string | null }
export function useLocs() {
  return useQuery({ queryKey: ["wh-locations"], queryFn: async () => ((await sb.from("locations").select("id,name,location_type,parent_id,is_main,is_active,manager_id,phone,city,code").order("is_main", { ascending: false }).order("name")).data || []) as Loc[] });
}
export interface Prod { id: string; name: string; sku: string | null; unit: string | null; cost_price: number | null; price: number | null; product_type: string | null; is_composite: boolean }
export function useProds() {
  return useQuery({ queryKey: ["wh-products"], staleTime: 60_000, queryFn: async () => ((await sb.from("products").select("id,name,sku,unit,cost_price,price,product_type,is_composite").eq("is_active", true).order("name").limit(5000)).data || []) as Prod[] });
}
export function useBins(locationId?: string | null) {
  return useQuery({ queryKey: ["wh-bins", locationId], enabled: !!locationId, queryFn: async () => ((await sb.from("wh_bins").select("*").eq("location_id", locationId).eq("is_active", true).order("code")).data || []) as any[] });
}

/** Searchable item select. */
export function ProductSelect({ value, onChange, products, placeholder = "Choose an item…", stockOnly }: { value: string; onChange: (p: Prod | null) => void; products: Prod[]; placeholder?: string; stockOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => products.filter((p) => (!stockOnly || (p.product_type !== "service" && !p.is_composite)) && (!q.trim() || `${p.name} ${p.sku || ""}`.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 60), [products, q, stockOnly]);
  const cur = products.find((p) => p.id === value);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className={cn("fi flex items-center justify-between text-left", !cur && "text-muted-foreground")}>
        <span className="truncate">{cur ? `${cur.name}${cur.sku ? ` · ${cur.sku}` : ""}` : placeholder}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] rounded-xl border border-border bg-popover p-2 shadow-xl">
          <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input autoFocus className="fi h-9 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU" /></div>
          <ul className="max-h-60 overflow-y-auto">
            {list.map((p) => <li key={p.id}><button type="button" onClick={() => { onChange(p); setOpen(false); setQ(""); }} className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"><span className="truncate">{p.name}</span><span className="shrink-0 text-xs text-muted-foreground">{p.sku}</span></button></li>)}
            {!list.length && <li className="px-2 py-3 text-center text-sm text-muted-foreground">Nothing found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface Line { product_id: string; name: string; unit?: string | null; quantity: number; batch_number?: string; expiry_date?: string; bin_id?: string; unit_cost?: number; note?: string }
export const blankLine = (): Line => ({ product_id: "", name: "", quantity: 1 });

/** Item lines with quantity and optional batch, expiry and bin. No prices. */
export function LinesEditor({ lines, onChange, products, bins, showLots = true, showCost }: { lines: Line[]; onChange: (l: Line[]) => void; products: Prod[]; bins?: any[]; showLots?: boolean; showCost?: boolean }) {
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid" style={{ gridTemplateColumns: `2fr 90px ${showLots ? "1fr 140px" : ""} ${bins?.length ? "120px" : ""} ${showCost ? "110px" : ""} 36px` }}>
        <span>Item</span><span className="text-right">Quantity</span>{showLots && <><span>Batch</span><span>Expiry</span></>}{!!bins?.length && <span>Bin</span>}{showCost && <span className="text-right">Unit cost</span>}<span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-border p-2 md:border-0 md:p-0" style={{ gridTemplateColumns: typeof window !== "undefined" && window.innerWidth >= 768 ? `2fr 90px ${showLots ? "1fr 140px" : ""} ${bins?.length ? "120px" : ""} ${showCost ? "110px" : ""} 36px` : "1fr" }}>
          <ProductSelect value={l.product_id} products={products} stockOnly onChange={(p) => set(i, { product_id: p?.id || "", name: p?.name || "", unit: p?.unit, unit_cost: showCost ? n(p?.cost_price) : l.unit_cost })} />
          <input className="fi text-right" type="number" min={0} step="any" value={l.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} aria-label="Quantity" />
          {showLots && <>
            <input className="fi" value={l.batch_number || ""} onChange={(e) => set(i, { batch_number: e.target.value })} placeholder="Batch / lot" />
            <input className="fi" type="date" value={l.expiry_date || ""} onChange={(e) => set(i, { expiry_date: e.target.value })} aria-label="Expiry date" />
          </>}
          {!!bins?.length && <select className="fi" value={l.bin_id || ""} onChange={(e) => set(i, { bin_id: e.target.value })}><option value="">No bin</option>{bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>}
          {showCost && <input className="fi text-right" type="number" min={0} step="any" value={l.unit_cost ?? 0} onChange={(e) => set(i, { unit_cost: Number(e.target.value) })} aria-label="Unit cost" />}
          <button type="button" onClick={() => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blankLine()])} className="icon-btn-danger justify-self-end" aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, blankLine()])} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><Plus className="h-4 w-4" /> Add item</button>
    </div>
  );
}

export const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "muted" | "primary"> = {
  draft: "muted", in_transit: "info", received: "success", cancelled: "danger", packed: "primary", shipped: "info", delivered: "success",
  issued: "info", returned: "muted", converted: "success", sent: "info", quoted: "warning", awarded: "success", closed: "muted", applied: "success",
  pending: "warning", assigned: "info", dispatched: "info", delivering: "info",
};
