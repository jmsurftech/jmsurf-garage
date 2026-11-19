import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageBoundary from "@/components/PageBoundary";
import { OrbLoader } from "@/components/Orb";
import {
  LayoutDashboard, Building2, CreditCard, FileText, Settings, ShoppingCart, Banknote, Users, Activity, Menu, X, BarChart3, ExternalLink, PanelLeftClose, PanelLeftOpen, HeartPulse, Globe, MessagesSquare, Grid2x2, Sun, Moon, Search, Target, Bell, UserRound, ShieldCheck, LogOut, Headset, KeyRound, Wifi } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { DashMark } from "@/components/brand/DashLogo";
import { Suspense, useEffect, useMemo, useState } from "react";
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
    label: "Companies",
    items: [
      { to: "/admin/customers", icon: Building2, label: "Companies" },
      { to: "/admin/users", icon: Users, label: "Users" },
      { to: "/admin/subscriptions", icon: CreditCard, label: "Plans" },
      { to: "/admin/modules", icon: Grid2x2, label: "Modules & prices" },
      { to: "/admin/domains", icon: Globe, label: "Domains" },
      { to: "/admin/etims-tokens", icon: KeyRound, label: "KRA tokens" },
    ],
  },
  {
    label: "Growth",
    items: [
      { to: "/admin/leads", icon: Target, label: "Leads & CRM" },
      { to: "/admin/support", icon: Headset, label: "Support" },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/admin/payments", icon: Banknote, label: "Payments" },
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

function isActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
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
  useEffect(() => { setAccountOpen(false); }, [loc.pathname]);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key", "general").maybeSingle().then(({ data }) => {
      if (data?.value && typeof data.value === "object" && (data.value as any).business_name) {
        setPlatformName((data.value as any).business_name);
      }
    });
  }, []);

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  // Admin palette (light, or charcoal in dark mode) for everything shown while
  // the admin is open, including dialogs and dropdowns rendered outside this layout.
  useEffect(() => {
    document.documentElement.classList.add("admin-theme");
    return () => document.documentElement.classList.remove("admin-theme");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* per-device preference only */ }
      return !c;
    });
  };

  const current = useMemo(() => {
    for (const section of NAV) {
      const item = section.items.find((i) => isActive(i, loc.pathname));
      if (item) return { section: section.label, item };
    }
    return null;
  }, [loc.pathname]);

  if (loading || (user && isOwner && aal === "checking") || (user && role !== "super_admin" && confirmedOwner === null)) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <OrbLoader label="Loading admin…" state="connecting" className="text-muted-foreground" />
      </div>
    );
  }
  if (!user || !isOwner || aal === "needs_code") return <AdminLogin needsCode={!!user && isOwner && aal === "needs_code"} />;

  const renderSidebar = (compact: boolean, onClose?: () => void) => (
    <aside className={`${compact ? "w-[84px]" : "w-[272px]"} glass-side m-3 mr-0 flex h-[calc(100%-1.5rem)] shrink-0 flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card/90 shadow-xl shadow-black/[0.04] backdrop-blur-xl transition-[width] duration-200`}>
      <div className={`flex h-[72px] items-center gap-3 px-4 ${compact ? "justify-center" : ""}`}>
        <Link to="/admin" className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#5b0a10] shadow-lg shadow-primary/30">
            <DashMark className="h-8 w-8" />
          </span>
          {!compact && (
            <span className="min-w-0">
              <b className="block truncate font-display text-[15px] leading-tight">{platformName}</b>
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Control centre</span>
            </span>
          )}
        </Link>
        {onClose && <button onClick={onClose} className="ml-auto rounded-xl p-2 text-muted-foreground hover:bg-muted" aria-label="Close menu"><X className="h-5 w-5" /></button>}
      </div>
      {!compact && (
        <button onClick={() => setPalette(true)} className="mx-4 mb-2 flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/40">
          <Search className="h-4 w-4" /><span className="flex-1">Search</span><kbd className="rounded border border-border px-1.5 text-[10px]">Ctrl K</kbd>
        </button>
      )}
      <nav className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-2">
        {NAV.map((section) => (
          <div key={section.label}>
            {!compact && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">{section.label}</p>}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item, loc.pathname);
                return (
                  <Link key={item.to} to={item.to} title={compact ? item.label : undefined} aria-current={active ? "page" : undefined}
                    className={`group flex items-center gap-3 rounded-2xl px-2 py-1.5 text-sm transition-all ${compact ? "justify-center" : ""} ${active ? "bg-gradient-to-r from-primary to-primary/80 font-semibold text-primary-foreground shadow-lg shadow-primary/25" : "text-foreground/75 hover:bg-muted hover:text-foreground"}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? "bg-white/20" : "bg-muted/80 group-hover:bg-background"}`}><item.icon className="h-[17px] w-[17px]" /></span>
                    {!compact && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-border/70 p-3">
        {!compact && (
          <a href="/status" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-2xl bg-success/10 px-3 py-2 text-xs font-medium text-success">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-success" /></span>
            Public status page
          </a>
        )}
        {!onClose && (
          <button onClick={toggleCollapsed} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted ${compact ? "justify-center" : ""}`} aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}>
            {compact ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
          </button>
        )}
      </div>
    </aside>
  );

  const signOut = async () => { await supabase.auth.signOut({ scope: "local" }); window.location.href = "/admin"; };
  const displayName = String(user?.user_metadata?.full_name || user?.email || "Platform owner");
  const initials = displayName.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");

  return (
    <div className="admin-shell glass-shell flex h-screen overflow-hidden bg-background bg-[radial-gradient(1200px_600px_at_100%_-10%,hsl(var(--primary)/0.08),transparent),radial-gradient(900px_500px_at_-10%_110%,hsl(210_90%_60%/0.07),transparent)] text-foreground">
      <div className="hidden lg:flex">{renderSidebar(collapsed)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 animate-in slide-in-from-left">{renderSidebar(false, () => setMobileOpen(false))}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar mx-3 mt-3 flex h-16 shrink-0 items-center gap-3 rounded-[22px] border border-border/70 bg-card/80 px-3 shadow-sm backdrop-blur-xl sm:px-5">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-xl p-2 hover:bg-muted lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0">
            {current && <p className="text-[11px] leading-none text-muted-foreground">{current.section}</p>}
            <p className="truncate font-display text-[17px] font-bold">{current?.item.label || (loc.pathname.startsWith("/admin/account") ? "My account" : "Control centre")}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setPalette(true)} className="rounded-full p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Search"><Search className="h-5 w-5" /></button>
            <a href="https://garage.jmsurf.co.ke" target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex">View site <ExternalLink className="h-3.5 w-3.5" /></a>
            <button onClick={toggleDarkMode} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={darkMode ? "Light mode" : "Dark mode"}>{darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
            <div className="relative">
              <button onClick={() => setAccountOpen(!accountOpen)} className="flex items-center gap-2 rounded-full border border-border bg-background/60 py-1 pl-1 pr-3 hover:border-primary/40" aria-label="Account">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#5b0a10] text-xs font-bold text-white">{initials}</span>
                <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">{displayName}</span>
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
                    <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{displayName}</p><p className="truncate text-xs text-muted-foreground">{user?.email}</p></div>
                    <Link to="/admin/account" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted"><UserRound className="h-4 w-4" /> My account</Link>
                    <Link to="/admin/account" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted"><ShieldCheck className="h-4 w-4" /> Password and two-step sign-in</Link>
                    <Link to="/admin/notifications" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-muted"><Bell className="h-4 w-4" /> Notifications</Link>
                    <button onClick={() => void signOut()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition hover:brightness-110"><LogOut className="h-4 w-4" /> Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="admin-light relative min-w-0 flex-1 overflow-auto">
          <div className="relative mx-auto max-w-[1500px]">
            {/* Pages load inside the content area; the sidebar and header never make way for a loader. */}
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
  const { data: companies = [] } = useQuery({ queryKey: ["admin-palette-companies"], queryFn: async () => ((await (supabase as any).from("tenants").select("id,business_name,slug").order("business_name").limit(2000)).data || []) as any[] });
  const pages = [...NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label }))), { to: "/admin/account", icon: UserRound, label: "My account", section: "Account" }];
  const t = q.trim().toLowerCase();
  const hitPages = pages.filter((p) => !t || `${p.label} ${p.section}`.toLowerCase().includes(t)).slice(0, 8);
  const hitCos = t ? companies.filter((c) => `${c.business_name} ${c.slug}`.toLowerCase().includes(t)).slice(0, 8) : [];
  const go = (to: string) => { onClose(); nav(to); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-popover shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4"><Search className="h-5 w-5 text-muted-foreground" /><input autoFocus className="h-14 flex-1 bg-transparent text-[15px] outline-none" placeholder="Search pages and companies" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { if (hitCos[0]) go(`/admin/customers?open=${hitCos[0].id}`); else if (hitPages[0]) go(hitPages[0].to); } }} /></div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {hitPages.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pages</p>}
          {hitPages.map((p) => <button key={p.to} onClick={() => go(p.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"><p.icon className="h-4 w-4 text-primary" />{p.label}<span className="ml-auto text-xs text-muted-foreground">{p.section}</span></button>)}
          {hitCos.length > 0 && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Companies</p>}
          {hitCos.map((c) => <button key={c.id} onClick={() => go(`/admin/customers?open=${c.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"><Building2 className="h-4 w-4 text-primary" />{c.business_name}<span className="ml-auto text-xs text-muted-foreground">{c.slug}</span></button>)}
          {!hitPages.length && !hitCos.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found.</p>}
        </div>
      </div>
    </div>
  );
}
