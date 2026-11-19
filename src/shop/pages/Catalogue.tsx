import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X, ChevronRight, PackageSearch } from "lucide-react";
import ShopLayout, { PageBanner } from "../ShopLayout";
import { usePaged } from "@/components/Pager";
import ProductCard from "../ProductCard";
import { useCatalogue, useShopCategories } from "../shopData";
import { OrbLoader } from "@/components/orbs";
import PageHead from "@/components/PageHead";
import { cn } from "@/lib/utils";

const SORTS = [["match", "Best match"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["new", "Newest"], ["name", "Name A–Z"]] as const;

export default function Catalogue({ servicesOnly = false }: { servicesOnly?: boolean }) {
  const [params, setParams] = useSearchParams();
  const { data: items = [], isLoading } = useCatalogue();
  const { data: cats = [] } = useShopCategories();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const sub = params.get("sub") || "";
  const brand = params.get("brand") || "";
  const inStock = params.get("stock") === "1";
  const min = Number(params.get("min") || 0);
  const max = Number(params.get("max") || 0);
  const sort = params.get("sort") || "match";
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); if (k === "category") n.delete("sub"); setParams(n, { replace: true }); };

  const scope = useMemo(() => items.filter((i) => (servicesOnly ? i.kind === "service" : true)), [items, servicesOnly]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = scope.filter((i) => (!category || i.category === category) && (!sub || i.subcategory === sub) && (!brand || i.brand === brand)
      && (!inStock || i.kind === "service" || (i.stock ?? 0) > 0) && (!min || i.price >= min) && (!max || i.price <= max)
      && (!s || `${i.name} ${i.brand || ""} ${i.category || ""} ${i.subcategory || ""} ${(i.tags || []).join(" ")} ${i.description || ""}`.toLowerCase().includes(s)));
    if (sort === "price_asc") list.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") list.sort((a, b) => b.price - a.price);
    else if (sort === "new") list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => Number(b.featured) - Number(a.featured) || Number((b.stock ?? 1) > 0) - Number((a.stock ?? 1) > 0) || Number(!!b.images[0]) - Number(!!a.images[0]));
    return list;
  }, [scope, q, category, sub, brand, inStock, min, max, sort]);

  const paged = usePaged(rows, 24);
  const catCount = (name: string) => scope.filter((i) => i.category === name).length;
  const subs = [...new Set(scope.filter((i) => i.category === category && i.subcategory).map((i) => i.subcategory as string))].sort();
  const brands = [...new Set(scope.filter((i) => (!category || i.category === category) && i.brand).map((i) => i.brand as string))].sort();
  const active = [category && ["category", category], sub && ["sub", sub], brand && ["brand", brand], inStock && ["stock", "In stock"], min && ["min", `From KES ${min}`], max && ["max", `Up to KES ${max}`], q && ["q", `“${q}”`]].filter(Boolean) as [string, string][];

  const Filters = (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-bold">Categories</p>
        <ul className="space-y-0.5 text-sm">
          <li><button onClick={() => set("category", null)} className={cn("flex w-full justify-between rounded-lg px-2 py-1.5 text-left hover:bg-muted", !category && "font-semibold text-primary")}>All <span className="text-muted-foreground">{scope.length}</span></button></li>
          {cats.filter((c) => catCount(c.name)).map((c) => (
            <li key={c.id}>
              <button onClick={() => set("category", c.name)} className={cn("flex w-full justify-between rounded-lg px-2 py-1.5 text-left hover:bg-muted", category === c.name && "font-semibold text-primary")}>{c.name} <span className="text-muted-foreground">{catCount(c.name)}</span></button>
              {category === c.name && subs.length > 0 && (
                <ul className="ml-3 border-l border-border pl-2">{subs.map((s) => <li key={s}><button onClick={() => set("sub", sub === s ? null : s)} className={cn("w-full rounded-lg px-2 py-1 text-left text-[13px] hover:bg-muted", sub === s && "font-semibold text-primary")}>{s}</button></li>)}</ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      {brands.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold">Brand</p>
          <div className="space-y-1">{brands.map((b) => (
            <label key={b} className="flex items-center gap-2 text-sm"><input type="radio" name="brand" checked={brand === b} onChange={() => set("brand", b)} className="accent-[hsl(var(--primary))]" />{b}</label>
          ))}{brand && <button onClick={() => set("brand", null)} className="text-xs text-primary">Any brand</button>}</div>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-bold">Price (KES)</p>
        <div className="flex gap-2"><input type="number" placeholder="Min" defaultValue={min || ""} onBlur={(e) => set("min", e.target.value || null)} className="fi h-9" /><input type="number" placeholder="Max" defaultValue={max || ""} onBlur={(e) => set("max", e.target.value || null)} className="fi h-9" /></div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={inStock} onChange={(e) => set("stock", e.target.checked ? "1" : null)} className="h-4 w-4 accent-[hsl(var(--primary))]" /> In stock only</label>
    </div>
  );

  return (
    <ShopLayout>
      <PageHead title={`${servicesOnly ? "Services" : category || "Shop"} · JMSURF Garage`} description="Browse our products and services. Prices and stock are live." path={servicesOnly ? "/services" : "/shop"} />
      <PageBanner title={servicesOnly ? "Services" : category || "Shop"} subtitle={servicesOnly ? "Our services. Book or order online." : "Everything we sell, with live prices and stock."}
        crumbs={category ? [{ label: servicesOnly ? "Services" : "Shop", to: servicesOnly ? "/services" : "/shop" }, { label: category }] : [{ label: servicesOnly ? "Services" : "Shop" }]} />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex gap-6">
          <aside className="hidden w-60 shrink-0 lg:block"><div className="sticky top-24 rounded-2xl border border-border bg-card p-4">{Filters}</div></aside>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="mr-auto font-display text-2xl font-bold">{servicesOnly ? "Services" : category || "All products"}<span className="ml-2 text-sm font-normal text-muted-foreground">{rows.length} result{rows.length === 1 ? "" : "s"}</span></h1>
              <button onClick={() => setFiltersOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm lg:hidden"><SlidersHorizontal className="h-4 w-4" /> Filters</button>
              <select value={sort} onChange={(e) => set("sort", e.target.value === "match" ? null : e.target.value)} className="fi h-9 w-48" aria-label="Sort">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
            {active.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">{active.map(([k, l]) => <button key={k} onClick={() => set(k, null)} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{l}<X className="h-3 w-3" /></button>)}
                <button onClick={() => setParams(new URLSearchParams(), { replace: true })} className="text-xs text-muted-foreground underline">Clear all</button></div>
            )}
            {isLoading ? <OrbLoader label="Loading the shop…" state="searching" /> : rows.length === 0 ? (
              <div className="mt-10 flex flex-col items-center text-center text-muted-foreground"><PackageSearch className="h-12 w-12" /><p className="mt-3 font-semibold text-foreground">Nothing matches</p><p className="text-sm">Try another search or clear the filters.</p></div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{paged.rows.map((i) => <ProductCard key={i.id} item={i} />)}</div>
                {paged.total > paged.pageSize && (
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                    <button disabled={paged.page <= 1} onClick={() => { paged.setPage(paged.page - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40">Previous</button>
                    {Array.from({ length: Math.ceil(paged.total / paged.pageSize) }, (_, i) => i + 1).filter((n) => Math.abs(n - paged.page) <= 2 || n === 1 || n === Math.ceil(paged.total / paged.pageSize)).map((n) => (
                      <button key={n} onClick={() => { paged.setPage(n); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`h-10 w-10 rounded-full text-sm font-semibold ${n === paged.page ? "bg-primary text-primary-foreground" : "border border-border hover:border-primary"}`}>{n}</button>
                    ))}
                    <button disabled={paged.page * paged.pageSize >= paged.total} onClick={() => { paged.setPage(paged.page + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40">Next</button>
                    <span className="w-full text-center text-xs text-muted-foreground">Showing {(paged.page - 1) * paged.pageSize + 1}–{Math.min(paged.total, paged.page * paged.pageSize)} of {paged.total}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {filtersOpen && (
        <div className="fixed inset-0 z-50 bg-foreground/40 lg:hidden" onClick={() => setFiltersOpen(false)}>
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-sm overflow-y-auto bg-background p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><p className="font-display text-lg font-bold">Filters</p><button onClick={() => setFiltersOpen(false)} aria-label="Close"><X className="h-5 w-5" /></button></div>
            {Filters}
          </div>
        </div>
      )}
    </ShopLayout>
  );
}
