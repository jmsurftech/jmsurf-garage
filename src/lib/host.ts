/**
 * JMSURF Garage addresses.
 *
 *   garage.jmsurf.co.ke / www      website, pricing, sign-up, legal (+ the database API paths)
 *   app.garage.jmsurf.co.ke        the staff workspace: sign in, and the company comes from the
 *                                  signed-in membership (switch company in the header)
 *   admin.garage.jmsurf.co.ke      platform super admin (sys-garage.jmsurfsys.co.ke inside the hub)
 *   <slug>.garage.jmsurf.co.ke     a company: workspace + its website and customer portal
 *   a company's own domain         same as its subdomain (custom domains)
 *
 * Local development serves everything on one address with /<slug>/… paths.
 * Links for staff (emails, SMS) go to app.; links for a garage's customers go to its own address.
 */
export const ROOT_HOST = "garage.jmsurf.co.ke";
/** The JMSURF SYSTEMS hub shows the super admin through this address (framed proxy). */
export const HUB_PLATFORM_HOST = "sys-garage.jmsurfsys.co.ke";

/** Slug of the one company this build serves, when it is a standalone deployment. */
const FIXED_SHOP: string | null = (() => {
  const v = String(import.meta.env.VITE_SHOP_SLUG || "").trim().toLowerCase();
  return /^[a-z0-9-]{2,63}$/.test(v) ? v : null;
})();

/** Hostnames that can never belong to a company. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "admin", "app", "dash", "api", "pay", "mail", "mx", "smtp", "imap", "pop", "webmail", "cpanel", "whm",
  "ftp", "cdn", "static", "assets", "img", "images", "files", "blog", "docs", "portal", "my",
  "help", "support", "status", "dev", "staging", "preview", "test",
  "notify", "email", "mailer", "auth", "login", "register", "signup", "aggregator",
  "webhook", "webhooks", "ns", "ns1", "ns2", "autodiscover", "autoconfig", "_domainkey", "jmsurf-admin",
]);

/** Company addresses that exist but cannot be taken at sign-up (the public demo). */
const NOT_FOR_SIGNUP = new Set(["demo"]);

export function isReservedSubdomain(label: string, forSignup = false): boolean {
  const l = (label || "").trim().toLowerCase();
  return RESERVED_SUBDOMAINS.has(l) || (forSignup && NOT_FOR_SIGNUP.has(l));
}

/** Current hostname, lowercase. Safe during SSR/tests. */
function currentHost(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.toLowerCase();
}

const isLocal = (h: string) => h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(h);

/**
 * Returns the company slug when the browser is on <slug>.garage.jmsurf.co.ke or on
 * a company's own domain, otherwise null (website, app, dash, local hosts).
 */
export function getHostSlug(host: string = currentHost()): string | null {
  if (FIXED_SHOP) return FIXED_SHOP;
  if (!host) return null;
  if (host === currentHost() && !host.endsWith(ROOT_HOST) && !isLocal(host)) {
    const stamped = customDomainSlug();
    if (stamped) return stamped;
  }
  if (!host.endsWith(`.${ROOT_HOST}`)) return null;
  const label = host.slice(0, host.length - ROOT_HOST.length - 1);
  if (!label || label.includes(".")) return null;
  if (isReservedSubdomain(label)) return null;
  return label;
}

/** Slug of the company whose own domain this is (stamped into the page by the server), else null. */
export function customDomainSlug(): string | null {
  if (typeof document === "undefined") return null;
  const v = document.querySelector('meta[name="jmsurf-shop"]')?.getAttribute("content") || "";
  return /^[a-z0-9-]{2,63}$/.test(v) ? v : null;
}

/** True when the page is on a company's own (custom) domain. */
export function isCustomDomain(): boolean {
  return customDomainSlug() !== null && !currentHost().endsWith(ROOT_HOST);
}

/** True when the app is being served for one company (subdomain or custom domain). */
export function isSubdomainMode(): boolean {
  return getHostSlug() !== null;
}

/** True on the apex / www host (the website). */
export function isApexHost(host: string = currentHost()): boolean {
  return host === ROOT_HOST || host === `www.${ROOT_HOST}`;
}

/** The platform super admin address. */
export function isPlatformHost(host: string = currentHost()): boolean {
  return host === `admin.${ROOT_HOST}` || host === HUB_PLATFORM_HOST;
}

/** The staff workspace address (app.): the company is the signed-in one. */
export function isAppHost(host: string = currentHost()): boolean {
  return host === `app.${ROOT_HOST}`;
}

/** Company screens use clean paths (no /<slug>/ prefix): a company address or app. */
export function cleanPaths(): boolean {
  return isSubdomainMode() || isAppHost();
}

/**
 * Staff address for a company, e.g. https://app.garage.jmsurf.co.ke/login.
 * The workspace on app. opens the signed-in company; `co` names the company for
 * the sign-in hand-over (see companySwitch.acceptHandoff).
 */
export function tenantUrl(slug: string, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isDevHost()) return `${window.location.origin}/${slug}${p}`;
  if (FIXED_SHOP) return `${window.location.origin}${p}`;
  return `https://app.${ROOT_HOST}${p}`;
}

/** A company's own address (website, customer portal, shop), e.g. https://acme.garage.jmsurf.co.ke/ */
export function companyUrl(slug: string, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isDevHost()) return `${window.location.origin}/${slug}${p}`;
  return `https://${slug}.${ROOT_HOST}${p}`;
}

/**
 * In-app path for a company route. On a company address or app. paths stay
 * clean; elsewhere (local) the slug prefix is kept.
 */
export function tenantPath(slug: string | null | undefined, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (cleanPaths() || !slug) return p;
  return `/${slug}${p}`;
}

/** The address we show owners for their company. */
export function storeUrl(slug: string): string {
  return `https://${slug}.${ROOT_HOST}`;
}

export const SITE_ORIGIN = `https://${ROOT_HOST}`;
export const APP_ORIGIN = `https://app.${ROOT_HOST}`;
export const PLATFORM_ORIGIN = typeof window !== "undefined" && window.location.hostname === HUB_PLATFORM_HOST
  ? `https://${HUB_PLATFORM_HOST}` : `https://admin.${ROOT_HOST}`;
/** Kept for older screens: the generic sign-in address. */
export const ERP_ORIGIN = APP_ORIGIN;

/** True where the company workspace runs (app., company subdomain, custom domain, local). */
export function isErpHost(host: string = currentHost()): boolean {
  return getHostSlug(host) !== null || isAppHost(host) || isLocal(host);
}
/** True on the public website. */
export function isSiteHost(host: string = currentHost()): boolean {
  return isApexHost(host);
}
/** Local development: everything on one address. */
export function isDevHost(host: string = currentHost()): boolean {
  return isLocal(host);
}
