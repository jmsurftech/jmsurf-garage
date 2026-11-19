import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Building2, Palette, Bell, Mail, CreditCard, MessageSquare, BellRing, FileClock, ShoppingBag, DatabaseBackup, Code2,
  SlidersHorizontal, FileText, Handshake, UserRoundCog, Users, History, Settings2, Barcode, CheckSquare, KeyRound, Grid2x2, Building, UploadCloud, Lock, Globe, ShieldCheck, Megaphone, ShoppingCart, Package, FolderKanban, Percent, LifeBuoy, Factory, Wallet, Headset, Sparkles, Search, Hash, type LucideIcon, ListChecks, Workflow, Tags } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useModules } from "@/hooks/useModules";
import { closeAllDropdowns } from "@/lib/singleDropdown";
import { cn } from "@/lib/utils";

type Item = { label: string; icon: LucideIcon; tab?: string; to?: string; managers?: boolean; owner?: boolean; module?: string };

/** The System menu: settings tabs (?tab=…) and the pages that live under System. */
export const SYSTEM_GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Organization",
    items: [
      { label: "Profile", icon: Building2, tab: "business" },
      { label: "Branding", icon: Palette, tab: "theme" },
      { label: "Custom domain", icon: Globe, tab: "domain", owner: true },
      { label: "Locations (branches)", icon: Building, to: "/branches", owner: true },
      { label: "Garage AI", icon: Sparkles, tab: "ai", managers: true, module: "ai" },
      { label: "Approvals", icon: CheckSquare, tab: "approvals", owner: true },
    ],
  },
  {
    title: "Users & Roles",
    items: [
      { label: "Users", icon: Users, to: "/settings/users" },
      { label: "Roles", icon: ShieldCheck, to: "/settings/roles" },
      { label: "Shifts & sessions", icon: Users, to: "/staff" },
      { label: "Signatures & stamps", icon: KeyRound, to: "/settings/signatures" },
      { label: "My companies", icon: Building, to: "/companies" },
    ],
  },
  {
    title: "Taxes & Compliance",
    items: [
      { label: "Taxes (VAT)", icon: Percent, tab: "taxes", managers: true },
      { label: "KRA eTIMS", icon: ShieldCheck, tab: "etims", managers: true },
    ],
  },
  {
    title: "Setup & Configurations",
    items: [
      { label: "Online payments", icon: CreditCard, tab: "payments" },
      { label: "Connections", icon: Workflow, tab: "connections", managers: true },
      { label: "Reminders", icon: BellRing, tab: "alerts", managers: true },
      { label: "Customer statements", icon: FileClock, tab: "statements", managers: true },
      { label: "Customer portal & website", icon: KeyRound, tab: "portal", managers: true },
      { label: "Transaction locking", icon: Lock, to: "/accounting/lock", owner: true },
    ],
  },
  {
    title: "Customization",
    items: [
      { label: "Menu items", icon: ListChecks, tab: "menu", managers: true },
      { label: "Document numbers", icon: Hash, tab: "numbering", managers: true },
      { label: "Custom fields", icon: SlidersHorizontal, tab: "custom-fields", managers: true },
      { label: "Reporting tags", icon: Tags, tab: "reporting-tags", managers: true },
      { label: "PDF templates (documents)", icon: FileText, to: "/settings/documents" },
      { label: "Email & senders", icon: Mail, tab: "smtp", managers: true },
      { label: "SMS & WhatsApp", icon: MessageSquare, tab: "sms", managers: true },
      { label: "Online shop & website", icon: ShoppingBag, tab: "shop", managers: true },
      { label: "Service & Marketing", icon: Megaphone, tab: "service", managers: true },
    ],
  },
  {
    title: "Automation",
    items: [
      { label: "Notifications & alerts", icon: Bell, tab: "notifications" },
      { label: "Workflow rules", icon: Workflow, tab: "workflows", managers: true },
    ],
  },
  {
    title: "Module Settings",
    items: [
      { label: "Modules & billing", icon: Grid2x2, to: "/modules", owner: true },
      { label: "Items", icon: Package, tab: "items", managers: true },
      { label: "Point of Sale", icon: ShoppingCart, tab: "pos", managers: true, module: "pos" },
      { label: "Advanced inventory", icon: Package, tab: "inventory", managers: true, module: "inventory" },
      { label: "CRM", icon: Handshake, to: "/crm/config", module: "crm" },
      { label: "HRM", icon: UserRoundCog, to: "/hrm/config", module: "hrm" },
      { label: "Projects", icon: FolderKanban, tab: "projects", managers: true, module: "projects" },
      { label: "Manufacturing", icon: Factory, tab: "manufacturing", managers: true, module: "manufacturing" },
      { label: "Expense claims", icon: Wallet, tab: "expense", managers: true, module: "expense" },
      { label: "Call Centre", icon: Headset, to: "/callcentre", module: "callcentre" },
    ],
  },
  {
    title: "Data & Developers",
    items: [
      { label: "Move in (import)", icon: UploadCloud, to: "/migrate", owner: true },
      { label: "Backup & restore", icon: DatabaseBackup, tab: "backup", owner: true },
      { label: "Audit log", icon: History, to: "/audit-log", managers: true },
      { label: "API & webhooks", icon: Code2, tab: "developers", managers: true },
      { label: "Help centre", icon: LifeBuoy, to: "/help" },
    ],
  },
];

/** Pages that open in the full-page Settings view (no main menu, a Close button back to work). */
export const SYSTEM_PATHS = ["/settings", "/staff", "/audit-log", "/companies", "/migrate", "/accounting/lock", "/modules", "/branches", "/crm/config", "/hrm/config", "/billing"];
export const isSystemPath = (p: string) => SYSTEM_PATHS.some((x) => p === x || p.startsWith(x + "/"));

/** The Settings menu: grouped, searchable, scrolls on its own. */
export function SystemNav({ onPick }: { onPick?: () => void }) {
  const { role } = useAuth();
  const { has } = useModules();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const manager = role === "admin" || role === "manager" || role === "super_admin";
  const owner = role === "admin" || role === "super_admin";
  const tab = pathname === "/settings" ? params.get("tab") || "business" : null;
  const isOn = (it: Item) => (it.tab ? tab === it.tab : !!it.to && (pathname === it.to || pathname.startsWith(it.to + "/")));
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, []);
  return (
    <nav aria-label="Settings" className="space-y-4 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input className="fi h-9 pl-9 text-sm" placeholder="Find a setting" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a setting" />
      </div>
      {SYSTEM_GROUPS.map((g) => {
        const items = g.items.filter((it) => (!it.managers || manager) && (!it.owner || owner) && (!it.module || has(it.module)) && (!q || `${it.label} ${g.title}`.toLowerCase().includes(q.toLowerCase())));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{g.title}</p>
            <div className="space-y-0.5">
              {items.map((it) => {
                const on = isOn(it);
                return (
                  <Link key={it.label} ref={on ? activeRef : undefined} to={it.tab ? (it.tab === "business" ? "/settings" : `/settings?tab=${it.tab}`) : it.to!}
                    onClick={() => { closeAllDropdowns(); onPick?.(); }}
                    className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                      on ? "bg-primary font-semibold text-primary-foreground shadow-md shadow-primary/25" : "text-foreground/80 hover:bg-primary/10 hover:text-primary")}>
                    <it.icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Kept for the pages that wrap themselves in it; the Settings frame in AppLayout now draws the menu. */
export default function SystemShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
