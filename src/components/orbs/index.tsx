import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { ThinkingOrb } from "./lib/ThinkingOrb";
import type { OrbState } from "./lib/types";

export type { OrbState };

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Light text around the orb (primary buttons, dark mode, dark panels) → draw light dots. */
let probe: CanvasRenderingContext2D | null = null;
function prefersLightInk(el: Element): boolean {
  // Paint the computed colour into a 1px canvas so any CSS colour syntax
  // (hsl, oklch, color-mix, hex) resolves to sRGB bytes.
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return false;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = getComputedStyle(el).color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
}

/**
 * Inline "thinking orb" spinner (github.com/Jakubantalik/thinking-orbs, MIT).
 * Size comes from the className (defaults to 1rem) and the dot colour follows
 * the surrounding text, so it reads on buttons, badges and dark surfaces alike.
 */
export function OrbSpinner({
  className,
  state = "working",
  label = "Loading",
  style,
  decorative = false,
  speed,
  tint,
}: {
  className?: string;
  state?: OrbState;
  label?: string;
  style?: React.CSSProperties;
  /** Pure ornament (landing art, headers): hidden from screen readers. */
  decorative?: boolean;
  speed?: number;
  /** Colour the dots, e.g. the brand orange "#a8121b". */
  tint?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [px, setPx] = useState(0);
  const [lightInk, setLightInk] = useState(false);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      setPx(Math.max(10, Math.round(Math.min(r.width || r.height, r.height || r.width))));
      setLightInk(prefersLightInk(el));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <span
      ref={ref}
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={cn("inline-block size-4 shrink-0 align-middle", className)}
      style={style}
    >
      {px > 0 && (
        <ThinkingOrb
          state={state}
          size={px > 40 ? 64 : 20}
          renderSize={px}
          theme={lightInk ? "dark" : "light"}
          speed={speed}
          tint={tint}
          aria-hidden
        />
      )}
    </span>
  );
}

/** Centered orb with a caption, for sections and panels that are loading. */
export function OrbLoader({
  label = "Loading…",
  state = "working",
  size = 88,
  className,
}: {
  label?: string | null;
  state?: OrbState;
  size?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground", className)}>
      <OrbSpinner state={state} label={label ?? "Loading"} tint="#d0182a" style={{ width: size, height: size }} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
