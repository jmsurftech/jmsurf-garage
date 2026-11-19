import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, AlertTriangle, Shirt, Pencil } from "lucide-react";
import { useProducts } from "@/hooks/useData";
import { useVariantsByProduct } from "@/hooks/useVariants";
import { formatKES } from "@/lib/format";
import { PageHeader, Toolbar, SearchBox, EmptyState, StatTile, StatGrid, PageLoader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PagedRows } from "@/components/Pager";
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];
const sortSizes = (a: string, b: string) => {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase()), ib = SIZE_ORDER.indexOf(b.toUpperCase());
  if (ia >= 0 && ib >= 0) return ia - ib;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
};

/** A size × colour grid of stock for every product that has variants. */
export default function VariantStock() {
  const { data: products = [] } = useProducts();
  const { map, isLoading } = useVariantsByProduct();
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p: any) => (map[p.id] || []).length > 0)
      .filter((p: any) => !term || p.name.toLowerCase().includes(term) || (p.sku || "").toLowerCase().includes(term))
      .map((p: any) => {
        const variants = map[p.id] || [];
        const low = variants.filter((v) => Number(v.stock) <= Number(v.reorder_level ?? 0));
        return { product: p, variants, low };
      })
      .filter((r) => !lowOnly || r.low.length > 0);
  }, [products, map, search, lowOnly]);

  const allVariants = useMemo(() => products.flatMap((p: any) => map[p.id] || []), [products, map]);
  const units = allVariants.reduce((a, v) => a + Number(v.stock || 0), 0);
  const lowCount = allVariants.filter((v) => Number(v.stock) <= Number(v.reorder_level ?? 0)).length;

  if (isLoading) return <PageLoader label="Loading sizes and colours…" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Sizes & colours" icon={Shirt} description="Stock for every size and colour you carry." />

      <StatGrid className="lg:grid-cols-3">
        <StatTile label="Products with options" value={products.filter((p: any) => (map[p.id] || []).length).length} icon={Layers} tone="primary" />
        <StatTile label="Units in stock" value={units.toLocaleString()} icon={Shirt} tone="info" hint={`${allVariants.length} size/colour options`} />
        <StatTile label="Running low" value={lowCount} icon={AlertTriangle} tone={lowCount ? "danger" : "muted"} className="col-span-2 lg:col-span-1" />
      </StatGrid>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Product name or code…" />
        <Button variant={lowOnly ? "default" : "outline"} size="sm" onClick={() => setLowOnly((v) => !v)}><AlertTriangle /> Low stock only</Button>
      </Toolbar>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={Layers} title={allVariants.length ? "Nothing matches" : "No sized products yet"}
            description={allVariants.length ? undefined : "Add sizes and colours when you create a product."} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <PagedRows rows={rows} gridSpan>{(pageRows) => pageRows.map(({ product, variants, low }) => {
            const sizes = Array.from(new Set(variants.map((v) => v.size || "—"))).sort(sortSizes);
            const colours = Array.from(new Set(variants.map((v) => v.color || "—")));
            const cell = (size: string, colour: string) => variants.find((v) => (v.size || "—") === size && (v.color || "—") === colour);
            const total = variants.reduce((a, v) => a + Number(v.stock || 0), 0);
            return (
              <section key={product.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {total} in stock · {variants.length} options · from {formatKES(Math.min(...variants.map((v) => Number(v.price ?? product.price))))}
                      {low.length > 0 && <span className="text-destructive"> · {low.length} low</span>}
                    </p>
                  </div>
                  <Link to={`../inventory/products/${product.id}/edit`} className="icon-btn" title="Edit product"><Pencil className="h-4 w-4" /></Link>
                </div>
                <div className="overflow-x-auto p-3 sm:p-4">
                  <table className="w-full border-separate border-spacing-1 text-sm">
                    <thead>
                      <tr>
                        <th className="w-24 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Colour</th>
                        {sizes.map((s) => <th key={s} className="min-w-[52px] text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <PagedRows rows={colours} colSpan={sizes.length + 1}>{(pageRows) => pageRows.map((c) => (
                        <tr key={c}>
                          <td className="truncate pr-2 text-sm font-medium">{c}</td>
                          {sizes.map((s) => {
                            const v = cell(s, c);
                            if (!v) return <td key={s} className="rounded-lg bg-muted/30 text-center text-muted-foreground/50">·</td>;
                            const n = Number(v.stock || 0);
                            const isLow = n <= Number(v.reorder_level ?? 0);
                            return (
                              <td key={s} title={`${c} / ${s}: ${n} in stock · ${formatKES(Number(v.price ?? product.price))}`}
                                className={cn("rounded-lg py-2 text-center font-semibold tabular-nums",
                                  n <= 0 ? "bg-destructive/15 text-destructive" : isLow ? "bg-warning/20 text-[hsl(32_90%_38%)]" : "bg-success/10 text-success")}>
                                {n}
                              </td>
                            );
                          })}
                        </tr>
                      ))}</PagedRows>
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}</PagedRows>
        </div>
      )}
    </div>
  );
}
