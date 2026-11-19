import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export interface ProductBatch {
  id: string;
  tenant_id: string;
  product_id: string;
  location_id: string | null;
  batch_number: string | null;
  quantity: number;
  expiry_date: string | null;
  received_at: string;
  notes: string | null;
  created_at: string;
}

export function useProductBatches() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["product_batches", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_batches")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      return (data || []) as ProductBatch[];
    },
  });
}

export function useExpiredBatches() {
  const { data: batches = [] } = useProductBatches();
  const today = new Date().toISOString().slice(0, 10);
  return batches.filter((b) => b.expiry_date && b.expiry_date < today && b.quantity > 0);
}

export function useExpiringBatches(daysAhead = 30) {
  const { data: batches = [] } = useProductBatches();
  const today = new Date();
  const cutoff = new Date(today.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  return batches.filter(
    (b) => b.expiry_date && b.expiry_date >= todayStr && b.expiry_date <= cutoff && b.quantity > 0
  );
}

export function useUpsertBatch() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    mutationFn: async (batch: Partial<ProductBatch> & { product_id: string }) => {
      const payload = { ...batch, tenant_id: tenantId };
      const { data, error } = batch.id
        ? await (supabase as any).from("product_batches").update(payload).eq("id", batch.id).select().single()
        : await (supabase as any).from("product_batches").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_batches"] }),
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("product_batches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product_batches"] }),
  });
}
