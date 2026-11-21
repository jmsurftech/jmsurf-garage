import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageBoundary from "@/components/PageBoundary";
import { OrbLoader } from "@/components/Orb";
import {
  LayoutDashboard, Building2, CreditCard, FileText, Settings, Banknote, Users, Activity, Menu, X, BarChart3, ExternalLink, ChevronLeft, PanelLeft, HeartPulse, Globe, MessagesSquare, Grid2x2, Sun, Moon, Search, Target, Bell, UserRound, LogOut, Headset, KeyRound, Wifi } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { closeAllDropdowns } from "@/lib/singleDropdown";
import { DashMark } from "@/components/brand/DashLogo";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { preloadPages } from "@/lib/lazyPage";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import AdminLogin from "./AdminLogin";
import { SessionTimeoutManager } from "@/hooks/useSessionTimeout";
import PhoneDock from "@/components/PhoneDock";

type NavItem = { to: string; icon: any; label: string; exact?: boolean };
type NavSection = { label: string; items: NavItem[] };

const NAV: NavSection[] = [
  { label: "Overview", items: [{ to: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true }] },
  {
    // A company's plan, modules, users, SMS, notes and activity are all on its own page.
    label: "Companies",
    items: [
      { to: "/admin/companies", icon: Building2, label: "Companies" },
      { to: "/admin/users", icon: Users, label: "Users" },
      { to: "/admin/domains", icon: Globe, label: "Domains" },
      { to: "/admin/etims-tokens", icon: KeyRound, label: "KRA tokens" },
    ],
  },
  {
    label: "Sales",
    items: [
      { to: "/admin/leads", icon: Target, label: "Leads & CRM" },
      { to: "/admin/support", icon: Headset, label: "Support" },
      { to: "/admin/payments", icon: Banknote, label: "Payments" },
    ],
  },
  {
    label: "Pricing",
    items: [
      { to: "/admin/subscriptions", icon: CreditCard, label: "Plans" },
      { to: "/admin/modules", icon: Grid2x2, label: "Modules & prices" },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/admin/reports", icon: BarChart3, label: "Reports" },
      { to: "/admin/messages", icon: MessagesSquare, label: "Messages" },
      { to: "/admin/usage", icon: Wifi, label: "Usage & sign-ins" },
      { to: "/admin/audit", icon: Activity, label: "Audit log" },
      { to: "/admin/health", icon: HeartPulse, label: "System health" },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/admin/cms", icon: FileText, label: "Website content" },
      { to: "/admin/notifications", icon: Bell, label: "Notifications" },
      { to: "/admin/settings", icon: Settings, label: "Settings" },
    ],
  },
];

const COLLAPSE_KEY = "admin.sidebar.collapsed";
const HIDDEN_KEY = "admin.sidebar.hidden";
const readFlag = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeFlag = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* per-device preference only */ } };

/** Length of the menu path that covers this page, or -1 when the entry does not cover it. */
function hitLength(item: NavItem, pathname: string) {
  const hit = item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return hit ? item.to.length : -1;
}
/**
 * Only the MOST SPECIFIC menu entry owns the page (the workspace menu's `bestHit` rule), so a
 * shorter entry never lights up, or opens its section, together with a longer one.
 */
function bestHit(pathname: string) {
  return NAV.reduce((best, s) => Math.max(best, ...s.items.map((i) => hitLength(i, pathname))), -1);
}
function isActive(item: NavItem, pathname: string, best: number) {
  const len = hitLength(item, pathname);
  return len >= 0 && len >= best;
}

export default function AdminLayout() {
  const { role, user, loading } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  useEffect(() => { preloadPages(); }, []);
  // With an authenticator app switched on, the password alone is not enough:
  // the portal stays on the code screen until this session reaches aal2.
  const [aal, setAal] = useState<"checking" | "ok" | "needs_code">("checking");
  useEffect(() => {
    if (!user) { setAal("checking"); return; }
    let cancelled = false;
    const check = async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (error) { setAal("needs_code"); return; }
      setAal(data?.nextLevel === "aal2" && data?.currentLevel !== "aal2" ? "needs_code" : "ok");
    };
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void check(); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [user?.id]);
  // The platform owner works as super admin only on this address (see enter_platform).
  // A second check (never a page reload): confirms the owner when the first one was slow.
  const [confirmedOwner, setConfirmedOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user || role === "super_admin") return;
    setConfirmedOwner(null);
    let cancelled = false;
    // Retried: a slow or failed check must not throw the owner back to the sign-in page.
    void (async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        const { data, error } = await (supabase as any).rpc("is_platform_admin");
        if (!error) { if (!cancelled) setConfirmedOwner(data === true); return; }
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
      if (!cancelled) setConfirmedOwner(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id, role]);
  const isOwner = role === "super_admin" || confirmedOwner === true;
  const loc = useLocation();
  const [platformName, setPlatformName] = useState("JMSURF Garage");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const [collapsed, setCollapsedState] = useState(() => readFlag(COLLAPSE_KEY));
  const setCollapsed = (v: boolean) => { setCollapsedState(v); writeFlag(COLLAPSE_KEY, v); };
  const [sidebarHidden, setHiddenState] = useState(() => readFlag(HIDDEN_KEY));
  const setSidebarHidden = (v: boolean) => { setHiddenState(v); writeFlag(HIDDEN_KEY, v); };

  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key", "general").maybeSingle().then(({ data }) => {
      if (data?.value && typeof data.value === "object" && (data.value as any).business_name) {
        setPlatformName((data.value as any).business_name);
      }
    });
  }, []);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    closeAllDropdowns(); setMobileOpen(false); setAccountOpen(false);
    mainRef.current?.scrollTo(0, 0);
  }, [loc.pathname]);

  // Admin palette (light, or charcoal in dark mode) for everything shown while the admin is open,
  // including dialogs and dropdowns rendered outside this layout. erp-ws: the device font at 14px,
  // as in the workspace (JMSURF ISP sizes).
  useEffect(() => {
    document.documentElement.classList.add("admin-theme", "erp-ws");
    return () => document.documentElement.classList.remove("admin-theme", "erp-ws");
  }, []);

  const best = useMemo(() => bestHit(loc.pathname), [loc.pathname]);
  const current = useMemo(() => {
    for (const section of NAV) {
      const item = section.items.find((i) => isActive(i, loc.pathname, best));
      if (item) return { section: section.label, item };
    }
    return null;
  }, [loc.pathname, best]);

  if (loading || (user && isOwner && aal === "checking") || (user && role !== "super_admin" && confirmedOwner === null)) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <OrbLoader label="Loading admin…" state="connecting" className="text-muted-foreground" />
      </div>
    );
  }
  if (!user || !isOwner || aal === "needs_code") return <AdminLogin needsCode={!!user && isOwner && aal === "needs_code"} />;

  const signOut = async () => { await supabase.auth.signOut({ scope: "local" }); window.location.href = "/admin"; };
  const displayName = String(user?.user_metadata?.full_name || user?.email || "Platform owner");
  const firstName = displayName.includes("@") ? displayName.split("@")[0] : displayName.split(/\s+/)[0];
  const initials = displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
  const pageTitle = current?.item.label || (loc.pathname.startsWith("/admin/account") ? "My account" : "Control centre");
  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setSidebarHidden(!sidebarHidden);
    else setMobileOpen(!mobileOpen);
  };

  return (
    <div className="ws-shell adm-ws flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Side menu as in the workspace (JMSURF ISP): flush full height, logo block as tall as the top bar, section labels, flat rows. */}
      <aside
        className={cn(
          "ws-side print:hidden fixed lg:static inset-y-0 left-0 z-50 flex flex-col transition-[width,transform] duration-300",
          collapsed ? "is-collapsed w-[min(272px,86vw)] lg:w-[64px]" : "w-[min(272px,86vw)] lg:w-[232px]",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0",
          sidebarHidden && "lg:hidden",
        )}
      >
        <div className="ws-org">
          <Link to="/admin" className="flex min-w-0 flex-1 items-center gap-2.5" title={platformName}>
            <span className="adm-mark"><DashMark className="h-6 w-6" /></span>
            {!collapsed && (
              <span className="min-w-0">
                <b className="block truncate text-[14px] font-bold leading-tight tracking-[-0.01em]">{platformName}</b>
                <span className="adm-badge">Control centre</span>
              </span>
            )}
          </Link>
          <button onClick={() => setMobileOpen(false)} className="ws-ib -mr-1 ml-auto lg:hidden" aria-label="Close menu">
            <X />
          </button>
        </div>

        <nav className="ws-nav flex-1 overflow-y-auto overscroll-contain">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="ws-nav-label">{section.label}</div>
              <div className="ws-nav-rule" aria-hidden />
              {section.items.map((item) => {
                const active = isActive(item, loc.pathname, best);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    data-nav-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => closeAllDropdowns()}
                    title={collapsed ? item.label : undefined}
                    className={cn("group ws-nav-row", active && "is-active")}
                  >
                    <item.icon className="ws-nav-ico" />
                    <span className="ws-nav-text">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ws-side-extra">
          <a href="/status" target="_blank" rel="noopener noreferrer" title={collapsed ? "Status page" : undefined} className="group ws-nav-row">
            <span className="adm-live ws-nav-ico" aria-hidden><i /></span>
            <span className="ws-nav-text">Status page</span>
          </a>
          <div className="ws-side-foot">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}
            >
              <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
            </button>
            <span className="ws-powered ml-auto whitespace-nowrap text-right text-[10px]">Platform admin</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        {/* Top bar as in the workspace: flush, 60px, page name, search pill, quiet icon buttons, gear, name and role. */}
        <header className="ws-top print:hidden">
          <button onClick={toggleSidebar} className="ws-ib" aria-label="Menu" title="Menu">
            <Menu className="lg:hidden" />
            <PanelLeft className="hidden lg:block" />
          </button>
          <div className="ws-crumb" title={current ? `${current.section} › ${current.item.label}` : undefined}>
            <b>{pageTitle}</b>
          </div>
          <button onClick={() => setPalette(true)} className="ws-search hidden lg:flex" aria-label="Search">
            <Search /><span>Search or jump to…</span><kbd>Ctrl K</kbd>
          </button>
          <button onClick={() => setPalette(true)} className="ws-ib ml-auto lg:hidden" aria-label="Search">
            <Search />
          </button>
          <div className="ws-acts">
            <a href="https://garage.jmsurf.co.ke" target="_blank" rel="noopener noreferrer" className="ws-ib hidden sm:grid" aria-label="View site" title="View site"><ExternalLink /></a>
            <button onClick={toggleDarkMode} className="ws-ib" aria-label={darkMode ? "Light mode" : "Dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>
              {darkMode ? <Sun /> : <Moon />}
            </button>
            <div className="relative">
              <button onClick={() => setAccountOpen(!accountOpen)} className="adm-user" aria-label="Account" aria-expanded={accountOpen}>
                <span className="adm-avatar">{initials}</span>
                <span className="adm-who hidden lg:block">
                  <b>{firstName}</b>
                  <span className="adm-role">Platform</span>
                </span>
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
                    <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{displayName}</p><p className="truncate text-xs text-muted-foreground">{user?.email}</p></div>
                    <Link to="/admin/account" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted"><UserRound className="h-4 w-4" /> My account and security</Link>
                    <a href="https://garage.jmsurf.co.ke" target="_blank" rel="noopener noreferrer" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted sm:hidden"><ExternalLink className="h-4 w-4" /> View site</a>
                    <div className="my-1 border-t border-border" />
                    <button onClick={() => void signOut()} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10"><LogOut className="h-4 w-4" /> Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page frame as in the workspace (14px 20px 10px 16px on computers). */}
        <main ref={mainRef} className="erp-main erp-rhythm relative isolate min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 lg:pb-2.5 lg:pl-4 lg:pr-5 lg:pt-3.5 print:overflow-visible print:p-0">
          {/* Pages load inside the content area; the menu and top bar never make way for a loader. */}
          <div className="ft-page-in w-full">
            <PageBoundary><Suspense fallback={<OrbLoader label="Loading…" className="h-64" />}><Outlet /></Suspense></PageBoundary>
          </div>
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {/* JMSURF support line: take and make support calls from anywhere in the admin. */}
      <PhoneDock />
      <SessionTimeoutManager variant="admin" />
    </div>
  );
}

/** Ctrl+K: jump to any admin page or company. */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data: companies = [] } = useQuery({ queryKey: ["admin-palette-companies"], queryFn: async () => ((await (supabase as any).from("tenants").select("id,business_name,contact_name").is("deleted_at", null).order("business_name").limit(5000)).data || []) as any[] });
  const pages = [...NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))), { to: "/admin/account", icon: UserRound, label: "My account", section: "Account" }];
  const t = q.trim().toLowerCase();
  const hitPages = pages.filter((p) => !t || `${p.label} ${p.section}`.toLowerCase().includes(t)).slice(0, 8);
  const hitCos = t ? companies.filter((c) => `${c.business_name} ${c.contact_name || ""}`.toLowerCase().includes(t)).slice(0, 8) : [];
  const go = (to: string) => { onClose(); nav(to); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-3 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4"><Search className="h-4 w-4 text-muted-foreground" /><input autoFocus className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search pages and companies" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { if (hitCos[0]) go(`/admin/companies/${hitCos[0].id}`); else if (hitPages[0]) go(hitPages[0].to); } }} />
          <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground sm:block">Esc</kbd></div>
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {hitPages.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pages</p>}
          {hitPages.map((p) => <button key={p.to} onClick={() => go(p.to)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><p.icon className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{p.label}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.section}</span></button>)}
          {hitCos.length > 0 && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Companies</p>}
          {hitCos.map((c) => <button key={c.id} onClick={() => go(`/admin/companies/${c.id}`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><Building2 className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate">{c.business_name}</span><span className="ml-auto max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{c.contact_name}</span></button>)}
          {!hitPages.length && !hitCos.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found.</p>}
        </div>
      </div>
    </div>
  );
}
