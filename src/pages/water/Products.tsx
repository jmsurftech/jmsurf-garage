import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Plus, Pencil, Package, Milk, Wrench, ImagePlus, Trash2, Archive, RotateCcw, SlidersHorizontal, Tag, AlertTriangle, Box, Save } from "lucide-react";
import { PageHeader, Modal, Field, StatTile, StatGrid, PageLoader, EmptyState, Pill, Segmented, SearchBox, Toolbar } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useWaterTanks, type Tank } from "@/hooks/useWaterTanks";
import { formatKES, currencyCode } from "@/lib/format";
import { formatLitres } from "@/lib/businessType";
import { sizeCost, sizePrice } from "@/lib/waterMath";
import { cn } from "@/lib/utils";
import StockAdjustment from "@/components/StockAdjustment";
import { useServices, ServiceFormModal } from "@/pages/Services";

import { PagedRows } from "@/components/Pager";
const sb: any = supabase;
const num = (v: any) => Number(v) || 0;

export type ItemKind = "refill" | "container" | "item";
type Tab = ItemKind | "service";

const REFILL_PRESETS = [0.5, 1, 1.5, 5, 10, 18.9, 20];
const CONTAINER_TYPES = [
  { value: "Bottle", label: "Bottle" },
  { value: "Jerrican", label: "Jerrican" },
  { value: "Dispenser bottle", label: "Dispenser bottle" },
  { value: "Container", label: "Other container" },
];

export const kindOf = (p: any): ItemKind => (num(p.litres) > 0 ? "refill" : num(p.container_litres) > 0 ? "container" : "item");

/** Water shop catalogue: refill sizes, empty bottles / jerricans, other items and services. */
export default function WaterProducts() {
  const tenantId = useTenantId();
  const { role } = useAuth() as any;
  const canManage = ["admin", "manager", "super_admin", "stock_manager"].includes(role);
  const { data: tanks = [], isLoading: tanksLoading } = useWaterTanks();
  const { data: locations = [] } = useLocations();
  const mainLoc = (locations as any[]).find((l) => l.is_main) || (locations as any[])[0];
  const { data: services = [] } = useServices();
  const [tab, setTab] = useState<Tab>("refill");
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<{ kind: ItemKind; product?: any } | null>(null);
  const [svc, setSvc] = useState<{ service?: any } | null>(null);
  const [adjust, setAdjust] = useState<any | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["water-catalogue", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb.from("products").select("*").eq("tenant_id", tenantId).order("name").limit(2000);
      if (error) throw error;
      const ids = (data || []).map((p: any) => p.id);
      const stock: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data: rows } = await sb.from("product_stocks").select("product_id,stock").in("product_id", ids.slice(i, i + 200));
        (rows || []).forEach((r: any) => { stock[r.product_id] = (stock[r.product_id] || 0) + num(r.stock); });
      }
      return (data || []).map((p: any) => ({ ...p, total_stock: stock[p.id] ?? num(p.stock) }));
    },
  });

  const byKind = useMemo(() => {
    const out: Record<ItemKind, any[]> = { refill: [], container: [], item: [] };
    for (const p of products) {
      if (!showArchived && !p.is_active) continue;
      if (showArchived && p.is_active) continue;
      out[kindOf(p)].push(p);
    }
    out.refill.sort((a, b) => num(a.litres) - num(b.litres));
    out.container.sort((a, b) => num(a.container_litres) - num(b.container_litres));
    return out;
  }, [products, showArchived]);

  const s = q.trim().toLowerCase();
  const match = (p: any) => !s || [p.name, p.sku, p.category].some((x) => String(x || "").toLowerCase().includes(s));
  const lowContainers = byKind.container.filter((p) => p.total_stock <= num(p.reorder_level)).length;

  if (isLoading || tanksLoading) return <PageLoader label="Loading your catalogue…" />;

  const addLabel = tab === "refill" ? "Add refill size" : tab === "container" ? "Add bottle / jerrican" : tab === "item" ? "Add item" : "Add service";
  const onAdd = () => (tab === "service" ? setSvc({}) : setEdit({ kind: tab }));

  return (
    <div className="space-y-5">
      <PageHeader title="Refill sizes & items" icon={Package}
        description="Everything you sell: refill sizes that draw from your tanks, empty bottles and jerricans, other items and services."
        actions={canManage && <Button onClick={onAdd}><Plus /> {addLabel}</Button>} />

      <StatGrid className="lg:grid-cols-4">
        <StatTile label="Refill sizes" value={byKind.refill.length} hint={tanks.length ? `from ${tanks.length} tank${tanks.length === 1 ? "" : "s"}` : "add a tank first"} icon={Droplets} tone="info" />
        <StatTile label="Bottles & jerricans" value={byKind.container.length} hint={lowContainers ? `${lowContainers} running low` : "stock OK"} icon={Milk} tone={lowContainers ? "warning" : "primary"} />
        <StatTile label="Other items" value={byKind.item.length} icon={Box} tone="muted" />
        <StatTile label="Services" value={(services as any[]).length} icon={Wrench} tone="success" />
      </StatGrid>

      <Toolbar>
        <Segmented value={tab} onChange={(v) => setTab(v as Tab)} options={[
          { value: "refill", label: "Refill sizes", count: byKind.refill.length },
          { value: "container", label: "Bottles & jerricans", count: byKind.container.length },
          { value: "item", label: "Other items", count: byKind.item.length },
          { value: "service", label: "Services", count: (services as any[]).length },
        ]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search…" />
        {tab !== "service" && (
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
          </label>
        )}
      </Toolbar>

      {tab === "refill" && tanks.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>Refill sizes draw their water from a tank. Add your tank on the <b>Tanks</b> page first.</p>
        </div>
      )}

      {tab === "service" ? (
        <ServicesGrid services={(services as any[]).filter(match)} canManage={canManage} onEdit={(sv) => setSvc({ service: sv })} />
      ) : byKind[tab].filter(match).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50">
          <EmptyState icon={tab === "refill" ? Droplets : tab === "container" ? Milk : Box}
            title={showArchived ? "Nothing archived" : tab === "refill" ? "No refill sizes yet" : tab === "container" ? "No bottles or jerricans yet" : "No other items yet"}
            description={tab === "refill" ? "Add the sizes you fill: 500ml, 1L, 5L, 10L, 20L…" : tab === "container" ? "Sell empty bottles and jerricans, alone or with a refill. The till asks \"with bottle?\" when a matching size is sold." : "Dispensers, taps, caps, seals, ice… anything else you sell."}
            action={canManage && !showArchived ? <Button onClick={onAdd}><Plus /> {addLabel}</Button> : undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <PagedRows rows={byKind[tab].filter(match)} gridSpan>{(pageRows) => pageRows.map((p) => (
            <ItemCard key={p.id} p={p} tanks={tanks} containers={byKind.container} canManage={canManage}
              onEdit={() => setEdit({ kind: kindOf(p), product: p })}
              onAdjust={kindOf(p) !== "refill" ? () => setAdjust(p) : undefined} />
          ))}</PagedRows>
        </div>
      )}

      {edit && <WaterItemDialog kind={edit.kind} product={edit.product} tanks={tanks} mainLocationId={mainLoc?.id}
        onClose={() => setEdit(null)} />}
      {svc && <ServiceFormModal service={svc.service} onClose={() => setSvc(null)} />}
      {adjust && mainLoc && <StockAdjustment product={{ ...adjust, stock: adjust.total_stock }} locationId={mainLoc.id} onClose={() => setAdjust(null)} />}
    </div>
  );
}

function ItemCard({ p, tanks, containers, canManage, onEdit, onAdjust }: {
  p: any; tanks: Tank[]; containers: any[]; canManage: boolean; onEdit: () => void; onAdjust?: () => void;
}) {
  const kind = kindOf(p);
  const tank = tanks.find((t) => t.id === p.tank_id);
  const cost = kind === "refill" && tank ? sizeCost(num(p.litres), tank.cost_per_litre) : num(p.cost_price);
  const profit = num(p.price) - cost;
  const margin = num(p.price) > 0 ? Math.round((profit / num(p.price)) * 100) : 0;
  const stock = kind === "refill" && tank ? Math.floor(tank.current_l / num(p.litres) + 1e-9) : p.total_stock;
  const low = kind !== "refill" && stock <= num(p.reorder_level);
  const match = kind === "refill" ? containers.filter((c) => num(c.container_litres) === num(p.litres)) : [];
  const Icon = kind === "refill" ? Droplets : kind === "container" ? Milk : Box;
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border bg-card", p.is_active ? "border-border" : "border-dashed border-border opacity-70")}>
      <div className="relative h-28 bg-gradient-to-br from-sky-50 to-sky-100 sm:h-32 dark:from-sky-950/40 dark:to-sky-900/20">
        {p.image_url
          ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
          : <div className="flex h-full items-center justify-center"><Icon className="h-10 w-10 text-sky-500/60" /></div>}
        <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 font-display text-sm font-bold shadow-sm">
          {kind === "refill" ? formatLitres(num(p.litres)) : kind === "container" ? `holds ${formatLitres(num(p.container_litres))}` : p.category || "Item"}
        </span>
        {!p.is_active && <span className="absolute right-2 top-2"><Pill tone="muted">Archived</Pill></span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-semibold leading-snug">{p.name}</p>
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <span className="font-display text-xl font-bold text-primary">{formatKES(num(p.price))}</span>
          {kind === "refill" && (p.price_auto ? <Pill tone="info">Per litre</Pill> : <Pill tone="muted">Fixed price</Pill>)}
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-2 text-center text-xs">
          <div><p className="text-muted-foreground">Cost</p><p className="font-semibold tabular-nums">{formatKES(cost)}</p></div>
          <div><p className="text-muted-foreground">Profit</p><p className={cn("font-semibold tabular-nums", profit < 0 && "text-destructive")}>{formatKES(profit)}</p></div>
          <div><p className="text-muted-foreground">Margin</p><p className="font-semibold tabular-nums">{margin}%</p></div>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          {kind === "refill" ? (
            <>
              <p>Tank: <span className="font-medium text-foreground">{tank?.name || "none — pick a tank"}</span> · {stock.toLocaleString()} refills left</p>
              <p>{match.length ? `With ${match.map((c) => c.name).join(" / ")} at the till` : "No matching bottle — sold as refill only"}</p>
            </>
          ) : (
            <p className={cn(low && "font-medium text-warning")}>{low && <AlertTriangle className="mr-1 inline h-3 w-3" />}{stock.toLocaleString()} in stock · reorder at {num(p.reorder_level)}</p>
          )}
          {p.sku && <p>SKU {p.sku}</p>}
        </div>
        {canManage && (
          <div className="mt-auto flex gap-2 pt-2">
            <Button size="sm" variant="outline" className="flex-1 px-2" onClick={onEdit}><Pencil /> Edit</Button>
            {onAdjust && p.is_active && <Button size="sm" variant="outline" className="flex-1 px-2" onClick={onAdjust}><SlidersHorizontal /> Stock</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function ServicesGrid({ services, canManage, onEdit }: { services: any[]; canManage: boolean; onEdit: (s: any) => void }) {
  if (!services.length) return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50">
      <EmptyState icon={Wrench} title="No services yet" description="Delivery fee, tank cleaning, dispenser installation, bottle sanitising…" />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {services.map((s) => {
        const profit = num(s.price) - num(s.cost_price);
        return (
          <div key={s.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wrench className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.category}</p>
              </div>
              <span className="font-display text-xl font-bold text-primary">{formatKES(num(s.price))}</span>
            </div>
            {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
            <p className="text-xs text-muted-foreground">Cost {formatKES(num(s.cost_price))} · profit {formatKES(profit)}</p>
            {canManage && <Button size="sm" variant="outline" className="mt-auto" onClick={() => onEdit(s)}><Pencil /> Edit</Button>}
          </div>
        );
      })}
    </div>
  );
}

/** Add / edit a refill size, an empty container or another item: only the fields that kind needs. */
export function WaterItemDialog({ kind, product, tanks, mainLocationId, onClose }: {
  kind: ItemKind; product?: any; tanks: Tank[]; mainLocationId?: string; onClose: () => void;
}) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!product;
  const defTank = tanks.find((t) => t.is_default) || tanks[0];
  const [litres, setLitres] = useState(String(product?.litres ?? product?.container_litres ?? (kind === "item" ? "" : "20")));
  const [tankId, setTankId] = useState<string>(product?.tank_id || defTank?.id || "");
  const [auto, setAuto] = useState<boolean>(product?.price_auto ?? true);
  const [ctype, setCtype] = useState<string>(() => {
    const n = String(product?.name || "").toLowerCase();
    return CONTAINER_TYPES.find((c) => n.includes(c.value.toLowerCase()))?.value || (num(product?.container_litres || 20) >= 5 ? "Jerrican" : "Bottle");
  });
  const [name, setName] = useState<string>(product?.name || "");
  const [nameTouched, setNameTouched] = useState(isEdit);
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [cost, setCost] = useState(product ? String(product.cost_price ?? 0) : "");
  const [category, setCategory] = useState(product?.category || (kind === "refill" ? "Water" : kind === "container" ? "Containers" : "Accessories"));
  const [unit, setUnit] = useState(product?.unit || (kind === "refill" ? "refill" : "piece"));
  const [openingStock, setOpeningStock] = useState("0");
  const [reorder, setReorder] = useState(String(product?.reorder_level ?? (kind === "refill" ? 0 : 5)));
  const [sku, setSku] = useState(product?.sku || "");
  const [active, setActive] = useState<boolean>(product?.is_active ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(product?.image_url || null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const L = num(litres);
  const tank = tanks.find((t) => t.id === tankId);
  const autoPrice = kind === "refill" && auto && tank ? sizePrice(L, tank.price_per_litre) : null;
  const effPrice = autoPrice ?? num(price);
  const effCost = kind === "refill" && tank ? sizeCost(L, tank.cost_per_litre) : num(cost);
  const suggested = kind === "refill" ? `Water refill ${L > 0 ? formatLitres(L) : ""}`.trim()
    : kind === "container" ? `${L > 0 ? formatLitres(L) + " " : ""}${ctype.toLowerCase()} (empty)` : name;
  const finalName = nameTouched ? name : suggested;

  const pick = (f?: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast({ title: "Image too large", description: "Use a picture under 5 MB.", variant: "destructive" }); return; }
    setFile(f); setPreview(URL.createObjectURL(f)); setRemoveImage(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const id = product?.id || crypto.randomUUID();
      let image_url: string | null | undefined;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${tenantId}/${id}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw new Error(`Picture upload failed: ${error.message}`);
        image_url = `${supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      } else if (removeImage) image_url = null;

      const row: any = {
        name: finalName.trim(),
        sku: sku.trim() || `${kind === "refill" ? "WTR" : kind === "container" ? "CTN" : "ITM"}-${L > 0 ? formatLitres(L).toUpperCase() : ""}-${id.slice(0, 4).toUpperCase()}`.replace(/--/, "-"),
        category: category.trim() || "General",
        price: Math.round(effPrice * 100) / 100,
        cost_price: Math.round(effCost * 100) / 100,
        unit, vat_rate: product?.vat_rate ?? 0,
        reorder_level: kind === "refill" ? 0 : Math.max(0, Math.round(num(reorder))),
        product_type: "simple",
        is_active: active,
        litres: kind === "refill" ? L : null,
        tank_id: kind === "refill" ? tankId || null : null,
        price_auto: kind === "refill" ? auto : false,
        container_litres: kind === "container" ? L : null,
        ...(image_url !== undefined ? { image_url } : {}),
      };
      if (isEdit) {
        const { error } = await sb.from("products").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const start = kind === "refill" ? 0 : Math.max(0, Math.round(num(openingStock)));
        const { error } = await sb.from("products").insert({ ...row, id, tenant_id: tenantId, stock: start });
        if (error) throw error;
        if (kind !== "refill" && mainLocationId) {
          const { error: sErr } = await sb.from("product_stocks").upsert(
            [{ product_id: id, location_id: mainLocationId, stock: start, reorder_level: row.reorder_level }],
            { onConflict: "product_id,location_id" });
          if (sErr) throw sErr;
        }
      }
    },
    onSuccess: () => {
      ["water-catalogue", "products", "product-stocks", "water-sizes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ title: isEdit ? "Saved" : "Added", description: isEdit ? undefined : "It's on the till now." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message, variant: "destructive" }),
  });

  const bad = !finalName.trim() || (kind !== "item" && L <= 0) || (kind === "refill" && !tankId) || (autoPrice == null && price === "");
  const title = isEdit ? `Edit ${kind === "refill" ? "refill size" : kind === "container" ? "bottle / jerrican" : "item"}`
    : kind === "refill" ? "Add a refill size" : kind === "container" ? "Add a bottle or jerrican" : "Add an item";
  const cur = currencyCode();

  return (
    <Modal open onClose={onClose} locked={save.isPending} size="lg" icon={kind === "refill" ? Droplets : kind === "container" ? Milk : Box} title={title}
      description={kind === "refill" ? "Each refill sold takes its litres out of the tank." : kind === "container" ? "An empty container. Sold alone, or with a refill of the same size." : "Anything else you sell, counted in stock."}
      footer={<>
        {isEdit && (
          <Button variant="ghost" className="mr-auto" onClick={() => setActive(!active)}>
            {active ? <><Archive /> Archive</> : <><RotateCcw /> Restore</>}
          </Button>
        )}
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button disabled={bad || save.isPending} onClick={() => save.mutate()}><Save /> {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add"}</Button>
      </>}>
      <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="space-y-2">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/40 hover:border-primary/50">
            {preview && !removeImage
              ? <img src={preview} alt="" className="h-full w-full object-cover" />
              : <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><ImagePlus className="h-7 w-7" /> Add a picture</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          {preview && !removeImage && (
            <button type="button" className="inline-flex w-full items-center justify-center gap-1 text-xs text-destructive" onClick={() => { setRemoveImage(true); setFile(null); }}>
              <Trash2 className="h-3.5 w-3.5" /> Remove picture
            </button>
          )}
          {!active && <p className="rounded-lg bg-muted px-2 py-1.5 text-center text-xs">Archived: hidden from the till and online orders.</p>}
        </div>

        <div className="space-y-4">
          {kind === "container" && (
            <Field label="Type">
              <div className="flex flex-wrap gap-2">
                {CONTAINER_TYPES.map((c) => (
                  <button key={c.value} type="button" onClick={() => setCtype(c.value)}
                    className={cn("rounded-full border px-3 py-1.5 text-sm", ctype === c.value ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>{c.label}</button>
                ))}
              </div>
            </Field>
          )}
          {kind !== "item" && (
            <Field label={kind === "refill" ? "Size (litres of water)" : "Holds (litres)"} hint={kind === "container" ? "The till offers it with refills of this size." : undefined}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {REFILL_PRESETS.map((v) => (
                    <button key={v} type="button" onClick={() => setLitres(String(v))}
                      className={cn("rounded-lg border px-2.5 py-1 text-sm tabular-nums", L === v ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border hover:bg-muted")}>{formatLitres(v)}</button>
                  ))}
                </div>
                <input className="fi" type="number" min="0.05" step="0.05" inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} />
              </div>
            </Field>
          )}
          <Field label="Name" hint={!nameTouched && kind !== "item" ? "Filled in for you; type to change it." : undefined}>
            <input className="fi" value={finalName} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder={kind === "item" ? "e.g. Dispenser tap" : undefined} />
          </Field>

          {kind === "refill" && (
            <>
              <Field label="Draws from tank">
                <select className="fi" value={tankId} onChange={(e) => setTankId(e.target.value)}>
                  {!tanks.length && <option value="">Add a tank first</option>}
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.name} · {formatKES(t.price_per_litre)}/L</option>)}
                </select>
              </Field>
              <div className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex gap-2 text-sm">
                  <button type="button" className={cn("rounded-lg px-3 py-1.5", auto ? "bg-primary text-primary-foreground" : "bg-muted")} onClick={() => setAuto(true)}>Price per litre</button>
                  <button type="button" className={cn("rounded-lg px-3 py-1.5", !auto ? "bg-primary text-primary-foreground" : "bg-muted")} onClick={() => setAuto(false)}>Fixed price</button>
                </div>
                {auto ? (
                  <p className="text-sm">{tank ? <>{formatLitres(L || 0)} × {formatKES(tank.price_per_litre)}/L = <b>{formatKES(autoPrice || 0)}</b>. Changes when you change the tank's price.</> : "Choose a tank."}</p>
                ) : (
                  <Field label={`Selling price (${cur})`}><input className="fi" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
                )}
                {tank && <p className="text-xs text-muted-foreground">Cost {formatKES(effCost)} at the tank's buying price · profit {formatKES(effPrice - effCost)}</p>}
              </div>
            </>
          )}

          {kind !== "refill" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Selling price (${cur})`} required><input className="fi" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Field label={`Buying price (${cur})`} hint={num(price) > 0 ? `Profit ${formatKES(num(price) - num(cost))}` : undefined}>
                <input className="fi" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </Field>
              {!isEdit && (
                <Field label="Opening stock" hint="How many you have now"><input className="fi" type="number" min="0" step="1" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} /></Field>
              )}
              <Field label="Alert me at" hint="Low-stock level"><input className="fi" type="number" min="0" step="1" value={reorder} onChange={(e) => setReorder(e.target.value)} /></Field>
            </div>
          )}

          <details className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium"><Tag className="mr-1 inline h-3.5 w-3.5" /> More (category, unit, SKU)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Category"><input className="fi" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
              <Field label="Unit"><input className="fi" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
              <Field label="SKU" hint="Blank = automatic"><input className="fi" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
            </div>
          </details>
          {isEdit && kind !== "refill" && <p className="text-xs text-muted-foreground">Change stock with the <b>Stock</b> button on the card, so the change is recorded.</p>}
        </div>
      </div>
    </Modal>
  );
}
