import { cn } from "@/lib/utils";

/** The JMSURF Garage mark: the JMSURF "J" with rising dashboard bars and a growth arrow. */
export function DashMark({ className, title = "JMSURF Garage" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={cn("shrink-0", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id="dash-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, hsl(var(--primary, 356 81% 36%)) 78%, white)" }} />
          <stop offset="1" style={{ stopColor: "hsl(var(--primary, 356 81% 36%))" }} />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="26" fill="url(#dash-mark-bg)" />
      <path d="M42 26h17v52c0 20-11 31-29 31-13 0-23-6-29-18l15-8c3 7 8 11 15 11 7 0 11-5 11-15V26Z" fill="#fff" />
      <rect x="68" y="85" width="11" height="24" rx="3.5" fill="#fff" opacity=".62" />
      <rect x="84" y="73" width="11" height="36" rx="3.5" fill="#fff" opacity=".82" />
      <rect x="100" y="61" width="11" height="48" rx="3.5" fill="#fff" />
      <path d="M70 62 103 29m-15 0h15v15" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark + "JMSURF Garage" wordmark. `tone="light"` for dark backgrounds. */
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
          JMSURF <span className={tone === "light" ? "text-[#ff8a8f]" : "text-primary"}>DASH</span>
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
