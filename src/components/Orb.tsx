import { OrbSpinner, OrbLoader as OrbPanelLoader, type OrbState } from "@/components/orbs";
import { cn } from "@/lib/utils";

export type { OrbState };
export { OrbSpinner };

/**
 * Animated dotted orb (github.com/Jakubantalik/thinking-orbs, MIT, vendored in
 * components/orbs) for loading and "busy" states. size 64 for screens and
 * panels, 20 inline next to text. The dots follow the text colour around them,
 * so they read on light, dark and brand-coloured surfaces; `tint` colours them.
 */
export function Orb({ state = "working", size = 96, label, className, tint }: {
  state?: OrbState; size?: number; theme?: "auto" | "dark" | "light"; label?: string; className?: string; tint?: string;
}) {
  return <OrbSpinner state={state} label={label} tint={tint} className={cn("shrink-0", className)} style={{ width: size, height: size }} />;
}

/** Full-area loader: orb with a short caption. */
export function OrbLoader({ label = "Loading…", state = "working", className }: {
  label?: string; state?: OrbState; theme?: "auto" | "dark" | "light"; className?: string;
}) {
  return <OrbPanelLoader label={label} state={state} size={96} className={cn("py-0", className)} />;
}

/** Large decorative orb (landing pages, empty states), brand-tinted by default. */
export function BrandOrb({ state = "breathing", size = 160, tint = "#a8121b", className }: {
  state?: OrbState; size?: number; tint?: string; className?: string;
}) {
  return <OrbSpinner decorative state={state} tint={tint} className={cn("pointer-events-none", className)} style={{ width: size, height: size }} />;
}
