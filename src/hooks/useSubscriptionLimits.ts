import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

/**
 * Returns the active plan caps (max users, max locations) for the current tenant
 * along with current usage counts so callers can block adds beyond the limit.
 *
 * Uses useTenantId so super-admin viewing a slug-scoped workspace gets caps for
 * that tenant rather than for their own (none) account.
 */
export function useSubscriptionLimits() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenantId) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["subscription-limits", tenantId], refetchType: "active" });
    };
    const channel = supabase
      .channel(`subscription-limits-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `tenant_id=eq.${tenantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `tenant_id=eq.${tenantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "locations", filter: `tenant_id=eq.${tenantId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenantId, queryClient]);

  const { data, refetch } = useQuery({
    queryKey: ["subscription-limits", tenantId],
    enabled: !!tenantId,
    // Live updates refresh this when the subscription or branches change.
    staleTime: 60_000,
    refetchOnReconnect: "always",
    queryFn: async () => {
      const sb: any = supabase;
      const [users, locs, sub] = await Promise.all([
        sb.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        sb.from("locations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
        // Always pull the freshest subscription for THIS tenant — works for both
        // tenant admins and super-admin acting via slug.
        sb.from("subscriptions").select("max_users, max_locations").eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        usedUsers: users.count || 0,
        usedLocations: locs.count || 0,
        maxUsers: sub?.data?.max_users ?? 2,
        maxLocations: sub?.data?.max_locations ?? 1,
      };
    },
  });

  // Caps come from the shop's current package. Anything at or above the
  // "unlimited" sentinel (999999) is treated as no limit at all.
  const rawUsers = Number(data?.maxUsers ?? 2);
  const rawLocations = Number(data?.maxLocations ?? 1);
  const maxUsers = rawUsers >= 999999 ? Infinity : rawUsers;
  const maxLocations = rawLocations >= 999999 ? Infinity : rawLocations;
  const usedUsers = data?.usedUsers ?? 0;
  const usedLocations = data?.usedLocations ?? 0;

  return {
    usedUsers,
    usedLocations,
    maxUsers,
    maxLocations,
    canAddUser: usedUsers < maxUsers,
    canAddLocation: usedLocations < maxLocations,
    refetch,
  };
}

