import { cn } from "@/lib/utils";

/**
 * Soft glowing orbs that drift slowly behind a section (the landing page look,
 * reused in the workspace and sign-in pages). Purely decorative: no pointer
 * events, hidden from screen readers, still when reduced motion is preferred.
 */
export function Orbs({ className, intensity = "normal" }: { className?: string; intensity?: "subtle" | "normal" | "strong" }) {
  const o = intensity === "subtle" ? "opacity-40" : intensity === "strong" ? "opacity-90" : "opacity-70";
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", o, className)}>
      <span className="orb orb-a" />
      <span className="orb orb-b" />
      <span className="orb orb-c" />
    </div>
  );
}

/** A faint grid that fades out towards the edges. */
export function GridGlow({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]", className)} />
  );
}

/**
 * The landing hero's backdrop: a faint accounts ledger instead of plain squares. Ruled rows and
 * column rules like a book of accounts, invoice lines with amounts, small bar charts, and one
 * sales line rising across the page in the company colour. Fades out towards the edges.
 */
export function LedgerBackdrop({ className }: { className?: string }) {
  const rows = [
    ["INV-0142", "KES 48,500", 62], ["PAYE", "KES 12,300", 38], ["M-Pesa", "KES 7,250", 48], ["Stock", "320 units", 30],
    ["BILL-088", "KES 21,900", 54], ["VAT 16%", "KES 6,640", 34], ["Payroll", "KES 96,000", 70], ["eTIMS", "Signed", 26],
  ] as const;
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 text-foreground [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_78%)]", className)}>
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <defs>
          <pattern id="dash-ledger" width="360" height="224" patternUnits="userSpaceOnUse">
            {/* ruled rows */}
            {Array.from({ length: 8 }).map((_, i) => <line key={i} x1="0" x2="360" y1={i * 28 + 27.5} y2={i * 28 + 27.5} stroke="currentColor" strokeOpacity=".07" />)}
            {/* margin and money columns */}
            <line x1="22.5" x2="22.5" y1="0" y2="224" stroke="hsl(var(--primary))" strokeOpacity=".16" />
            <line x1="25.5" x2="25.5" y1="0" y2="224" stroke="hsl(var(--primary))" strokeOpacity=".1" />
            <line x1="230.5" x2="230.5" y1="0" y2="224" stroke="currentColor" strokeOpacity=".07" />
            <line x1="300.5" x2="300.5" y1="0" y2="224" stroke="currentColor" strokeOpacity=".07" />
            {/* entries */}
            {rows.map(([ref, amt, w], i) => (
              <g key={ref} fill="currentColor" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9">
                <text x="34" y={i * 28 + 19} fillOpacity=".16">{ref}</text>
                <rect x="96" y={i * 28 + 13} width={w * 1.6} height="4" rx="2" fillOpacity=".07" />
                <text x="296" y={i * 28 + 19} textAnchor="end" fillOpacity=".14">{amt}</text>
                {i % 3 === 0 && <text x="350" y={i * 28 + 19} textAnchor="end" fill="hsl(var(--primary))" fillOpacity=".3">✓</text>}
              </g>
            ))}
            {/* a small bar chart in the corner of each sheet */}
            {[10, 16, 12, 20, 26].map((h, i) => <rect key={i} x={312 + i * 8} y={214 - h} width="5" height={h} rx="1" fill="hsl(var(--primary))" fillOpacity=".09" />)}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dash-ledger)" />
      </svg>
      {/* one sales line rising across the hero */}
      <svg className="absolute inset-x-0 bottom-0 h-[55%] w-full" viewBox="0 0 1200 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="dash-rise" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity=".1" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,270 C120,262 180,240 260,236 S400,250 470,214 S600,170 680,182 S820,150 900,112 S1060,70 1200,30 L1200,300 L0,300 Z" fill="url(#dash-rise)" />
        <path d="M0,270 C120,262 180,240 260,236 S400,250 470,214 S600,170 680,182 S820,150 900,112 S1060,70 1200,30" fill="none" stroke="hsl(var(--primary))" strokeOpacity=".22" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {[[260, 236], [470, 214], [680, 182], [900, 112], [1200, 30]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" fill="hsl(var(--primary))" fillOpacity=".3" />)}
      </svg>
    </div>
  );
}
