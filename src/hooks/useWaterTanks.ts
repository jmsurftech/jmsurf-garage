import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export interface Tank {
  id: string;
  name: string;
  location_id: string | null;
  notes?: string | null;
  capacity_l: number;
  current_l: number;
  alert_level_l: number;
  cost_per_litre: number;
  price_per_litre: number;
  is_default: boolean;
  is_active: boolean;
}

const num = (v: any) => Number(v) || 0;

/** The shop's active water tanks, kept live. `enabled` is false for non-water shops. */
export function useWaterTanks(enabled = true) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const on = enabled && !!tenantId;
  useEffect(() => {
    if (!on) return;
    const ch = supabase.channel(`water-tanks-${tenantId}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "water_tanks", filter: `tenant_id=eq.${tenantId}` },
        () => qc.invalidateQueries({ queryKey: ["water-tanks", tenantId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, tenantId, qc]);
  return useQuery({
    queryKey: ["water-tanks", tenantId],
    enabled: on,
    queryFn: async (): Promise<Tank[]> => {
      const { data, error } = await (supabase as any).from("water_tanks").select("*").eq("tenant_id", tenantId)
        .eq("is_active", true).order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return (data || []).map((t: any) => ({
        ...t, capacity_l: num(t.capacity_l), current_l: num(t.current_l), alert_level_l: num(t.alert_level_l),
        cost_per_litre: num(t.cost_per_litre), price_per_litre: num(t.price_per_litre),
      }));
    },
  });
}
