import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantId } from "@/hooks/useTenantId";

export type FeatureKey =
  | "sales" | "purchases" | "roles" | "communication" | "smtp_email"
  | "theme" | "session" | "reports" | "staff"
  | "inventory_transfer" | "dashboard" | "customers" | "suppliers"
  | "invoices" | "quotes" | "payments" | "expenses" | "audit_logs";

export const ALL_FEATURES: { key: FeatureKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "sales", label: "Sales Module" },
  { key: "purchases", label: "Purchases Module" },
  { key: "inventory_transfer", label: "Inventory Transfer" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "expenses", label: "Expenses" },
  { key: "payments", label: "Payments" },
  { key: "reports", label: "Reports" },
  { key: "staff", label: "Staff" },
  { key: "roles", label: "Roles" },
  { key: "communication", label: "Notifications & Communication" },
  { key: "smtp_email", label: "SMTP / Email" },
  { key: "audit_logs", label: "Audit Logs" },
  { key: "theme", label: "Theme" },
  { key: "session", label: "Session Settings" },
];

const normalizeFeatureToken = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const resolveFeatureKey = (value: string): FeatureKey | null => {
  const normalized = normalizeFeatureToken(value);
  const match = ALL_FEATURES.find((feature) => {
    return normalizeFeatureToken(feature.key) === normalized || normalizeFeatureToken(feature.label) === normalized;
  });
  return match?.key ?? null;
};

function parseFeatureFlags(value: unknown, mode: "plan" | "override"): Partial<Record<FeatureKey, boolean>> {
  // For arrays/strings (legacy plan format), unlisted features are off.
  // For object format or absent data, return only explicit entries so DEFAULT_ON
  // is preserved by the merge step below.
  const base: Partial<Record<FeatureKey, boolean>> = {};

  if (Array.isArray(value)) {
    if (mode === "plan") {
      ALL_FEATURES.forEach((f) => { base[f.key] = false; });
    }
    value.forEach((item) => {
      const key = resolveFeatureKey(String(item));
      if (key) base[key] = true;
    });
    return base;
  }

  if (typeof value === "string" && value.trim()) {
    if (mode === "plan") {
      ALL_FEATURES.forEach((f) => { base[f.key] = false; });
    }
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const key = resolveFeatureKey(item);
        if (key) base[key] = true;
      });
    return base;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([rawKey, rawValue]) => {
      const key = resolveFeatureKey(rawKey);
      if (key && typeof rawValue === "boolean") base[key] = rawValue;
    });
  }

  return base;
}

const DEFAULT_ON: Record<FeatureKey, boolean> = ALL_FEATURES.reduce((acc, f) => {
  acc[f.key] = true;
  return acc;
}, {} as Record<FeatureKey, boolean>);

/**
 * Resolve the effective feature flags for the current tenant by merging:
 * 1. plan.features (the package they're on)
 * 2. tenant_feature_overrides (super-admin per-tenant toggles)
 * Override always wins. Returns DEFAULT_ON when no data is available so the app
 * doesn't accidentally lock everyone out while loading.
 */
export function useTenantFeatures() {
  const tenantId = useTenantId();
  const qc = useQueryClient();

  // Real-time: invalidate when this tenant's plan, override, or subscription changes
  useEffect(() => {
    if (!tenantId) return;
    const invalidate = () => {
      try {
        localStorage.removeItem(`tenant-features:${tenantId}`);
      } catch {
        // Storage can be unavailable in private browsing; network refresh still runs.
      }
      void qc.invalidateQueries({ queryKey: ["tenant-features", tenantId], refetchType: "active" });
      void qc.invalidateQueries({ queryKey: ["subscription-limits", tenantId], refetchType: "active" });
      void qc.invalidateQueries({ queryKey: ["subscription", tenantId], refetchType: "active" });
      void qc.invalidateQueries({ queryKey: ["billing-feature-overrides", tenantId], refetchType: "active" });
    };
    const channel = supabase
      .channel(`tenant-features-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_feature_overrides", filter: `tenant_id=eq.${tenantId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `tenant_id=eq.${tenantId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, qc]);

  const cacheKey = tenantId ? `tenant-features:${tenantId}` : null;
  const cached = (() => {
    if (!cacheKey) return undefined;
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as Record<FeatureKey, boolean>) : undefined;
    } catch {
      return undefined;
    }
  })();

  const { data, isFetched } = useQuery({
    queryKey: ["tenant-features", tenantId],
    enabled: !!tenantId,
    initialData: cached,
    // Live updates refresh this the moment a plan or override changes.
    staleTime: 10 * 60_000,
    refetchOnReconnect: "always",
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const sb: any = supabase;
      // Resolve the ACTIVE tenant's subscription (not the logged-in user's).
      // This matters when super-admin views a tenant via slug — we must use the
      // viewed tenant's plan, not the super-admin's (which is null).
      const { data: subRow } = await sb
        .from("subscriptions")
        .select("plan_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const planId = subRow?.plan_id || null;

      const [planRes, overrideRes] = await Promise.all([
        planId
          ? sb.from("plans").select("features").eq("id", planId).maybeSingle()
          // No package linked yet: fall back to the entry package so a shop
          // never silently gets every module.
          : sb.from("plans").select("features").eq("is_active", true)
              .order("price_monthly", { ascending: true }).limit(1).maybeSingle(),
        sb.from("tenant_feature_overrides").select("features").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      const planFeatures = parseFeatureFlags(planRes?.data?.features, "plan");
      const overrideFeatures = parseFeatureFlags(overrideRes?.data?.features, "override");
      const merged: Record<FeatureKey, boolean> = { ...DEFAULT_ON };
      // Plan first (only apply when plan provided actual flags)
      Object.entries(planFeatures).forEach(([k, v]) => { if (typeof v === "boolean") (merged as any)[k] = v; });
      // Then per-tenant overrides win
      Object.entries(overrideFeatures).forEach(([k, v]) => { if (typeof v === "boolean") (merged as any)[k] = v; });
      try {
        if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(merged));
      } catch {
        // storage unavailable — resolve from network next time
      }
      return merged;
    },
  });

  // `ready` is false until we know the real flags (from cache or network) so the
  // UI never flashes every module before settling on the package's modules.
  const ready = !!data;
  const features = data || DEFAULT_ON;
  const has = (key: FeatureKey) => features[key] !== false;
  return { features, has, ready, isFetched };
}
