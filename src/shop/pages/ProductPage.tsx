import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Minus, Plus, ShoppingCart, Zap, Truck, Smartphone, Shapes as BrandIcon, Check, ShieldCheck, Bell } from "lucide-react";
import ShopLayout from "../ShopLayout";
import ProductCard from "../ProductCard";
import { useCatalogue, useCart, useShopInfo, priceFor, kes } from "../shopData";
import { OrbLoader } from "@/components/orbs";
import PageHead from "@/components/PageHead";
import { cn } from "@/lib/utils";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useCatalogue();
  const { data: shop } = useShopInfo();
  const { add } = useCart();
  const item = items.find((i) => i.id === id);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<"details" | "specs" | "delivery">("details");
  const [added, setAdded] = useState(false);
  useEffect(() => { if (item) { setQty(Math.max(1, item.min_order_qty || 1)); setImg(0); } }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <ShopLayout><OrbLoader label="Loading…" state="searching" /></ShopLayout>;
  if (!item) return <ShopLayout><div className="mx-auto max-w-xl px-4 py-24 text-center"><p className="font-display text-2xl font-bold">This item is not available</p><Link to="/shop" className="mt-4 inline-block font-semibold text-primary">Back to the shop</Link></div></ShopLayout>;

  const minQty = Math.max(1, item.min_order_qty || 1);
  const backorder = shop?.sell_out_of_stock !== false;
  const maxQty = item.kind === "product" && !backorder ? Math.max(0, item.stock ?? 0) : 9999;
  const out = item.kind === "product" && !backorder && maxQty <= 0;
  const unit = priceFor(item, qty);
  const tiers = [{ min_qty: minQty, price: item.price }, ...item.tier_prices.filter((t) => t.min_qty > minQty)];
  const related = items.filter((i) => i.id !== item.id && i.category === item.category).slice(0, 5);
  const unitLabel = item.unit || (item.kind === "service" ? "booking" : "pc");

  return (
    <ShopLayout>
      <PageHead title={`${item.name} · ${shop?.name || "JMSURF Garage"}`} description={item.description?.slice(0, 150) || `${item.name} at ${kes(item.price)}`} path={`/shop/p/${item.id}`} />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"><Link to="/" className="hover:text-primary">Home</Link><ChevronRight className="h-4 w-4" /><Link to="/shop" className="hover:text-primary">Shop</Link>{item.category && <><ChevronRight className="h-4 w-4" /><Link to={`/shop?category=${encodeURIComponent(item.category)}`} className="hover:text-primary">{item.category}</Link></>}<ChevronRight className="h-4 w-4" /><span className="truncate text-foreground">{item.name}</span></nav>
        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* gallery */}
          <div className="flex gap-3">
            {item.images.length > 1 && (
              <div className="hidden w-20 shrink-0 flex-col gap-2 sm:flex">{item.images.map((u, i) => (
                <button key={u} onMouseEnter={() => setImg(i)} onClick={() => setImg(i)} className={cn("aspect-square overflow-hidden rounded-xl border-2", img === i ? "border-primary" : "border-border")}><img src={u} alt="" className="h-full w-full object-cover" /></button>
              ))}</div>
            )}
            <div className="relative aspect-square flex-1 overflow-hidden rounded-3xl border border-border bg-muted/40">
              {item.images[img] ? <img src={item.images[img]} alt={item.name} className="h-full w-full object-contain" /> : <span className="flex h-full items-center justify-center text-muted-foreground/40"><BrandIcon className="h-20 w-20" /></span>}
              {item.images.length > 1 && <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 sm:hidden">{item.images.map((u, i) => <button key={u} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`} className={cn("h-2 w-2 rounded-full", img === i ? "bg-primary" : "bg-foreground/30")} />)}</div>}
            </div>
          </div>

          {/* buy box */}
          <div>
            {item.brand && <p className="text-sm font-semibold text-primary">{item.brand}</p>}
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">{item.name}</h1>
            {item.sku && <p className="mt-1 text-xs text-muted-foreground">SKU {item.sku}</p>}

            <div className="mt-5 rounded-2xl bg-muted/50 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {tiers.map((t, i) => {
                  const next = tiers[i + 1];
                  const on = qty >= t.min_qty && (!next || qty < next.min_qty);
                  return (
                    <div key={t.min_qty} className={cn("rounded-xl border p-3", on ? "border-primary bg-card" : "border-transparent")}>
                      <p className="font-display text-xl font-bold text-primary">{kes(t.price)}</p>
                      <p className="text-xs text-muted-foreground">{next ? `${t.min_qty} – ${next.min_qty - 1}` : `≥ ${t.min_qty}`} {unitLabel}s</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Min. order: {minQty} {unitLabel}{minQty > 1 ? "s" : ""}</p>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <span className="text-sm font-semibold">Quantity</span>
              <div className="flex items-center rounded-full border border-input">
                <button onClick={() => setQty(Math.max(minQty, qty - 1))} className="p-2.5 disabled:opacity-40" disabled={qty <= minQty} aria-label="Less"><Minus className="h-4 w-4" /></button>
                <input value={qty} onChange={(e) => setQty(Math.max(minQty, Math.min(maxQty || minQty, Math.floor(Number(e.target.value) || minQty))))} className="w-14 bg-transparent text-center font-semibold outline-none" aria-label="Quantity" inputMode="numeric" />
                <button onClick={() => setQty(Math.min(maxQty, qty + 1))} className="p-2.5 disabled:opacity-40" disabled={qty >= maxQty} aria-label="More"><Plus className="h-4 w-4" /></button>
              </div>
              {item.kind === "product" && <span className={cn("text-sm", out ? "font-semibold text-destructive" : maxQty <= 5 ? "font-semibold text-warning" : "text-muted-foreground")}>{out ? "Out of stock" : backorder ? ((item.stock ?? 0) > 0 ? `${item.stock} in stock` : "Available to order") : maxQty <= 5 ? `Only ${maxQty} left` : `${maxQty} in stock`}</span>}
            </div>
            <p className="mt-4 text-sm">Total: <b className="font-display text-xl text-primary">{kes(unit * qty)}</b>{unit < item.price && <span className="ml-2 text-xs text-success">You save {kes((item.price - unit) * qty)}</span>}</p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button disabled={out} onClick={() => { add(item.id, qty); setAdded(true); setTimeout(() => setAdded(false), 1800); }}
                className={cn("inline-flex flex-1 items-center justify-center gap-2 rounded-full border-2 px-6 py-3 font-display font-semibold transition-colors disabled:opacity-40", added ? "border-success bg-success text-white" : "border-primary text-primary hover:bg-primary/5")}>
                {added ? <><Check className="h-5 w-5" /> Added to cart</> : <><ShoppingCart className="h-5 w-5" /> Add to cart</>}
              </button>
              <button disabled={out} onClick={() => { add(item.id, qty); navigate("/checkout"); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-display font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-40"><Zap className="h-5 w-5" /> Buy now</button>
            </div>

            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-primary" /> Pay with M-Pesa at checkout{shop?.pay_on_delivery ? ", or on delivery" : ""}</li>
              <li className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> {shop?.delivery ? `Delivery${shop.delivery_fee ? ` from ${kes(shop.delivery_fee)}` : ""}${shop.free_delivery_over ? `, free over ${kes(shop.free_delivery_over)}` : ""}` : "Pick up at the shop"}</li>
              <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Genuine product, receipt with every order</li>
              <li className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /> Sign in and we'll remind you when it's time to buy again</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-card">
          <div className="flex gap-1 border-b border-border px-3">
            {([["details", "Product details"], ["specs", "Specifications"], ["delivery", "Delivery & payment"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("border-b-2 px-3 py-3 text-sm font-semibold", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <div className="p-5 text-sm leading-relaxed">
            {tab === "details" && <p className="whitespace-pre-wrap">{item.description || "No description yet. Ask us in the shop or on the phone."}</p>}
            {tab === "specs" && (item.specs.length ? (
              <table className="w-full max-w-2xl text-sm"><tbody>{[...(item.brand ? [{ label: "Brand", value: item.brand }] : []), ...(item.category ? [{ label: "Category", value: [item.category, item.subcategory].filter(Boolean).join(" › ") }] : []), ...item.specs].map((s, i) => (
                <tr key={i} className="border-b border-border last:border-0"><td className="w-1/3 bg-muted/40 px-3 py-2 font-medium">{s.label}</td><td className="px-3 py-2">{s.value}</td></tr>
              ))}</tbody></table>
            ) : <p className="text-muted-foreground">No specifications listed.</p>)}
            {tab === "delivery" && (
              <div className="space-y-2">
                {shop?.pickup && <p><b>Pickup:</b> free, at the shop{shop.address ? ` (${shop.address})` : ""}.</p>}
                {shop?.delivery && <p><b>Delivery:</b> {shop.delivery_fee ? kes(shop.delivery_fee) : "free"}{shop.free_delivery_over ? `, free on orders over ${kes(shop.free_delivery_over)}` : ""}.</p>}
                <p><b>Payment:</b> M-Pesa prompt to your phone at checkout{shop?.pay_on_delivery ? ", or pay when you collect / on delivery" : ""}.</p>
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-10"><h2 className="font-display text-xl font-bold">You may also like</h2><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{related.map((r) => <ProductCard key={r.id} item={r} />)}</div></section>
        )}
      </div>
    </ShopLayout>
  );
}
