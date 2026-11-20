import { Link, useLocation, useNavigate } from "react-router-dom";
import { Star, ChevronDown, ChevronLeft, Menu, PanelLeft, X, Moon, Sun, Search, Settings2, Settings as SettingsIcon, ChevronRight, LayoutGrid, Lock, Sparkles, LifeBuoy } from "lucide-react";
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { preloadPages, preloadRoute } from "@/lib/lazyPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { closeAllDropdowns } from "@/lib/singleDropdown";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessSettings } from "@/hooks/useData";
import { usePermissions, NAV_PERMISSION_MAP } from "@/hooks/usePermissions";
import { useTenantFeatures, type FeatureKey } from "@/hooks/useTenantFeatures";
import { useTenant } from "@/hooks/useTenant";
import { setBrand, tabTitle } from "@/lib/brand";
import { STOCK_PATHS } from "@/lib/sells";
import { useTheme } from "@/hooks/useTheme";
import { logoColor, saveCompanyTheme } from "@/lib/companyTheme";
import { NAV, PRIMARY, allLeaves, appsSection, type NavEntry, type NavLeaf, type NavSection } from "@/lib/navConfig";
import { useModules } from "@/hooks/useModules";
import { MODULES, suiteOf, MODULE_BY_KEY } from "@/lib/modules";
import { ROOT_HOST } from "@/lib/host";
import { DashMark } from "@/components/brand/DashLogo";
import CompanySwitcher from "@/components/CompanySwitcher";
import QuickCreate from "@/components/QuickCreate";
import { DashAILauncher } from "@/components/dashai/DashAILauncher";
import { NotebookLauncher } from "@/pages/notebook/NotebookLauncher";
import { BranchSwitcher } from "@/pages/branches/Branches";
import ClockPrompt from "@/components/ClockPrompt";
import DocViewer from "@/components/DocViewer";
import PoweredBy from "@/components/PoweredBy";
import NotificationBell from "@/components/NotificationBell";
import UserProfileMenu from "@/components/UserProfileMenu";
import OfflineIndicator from "@/components/OfflineIndicator";
import ForcePasswordChange from "@/components/ForcePasswordChange";
import TermsGate from "@/components/TermsGate";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { usePresence } from "@/hooks/usePresence";
import { useOpenTicketCount } from "@/lib/tickets";
import QuickFind from "@/components/QuickFind";
import PhoneDock, { PhoneButton } from "@/components/PhoneDock";
import { useNavLayout } from "@/hooks/useNavLayout";
import { DualSidebar, TopMenu, BottomDock, type AltNavProps } from "@/components/AltNav";
import { SystemNav, isSystemPath } from "@/pages/settings/SystemShell";

/**
 * Pages that belong to a paid suite outside /apps (the /apps pages check this themselves).
 * Without the suite switched on (trial, paid, comped or in the package) the page shows how to switch it on,
 * whatever way the person got there (menu, link, typed address). Garage Core pages are always open.
 */
const SUITE_PAGES: [string, string][] = [
  ["/crm", "crm"], ["/hrm", "hrm"], ["/pos", "commerce"], ["/sales/online-orders", "commerce"],
  ["/inventory/stock", "inventory"], ["/inventory/transfer", "inventory"], ["/marketing/sms", "marketing"],
  ["/callcentre", "callcentre"], ["/ai", "ai"], ["/accounting", "accounting"],
];
const suiteForPath = (path: string) => SUITE_PAGES.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] || null;

function SuiteOff({ suite, canSwitch }: { suite: string; canSwitch: boolean }) {
  const mod = MODULE_BY_KEY[suite];
  const Icon = mod?.icon || Lock;
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: mod?.color || "hsl(var(--primary))" }}><Icon className="h-8 w-8" /></span>
      <h1 className="mt-4 font-display text-2xl font-bold">{mod?.name || "This module"} is switched off</h1>
      <p className="mt-2 text-muted-foreground">{mod?.tagline || ""} {canSwitch ? "Switch it on in Modules: the first 14 days are free and your records are kept." : "Ask the owner, or someone with billing rights, to switch it on in Modules & billing."}</p>
      {canSwitch && <Link to={`/modules?app=${suite}`} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Open in Modules <ChevronRight className="h-4 w-4" /></Link>}
    </div>
  );
}

/** Module switches for menu paths (all on in this system, kept for role setups). */
const NAV_FEATURE_MAP: Record<string, FeatureKey> = {
  "/dashboard": "dashboard",
  "/customers": "customers",
  "/sales/quotes": "quotes",
  "/sales/invoices": "invoices",
  "/payments": "payments",
  "/purchases/suppliers": "suppliers",
  "/purchases/orders": "purchases",
  "/purchases/expenses": "expenses",
  "/purchases/bills": "expenses",
  "/purchases/recurring-bills": "expenses",
  "/purchases/recurring-expenses": "expenses",
  "/inventory/transfer": "inventory_transfer",
  "/reports": "reports",
  "/staff": "staff",
  "/audit-log": "audit_logs",
};

const prefetched = new Set<string>();
const prefetch = (path: string) => {
  if (prefetched.has(path)) return;
  prefetched.add(path);
  preloadRoute(path).catch(() => prefetched.delete(path));
};

/** Rows just above the side menu's foot (as in JMSURF ISP). */
const SIDE_EXTRA = [
  { path: "/whats-new", label: "What's new", icon: Sparkles },
  { path: "/help", label: "Help centre", icon: LifeBuoy },
];

const COLLAPSE_KEY = "garage.sidebar.collapsed";
const HIDDEN_KEY = "garage.sidebar.hidden";
const readFlag = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeFlag = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* per-device only */ } };

/**
 * After signing up for one app (Register ?app=crm), the owner's first visit switches
 * that app's trial on and keeps the company in single-app use. Also covers sign-ups
 * that confirmed their email first (no session at registration).
 */
function useStartApps(biz: any, isOwner: boolean) {
  const { user } = useAuth() as any;
  const queryClient = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    const meta = user?.user_metadata || {};
    const apps: string[] = Array.isArray(meta.start_apps) ? meta.start_apps : [];
    if (done.current || !isOwner || !biz?.id || !apps.length || biz.erp_settings?.start_applied) return;
    done.current = true;
    void (async () => {
      const sb = supabase as any;
      for (const key of apps) await sb.rpc("activate_module", { p_key: key }).catch(() => null);
      const { data } = await sb.from("business_settings").select("id,erp_settings").eq("id", biz.id).maybeSingle();
      await sb.from("business_settings").update({ erp_settings: { ...(data?.erp_settings || {}), start_applied: true, ...(meta.focus_app ? { focus_app: meta.focus_app } : {}) } }).eq("id", biz.id);
      window.dispatchEvent(new Event("dash:modules-changed"));
      queryClient.invalidateQueries();
    })();
  }, [user, biz?.id, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Star beside a menu entry: shows on hover, always when the page is a favourite. */
function FavStar({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <span role="button" tabIndex={0} aria-label={on ? "Remove from favourites" : "Add to favourites"} title={on ? "Remove from favourites" : "Add to favourites"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggle(); } }}
      className={cn("ws-fav rounded-md p-1 transition-opacity", on ? "-mr-1 opacity-100" : "absolute right-1 top-1/2 -translate-y-1/2 bg-sidebar opacity-0 group-hover:opacity-90 hover:!opacity-100 focus:opacity-100")}>
      <Star className={cn("h-3.5 w-3.5", on && "fill-current text-warning")} />
    </span>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // A list and its open record (/customers and /customers/<id>) are one page: moving between
  // records must not rebuild it (that reset the list's scroll and replayed the page animation).
  const pageKey = location.pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "");
  const navigate = useNavigate();
  const currentPathRef = useRef(location.pathname);
  currentPathRef.current = location.pathname;
  useRealtimeSync();
  // The signed-in workspace uses the device's own font at 14px, as JMSURF ISP does; pop-ups opened
  // outside the shell (dialogs, menus) follow it too. The website and sign-in pages keep theirs.
  useEffect(() => {
    document.documentElement.classList.add("erp-ws");
    return () => document.documentElement.classList.remove("erp-ws");
  }, []);


  const [collapsed, setCollapsedState] = useState(() => readFlag(COLLAPSE_KEY));
  const setCollapsed = (v: boolean) => { setCollapsedState(v); writeFlag(COLLAPSE_KEY, v); };
  const [sidebarHidden, setHiddenState] = useState(() => readFlag(HIDDEN_KEY));
  const setSidebarHidden = (v: boolean) => { setHiddenState(v); writeFlag(HIDDEN_KEY, v); };
  const [mobileOpen, setMobileOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [layout] = useNavLayout();
  const [sysMenu, setSysMenu] = useState(false);
  // Settings open as a page of their own; Close returns to where the person was working.
  useEffect(() => {
    if (!isSystemPath(location.pathname)) { try { sessionStorage.setItem("dash-before-settings", location.pathname + location.search); } catch { /* private mode */ } }
    setSysMenu(false);
  }, [location.pathname, location.search]);
  const closeSettings = () => { let back = "/dashboard"; try { back = sessionStorage.getItem("dash-before-settings") || back; } catch { /* private mode */ } navigate(back); };

  const { profile, role } = useAuth() as any;
  // Online now and time used, for the platform owner's Usage page.
  usePresence(!!profile?.tenant_id);
  const isAdmin = ["admin", "super_admin"].includes(String(role));
  const { data: bizSettings } = useBusinessSettings();
  const { hasPermission, ready: permsReady } = usePermissions();
  const { has, ready: featuresReady } = useTenantFeatures();
  const { has: hasModule, paid: paidModule, inMenu, hidden: hiddenModules, menuHidden, ready: modulesReady, active: activeModules } = useModules();
  const { data: customApps = [] } = useQuery({
    queryKey: ["app-definitions-nav", profile?.tenant_id], enabled: !!profile?.tenant_id && hasModule("studio"), staleTime: 60_000,
    queryFn: async () => ((await (supabase as any).from("app_definitions").select("app_key, name").order("name")).data || []) as { app_key: string; name: string }[],
  });
  const { tenant } = useTenant();
  // Another tab opened a different company with this login: offer to switch back.
  const [moved, setMoved] = useState(false);
  useEffect(() => { const on = () => setMoved(true); window.addEventListener("dash:company-moved", on); return () => window.removeEventListener("dash:company-moved", on); }, []);
  const { darkMode, toggleDarkMode, theme: localTheme, setTheme: setLocalTheme } = useTheme();
  useEffect(() => {
    if (!bizSettings) return;
    const t = (bizSettings as any).theme as { preset?: string | null; custom?: string | null } | null;
    if (t && (t.preset || t.custom)) {
      const preset = t.preset || localTheme.preset, custom = t.custom || null;
      if (preset !== localTheme.preset || custom !== localTheme.custom) setLocalTheme({ preset, custom });
    } else if (isAdmin && profile?.tenant_id && (localTheme.custom || localTheme.preset !== "JMSURF Garage")) {
      // A colour chosen before themes were saved for the company becomes the company's.
      void saveCompanyTheme(profile.tenant_id, { preset: localTheme.custom ? null : localTheme.preset, custom: localTheme.custom });
    } else if (isAdmin && profile?.tenant_id && tenant?.logo_url) {
      // No colour chosen yet: take it from the company logo.
      const tid = profile.tenant_id;
      void fetch(tenant.logo_url).then((r) => r.blob()).then(logoColor).then((hex) => {
        if (!hex) return;
        setLocalTheme({ custom: hex });
        void saveCompanyTheme(tid, { preset: null, custom: hex });
      }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(bizSettings as any)?.theme, bizSettings ? 1 : 0, tenant?.logo_url]);
  const openTickets = useOpenTicketCount(permsReady);

  const businessName = (bizSettings?.business_name || tenant?.business_name || "JMSURF Garage") as string;
  const logoUrl = tenant?.logo_url || null;
  useEffect(() => { if (tenant) setBrand(businessName, logoUrl, (tenant as any).favicon_url || null); }, [tenant, businessName, logoUrl]);

  // Ctrl/Cmd+K opens Quick find anywhere in the ERP.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setFindOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mainRef = useRef<HTMLElement>(null);
  const currentPath = location.pathname;

  // Single-app use (signed up for one app, e.g. CRM): the menu shows that app and any
  // others switched on later, not the accounting suite, until "Show the full suite".
  const focusApp: string | null = (bizSettings as any)?.erp_settings?.focus_app || null;
  const focusHome = focusApp ? MODULES.find((m) => m.key === focusApp)?.home || null : null;
  useStartApps(bizSettings as any, isAdmin);
  useEffect(() => {
    if (focusHome && (currentPathRef.current === "/" || currentPathRef.current === "/dashboard")) navigate(focusHome, { replace: true });
  }, [focusHome, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const { user } = useAuth() as any;
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => { const v = user?.user_metadata?.nav_favs; setFavs(Array.isArray(v) ? v : []); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFav = (path: string) => {
    const next = favs.includes(path) ? favs.filter((p) => p !== path) : [...favs, path].slice(0, 15);
    setFavs(next);
    void supabase.auth.updateUser({ data: { nav_favs: next } });
  };

  const navReady = permsReady && featuresReady && modulesReady;
  const servicesOnly = (bizSettings as any)?.sells === "services";
  // The sign-up answer ("What do you sell?") is saved for the company on the owner's first visit.
  const { user: authUser } = useAuth() as any;
  useEffect(() => {
    const pickedAtSignup = authUser?.user_metadata?.sells;
    if (!bizSettings || (bizSettings as any).sells || !pickedAtSignup || !isAdmin || !profile?.tenant_id) return;
    void (supabase as any).from("business_settings").update({ sells: pickedAtSignup }).eq("tenant_id", profile.tenant_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizSettings ? 1 : 0]);
  const allowed = (path: string, module?: string) => {
    if (servicesOnly && STOCK_PATHS.includes(path)) return false;
    if (focusApp && path !== "/settings" && (!module || suiteOf(module) === "garage_core")) return false;
    if (module && !hasModule(module)) return false;
    const perm = NAV_PERMISSION_MAP[path];
    if (perm && !hasPermission(perm)) return false;
    const feature = NAV_FEATURE_MAP[path];
    return !feature || has(feature);
  };
  // Only the MOST SPECIFIC menu entry owns the page: "/garage" (Job cards) must not also claim
  // "/garage/insurance/…", or two groups (Workshop + Insurance) open together.
  const pathHits = (leaf: NavLeaf) =>
    [leaf.path, ...(leaf.match || [])].filter((p) => currentPath === p || currentPath.startsWith(p + "/"));
  const bestHit = useMemo(
    () => allLeaves().reduce((best, { leaf }) => Math.max(best, ...pathHits(leaf).map((p) => p.length)), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPath],
  );
  const isActive = (leaf: NavLeaf) => pathHits(leaf).some((p) => p.length >= bestHit);

  const sections = useMemo(() => {
    if (!navReady) return [];
    const all: NavSection[] = [...NAV, appsSection(inMenu, customApps)];
    const leaves = allLeaves();
    const favEntries = favs.map((p) => leaves.find((x) => x.leaf.path === p)?.leaf).filter((l): l is NavLeaf => !!l && allowed(l.path, l.module));
    const withFavs: NavSection[] = favEntries.length ? [{ title: "Favourites", entries: favEntries.map((l) => ({ ...l, fav: true } as any)) }, ...all] : all;
    return withFavs.map((s) => ({
      ...s,
      entries: s.entries
        .map((e): (NavEntry & { locked?: boolean }) | null => {
          // A main group whose module is off is hidden (switch it on from the app store).
          if (e.module && !inMenu(e.module)) return null;
          if (servicesOnly && STOCK_PATHS.includes(e.path)) return null;
          // A whole menu switched off under Settings → Customization → Menu items.
          if (e.children && menuHidden.has(e.path)) return null;
          if (e.paid && !paidModule(e.module)) return null;
          if (!e.children) return allowed(e.path, e.module) ? e : null;
          const kids = e.children.filter((c) => allowed(c.path, c.module) && !menuHidden.has(c.path));
          return kids.length ? { ...e, children: kids } : null;
        })
        .filter(Boolean) as (NavEntry & { locked?: boolean })[],
    })).filter((s) => s.entries.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navReady, hasPermission, has, activeModules, hiddenModules, menuHidden, customApps, focusApp, favs, servicesOnly]);

  const primary = navReady ? PRIMARY.filter((p) => allowed(p.path, p.module)) : [];

  // One dropdown open at a time; undefined = follow the current page.
  const [openMenu, setOpenMenu] = useState<string | null | undefined>(undefined);
  useEffect(() => { closeAllDropdowns(); mainRef.current?.scrollTo(0, 0); setMobileOpen(false); setOpenMenu(undefined); }, [location.pathname]);
  // The menu keeps its own scroll position: clicking an entry changes only the
  // page, never where the menu is scrolled. On first load, show the open page.
  const navRef = useRef<HTMLElement | null>(null);
  const navScroll = useRef(0);
  const navShown = useRef(false);
  useLayoutEffect(() => {
    const el = navRef.current; if (!el) return;
    if (!navShown.current) return;
    if (Math.abs(el.scrollTop - navScroll.current) > 1) el.scrollTop = navScroll.current;
  });
  useEffect(() => {
    if (navShown.current) return;
    const t = setTimeout(() => { document.querySelector("aside [data-nav-active]")?.scrollIntoView({ block: "nearest" }); navShown.current = true; navScroll.current = navRef.current?.scrollTop || 0; }, 300);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const pageTitle = (() => {
    // The most specific match wins (/hrm/leave over /hrm).
    const score = (leaf: NavLeaf) => Math.max(...[leaf.path, ...(leaf.match || [])].map((p) => (currentPath === p || currentPath.startsWith(p + "/") ? p.length : -1)));
    const hit = allLeaves().filter(({ leaf }) => isActive(leaf)).sort((x, y) => score(y.leaf) - score(x.leaf))[0];
    if (!hit) return { section: "", title: "", leaf: null as NavLeaf | null };
    return { section: hit.parent?.label || hit.section || "", title: hit.leaf.label, leaf: hit.leaf as NavLeaf | null };
  })();
  // Browser tab title follows the open page.
  useEffect(() => {
    if (!pageTitle.title) return;
    const t = setTimeout(() => { document.title = tabTitle(pageTitle.title); }, 400);
    return () => clearTimeout(t);
  }, [location.pathname, pageTitle.title]);

  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setSidebarHidden(!sidebarHidden);
    else setMobileOpen(!mobileOpen);
  };
  // The code of the pages in this person's menu loads quietly in the background, so a menu click swaps only the page.
  useEffect(() => {
    if (!navReady) return;
    preloadPages(["/dashboard", "/settings", "/profile", ...sections.flatMap((s) => s.entries.flatMap((e) => ("children" in e && e.children ? e.children.map((c) => c.path) : [e.path])))]);
  }, [navReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: myApprovals = 0 } = useQuery({
    queryKey: ["approvals-badge", profile?.user_id],
    enabled: !!profile?.user_id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await (supabase as any).from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "pending").neq("doc_type", "requisition").contains("approvers", [profile.user_id]);
      // Requisitions waiting for a manager count too.
      const mgr = ["admin", "manager", "super_admin"].includes(String(role));
      const reqs = mgr ? (await (supabase as any).from("requisitions").select("id", { count: "exact", head: true }).eq("status", "pending_approval")).count || 0 : 0;
      return (count || 0) + reqs;
    },
  });
  const badgeFor = (path: string) => (path === "/tickets" ? openTickets : path === "/approvals" ? myApprovals : 0);

  const altNav: AltNavProps = {
    entries: sections.flatMap((s) => s.entries), isActive, activeLeaf: pageTitle.leaf, badgeFor, prefetch,
    onFind: () => setFindOpen(true), currentPath, showModules: isAdmin, showSettings: allowed("/settings"),
  };

  if (profile?.must_change_password) return <ForcePasswordChange />;

  if (isSystemPath(currentPath)) return (
    <div className="ws-shell flex h-screen flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
      <header className="ws-top print:hidden">
        <button onClick={() => setSysMenu(!sysMenu)} className="ws-ib lg:hidden" aria-label="Settings menu"><Menu /></button>
        <div className="ws-crumb">
          <span className="hidden sm:inline">Settings</span><ChevronRight className="hidden sm:block" />
          <b>{businessName}</b>
        </div>
        <span className="ml-auto" />
        <button onClick={toggleDarkMode} className="ws-ib" aria-label={darkMode ? "Light mode" : "Dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>{darkMode ? <Sun /> : <Moon />}</button>
        <span className="ws-gear is-on hidden sm:grid" aria-hidden><Settings2 /></span>
        <div className="ws-user"><UserProfileMenu variant="default" /></div>
        <button onClick={closeSettings} className="ws-pill" aria-label="Close settings">
          <X className="h-4 w-4" /><span className="hidden sm:inline">Close</span>
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {sysMenu && <div className="fixed inset-0 top-[60px] z-40 bg-foreground/30 lg:hidden" onClick={() => setSysMenu(false)} />}
        <aside className={cn("ws-side print:hidden z-50 w-[min(272px,86vw)] shrink-0 overflow-y-auto overscroll-contain transition-transform duration-300",
          "fixed bottom-0 left-0 top-[60px] lg:static lg:w-[272px] lg:translate-x-0", sysMenu ? "translate-x-0 shadow-2xl" : "-translate-x-full")}>
          <SystemNav onPick={() => setSysMenu(false)} />
        </aside>
        <main ref={mainRef} className="erp-main erp-rhythm relative isolate min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 lg:pb-2.5 lg:pl-4 lg:pr-5 lg:pt-3.5 print:overflow-visible print:p-0">
          <div key={pageKey} className="ft-page-in w-full">{children}</div>
        </main>
      </div>
      <DocViewer />
      <OfflineIndicator />
      <TermsGate />
      <QuickFind open={findOpen} onClose={() => setFindOpen(false)} />
    </div>
  );

  const Count = ({ n, tiny }: { n: number; tiny?: boolean }) =>
    n ? <span className={cn("ws-count", tiny && "is-tiny")}>{n > 99 ? "99+" : n}</span> : null;

  return (
    <div className="ws-shell flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Side menu as in JMSURF ISP: flush full height, logo block as tall as the top bar, section labels, flat rows. */}
      <aside
        className={cn(
          "ws-side print:hidden fixed lg:static inset-y-0 left-0 z-50 flex flex-col transition-[width,transform] duration-300",
          collapsed ? "is-collapsed w-[min(272px,86vw)] lg:w-[64px]" : "w-[min(272px,86vw)] lg:w-[232px]",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0",
          (sidebarHidden || layout !== "classic") && "lg:hidden",
        )}
      >
        <div className="ws-org">
          {logoUrl && !collapsed ? (
            <Link to="/dashboard" className="flex min-w-0 flex-1 justify-center" title={businessName}>
              <img src={logoUrl} alt={businessName} className="ws-org-logo dark:rounded-lg dark:bg-white dark:px-2 dark:py-1" />
            </Link>
          ) : logoUrl ? (
            <Link to="/dashboard" title={businessName} className="shrink-0"><img src={logoUrl} alt={businessName} className="h-[34px] w-[34px] rounded-[10px] bg-white object-contain p-0.5 ring-1 ring-border" /></Link>
          ) : (
            <Link to="/dashboard" title={businessName} className="shrink-0"><DashMark className="h-[34px] w-[34px]" /></Link>
          )}
          {!collapsed && !logoUrl && (
            <div className="min-w-0 flex-1">
              <b className="block truncate text-[14px] font-bold leading-tight tracking-[-0.01em]" title={businessName}>{businessName}</b>
            </div>
          )}
          <button onClick={() => setMobileOpen(false)} className="ws-ib -mr-1 ml-auto lg:hidden" aria-label="Close menu">
            <X />
          </button>
        </div>

        <nav ref={navRef} onScroll={(e) => { if (navShown.current) navScroll.current = e.currentTarget.scrollTop; }} className="ws-nav flex-1 overflow-y-auto overscroll-contain" aria-busy={!navReady}>
          {!navReady && (
            <div className="space-y-0.5 pt-1" aria-hidden>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={cn("flex h-9 items-center gap-2.5 px-2.5", collapsed && "lg:justify-center")}>
                  <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-foreground/10" />
                  {!collapsed && <span className="h-3 animate-pulse rounded bg-foreground/10" style={{ width: `${55 + ((i * 17) % 35)}%` }} />}
                </div>
              ))}
            </div>
          )}

          {sections.map((section) => (
            <div key={section.title || "top"}>
              {section.title && <div className="ws-nav-label">{section.title}</div>}
              {section.title && <div className="ws-nav-rule" aria-hidden />}

              {section.entries.map((item) => {
                if (item.children) {
                  const childActive = item.children.some(isActive);
                  const open = openMenu === undefined ? childActive : openMenu === item.path;
                  const groupBadge = item.children.reduce((a, c) => a + badgeFor(c.path), 0);
                  return (
                    <div key={item.path}>
                      <button
                        onClick={() => {
                          closeAllDropdowns();
                          if (collapsed && window.matchMedia("(min-width: 1024px)").matches) { setCollapsed(false); setOpenMenu(item.path); return; }
                          setOpenMenu((prev) => (prev === item.path || (prev === undefined && childActive) ? null : item.path));
                        }}
                        title={collapsed ? item.label : undefined}
                        aria-expanded={open}
                        className={cn("group ws-nav-row is-group", childActive && "has-active")}
                      >
                        <item.icon className="ws-nav-ico" />
                        <span className="ws-nav-text">{item.label}</span>
                        {!open && <Count n={groupBadge} tiny={collapsed} />}
                        {(item as any).locked && <Lock className="ws-lock" aria-label="Module off" />}
                        <ChevronDown className={cn("ws-caret", open && "rotate-180")} />
                      </button>
                      {open && (
                        <div className="ws-nav-sub animate-in fade-in-0 slide-in-from-top-1">
                          {item.children.map((child) => {
                            const active = pageTitle.leaf ? pageTitle.leaf === child : isActive(child);
                            return (
                              <Link
                                key={child.path}
                                to={child.path}
                                data-nav-active={active || undefined}
                                aria-current={active ? "page" : undefined}
                                onClick={() => { closeAllDropdowns(); setOpenMenu(item.path); }}
                                onMouseEnter={() => prefetch(child.path)}
                                onFocus={() => prefetch(child.path)}
                                className={cn("group ws-nav-row is-child", active && "is-active")}
                              >
                                <child.icon className="ws-nav-ico" />
                                <span className="ws-nav-text">{child.label}</span>
                                <Count n={badgeFor(child.path)} />
                                <FavStar on={favs.includes(child.path)} onToggle={() => toggleFav(child.path)} />
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                const active = isActive(item) || (item.path === "/dashboard" && currentPath === "/");
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    data-nav-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => { closeAllDropdowns(); setOpenMenu(null); }}
                    onMouseEnter={() => prefetch(item.path)}
                    onFocus={() => prefetch(item.path)}
                    title={collapsed ? item.label : undefined}
                    className={cn("group ws-nav-row", active && "is-active")}
                  >
                    <item.icon className="ws-nav-ico" />
                    <span className={cn("ws-nav-text", (item as any).locked && "opacity-60")}>{item.label}</span>
                    {!(item as any).locked && item.path !== "/dashboard" && <FavStar on={favs.includes(item.path)} onToggle={() => toggleFav(item.path)} />}
                    {(item as any).locked && <Lock className="ws-lock" aria-label="Module off" />}
                    <Count n={badgeFor(item.path)} tiny={collapsed} />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* What's new and Help sit just above the foot, as in JMSURF ISP. */}
        <div className="ws-side-extra">
          {SIDE_EXTRA.map(({ path, label, icon: Icon }) => {
            const active = currentPath === path || currentPath.startsWith(path + "/");
            return (
              <Link key={path} to={path} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined}
                onMouseEnter={() => prefetch(path)} className={cn("group ws-nav-row", active && "is-active")}>
                <Icon className="ws-nav-ico" /><span className="ws-nav-text">{label}</span>
              </Link>
            );
          })}
          <div className="ws-side-foot">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}
            >
              <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
            </button>
            <PoweredBy className="ws-powered ml-auto whitespace-nowrap text-right text-[10px]" />
          </div>
        </div>
      </aside>

      {layout === "dual" && navReady && <DualSidebar {...altNav} />}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        {/* Top bar as in JMSURF ISP: flush, 60px, page name, search pill, quiet icon buttons, gear, name and role. */}
        <header className="ws-top print:hidden">
          <button onClick={toggleSidebar} className={cn("ws-ib", layout !== "classic" && "lg:hidden")} aria-label="Menu" title="Menu">
            <Menu className="lg:hidden" />
            <PanelLeft className="hidden lg:block" />
          </button>
          {layout !== "classic" && (
            <Link to="/dashboard" className="hidden shrink-0 items-center gap-2 lg:flex" title={businessName}>
              {logoUrl ? <img src={logoUrl} alt="" className="h-9 w-9 rounded-[10px] bg-white object-contain p-1 ring-1 ring-border" /> : <DashMark className="h-9 w-9" />}
              <span className="hidden max-w-[11rem] truncate text-sm font-bold 2xl:block">{businessName}</span>
              <span className="mx-1 h-6 w-px bg-border" />
            </Link>
          )}
          <div className="ws-crumb" title={pageTitle.section ? `${pageTitle.section} › ${pageTitle.title}` : undefined}>
            <b>{pageTitle.title || businessName}</b>
          </div>
          <button onClick={() => setFindOpen(true)} className="ws-search hidden lg:flex" aria-label="Search">
            <Search /><span>Search or jump to…</span><kbd>Ctrl K</kbd>
          </button>
          <button onClick={() => setFindOpen(true)} className="ws-ib ml-auto lg:hidden" aria-label="Quick find">
            <Search />
          </button>
          <div className="ws-acts">
            <BranchSwitcher />
            <CompanySwitcher />
            <QuickCreate canPos={currentPath !== "/pos" && hasModule("pos")} />
            <DashAILauncher />
            <span className="hidden sm:contents"><NotebookLauncher /></span>
            {modulesReady && hasModule("callcentre") && <PhoneButton />}
            <button onClick={toggleDarkMode} className="ws-ib hidden xl:grid" aria-label={darkMode ? "Light mode" : "Dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>
              {darkMode ? <Sun /> : <Moon />}
            </button>
            <NotificationBell makePath={(p: string) => p} />
            {allowed("/settings") && (
              <button onClick={() => navigate("/settings")} aria-label="Settings" title="Settings" className="ws-gear hidden md:grid">
                <SettingsIcon />
              </button>
            )}
            <div className="ws-user"><UserProfileMenu variant="default" settings={allowed("/settings")} help darkMode={darkMode} onToggleDark={toggleDarkMode} /></div>
          </div>
        </header>

        {layout === "top" && navReady && <TopMenu {...altNav} />}
        {tenant?.slug === "demo" && (
          <div className="print:hidden flex items-center gap-2 border-b border-info/30 bg-info/10 px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm">
            <span className="min-w-0 flex-1"><b>Live demo.</b><span className="hidden sm:inline"> Try anything: it is put back every night and nothing is sent to anyone.</span><span className="sm:hidden"> Reset nightly.</span></span>
            <a href={`https://${ROOT_HOST}/register`} className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"><span className="sm:hidden">Start free</span><span className="hidden sm:inline">Create your own company, free</span></a>
          </div>
        )}

        {moved && tenant && (
          <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm print:hidden">
            <span>You opened another company in a different tab. This tab shows <b>{tenant.business_name}</b>.</span>
            <button onClick={async () => { await (supabase as any).rpc("switch_company", { p_tenant: tenant.id }); window.location.reload(); }} className="ml-auto rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">Continue here</button>
          </div>
        )}
        {/* Page frame as in JMSURF ISP (14px 20px 10px 16px on computers). The till keeps its own sizing (no .erp-rhythm). */}
        <main ref={mainRef} className={cn("erp-main relative isolate print:overflow-visible print:p-0 flex-1 overflow-y-auto overflow-x-hidden p-3 lg:pl-4 lg:pr-5 lg:pt-3.5", currentPath !== "/pos" && "erp-rhythm", primary.length ? "pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-3" : "pb-3", "lg:pb-2.5", layout === "bottom" && "lg:pb-28")}>
          <div key={pageKey} className="ft-page-in">{(() => {
            const suite = suiteForPath(currentPath);
            return suite && modulesReady && !hasModule(suite) ? <SuiteOff suite={suite} canSwitch={isAdmin} /> : children;
          })()}</div>
        </main>
        <ClockPrompt />
        <DocViewer />

        {primary.length > 0 && (
          <nav aria-label="Main" className="print:hidden notch-nav md-hide" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
              {primary.map(({ path, label, icon: Icon }) => {
                const active = currentPath === path || currentPath.startsWith(path + "/");
                return (
                  <Link key={path} to={path} onTouchStart={() => prefetch(path)} aria-current={active ? "page" : undefined}
                    className={cn("notch-item", active && !mobileOpen && "is-active")}>
                    <span className="notch-ico"><Icon /></span>
                    <span>{label}</span>
                  </Link>
                );
              })}
              <button onClick={() => setMobileOpen(true)} className={cn("notch-item border-0 bg-transparent", mobileOpen && "is-active")} aria-label="Open the full menu">
                <span className="notch-ico"><LayoutGrid /></span>
                <span>Menu</span>
              </button>
          </nav>
        )}
        {layout === "bottom" && navReady && <BottomDock {...altNav} />}
        {modulesReady && hasModule("callcentre") && <PhoneDock />}
        <OfflineIndicator />
        <TermsGate />
      </div>

      <QuickFind open={findOpen} onClose={() => setFindOpen(false)} />
    </div>
  );
}
