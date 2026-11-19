import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { mergeSiteConfig, type SiteConfig } from "@/lib/siteConfig";

const sb: any = supabase;

export type CatalogueItem = {
  id: string; tenant_id: string; name: string; sku: string | null; category: string | null; subcategory: string | null; brand: string | null;
  price: number; unit: string | null; image_url: string | null; images: string[]; description: string | null; specs: { label: string; value: string }[];
  tier_prices: { min_qty: number; price: number }[]; min_order_qty: number; featured: boolean; tags: string[]; stock: number | null;
  kind: "product" | "service"; created_at: string; updated_at: string; compare_at_price: number | null;
};
export type ShopInfo = {
  slug: string; name: string; logo_url: string | null; phone: string | null; email: string | null; address: string | null; currency: string;
  delivery_fee: number; free_delivery_over: number; min_order?: number; pickup: boolean; delivery: boolean; pay_on_delivery: boolean; mpesa: boolean;
  bank_details: string | null; till: string | null; paybill: string | null; account_ref: string | null;
  announcement: string | null; hero_title: string | null; hero_text: string | null;
  sell_out_of_stock?: boolean; approve_signups?: boolean; site?: Record<string, any>;
};

/** The live online catalogue (prices and stock straight from the ERP; refreshes every 30 s). */
export function useCatalogue() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["shop-catalogue", tenant?.id],
    enabled: !!tenant?.id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await sb.from("shop_catalogue").select("*").eq("tenant_id", tenant!.id).order("name");
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r, price: Number(r.price || 0), stock: r.stock === null ? null : Number(r.stock), min_order_qty: Number(r.min_order_qty || 1),
        images: [r.image_url, ...(Array.isArray(r.images) ? r.images : [])].filter((x: any, i: number, a: any[]) => x && a.indexOf(x) === i),
        tier_prices: (Array.isArray(r.tier_prices) ? r.tier_prices : []).map((t: any) => ({ min_qty: Number(t.min_qty), price: Number(t.price) })).sort((a: any, b: any) => a.min_qty - b.min_qty),
        specs: Array.isArray(r.specs) ? r.specs : [],
        compare_at_price: r.compare_at_price ? Number(r.compare_at_price) : null,
      })) as CatalogueItem[];
    },
  });
}

export function useShopCategories() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["shop-categories", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => ((await sb.from("shop_categories").select("*").eq("tenant_id", tenant!.id).order("sort_order")).data || []) as { id: string; name: string; image_url: string | null }[],
  });
}

export async function shopApi<T = any>(path: string, body: Record<string, unknown> = {}, token?: string | null): Promise<T> {
  const res = await fetch(`/api/shop/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Customer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out?.error || "Something went wrong"), { status: res.status });
  return out as T;
}

export function useShopInfo() {
  return useQuery({ queryKey: ["shop-info"], staleTime: 60_000, queryFn: async () => (await shopApi<{ shop: ShopInfo }>("info")).shop });
}

/** Website content and colours (System → Online shop & website), with the shop's own details as fallbacks. */
export function useSite(): SiteConfig & { shop?: ShopInfo } {
  const { data: shop } = useShopInfo();
  const site = mergeSiteConfig(shop?.site);
  const contact = { ...site.contact, phone: site.contact.phone || shop?.phone || "", email: site.contact.email || shop?.email || "", address: site.contact.address || shop?.address || "" };
  return { ...site, contact, hero: { ...site.hero, title: shop?.hero_title || site.hero.title, text: shop?.hero_text || site.hero.text }, shop };
}

/** Can this item be added to the cart right now? */
export const canBuy = (item: Pick<CatalogueItem, "kind" | "stock">, shop?: ShopInfo) => item.kind !== "product" || (item.stock ?? 0) > 0 || shop?.sell_out_of_stock !== false;

/** Unit price for a quantity: the best volume price that applies. */
export function priceFor(item: Pick<CatalogueItem, "price" | "tier_prices">, qty: number) {
  let p = item.price;
  for (const t of item.tier_prices || []) if (qty >= t.min_qty && t.price > 0 && t.price < p) p = t.price;
  return p;
}
export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-US")}`;

/* ------------------------------------------------------------------ cart */
type CartLine = { id: string; qty: number };
const CART_KEY = "dash-cart";
const CartCtx = createContext<{
  lines: CartLine[]; add: (id: string, qty?: number) => void; setQty: (id: string, qty: number) => void; remove: (id: string) => void; clear: () => void; count: number;
}>({ lines: [], add: () => {}, setQty: () => {}, remove: () => {}, clear: () => {}, count: 0 });

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(v) ? v.filter((l) => l?.id && l.qty > 0) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch { /* storage blocked */ } }, [lines]);
  const add = useCallback((id: string, qty = 1) => setLines((ls) => { const f = ls.find((l) => l.id === id); return f ? ls.map((l) => (l.id === id ? { ...l, qty: l.qty + qty } : l)) : [...ls, { id, qty }]; }), []);
  const setQty = useCallback((id: string, qty: number) => setLines((ls) => (qty <= 0 ? ls.filter((l) => l.id !== id) : ls.map((l) => (l.id === id ? { ...l, qty } : l)))), []);
  const remove = useCallback((id: string) => setLines((ls) => ls.filter((l) => l.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);
  const value = useMemo(() => ({ lines, add, setQty, remove, clear, count: lines.reduce((a, l) => a + l.qty, 0) }), [lines, add, setQty, remove, clear]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
export const useCart = () => useContext(CartCtx);

/* -------------------------------------------------------- customer session */
const TOKEN_KEY = "dash-customer";
export function getCustomerToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setCustomerToken(t: string | null) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } }

/** Anonymous id for this browser, used for website visit counts (CRM → Visits). */
export function visitorId(): string {
  try {
    let v = localStorage.getItem("dash-vid");
    if (!v) { v = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem("dash-vid", v); }
    return v;
  } catch { return ""; }
}
