import { Link } from "react-router-dom";
import { ShoppingCart, Shapes as BrandIcon, Check } from "lucide-react";
import { useState } from "react";
import { useCart, kes, useShopInfo, canBuy, type CatalogueItem } from "./shopData";
import { cn } from "@/lib/utils";

/** Alibaba-style product tile: picture, name, price, volume price, minimum order, stock. */
export default function ProductCard({ item }: { item: CatalogueItem }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const { data: shop } = useShopInfo();
  const out = !canBuy(item, shop);
  const low = item.kind === "product" && (item.stock ?? 0) > 0 && (item.stock ?? 0) <= 5;
  const off = item.compare_at_price && item.compare_at_price > item.price ? Math.round((1 - item.price / item.compare_at_price) * 100) : 0;
  const bestTier = item.tier_prices.at(-1);
  const minQty = Math.max(1, item.min_order_qty || 1);
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg">
      <Link to={`/shop/p/${item.id}`} className="relative block aspect-square overflow-hidden bg-muted/50">
        {item.images[0] ? <img src={item.images[0]} alt={item.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          : <span className="flex h-full w-full items-center justify-center text-muted-foreground/40"><BrandIcon className="h-12 w-12" /></span>}
        {off > 0 ? <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold uppercase text-white">-{off}%</span>
          : item.featured && <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Featured</span>}
        {out && <span className="absolute inset-x-0 bottom-0 bg-foreground/70 py-1 text-center text-xs font-semibold text-background">Out of stock</span>}
      </Link>
      <div className="flex flex-1 flex-col p-3">
        <Link to={`/shop/p/${item.id}`} className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 hover:text-primary">{item.name}</Link>
        <p className="mt-1.5 font-display text-lg font-bold text-primary">{kes(item.price)}{off > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground line-through">{kes(item.compare_at_price!)}</span>}{item.unit && item.unit !== "piece" && <span className="text-xs font-normal text-muted-foreground"> / {item.unit}</span>}</p>
        {bestTier && <p className="text-xs text-muted-foreground">{kes(bestTier.price)} each from {bestTier.min_qty} {item.unit || "pcs"}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">Min. order: {minQty} {item.unit || (item.kind === "service" ? "booking" : "pc")}{minQty > 1 ? "s" : ""}</p>
        {low && <p className="mt-0.5 text-xs font-semibold text-warning">Only {item.stock} left</p>}
        <div className="mt-auto pt-3">
          <button disabled={out} onClick={() => { add(item.id, minQty); setAdded(true); setTimeout(() => setAdded(false), 1500); }}
            className={cn("flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              added ? "bg-success text-white" : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground")}>
            {added ? <><Check className="h-4 w-4" /> Added</> : <><ShoppingCart className="h-4 w-4" /> Add to cart</>}
          </button>
        </div>
      </div>
    </div>
  );
}
