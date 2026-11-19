/**
 * The other menu layouts a person can pick (profile menu or System → Theme):
 * two sidebars (app rail + the open app's pages), a top menu bar, and a bottom dock.
 * On phones the drawer and bottom bar in AppLayout are used whatever is chosen.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Grid2x2, LifeBuoy, Lock, Search, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { closeAllDropdowns } from "@/lib/singleDropdown";
import type { NavEntry, NavLeaf } from "@/lib/navConfig";

export type AltEntry = NavEntry & { locked?: boolean };

export interface AltNavProps {
  entries: AltEntry[];
  isActive: (leaf: NavLeaf) => boolean;
  activeLeaf: NavLeaf | null;
  badgeFor: (path: string) => number;
  prefetch: (path: string) => void;
  onFind: () => void;
  currentPath: string;
  showModules: boolean;
  showSettings: boolean;
}

const entryActive = (e: AltEntry, p: AltNavProps) =>
  e.children ? e.children.some(p.isActive) : p.isActive(e) || (e.path === "/dashboard" && p.currentPath === "/");

const Count = ({ n, className }: { n: number; className?: string }) =>
  n ? <span className={cn("min-w-[18px] rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-[18px] text-primary-foreground", className)}>{n > 99 ? "99+" : n}</span> : null;

const SYSTEM_PATHS = ["/settings", "/staff", "/audit-log", "/crm/config", "/hrm/config", "/settings/documents", "/modules", "/help"];

/* ------------------------------------------------------------- two sidebars */

export function DualSidebar(p: AltNavProps) {
  const current = p.entries.find((e) => e.children && entryActive(e, p));
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { setPicked(null); }, [p.currentPath]);
  const group = p.entries.find((e) => e.path === (picked ?? current?.path)) || null;
  const railItem = (on: boolean) => cn("group relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10.5px] font-semibold leading-tight transition-colors",
    on ? "bg-sidebar-primary text-white shadow-md shadow-primary/25" : "text-sidebar-foreground/70 hover:bg-sidebar-primary/10 hover:text-sidebar-primary");
  return (
    <div className="print:hidden hidden h-full shrink-0 lg:flex">
      <div className="flex w-[84px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <button onClick={p.onFind} className="mx-2 mt-3 flex flex-col items-center gap-1 rounded-2xl py-2 text-[10.5px] text-sidebar-foreground/60 hover:bg-sidebar-accent" aria-label="Quick find"><Search className="h-5 w-5" />Find</button>
        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-2" aria-label="Apps">
          {p.entries.map((e) => {
            const on = entryActive(e, p) || group?.path === e.path;
            const n = e.children ? e.children.reduce((a, c) => a + p.badgeFor(c.path), 0) : p.badgeFor(e.path);
            const inner = <><e.icon className="h-5 w-5" /><span className="line-clamp-2 w-full break-words text-center">{e.label}</span>{e.locked && <Lock className="absolute right-1.5 top-1.5 h-3 w-3 opacity-50" />}<Count n={n} className="absolute right-1 top-1" /></>;
            return e.children ? (
              <button key={e.path} onClick={() => { closeAllDropdowns(); setPicked(e.path); }} className={railItem(on)} title={e.label}>{inner}</button>
            ) : (
              <Link key={e.path} to={e.path} onClick={() => { closeAllDropdowns(); setPicked(null); }} onMouseEnter={() => p.prefetch(e.path)} className={railItem(on)} title={e.label}>{inner}</Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border p-2">
          <Link to="/help" className={railItem(p.currentPath === "/help")} title="Help centre"><LifeBuoy className="h-5 w-5" />Help</Link>
        </div>
      </div>
      {group?.children && (
        <div className="flex w-[232px] flex-col border-r border-sidebar-border bg-sidebar/60 text-sidebar-foreground backdrop-blur">
          <div className="flex h-14 shrink-0 items-center gap-2 px-4"><group.icon className="h-5 w-5 text-primary" /><p className="truncate font-display text-[15px] font-bold">{group.label}</p></div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-4" aria-label={group.label}>
            {group.children.map((c) => {
              const on = p.activeLeaf ? p.activeLeaf === c : p.isActive(c);
              return (
                <Link key={c.path} to={c.path} onClick={() => closeAllDropdowns()} onMouseEnter={() => p.prefetch(c.path)}
                  className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors", on ? "bg-sidebar-primary font-semibold text-white shadow-sm shadow-primary/25" : "text-sidebar-foreground/75 hover:bg-sidebar-primary/10 hover:text-sidebar-primary")}>
                  <c.icon className="h-4 w-4 shrink-0" /><span className="flex-1 truncate">{c.label}</span><Count n={p.badgeFor(c.path)} />
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- menu pop */

function GroupMenu({ entry, p, onClose }: { entry: AltEntry; p: AltNavProps; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => { const t = e.target as HTMLElement; if (ref.current && !ref.current.contains(t) && !t.closest?.("[aria-expanded]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", on); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const kids = entry.children || [];
  return (
    <div ref={ref} className={cn("w-[min(34rem,90vw)] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95", kids.length > 6 && "sm:grid sm:grid-cols-2 sm:gap-x-1")}>
      {kids.map((c) => {
        const on = p.activeLeaf ? p.activeLeaf === c : p.isActive(c);
        return (
          <Link key={c.path} to={c.path} onClick={onClose} onMouseEnter={() => p.prefetch(c.path)}
            className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors", on ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted")}>
            <c.icon className={cn("h-4 w-4 shrink-0", !on && "text-primary")} /><span className="flex-1 truncate">{c.label}</span><Count n={p.badgeFor(c.path)} />
          </Link>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- top menu */

export function TopMenu(p: AltNavProps) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setOpen(null); }, [p.currentPath]);
  return (
    <nav aria-label="Main" className="print:hidden relative z-20 hidden shrink-0 border-b border-border bg-card/90 backdrop-blur lg:block">
      <div className="flex items-center gap-0.5 overflow-x-auto px-3 py-1.5 [scrollbar-width:thin]">
        {p.entries.map((e) => {
          const on = entryActive(e, p);
          const cls = cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] font-semibold transition-colors", on ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25" : "text-foreground/75 hover:bg-primary/10 hover:text-primary", open === e.path && !on && "bg-muted");
          if (!e.children) return <Link key={e.path} to={e.path} onMouseEnter={() => p.prefetch(e.path)} className={cls}><e.icon className="h-4 w-4" />{e.label}{e.locked && <Lock className="h-3 w-3 opacity-60" />}<Count n={p.badgeFor(e.path)} /></Link>;
          return (
            <button key={e.path} onClick={() => { closeAllDropdowns(); setOpen(open === e.path ? null : e.path); }} className={cls} aria-expanded={open === e.path}>
              <e.icon className="h-4 w-4" />{e.label}<ChevronDown className={cn("h-3.5 w-3.5 opacity-70 transition-transform", open === e.path && "rotate-180")} />
            </button>
          );
        })}
      </div>
      {open && (() => {
        const e = p.entries.find((x) => x.path === open);
        const btn = document.querySelector<HTMLElement>(`nav[aria-label="Main"] button[aria-expanded="true"]`);
        const left = Math.max(8, Math.min((btn?.getBoundingClientRect().left || 0) - (btn?.closest("nav")?.getBoundingClientRect().left || 0), window.innerWidth - 560));
        return e ? <div className="absolute top-full z-50 mt-1" style={{ left }}><GroupMenu entry={e} p={p} onClose={() => setOpen(null)} /></div> : null;
      })()}
    </nav>
  );
}

/* -------------------------------------------------------------- bottom dock */

export function BottomDock(p: AltNavProps) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setOpen(null); }, [p.currentPath]);
  return (
    <nav aria-label="Dock" className="print:hidden pointer-events-none fixed inset-x-0 bottom-3 z-40 hidden justify-center px-4 lg:flex">
      <div data-strip className="pointer-events-auto relative flex max-w-full items-end gap-1 overflow-x-auto rounded-3xl border border-border bg-card/90 px-2 py-1.5 shadow-2xl backdrop-blur-xl [scrollbar-width:none]">
        <button onClick={p.onFind} className="flex w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-medium text-muted-foreground hover:bg-muted" aria-label="Quick find"><Search className="h-5 w-5" />Find</button>
        <span className="mx-0.5 h-9 w-px self-center bg-border" />
        {p.entries.map((e) => {
          const on = entryActive(e, p);
          const n = e.children ? e.children.reduce((a, c) => a + p.badgeFor(c.path), 0) : p.badgeFor(e.path);
          const cls = cn("relative flex w-[72px] shrink-0 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-semibold leading-tight transition-all hover:-translate-y-0.5", on ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : "text-foreground/75 hover:bg-primary/10 hover:text-primary", open === e.path && !on && "bg-muted");
          const inner = <><e.icon className="h-5 w-5" /><span className="w-full truncate px-1 text-center">{e.label}</span><Count n={n} className="absolute right-1 top-0.5" /></>;
          return e.children ? (
            <button key={e.path} onClick={() => { closeAllDropdowns(); setOpen(open === e.path ? null : e.path); }} className={cls} aria-expanded={open === e.path} title={e.label}>{inner}</button>
          ) : (
            <Link key={e.path} to={e.path} onMouseEnter={() => p.prefetch(e.path)} className={cls} title={e.label}>{inner}</Link>
          );
        })}
        <span className="mx-0.5 h-9 w-px self-center bg-border" />
        <Link to="/help" className="flex w-[64px] shrink-0 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-medium text-muted-foreground hover:bg-muted"><LifeBuoy className="h-5 w-5" />Help</Link>
      </div>
      {open && (() => {
        const e = p.entries.find((x) => x.path === open);
        return e ? <div className="pointer-events-auto absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2"><GroupMenu entry={e} p={p} onClose={() => setOpen(null)} /></div> : null;
      })()}
    </nav>
  );
}
