import { supabase } from "@/integrations/supabase/client";
import { getHostSlug, isAppHost, isDevHost, tenantPath, tenantUrl } from "@/lib/host";
import { ensureNoWaitingChanges } from "@/lib/offlineGuard";
import { clearDeviceCache } from "@/lib/queryPersist";
import { clearCachedState } from "@/lib/memoryCache";

export interface MyCompany {
  tenant_id: string;
  slug: string | null;
  business_name: string;
  logo_url: string | null;
  role: string;
  is_owner: boolean;
  is_current: boolean;
  last_used_at: string | null;
}

export async function listMyCompanies(): Promise<MyCompany[]> {
  const { data, error } = await (supabase as any).rpc("my_companies");
  if (error) throw error;
  return (data || []) as MyCompany[];
}

/**
 * Opens a company's own address signed in as the same person: a one-time code
 * in the URL fragment (never sent to a server) becomes a new session there.
 */
export async function goToCompany(slug: string, path = "/dashboard") {
  if (getHostSlug() === slug) {
    window.location.assign(path);
    return;
  }
  // app. (and local development) hold the session on this address: make the company the active one and open it.
  if (isAppHost() || isDevHost()) {
    try {
      const { data: t } = await (supabase as any).from("tenants_public").select("id").ilike("slug", slug).maybeSingle();
      if (t?.id) await (supabase as any).rpc("switch_company", { p_tenant: t.id });
    } catch { /* the workspace opens the company the login is set to */ }
    // Same address, another company: the lists kept on this device (and in this tab) were the old company's.
    await clearDeviceCache().catch(() => undefined);
    clearCachedState();
    window.location.assign(tenantPath(slug, path));
    return;
  }
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) { window.location.assign(tenantUrl(slug, "/login")); return; }
  // A one-time code gives the workspace address a session of its own.
  try {
    const res = await fetch("/api/erp/session/handoff", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` }, body: "{}" });
    const j = await res.json();
    if (res.ok && j.th) { window.location.assign(handoffUrl(slug, j.th, path)); return; }
  } catch { /* fall back to signing in there */ }
  window.location.assign(tenantUrl(slug, "/login"));
}

/** The workspace's hand-over address: the one-time code and the company travel in the fragment (never sent to a server). */
export function handoffUrl(slug: string, th: string, next = "/dashboard"): string {
  return `${tenantUrl(slug, "/auth/handoff")}#th=${encodeURIComponent(th)}&co=${encodeURIComponent(slug)}&next=${encodeURIComponent(next)}`;
}

/** Makes a company the active one (data and role follow it), then opens it. */
export async function switchCompany(tenantId: string, path = "/dashboard") {
  await ensureNoWaitingChanges();
  const { data, error } = await (supabase as any).rpc("switch_company", { p_tenant: tenantId });
  if (error) throw error;
  await goToCompany(String(data || ""), path);
}

/** Reads a handed-over session from the address (see goToCompany). */
export async function acceptHandoff(): Promise<string> {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const th = params.get("th");
  const at = params.get("at");
  const rt = params.get("rt");
  const next = params.get("next") || "/dashboard";
  // Drop the tokens from the address bar and history straight away.
  window.history.replaceState({}, "", window.location.pathname);
  if (th) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: th, type: "magiclink" });
    if (error) return "/login";
    // Opened from Admin by the platform owner after two-step sign-in there: this session skips it here.
    const sp = params.get("sp");
    if (sp && /^[a-f0-9]{48}$/.test(sp)) await (supabase as any).rpc("claim_support_pass", { p_token: sp }).then(() => undefined, () => undefined);
  } else if (at && rt) {
    const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
    if (error) return "/login";
  }
  // Make this address's company the active one now, so the dashboard opens straight into it
  // instead of loading, finding the login set to another company, switching and loading again.
  // The company of this address, or the one named in the hand-over (app. has no company in its address).
  const co = params.get("co");
  const host = getHostSlug() || (co && /^[a-z0-9-]{2,63}$/i.test(co) ? co : null);
  if (host && (th || (at && rt))) {
    try {
      const { data: t } = await (supabase as any).from("tenants_public").select("id").ilike("slug", host).maybeSingle();
      if (t?.id) await (supabase as any).rpc("switch_company", { p_tenant: t.id });
    } catch { /* the dashboard switches on its own when this did not */ }
  }
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
