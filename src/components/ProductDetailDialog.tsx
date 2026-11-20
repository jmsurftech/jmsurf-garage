import "@/styles/clean.css";
import { X, Edit, Package } from "lucide-react";
import { formatKES } from "@/lib/format";
import { useVariantsByProduct } from "@/hooks/useVariants";

import { PagedRows } from "@/components/Pager";
/**
 * Full breakdown of a product shown in place (no separate tab):
 * every size / colour with its price and stock, plus an Edit action.
 */
export default function ProductDetailDialog({
  product,
  onClose,
  onEdit,
}: {
  product: any;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { map, isLoading } = useVariantsByProduct();
  const variants = map[product.id] || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 side-pop flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-muted overflow-hidden flex items-center justify-center border border-border shrink-0">
              {product.image_url
                ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                : <Package className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-lg truncate">{product.name}</h2>
              <p className="text-xs text-muted-foreground">
                {product.category}
                {variants.length ? ` · ${variants.length} options` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
            >
              <Edit className="w-3.5 h-3.5" /> Edit
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-5">Loading…</p>
          ) : variants.length === 0 ? (
            <div className="p-5 grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Selling price</p><p className="font-medium">{formatKES(Number(product.price) || 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Buying price</p><p className="font-medium">{formatKES(Number(product.cost_price) || 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">In stock</p><p className="font-medium">{product.stock}</p></div>
              <div><p className="text-xs text-muted-foreground">Reorder level</p><p className="font-medium">{product.reorder_level}</p></div>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="dt">
              <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-5 py-2 font-medium">Size</th>
                  <th className="text-left px-4 py-2 font-medium">Colour</th>
                  <th className="text-right px-4 py-2 font-medium">Price</th>
                  <th className="text-right px-5 py-2 font-medium">In stock</th>
                </tr>
              </thead>
              <tbody>
                <PagedRows rows={variants} colSpan={4}>{(pageRows) => pageRows.map((v: any) => {
                  const low = Number(v.stock) <= Number(v.reorder_level ?? 0);
                  return (
                    <tr key={v.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 font-medium">{v.size || "—"}</td>
                      <td className="px-4 py-2">{v.color || "—"}</td>
                      <td className="px-4 py-2 text-right">{formatKES(Number(v.price) || 0)}</td>
                      <td className={`px-5 py-2 text-right font-medium ${low ? "text-destructive" : ""}`}>{v.stock}</td>
                    </tr>
                  );
                })}</PagedRows>
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  );
}
