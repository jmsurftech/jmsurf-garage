/**
 * Active shop branding for the browser chrome.
 *
 * Each tenant browses on its own subdomain, so the tab title and the installable
 * app name read as that shop. The icon is always the JMSURF Garage mark (owner's
 * rule, 2026-10-16); a shop's own logo shows only on its public website.
 */

const DEFAULT_ICON = "/pwa-icon-192.png?v=3";
let brandName: string | null = null;
let brandIcon: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeBrand(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getBrandName() {
  return brandName;
}

/** Short shop name for the tab, e.g. "After Hours Liquor & Bites" -> "After Hours". */
export function brandShortName(name: string | null = brandName): string | null {
  if (!name) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  // "Smith & Sons Ltd" → "Smith & Sons", not "Smith &".
  const take = words[1] === "&" || words[1] === "and" ? 3 : 2;
  return words.slice(0, take).join(" ");
}

function setFavicon(href: string) {
  if (typeof document === "undefined") return;
  const rels = ["icon", "apple-touch-icon"];
  rels.forEach((rel) => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-brand="1"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      link.dataset.brand = "1";
      document.head.appendChild(link);
    }
    link.href = href;
  });
}

function setManifest(name: string, icon: string) {
  if (typeof document === "undefined") return;
  const manifest = {
    name: `${name} POS`,
    short_name: brandShortName(name) || name,
    description: `${name} point of sale`,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#a8121b",
    background_color: "#f5f5f4",
    icons: [
      { src: icon, sizes: "192x192", type: "image/png" },
      { src: icon, sizes: "512x512", type: "image/png" },
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  try {
    const href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = href;
  } catch {
    /* keep the static manifest */
  }
}

/** Browser tab title: "<Company> | <Page>" inside a company workspace, "JMSURF Garage | <Page>" elsewhere. */
export function tabTitle(page: string): string {
  const b = brandShortName(brandName);
  return `${b ? b.toUpperCase() : "JMSURF Garage"} | ${page}`;
}

/** Apply a shop's identity to the tab, favicon and installable app entry. */
let brandFavicon: string | null = null;
/** faviconUrl: the company's own favicon (Business settings); otherwise the JMSURF Garage mark. */
export function setBrand(name: string | null, logoUrl?: string | null, faviconUrl?: string | null) {
  const changed = name !== brandName || (logoUrl || null) !== brandIcon || (faviconUrl || null) !== brandFavicon;
  brandName = name || null;
  brandIcon = logoUrl || null;
  brandFavicon = faviconUrl || null;
  if (!changed) return;
  if (brandName) {
    setFavicon(brandFavicon || DEFAULT_ICON);
    setManifest(brandName, brandFavicon || DEFAULT_ICON);
    const apple = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (apple) apple.content = brandShortName(brandName) || brandName;
  }
  emit();
}
