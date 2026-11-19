import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cacheTenant, clearCachedBusinessSettings, getCachedTenant, wipeAllOfflineCaches } from "@/lib/offlineDb";
import { getHostSlug, isSubdomainMode, tenantUrl } from "@/lib/host";
import { goToCompany } from "@/lib/companySwitch";

/**
 * One login can belong to several companies. A company's address always shows
 * that company: if the session is set to another company (or to the platform
 * super admin), switch it to this one when the person is a member, otherwise
 * send them to their own company. Returns "switched" when the session now points at this
 * company (the caller reloads the account in place), true while the browser is leaving.
 */
async function ensureHostCompany(hostSlug: string, profileTenantId: string | null | undefined, role: string | null): Promise<boolean | "switched"> {
  const { data: host } = await (supabase as any).from("tenants_public").select("id, slug").ilike("slug", hostSlug).maybeSingle();
  if (!host?.id) return false;
  if (profileTenantId === host.id) return false;
  const { error } = await (supabase as any).rpc("switch_company", { p_tenant: host.id });
  if (!error) return "switched";
  // Not a member of this company: open their own one instead.
  const { data: own } = profileTenantId
    ? await (supabase as any).from("tenants_public").select("slug").eq("id", profileTenantId).maybeSingle()
    : { data: null };
  if (own?.slug) { await goToCompany(own.slug); return true; }
  await supabase.auth.signOut({ scope: "local" });
  window.location.replace("/login?wrong_shop=1");
  return true;
}

interface TenantInfo {
  id: string;
  slug: string | null;
  logo_url: string | null;
  favicon_url?: string | null;
  business_name: string;
  activation_fee_paid_at?: string | null;
}

interface TenantCtxType {
  tenant: TenantInfo | null;
  loading: boolean;
  refetch: () => void;
}

const TenantCtx = createContext<TenantCtxType>({ tenant: null, loading: true, refetch: () => {} });

export const useTenant = () => useContext(TenantCtx);

const RESERVED = ["admin", "whats-new", "login", "register", "reset-password", "subscription-expired", "billing", "dashboard", "pos", "inventory", "customers", "sales", "purchases", "payments", "communication", "email-logs", "reports", "staff", "settings", "message-logs", "delivery-notes", "packing-lists", "delivery-confirm", "stock-transfer", "purchase-orders", "suppliers", "invoices", "quotes", "expenses", "bills", "services", "mpesa-history", "credit-balances", "order", "rider", "water"];

/**
 * The active shop comes from the subdomain (<slug>.garage.jmsurf.co.ke) when
 * present, otherwise from the first path segment (legacy /<slug>/... links).
 */
function getSlugFromPath() {
  const hostSlug = getHostSlug();
  if (hostSlug) return hostSlug;
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0].toLowerCase();
  return RESERVED.includes(first) ? null : first;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { profile, user, role, signOut, loading: authLoading, profileReady, refreshProfile } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const lastTenantIdRef = useRef<string | null>(null);

  const applyTenant = async (next: TenantInfo | null) => {
    setTenant((prev) => {
      if (prev?.id && prev.id !== next?.id) void clearCachedBusinessSettings(prev.id);
      return next;
    });
  };

  const runIdRef = useRef(0);
  // Set while the account is reloaded after a company switch, so the loader stays up until it is done.
  const switchingRef = useRef(false);

  const fetchTenant = async () => {
    const runId = ++runIdRef.current;
    switchingRef.current = false;
    const isStale = () => runId !== runIdRef.current;
    if (!tenant) setLoading(true);
    try {
      const host = getHostSlug();
      // Show the company saved on this device at once (same account, same address);
      // the lookup below confirms it, or corrects it, a moment later.
      if (!tenant && user && profile?.tenant_id && role !== "super_admin") {
        try {
          const saved = await getCachedTenant(host || getSlugFromPath() || "");
          if (!isStale() && saved && saved.id === profile.tenant_id) { await applyTenant(saved as TenantInfo); setLoading(false); }
        } catch { /* nothing saved */ }
      }
      const ownCompany = user && profile?.tenant_id && role !== "super_admin" && navigator.onLine
        ? (await (supabase as any)
            .from("tenants")
            .select("id, slug, logo_url, favicon_url, business_name, is_active, deleted_at, activation_fee_paid_at")
            .eq("id", profile.tenant_id)
            .maybeSingle()).data
        : null;
      if (isStale()) return;
      // Already in the company of this address (nearly every load): nothing to look up or switch.
      // Not on the hand-over page: it switches the company itself and then loads the dashboard (reloading it
      // here as well cut the sign-in short and added another full load).
      if (user && profile && host && navigator.onLine && window.location.pathname !== "/auth/handoff"
        && String(ownCompany?.slug || "").toLowerCase() !== host.toLowerCase()) {
        const moved = await ensureHostCompany(host, profile.tenant_id, role);
        if (moved === "switched") {
          // Was a full page reload (one more load every time the login was last used in another company).
          // Reload the account instead: its new company re-runs this lookup, and anything read in the
          // meantime is read again for this company.
          switchingRef.current = true;
          await refreshProfile();
          void queryClient.invalidateQueries();
          return;
        }
        if (moved) return;
        if (isStale()) return;
      }
      // STRICT MODE: if user is logged in, ONLY resolve their profile.tenant_id.
      // Never fall back to URL slug for authenticated users (prevents cross-tenant leakage).
      if (user && profile?.tenant_id && role !== "super_admin") {
        if (navigator.onLine) {
          const data = ownCompany;

          // Tenant was deleted or deactivated → wipe caches and force sign-out
          if (data && (data.deleted_at || data.is_active === false)) {
            console.warn("[Tenant] Company is deactivated — signing out.");
            await wipeAllOfflineCaches();
            await signOut();
            await applyTenant(null);
            return;
          }

          if (!data) {
            // Could not read the shop right now (temporary issue). Keep the
            // session and fall back to the cached shop instead of hanging.
            const cached = await getCachedTenant(getSlugFromPath() || "");
            await applyTenant(cached && cached.id === profile.tenant_id ? (cached as TenantInfo) : null);
            return;
          }


          const safe = { id: data.id, slug: data.slug, logo_url: data.logo_url, favicon_url: data.favicon_url, business_name: data.business_name, activation_fee_paid_at: data.activation_fee_paid_at };
          await applyTenant(safe);
          if (safe.slug) cacheTenant(safe);

          // Data is always the signed-in account's own shop. We never sign the
          // session out just because the address shows a different shop name, so
          // several shops can be signed in at once in the same browser.
          try {
            const urlSlug = getSlugFromPath();
            if (urlSlug && safe.slug && urlSlug !== safe.slug && !isSubdomainMode()) {
              const newPath = window.location.pathname.replace(`/${urlSlug}`, `/${safe.slug}`);
              window.history.replaceState({}, "", newPath + window.location.search + window.location.hash);
              window.dispatchEvent(new Event("lovable:navigation"));
            }
          } catch {}

          return;
        } else {
          // Offline: resolve cached tenant by ID match (NOT URL slug — that may be wrong tenant)
          const slug = getSlugFromPath();
          if (slug) {
            const cached = await getCachedTenant(slug);
            // STRICT: cached tenant id must match profile tenant id
            if (cached && cached.id === profile.tenant_id) {
              if (isStale()) return;
              await applyTenant(cached);
              return;
            }
          }
          // No matching cache — leave tenant null but stay signed in (offline grace)
          if (isStale()) return;
          await applyTenant(null);
          return;
        }
      }

      // Logged-in user with NO profile.tenant_id (e.g. super_admin) OR not logged in:
      // resolve tenant by URL slug so the UI can scope to the workspace being viewed.
      {
        const slug = getSlugFromPath();
        if (slug) {
          if (navigator.onLine) {
            const tenantQuery = user && role === "super_admin"
              ? (supabase as any).from("tenants").select("id, slug, logo_url, favicon_url, business_name, activation_fee_paid_at")
              : (supabase as any).from("tenants_public").select("id, slug, logo_url, business_name");
            const { data } = await tenantQuery
              .ilike("slug", slug)
              .maybeSingle();
            if (isStale()) return;
            if (data) {
              await applyTenant(data);
              cacheTenant(data);
              return;
            }
          } else {
            const cached = await getCachedTenant(slug);
            if (isStale()) return;
            if (cached) { await applyTenant(cached); return; }
          }
        }
      }

      if (isStale()) return;
      await applyTenant(null);
    } catch (e) {
      console.warn("[Tenant] resolve failed:", e);
    } finally {
      // The screen must always stop spinning, even when a lookup failed.
      if (runId === runIdRef.current && !switchingRef.current) setLoading(false);
    }
  };

  const refetch = () => setRefreshCounter((c) => c + 1);

  // The moment the signed-in account points at a different shop, drop the shop
  // currently on screen so its name/logo can never linger for a split second,
  // and immediately re-resolve the correct one.
  //
  // Super admins are excluded on purpose: they legitimately view a shop that is
  // not their own, and re-resolving here would fight the address every render
  // (shop → blank → shop → blank).
  useEffect(() => {
    if (role === "super_admin") return;
    if (profile?.tenant_id && tenant?.id && tenant.id !== profile.tenant_id) {
      setTenant(null);
      setLoading(true);
      setRefreshCounter((c) => c + 1);
    }
  }, [profile?.tenant_id, tenant?.id, role]);

  // Only re-resolve when the account or the shop in the address changes —
  // not on every page change, which used to cause repeated lookups.
  const pathSlug = getSlugFromPath();
  // A signed-in person's company is only known once their account has loaded.
  const accountPending = authLoading || (!!user && !profileReady);
  useEffect(() => { if (!accountPending) void fetchTenant(); }, [profile?.tenant_id, user?.id, role, refreshCounter, pathSlug, accountPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety net: the screen must never spin forever if a lookup never answers.
  useEffect(() => {
    if (!loading || accountPending) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading, refreshCounter, accountPending]);



  // Another tab may have opened a different company with this login. Coming
  // back to this tab, offer to switch back (never reload on its own).
  useEffect(() => {
    const host = getHostSlug();
    if (!host || !user?.id) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !tenant?.id) return;
      const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", user.id).maybeSingle();
      if (prof?.tenant_id && prof.tenant_id !== tenant.id) window.dispatchEvent(new CustomEvent("dash:company-moved"));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id, tenant?.id]);

  // Whenever the active tenant changes, immediately invalidate + refetch all
  // tenant-scoped dashboard data so the UI never shows previous-tenant zeros.
  useEffect(() => {
    const newId = tenant?.id || null;
    if (newId && newId !== lastTenantIdRef.current) {
      lastTenantIdRef.current = newId;
      const keys = [
        ["transactions"], ["products"], ["product-stocks"], ["product_batches"],
        ["expenses"], ["bills"], ["customers"], ["business-settings"], ["locations"],
        ["recent-completed-tx"],
      ];
      // A read already on its way for this company is kept, not cancelled and sent again.
      keys.forEach((k) => { void queryClient.invalidateQueries({ queryKey: k }, { cancelRefetch: false }); });
    } else if (!newId) {
      lastTenantIdRef.current = null;
    }
  }, [tenant?.id, queryClient]);

  return (
    <TenantCtx.Provider value={{ tenant, loading, refetch }}>
      {children}
    </TenantCtx.Provider>
  );
}

/** Get the login path for the current tenant */
export function useTenantLoginPath() {
  const { tenant } = useTenant();
  if (isSubdomainMode()) return "/login";
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (pathParts.length >= 1) {
    const urlSlug = pathParts[0];
    if (!RESERVED.includes(urlSlug)) {
      return `/${urlSlug}/login`;
    }
  }
  if (tenant?.slug) return `/${tenant.slug}/login`;
  return "/login";
}

/** Resolve tenant by slug (case-insensitive) - with offline fallback */
export async function resolveTenantBySlug(rawSlug: string) {
  const slug = (rawSlug || "").trim().toLowerCase();
  if (!slug) return null;
  if (navigator.onLine) {
    // Case-insensitive match in case any legacy slugs slipped through
    const { data } = await (supabase as any)
      .from("tenants_public")
      .select("id, slug, logo_url, business_name")
      .ilike("slug", slug)
      .maybeSingle();
    if (data) {
      cacheTenant(data);
      return data as TenantInfo;
    }
    return null;
  } else {
    const cached = await getCachedTenant(slug);
    return cached as TenantInfo | null;
  }
}
