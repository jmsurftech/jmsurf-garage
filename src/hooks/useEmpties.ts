import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";
import { useAuth } from "@/hooks/useAuth";

export type ContainerKind = "bottle" | "crate";
export type EmptyDirection = "in" | "out";

export interface EmptyEntry {
  id: string;
  tenant_id: string;
  location_id: string | null;
  product_id: string | null;
  item_label: string;
  container_kind: ContainerKind;
  direction: EmptyDirection;
  quantity: number;
  deposit_per_unit: number;
  deposit_total: number;
  customer_id: string | null;
  customer_name: string | null;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

const sb: any = supabase;

export function useEmpties() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["empties", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("empties_ledger")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as EmptyEntry[];
    },
  });
}

export interface NewEmptyEntry {
  product_id: string | null;
  item_label: string;
  container_kind: ContainerKind;
  direction: EmptyDirection;
  quantity: number;
  deposit_per_unit: number;
  customer_name?: string | null;
  note?: string | null;
  location_id?: string | null;
}

export function useRecordEmpty() {
  const tenantId = useTenantId();
  const { user, profile } = useAuth() as any;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: NewEmptyEntry) => {
      const { error } = await sb.from("empties_ledger").insert({
        tenant_id: tenantId,
        location_id: entry.location_id ?? null,
        product_id: entry.product_id,
        item_label: entry.item_label,
        container_kind: entry.container_kind,
        direction: entry.direction,
        quantity: entry.quantity,
        deposit_per_unit: entry.deposit_per_unit,
        deposit_total: Number((entry.quantity * entry.deposit_per_unit).toFixed(2)),
        customer_name: entry.customer_name || null,
        note: entry.note || null,
        created_by: user?.id ?? null,
        created_by_name: profile?.display_name ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["empties"] }),
  });
}

export function useDeleteEmpty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("empties_ledger").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["empties"] }),
  });
}
