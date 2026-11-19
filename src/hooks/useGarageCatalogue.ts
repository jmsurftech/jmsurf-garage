/** Live garage plans and module prices over the defaults in src/lib/garagePlans.ts. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CATALOGUE, DEFAULT_PLANS, YEAR_MONTHS, type Catalogue, type GaragePlan } from "@/lib/garagePlans";

interface PlanRow {
  id: string; name: string; code: string | null; price_monthly: number; price_annually: number | null; max_users: number; max_locations: number;
  included_modules: string[] | null; all_modules: boolean | null; description: string | null; quote_only?: boolean | null; is_active: boolean;
}

/** Reads the live plans and module prices (anyone can read them) over the defaults. */
export async function fetchCatalogue(): Promise<Catalogue> {
  const sb = supabase as any;
  const [plansRes, modsRes] = await Promise.all([
    sb.from("plans").select("id, name, code, price_monthly, price_annually, max_users, max_locations, included_modules, all_modules, description, quote_only, is_active").eq("is_active", true),
    sb.from("platform_modules").select("key, price_monthly, is_active"),
  ]);
  const rows = (plansRes.data || []) as PlanRow[];
  const plans = DEFAULT_PLANS.map((d) => {
    const r = rows.find((x) => (x.code || "").toLowerCase() === d.code);
    if (!r) return d;
    const price = Number(r.price_monthly) || 0;
    return {
      ...d, id: r.id, name: r.name || d.name, price,
      priceYear: Number(r.price_annually) > 0 ? Number(r.price_annually) : price * YEAR_MONTHS,
      users: Number(r.max_users) || d.users, branches: Number(r.max_locations) || d.branches,
      includes: Array.isArray(r.included_modules) && r.included_modules.length ? r.included_modules : d.includes,
      blurb: r.description || d.blurb, quoteOnly: r.quote_only ?? d.quoteOnly,
    } as GaragePlan;
  });
  const prices = { ...DEFAULT_CATALOGUE.prices };
  const off = new Set<string>();
  for (const m of (modsRes.data || []) as { key: string; price_monthly: number; is_active: boolean }[]) {
    if (m.key in prices) prices[m.key] = Number(m.price_monthly) || 0;
    if (m.is_active === false) off.add(m.key);
  }
  return { plans, prices, off };
}

/** Live catalogue for the website, sign-up and billing (defaults until it loads or when offline). */
export function useGarageCatalogue(): Catalogue {
  const { data } = useQuery({ queryKey: ["garage-catalogue"], staleTime: 10 * 60_000, queryFn: fetchCatalogue, retry: 1 });
  return data || DEFAULT_CATALOGUE;
}
