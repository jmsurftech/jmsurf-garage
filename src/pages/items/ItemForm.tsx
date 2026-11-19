import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTaxSettings, vatChoices } from "@/lib/tax";
import { EtimsItemFields, etimsItemDefaults, type EtimsItem } from "@/components/books/EtimsItemFields";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";
import { erpApi } from "@/lib/erpApi";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CustomFieldInputs, missingCustomField, useCustomFields, type CustomValues } from "@/lib/customFields";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ImagePlus, Package, Wrench, Globe, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useLocations, useBusinessSettings } from "@/hooks/useData";
import { useCategories, useSubcategories, useUnits } from "@/hooks/useTaxonomy";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { OrbLoader, OrbSpinner } from "@/components/orbs";
import { cn } from "@/lib/utils";
import { useModules } from "@/hooks/useModules";

const sb: any = supabase;

function Row({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:items-start sm:gap-4">
      <label className={cn("pt-2 text-sm", required ? "font-medium text-destructive" : "text-foreground")}>{label}{required && "*"}</label>
      <div>{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
    </div>
  );
}

const empty = {
  name: "", sku: "", barcode: "", unit: "piece", category: "", subcategory: "", brand: "",
  price: "", vat_rate: "0", description: "", cost_price: "", supplier_id: "",
  track: true, stock: "0", reorder_level: "5", wholesale: false, wholesale_price: "", wholesale_min: "6",
  show_online: true, repurchase_days: "", duration_minutes: "", is_active: true,
  track_batches: false, track_serials: false,
  sales_on: true, purchase_on: true, purchase_description: "",
};

/** "New Item": goods (stocked products) or services, one form. */
export default function ItemForm() {
  const customFields = useCustomFields("item");
  const [custom, setCustom] = useState<CustomValues>({});
  const { has } = useModules();
  const shopOn = has("ecommerce");
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = useTenantId();
  const { data: biz } = useBusinessSettings();
  const { data: locations = [] } = useLocations();
  const { data: catRows = [] } = useCategories();
  const { data: subRows = [] } = useSubcategories();
  const { data: unitRows = [] } = useUnits();
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-lite", tenantId], enabled: !!tenantId,
    queryFn: async () => (await sb.from("suppliers").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name")).data || [],
  });

  const [kind, setKind] = useState<"product" | "service">(params.get("type") === "service" ? "service" : "product");
  // Services moved in from Zoho live with the items (marked as a service), others in the services list.
  const [svcInItems, setSvcInItems] = useState(false);
  const [f, setF] = useState({ ...empty });
  const [existing, setExisting] = useState<any>(null);
  // KRA eTIMS details (as Zoho keeps them on each item).
  const [kra, setKra] = useState<EtimsItem>(() => etimsItemDefaults(null, "piece"));
  const { settings: erpSet } = useErpSettings();
  const etimsOn = !!(erpSet as any)?.etims?.initialised_at;
  const etimsEnv = (erpSet as any)?.etims?.env === "sbx" ? "sbx" : "prod";
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const set = (patch: Partial<typeof empty>) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => { if (!id && biz) set({ vat_rate: String(Number(biz.default_vat_rate ?? 16)) }); }, [biz, id]);

  useEffect(() => {
    // Editing loads the item; Clone (?clone=) starts a new item from another one.
    const cloneId = id ? null : params.get("clone");
    const srcId = id || cloneId;
    if (!srcId) return;
    (async () => {
      const table = params.get("type") === "service" ? "services" : "products";
      let { data } = await sb.from(table).select("*").eq("id", srcId).maybeSingle();
      let k: "product" | "service" = table === "services" ? "service" : "product";
      if (!data && table === "products") { ({ data } = await sb.from("services").select("*").eq("id", srcId).maybeSingle()); k = "service"; }
      setLoading(false);
      if (!data) { toast({ title: "Item not found", variant: "destructive" }); return navigate("/inventory/products"); }
      if (k === "product" && data.product_type === "service") { k = "service"; setSvcInItems(true); }
      setKind(k);
      if (cloneId) data = { ...data, name: `${data.name || ""} (Copy)`, sku: "", barcode: "" };
      else setExisting(data);
      setPreview(data.image_url || null);
      setKra(etimsItemDefaults(k === "service" ? { ...data, product_type: "service" } : data, data.unit));
      setCustom(data.custom || {});
      setF({
        ...empty, name: data.name || "", sku: data.sku || "", barcode: data.barcode || "", unit: data.unit || "piece",
        category: data.category || "", subcategory: data.subcategory || "", brand: data.brand || "",
        price: String(data.price ?? ""), vat_rate: String(Number(data.vat_rate || 0)), description: data.description || "",
        cost_price: String(data.cost_price ?? ""), reorder_level: String(data.reorder_level ?? 5), supplier_id: data.preferred_supplier_id || "",
        wholesale: !!data.enable_wholesale, wholesale_price: data.wholesale_price ? String(data.wholesale_price) : "", wholesale_min: String(data.wholesale_min_quantity || 6),
        show_online: data.show_online !== false, repurchase_days: data.repurchase_days ? String(data.repurchase_days) : "",
        duration_minutes: data.duration_minutes ? String(data.duration_minutes) : "", is_active: data.is_active !== false,
        track_batches: !!data.track_batches, track_serials: !!data.track_serials,
        sales_on: data.sales_enabled !== false, purchase_on: data.purchase_enabled !== false, purchase_description: data.purchase_description || "",
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const subs = useMemo(() => (subRows as any[]).filter((s) => s.parent_name === f.category || (catRows as any[]).find((c) => c.id === s.category_id)?.name === f.category), [subRows, catRows, f.category]);
  const taxSet = useTaxSettings();
  const vatOptions = [...vatChoices(taxSet).map((o) => o.v), ...(Number(f.vat_rate) > 0 ? [Number(f.vat_rate)] : [])].filter((v, i, a) => a.indexOf(v) === i);

  const uploadImage = async (itemId: string): Promise<string | null> => {
    if (!image) return null;
    const ext = (image.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${tenantId}/${itemId}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, image, { upsert: true, contentType: image.type });
    if (error) { toast({ title: "Image not uploaded", description: error.message, variant: "destructive" }); return null; }
    return `${supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  };

  const save = async () => {
    if (!f.name.trim()) return toast({ title: "Enter the item name", variant: "destructive" });
    if (!f.sales_on && !f.purchase_on) return toast({ title: "Keep sales or purchase information on", description: "An item is sold, bought, or both.", variant: "destructive" });
    if (f.sales_on && (!(Number(f.price) >= 0) || f.price === "")) return toast({ title: "Enter the selling price", variant: "destructive" });
    if (kind === "product" && !f.category) return toast({ title: "Choose a category", variant: "destructive" });
    if (etimsOn && !kra.etims_item_cls_cd) return toast({ title: "Choose the KRA item classification", description: "KRA needs it for every item you sell.", variant: "destructive" });
    const missing = missingCustomField(customFields, custom);
    if (missing) return toast({ title: `Fill in ${missing}`, variant: "destructive" });
    setSaving(true);
    try {
      const itemId = existing?.id || crypto.randomUUID();
      const img = await uploadImage(itemId);
      const common = {
        custom, name: f.name.trim(), price: f.sales_on ? Number(f.price) : Number(f.price || 0), cost_price: f.purchase_on ? Number(f.cost_price || 0) : 0, vat_rate: Number(f.vat_rate || 0),
        sales_enabled: f.sales_on, purchase_enabled: f.purchase_on, purchase_description: f.purchase_on ? f.purchase_description.trim() || null : null,
        category: f.category || null, description: f.description.trim() || null, is_active: f.is_active, show_online: f.show_online,
        repurchase_days: f.repurchase_days ? Math.max(1, parseInt(f.repurchase_days)) : null, ...(img ? { image_url: img } : {}),
      };
      if (kind === "service" && svcInItems) {
        const { error } = await sb.from("products").update({ ...common, product_type: "service", etims_item_cls_cd: kra.etims_item_cls_cd || null, etims_tax_type: kra.etims_tax_type || null, etims_item_type: "3" }).eq("id", itemId);
        if (error) throw error;
      } else if (kind === "service") {
        const payload = { ...common, duration_minutes: f.duration_minutes ? parseInt(f.duration_minutes) : null, etims_item_cls_cd: kra.etims_item_cls_cd || null, etims_tax_type: kra.etims_tax_type || null };
        const q = existing ? sb.from("services").update(payload).eq("id", itemId) : sb.from("services").insert({ ...payload, id: itemId, tenant_id: tenantId });
        const { error } = await q;
        if (error) throw error;
      } else {
        const sku = f.sku.trim() || existing?.sku || `FT-${Date.now().toString(36).toUpperCase()}`;
        const payload: Record<string, unknown> = {
          ...common, sku, barcode: f.barcode.trim() || null, unit: f.unit || "piece", subcategory: f.subcategory || "", brand: f.brand.trim() || null,
          reorder_level: parseInt(f.reorder_level) || 0, enable_wholesale: f.wholesale,
          wholesale_price: f.wholesale && f.wholesale_price ? Number(f.wholesale_price) : null, wholesale_min_quantity: Math.max(1, parseInt(f.wholesale_min) || 1),
          product_type: existing?.product_type || "simple", preferred_supplier_id: f.supplier_id || null,
          track_batches: f.track && f.track_batches, track_serials: f.track && f.track_serials,
          etims_item_cls_cd: kra.etims_item_cls_cd || null, etims_tax_type: kra.etims_tax_type || null, etims_item_type: kra.etims_item_type || null,
          etims_pkg_unit: kra.etims_pkg_unit || null, etims_qty_unit: kra.etims_qty_unit || null, etims_origin: kra.etims_origin || null,
        };
        if (existing) {
          const { error } = await sb.from("products").update(payload).eq("id", itemId);
          if (error) throw error;
        } else {
          const stock = f.track ? Math.max(0, Number(f.stock) || 0) : 0;
          const { error } = await sb.from("products").insert({ ...payload, id: itemId, tenant_id: tenantId, stock });
          if (error) throw error;
          const locs = (locations as any[]).filter((l) => l.is_active !== false);
          if (locs.length) {
            // Opening stock goes to the main branch; the other branches start at zero.
            const main = locs.find((l) => l.is_main) || locs[0];
            const rows = locs.map((l) => ({ product_id: itemId, location_id: l.id, stock: l.id === main.id ? stock : 0, reorder_level: parseInt(f.reorder_level) || 0 }));
            const { error: sErr } = await sb.from("product_stocks").upsert(rows, { onConflict: "product_id,location_id" });
            if (sErr) throw sErr;
          }
        }
      }
      qc.invalidateQueries({ queryKey: ["zitems"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stocks"] });
      qc.invalidateQueries({ queryKey: ["services"] });
      toast({ title: `${f.name.trim()} ${existing ? "updated" : "added"}` });
      // Connected to KRA: the item goes to KRA straight away (saved either way; a failure shows on the item).
      if (etimsOn) {
        try {
          const r: any = await erpApi("etims/register-items", { ids: [itemId] });
          if (r?.failed?.length) toast({ title: "Saved, but KRA did not accept the item", description: String(r.failed[0]).replace(/^[^:]*: /, ""), variant: "destructive" });
          else toast({ title: "Registered with KRA", description: r?.codes?.[itemId] ? `KRA item code ${r.codes[itemId]}` : undefined });
        } catch (e: any) { toast({ title: "Saved, but not sent to KRA", description: e.message, variant: "destructive" }); }
      }
      navigate(`/inventory/products/${itemId}`);
    } catch (e: any) {
      toast({ title: "Item not saved", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <OrbLoader label="Loading item…" />;

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        {kind === "service" ? <Wrench className="h-5 w-5 text-primary" /> : <Package className="h-5 w-5 text-primary" />}
        <h1 className="flex-1 font-display text-xl font-bold">{existing ? `Edit ${existing.name}` : "New Item"}</h1>
        <Button size="icon" variant="ghost" onClick={() => navigate(existing ? `/inventory/products/${existing.id}` : "/inventory/products")} aria-label="Close"><X /></Button>
      </div>

      <div className="flex-1 space-y-8 bg-card px-4 py-6 sm:px-6">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4">
            <Row label="Type">
              <div className="flex gap-4 pt-2 text-sm">
                {(["product", "service"] as const).map((k) => (
                  <label key={k} className={cn("flex items-center gap-2", existing && "opacity-60")}>
                    <input type="radio" name="kind" checked={kind === k} disabled={!!existing} onChange={() => setKind(k)} className="accent-[hsl(var(--primary))]" />
                    {k === "product" ? "Goods" : "Service"}
                  </label>
                ))}
              </div>
            </Row>
            <Row label="Name" required><input className="fi" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!existing} /></Row>
            {kind === "product" && (
              <>
                <Row label="SKU" hint="Leave empty to create one automatically"><input className="fi" value={f.sku} onChange={(e) => set({ sku: e.target.value })} /></Row>
                <Row label="Barcode"><input className="fi" value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="Scan or type" /></Row>
                <Row label="Unit">
                  <select className="fi" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>
                    {(unitRows as any[]).length ? (unitRows as any[]).map((u) => <option key={u.id} value={u.name}>{u.name}</option>) : <option>piece</option>}
                  </select>
                </Row>
              </>
            )}
            <Row label="Category" required={kind === "product"}>
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="fi" value={f.category} onChange={(e) => set({ category: e.target.value, subcategory: "" })}>
                  <option value="">Select a category</option>
                  {(catRows as any[]).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                {kind === "product" && (
                  <select className="fi" value={f.subcategory} onChange={(e) => set({ subcategory: e.target.value })} disabled={!subs.length}>
                    <option value="">{subs.length ? "Subcategory (optional)" : "No subcategories"}</option>
                    {subs.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                )}
              </div>
            </Row>
            {kind === "product" && <Row label="Brand"><input className="fi" value={f.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="e.g. Royal Canin" /></Row>}
            {kind === "service" && <Row label="Duration (minutes)"><input className="fi w-40" type="number" min={0} value={f.duration_minutes} onChange={(e) => set({ duration_minutes: e.target.value })} /></Row>}
          </div>

          <div>
            <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary">
              {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <><ImagePlus className="h-8 w-8" /> Drag image or browse</>}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setImage(file); setPreview(URL.createObjectURL(file)); } }} />
            </label>
            {shopOn && <p className="mt-2 text-center text-xs text-muted-foreground">More photos, specs and volume prices are on the item's Online Shop tab.</p>}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <EtimsItemFields value={kind === "service" ? { ...kra, etims_item_type: "3" } : kra} onChange={(v) => setKra(kind === "service" ? { ...v, etims_item_type: "3" } : v)} vatRate={f.vat_rate} connected={etimsOn}
            env={etimsEnv} service={kind === "service"} kraCode={existing?.etims_item_cd} kraError={existing?.etims_error} />
        </div>

        <div className="grid gap-6 border-t border-border pt-6 lg:grid-cols-2">
          <section className="space-y-4">
            <label className="flex items-center gap-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.sales_on} onChange={(e) => set({ sales_on: e.target.checked })} /><h2 className="font-display text-base font-bold">Sales Information</h2></label>
            {!f.sales_on && <p className="text-sm text-muted-foreground">Not sold: this item is left out of quotes, invoices and the till.</p>}
            {f.sales_on && <>
            <Row label="Selling Price" required>
              <div className="flex"><span className="flex items-center rounded-l-xl border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">KES</span><input className="fi rounded-l-none" type="number" min={0} step="any" value={f.price} onChange={(e) => set({ price: e.target.value })} /></div>
            </Row>
            <Row label="Description"><textarea className="fi" rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Row>
            <Row label="Tax">
              <select className="fi" value={f.vat_rate} onChange={(e) => set({ vat_rate: e.target.value })}>
                {vatOptions.map((v) => <option key={v} value={v}>{v ? `VAT [${v}%]` : "Non-taxable (0%)"}</option>)}
              </select>
            </Row>
            {kind === "product" && (
              <Row label="Wholesale">
                <label className="flex items-center gap-2 pt-2 text-sm"><Switch checked={f.wholesale} onCheckedChange={(v) => set({ wholesale: v })} /> Sell at a wholesale price too</label>
                {f.wholesale && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input className="fi" type="number" min={0} step="any" placeholder="Wholesale price" value={f.wholesale_price} onChange={(e) => set({ wholesale_price: e.target.value })} />
                    <input className="fi" type="number" min={1} placeholder="From quantity" value={f.wholesale_min} onChange={(e) => set({ wholesale_min: e.target.value })} />
                  </div>
                )}
              </Row>
            )}
            </>}
          </section>
          <section className="space-y-4">
            <label className="flex items-center gap-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.purchase_on} onChange={(e) => set({ purchase_on: e.target.checked })} /><h2 className="font-display text-base font-bold">Purchase Information</h2></label>
            {!f.purchase_on && <p className="text-sm text-muted-foreground">Not bought: this item is left out of purchase orders and bills.</p>}
            {f.purchase_on && <>
            <Row label="Cost Price">
              <div className="flex"><span className="flex items-center rounded-l-xl border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">KES</span><input className="fi rounded-l-none" type="number" min={0} step="any" value={f.cost_price} onChange={(e) => set({ cost_price: e.target.value })} /></div>
            </Row>
            <Row label="Preferred Vendor">
              <select className="fi" value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}>
                <option value="">Select a supplier</option>
                {(suppliers as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Row>
            <Row label="Description"><textarea className="fi" rows={3} value={f.purchase_description} onChange={(e) => set({ purchase_description: e.target.value })} placeholder="Shown on purchase orders and bills" /></Row>
            </>}
          </section>
        </div>

        <CustomFieldInputs entity="item" values={custom} onChange={setCustom} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" />

        {kind === "product" && (
          <section className="space-y-4 border-t border-border pt-6">
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={f.track} onChange={(e) => set({ track: e.target.checked })} disabled={!!existing} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Track Inventory for this item</label>
            {f.track && (
              <div className="grid gap-4 lg:grid-cols-2">
                {!existing ? (
                  <Row label="Opening Stock" hint="Goes to the main branch. Other branches start at zero.">
                    <input className="fi" type="number" min={0} step="any" value={f.stock} onChange={(e) => set({ stock: e.target.value })} />
                  </Row>
                ) : (
                  <Row label="Stock on hand" hint="Change it with a stock-take or transfer.">
                    <p className="pt-2 text-sm font-semibold">{Number(existing.stock || 0)} {existing.unit || ""}</p>
                  </Row>
                )}
                <Row label="Reorder Point"><input className="fi" type="number" min={0} value={f.reorder_level} onChange={(e) => set({ reorder_level: e.target.value })} /></Row>
                <Row label="Track batches" hint="Asked for when receiving and selling.">
                  <label className="flex items-center gap-2 pt-2 text-sm"><Switch checked={f.track_batches} onCheckedChange={(v) => set({ track_batches: v })} /> Batches and expiry dates</label>
                </Row>
                <Row label="Track serial numbers" hint="One serial number per unit.">
                  <label className="flex items-center gap-2 pt-2 text-sm"><Switch checked={f.track_serials} onCheckedChange={(v) => set({ track_serials: v })} /> Serial numbers</label>
                </Row>
              </div>
            )}
          </section>
        )}

        <section className="grid gap-4 border-t border-border pt-6 lg:grid-cols-2">
          {shopOn && <label className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm">
            <span className="flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> Show on the online shop</span>
            <Switch checked={f.show_online} onCheckedChange={(v) => set({ show_online: v })} />
          </label>}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border p-4 text-sm">
            <Bell className="h-4 w-4 text-primary" /> Repurchase reminder after
            <input className="fi h-9 w-20" type="number" min={1} value={f.repurchase_days} onChange={(e) => set({ repurchase_days: e.target.value })} placeholder="—" /> days
          </div>
          {existing && (
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm lg:col-span-2">
              <span>Active (inactive items are hidden from the till and the company)</span>
              <Switch checked={f.is_active} onCheckedChange={(v) => set({ is_active: v })} />
            </label>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6">
        <Button onClick={save} disabled={saving}>{saving && <OrbSpinner state="working" />} Save</Button>
        <Button variant="outline" onClick={() => navigate(existing ? `/inventory/products/${existing.id}` : "/inventory/products")} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
