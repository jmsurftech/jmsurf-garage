import { useCallback, useSyncExternalStore } from "react";

/**
 * Appearance settings for this device: colour preset or custom colour, light /
 * dark / follow-the-device mode, sidebar style, corner roundness and text
 * size. The JMSURF Garage brand (src/index.css) is the default; a choice here
 * overrides the brand colours with CSS variables on <html>.
 */
export interface ThemePreset {
  name: string;
  /** HSL triplet of the main colour, e.g. "15 67% 46%". */
  primary: string;
  /** Second colour (badges, highlights). */
  accent: string;
  sidebarBg: string;
  sidebarAccent: string;
  sidebarBorder: string;
  sidebarPrimary: string;
  ring: string;
  success: string;
}

export const BRAND_THEME: ThemePreset = {
  name: "JMSURF Garage",
  primary: "356 81% 36%",
  accent: "225 14% 10%",
  sidebarBg: "0 0% 100%",
  sidebarAccent: "0 76% 96%",
  sidebarBorder: "220 13% 92%",
  sidebarPrimary: "356 81% 36%",
  ring: "356 81% 36%",
  success: "158 83% 28%",
};

const preset = (name: string, primary: string, accent: string): ThemePreset => ({
  name, primary, accent, sidebarBg: "0 0% 100%", sidebarAccent: tint(primary, 96), sidebarBorder: "30 10% 91%",
  sidebarPrimary: primary, ring: primary, success: "152 60% 36%",
});

export const themePresets: ThemePreset[] = [
  BRAND_THEME,
  preset("JMSURF Bright", "355 77% 50%", "225 14% 10%"),
  preset("Ocean Teal", "178 80% 26%", "356 81% 36%"),
  preset("Forest", "145 55% 30%", "38 92% 45%"),
  preset("Royal Blue", "221 75% 48%", "262 60% 55%"),
  preset("Grape", "268 55% 48%", "330 70% 55%"),
  preset("Rose", "345 70% 50%", "200 70% 40%"),
  preset("Sunflower", "38 92% 44%", "220 50% 30%"),
  preset("Graphite", "220 15% 28%", "356 81% 36%"),
  preset("Midnight Navy", "222 60% 28%", "38 92% 50%"),
  preset("Emerald", "160 84% 30%", "222 47% 25%"),
  preset("Savanna", "28 80% 42%", "150 40% 30%"),
  preset("Lake Blue", "199 89% 40%", "28 90% 50%"),
  preset("Indigo", "239 70% 52%", "174 72% 36%"),
  preset("Plum", "292 45% 40%", "38 92% 50%"),
  preset("Coral", "10 78% 54%", "200 60% 32%"),
  preset("Mint", "165 60% 36%", "260 50% 50%"),
  preset("Slate", "215 25% 35%", "199 89% 45%"),
  preset("Cherry", "345 85% 40%", "45 95% 48%"),
  preset("Tangerine", "24 95% 50%", "222 47% 22%"),
  preset("Olive", "75 45% 32%", "28 80% 45%"),
  preset("Turquoise", "182 70% 34%", "330 65% 48%"),
  preset("Lavender", "255 55% 58%", "330 60% 55%"),
  preset("Cocoa", "20 35% 32%", "38 85% 50%"),
  preset("Sky", "205 85% 50%", "45 95% 50%"),
  preset("Magenta", "322 75% 45%", "200 70% 40%"),
  preset("Pine", "170 60% 22%", "45 90% 48%"),
  preset("Charcoal Gold", "220 13% 18%", "43 90% 46%"),
  preset("Ruby", "350 75% 34%", "220 13% 20%"),
  preset("Crimson", "348 83% 42%", "210 30% 25%"),
  preset("Maasai Red", "4 78% 42%", "40 90% 45%"),
  preset("Brick", "12 62% 40%", "200 35% 30%"),
  preset("Terracotta", "16 58% 48%", "160 35% 30%"),
  preset("Amber", "45 96% 42%", "222 47% 20%"),
  preset("Safari Gold", "40 75% 40%", "150 45% 25%"),
  preset("Mustard", "50 80% 38%", "260 40% 35%"),
  preset("Lime", "85 60% 36%", "222 47% 25%"),
  preset("Kiwi", "95 50% 40%", "330 55% 45%"),
  preset("Jade", "152 60% 32%", "350 70% 45%"),
  preset("Coffee Highlands", "25 45% 28%", "140 40% 32%"),
  preset("Tea Leaf", "130 40% 28%", "30 80% 45%"),
  preset("Sea Green", "168 55% 30%", "15 80% 50%"),
  preset("Aqua", "188 85% 36%", "350 70% 50%"),
  preset("Cyan", "192 90% 38%", "24 90% 50%"),
  preset("Cobalt", "215 90% 42%", "45 95% 50%"),
  preset("Sapphire", "225 80% 38%", "180 60% 35%"),
  preset("Denim", "212 45% 40%", "28 80% 50%"),
  preset("Steel Blue", "207 44% 42%", "355 70% 45%"),
  preset("Ultramarine", "232 75% 45%", "50 95% 50%"),
  preset("Violet", "272 70% 50%", "160 60% 35%"),
  preset("Amethyst", "282 45% 45%", "45 90% 48%"),
  preset("Orchid", "302 50% 48%", "190 60% 35%"),
  preset("Fuchsia", "315 85% 45%", "200 70% 35%"),
  preset("Berry", "335 65% 38%", "200 50% 30%"),
  preset("Wine", "340 60% 28%", "40 80% 50%"),
  preset("Burgundy", "345 70% 26%", "30 60% 45%"),
  preset("Peach", "18 85% 58%", "210 40% 30%"),
  preset("Salmon", "6 80% 58%", "190 50% 30%"),
  preset("Copper", "22 70% 40%", "195 50% 30%"),
  preset("Bronze", "32 55% 35%", "220 30% 25%"),
  preset("Sand", "38 40% 45%", "200 45% 30%"),
  preset("Stone", "30 10% 38%", "355 70% 45%"),
  preset("Ash", "210 10% 40%", "160 60% 32%"),
  preset("Onyx", "0 0% 12%", "45 90% 48%"),
  preset("Ink", "230 35% 18%", "190 80% 40%"),
];

export type ThemeMode = "light" | "dark" | "system";
export type SidebarStyle = "light" | "tinted" | "dark";
export type Radius = "sharp" | "rounded" | "extra";
export type TextSize = "compact" | "normal" | "large";
export interface ThemeSettings {
  preset: string;
  custom: string | null;
  mode: ThemeMode;
  sidebar: SidebarStyle;
  radius: Radius;
  text: TextSize;
}
export const DEFAULT_THEME: ThemeSettings = { preset: BRAND_THEME.name, custom: null, mode: "light", sidebar: "light", radius: "rounded", text: "normal" };

const KEY = "dash-theme-v2";
const LEGACY_DARK_KEY = "dash-dark-mode";

export function hexToHsl(hex: string): string {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function hslToHex(hslStr: string): string {
  const parts = hslStr.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return "#888888";
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parts(hsl: string) { return (hsl.match(/[\d.]+/g) || ["0", "0", "0"]).map(Number); }
/** Same hue, very light (for hovers and the tinted sidebar). */
function tint(hsl: string, lightness: number) { const [h, s] = parts(hsl); return `${h} ${Math.min(80, s)}% ${lightness}%`; }
function lighten(hsl: string, by: number) { const [h, s, l] = parts(hsl); return `${h} ${s}% ${Math.min(72, l + by)}%`; }
/** The same colour made readable on a dark background: at least 58% light, never neon. */
function forDark(hsl: string) { const [h, s, l] = parts(hsl); return `${h} ${Math.min(s, 85)}% ${Math.min(72, Math.max(58, l + 12))}%`; }

export function buildThemeFromHsl(hsl: string): ThemePreset {
  return { ...preset("Custom", hsl, BRAND_THEME.accent) };
}

function read(): ThemeSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") return { ...DEFAULT_THEME, ...v };
    // Older builds only stored light/dark.
    if (localStorage.getItem(LEGACY_DARK_KEY) === "true") return { ...DEFAULT_THEME, mode: "dark" };
  } catch { /* storage blocked */ }
  return DEFAULT_THEME;
}

let current: ThemeSettings = typeof window === "undefined" ? DEFAULT_THEME : read();
const listeners = new Set<() => void>();
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const isDark = (t: ThemeSettings) => t.mode === "dark" || (t.mode === "system" && !!media?.matches);

/** Writes the chosen look onto <html> as CSS variables. */
function apply(t: ThemeSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = isDark(t);
  root.classList.toggle("dark", dark);
  const base = t.custom ? buildThemeFromHsl(hexToHsl(t.custom)) : themePresets.find((p) => p.name === t.preset) || BRAND_THEME;
  const isBrand = !t.custom && base.name === BRAND_THEME.name;
  const set = (k: string, v: string | null) => (v === null ? root.style.removeProperty(k) : root.style.setProperty(k, v));
  const primary = dark ? forDark(base.primary) : base.primary;
  // Brand colours come from index.css; any other choice overrides them.
  set("--primary", isBrand ? null : primary);
  set("--ring", isBrand ? null : primary);
  set("--sidebar-primary", isBrand ? null : primary);
  set("--sidebar-ring", isBrand ? null : primary);
  set("--accent", isBrand ? null : dark ? forDark(base.accent) : base.accent);
  set("--primary-foreground", isBrand ? null : "0 0% 100%");
  set("--sidebar-primary-foreground", isBrand ? null : "0 0% 100%");
  // Sidebar style
  if (t.sidebar === "dark") {
    set("--sidebar-background", "222 18% 12%"); set("--sidebar-foreground", "220 14% 86%");
    set("--sidebar-accent", "222 14% 19%"); set("--sidebar-accent-foreground", "0 0% 100%"); set("--sidebar-border", "222 12% 20%");
  } else if (t.sidebar === "tinted" && !dark) {
    set("--sidebar-background", tint(base.primary, 97)); set("--sidebar-foreground", "20 10% 22%");
    set("--sidebar-accent", tint(base.primary, 92)); set("--sidebar-accent-foreground", base.primary); set("--sidebar-border", tint(base.primary, 89));
  } else {
    for (const k of ["--sidebar-background", "--sidebar-foreground", "--sidebar-border"]) set(k, null);
    set("--sidebar-accent", isBrand || dark ? null : tint(base.primary, 96));
    set("--sidebar-accent-foreground", isBrand ? null : dark ? forDark(base.primary) : base.primary);
  }
  set("--radius", t.radius === "sharp" ? "0.375rem" : t.radius === "extra" ? "1.1rem" : null);
  root.style.fontSize = t.text === "compact" ? "14.5px" : t.text === "large" ? "17px" : "";
  root.dataset.radius = t.radius;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0e11" : hslToHex(base.primary));
}

function setTheme(next: Partial<ThemeSettings>) {
  current = { ...current, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(current)); localStorage.setItem(LEGACY_DARK_KEY, String(isDark(current))); } catch { /* per-device only */ }
  apply(current);
  listeners.forEach((l) => l());
}

media?.addEventListener?.("change", () => { if (current.mode === "system") { apply(current); listeners.forEach((l) => l()); } });

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current, () => DEFAULT_THEME);
  const darkMode = isDark(theme);
  const toggleDarkMode = useCallback(() => setTheme({ mode: isDark(current) ? "light" : "dark" }), []);
  const selectTheme = useCallback((name: string) => setTheme({ preset: name, custom: null }), []);
  const setCustomColor = useCallback((hex: string) => { if (/^#[0-9a-fA-F]{6}$/.test(hex)) setTheme({ custom: hex }); }, []);
  return {
    theme, setTheme, reset: () => setTheme(DEFAULT_THEME),
    activeTheme: theme.custom ? "Custom" : theme.preset, selectTheme, themePresets,
    customColor: theme.custom || hslToHex((themePresets.find((p) => p.name === theme.preset) || BRAND_THEME).primary),
    setCustomColor, darkMode, toggleDarkMode,
  };
}

export function initTheme() {
  apply(current);
}
