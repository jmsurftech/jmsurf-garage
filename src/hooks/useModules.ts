import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { fetchBusinessSettings } from "@/hooks/useData";
import { MODULES, suiteOf } from "@/lib/modules";

export interface ActiveModule {
  module_key: string;
  /** included | bundle | trial | active | past_due | comped */
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  price_monthly: number;
}

const INCLUDED = MODULES.filter((m) => m.included).map((m) => m.key);

/**
 * The modules this company can use right now (JMSURF BOOKS is always on).
 * Switching a module on or off anywhere updates every open screen.
 */
export function useModules() {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["my-modules", tenantId],
    enabled: !!tenantId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ActiveModule[]> => {
      const { data, error } = await (supabase as any).rpc("my_modules");
      if (error) throw error;
      return (data || []) as ActiveModule[];
    },
  });

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`tenant-modules-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_modules", filter: `tenant_id=eq.${tenantId}` },
        () => void qc.invalidateQueries({ queryKey: ["my-modules", tenantId] }))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenantId, qc]);

  // Modules the company hid from the menu (still on and paid): System → Modules → Hide / Show.
  const hiddenQ = useQuery({
    queryKey: ["modules-hidden", tenantId],
    enabled: !!tenantId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // The same read as the company settings: opened together they share one request.
      const data: any = await qc.fetchQuery({ queryKey: ["business-settings", tenantId], queryFn: () => fetchBusinessSettings(tenantId), staleTime: 0 });
      return { modules: (Array.isArray(data?.modules_hidden) ? data.modules_hidden : []) as string[], menu: (Array.isArray(data?.menu_hidden) ? data.menu_hidden : []) as string[] };
    },
  });
  const hidden = useMemo(() => new Set(hiddenQ.data?.modules || []), [hiddenQ.data]);
  const menuHidden = useMemo(() => new Set(hiddenQ.data?.menu || []), [hiddenQ.data]);

  const active = useMemo(() => {
    const set = new Set<string>(INCLUDED);
    (query.data || []).forEach((m) => set.add(m.module_key));
    return set;
  }, [query.data]);

  return {
    modules: query.data || [],
    /** True when the module may be used (always true for JMSURF BOOKS parts). */
    has: (key?: string | null) => !key || active.has(suiteOf(key)),
    active,
    /** On and paid for (a trial does not count). */
    paid: (key?: string | null) => !key || INCLUDED.includes(suiteOf(key)) || (query.data || []).some((m) => m.module_key === suiteOf(key) && m.status !== "trial"),
    /** Hidden from the menu by the company (the module stays on). */
    hidden,
    /** Menu items the company hid (System → Menu items). */
    menuHidden,
    /** On and shown in the menu. */
    inMenu: (key?: string | null) => !key || (active.has(suiteOf(key)) && !hidden.has(suiteOf(key))),
    ready: !tenantId || query.isFetched,
    refetch: query.refetch,
  };
}
