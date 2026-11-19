import { useMemo, useState } from "react";
import { erpApi } from "@/lib/erpApi";
import { ShieldCheck } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ProductsTabs from "@/components/ProductsTabs";
import ImportExport from "@/components/ImportExport";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ChevronDown, Search, X, Pencil, Package, Wrench, Globe, Star, ImagePlus, Trash2, Save, Bell, Boxes, ArrowUpDown,
  SlidersHorizontal, EyeOff, Power, Download,
} from "lucide-react";
import Pager, { usePaged, PagedRows } from "@/components/Pager";
import { useSelection, BulkBar, Tick, downloadCsv } from "@/components/Bulk";
import { confirmAction } from "@/components/books/confirm";
import { Modal, Field } from "@/components/kit";
import { useCategories } from "@/hooks/useTaxonomy";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/kit";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { fmtDate } from "@/lib/doc-pdf";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CustomFieldsView } from "@/lib/customFields";
import { useModules } from "@/hooks/useModules";

const sb: any = supabase;
type Kind = "product" | "service";
const VIEWS = [["all", "All Products & Services"], ["active", "Active"], ["low", "Low Stock"], ["out", "Out of Stock"], ["goods", "Products"], ["service", "Services"], ["online", "Shown Online"], ["inactive", "Inactive"]] as const;

/** Every product (with stock across branches) and service of the shop. */
function useItems() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["zitems", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [p, s, st] = await Promise.all([
        sb.from("products").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("services").select("*").eq("tenant_id", tenantId).order("name"),
        sb.from("product_stocks").select("product_id, stock"),
      ]);
      if (p.error) throw p.error;
      const stock = new Map<string, number>();
      for (const r of st.data || []) stock.set(r.product_id, (stock.get(r.product_id) || 0) + Number(r.stock || 0));
      return [
        ...(p.data || []).map((x: any) => ({ ...x, _kind: "product" as Kind, _stock: stock.has(x.id) ? stock.get(x.id)! : Number(x.stock || 0) })),
        ...(s.data || []).map((x: any) => ({ ...x, _kind: "service" as Kind, _stock: null })),
      ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
  });
}

export default function Items() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useItems();
  const shopOn = useModules().has("ecommerce");
  const [params] = useSearchParams();
  const [view, setView] = useState<string>(() => params.get("view") || "active");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "rate" | "stock">("name");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (items as any[]).filter((i) => {
      if (view === "active" && i.is_active === false) return false;
      if (view === "inactive" && i.is_active !== false) return false;
      // Services are kept in two places: the services list, and items marked as a service (e.g. moved in from Zoho).
      const svc = i._kind === "service" || i.product_type === "service";
      if (view === "goods" && svc) return false;
      if (view === "service" && !svc) return false;
      if (view === "online" && !i.show_online) return false;
      if (view === "low" && !(!svc && Number(i._stock) <= Number(i.reorder_level || 0))) return false;
      if (view === "out" && !(!svc && Number(i._stock) <= 0)) return false;
      const cat = params.get("category");
      if (cat && i.category !== cat) return false;
      return !s || `${i.name} ${i.sku || ""} ${i.barcode || ""} ${i.category || ""} ${i.brand || ""}`.toLowerCase().includes(s);
    });
    if (sort === "rate") list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    if (sort === "stock") list.sort((a, b) => Number(a._stock ?? 1e12) - Number(b._stock ?? 1e12));
    return list;
  }, [items, view, q, sort, params]);
  const selected = id ? (items as any[]).find((i) => i.id === id) : null;
  const paged = usePaged(rows, 50);
  const sel = useSelection(paged.rows.map((r: any) => r.id));
  const [bulkEdit, setBulkEdit] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const picked = (items as any[]).filter((i) => sel.has(i.id));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["zitems"] }); qc.invalidateQueries({ queryKey: ["products"] }); };
  const bulkUpdate = async (patch: Record<string, unknown>, msg: string) => {
    const prods = picked.filter((i) => i._kind === "product").map((i) => i.id);
    const svcs = picked.filter((i) => i._kind === "service").map((i) => i.id);
    const svcPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => ["is_active", "show_online", "category", "price", "description"].includes(k)));
    const errs = [
      prods.length ? (await sb.from("products").update(patch).in("id", prods)).error : null,
      svcs.length && Object.keys(svcPatch).length ? (await sb.from("services").update(svcPatch).in("id", svcs)).error : null,
    ].filter(Boolean);
    if (errs.length) return toast({ title: "Some items were not changed", description: errs[0].message, variant: "destructive" });
    toast({ title: msg }); sel.clear(); refresh();
  };
  const bulkDelete = async () => {
    if (!(await confirmAction({ title: `Delete ${sel.count} item${sel.count === 1 ? "" : "s"}?`, message: "Items already used on sales or documents cannot be deleted; they are marked inactive instead.", danger: true, confirmLabel: "Delete" }))) return;
    let gone = 0, kept = 0;
    for (const i of picked) {
      const { error } = await sb.from(i._kind === "product" ? "products" : "services").delete().eq("id", i.id);
      if (error) { kept++; await sb.from(i._kind === "product" ? "products" : "services").update({ is_active: false }).eq("id", i.id); } else gone++;
    }
    toast({ title: `${gone} deleted${kept ? `, ${kept} marked inactive (in use)` : ""}` }); sel.clear(); refresh();
  };
  const exportPicked = () => downloadCsv("items-selected.csv", ["Name", "Type", "SKU", "Category", "Price", "Cost", "Stock", "Reorder level", "Online"],
    picked.map((i) => [i.name, i._kind, i.sku, i.category, i.price, i.cost_price, i._stock, i.reorder_level, i.show_online ? "yes" : "no"]));

  if (isLoading) return <OrbLoader label="Loading items…" />;

  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:h-[calc(100svh-9.5rem)] md:h-[calc(100svh-6rem)] lg:h-[calc(100svh-7rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <ProductsTabs className="w-full sm:w-auto" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 font-display text-lg font-bold">{VIEWS.find(([v]) => v === view)?.[1]} <ChevronDown className="h-4 w-4 text-primary" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {VIEWS.map(([v, l]) => <DropdownMenuItem key={v} onSelect={() => setView(v)} className={cn(view === v && "font-semibold text-primary")}>{l}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {!selected && (
          <>
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" className="fi h-9 w-64 rounded-full pl-9" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><ArrowUpDown /> Sort</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setSort("name")}>Name</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSort("rate")}>Rate (high first)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSort("stock")}>Stock on hand (low first)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ImportExport entity="products" label="Import / Export"
              rows={(items as any[]).map((i) => ({ name: i.name, type: i._kind, sku: i.sku, category: i.category, subcategory: i.subcategory, price: i.price, cost_price: i.cost_price, stock: i._stock, reorder_level: i.reorder_level, unit: i.unit, show_online: i.show_online ? "yes" : "no" }))}
              spec={{ table: "products", columns: [{ key: "name", label: "Name", required: true }, { key: "sku", label: "SKU" }, { key: "category", label: "Category", required: true }, { key: "subcategory", label: "Subcategory" }, { key: "price", label: "Selling price", type: "number", required: true }, { key: "cost_price", label: "Cost price", type: "number" }, { key: "reorder_level", label: "Reorder level", type: "number" }, { key: "unit", label: "Unit" }, { key: "description", label: "Description" }],
                toRecord: (r) => ({ ...r, sku: r.sku || `IMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(), cost_price: r.cost_price || 0, reorder_level: r.reorder_level ?? 2, unit: r.unit || "piece", is_active: true, show_online: true }) }} />
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm"><Plus /> New <ChevronDown className="opacity-70" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate("/inventory/products/new")}><Package /> Goods (product)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/inventory/products/new?type=service")}><Wrench /> Service</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 overflow-y-auto border-r border-border bg-card", selected ? "hidden w-[300px] shrink-0 xl:block" : "w-full")}>
          {rows.length === 0 ? (
            <EmptyState icon={Package} title="No items here" description="Add the goods and services you sell. They appear on the till, documents and the online shop."
              action={<Button onClick={() => navigate("/inventory/products/new")}><Plus /> New item</Button>} className="m-6" />
          ) : selected ? (
            <ul>{(paged.rows as any[]).map((i) => (
              <li key={i.id}><Link to={`/inventory/products/${i.id}`} className={cn("flex items-center gap-3 border-b border-border px-4 py-3 hover:bg-muted/50", i.id === id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                <Thumb item={i} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.name}</p>
                  <p className="text-xs text-muted-foreground">{formatKES(Number(i.price || 0))}{i._kind === "product" && i.product_type !== "service" ? ` · ${Number(i._stock)} in stock` : " · service"}</p>
                </div>
              </Link></li>
            ))}<li><Pager {...paged.pager} /></li></ul>
          ) : (
            <div className="overflow-x-auto">
              <BulkBar sel={sel}>
                <Button size="sm" variant="outline" onClick={() => setBulkEdit(true)}><Pencil /> Bulk edit</Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/inventory/adjustments/new?items=${picked.filter((i) => i._kind === "product").map((i) => i.id).join(",")}`)}><SlidersHorizontal /> Adjust stock</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline">More <ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {shopOn && <><DropdownMenuItem onSelect={() => bulkUpdate({ show_online: true }, "Shown on the online shop")}><Globe /> Show online</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulkUpdate({ show_online: false }, "Hidden from the online shop")}><EyeOff /> Hide from online shop</DropdownMenuItem>
                    </>}
                    <DropdownMenuItem onSelect={() => bulkUpdate({ is_active: true }, "Marked active")}><Power /> Mark active</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulkUpdate({ is_active: false }, "Marked inactive")}><Power /> Mark inactive</DropdownMenuItem>
                    <DropdownMenuItem onSelect={async () => {
                      const ids = picked.filter((i) => i._kind === "product").map((i) => i.id);
                      if (!ids.length) return toast({ title: "Pick goods items to register", variant: "destructive" });
                      try {
                        const r: any = await erpApi("etims/register-items", { ids });
                        toast({ title: `${r.registered} item${r.registered === 1 ? "" : "s"} registered with KRA eTIMS`, description: r.failed?.length ? r.failed.slice(0, 3).join("; ") : undefined, variant: r.failed?.length && !r.registered ? "destructive" : undefined });
                      } catch (e: any) { toast({ title: "Not registered", description: e.message, variant: "destructive" }); }
                    }}><ShieldCheck /> Register with KRA eTIMS</DropdownMenuItem>
                    <DropdownMenuItem onSelect={exportPicked}><Download /> Export selected</DropdownMenuItem>
                    <DropdownMenuItem danger onSelect={bulkDelete}><Trash2 /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </BulkBar>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 z-[1] bg-card"><tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 px-3 py-2.5 text-left"><Tick on={sel.allOn} mixed={sel.someOn} onChange={sel.toggleAll} label="Select all on this page" /></th>
                  <th className="px-4 py-2.5 text-left">Name</th><th className="px-4 py-2.5 text-left">SKU</th><th className="px-4 py-2.5 text-left">Type</th>
                  <th className="px-4 py-2.5 text-left">Category</th><th className="px-4 py-2.5 text-right">Rate</th><th className="px-4 py-2.5 text-right">Stock on Hand</th>
                  <th className="px-4 py-2.5 text-right">Reorder Level</th><th className="px-4 py-2.5 text-center">Online</th>
                </tr></thead>
                <tbody>{(paged.rows as any[]).map((i) => {
                  const low = i._kind === "product" && i.product_type !== "service" && Number(i._stock) <= Number(i.reorder_level || 0);
                  return (
                    <tr key={i.id} onClick={() => navigate(`/inventory/products/${i.id}`)} className={cn("cursor-pointer border-b border-border hover:bg-muted/40", i.is_active === false && "opacity-60", sel.has(i.id) && "bg-primary/5")}>
                      <td className="w-10 px-3 py-2.5"><Tick on={sel.has(i.id)} onChange={() => sel.toggle(i.id)} /></td>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Thumb item={i} className="h-9 w-9" /><span className="font-semibold text-primary">{i.name}</span></div></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{i.sku || "—"}</td>
                      <td className="px-4 py-2.5">{i._kind === "product" && i.product_type !== "service" ? "Goods" : "Service"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{[i.category, i.subcategory].filter(Boolean).join(" › ") || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatKES(Number(i.price || 0))}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", low && "font-semibold text-destructive")}>{i._kind === "product" && i.product_type !== "service" ? `${Number(i._stock)} ${i.unit || ""}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{i._kind === "product" ? Number(i.reorder_level || 0) : "—"}</td>
                      <td className="px-4 py-2.5 text-center">{i.show_online ? <Globe className="mx-auto h-4 w-4 text-primary" /> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <Pager {...paged.pager} />
            </div>
          )}
          {bulkEdit && <BulkEditItems items={picked} onClose={() => setBulkEdit(false)} onSave={(patch) => { setBulkEdit(false); void bulkUpdate(patch, `${picked.length} item${picked.length === 1 ? "" : "s"} updated`); }} onSavePrices={async (fn) => {
            setBulkEdit(false);
            for (const i of picked) await sb.from(i._kind === "product" ? "products" : "services").update({ price: fn(Number(i.price || 0)) }).eq("id", i.id);
            toast({ title: "Prices updated" }); sel.clear(); refresh();
          }} />}
        </div>
        {selected && <ItemDetail item={selected} onClose={() => navigate("/inventory/products")} />}
        {id && !selected && <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">That item was not found.</div>}
      </div>
    </div>
  );
}

function Thumb({ item, className }: { item: any; className?: string }) {
  const src = item.image_url || (Array.isArray(item.images) && item.images[0]);
  return src ? <img src={src} alt="" className={cn("shrink-0 rounded-lg border border-border bg-white object-cover", className)} loading="lazy" />
    : <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", className)}>{item._kind === "service" ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}</span>;
}

const TABS = ["overview", "online", "transactions", "history"] as const;

function ItemDetail({ item, onClose }: { item: any; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const table = item._kind === "product" ? "products" : "services";
  const setActive = async (on: boolean) => {
    const { error } = await (supabase as any).from(table).update({ is_active: on }).eq("id", item.id);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    void qc.invalidateQueries(); toast({ title: on ? "Marked as active" : "Marked as inactive" });
  };
  const removeItem = async () => {
    if (!(await confirmAction({ title: `Delete ${item.name}?`, message: "Items already used on documents cannot be deleted; mark them inactive instead.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await (supabase as any).from(table).delete().eq("id", item.id);
    if (error) return toast({ title: "Not deleted", description: "It is used on documents or stock records. Mark it inactive instead.", variant: "destructive" });
    void qc.invalidateQueries(); toast({ title: "Item deleted" }); onClose();
  };
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const isProduct = item._kind === "product";
  const shopOn = useModules().has("ecommerce");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <p className="text-xs text-muted-foreground">{isProduct && item.product_type !== "service" ? "Goods" : "Service"}{item.sku ? ` · ${item.sku}` : ""}</p>
          <h2 className="truncate font-display text-xl font-bold">{item.name}</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate(`/inventory/products/${item.id}/edit${isProduct ? "" : "?type=service"}`)}><Pencil /> Edit</Button>
        {isProduct && <Button size="sm" variant="outline" onClick={() => navigate(`/inventory/adjustments/new?items=${item.id}`)}>Adjust Stock</Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline">More</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/inventory/products/new?clone=${item.id}${isProduct ? "" : "&type=service"}`)}>Clone Item</DropdownMenuItem>
            {item.is_active === false ? <DropdownMenuItem onSelect={() => void setActive(true)}>Mark as Active</DropdownMenuItem> : <DropdownMenuItem onSelect={() => void setActive(false)}>Mark as Inactive</DropdownMenuItem>}
            <DropdownMenuItem danger onSelect={() => void removeItem()}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onClose} aria-label="Close"><X /></Button>
      </div>
      <div className="flex gap-1 border-b border-border bg-card px-3">
        {TABS.filter((t) => (isProduct || t === "overview" || t === "online") && (t !== "online" || shopOn)).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors", tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t === "online" ? "Online Shop" : t === "history" ? "Stock History" : t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {tab === "overview" && <Overview item={item} />}
        {tab === "online" && <OnlinePanel item={item} />}
        {tab === "transactions" && <ItemTransactions productId={item.id} />}
        {tab === "history" && <StockHistory productId={item.id} />}
      </div>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v ?? "—"}</span></div>;
}

function Overview({ item }: { item: any }) {
  const isProduct = item._kind === "product";
  const tenantId = useTenantId();
  const { data: branches = [] } = useQuery({
    queryKey: ["item-branches", item.id],
    enabled: isProduct && !!tenantId,
    queryFn: async () => {
      const [{ data: locs }, { data: st }] = await Promise.all([
        sb.from("locations").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
        sb.from("product_stocks").select("location_id, stock, reorder_level").eq("product_id", item.id),
      ]);
      return (locs || []).map((l: any) => ({ ...l, ...(st || []).find((s: any) => s.location_id === l.id) }));
    },
  });
  const margin = Number(item.price || 0) - Number(item.cost_price || 0);
  const imgs: string[] = [item.image_url, ...(Array.isArray(item.images) ? item.images : [])].filter(Boolean);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <Section title="Item Details">
          <KV k="Item Type" v={isProduct ? "Inventory goods" : "Service"} />
          {isProduct && <KV k="SKU" v={item.sku} />}
          {isProduct && <KV k="Barcode" v={item.barcode} />}
          <KV k="Unit" v={item.unit} />
          <KV k="Category" v={[item.category, item.subcategory].filter(Boolean).join(" › ")} />
          {isProduct && <KV k="Brand" v={item.brand} />}
          <KV k="Description" v={item.description} />
          <CustomFieldsView entity="item" values={item.custom} className="space-y-0.5 text-sm" />
          <KV k="Repurchase reminder" v={item.repurchase_days ? `Every ${item.repurchase_days} days` : "Off"} />
        </Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Sales Information">
            <KV k="Selling Price" v={formatKES(Number(item.price || 0))} />
            <KV k="VAT" v={Number(item.vat_rate || 0) ? `${item.vat_rate}%` : "Non-taxable"} />
            {isProduct && item.enable_wholesale && <KV k="Wholesale" v={`${formatKES(Number(item.wholesale_price || 0))} from ${item.wholesale_min_quantity} units`} />}
          </Section>
          <Section title="Purchase Information">
            <KV k="Cost Price" v={formatKES(Number(item.cost_price || 0))} />
            <KV k="Margin" v={<span className={margin < 0 ? "text-destructive" : "text-success"}>{formatKES(margin)}{Number(item.price) ? ` (${Math.round((margin / Number(item.price)) * 100)}%)` : ""}</span>} />
          </Section>
        </div>
        {isProduct && (
          <Section title="Stock Locations">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 text-left">Branch</th><th className="py-1.5 text-right">Stock on Hand</th><th className="py-1.5 text-right">Reorder Level</th></tr></thead>
              <tbody><PagedRows rows={(branches as any[])} colSpan={3}>{(pageRows) => pageRows.map((b) => (
                <tr key={b.id} className="border-t border-border"><td className="py-2">{b.name}</td>
                  <td className={cn("py-2 text-right tabular-nums", Number(b.stock || 0) <= Number(b.reorder_level ?? item.reorder_level ?? 0) && "font-semibold text-destructive")}>{Number(b.stock || 0)} {item.unit || ""}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{b.reorder_level ?? item.reorder_level ?? 0}</td></tr>
              ))}</PagedRows></tbody>
            </table>
          </Section>
        )}
      </div>
      <div className="space-y-4">
        <Section title="Images">
          {imgs.length ? <div className="grid grid-cols-2 gap-2">{imgs.map((u, i) => <img key={i} src={u} alt="" className="aspect-square w-full rounded-xl border border-border object-cover" />)}</div>
            : <p className="text-sm text-muted-foreground">No images yet. Add them on the Online Shop tab.</p>}
        </Section>
        {isProduct && (
          <Section title="Stock Summary">
            <p className="font-display text-3xl font-bold tabular-nums">{Number(item._stock)}</p>
            <p className="text-sm text-muted-foreground">{item.unit || "units"} on hand · value {formatKES(Number(item._stock) * Number(item.cost_price || 0))}</p>
          </Section>
        )}
      </div>
    </div>
  );
}

/** Website listing: gallery, description, specs, volume prices, min order, repurchase reminder. */
function OnlinePanel({ item }: { item: any }) {
  const isProduct = item._kind === "product";
  const table = isProduct ? "products" : "services";
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState(() => ({
    show_online: item.show_online !== false,
    featured: !!item.featured,
    description: item.description || "",
    images: (Array.isArray(item.images) ? item.images : []) as string[],
    image_url: item.image_url || "",
    specs: (Array.isArray(item.specs) ? item.specs : []) as { label: string; value: string }[],
    tiers: (Array.isArray(item.tier_prices) ? item.tier_prices : []) as { min_qty: number; price: number }[],
    min_order_qty: Number(item.min_order_qty || 1),
    repurchase_days: item.repurchase_days ? String(item.repurchase_days) : "",
    duration_minutes: item.duration_minutes ? String(item.duration_minutes) : "",
  }));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const urls: string[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
      if (file.size > 5_000_000) { toast({ title: `${file.name} is larger than 5 MB`, variant: "destructive" }); continue; }
      const path = `${item.tenant_id}/${item.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true, contentType: file.type });
      if (error) { toast({ title: "Upload failed", description: error.message, variant: "destructive" }); continue; }
      urls.push(supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl);
    }
    setUploading(false);
    setF((x) => ({ ...x, image_url: x.image_url || urls[0] || "", images: [...x.images, ...urls.filter((u) => u !== (x.image_url || urls[0]))] }));
  };

  const save = async () => {
    setBusy(true);
    const patch: Record<string, unknown> = {
      show_online: f.show_online, description: f.description.trim() || null, image_url: f.image_url || null,
      repurchase_days: f.repurchase_days ? Math.max(1, parseInt(f.repurchase_days)) : null,
    };
    if (isProduct) Object.assign(patch, {
      featured: f.featured, images: f.images,
      specs: f.specs.filter((s) => s.label.trim() && s.value.trim()),
      tier_prices: f.tiers.filter((t) => Number(t.min_qty) > 1 && Number(t.price) > 0).sort((a, b) => a.min_qty - b.min_qty),
      min_order_qty: Math.max(1, Number(f.min_order_qty) || 1),
    });
    else patch.duration_minutes = f.duration_minutes ? parseInt(f.duration_minutes) : null;
    const { error } = await sb.from(table).update(patch).eq("id", item.id);
    setBusy(false);
    if (error) return toast({ title: "Not saved", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["zitems"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    toast({ title: "Online shop details saved" });
  };

  const gallery = [f.image_url, ...f.images].filter(Boolean);
  return (
    <div className="max-w-3xl space-y-4">
      <Section title="Website">
        <label className="flex items-center justify-between gap-3 py-1.5 text-sm"><span><Globe className="mr-2 inline h-4 w-4 text-primary" />Show on the online shop</span><Switch checked={f.show_online} onCheckedChange={(v) => setF({ ...f, show_online: v })} /></label>
        {isProduct && <label className="flex items-center justify-between gap-3 py-1.5 text-sm"><span><Star className="mr-2 inline h-4 w-4 text-primary" />Featured on the home page</span><Switch checked={f.featured} onCheckedChange={(v) => setF({ ...f, featured: v })} /></label>}
        <p className="mt-2 text-xs text-muted-foreground">Price and stock update automatically.</p>
      </Section>

      <Section title="Photos">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {gallery.map((u, i) => (
            <div key={u + i} className="group relative">
              <img src={u} alt="" className={cn("aspect-square w-full rounded-xl border object-cover", i === 0 ? "border-primary ring-2 ring-primary/30" : "border-border")} />
              {i === 0 && <span className="absolute left-1 top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">Main</span>}
              <div className="absolute inset-x-1 bottom-1 hidden gap-1 group-hover:flex">
                {i > 0 && <button type="button" onClick={() => setF((x) => { const all = [x.image_url, ...x.images].filter(Boolean); const [m] = all.splice(i, 1); return { ...x, image_url: m, images: all }; })} className="flex-1 rounded-md bg-white/90 py-0.5 text-[10px] font-semibold text-foreground">Main</button>}
                <button type="button" onClick={() => setF((x) => { const all = [x.image_url, ...x.images].filter(Boolean); all.splice(i, 1); return { ...x, image_url: all[0] || "", images: all.slice(1) }; })} className="rounded-md bg-white/90 px-1 text-destructive" aria-label="Remove photo"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary">
            {uploading ? <OrbSpinner className="h-6 w-6" state="working" /> : <ImagePlus className="h-6 w-6" />}
            Add photos
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
        </div>
      </Section>

      <Section title="Description">
        <textarea className="fi min-h-[110px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What it is, who it is for, how to use it…" />
      </Section>

      {isProduct && (
        <>
          <Section title="Specifications">
            <div className="space-y-2">
              {f.specs.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input className="fi" placeholder="e.g. Pack size" value={s.label} onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input className="fi" placeholder="e.g. 4 kg" value={s.value} onChange={(e) => setF({ ...f, specs: f.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <button type="button" className="icon-btn-danger" onClick={() => setF({ ...f, specs: f.specs.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setF({ ...f, specs: [...f.specs, { label: "", value: "" }] })}><Plus /> Add specification</Button>
            </div>
          </Section>
          <Section title="Volume pricing (buy more, pay less)">
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_40px] gap-2 text-xs text-muted-foreground"><span>From quantity</span><span>Price each</span><span /></div>
              {f.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_40px] gap-2">
                  <input className="fi" type="number" min={2} value={t.min_qty} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, min_qty: Number(e.target.value) } : x)) })} />
                  <input className="fi" type="number" min={0} step="any" value={t.price} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} />
                  <button type="button" className="icon-btn-danger" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setF({ ...f, tiers: [...f.tiers, { min_qty: 5, price: Number(item.price || 0) }] })}><Plus /> Add price break</Button>
              <label className="mt-3 flex items-center justify-between gap-3 text-sm">Minimum order quantity<input className="fi w-28" type="number" min={1} value={f.min_order_qty} onChange={(e) => setF({ ...f, min_order_qty: Number(e.target.value) })} /></label>
            </div>
          </Section>
        </>
      )}

      <Section title="Repurchase reminder">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Bell className="h-4 w-4 text-primary" />
          <span>Remind the customer to buy again after</span>
          <input className="fi w-24" type="number" min={1} value={f.repurchase_days} onChange={(e) => setF({ ...f, repurchase_days: e.target.value })} placeholder="days" />
          <span>days</span>
          {[30, 42, 90, 180].map((d) => <button key={d} type="button" onClick={() => setF({ ...f, repurchase_days: String(d) })} className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">{d === 90 ? "3 months" : d === 180 ? "6 months" : d === 42 ? "6 weeks" : "1 month"}</button>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Leave empty for no reminder.</p>
        {!isProduct && (
          <label className="mt-3 flex items-center justify-between gap-3 text-sm">Duration (minutes)<input className="fi w-28" type="number" min={0} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} /></label>
        )}
      </Section>

      <div className="sticky bottom-0 flex justify-end bg-gradient-to-t from-muted/80 to-transparent py-3">
        <Button onClick={save} disabled={busy}>{busy ? <OrbSpinner state="working" /> : <Save />} Save online details</Button>
      </div>
    </div>
  );
}

function ItemTransactions({ productId }: { productId: string }) {
  const tenantId = useTenantId();
  const { data = [], isLoading } = useQuery({
    queryKey: ["item-tx", productId],
    enabled: !!tenantId,
    queryFn: async () => (await sb.from("transactions").select("id, created_at, customer_name, items, total, status, payment_method")
      .eq("tenant_id", tenantId).contains("items", [{ product_id: productId }]).order("created_at", { ascending: false }).limit(200)).data || [],
  });
  if (isLoading) return <OrbLoader label="Loading sales…" />;
  if (!data.length) return <EmptyState icon={Package} title="No sales of this item yet" />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Customer</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Price</th><th className="px-4 py-2 text-left">Payment</th></tr></thead>
        <tbody><PagedRows rows={(data as any[])} colSpan={5}>{(pageRows) => pageRows.map((t) => {
          const line = (t.items || []).find((i: any) => (i.product_id || i.id) === productId) || {};
          return (
            <tr key={t.id} className="border-t border-border"><td className="px-4 py-2">{fmtDate(t.created_at)}</td><td className="px-4 py-2">{t.customer_name || "Walk-in"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{line.quantity ?? line.qty ?? 1}</td><td className="px-4 py-2 text-right tabular-nums">{formatKES(Number(line.price || 0))}</td>
              <td className="px-4 py-2 capitalize">{String(t.payment_method || "").replace(/_/g, " ")}</td></tr>
          );
        })}</PagedRows></tbody>
      </table>
    </div>
  );
}

function StockHistory({ productId }: { productId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["item-history", productId],
    queryFn: async () => (await sb.from("stock_adjustments").select("id, created_at, quantity_change, stock_before, stock_after, reason").eq("product_id", productId).order("created_at", { ascending: false }).limit(300)).data || [],
  });
  if (isLoading) return <OrbLoader label="Loading history…" />;
  if (!data.length) return <EmptyState icon={Boxes} title="No stock movements yet" />;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground"><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Reason</th><th className="px-4 py-2 text-right">Change</th><th className="px-4 py-2 text-right">Stock after</th></tr></thead>
        <tbody><PagedRows rows={(data as any[])} colSpan={4}>{(pageRows) => pageRows.map((a) => (
          <tr key={a.id} className="border-t border-border"><td className="px-4 py-2">{fmtDate(a.created_at)}</td><td className="px-4 py-2 capitalize">{String(a.reason || "").replace(/_/g, " ")}</td>
            <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", Number(a.quantity_change) < 0 ? "text-destructive" : "text-success")}>{Number(a.quantity_change) > 0 ? "+" : ""}{Number(a.quantity_change)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{Number(a.stock_after)}</td></tr>
        ))}</PagedRows></tbody>
      </table>
    </div>
  );
}

/** Change many items at once. Empty fields are left as they are. */
function BulkEditItems({ items, onClose, onSave, onSavePrices }: { items: any[]; onClose: () => void; onSave: (patch: Record<string, unknown>) => void; onSavePrices: (fn: (p: number) => number) => void }) {
  const { data: cats = [] } = useCategories();
  const [f, setF] = useState({ category: "", unit: "", reorder_level: "", cost_price: "", vat_rate: "", priceMode: "keep", priceValue: "" });
  const save = () => {
    const patch: Record<string, unknown> = {};
    if (f.category) patch.category = f.category;
    if (f.unit.trim()) patch.unit = f.unit.trim();
    if (f.reorder_level !== "") patch.reorder_level = Math.max(0, Number(f.reorder_level) || 0);
    if (f.cost_price !== "") patch.cost_price = Math.max(0, Number(f.cost_price) || 0);
    if (f.vat_rate !== "") patch.vat_rate = Math.max(0, Number(f.vat_rate) || 0);
    const v = Number(f.priceValue);
    if (f.priceMode !== "keep" && f.priceValue !== "" && Number.isFinite(v)) {
      const fn = f.priceMode === "set" ? () => Math.max(0, v) : f.priceMode === "up" ? (p: number) => Math.round(p * (1 + v / 100)) : (p: number) => Math.max(0, Math.round(p * (1 - v / 100)));
      if (Object.keys(patch).length) onSave(patch);
      return onSavePrices(fn);
    }
    if (!Object.keys(patch).length) return onClose();
    onSave(patch);
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${items.length} item${items.length === 1 ? "" : "s"}`} icon={Pencil} description="Fill in only what should change. Everything left empty stays as it is."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}><Save /> Apply to all</Button></>}>
      <div className="space-y-3">
        <Field label="Category"><select className="fi" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Keep as is</option>{(cats as any[]).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></Field>
        <Field label="Selling price">
          <div className="flex gap-2">
            <select className="fi w-48" value={f.priceMode} onChange={(e) => setF({ ...f, priceMode: e.target.value })}>
              <option value="keep">Keep as is</option><option value="set">Set to (KES)</option><option value="up">Increase by %</option><option value="down">Decrease by %</option>
            </select>
            {f.priceMode !== "keep" && <input className="fi" type="number" min={0} step="any" value={f.priceValue} onChange={(e) => setF({ ...f, priceValue: e.target.value })} placeholder={f.priceMode === "set" ? "e.g. 1500" : "e.g. 10"} />}
          </div>
        </Field>
        <Field label="Cost price (KES)"><input className="fi" type="number" min={0} step="any" value={f.cost_price} onChange={(e) => setF({ ...f, cost_price: e.target.value })} placeholder="Keep as is" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder level"><input className="fi" type="number" min={0} value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: e.target.value })} placeholder="Keep" /></Field>
          <Field label="VAT %"><input className="fi" type="number" min={0} step="any" value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} placeholder="Keep" /></Field>
        </div>
        <Field label="Unit"><input className="fi" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="Keep as is (e.g. piece, kg, pack)" /></Field>
        <p className="text-xs text-muted-foreground">Services only take the category and price; stock fields apply to goods.</p>
      </div>
    </Modal>
  );
}
