import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatKES } from "@/lib/format";
import { useVariantsByProduct, type ProductVariant } from "@/hooks/useVariants";
import { formatItemLabel } from "@/lib/businessType";
import type { BusinessType } from "@/lib/businessType";

export interface PickedItem {
  product_id: string;
  variant_id: string | null;
  name: string;
  sku?: string | null;
  size?: string | null;
  color?: string | null;
  bottle_size?: string | null;
  unit_type: string;
  price: number;
  cost_price: number;
  vat_rate: number;
  stock: number;
  label: string;
}

/**
 * Shared product/variant picker used by POS, purchase orders, invoices,
 * quotes, delivery notes and packing lists so every module gets size/colour
 * (clothing) and bottle/tot/crate (liquor) selection with identical behaviour.
 */
export default function ItemPicker({
  products,
  businessType,
  onPick,
  mode = "sell",
  placeholder = "Search by name, SKU or barcode…",
  maxResults = 30,
}: {
  products: any[];
  businessType: BusinessType;
  onPick: (item: PickedItem) => void;
  /** "sell" uses selling prices/tots, "buy" uses cost prices/crates. */
  mode?: "sell" | "buy";
  placeholder?: string;
  maxResults?: number;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { map: variantMap } = useVariantsByProduct();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p: any) =>
            (p.name || "").toLowerCase().includes(q) ||
            (p.sku || "").toLowerCase().includes(q) ||
            (p.barcode || "").toLowerCase().includes(q) ||
            (p.brand || "").toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, maxResults);
  }, [products, search, maxResults]);

  const base = (p: any, unitType: string, variant?: ProductVariant): PickedItem => {
    const price =
      mode === "buy"
        ? Number(variant?.cost_price ?? p.cost_price ?? 0)
        : unitType === "tot"
          ? Number(p.tot_price ?? p.price ?? 0)
          : unitType === "crate"
            ? Number(p.price ?? 0) * Number(p.units_per_crate || 1)
            : Number(variant?.price ?? p.price ?? 0);
    return {
      product_id: p.id,
      variant_id: variant?.id ?? null,
      name: p.name,
      sku: variant?.sku ?? p.sku,
      size: variant?.size ?? null,
      color: variant?.color ?? null,
      bottle_size: p.bottle_size ?? null,
      unit_type: unitType,
      price,
      cost_price: Number(variant?.cost_price ?? p.cost_price ?? 0),
      vat_rate: Number(p.vat_rate ?? 0),
      stock: Number(variant?.stock ?? p.stock ?? 0),
      label: formatItemLabel({
        name: p.name,
        size: variant?.size,
        color: variant?.color,
        bottleSize: p.bottle_size,
        unitType,
      }),
    };
  };

  const handleProductClick = (p: any) => {
    const variants = variantMap[p.id] || [];
    const liquorOptions =
      businessType === "liquor" && (p.tot_price || p.units_per_crate);
    if (variants.length > 0 || liquorOptions) {
      setExpanded(expanded === p.id ? null : p.id);
      return;
    }
    onPick(base(p, "unit"));
    setSearch("");
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="fi pl-10 pr-4"
        />
      </div>

      <div className="border border-border rounded-lg max-h-80 overflow-y-auto divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center">
            No matching items.
          </p>
        ) : (
          filtered.map((p: any) => {
            const variants = variantMap[p.id] || [];
            const isOpen = expanded === p.id;
            return (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => handleProductClick(p)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted text-left"
                >
                  <span className="min-w-0 truncate">
                    {p.name}
                    {p.bottle_size ? ` (${p.bottle_size})` : ""}{" "}
                    <span className="text-muted-foreground text-xs">
                      {variants.length > 0
                        ? `${variants.length} options`
                        : p.product_type === "service" ? "Service" : `${Number(p.stock ?? 0)} in stock`}
                    </span>
                  </span>
                  <span className="font-medium shrink-0 ml-3">
                    {formatKES(
                      Number(mode === "buy" ? p.cost_price ?? 0 : p.price ?? 0),
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 flex flex-wrap gap-1.5 bg-muted/40">
                    {variants.map((v) => {
                      const out = mode === "sell" && Number(v.stock) <= 0;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          disabled={out}
                          onClick={() => {
                            onPick(base(p, "unit", v));
                            setExpanded(null);
                            setSearch("");
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs border ${
                            out
                              ? "opacity-40 cursor-not-allowed border-border"
                              : "border-border hover:bg-background"
                          }`}
                        >
                          {[v.color, v.size].filter(Boolean).join(" / ") || "Standard"}
                          <span className="text-muted-foreground ml-1">
                            ({Number(v.stock)})
                          </span>
                        </button>
                      );
                    })}

                    {businessType === "liquor" && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onPick(base(p, "bottle"));
                            setExpanded(null);
                            setSearch("");
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-background"
                        >
                          Bottle
                        </button>
                        {p.tot_price ? (
                          <button
                            type="button"
                            onClick={() => {
                              onPick(base(p, "tot"));
                              setExpanded(null);
                              setSearch("");
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-background"
                          >
                            Tot — {formatKES(Number(p.tot_price))}
                          </button>
                        ) : null}
                        {p.units_per_crate ? (
                          <button
                            type="button"
                            onClick={() => {
                              onPick(base(p, "crate"));
                              setExpanded(null);
                              setSearch("");
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-background"
                          >
                            Crate of {p.units_per_crate}
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
