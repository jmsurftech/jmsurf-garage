import { useLayoutEffect } from "react";

/**
 * One loading screen from the first byte to the first real page.
 *
 * index.html shows #boot (logo + spinner) while the app downloads. Removing it as soon as React
 * started left a row of separate loaders behind it (sign-in, account, company, two-step,
 * permissions, page file), each drawn afresh, which looked like the page refreshing again and
 * again. Now #boot stays on top until no full-screen loader has been on screen for a moment.
 */
let active = 0;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function removeBoot() {
  timer = null;
  if (active > 0) return;
  const el = document.getElementById("boot");
  if (!el) return;
  el.style.transition = "opacity .18s ease";
  el.style.opacity = "0";
  setTimeout(() => el.remove(), 200);
}

function schedule() {
  if (!started || active > 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(removeBoot, 150);
}

/** main.tsx, once React has started: #boot becomes a cover over the app until it is ready. */
export function startBootCover() {
  if (typeof document === "undefined") return;
  started = true;
  const el = document.getElementById("boot");
  if (el) Object.assign(el.style, { position: "fixed", inset: "0", zIndex: "2147483600", minHeight: "0" });
  schedule();
  // Never cover the app for long, whatever happens.
  setTimeout(() => { active = 0; removeBoot(); }, 20_000);
}

/** Full-screen loaders call this: the start-up screen stays while one is showing. */
export function useBootCover() {
  useLayoutEffect(() => {
    active++;
    if (timer) { clearTimeout(timer); timer = null; }
    return () => { active = Math.max(0, active - 1); schedule(); };
  }, []);
}
