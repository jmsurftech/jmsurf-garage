import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The JMSURF Garage mark: the JMSURF "J" and an open-end wrench on JMSURF crimson
 * (same drawing as public/garage-logo.svg and public/favicon.svg). It follows the
 * company's theme colour when one is set.
 */
export function DashMark({ className, title = "JMSURF Garage" }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 128 128" className={cn("shrink-0", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`gm-bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, hsl(var(--primary, 356 81% 36%)) 80%, white)" }} />
          <stop offset="1" style={{ stopColor: "hsl(var(--primary, 356 81% 36%))" }} />
        </linearGradient>
        <mask id={`gm-cut-${id}`}>
          <rect width="128" height="128" fill="#fff" />
          <g transform="translate(88 64) rotate(40)"><rect x="-5.5" y="-44" width="11" height="20" rx="2" fill="#000" /></g>
        </mask>
      </defs>
      <rect width="128" height="128" rx="26" fill={`url(#gm-bg-${id})`} />
      <path d="M42 26h17v52c0 20-11 31-29 31-13 0-23-6-29-18l15-8c3 7 8 11 15 11 7 0 11-5 11-15V26Z" fill="#fff" />
      <g mask={`url(#gm-cut-${id})`} fill="#fff">
        <g transform="translate(88 64) rotate(40)">
          <circle cx="0" cy="-26" r="15" />
          <rect x="-6.5" y="-26" width="13" height="52" rx="6.5" />
        </g>
      </g>
    </svg>
  );
}

/** Mark + "JMSURF GARAGE" wordmark. `tone="light"` for dark backgrounds. */
export function DashLogo({ className, markClassName, tagline, tone = "dark" }: {
  className?: string;
  markClassName?: string;
  tagline?: string;
  tone?: "dark" | "light";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <DashMark className={cn("h-9 w-9", markClassName)} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-[17px] font-extrabold tracking-tight", tone === "light" ? "text-white" : "text-foreground")}>
          JMSURF <span className={tone === "light" ? "text-[#ff8a8f]" : "text-primary"}>GARAGE</span>
        </span>
        {tagline && (
          <span className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.18em]", tone === "light" ? "text-white/60" : "text-muted-foreground")}>
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}

/** Garage names for the same components. */
export const GarageMark = DashMark;
export const GarageLogo = DashLogo;
