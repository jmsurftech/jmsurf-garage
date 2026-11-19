import { useEffect, useState } from "react";

/** How the main menu is laid out on a computer (phones always use the drawer + bottom bar). */
export type NavLayout = "classic" | "dual" | "top" | "bottom";

const KEY = "garage.nav.layout";
const EVT = "dash:nav-layout";
const read = (): NavLayout => {
  try { const v = localStorage.getItem(KEY); return v === "dual" || v === "top" || v === "bottom" ? v : "classic"; } catch { return "classic"; }
};

export const NAV_LAYOUTS: { value: NavLayout; label: string; hint: string }[] = [
  { value: "classic", label: "Sidebar", hint: "One menu on the left with groups that open" },
  { value: "dual", label: "Two sidebars", hint: "App icons on the left, the open app's pages beside them" },
  { value: "top", label: "Top menu", hint: "A menu bar across the top with drop-downs" },
  { value: "bottom", label: "Bottom dock", hint: "A dock along the bottom, more room for work" },
];

/** The person's menu layout on this device; changing it updates every open screen. */
export function useNavLayout(): [NavLayout, (v: NavLayout) => void] {
  const [v, setV] = useState<NavLayout>(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
  }, []);
  const set = (x: NavLayout) => { try { localStorage.setItem(KEY, x); } catch { /* per-device only */ } window.dispatchEvent(new Event(EVT)); };
  return [v, set];
}
