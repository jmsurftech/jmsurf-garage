import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/hooks/useTenant";
import { callServer } from "@/lib/serverStaff";
import { publicBase } from "@/lib/host";

/**
 * Where the signed-in company's customers open its pages: its own domain when it has an active one,
 * else https://app.jmsurfgarage.co.ke/<slug>. Links shown to staff for customers start with this.
 */
export function useCustomerBase(): string {
  const { tenant } = useTenant();
  const { data } = useQuery({
    queryKey: ["customer-base", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => (await callServer<{ public_base: string | null }>("/api/staff/address", {})).data?.public_base || null,
  });
  return data || publicBase(tenant?.slug);
}
