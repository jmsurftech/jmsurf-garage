import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export interface ProductVariant {
  id: string;
  tenant_id: string;
  product_id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost_price: number;
  stock: number;
  reorder_level: number;
  is_active: boolean;
}

/** All variants for the tenant (optionally a single product). */
export function useProductVariants(productId?: string) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["product-variants", tenantId, productId || "all"],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("product_variants")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("size", { ascending: true });
      if (productId) q = q.eq("product_id", productId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ProductVariant[];
    },
  });
}

/** Map of product_id -> variants, handy for pickers and grids. */
export function useVariantsByProduct() {
  const { data = [], ...rest } = useProductVariants();
  const map: Record<string, ProductVariant[]> = {};
  data.forEach((v) => {
    (map[v.product_id] ||= []).push(v);
  });
  return { map, variants: data, ...rest };
}

export function useInvalidateVariants() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["product-variants"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-stocks"] });
  };
}
