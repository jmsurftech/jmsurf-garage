import { supabase } from "@/integrations/supabase/client";
import { BRAND_THEME, hslToHex, themePresets } from "@/hooks/useTheme";

/** The company's colour theme, saved in business_settings.theme by an admin. */
export type CompanyTheme = { preset?: string | null; custom?: string | null } | null;

/** Main colour of a company theme as hex, or null for the JMSURF Garage brand. */
export function companyThemeHex(t: unknown): string | null {
  if (!t || typeof t !== "object") return null;
  const { preset, custom } = t as { preset?: string; custom?: string };
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) return custom;
  const p = themePresets.find((x) => x.name === preset);
  if (!p || p.name === BRAND_THEME.name) return null;
  return hslToHex(p.primary);
}

/**
 * The logo's main colour: the most common clearly-coloured hue (greys, white and
 * near-black ignored). A logo with no real colour gives charcoal.
 */
export async function logoColor(file: Blob): Promise<string | null> {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const px = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    let solid = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 200) continue;
      const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
      if (l > 0.94) continue; // white background
      solid++;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      if (s < 0.3 || l < 0.12 || l > 0.85) continue;
      let h = 0;
      const d = max - min, R = r / 255, G = g / 255, B = b / 255;
      if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
      const key = Math.round(((h * 60 + 360) % 360) / 20);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b; buckets.set(key, e);
    }
    const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    if (!best || best.n < Math.max(12, solid * 0.04)) return solid ? "#3C3D3A" : null;
    const hex = (v: number) => Math.round(v / best.n).toString(16).padStart(2, "0");
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}

/**
 * The logo's colours, most used first (up to 6): each clearly different colour in the logo, plus a dark
 * ink colour when the logo has one (a navy or charcoal wordmark). White, greys and transparent parts are left out.
 * Used by Appearance → "Colours from your logo".
 */
export async function logoPalette(src: string | Blob): Promise<string[]> {
  try {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    const url = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = Math.max(1, Math.round((size * img.height) / Math.max(1, img.width)));
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    type B = { n: number; r: number; g: number; b: number };
    const hues = new Map<number, B>(); const dark: B = { n: 0, r: 0, g: 0, b: 0 };
    let solid = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 160) continue;
      const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
      if (l > 0.93) continue; // white
      solid++;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      if (l < 0.3 && s < 0.45) { dark.n++; dark.r += r; dark.g += g; dark.b += b; continue; } // ink: near-black, charcoal
      if (s < 0.22) continue; // greys
      let h = 0;
      const d = max - min, R = r / 255, G = g / 255, Bl = b / 255;
      if (max === R) h = ((G - Bl) / d) % 6; else if (max === G) h = (Bl - R) / d + 2; else h = (R - G) / d + 4;
      // Light and deep shades of one hue are told apart (sky blue vs navy).
      const key = Math.round(((h * 60 + 360) % 360) / 15) * 10 + (l < 0.42 ? 0 : l < 0.62 ? 1 : 2);
      const e = hues.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b; hues.set(key, e);
    }
    const hex = (e: B) => "#" + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, "0")).join("");
    // A colour must cover 5% of the logo: soft edges where two colours blend are not offered.
    const min = Math.max(6, solid * 0.05);
    const picks = [...hues.values()].filter((e) => e.n >= min).sort((a, b) => b.n - a.n).map(hex);
    if (dark.n >= min) picks.push(hex(dark));
    // Drop near-duplicates (two buckets landing on almost the same colour).
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const out: string[] = [];
    for (const c of picks) { const [r, g, b] = rgb(c); if (out.every((o) => { const [R, G, B] = rgb(o); return Math.abs(r - R) + Math.abs(g - G) + Math.abs(b - B) > 110; })) out.push(c); }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}

/** Saves the colour theme for everyone in the company (admins and managers only, by RLS). */
export async function saveCompanyTheme(tenantId: string, theme: CompanyTheme) {
  await (supabase as any).from("business_settings").update({ theme }).eq("tenant_id", tenantId);
}
