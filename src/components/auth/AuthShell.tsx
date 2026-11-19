import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DashMark } from "@/components/brand/DashLogo";
import { AUTH_PHOTOS, photoSrcSet } from "@/lib/photos";
import { Orbs, GridGlow } from "@/components/brand/Orbs";
import { cn } from "@/lib/utils";
import PoweredBy from "@/components/PoweredBy";

/** The day's workshop photo behind every sign-in card; md and up only (a picture element skips it on phones). */
function AuthBackdrop() {
  const ph = AUTH_PHOTOS[new Date().getDate() % AUTH_PHOTOS.length];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
      <picture>
        <source media="(min-width: 768px)" srcSet={photoSrcSet(ph)} sizes="100vw" />
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" className="h-full w-full object-cover" style={ph.focus ? { objectPosition: ph.focus } : undefined} />
      </picture>
      {/* Tinted with the page colour so the soft card still reads clearly in light and dark. */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--sa-bg, hsl(var(--background))) 84%, transparent), color-mix(in srgb, var(--sa-bg, hsl(var(--background))) 62%, transparent) 50%, color-mix(in srgb, var(--sa-bg, hsl(var(--background))) 88%, transparent))" }} />
    </div>
  );
}

/**
 * Every sign-in style page (company and platform sign-in, sign-up, password
 * reset, customer portal): one card in the centre, light by default (dark when
 * the device or the person chooses), with drifting orbs and accounting icons
 * floating around it.
 */
export default function AuthShell({
  children, title, subtitle, brandName, logoUrl, footer, wide, variant, badge,
}: {
  /** "admin": the platform owner's sign-in (shows a Platform badge). */
  variant?: "admin" | "card";
  /** Kept for callers; the brand colours are fixed in this system. */
  shopTheme?: boolean;
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A company's own name on its sign-in page. */
  brandName?: string | null;
  logoUrl?: string | null;
  footer?: ReactNode;
  wide?: boolean;
  /** Kept for callers (older split layout). */
  points?: string[];
  badge?: ReactNode;
}) {
  const company = brandName && brandName !== "JMSURF Garage" ? brandName : null;
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center soft-auth soft-auth soft-auth overflow-hidden bg-background px-4 py-10">
      <div className="soft-auth-hide"><Orbs /><GridGlow /></div>
      {/* Soft glowing orbs right behind the card. */}
      <div aria-hidden className="soft-auth-hide pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="orb-pulse absolute h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-3xl" />
        <span className="orb-pulse absolute h-72 w-72 rounded-full bg-info/15 blur-3xl" style={{ animationDelay: "2s", marginLeft: "-30rem", marginTop: "20rem" }} />
        <span className="orb-pulse absolute h-80 w-80 rounded-full bg-primary/20 blur-3xl" style={{ animationDelay: "4s", marginLeft: "30rem", marginTop: "-22rem" }} />
      </div>
      {/* A real workshop behind the card (tablet and up, so phones skip the download). */}
      <AuthBackdrop />

      <div className={cn("soft-auth-card relative w-full rounded-[32px] border border-border/70 bg-card/95 p-7 shadow-2xl shadow-primary/15 backdrop-blur-xl sm:p-11", wide ? "max-w-3xl" : "max-w-xl")}>
        <div className="mb-7 flex flex-col items-center text-center">
          {company ? (
            // A company's own sign-in: its logo (or initial) and name only, like JMSURF ISP workspaces.
            <Link to="/" className="mb-5 flex flex-col items-center gap-3" aria-label={company}>
              {logoUrl
                ? <span className="soft-auth-logo wide"><img src={logoUrl} alt={company} className="object-contain" /></span>
                : <span className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-gradient-to-br from-primary to-primary/70 font-display text-4xl font-extrabold text-primary-foreground shadow-xl shadow-primary/30">{company.trim().charAt(0).toUpperCase()}</span>}
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{company}</span>
              {badge}
            </Link>
          ) : (
            <>
              <Link to="/" className="soft-auth-logo mb-5">
                {logoUrl ? <img src={logoUrl} alt="JMSURF Garage" className="h-20 w-20 rounded-2xl object-contain shadow-lg shadow-primary/25" /> : <DashMark className="h-20 w-20 drop-shadow-lg" />}
              </Link>
              <p className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold tracking-tight text-foreground">
                JMSURF <span className="text-primary">GARAGE</span>
                {variant === "admin" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/20">Platform</span>}
                {badge}
              </p>
            </>
          )}
          <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-7 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>

      <div className="relative mt-8 flex w-full max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} {company || "JMSURF Garage"}</span><span aria-hidden>·</span><PoweredBy className="hover:text-primary" />
      </div>
    </main>
  );
}
