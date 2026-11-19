// Search engines on a company's own address (company.garage.jmsurf.co.ke or its custom domain).
// The company's public website and shop are its storefront and are indexed (when the company
// has switched its website on); the workspace, sign-in, account, cart and checkout never are.

/** Public website/shop pages of a company address. */
const PUBLIC_SITE_PATHS = [
  /^\/$/, /^\/shop$/, /^\/shop\/p\/[^/]+$/, /^\/services$/, /^\/about$/, /^\/contact$/,
  /^\/book$/, /^\/events$/, /^\/learn$/,
];

/** Pages listed in a company's sitemap.xml. */
const SITEMAP_PATHS = ["/", "/shop", "/services", "/about", "/contact"];

export const normalPath = (pathname) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : "/");

export const isPublicSitePath = (pathname) => PUBLIC_SITE_PATHS.some((re) => re.test(normalPath(pathname)));

/** "noindex, nofollow" for anything that is not a public page of a company website that is switched on. */
export const companyRobots = (pathname, siteEnabled) => (siteEnabled && isPublicSitePath(pathname) ? null : "noindex, nofollow");

/** A page kept out of search results: robots meta set to noindex and no canonical link. */
export const noindexHtml = (html, value) => html
  .replace(/<meta\s+name="robots"[^>]*>/i, `<meta name="robots" content="${value}" />`)
  .replace(/<link rel="canonical"[^>]*>\s*/i, "");

/** A company's public page: indexable, canonical pointing at itself (no query string). */
export function indexableHtml(html, origin, pathname) {
  const canonical = `<link rel="canonical" href="${origin}${normalPath(pathname)}" />`;
  let out = html.replace(/<meta\s+name="robots"[^>]*>/i, `<meta name="robots" content="index, follow, max-image-preview:large" />`);
  out = /<link rel="canonical"[^>]*>/i.test(out)
    ? out.replace(/<link rel="canonical"[^>]*>/i, canonical)
    : out.replace(/<\/head>/i, `  ${canonical}\n  </head>`);
  // The link preview address follows the page too.
  return out.replace(/<meta property="og:url" content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${origin}${normalPath(pathname)}">`);
}

export function companyRobotsTxt(origin, siteEnabled) {
  if (!siteEnabled) {
    return "# A JMSURF Garage company workspace: its pages are kept out of search results (noindex).\nUser-agent: *\nDisallow: /api/\n";
  }
  return [
    "# Company website on JMSURF Garage: the public website and shop are open to search engines.",
    "User-agent: *",
    "Allow: /",
    ...["/api/", "/dashboard", "/login", "/staff-login", "/account", "/portal", "/customer-login", "/signin", "/cart", "/checkout", "/order/", "/pay/", "/auth/", "/settings", "/pos"].map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function companySitemap(origin, lastmod) {
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${origin}${p}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
