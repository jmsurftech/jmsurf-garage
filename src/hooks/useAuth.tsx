import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { cacheAuthData, getCachedAuthData, wipeAllOfflineCaches } from "@/lib/offlineDb";
import { logActivity, buildAuthEventMetadata } from "@/lib/auditLog";

interface Subscription {
  id: string;
  status: string;
  trial_ends_at: string | null;
  plan_name: string;
  plan_id?: string | null;
  billing_cycle: string;
  price: number;
  max_users?: number;
  max_locations?: number;
  current_period_end: string | null;
}

interface Profile {
  display_name: string;
  store_location: string;
  tenant_id?: string;
  must_change_password?: boolean;
}

interface AuthContext {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  role: string | null;
  /** True once the profile/role lookup has finished (successfully or not). */
  profileReady: boolean;
  subscription: Subscription | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext>({
  user: null, session: null, loading: true, profile: null, role: null, profileReady: false, subscription: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthCtx);

const LOGIN_LOGGED = "dash-login-logged";
const alreadyLogged = (userId: string) => {
  try {
    if (sessionStorage.getItem(LOGIN_LOGGED) === userId) return true;
    sessionStorage.setItem(LOGIN_LOGGED, userId);
  } catch { /* private mode */ }
  return false;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const profileLoad = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    const { data: { subscription: sub } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchProfile(session.user.id), 0);
        // The browser client also says SIGNED_IN on every page load and tab return: log a sign-in once per tab.
        if (event === "SIGNED_IN" && !alreadyLogged(session.user.id)) {
          (async () => {
            const metadata = await buildAuthEventMetadata({ auth_event: "SIGNED_IN" });
            logActivity({
              action: "login",
              entity_type: "session",
              entity_id: (metadata as any).session_id,
              description: `User signed in (${(metadata as any).browser} on ${(metadata as any).os})`,
              metadata,
            });
          })();
        }
      } else {
        setProfile(null);
        setRole(null);
        setSubscription(null);
        setProfileReady(true);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        // No session - try loading cached auth for offline
        loadCachedAuth().then(() => { setProfileReady(true); setLoading(false); });
      }
      if (session?.user) setLoading(false);
    });

    return () => sub.unsubscribe();
  }, []);

  // Keep the package, price and limits live when an admin edits this shop.
  useEffect(() => {
    const tenantId = profile?.tenant_id;
    const userId = user?.id;
    if (!tenantId || !userId) return;
    const channel = supabase
      .channel(`auth-subscription-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `tenant_id=eq.${tenantId}` },
        () => void loadProfile(userId),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.tenant_id, user?.id]);

  async function loadCachedAuth() {
    if (navigator.onLine) return;
    try {
      const cached = await getCachedAuthData("auth_state");
      if (cached) {
        setProfile(cached.profile || null);
        setRole(cached.role || null);
        setSubscription(cached.subscription || null);
        // Restore user/session from cache for offline navigation
        if (cached.user) setUser(cached.user);
        if (cached.session) setSession(cached.session);
      }
    } catch (e) {
      console.log("Failed to load cached auth:", e);
    }
  }

  /** Page load announces the session up to three times; they all share one lookup. */
  function fetchProfile(userId: string) {
    if (profileLoad.current?.userId === userId) return profileLoad.current.promise;
    const promise = loadProfile(userId).finally(() => { if (profileLoad.current?.promise === promise) profileLoad.current = null; });
    profileLoad.current = { userId, promise };
    return promise;
  }

  async function loadProfile(userId: string) {
    if (!navigator.onLine) {
      // Offline: use cached data
      try {
        const cached = await getCachedAuthData("auth_state");
        if (cached) {
          setProfile(cached.profile || null);
          setRole(cached.role || null);
          setSubscription(cached.subscription || null);
        }
      } catch (e) {
        console.log("Failed to load cached profile:", e);
      }
      setProfileReady(true);
      return;
    }

    // Open at once from the copy saved on this device at the last visit, then refresh
    // quietly below (this used to wait for three lookups in a row before any page drew).
    let saved: any = null;
    try { saved = await getCachedAuthData("auth_state"); } catch { /* none */ }
    if (saved?.profile && saved.user?.id === userId) {
      setProfile(saved.profile);
      setRole(saved.role || null);
      if (saved.subscription) setSubscription(saved.subscription);
      setProfileReady(true);
    }
    const subSelect = "id, status, trial_ends_at, plan_name, plan_id, billing_cycle, price, max_users, max_locations, current_period_end, suspended_reason";
    const subFor = (tenantId: string) => supabase.from("subscriptions").select(subSelect)
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // The company is nearly always the same as last time: ask for its plan alongside the profile.
    const guessedTenant: string | null = saved?.user?.id === userId ? saved?.profile?.tenant_id || null : null;
    const subEarly = guessedTenant ? subFor(guessedTenant) : null;

    try {
      const [{ data: prof }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("display_name, store_location, tenant_id, must_change_password").eq("user_id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);

      let userRole: string | null = roles?.[0] ? (roles[0] as any).role : null;
      // On the super admin address the platform owner works as super_admin.
      if (typeof window !== "undefined" && (window.location.hostname.startsWith("admin.") || window.location.hostname === "sys-garage.jmsurfsys.co.ke")) {
        // Retried: a slow or failed check must not drop the owner to a normal role.
        for (let i = 0; i < 3; i++) {
          const { data: isOwner, error } = await (supabase as any).rpc("is_platform_admin");
          if (!error) { if (isOwner === true) userRole = "super_admin"; break; }
          await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        }
      }

      if (prof) {
        let subData: Subscription | null = null;
        if ((prof as any).tenant_id) {
          const { data: sd } = await (subEarly && guessedTenant === (prof as any).tenant_id ? subEarly : subFor((prof as any).tenant_id));
          if (sd) subData = sd as any;

          // Safety net: an account with no saved role must never leave the app
          // stuck on a loading screen. Shop owners get full access, others get
          // the basic till role until an admin changes it.
          if (!userRole) {
            try {
              const { data: t } = await (supabase as any)
                .from("tenants")
                .select("owner_user_id")
                .eq("id", (prof as any).tenant_id)
                .maybeSingle();
              userRole = t?.owner_user_id === userId ? "admin" : "cashier";
            } catch {
              userRole = "cashier";
            }
          }
        }

        // Together, so the company is looked up once rather than once for each of them.
        setProfile(prof as any);
        if (subData) setSubscription(subData);
        setRole(userRole);
        setProfileReady(true);

        // Cache auth state for offline use
        try {
          const currentSession = (await supabase.auth.getSession()).data.session;
          await cacheAuthData("auth_state", {
            profile: prof,
            role: userRole,
            subscription: subData,
            user: currentSession?.user || null,
            session: currentSession,
          });
        } catch (e) {
          console.log("Failed to cache auth:", e);
        }
      } else if (userRole) {
        setRole(userRole);
      }
    } catch (e) {
      console.warn("[Auth] profile load failed:", e);
    } finally {
      setProfileReady(true);
    }
  }


  const signOut = async () => {
    // The saved copy of this company's data never outlives the session.
    try { localStorage.removeItem("dash-cache-v1"); sessionStorage.removeItem(LOGIN_LOGGED); } catch { /* blocked */ }
    void import("@/lib/queryPersist").then((m) => m.clearDeviceCache()).catch(() => undefined);
    const tenantId = profile?.tenant_id || null;
    if (user && tenantId) {
      try {
        const metadata = await buildAuthEventMetadata({ auth_event: "SIGNED_OUT" });
        const eventId = crypto.randomUUID();
        const payload = {
          tenant_id: tenantId,
          user_id: user.id,
          user_email: user.email ?? null,
          user_display_name: profile?.display_name ?? null,
          action: "logout",
          entity_type: "session",
          entity_id: (metadata as any).session_id,
          description: `User signed out (${(metadata as any).browser} on ${(metadata as any).os})`,
          metadata,
          event_id: eventId,
        };
        if (navigator.onLine) {
          const { error } = await (supabase as any).from("user_activity_log").insert(payload);
          if (error && String(error.code) !== "23505") {
            const { addToSyncQueue } = await import("@/lib/offlineDb");
            await addToSyncQueue({ table: "user_activity_log", action: "insert", payload });
          }
        } else {
          const { addToSyncQueue } = await import("@/lib/offlineDb");
          await addToSyncQueue({ table: "user_activity_log", action: "insert", payload });
        }
      } catch (e) { console.warn("Logout audit failed:", e); }
    }
    // Wipe all offline caches FIRST so no tenant data lingers between accounts
    try { await wipeAllOfflineCaches(); } catch (e) { console.warn("Cache wipe failed:", e); }
    await supabase.auth.signOut({ scope: "local" });
    // Drop every in-memory query too, so the next account never starts from
    // the previous one's shop, branch or product list.
    try { queryClient.clear(); } catch { /* cache already gone */ }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
    setSubscription(null);
  };

  const refreshProfile = async () => {
    if (user?.id) await loadProfile(user.id);
  };

  return (
    <AuthCtx.Provider value={{ user, session, loading, profile, role, profileReady, subscription, signOut, refreshProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}
