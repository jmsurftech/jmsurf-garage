// ---------------------------------------------------------------------------
// JMSURF Garage addresses (server side; the browser twin is src/lib/host.ts).
//
//   jmsurfgarage.co.ke          website, pricing, sign-up, legal (+ the database API paths)
//   www.jmsurfgarage.co.ke      301 → jmsurfgarage.co.ke
//   app.jmsurfgarage.co.ke      the one sign-in for every company's staff (the company comes from
//                               the signed-in membership); a company's customer pages live at
//                               app.jmsurfgarage.co.ke/<slug>/… (job tracking, pay links, portal, website)
//   admin.jmsurfgarage.co.ke    platform super admin
//   a company's own domain      its workspace and customer pages at the root (paid add-on, KES 300 once)
//
// The old garage.jmsurf.co.ke addresses redirect here (server.js oldHostRedirect); there are no
// company subdomains any more.
// ---------------------------------------------------------------------------

export const ROOT_HOST = "jmsurfgarage.co.ke";
export const OLD_ROOT_HOST = "garage.jmsurf.co.ke";
export const APP_HOST = `app.${ROOT_HOST}`;
export const ADMIN_HOST = `admin.${ROOT_HOST}`;

/** An env address, ignored when it still names the old garage.jmsurf.co.ke addresses. */
const envOrigin = (name) => {
  const v = String(process.env[name] || "").trim().replace(/\/+$/, "");
  return v && !v.includes(OLD_ROOT_HOST) ? v : "";
};

export const SITE_ORIGIN = `https://${ROOT_HOST}`;
export const APP_ORIGIN = envOrigin("APP_ORIGIN") || `https://${APP_HOST}`;
export const ADMIN_ORIGIN = `https://${ADMIN_HOST}`;
/** Where outside services call back (M-Pesa, JMSURF PAY, WhatsApp, eTIMS…). */
export const PUBLIC_ORIGIN = envOrigin("PUBLIC_ORIGIN") || SITE_ORIGIN;
/** A standalone one-company deployment sets SHOP_ORIGIN; the shared service leaves it empty. */
export const SHOP_ORIGIN = envOrigin("SHOP_ORIGIN");

/**
 * Words that can never be a company slug: they are first path segments of app.jmsurfgarage.co.ke
 * (staff screens, public pages) or platform words. Same list as src/lib/host.ts and
 * public.garage_reserved_slugs() in the database.
 */
export const RESERVED_SLUGS = new Set([
  "www", "admin", "app", "dash", "api", "pay", "mail", "mx", "smtp", "imap", "pop", "webmail", "cpanel", "whm",
  "ftp", "cdn", "static", "assets", "img", "images", "files", "blog", "docs", "portal", "my",
  "help", "support", "status", "dev", "staging", "preview", "test",
  "notify", "email", "mailer", "auth", "login", "register", "signup", "aggregator",
  "webhook", "webhooks", "ns", "ns1", "ns2", "autodiscover", "autoconfig", "_domainkey", "jmsurf-admin",
  // app.jmsurfgarage.co.ke first path segments
  "dashboard", "pos", "inventory", "customers", "sales", "purchases", "payments", "email-logs", "reports",
  "ai-analysis", "ai", "staff", "settings", "delivery-confirm", "stock-transfer", "purchase-orders", "suppliers",
  "invoices", "quotes", "expenses", "bills", "services", "mpesa-history", "credit-balances", "unsubscribe",
  "audit-log", "404", "order", "rider", "water", "tickets", "whats-new", "subscription-expired", "billing",
  "reset-password", "staff-login", "customer-login", "signin", "account", "shop", "about", "contact", "cart",
  "checkout", "book", "events", "learn", "careers", "join", "sign", "contract", "oauth", "terms", "privacy",
  "photo-credits", "pricing", "features", "solutions", "crm", "calendar", "marketing", "finance", "approvals",
  "profile", "hrm", "me", "documents", "warehouse", "branches", "accounting", "companies", "notebook",
  "contracts", "garage", "garage-menu", "modules", "import", "migrate", "callcentre", "apps", "sales-reps",
  "e", "t", "fleet", "check", "yard", "preorder", "well-known", ".well-known", "shop-brand", "favicon.ico",
  "robots.txt", "sitemap.xml", "llms.txt", "sw.js", "manifest.webmanifest", "tracking.js", "build.json",
]);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** True for a word that may be a company slug (format + not reserved). */
export const slugLike = (s) => SLUG_RE.test(String(s || "")) && !RESERVED_SLUGS.has(String(s));

/**
 * The one address for a company's customer pages: its active custom domain first, else
 * https://app.jmsurfgarage.co.ke/<slug>. Links sent to customers (SMS, email, WhatsApp, receipts,
 * QR) are this plus the page path, e.g. `${base}/t/<token>`.
 */
export function publicBaseFor(slug, customHost) {
  if (SHOP_ORIGIN) return SHOP_ORIGIN;
  const host = String(customHost || "").trim().toLowerCase();
  if (host) return `https://${host}`;
  return slug ? `${APP_ORIGIN}/${slug}` : APP_ORIGIN;
}

/** Same as publicBaseFor without "https://", for short SMS texts (phones still make it a link). */
export const shortBase = (base) => String(base || "").replace(/^https?:\/\//, "");

const DB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const DB_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";

async function rows(pathAndQuery) {
  if (!DB_URL || !DB_KEY) return [];
  const r = await fetch(`${DB_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Database replied ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

/** Statuses of tenant_domains rows that serve traffic (older rows say "approved"). */
export const LIVE_DOMAIN_STATUSES = "(approved,active)";

const baseCache = new Map();
/** The company's active custom domain host, or "" (cached 5 minutes). */
export async function activeCustomHost(tenantId) {
  const [d] = await rows(`tenant_domains?tenant_id=eq.${encodeURIComponent(tenantId)}&kind=eq.custom&status=in.${LIVE_DOMAIN_STATUSES}&select=host&order=created_at.asc&limit=1`);
  return String(d?.host || "");
}

/** publicBase for a company id (custom domain first, else app.jmsurfgarage.co.ke/<slug>); cached 5 minutes. */
export async function publicBase(tenantId) {
  if (!tenantId) return APP_ORIGIN;
  const hit = baseCache.get(tenantId);
  if (hit && hit.until > Date.now()) return hit.base;
  let base;
  try {
    const [t] = await rows(`tenants?id=eq.${encodeURIComponent(tenantId)}&select=slug`);
    const host = await activeCustomHost(tenantId);
    base = publicBaseFor(t?.slug, host);
  } catch {
    return hit?.base || APP_ORIGIN;
  }
  baseCache.set(tenantId, { base, until: Date.now() + 5 * 60_000 });
  if (baseCache.size > 5000) baseCache.clear();
  return base;
}

/**
 * Short root for SMS links whose path already names the company (/t/<token>, /e/<token>,
 * /book/<slug>): the company's own domain, else app.jmsurfgarage.co.ke, without https:// so the
 * text stays one SMS part. Those pages work at the root of either address.
 */
export async function smsBase(tenantId) {
  const base = await publicBase(tenantId);
  return shortBase(base.startsWith(`${APP_ORIGIN}/`) ? APP_ORIGIN : base);
}

/** Forget a company's cached address (its domain was connected or removed). */
export const forgetPublicBase = (tenantId) => { baseCache.delete(tenantId); };

/**
 * Where a request on an old garage.jmsurf.co.ke address goes, or null to answer it here.
 * /api/… (payment, WhatsApp, eTIMS and other callbacks: POSTs do not follow redirects),
 * build files and the domain check path keep answering on the old addresses.
 */
export function oldHostRedirect(host, pathname, url) {
  const h = String(host || "").toLowerCase();
  if (h !== OLD_ROOT_HOST && !h.endsWith(`.${OLD_ROOT_HOST}`)) return null;
  if (pathname.startsWith("/api/") || pathname.startsWith("/assets/") || pathname.startsWith("/.well-known/")
    || pathname === "/sw.js" || pathname === "/build.json") return null;
  if (h === OLD_ROOT_HOST || h === `www.${OLD_ROOT_HOST}`) return `${SITE_ORIGIN}${url}`;
  if (h === `app.${OLD_ROOT_HOST}`) return `https://${APP_HOST}${url}`;
  if (h === `admin.${OLD_ROOT_HOST}` || h === `dash.${OLD_ROOT_HOST}`) return `${ADMIN_ORIGIN}${pathname === "/" ? "/admin" : url}`;
  const label = h.slice(0, h.length - OLD_ROOT_HOST.length - 1);
  // Sign-in, hand-over and password links from old emails: the one sign-in on app.
  if (label.includes(".") || !SLUG_RE.test(label) || RESERVED_SLUGS.has(label) || /^\/(auth\/|login|staff-login|reset-password|register|signup|dashboard)/.test(pathname)) {
    return `https://${APP_HOST}${url}`;
  }
  // A company's old address: its customer pages (and anything else) now under app.…/<slug>/.
  return `https://${APP_HOST}/${label}${url === "/" ? "" : url}`;
}
