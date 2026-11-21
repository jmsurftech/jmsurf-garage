import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/fetchAll";

const sb = supabase as any;

export type Company = {
  id: string; business_name: string; slug: string | null; owner_user_id: string; deleted_at: string | null; is_active: boolean;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; business_email: string | null;
  business_phone: string | null; business_address: string | null; industry: string | null; created_at: string;
};
export type Sub = {
  id: string; tenant_id: string; plan_id: string | null; plan_name: string; status: string; billing_cycle: string; price: number;
  max_users: number; max_locations: number; trial_ends_at: string | null; current_period_end: string | null;
  suspended_at: string | null; suspended_reason: string | null; comped_until: string | null; comp_note: string | null; created_at: string;
};

/** Companies, each company's newest subscription and the plans: shared by the list and the company page. */
export function useCompanies() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-companies"],
    staleTime: 30_000,
    queryFn: async () => {
      const [{ data: t }, { data: s }, { data: p }] = await Promise.all([
        allRows<Company>(() => sb.from("tenants").select("id,business_name,slug,owner_user_id,deleted_at,is_active,contact_name,contact_email,contact_phone,business_email,business_phone,business_address,industry,created_at").order("created_at", { ascending: false })),
        allRows<Sub>(() => sb.from("subscriptions").select("*").order("created_at", { ascending: true })),
        sb.from("plans").select("*").eq("is_active", true).order("price_monthly"),
      ]);
      // Oldest first, so the last one kept is each company's newest subscription.
      const subs: Record<string, Sub> = {};
      (s || []).forEach((x) => { subs[x.tenant_id] = x; });
      return { companies: (t || []) as Company[], subs, plans: (p || []) as any[] };
    },
  });
  return {
    companies: q.data?.companies || [], subs: q.data?.subs || {}, plans: q.data?.plans || [],
    loading: q.isLoading, reload: () => qc.invalidateQueries({ queryKey: ["admin-companies"] }),
  };
}

/** The status a company is shown with: archived and suspended first, then its subscription. */
export function companyStatus(c: Company, s?: Sub | null): string {
  if (c.deleted_at) return "archived";
  if (!s) return "none";
  if (s.status === "suspended" || s.status === "paused") return "suspended";
  const end = s.status === "trial" || s.status === "trialing" ? s.trial_ends_at || s.current_period_end : s.current_period_end;
  if ((s.status === "active" || s.status === "trial" || s.status === "trialing") && end && Date.parse(end) < Date.now()) return "expired";
  return s.status === "trialing" ? "trial" : s.status;
}
export const endOf = (s?: Sub | null) => (s ? (s.status === "trial" || s.status === "trialing" ? s.trial_ends_at || s.current_period_end : s.current_period_end || s.trial_ends_at) : null);
export const ksh = (n: number) => `KSh ${Math.round(Number(n) || 0).toLocaleString()}`;
export const companyName = (c?: Partial<Company> | null) => c?.business_name || c?.contact_name || c?.contact_email || "Unnamed";
