import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Calculator, Receipt, PiggyBank, Landmark, Wallet, BarChart3, FileSpreadsheet, Coins, CreditCard, Smartphone, TrendingUp,
  Percent, Banknote, ScrollText, Scale, PieChart, type LucideIcon,
} from "lucide-react";
import { DashMark } from "@/components/brand/DashLogo";
import { Orbs, GridGlow } from "@/components/brand/Orbs";
import { cn } from "@/lib/utils";
import PoweredBy from "@/components/PoweredBy";

/** Where each accounting icon floats around the card: [x, y, icon, size, delay, rotate, duration]. */
const ICONS: [string, string, LucideIcon, number, number, number, number][] = [
  ["left-[7%]", "top-[14%]", Calculator, 60, 0, -8, 10], ["left-[11%]", "top-[70%]", PiggyBank, 54, 1.6, 6, 12], ["left-[24%]", "top-[40%]", Receipt, 42, 2.4, -4, 13],
  ["right-[7%]", "top-[12%]", BarChart3, 60, 0.8, 7, 11], ["right-[11%]", "top-[68%]", Wallet, 54, 2, -7, 12], ["right-[24%]", "top-[42%]", Smartphone, 42, 3, 5, 14],
];

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
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
        {ICONS.map(([x, y, Icon, size, delay, rot, dur], i) => (
          <div key={i} className={cn("absolute", x, y)}>
            <span className="auth-float flex items-center justify-center rounded-2xl border border-border/70 bg-card/80 text-primary shadow-lg shadow-primary/10 backdrop-blur"
              style={{ width: size, height: size, ["--r" as string]: `${rot}deg`, ["--d" as string]: `${dur}s`, ["--delay" as string]: `${delay}s`, opacity: 0.85 } as React.CSSProperties}>
              <Icon style={{ width: size * 0.45, height: size * 0.45 }} strokeWidth={1.8} />
            </span>
          </div>
        ))}
      </div>

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
