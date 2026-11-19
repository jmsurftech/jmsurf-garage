import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import type { BusinessType } from "@/lib/businessType";

/**
 * Resolves the active tenant's shop type (general | liquor | clothing).
 * Defaults to "general" while loading or when unknown so nothing breaks.
 */
export function useBusinessType(): { businessType: BusinessType; isLoading: boolean; ready: boolean } {
  const tenantId = useTenantId();
  const cacheKey = tenantId ? `business-type:${tenantId}` : null;
  const cached = (() => {
    try { return cacheKey ? (localStorage.getItem(cacheKey) as BusinessType | null) || undefined : undefined; } catch { return undefined; }
  })();

  const { data, isLoading } = useQuery({
    queryKey: ["business-type", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    initialData: cached,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("tenants")
        .select("business_type")
        .eq("id", tenantId)
        .maybeSingle();
      const type = (data?.business_type as BusinessType) || "general";
      try { if (cacheKey) localStorage.setItem(cacheKey, type); } catch { /* storage unavailable */ }
      return type;
    },
  });

  return { businessType: data || "general", isLoading, ready: !!data };
}
