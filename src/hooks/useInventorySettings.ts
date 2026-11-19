import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useBusinessType } from "@/hooks/useBusinessType";
import { LIQUOR_CATEGORIES, type BusinessType } from "@/lib/businessType";

const DEFAULT_CATEGORIES = [
  "Beverages", "Dairy", "Bakery", "Meat & Poultry", "Fruits & Vegetables",
  "Cereals & Grains", "Snacks", "Cleaning", "Personal Care", "Electronics",
  "Stationery", "Other",
];
const DEFAULT_UNITS = ["piece", "kg", "litre", "pack", "box", "crate", "dozen"];

/** Starting categories and units that fit each kind of shop. */
const TYPE_DEFAULTS: Record<BusinessType, { categories: string[]; units: string[]; unit: string; vat: number }> = {
  general: { categories: DEFAULT_CATEGORIES, units: DEFAULT_UNITS, unit: "piece", vat: 16 },
  liquor: { categories: [...LIQUOR_CATEGORIES, "Other"], units: ["bottle", "can", "crate", "tot", "pack", "piece"], unit: "bottle", vat: 16 },
  clothing: {
    categories: ["Shirts & Tops", "Trousers & Shorts", "Dresses & Skirts", "School Uniform", "Sweaters & Jackets", "Shoes", "Bags & Accessories", "Other"],
    units: ["piece", "pair", "set", "dozen"], unit: "piece", vat: 16,
  },
  water: {
    categories: ["Water Refill", "Bottles & Containers", "Dispensers & Accessories", "Other"],
    units: ["refill", "bottle", "piece", "litre"], unit: "refill", vat: 0,
  },
};

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

export interface InventorySettings {
  id?: string;
  sku_prefix: string;
  categories: string[];
  subcategories: string[];
  units: string[];
  default_price: number;
  default_cost_price: number;
  default_stock: number;
  default_reorder_level: number;
  default_vat_rate: number;
  default_unit: string;
}

const DEFAULTS: InventorySettings = {
  sku_prefix: "",
  categories: DEFAULT_CATEGORIES,
  subcategories: [],
  units: DEFAULT_UNITS,
  default_price: 0,
  default_cost_price: 0,
  default_stock: 0,
  default_reorder_level: 5,
  default_vat_rate: 16,
  default_unit: "piece",
};

export function useInventorySettings() {
  const tenantId = useTenantId();
  const { businessType, ready } = useBusinessType();
  const typed = TYPE_DEFAULTS[businessType] || TYPE_DEFAULTS.general;
  return useQuery({
    queryKey: ["inventory-settings", tenantId, businessType],
    enabled: !!tenantId && ready,
    queryFn: async () => {
      const sb: any = supabase;
      const { data, error } = await sb
        .from("inventory_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const base = { ...DEFAULTS, categories: typed.categories, units: typed.units, default_unit: typed.unit, default_vat_rate: typed.vat };
      if (!data) return base;
      // Shops still on the untouched grocery list get their own type's list.
      const savedCats = Array.isArray(data.categories) && !(businessType !== "general" && sameList(data.categories, DEFAULT_CATEGORIES))
        ? data.categories : typed.categories;
      const savedUnits = Array.isArray(data.units) && !(businessType !== "general" && sameList(data.units, DEFAULT_UNITS))
        ? data.units : typed.units;
      return {
        id: data.id,
        sku_prefix: data.sku_prefix || "",
        categories: savedCats,
        subcategories: Array.isArray(data.subcategories) ? data.subcategories : [],
        units: savedUnits,
        default_price: Number(data.default_price) || 0,
        default_cost_price: Number(data.default_cost_price) || 0,
        default_stock: data.default_stock ?? 0,
        default_reorder_level: data.default_reorder_level ?? 5,
        default_vat_rate: Number(data.default_vat_rate) || 0,
        default_unit: data.default_unit || "piece",
      } as InventorySettings;
    },
  });
}
