/**
 * JMSURF Garage addresses (the server twin is hosts.js).
 *
 *   jmsurfgarage.co.ke          website, pricing, sign-up, legal (+ the database API paths)
 *   www.jmsurfgarage.co.ke      301 to jmsurfgarage.co.ke
 *   app.jmsurfgarage.co.ke      the one sign-in for every company's staff: the company comes from the
 *                               signed-in membership (switch company in the header)
 *   app.jmsurfgarage.co.ke/<slug>/…  a company's customer pages (job tracking, pay links, customer
 *                               portal, website): the server stamps the page with
 *                               <meta name="jmsurf-shop"> + <meta name="jmsurf-base" content="/<slug>">
 *   admin.jmsurfgarage.co.ke    platform super admin (sys-garage.jmsurfsys.co.ke inside the hub)
 *   a company's own domain      its workspace and customer pages at the root (paid add-on; the server
 *                               stamps <meta name="jmsurf-shop">)
 *
 * There are no company subdomains. Local development serves everything on one address with
 * /<slug>/… paths. Links for staff go to app.; links for customers go to the company's
 * customer pages (customerUrl: own domain first, else app.jmsurfgarage.co.ke/<slug>).
 */
export const ROOT_HOST = "jmsurfgarage.co.ke";
/** The JMSURF SYSTEMS hub shows the super admin through this address (framed proxy). */
export const HUB_PLATFORM_HOST = "sys-garage.jmsurfsys.co.ke";

/** Slug of the one company this build serves, when it is a standalone deployment. */
const FIXED_SHOP: string | null = (() => {
  const v = String(import.meta.env.VITE_SHOP_SLUG || "").trim().toLowerCase();
  return /^[a-z0-9-]{2,63}$/.test(v) ? v : null;
})();

/**
 * Words that can never be a company slug: first path segments of app.jmsurfgarage.co.ke and platform
 * words. Same list as hosts.js and public.garage_reserved_slugs() (the database makes every slug).
 */
export const RESERVED_SLUGS = new Set([
  "www", "admin", "app", "dash", "api", "pay", "mail", "mx", "smtp", "imap", "pop", "webmail", "cpanel", "whm",
  "ftp", "cdn", "static", "assets", "img", "images", "files", "blog", "docs", "portal", "my",
  "help", "support", "status", "dev", "staging", "preview", "test",
  "notify", "email", "mailer", "auth", "login", "register", "signup", "aggregator",
  "webhook", "webhooks", "ns", "ns1", "ns2", "autodiscover", "autoconfig", "_domainkey", "jmsurf-admin",
  "dashboard", "pos", "inventory", "customers", "sales", "purchases", "payments", "email-logs", "reports",
  "ai-analysis", "ai", "staff", "settings", "delivery-confirm", "stock-transfer", "purchase-orders", "suppliers",
  "invoices", "quotes", "expenses", "bills", "services", "mpesa-history", "credit-balances", "unsubscribe",
  "audit-log", "404", "order", "rider", "water", "tickets", "whats-new", "subscription-expired", "billing",
  "reset-password", "staff-login", "customer-login", "signin", "account", "shop", "about", "contact", "cart",
  "checkout", "book", "events", "learn", "careers", "join", "sign", "contract", "oauth", "terms", "privacy",
  "photo-credits", "pricing", "features", "solutions", "crm", "calendar", "marketing", "finance", "approvals",
  "profile", "hrm", "me", "documents", "warehouse", "branches", "accounting", "companies", "notebook",
  "contracts", "garage", "garage-menu", "modules", "import", "migrate", "callcentre", "apps", "sales-reps",
  "e", "t", "fleet", "check", "yard", "preorder", "well-known", "shop-brand",
]);

export function isReservedSlug(label: string): boolean {
  return RESERVED_SLUGS.has((label || "").trim().toLowerCase());
}

/** Current hostname, lowercase. Safe during SSR/tests. */
function currentHost(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.toLowerCase();
}

const isLocal = (h: string) => h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(h);

const meta = (name: string) =>
  typeof document === "undefined" ? "" : document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || "";

/** Slug of the company the server stamped into this page (its own domain or app.…/<slug>/), else null. */
export function customDomainSlug(): string | null {
  const v = meta("jmsurf-shop");
  return /^[a-z0-9-]{2,63}$/.test(v) ? v : null;
}

/** "/<slug>" when this page is a company's page on app.jmsurfgarage.co.ke, else "". */
export function pathBase(): string {
  const v = meta("jmsurf-base");
  return /^\/[a-z0-9-]{2,63}$/.test(v) && v.slice(1) === customDomainSlug() ? v : "";
}

/** The company these pages belong to (own domain or app.…/<slug>/), else null (website, app., admin., local). */
export function getHostSlug(host: string = currentHost()): string | null {
  if (FIXED_SHOP) return FIXED_SHOP;
  if (!host || host !== currentHost()) return null;
  return customDomainSlug();
}

/** True when the page is on a company's own (custom) domain. */
export function isCustomDomain(): boolean {
  const h = currentHost();
  return customDomainSlug() !== null && !pathBase() && h !== ROOT_HOST && !h.endsWith(`.${ROOT_HOST}`) && !isLocal(h);
}

/** True when the app is being served for one company (its own domain or app.…/<slug>/). */
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

/** Company screens use clean paths (no /<slug>/ prefix in the router): a company's pages or app. */
export function cleanPaths(): boolean {
  return isSubdomainMode() || isAppHost();
}

export const SITE_ORIGIN = `https://${ROOT_HOST}`;
export const APP_ORIGIN = `https://app.${ROOT_HOST}`;
export const PLATFORM_ORIGIN = typeof window !== "undefined" && window.location.hostname === HUB_PLATFORM_HOST
  ? `https://${HUB_PLATFORM_HOST}` : `https://admin.${ROOT_HOST}`;
/** Kept for older screens: the generic sign-in address. */
export const ERP_ORIGIN = APP_ORIGIN;

/**
 * Staff address, e.g. https://app.jmsurfgarage.co.ke/login. The workspace on app. opens the signed-in
 * company; on a company's own domain staff stay there; `slug` names the company for local development.
 */
export function tenantUrl(slug: string, path = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isDevHost()) return `${window.location.origin}/${slug}${p}`;
  if (FIXED_SHOP || isCustomDomain()) return `${window.location.origin}${p}`;
  return `${APP_ORIGIN}${p}`;
}

/**
 * A company's customer pages: its own domain when it has an active one, else
 * https://app.jmsurfgarage.co.ke/<slug>. `customHost` is the company's active domain, when known.
 */
export function publicBase(slug: string | null | undefined, customHost?: string | null): string {
  if (customHost) return `https://${customHost}`;
  if (typeof window !== "undefined" && isDevHost()) return slug ? `${window.location.origin}/${slug}` : window.location.origin;
  if (FIXED_SHOP) return typeof window !== "undefined" ? window.location.origin : APP_ORIGIN;
  return slug ? `${APP_ORIGIN}/${slug}` : APP_ORIGIN;
}

/** A company's customer page address, e.g. companyUrl("acme", "/order"). */
export function companyUrl(slug: string, path = "/", customHost?: string | null): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${publicBase(slug, customHost)}${p === "/" ? "" : p}` || "/";
}

// The signed-in company's customer pages, set by TenantProvider (custom domain once known).
let currentBase: string | null = null;
export function setCompanyBase(base: string | null) { currentBase = base; }

/**
 * Link for the signed-in company's customers (job tracking, pay links, portal, QR codes):
 * the company's own domain when active, else app.jmsurfgarage.co.ke/<slug>.
 */
export function customerUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (currentBase) return `${currentBase}${p}`;
  if (typeof window === "undefined") return `${APP_ORIGIN}${p}`;
  const slug = getHostSlug();
  if (slug) return `${window.location.origin}${pathBase()}${p}`;
  return `${window.location.origin}${p}`;
}

/**
 * In-app path for a company route. On a company's pages or app. paths stay
 * clean; elsewhere (local) the slug prefix is kept.
 */
export function tenantPath(slug: string | null | undefined, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (cleanPaths() || !slug) return p;
  return `/${slug}${p}`;
}

/** True where the company workspace runs (app., a company's own domain or pages, local). */
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

/**
 * On app.jmsurfgarage.co.ke/<slug>/… the server finds the company from this header (the page's
 * own /api/ calls go to the root of app.). Installed once at start-up.
 */
export function installShopSlugHeader() {
  if (typeof window === "undefined") return;
  const base = pathBase();
  const slug = customDomainSlug();
  if (!base || !slug) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has("x-shop-slug")) headers.set("x-shop-slug", slug);
        return orig(input, { ...init, headers });
      }
    } catch { /* not a URL: leave it */ }
    return orig(input, init);
  };
}
