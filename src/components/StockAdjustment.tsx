import "@/styles/clean.css";
import { useState } from "react";
import { X, Plus, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { useProductVariants } from "@/hooks/useVariants";

type DbProduct = Database["public"]["Tables"]["products"]["Row"];

interface Props {
  product: DbProduct;
  locationId: string;
  onClose: () => void;
}

export default function StockAdjustment({ product, locationId, onClose }: Props) {
  const [adjustment, setAdjustment] = useState(0);
  const { data: variants = [] } = useProductVariants(product.id);
  const hasVariants = variants.length > 0;
  const sizes = Array.from(new Set(variants.map((v) => v.size).filter(Boolean))) as string[];
  const colors = Array.from(new Set(variants.map((v) => v.color).filter(Boolean))) as string[];
  const [pickSize, setPickSize] = useState("");
  const [pickColor, setPickColor] = useState("");
  const [reason, setReason] = useState("restock");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Resolve the exact size/colour row the user picked
  const matched = hasVariants
    ? variants.find((v) =>
        (sizes.length === 0 || (v.size || "") === pickSize) &&
        (colors.length === 0 || (v.color || "") === pickColor))
    : undefined;
  const currentStock = hasVariants ? Number(matched?.stock ?? 0) : Number(product.stock);
  const newStock = currentStock + adjustment;

  const handleSubmit = async () => {
    if (adjustment === 0 || !locationId) return;
    if (hasVariants && !matched) {
      toast({ title: "Choose the item first", description: "Pick which size and colour you are adjusting.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("adjust_product_stock", {
      p_product_id: product.id,
      p_location_id: locationId,
      p_delta: adjustment,
      p_reason: reason,
      p_variant_id: matched?.id || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });
    queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
    toast({ title: "Stock updated", description: `${product.name}: ${data?.before} → ${data?.after} (${reason})` });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 side-pop flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-3xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-bold">Adjust Stock</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm font-medium mb-1">{product.name}</p>
        {hasVariants ? (
          <div className="space-y-2 mb-4">
            {sizes.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Which size?</label>
                <select value={pickSize} onChange={(e) => setPickSize(e.target.value)} className="fi">
                  <option value="">Select size</option>
                  {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            {colors.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Which colour?</label>
                <select value={pickColor} onChange={(e) => setPickColor(e.target.value)} className="fi">
                  <option value="">Select colour</option>
                  {colors.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {matched ? `Current stock: ${matched.stock}` : "Pick a size and colour to see its stock."}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-4">Current stock: {product.stock} {product.unit}s</p>
        )}

        <div className="flex items-center justify-center gap-4 mb-4">
          <button onClick={() => setAdjustment((a) => a - 1)} className="w-10 h-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20">
            <Minus className="w-5 h-5" />
          </button>
          <div className="text-center">
            <input type="number" value={adjustment} onChange={(e) => setAdjustment(parseInt(e.target.value) || 0)} className="w-20 text-center text-2xl font-display font-bold bg-transparent border-b-2 border-input focus:outline-none focus:border-primary" />
            <p className="text-xs text-muted-foreground mt-1">New: {newStock}</p>
          </div>
          <button onClick={() => setAdjustment((a) => a + 1)} className="w-10 h-10 rounded-lg bg-success/10 text-success flex items-center justify-center hover:bg-success/20">
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <select value={reason} onChange={(e) => setReason(e.target.value)} className="fi mb-4">
          <option value="restock">Restock</option>
          <option value="damage">Damaged / Expired</option>
          <option value="return">Customer Return</option>
          <option value="count">Stock Count Correction</option>
          <option value="other">Other</option>
        </select>

        <button onClick={handleSubmit} disabled={adjustment === 0 || newStock < 0 || saving || (hasVariants && !matched)} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40">
          {saving ? "Updating..." : "Apply Adjustment"}
        </button>
      </div>
    </div>
  );
}
