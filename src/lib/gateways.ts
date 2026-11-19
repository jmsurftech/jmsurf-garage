import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GatewayField = { key: string; label: string; secret?: boolean; placeholder?: string; options?: [string, string][] };
export type GatewayInfo = {
  id: string; label: string; kind: "redirect" | "push"; countries: string;
  fields: GatewayField[]; currencies: string[] | null; needsRate: boolean;
};
export type ShopGateway = { provider: string; enabled: boolean; config: Record<string, any>; saved: string[] };

/** Calls the app server's payment hub (shop sub-addresses go through www). */
export async function payApi(path: string, body: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const host = window.location.hostname;
  const base = ""; // same server on every JMSURF Garage address
  try {
    const res = await fetch(`${base}/api/pay/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    return await res.json().catch(() => ({ error: `Server replied ${res.status}` }));
  } catch (e: any) {
    return { error: e?.message || "Could not reach the server" };
  }
}

/** What each gateway needs (labels, fields, countries). */
export function useGatewayCatalog() {
  return useQuery({
    queryKey: ["gateway-catalog"],
    staleTime: 60 * 60_000,
    queryFn: async () => ((await payApi("catalog"))?.providers || []) as GatewayInfo[],
  });
}

/** The shop's extra gateways (no secrets). */
export function useShopGateways() {
  return useQuery({
    queryKey: ["shop-gateways"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_tenant_gateways");
      if (error) throw error;
      return (data || []) as ShopGateway[];
    },
  });
}
