import { setCurrency } from "@/lib/format";
import { isNetworkError } from "@/lib/network";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listStaffAccounts } from "@/lib/serverStaff";
import { useTenantId } from "@/hooks/useTenantId";
import {
  cacheProducts, getCachedProducts,
  cacheCustomers, getCachedCustomers,
  cacheBusinessSettings, getCachedBusinessSettings,
  cacheProductStocks, getCachedProductStocks,
  cacheTable, getCachedTable,
} from "@/lib/offlineDb";

export function useProducts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["products", tenantId],
    enabled: !!tenantId || !navigator.onLine,
    queryFn: async () => {
      if (!navigator.onLine) {
        return getCachedProducts();
      }
      if (!tenantId) return [];
      try {
        const { data, error } = await supabase
          .from("products").select("*")
          .eq("is_active", true).eq("tenant_id", tenantId).order("name");
        if (error) throw error;
        if (data) cacheProducts(data);
        return data;
      } catch (e) {
        if (isNetworkError(e)) return getCachedProducts();
        throw e;
      }
    },
  });
}

export function useCustomers() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["customers", tenantId],
    enabled: !!tenantId || !navigator.onLine,
    queryFn: async () => {
      if (!navigator.onLine) {
        return getCachedCustomers();
      }
      if (!tenantId) return [];
      try {
        const { data, error } = await supabase
          .from("customers").select("*")
          .eq("tenant_id", tenantId).order("name");
        if (error) throw error;
        if (data) cacheCustomers(data);
        return data;
      } catch (e) {
        if (isNetworkError(e)) return getCachedCustomers();
        throw e;
      }
    },
  });
}

export function useTransactions() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("transactions").select("*")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useStaff() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["staff", tenantId],
    enabled: !!tenantId || !navigator.onLine,
    queryFn: async () => {
      if (!navigator.onLine) {
        return getCachedTable<any>("staff");
      }
      if (!tenantId) return [];
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, user_id, tenant_id, display_name, phone, store_location, created_at, updated_at")
        .eq("tenant_id", tenantId).order("display_name");
      if (pErr) throw pErr;

      const userIds = (profiles || []).map((p) => p.user_id);
      if (userIds.length === 0) return [];
      const { data: roles, error: rErr } = await supabase
        .from("user_roles").select("*").in("user_id", userIds);
      if (rErr) throw rErr;

      // Sign-in email lives with the account, not the profile, so fetch it for
      // admins. Anyone without permission simply sees the team without emails.
      const emailMap: Record<string, string> = {};
      try {
        const { data: accounts } = await listStaffAccounts();
        (accounts?.users || []).forEach((u: any) => { if (u?.id && u?.email) emailMap[u.id] = u.email; });
      } catch { /* not an admin - emails stay hidden */ }

      // Platform owner accounts keep their access but never appear in a shop's team list.
      const platformOwners = new Set(
        (roles || []).filter((r: any) => r.role === "super_admin").map((r: any) => r.user_id)
      );

      const merged = (profiles || []).filter((p) => !platformOwners.has(p.user_id)).map((p) => ({
        ...p,
        email: emailMap[p.user_id] || null,
        role: roles?.find((r) => r.user_id === p.user_id)?.role || "cashier",
        role_id: roles?.find((r) => r.user_id === p.user_id)?.id,
      }));
      cacheTable("staff", merged);
      return merged;
    },
  });
}

export function useShifts() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["shifts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from("shifts").select("*")
        .eq("tenant_id", tenantId)
        .order("start_time", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useLocations() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["locations", tenantId],
    enabled: !!tenantId || !navigator.onLine,
    queryFn: async () => {
      if (!navigator.onLine) {
        return getCachedTable<any>("locations");
      }
      if (!tenantId) return [];
      const sb: any = supabase;
      const { data, error } = await sb.from("locations")
        .select("*").eq("is_active", true)
        .eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      const rows = (data || []) as Array<{ id: string; name: string; code: string | null }>;
      cacheTable("locations", rows);
      return rows;
    },
  });
}

export async function fetchBusinessSettings(tenantId: string | null) {
  if (!navigator.onLine) {
    const cached: any = await getCachedBusinessSettings(tenantId || undefined);
    if (cached?.currency) setCurrency(cached.currency);
    return cached;
  }
  if (!tenantId) return null;
  const sb: any = supabase;
  // SECURITY: never select raw credentials (mpesa_consumer_key/secret, mpesa_passkey,
  // paystack_secret_key, smtp_password). Read from the safe view that exposes only
  // non-sensitive columns plus boolean `has_*` indicators. The actual secrets are
  // only ever read by edge functions using the service role.
  let q = sb.from("business_settings_safe").select("*");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  q = q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  const { data, error } = await q;
  if (error) throw error;
  if (data) { cacheBusinessSettings(data); setCurrency((data as any).currency); }
  return data as any;
}

export function useBusinessSettings() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["business-settings", tenantId],
    enabled: !!tenantId || !navigator.onLine,
    staleTime: 0,
    refetchOnReconnect: true,
    queryFn: () => fetchBusinessSettings(tenantId),
  });
}

export function useUserLocations(userId?: string) {
  return useQuery({
    queryKey: ["user-locations", userId],
    enabled: !!userId,
    queryFn: async () => {
      const sb: any = supabase;
      const { data, error } = await sb
        .from("user_locations")
        .select("*")
        .eq("user_id", userId)
        .order("is_primary", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{ user_id: string; location_id: string; is_primary: boolean }>;
    },
  });
}

export function useAllUserLocations() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["all-user-locations", tenantId],
    queryFn: async () => {
      const sb: any = supabase;
      if (!tenantId) return [];

      const { data: locationRows, error: locErr } = await sb
        .from("locations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      if (locErr) throw locErr;

      const locationIds = (locationRows || []).map((row: { id: string }) => row.id);
      if (locationIds.length === 0) return [];

      const { data, error } = await sb
        .from("user_locations")
        .select("*")
        .in("location_id", locationIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{ user_id: string; location_id: string; is_primary: boolean }>;
    },
  });
}

/**
 * Returns products with stock data.
 * - When `locationId` is a real location id → only products with a stock row at that location.
 * - When `locationId === "__all__"` → every active product in the tenant, with stock summed across all locations.
 */
export function useProductStocks(locationId?: string) {
  const tenantId = useTenantId();
  // No branch resolved yet (staff whose branch link is still loading or missing)?
  // Fall back to the shop-wide catalogue so the till is never blank.
  const effectiveLocation = locationId || "__all__";
  const isAll = effectiveLocation === "__all__";
  // Show the last catalogue this device saw straight away, then refresh it in
  // the background, so the till never waits on "Loading products".
  const [cached, setCached] = useState<any[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getCachedProductStocks()
      .then((rows: any[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const mine = tenantId ? rows.filter((r: any) => !r?.tenant_id || r.tenant_id === tenantId) : rows;
        if (mine.length) setCached(mine);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [tenantId]);
  return useQuery({
    queryKey: ["product-stocks", tenantId, effectiveLocation],
    // Keep the previous list while the branch or shop id settles.
    placeholderData: (previous: any) => previous ?? cached,
    // The till must load for every signed-in staff member. When the shop id is
    // still resolving, the catalogue is read without it — the database only ever
    // returns the products of the shop the account belongs to.
    enabled: true,
    // Connected but no internet: fall back to this device's last copy.
    queryFn: () => loadStocks().catch((e) => { if (isNetworkError(e)) return getCachedProductStocks(); throw e; }),
  });

  async function loadStocks(): Promise<any[]> {
      if (!navigator.onLine) {
        return getCachedProductStocks();
      }

      const tenantProductQuery = () => {
        let q = supabase.from("products").select("*").eq("is_active", true);
        if (tenantId) q = q.eq("tenant_id", tenantId);
        return q.order("name");
      };

      if (isAll) {
        // Aggregate view: every product the tenant owns, with total stock across locations.
        // Per-branch stock rows are a bonus: if they cannot be read the catalogue
        // must still load, so that query is never allowed to break the till.
        const [{ data: tenantProducts, error: productsError }, { data: stockRows }] = await Promise.all([
          tenantProductQuery(),
          supabase
            .from("product_stocks" as any)
            .select("product_id, location_id, stock, reorder_level")
            .then((r) => r, () => ({ data: [] as any[] })),
        ]);
        if (productsError) throw productsError;

        const stockByProduct = new Map<string, { stock: number; reorder: number; locations: number }>();
        (stockRows || []).forEach((r: any) => {
          const prev = stockByProduct.get(r.product_id) || { stock: 0, reorder: 0, locations: 0 };
          prev.stock += Number(r.stock || 0);
          prev.reorder = Math.max(prev.reorder, Number(r.reorder_level || 0));
          prev.locations += 1;
          stockByProduct.set(r.product_id, prev);
        });

        const merged = (tenantProducts || []).map((p: any) => {
          const agg = stockByProduct.get(p.id);
          return {
            ...p,
            stock: agg ? agg.stock : Number(p.stock || 0),
            reorder_level: agg ? agg.reorder : Number(p.reorder_level || 0),
            location_count: agg ? agg.locations : 0,
            stock_row_id: null,
            stock_location_id: null,
          };
        });
        cacheProductStocks(merged);
        return merged;
      }

      // Single-location view: branch counts and the shop catalogue load together.
      const productsPromise = tenantProductQuery();
      const { data: stockRows, error: stockError } = await supabase
        .from("product_stocks" as any)
        .select(`
          id,
          location_id,
          stock,
          reorder_level,
          products (*)
        `)
        .eq("location_id", effectiveLocation)
        .order("created_at", { ascending: false });

      // A branch stock problem (missing rows, no read access) must never empty
      // the till, so it is treated as "no rows yet" instead of an error.
      const rows = stockError ? [] : stockRows || [];

      const stockByProduct = new Map<string, any>();
      rows.forEach((row: any) => {
        if (row?.products?.id) stockByProduct.set(row.products.id, row);
      });

      // The shop catalogue is the source of truth for what the till shows; the
      // branch rows only supply the counts. That way every staff member sees
      // every product, whether or not their branch has been stocked.
      const { data: tenantProducts } = await productsPromise;

      const merged = (tenantProducts || []).map((p: any) => {
        const row = stockByProduct.get(p.id);
        return {
          ...p,
          stock: row ? Number(row.stock || 0) : Number(p.stock || 0),
          reorder_level: row ? Number(row.reorder_level || 0) : Number(p.reorder_level || 0),
          stock_row_id: row?.id ?? null,
          stock_location_id: row?.location_id ?? effectiveLocation,
        };
      });

      if (merged.length > 0) {
        cacheProductStocks(merged);
        return merged;
      }

      // Last resort: show whatever the branch rows carry.
      const mapped = rows
        .filter((row: any) => row.products && row.products.is_active !== false)
        .map((row: any) => ({
          ...row.products,
          stock: row.stock,
          reorder_level: row.reorder_level,
          stock_row_id: row.id,
          stock_location_id: row.location_id,
        }))
        .sort((a: any, b: any) =>
          String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }),
        );
      cacheProductStocks(mapped);
      return mapped;
  }
}

export function useStockAdjustments(locationId?: string) {
  return useQuery({
    queryKey: ["stock-adjustments", locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_adjustments" as any)
        .select(`
          *,
          products (name, sku)
        `)
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });
}

// ------------------------------------------------------------ paged sales

export type SalesFilters = {
  from?: string | null;   // ISO timestamp
  to?: string | null;     // ISO timestamp
  method?: string | null;
  status?: string | null;
  cashier?: string | null;
  search?: string | null;
  ascending?: boolean;
};

const salesArgs = (f: SalesFilters) => ({
  p_from: f.from || null,
  p_to: f.to || null,
  p_method: f.method && f.method !== "all" ? f.method : null,
  p_status: f.status && f.status !== "all" ? f.status : null,
  p_cashier: f.cashier && f.cashier !== "all" ? f.cashier : null,
  p_search: f.search?.trim() || null,
});

/**
 * One page of sales, filtered, searched and counted inside the database.
 * Keyed under "transactions" so live updates refresh it automatically.
 */
export function usePagedTransactions(filters: SalesFilters, page: number, pageSize: number) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "page", filters, page, pageSize],
    enabled: !!tenantId,
    placeholderData: (previous: any) => previous,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("transactions_page", {
        ...salesArgs(filters),
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_ascending: !!filters.ascending,
      });
      if (error) throw error;
      const rows = (data || []) as { tx: any; total: number }[];
      return { rows: rows.map((r) => r.tx), total: Number(rows[0]?.total || 0) };
    },
  });
}

/** Totals for the same filters (money counts completed sales only). */
export function useTransactionsSummary(filters: SalesFilters) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "summary", filters],
    enabled: !!tenantId,
    placeholderData: (previous: any) => previous,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("transactions_summary", salesArgs(filters));
      if (error) throw error;
      return data as {
        count: number; completed: number; pending: number; failed: number;
        total: number; cash: number; mpesa: number; card: number; credit: number; other: number;
        cashiers: string[];
      };
    },
  });
}

/** Every sale matching the filters, page by page (for exports). */
export async function fetchAllTransactions(filters: SalesFilters, max = 20_000) {
  const all: any[] = [];
  for (let offset = 0; offset < max; offset += 500) {
    const { data, error } = await (supabase as any).rpc("transactions_page", {
      ...salesArgs(filters), p_limit: 500, p_offset: offset, p_ascending: !!filters.ascending,
    });
    if (error) throw error;
    const rows = (data || []) as { tx: any; total: number }[];
    all.push(...rows.map((r) => r.tx));
    if (rows.length < 500) break;
  }
  return all;
}

/** Completed sales between two dates (for reports), only the columns needed. */
export function useSalesInRange(from: string | null, to: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "range", from, to],
    enabled: !!tenantId,
    placeholderData: (previous: any) => previous,
    staleTime: 5_000,
    queryFn: async () => {
      const all: any[] = [];
      for (let offset = 0; offset < 100_000; offset += 1000) {
        let q = supabase.from("transactions").select("*").eq("tenant_id", tenantId!)
          .order("created_at", { ascending: false }).range(offset, offset + 999);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        const { data, error } = await q;
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
}
