/**
 * Shared page kit: the building blocks every screen uses so headers, filters,
 * panels, tables, forms and pop-ups look and behave the same everywhere.
 */
import { useEffect, useState, type ReactNode } from "react";
import { closeAllDropdowns as __closeDropdowns } from "@/lib/singleDropdown";
import { createPortal } from "react-dom";
import { Helmet } from "react-helmet-async";
import { tabTitle } from "@/lib/brand";
import { Search, X, type LucideIcon, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbLoader } from "@/components/Orb";

/* ------------------------------------------------------------------ header */

export function PageHeader({
  title, icon: Icon, actions, children, className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  /** Optional row under the title, e.g. tabs or summary chips. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      {typeof title === "string" && <Helmet><title>{tabTitle(title)}</title></Helmet>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <span className="g-tile xs hidden sm:inline-flex"><Icon className="h-4 w-4" /></span>}
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.1rem] font-bold leading-tight tracking-tight">{title}</h1>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/* --------------------------------------------------------------- toolbar */

/** A row of filters/search above a list. Wraps neatly on phones. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function SearchBox({
  value, onChange, placeholder = "Search…", className, autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn("relative min-w-[200px] flex-1 sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="fi pl-9 pr-8"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Segmented pill filter, e.g. All / Paid / Unpaid. */
export function Segmented<T extends string>({
  value, onChange, options, className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("inline-flex max-w-full flex-wrap rounded-2xl border border-white/70 bg-white/45 p-1 shadow-[inset_0_1px_2px_rgba(30,40,80,.08)] backdrop-blur dark:border-white/10 dark:bg-white/5", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1 text-[13px] font-medium transition-all",
            value === o.value ? "bg-white text-foreground shadow-[0_4px_12px_-6px_rgba(30,40,80,.35)] dark:bg-white/15" : "text-muted-foreground hover:text-foreground",
          )}>
          {o.label}
          {o.count !== undefined && (
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", value === o.value ? "bg-primary/10 text-primary" : "bg-background/70")}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- panel */

export function Panel({
  title, description, icon: Icon, actions, children, className, bodyClassName, flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No padding around the body, for tables and lists. */
  flush?: boolean;
}) {
  // The section's explanation stays out of the way until asked for.
  const [why, setWhy] = useState(false);
  return (
    <section data-reveal className={cn("overflow-hidden rounded-2xl border border-border bg-card text-card-foreground", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <span className="g-tile xs"><Icon className="h-3.5 w-3.5" /></span>}
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                {title && <h2 className="truncate font-display text-sm font-bold">{title}</h2>}
                {description && <button type="button" onClick={() => setWhy(!why)} aria-expanded={why} aria-label="About this section" title={typeof description === "string" ? description : undefined} className="shrink-0 rounded-full p-0.5 text-muted-foreground/70 hover:text-foreground"><Info className="h-3.5 w-3.5" /></button>}
              </div>
              {description && why && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Horizontal-scrolling wrapper for a `<table className="dt">` inside a flush Panel. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-reveal className={cn("w-full overflow-x-auto", className)}>{children}</div>;
}

/* ------------------------------------------------------------ stat tiles */

const TILE: Record<string, string> = {
  primary: "hsl(var(--primary))", success: "hsl(var(--success))", warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))", info: "hsl(var(--info))", muted: "hsl(var(--muted-foreground))",
};

export function StatTile({
  label, value, hint, icon: Icon, tone = "primary", className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "muted";
  className?: string;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary text-primary-foreground shadow-md shadow-primary/30",
    success: "bg-success text-white shadow-md shadow-success/30",
    warning: "bg-warning text-white shadow-md shadow-warning/30",
    danger: "bg-destructive text-white shadow-md shadow-destructive/30",
    info: "bg-info text-white shadow-md shadow-info/30",
    muted: "bg-foreground/80 text-background",
  };
  const cards: Record<string, string> = {
    primary: "from-primary/12 via-card to-card border-primary/20",
    success: "from-success/12 via-card to-card border-success/20",
    warning: "from-warning/15 via-card to-card border-warning/25",
    danger: "from-destructive/12 via-card to-card border-destructive/20",
    info: "from-info/12 via-card to-card border-info/20",
    muted: "from-muted via-card to-card border-border",
  };
  void tones; void cards;
  return (
    <div data-reveal className={cn("group relative flex items-center gap-2 overflow-hidden rounded-2xl border border-border bg-card px-2.5 py-1.5", className)}>
      {Icon && <span className="g-tile xs" style={{ ["--tile" as any]: TILE[tone] }}><Icon className="h-3.5 w-3.5" /></span>}
      <div className="min-w-0 flex-1">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[15px] font-bold leading-tight tabular-nums" title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}>{value}</p>
      {hint && <p className="truncate text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("stat-strip grid grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}

/* ---------------------------------------------------------- empty / load */

export function EmptyState({
  icon: Icon, title, description, action, className,
}: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <span className="g-tile mb-3 h-14 w-14" style={{ ["--tile" as any]: "hsl(var(--muted-foreground))" }}>
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <OrbLoader label={label} className="h-64" />
  );
}

/* ------------------------------------------------------------------ form */

export function Field({
  label, hint, error, required, children, className,
}: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      {label && (
        <span className="block text-sm font-medium">
          {label}{required && <span className="ml-0.5 text-destructive">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="block text-xs text-destructive">{error}</span>
        : hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/* ----------------------------------------------------------------- modal */

const MODAL_SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", xl: "sm:max-w-2xl", "2xl": "sm:max-w-4xl", full: "sm:max-w-[min(96vw,1400px)]" } as const;
/** Side panel widths (desktop): a quarter to half of the screen. */
const SHEET_SIZES = { sm: "sm:w-[min(420px,100vw)]", md: "sm:w-[min(480px,100vw)]", lg: "sm:w-[min(560px,100vw)]", xl: "sm:w-[min(720px,100vw)]", "2xl": "sm:w-[min(920px,100vw)]", full: "sm:w-[min(1200px,100vw)]" } as const;

/**
 * The one pop-up used across the app. A centred card on desktop, a bottom
 * sheet on phones. The body scrolls; the footer stays visible. Escape and a
 * click on the backdrop close it unless `locked`.
 */
export function Modal({
  open, onClose, title, description, icon: Icon, size = "md", footer, children, locked, className, bodyClassName, center,
}: {
  /** A small centred dialog instead of the side panel (confirmations). */
  center?: boolean;
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  size?: keyof typeof MODAL_SIZES;
  footer?: ReactNode;
  children?: ReactNode;
  /** Prevent closing (e.g. while saving). */
  locked?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  useEffect(() => { if (open) __closeDropdowns(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !locked) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, locked, onClose]);

  if (!open) return null;
  // Phones: a sheet from the bottom. Larger screens: a panel from the right (or a centred dialog).
  return createPortal(
    <div className={cn("fixed inset-0 z-[90] flex items-end justify-center bg-black/45 backdrop-blur-[2px] animate-in fade-in-0",
      center ? "sm:items-center sm:p-4" : "sm:items-stretch sm:justify-end")}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div role="dialog" aria-modal="true"
        className={cn(
          "flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-card text-card-foreground shadow-2xl animate-in slide-in-from-bottom-4",
          center ? cn("sm:max-h-[88vh] sm:rounded-3xl sm:zoom-in-95 sm:slide-in-from-bottom-0", MODAL_SIZES[size])
            : cn("sm:h-full sm:max-h-none sm:max-w-none sm:rounded-none sm:rounded-l-3xl sm:border-y-0 sm:border-r-0 sm:slide-in-from-right-10 sm:slide-in-from-bottom-0 sm:duration-300", SHEET_SIZES[size]),
          className,
        )}>
        {(title || Icon) && (
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            {Icon && <span className="g-tile"><Icon className="h-5 w-5" /></span>}
            <div className="min-w-0 flex-1">
              {title && <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {!locked && (
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className={cn("flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- badges */

const PILL_TONES = {
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/15 text-[hsl(32_90%_38%)] ring-warning/25",
  danger: "bg-destructive/10 text-destructive ring-destructive/20",
  info: "bg-info/10 text-info ring-info/20",
  primary: "bg-primary/10 text-primary ring-primary/20",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

export function Pill({ tone = "muted", children, className }: { tone?: keyof typeof PILL_TONES; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", PILL_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Maps common record statuses to a pill colour. */
export function StatusPill({ status, className }: { status?: string | null; className?: string }) {
  const s = String(status || "").toLowerCase();
  const tone: keyof typeof PILL_TONES =
    ["completed", "paid", "active", "approved", "received", "delivered", "success", "settled", "confirmed"].includes(s) ? "success"
      : ["pending", "partial", "trialing", "draft", "processing", "open", "sent", "in_transit"].includes(s) ? "warning"
        : ["failed", "cancelled", "canceled", "rejected", "overdue", "expired", "void", "voided", "suspended", "refunded"].includes(s) ? "danger"
          : "muted";
  const label = s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";
  return <Pill tone={tone} className={className}>{label}</Pill>;
}
