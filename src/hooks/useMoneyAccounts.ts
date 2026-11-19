import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export type MoneyAccount = { id: string; name: string; sub_type: string };

/** The company's bank, M-Pesa and cash accounts: where a payment lands or comes from. */
export function useMoneyAccounts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["money-accounts", tenantId], enabled: !!tenantId, staleTime: 300_000,
    queryFn: async () => ((await (supabase as any).from("chart_of_accounts").select("id, name, sub_type")
      .eq("tenant_id", tenantId).in("sub_type", ["bank", "cash"]).eq("is_active", true).order("name")).data || []) as MoneyAccount[],
  });
}
