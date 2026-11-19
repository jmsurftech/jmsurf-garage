import { currencyCode } from "@/lib/format";
import { useState, useRef, useMemo, useEffect } from "react";
import { X, Save, Upload, ImageIcon, Check, ChevronsUpDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { offlineMutate } from "@/lib/offlineMutate";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { useAuth } from "@/hooks/useAuth";
import { useTenantId } from "@/hooks/useTenantId";
import { useVatEnabled } from "@/hooks/useVatEnabled";
import { useLocations } from "@/hooks/useData";
import { useCategories, useSubcategories, useUnits } from "@/hooks/useTaxonomy";
import { logActivity } from "@/lib/auditLog";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Database } from "@/integrations/supabase/types";
import { useBusinessType } from "@/hooks/useBusinessType";
import { useWaterTanks } from "@/hooks/useWaterTanks";
import { sizePrice } from "@/lib/waterMath";
import { BOTTLE_SIZES, PRODUCT_TYPE_LABELS, type ProductType } from "@/lib/businessType";
import VariantEditor, { type VariantDraft } from "@/components/VariantEditor";
import { EtimsItemFields, etimsItemDefaults, type EtimsItem } from "@/components/books/EtimsItemFields";
import { erpApi } from "@/lib/erpApi";
import { useErpSettings } from "@/pages/settings/ErpSettingsTabs";

type DbProduct = Database["public"]["Tables"]["products"]["Row"];

interface Props {
  product?: DbProduct | null;
  /** Currently active location in the page (used as default when adding) */
  locationId: string;
  onClose: () => void;
  /** When true, render as a full page (no modal backdrop). */
  fullPage?: boolean;
}

export default function ProductForm({ product, locationId, onClose, fullPage = false }: Props) {
  const isEdit = !!product;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const tenantId = useTenantId();
  const { data: invSettings } = useInventorySettings();
  const { vatEnabled } = useVatEnabled();
  const { data: locations = [] } = useLocations();
  // Only active locations are eligible for stocking new products. This makes
  // "All Locations" mode reliably load every store the tenant currently uses.
  const eligibleLocationIds = useMemo(
    () => locations.filter((l: any) => l.is_active !== false).map((location: any) => location.id),
    [locations],
  );

  const { data: catRows = [] } = useCategories();
  const { data: subRows = [] } = useSubcategories();
  const { data: unitRows = [] } = useUnits();

  // Merge tenant-managed taxonomy (product_categories/subcategories/units)
  // with legacy inventory_settings entries so newly added items show up here.
  // Order: tenant taxonomy (already sorted by sort_order, name) first, then legacy.
  const dedupePreserveOrder = (arr: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of arr) {
      const key = (v || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };

  const categories = useMemo(() => {
    const fromTable = catRows.map((c: any) => c.name).filter(Boolean);
    const legacy = ((invSettings?.categories as any[]) || []).filter(Boolean);
    const merged = dedupePreserveOrder([...fromTable, ...legacy]);
    return merged.length ? merged : ["Other"];
  }, [catRows, invSettings?.categories]);

  const subcategories = useMemo(() => {
    const fromTable = subRows.map((s: any) => ({
      name: s.name,
      parent: s.parent_name || (catRows.find((c: any) => c.id === s.category_id)?.name ?? ""),
    }));
    const legacy = ((invSettings?.subcategories as any[]) || []).map((sc: any) =>
      typeof sc === "string" ? { name: sc, parent: "" } : { name: sc?.name, parent: sc?.parent || "" }
    );
    // De-dup by parent|name, preserving order
    const seen = new Set<string>();
    const out: { name: string; parent: string }[] = [];
    for (const sc of [...fromTable, ...legacy]) {
      if (!sc?.name) continue;
      const k = `${sc.parent || ""}|${sc.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: sc.name, parent: sc.parent || "" });
    }
    return out;
  }, [subRows, catRows, invSettings?.subcategories]);

  const units = useMemo(() => {
    const fromTable = unitRows.map((u: any) => u.name).filter(Boolean);
    const legacy = ((invSettings?.units as any[]) || []).filter(Boolean);
    const merged = dedupePreserveOrder([...fromTable, ...legacy]);
    return merged.length ? merged : ["piece"];
  }, [unitRows, invSettings?.units]);

  // Pull existing units already used per-category by this tenant — used to gate
  // the unit dropdown so a unit can't be assigned to a category it doesn't belong to.
  // If no products exist yet for a category, every tenant unit is allowed.
  const { data: productsForUnitMap = [] } = useQuery({
    queryKey: ["products-unit-map", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("category, unit")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []) as { category: string; unit: string }[];
    },
  });

  const unitsByCategory = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of productsForUnitMap) {
      if (!p?.category || !p?.unit) continue;
      if (!map.has(p.category)) map.set(p.category, new Set());
      map.get(p.category)!.add(p.unit);
    }
    return map;
  }, [productsForUnitMap]);

  const [catOpen, setCatOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [form, setForm] = useState({
    name: product?.name || "",
    barcode: (product as any)?.barcode || "",
    category: product?.category || categories[0] || "",
    subcategory: (product as any)?.subcategory || "",
    price: product ? String(product.price) : (invSettings?.default_price ? String(invSettings.default_price) : ""),
    enable_wholesale: String((product as any)?.enable_wholesale ?? false),
    wholesale_price: product ? String((product as any)?.wholesale_price ?? "") : "",
    wholesale_min_quantity: product ? String((product as any)?.wholesale_min_quantity ?? 1) : "1",
    cost_price: product ? String(product.cost_price) : (invSettings?.default_cost_price ? String(invSettings.default_cost_price) : ""),
    stock: product ? String(product.stock) : String(invSettings?.default_stock ?? 0),
    reorder_level: product ? String(product.reorder_level) : String(invSettings?.default_reorder_level ?? 5),
    vat_rate: product ? String(product.vat_rate) : String(invSettings?.default_vat_rate ?? 16),
    unit: product?.unit || invSettings?.default_unit || "piece",
    expiry_date: "",      // optional — creates a product_batches row when set
    batch_number: "",     // optional
    // Clothing / liquor extras
    product_type: ((product as any)?.product_type as ProductType) || "simple",
    brand: (product as any)?.brand || "",
    bottle_size: (product as any)?.bottle_size || "",
    tot_price: (product as any)?.tot_price != null ? String((product as any).tot_price) : "",
    tots_per_bottle: (product as any)?.tots_per_bottle != null ? String((product as any).tots_per_bottle) : "",
    units_per_crate: (product as any)?.units_per_crate != null ? String((product as any).units_per_crate) : "",
    crate_deposit: (product as any)?.crate_deposit != null ? String((product as any).crate_deposit) : "",
    school: (product as any)?.school || "",
  });
  const [branchStockLoading, setBranchStockLoading] = useState(Boolean(product && locationId && locationId !== "__all__"));
  const [branchStockOriginal, setBranchStockOriginal] = useState<number | null>(null);

  useEffect(() => {
    if (!product?.id || !locationId || locationId === "__all__") return;
    let active = true;
    setBranchStockLoading(true);
    void supabase.from("product_stocks" as any).select("location_id,stock").eq("product_id", product.id)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast({ title: "Could not load branch stock", description: error.message, variant: "destructive" });
          return;
        }
        const rows = (data || []) as any[];
        const branch = rows.find((row) => row.location_id === locationId);
        const value = Number(branch?.stock ?? (rows.length ? 0 : product?.stock ?? 0));
        setBranchStockOriginal(value);
        setForm((current) => ({ ...current, stock: String(value) }));
        setBranchStockLoading(false);
      });
    return () => { active = false; };
  }, [product?.id, locationId]);

  const { businessType } = useBusinessType();
  const isClothing = businessType === "clothing";
  const isLiquor = businessType === "liquor";
  const isWater = businessType === "water";
  // Water refill sizes: litres per refill and the tank they draw from.
  const { data: waterTanks = [] } = useWaterTanks(isWater);
  const [waterLitres, setWaterLitres] = useState<string>((product as any)?.litres != null ? String((product as any).litres) : "");
  const [waterTank, setWaterTank] = useState<string>((product as any)?.tank_id || "");
  const [waterAuto, setWaterAuto] = useState<boolean>((product as any)?.price_auto ?? true);
  const waterTankRow = waterTanks.find((t) => t.id === (waterTank || waterTanks.find((x) => x.is_default)?.id));
  const usesVariants =
    isClothing && (form.product_type === "sized" || form.product_type === "sized_color");
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  // KRA eTIMS details (as Zoho keeps them): class, tax type, product type, packaging and quantity units, origin.
  const [kra, setKra] = useState<EtimsItem>(() => etimsItemDefaults(product, product?.unit));
  const { settings: erpSet } = useErpSettings();
  const etimsOn = !!(erpSet as any)?.etims?.initialised_at;

  // Load existing variants when editing a clothing product
  useEffect(() => {
    if (!isEdit || !product?.id || !isClothing) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("product_variants")
        .select("*")
        .eq("product_id", product.id)
        .eq("is_active", true);
      if (data?.length) {
        setVariants(
          data.map((v: any) => ({
            id: v.id,
            size: v.size || "",
            color: v.color || "",
            price: String(v.price ?? ""),
            cost_price: String(v.cost_price ?? ""),
            stock: String(v.stock ?? 0),
            reorder_level: String(v.reorder_level ?? 2),
          })),
        );
      }
    })();
  }, [isEdit, product?.id, isClothing]);


  // Multi-location selection (only relevant when adding new products).
  // If the page is in "All Locations" mode, default to every eligible active store location.
  const defaultSelected = useMemo(() => {
    if (locationId && locationId !== "__all__") return new Set<string>([locationId]);
    return new Set<string>(eligibleLocationIds);
  }, [eligibleLocationIds, locationId]);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(defaultSelected);
  const [allLocations, setAllLocations] = useState(locationId === "__all__");

  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_url || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSubcategories = useMemo(
    () =>
      subcategories.filter((sc) => {
        if (sc.parent) return sc.parent === form.category;
        return true; // Legacy entries without a parent are shown for any category
      }),
    [subcategories, form.category]
  );

  // Units allowed for the selected category. If the category has never been used yet
  // by any existing product, every tenant unit is allowed; otherwise, only units
  // already linked to that category may be assigned.
  const allowedUnits = useMemo(() => {
    const used = unitsByCategory.get(form.category);
    if (!used || used.size === 0) return units;
    // Always allow the product's currently saved unit (so editing doesn't break)
    const set = new Set(used);
    if (product?.unit) set.add(product.unit);
    // Intersect with the tenant's known units to drop stale values
    return units.filter((u) => set.has(u));
  }, [unitsByCategory, units, form.category, product?.unit]);

  // Auto-correct unit when category changes and current unit is no longer allowed
  useEffect(() => {
    if (allowedUnits.length === 0) return;
    if (!allowedUnits.includes(form.unit)) {
      setForm((prev) => ({ ...prev, unit: allowedUnits[0] }));
    }
  }, [allowedUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear subcategory if it no longer belongs to the selected category
  useEffect(() => {
    if (!form.subcategory) return;
    const stillValid = filteredSubcategories.some((sc) => sc.name === form.subcategory);
    if (!stillValid) setForm((prev) => ({ ...prev, subcategory: "" }));
  }, [filteredSubcategories]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLocation = (id: string) => {
    setAllLocations(false);
    setSelectedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const next = !allLocations;
    setAllLocations(next);
    if (next) setSelectedLocations(new Set(eligibleLocationIds));
    else setSelectedLocations(new Set(locationId && locationId !== "__all__" ? [locationId] : []));
  };

  // When "All Locations" mode is active and locations finish loading, preselect all
  useEffect(() => {
    if (allLocations && eligibleLocationIds.length > 0) {
      setSelectedLocations((prev) => prev.size === eligibleLocationIds.length ? prev : new Set(eligibleLocationIds));
    }
  }, [allLocations, eligibleLocationIds]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (productId: string): Promise<string | null> => {
    if (!imageFile) return null;
    const ext = (imageFile.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${profile?.tenant_id || tenantId || "default"}/${productId}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, imageFile, { upsert: true, contentType: imageFile.type });
    if (error) { console.error("Image upload error:", error); toast({ title: "Image upload failed", description: error.message, variant: "destructive" }); return null; }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    // Cache-bust so the freshly-uploaded file appears immediately even if a stale CDN entry exists.
    return `${urlData.publicUrl}?v=${Date.now()}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (etimsOn && !kra.etims_item_cls_cd) {
      toast({ title: "Choose the KRA item classification", description: "KRA needs it for every item you sell.", variant: "destructive" });
      return;
    }
    if (!isEdit && !tenantId) {
      toast({ title: "Workspace not ready", description: "Please refresh and try again.", variant: "destructive" });
      return;
    }

    // ── Taxonomy preflight ──────────────────────────────────────────────
    // Block save if the chosen category / subcategory / unit aren't part
    // of this tenant's taxonomy. Prevents orphaned references.
    if (!form.category || !categories.includes(form.category)) {
      toast({
        title: "Invalid category",
        description: "Pick a category from the list. Manage categories under Inventory → Categories.",
        variant: "destructive",
      });
      return;
    }
    if (form.subcategory) {
      const subOk = filteredSubcategories.some((sc) => sc.name === form.subcategory);
      if (!subOk) {
        toast({
          title: "Invalid subcategory",
          description: `"${form.subcategory}" is not a subcategory of "${form.category}". Pick another or leave it empty.`,
          variant: "destructive",
        });
        return;
      }
    }
    if (!form.unit || !units.includes(form.unit)) {
      toast({
        title: "Invalid unit",
        description: "Pick a unit of measure from the list. Manage units under Inventory → Units.",
        variant: "destructive",
      });
      return;
    }
    if (!allowedUnits.includes(form.unit)) {
      toast({
        title: "Unit doesn't match category",
        description: `"${form.unit}" isn't used by any product in "${form.category}". Pick a unit already used by this category, or add a new product elsewhere first.`,
        variant: "destructive",
      });
      return;
    }

    // Determine target locations for new products.
    // When "All Locations" is on, derive directly from the loaded locations list
    // so race conditions (toggle clicked before locations finished loading) can't
    // leave selectedLocations empty.
    const targetLocationIds = isEdit
      ? [locationId].filter((v) => v && v !== "__all__")
      : (allLocations
          ? eligibleLocationIds
          : Array.from(selectedLocations));

    if (!isEdit && targetLocationIds.length === 0) {
      toast({
        title: locations.length === 0 ? "No locations found" : "Select at least one location",
        description: locations.length === 0
          ? "Add a location in System → Business settings → Locations first."
          : "Choose where this product will be available, or click 'Select all locations'.",
        variant: "destructive",
      });
      return;
    }

    // Batch number can only be saved when an expiry date is set (applies to both create and edit)
    if (form.batch_number && !form.expiry_date) {
      toast({
        title: "Expiry date required",
        description: "A batch number can only be recorded together with an expiry date.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    // SKU is auto-generated and hidden from the UI. Keep existing on edit, otherwise generate.
    const skuValue = (product as any)?.sku || `${(invSettings?.sku_prefix || "PRD").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const stock = isEdit && locationId === "__all__" ? Number(product?.stock ?? 0) : Number(form.stock);
    if (!Number.isFinite(stock) || stock < 0) {
      toast({ title: "Invalid stock", description: "Enter a valid non-negative stock quantity.", variant: "destructive" });
      return;
    }
    const reorder = parseInt(form.reorder_level) || 0;

    // Pre-allocate id so we can upload the image BEFORE inserting and include image_url in the payload.
    let productId = product?.id || crypto.randomUUID();

    // Upload image up-front (online only). If it fails, save still proceeds without an image.
    let uploadedImageUrl: string | null = null;
    if (imageFile && navigator.onLine) {
      uploadedImageUrl = await uploadImage(productId);
    }

    const payload: any = {
      name: form.name, sku: skuValue, barcode: form.barcode || null,
      category: form.category,
      subcategory: form.subcategory || "",
      price: parseFloat(form.price), cost_price: parseFloat(form.cost_price),
      enable_wholesale: form.enable_wholesale === "true",
      wholesale_price: form.enable_wholesale === "true" && form.wholesale_price ? parseFloat(form.wholesale_price) : null,
      wholesale_min_quantity: Math.max(1, parseInt(form.wholesale_min_quantity) || 1),
      ...(!isEdit ? { stock } : {}), reorder_level: reorder,
      vat_rate: vatEnabled ? parseFloat(form.vat_rate) : 0, unit: form.unit,
      etims_item_cls_cd: kra.etims_item_cls_cd || null, etims_tax_type: kra.etims_tax_type || null, etims_item_type: kra.etims_item_type || null,
      etims_pkg_unit: kra.etims_pkg_unit || null, etims_qty_unit: kra.etims_qty_unit || null, etims_origin: kra.etims_origin || null,
      ...(uploadedImageUrl ? { image_url: uploadedImageUrl } : {}),
      product_type: form.product_type,
      brand: form.brand || null,
      school: form.school || null,
      bottle_size: isLiquor ? form.bottle_size || null : null,
      tot_price: isLiquor && form.tot_price ? parseFloat(form.tot_price) : null,
      tots_per_bottle: isLiquor && form.tots_per_bottle ? parseInt(form.tots_per_bottle) : null,
      units_per_crate: isLiquor && form.units_per_crate ? parseInt(form.units_per_crate) : null,
      crate_deposit: isLiquor && form.crate_deposit ? parseFloat(form.crate_deposit) : 0,
      ...(isWater ? {
        litres: parseFloat(waterLitres) > 0 ? parseFloat(waterLitres) : null,
        tank_id: parseFloat(waterLitres) > 0 ? (waterTankRow?.id ?? null) : null,
        price_auto: waterAuto,
        ...(parseFloat(waterLitres) > 0 && waterAuto && waterTankRow ? { price: sizePrice(parseFloat(waterLitres), waterTankRow.price_per_litre) } : {}),
      } : {}),
      ...(isEdit ? {} : { tenant_id: tenantId, id: productId }),
    };

    let error: any;
    let wasOffline = false;
    try {
      if (isEdit && productId) {
        const res = await offlineMutate({
          table: "products", action: "update",
          payload: { id: productId, ...payload }, cacheStore: "products",
        });
        wasOffline = res.offline;
      } else if (!navigator.onLine) {
        await offlineMutate({
          table: "products", action: "insert",
          payload, cacheStore: "products",
        });
        wasOffline = true;
      } else {
        const { error: insertError } = await (supabase as any).from("products").insert(payload);
        error = insertError;
      }
    } catch (e: any) { error = e; }


    // Create / update product_stocks for each target location
    if (!error && productId) {
      if (isEdit && targetLocationIds.length > 0 && branchStockOriginal !== null && stock !== branchStockOriginal) {
        if (!navigator.onLine) {
          error = new Error("Connect to the internet before changing branch stock.");
        } else {
          const result = await (supabase as any).rpc("set_product_stock", {
            p_product_id: productId,
            p_location_id: targetLocationIds[0],
            p_expected: branchStockOriginal,
            p_new: stock,
          });
          if (result.error) error = result.error;
        }
      } else if (!isEdit && targetLocationIds.length > 0 && !(isWater && parseFloat(waterLitres) > 0)) {
        // (Refill sizes get their stock from their tank, set by the database.)
        const rows = targetLocationIds.map((locId) => ({
          product_id: productId,
          location_id: locId,
          stock,
          reorder_level: reorder,
        }));
        if (navigator.onLine) {
          const { error: stockErr } = await supabase
            .from("product_stocks" as any)
            .upsert(rows, { onConflict: "product_id,location_id" });
          if (stockErr) error = stockErr;
        } else {
          // Queue each stock row as upsert
          for (const r of rows) {
            await offlineMutate({
              table: "product_stocks", action: "upsert",
              payload: { id: crypto.randomUUID(), ...r }, cacheStore: "product_stocks",
            });
          }
        }
      }

      // Optional expiry → create a product_batches row at each target location.
      // - On create: one batch row per target location.
      // - On edit: a single batch row at the active location (when an expiry date is set).
      // Batch number is only persisted when an expiry date is also provided (validated above).
      if (form.expiry_date && tenantId && navigator.onLine) {
        const batchTargets = isEdit
          ? (locationId && locationId !== "__all__" ? [locationId] : [])
          : targetLocationIds;
        const batchRows = batchTargets.map((locId) => ({
          tenant_id: tenantId,
          product_id: productId!,
          location_id: locId,
          batch_number: form.batch_number || null,
          expiry_date: form.expiry_date,
          quantity: stock,
        }));
        if (batchRows.length > 0) {
          const { error: batchErr } = await (supabase as any)
            .from("product_batches")
            .insert(batchRows);
          if (batchErr) console.warn("Batch insert failed:", batchErr.message);
        }
      }

      // Clothing variants: each size/colour row is its own sellable line.
      if (usesVariants && tenantId && navigator.onLine) {
        const rowsToSave = variants
          .filter((v) => v.size || v.color)
          .map((v) => ({
            ...(v.id ? { id: v.id } : { id: crypto.randomUUID() }),
            tenant_id: tenantId,
            product_id: productId!,
            size: v.size || null,
            color: v.color || null,
            price: parseFloat(v.price) || parseFloat(form.price) || 0,
            cost_price: parseFloat(v.cost_price) || parseFloat(form.cost_price) || 0,
            stock: parseInt(v.stock) || 0,
            reorder_level: parseInt(v.reorder_level) || 0,
            is_active: true,
          }));
        if (rowsToSave.length > 0) {
          const { error: varErr } = await (supabase as any)
            .from("product_variants")
            .upsert(rowsToSave, { onConflict: "id" });
          if (varErr) error = varErr;
        }
        // Deactivate variants the user removed
        const keptIds = rowsToSave.map((r: any) => r.id);
        if (isEdit && keptIds.length > 0) {
          await (supabase as any)
            .from("product_variants")
            .update({ is_active: false })
            .eq("product_id", productId)
            .not("id", "in", `(${keptIds.join(",")})`);
        }
      }
    }

    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-stocks"] });
    queryClient.invalidateQueries({ queryKey: ["product-variants"] });
    logActivity({
      action: isEdit ? "update" : "create",
      entity_type: "product",
      entity_id: productId,
      description: `${isEdit ? "Updated" : "Created"} product "${form.name}"`,
    });
    toast({
      title: wasOffline
        ? (isEdit ? "Product updated (offline — will sync)" : "Product added (offline — will sync)")
        : (isEdit ? "Product updated" : "Product added"),
      description: !isEdit && targetLocationIds.length > 1 ? `Added to ${targetLocationIds.length} locations` : undefined,
    });
    // Connected to KRA: the product goes to KRA straight away.
    if (etimsOn && !wasOffline) {
      try {
        const r: any = await erpApi("etims/register-items", { ids: [productId] });
        if (r?.failed?.length) toast({ title: "Saved, but KRA did not accept the product", description: String(r.failed[0]).replace(/^[^:]*: /, ""), variant: "destructive" });
        else toast({ title: "Registered with KRA", description: r?.codes?.[productId] ? `KRA item code ${r.codes[productId]}` : undefined });
      } catch (err: any) { toast({ title: "Saved, but not sent to KRA", description: err.message, variant: "destructive" }); }
    }
    onClose();
  };

  const set = (key: string, val: string) => setForm((prev) => ({ ...prev, [key]: val }));

  const wrapperClass = fullPage
    ? "min-h-[calc(100vh-4rem)] bg-background"
    : "fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4";
  const cardClass = fullPage
    ? "bg-card rounded-2xl w-full max-w-3xl mx-auto p-6 my-6 border border-border"
    : "bg-card rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto";

  return (
    <div className={wrapperClass} onClick={fullPage ? undefined : onClose}>
      <div className={cardClass} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-lg sm:text-xl font-bold">{isEdit ? "Edit Product" : "Add Product"}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Image Upload */}
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Product Image (optional)</label>
              <div className="flex items-center gap-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-input bg-muted flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors overflow-hidden"
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    {imagePreview ? "Change Image" : "Upload Image"}
                  </button>
                  {imagePreview && (
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); }} className="text-xs text-destructive mt-1 hover:underline">Remove</button>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">JPG, PNG. Max 5MB</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              </div>
            </div>

            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Product Name</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)} className="fi" />
            </div>

            {isWater && (
              <div className="col-span-2 grid gap-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Refill size (litres)</label>
                  <input type="number" min="0" step="0.001" value={waterLitres} onChange={(e) => setWaterLitres(e.target.value)} placeholder="e.g. 20" className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Draws from tank</label>
                  <select value={waterTankRow?.id || ""} onChange={(e) => setWaterTank(e.target.value)} className="fi" disabled={!waterTanks.length}>
                    {!waterTanks.length && <option value="">Add a tank first</option>}
                    {waterTanks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={waterAuto} onChange={(e) => setWaterAuto(e.target.checked)} />
                  Price from the tank's price per litre{waterAuto && waterTankRow && parseFloat(waterLitres) > 0 ? ` (${sizePrice(parseFloat(waterLitres), waterTankRow.price_per_litre)})` : ""}
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-3">Leave the size empty for things that are not water (bottles, dispensers…). Refill sizes have no stock of their own: each sale takes its litres from the tank.</p>
              </div>
            )}

            {isClothing && (
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">How is this item sold?</label>
                <select
                  value={form.product_type}
                  onChange={(e) => set("product_type", e.target.value)}
                  className="fi"
                >
                  {(["simple", "sized", "sized_color", "standard"] as ProductType[]).map((t) => (
                    <option key={t} value={t}>{PRODUCT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            )}

            {isClothing && (
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">School / Brand <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input value={form.school} onChange={(e) => set("school", e.target.value)} placeholder="e.g. Alliance High School" className="fi" />
              </div>
            )}

            {isLiquor && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Brand</label>
                  <input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Tusker" className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Bottle size</label>
                  <select value={form.bottle_size} onChange={(e) => set("bottle_size", e.target.value)} className="fi">
                    <option value="">Not applicable</option>
                    {BOTTLE_SIZES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Price per tot <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input type="number" step="0.01" min="0" value={form.tot_price} onChange={(e) => set("tot_price", e.target.value)} placeholder="e.g. 150" className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Tots per bottle</label>
                  <input type="number" min="0" value={form.tots_per_bottle} onChange={(e) => set("tots_per_bottle", e.target.value)} placeholder="e.g. 25" className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Bottles per crate</label>
                  <input type="number" min="0" value={form.units_per_crate} onChange={(e) => set("units_per_crate", e.target.value)} placeholder="e.g. 25" className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Crate / empties deposit</label>
                  <input type="number" step="0.01" min="0" value={form.crate_deposit} onChange={(e) => set("crate_deposit", e.target.value)} placeholder="e.g. 800" className="fi" />
                </div>
              </>
            )}

            {!isClothing && (
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Barcode <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="Scan or type barcode" className="fi" />
            </div>
            )}
            {/* Category + Subcategory side-by-side */}
            <div>
              <label className="text-sm font-medium mb-1 block">Category</label>
              <Popover open={catOpen} onOpenChange={setCatOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 rounded-lg bg-muted border border-input text-sm flex items-center justify-between gap-2"
                  >
                    <span className={cn(!form.category && "text-muted-foreground")}>
                      {form.category || "Select category…"}
                    </span>
                    <ChevronsUpDown className="w-4 h-4 opacity-60 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                  <Command>
                    <CommandInput placeholder="Search categories…" />
                    <CommandList>
                      <CommandEmpty>No categories found.</CommandEmpty>
                      <CommandGroup>
                        {categories.map((c) => (
                          <CommandItem key={c} value={c} onSelect={(v) => { set("category", v); setCatOpen(false); }}>
                            <Check className={cn("mr-2 h-4 w-4", form.category === c ? "opacity-100" : "opacity-0")} />
                            {c}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {!isClothing && (
            <div>
              <label className="text-sm font-medium mb-1 block">Subcategory <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Popover open={subOpen} onOpenChange={setSubOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 rounded-lg bg-muted border border-input text-sm flex items-center justify-between gap-2"
                  >
                    <span className={cn(!form.subcategory && "text-muted-foreground")}>
                      {form.subcategory || "None"}
                    </span>
                    <ChevronsUpDown className="w-4 h-4 opacity-60 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                  <Command>
                    <CommandInput placeholder="Search subcategories…" />
                    <CommandList>
                      <CommandEmpty>No subcategories for this category.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__none__" onSelect={() => { set("subcategory", ""); setSubOpen(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", !form.subcategory ? "opacity-100" : "opacity-0")} />
                          None
                        </CommandItem>
                        {filteredSubcategories.map((sc) => (
                          <CommandItem key={sc.name} value={sc.name} onSelect={(v) => { set("subcategory", v); setSubOpen(false); }}>
                            <Check className={cn("mr-2 h-4 w-4", form.subcategory === sc.name ? "opacity-100" : "opacity-0")} />
                            {sc.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            )}

            {!isClothing && (
            <div className="col-span-2 -mt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-input rounded-md px-2.5 py-1.5">
                <span className="font-medium text-foreground">{form.category || "—"}</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                <span className={cn(form.subcategory ? "text-foreground" : "italic")}>
                  {form.subcategory || "no subcategory"}
                </span>
              </div>
            </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">{usesVariants ? `Default Selling Price (${currencyCode()})` : `Selling Price (${currencyCode()})`}</label>
              <input required type="number" step="0.01" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} className="fi" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Buying Price ({currencyCode()})</label>
              <input required type="number" step="0.01" min="0" value={form.cost_price} onChange={(e) => set("cost_price", e.target.value)} className="fi" />
            </div>
            {!isClothing && (
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enable_wholesale === "true"} onChange={(e) => set("enable_wholesale", String(e.target.checked))} />
              Sell this product at wholesale price too
            </label>
            )}
            {form.enable_wholesale === "true" && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Wholesale Price ({currencyCode()})</label>
                  <input required type="number" step="0.01" min="0" value={form.wholesale_price} onChange={(e) => set("wholesale_price", e.target.value)} className="fi" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Wholesale Min Qty</label>
                  <input required type="number" min="1" value={form.wholesale_min_quantity} onChange={(e) => set("wholesale_min_quantity", e.target.value)} className="fi" />
                </div>
              </>
            )}
            {!usesVariants && (
            <div>
              <label className="text-sm font-medium mb-1 block">Starting Stock</label>
              <input required type="number" min="0" step="0.001" disabled={branchStockLoading || (isEdit && locationId === "__all__")} value={form.stock} onChange={(e) => set("stock", e.target.value)} className="fi" />
              <p className="text-[10px] text-muted-foreground mt-1">{isEdit && locationId === "__all__" ? "Select a branch to change stock" : isEdit ? "For this location" : "Same starting stock applied to each selected location"}</p>
            </div>
            )}
            {!usesVariants && (
            <div>
              <label className="text-sm font-medium mb-1 block">Reorder Level</label>
              <input required type="number" min="0" value={form.reorder_level} onChange={(e) => set("reorder_level", e.target.value)} className="fi" />
            </div>
            )}
            {vatEnabled && (
              <div>
                <label className="text-sm font-medium mb-1 block">VAT Rate (%)</label>
                <select value={form.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} className="fi">
                  <option value="16">16% - Standard</option>
                  <option value="8">8% - Reduced</option>
                  <option value="0">0% - Zero Rated</option>
                </select>
              </div>
            )}
            {!isClothing && (
            <div>
              <label className="text-sm font-medium mb-1 block">Unit</label>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} className="fi">
                {allowedUnits.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              {unitsByCategory.get(form.category)?.size ? (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Restricted to units already used in "{form.category}".
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  No products in "{form.category}" yet — any tenant unit is allowed.
                </p>
              )}
            </div>
            )}

            {/* Optional batch / expiry — creates a product_batches row when set.
                On edit, leave both blank to keep existing batches untouched; fill both to record a new batch. */}
            {!isClothing && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {isEdit ? "Add Expiry Date" : "Expiry Date"}{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => {
                    const v = e.target.value;
                    set("expiry_date", v);
                    if (!v) set("batch_number", ""); // batch only valid with expiry
                  }}
                  className="fi"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {isEdit
                    ? "Adds a new batch entry for this product. Existing batches are not changed."
                    : "If set, a batch is recorded for expiry tracking."}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {isEdit ? "Add Batch Number" : "Batch Number"}{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.batch_number}
                  onChange={(e) => set("batch_number", e.target.value)}
                  placeholder={form.expiry_date ? "e.g. LOT-2026-001" : "Set expiry date first"}
                  className="fi"
                  disabled={!form.expiry_date}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {form.expiry_date
                    ? "Linked to the expiry date above."
                    : "A batch number can only be saved together with an expiry date."}
                </p>
              </div>
            </>
            )}

            {usesVariants && (
              <VariantEditor
                variants={variants}
                onChange={setVariants}
                defaultPrice={form.price}
                defaultCost={form.cost_price}
              />
            )}

            {/* Locations selector — only shown when adding a new product */}
            {!isEdit && (
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Available at locations</label>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className={cn(
                      "text-xs font-semibold px-2.5 py-1 rounded-md border transition-colors",
                      allLocations
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-foreground border-input hover:bg-accent"
                    )}
                  >
                    {allLocations ? "All locations selected" : "Select all locations"}
                  </button>
                </div>
                <div className="border border-input rounded-lg p-2 max-h-40 overflow-y-auto bg-muted/30">
                  {locations.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2">No locations yet. Add one in System → Business settings → Locations.</p>
                  )}
                  {locations.map((loc) => {
                    const checked = selectedLocations.has(loc.id);
                    return (
                      <label
                        key={loc.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm hover:bg-accent",
                          checked && "bg-primary/10"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLocation(loc.id)}
                          className="rounded border-input"
                        />
                        <span className="flex-1">{loc.name}{loc.code ? <span className="text-muted-foreground"> · {loc.code}</span> : null}</span>
                        {checked && <Check className="w-3.5 h-3.5 text-primary" />}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Product will only be visible at the selected locations. Choose "Select all locations" to make it available everywhere.
                </p>
              </div>
            )}
          </div>
          <EtimsItemFields value={kra} onChange={setKra} vatRate={vatEnabled ? form.vat_rate : 0} connected={etimsOn}
            env={(erpSet as any)?.etims?.env === "sbx" ? "sbx" : "prod"} kraCode={(product as any)?.etims_item_cd} kraError={(product as any)?.etims_error} />
          <button type="submit" disabled={saving || branchStockLoading} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2">
            <Save className="w-4 h-4" /> {saving ? "Saving..." : isEdit ? "Update Product" : "Add Product"}
          </button>
        </form>
      </div>
    </div>
  );
}
