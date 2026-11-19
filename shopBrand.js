// ---------------------------------------------------------------------------
// A shop's own identity on its own address (custom domain or
// <slug>.garage.jmsurf.co.ke): the page title, description, tab icon, install
// icon and the link preview WhatsApp/Facebook/X show. Link previews never run
// the app, so all of this is written into the HTML by the server.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every company shows the JMSURF Garage mark as its icon (owner's rule, 2026-10-16); the name stays theirs.
const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const SYSTEM_ICON = { 64: "favicon-64.png", 192: "jm-icon-192.png", 512: "jm-icon-512.png" };
const systemIcons = new Map();
function systemIcon(size) {
  if (!systemIcons.has(size)) {
    try { systemIcons.set(size, readFileSync(join(DIST, SYSTEM_ICON[size]))); } catch { systemIcons.set(size, null); }
  }
  return systemIcons.get(size);
}
// Loaded softly: if the image library is missing, pages still work and only
// the generated pictures are skipped.
const { Resvg } = await import("@resvg/resvg-js").catch((e) => {
  console.error("shopBrand: image library unavailable:", e?.message || e);
  return {};
});

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

// Same palette as src/lib/shopSite.ts ACCENTS.
const ACCENTS = {
  sky: { from: "#0ea5e9", to: "#2563eb", solid: "#0284c7" },
  cyan: { from: "#06b6d4", to: "#0e7490", solid: "#0891b2" },
  teal: { from: "#14b8a6", to: "#0f766e", solid: "#0d9488" },
  indigo: { from: "#6366f1", to: "#1e3a8a", solid: "#4f46e5" },
  emerald: { from: "#10b981", to: "#047857", solid: "#059669" },
};
const SHOP_DEFAULT = { from: "#16a34a", to: "#14532d", solid: "#15803d" };

const RESERVED = new Set([
  "www", "admin", "app", "dash", "api", "pay", "mail", "webmail", "cpanel", "mx", "smtp", "imap", "pop", "ftp", "cdn", "static", "assets", "portal", "my",
  "img", "images", "files", "blog", "docs", "help", "support", "status", "dev", "staging", "preview", "notify",
  "email", "mailer", "auth", "login", "register", "aggregator", "webhook", "webhooks", "ns", "ns1", "ns2", "db",
]);

/** Slug of <slug>.garage.jmsurf.co.ke, else null. */
export function subdomainSlug(rawHost) {
  const host = String(rawHost || "").split(":")[0].trim().toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.jmsurfgarage\.co\.ke$/);
  return m && !RESERVED.has(m[1]) ? m[1] : null;
}

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clip = (v, n) => { const s = String(v || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

async function rest(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(5000),
  });
  return r.ok ? r.json() : [];
}

/** A company's own favicon (uploaded in Business settings), as bytes. */
async function fetchIcon(url) {
  if (!/^https:\/\//i.test(url || "")) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpe?g|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1024 * 1024 ? null : { type, buf };
  } catch { return null; }
}

async function fetchLogo(url) {
  if (!/^https:\/\//i.test(url || "")) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

// --- shop details --------------------------------------------------------------

const brandCache = new Map();

/** The shop's name, colours, words and logo, or null when there is no such shop. */
export async function shopBrand(slug) {
  if (!slug || !SUPABASE_URL || !SERVICE_KEY) return null;
  const hit = brandCache.get(slug);
  if (hit && hit.until > Date.now()) return hit.brand;
  let brand = null;
  try {
    const [t] = await rest(`tenants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&deleted_at=is.null&select=id,slug,business_name,logo_url,favicon_url,business_type&limit=1`);
    if (t) {
      const [site] = await rest(`shop_sites?tenant_id=eq.${t.id}&select=content,updated_at&limit=1`);
      const c = (site && site.content) || {};
      const water = t.business_type === "water";
      const colors = ACCENTS[c.accent] || (water ? ACCENTS.sky : SHOP_DEFAULT);
      const name = clip(t.business_name || slug, 60);
      const tagline = clip(c.tagline || (water ? "Clean drinking water, delivered" : ""), 70);
      const description = clip(
        c.subheadline || (water
          ? `Order clean drinking water from ${name}. We deliver to your door and you pay on delivery with M-Pesa or cash.`
          : `Welcome to ${name}.`),
        200,
      );
      const logo = t.logo_url ? await fetchLogo(t.logo_url) : null;
      const favicon = t.favicon_url ? await fetchIcon(t.favicon_url) : null;
      const version = createHash("sha1").update(JSON.stringify([name, tagline, description, t.logo_url, t.favicon_url, c.accent, water, site?.updated_at])).digest("hex").slice(0, 10);
      brand = { slug: t.slug, name, tagline, description, water, colors, logo, favicon, version };
    }
  } catch {
    return hit ? hit.brand : null;
  }
  brandCache.set(slug, { brand, until: Date.now() + 5 * 60_000 });
  if (brandCache.size > 2000) brandCache.clear();
  return brand;
}

// --- pictures ------------------------------------------------------------------

const initials = (name) => {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase() || "S";
};
const DROP = "M100 14 C100 14 40 88 40 128 a60 60 0 0 0 120 0 C160 88 100 14 100 14 Z";

/** Inner mark (logo, water drop or initials) drawn in a box of `s` px at x,y. */
function mark(b, x, y, s, onWhite) {
  if (b.logo) {
    const pad = s * 0.1;
    return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.22}" fill="#ffffff"/>`
      + `<image x="${x + pad}" y="${y + pad}" width="${s - 2 * pad}" height="${s - 2 * pad}" preserveAspectRatio="xMidYMid meet" href="${b.logo}"/>`;
  }
  if (b.water) {
    const k = (s * 0.72) / 200;
    const fill = onWhite ? b.colors.solid : "#ffffff";
    return `<g transform="translate(${x + (s - 200 * k) / 2},${y + s * 0.1}) scale(${k})"><path d="${DROP}" fill="${fill}"/>`
      + `<path d="M72 128 a28 28 0 0 0 28 28" stroke="${onWhite ? "#ffffff" : b.colors.solid}" stroke-width="9" stroke-linecap="round" fill="none" opacity=".7"/></g>`;
  }
  return `<text x="${x + s / 2}" y="${y + s * 0.66}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="${s * 0.44}" fill="${onWhite ? b.colors.solid : "#ffffff"}">${esc(initials(b.name))}</text>`;
}

const gradient = (b, id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.colors.from}"/><stop offset="1" stop-color="${b.colors.to}"/></linearGradient>`;

function iconSvg(b, size) {
  const body = b.logo
    ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#ffffff"/>${mark(b, 0, 0, size, true).replace(/^<rect[^>]*\/>/, "")}`
    : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#g)"/>${mark(b, 0, 0, size, false)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${gradient(b, "g")}</defs>${body}</svg>`;
}

/** Split text into at most `lines` lines of about `width` characters. */
function wrap(text, width, lines) {
  const out = [];
  let cur = "";
  for (const w of String(text).split(/\s+/)) {
    if ((cur + " " + w).trim().length > width && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && out.join(" ").length < text.length) out[lines - 1] = clip(out[lines - 1], width - 1) + (out[lines - 1].endsWith("…") ? "" : "…");
  return out;
}

function ogSvg(b, host) {
  const W = 1200, H = 630;
  const nameSize = b.name.length > 22 ? 58 : 76;
  const nameLines = wrap(b.name, b.name.length > 22 ? 21 : 16, 2);
  const descLines = wrap(b.description, 40, 3);
  let y = 250;
  const name = nameLines.map((l, i) => `<text x="380" y="${y + i * (nameSize + 8)}" font-family="DejaVu Sans" font-weight="bold" font-size="${nameSize}" fill="#ffffff">${esc(l)}</text>`).join("");
  y += (nameLines.length - 1) * (nameSize + 8);
  const tag = b.tagline ? `<text x="382" y="${y + 58}" font-family="DejaVu Sans" font-weight="bold" font-size="28" fill="#ffffff" opacity=".85">${esc(b.tagline.toUpperCase())}</text>` : "";
  const dy = y + (b.tagline ? 118 : 70);
  const desc = descLines.map((l, i) => `<text x="382" y="${dy + i * 42}" font-family="DejaVu Sans" font-size="31" fill="#ffffff" opacity=".92">${esc(l)}</text>`).join("");
  // Soft "orbs" of dots, like the website hero.
  const dots = [];
  for (let i = 0; i < 70; i++) {
    const a = i * 2.39996, r = 8 + Math.sqrt(i) * 16;
    dots.push(`<circle cx="${1060 + Math.cos(a) * r}" cy="${110 + Math.sin(a) * r}" r="${2.4 + (i % 3)}" fill="#ffffff" opacity="${0.12 + (i % 5) * 0.05}"/>`);
    dots.push(`<circle cx="${130 + Math.cos(a) * r * 0.9}" cy="${560 + Math.sin(a) * r * 0.9}" r="${2 + (i % 3)}" fill="#ffffff" opacity="${0.1 + (i % 4) * 0.05}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${gradient(b, "g")}</defs>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/>${dots.join("")}`
    + `<circle cx="1180" cy="640" r="260" fill="#ffffff" opacity=".07"/><circle cx="-40" cy="-60" r="220" fill="#ffffff" opacity=".07"/>`
    + `<g><rect x="80" y="${H / 2 - 120}" width="240" height="240" rx="54" fill="#ffffff" opacity=".18"/>${mark({ ...b, logo: b.logo }, 100, H / 2 - 100, 200, false)}</g>`
    + name + tag + desc
    + `<text x="382" y="${H - 52}" font-family="DejaVu Sans" font-weight="bold" font-size="26" fill="#ffffff" opacity=".8">${esc(host)}</text>`
    + `</svg>`;
}

const pngCache = new Map();
function png(key, svg, width) {
  const hit = pngCache.get(key);
  if (hit) return hit;
  if (!Resvg) throw new Error("image library unavailable");
  const out = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
  pngCache.set(key, out);
  if (pngCache.size > 600) pngCache.delete(pngCache.keys().next().value);
  return out;
}

// --- HTML ----------------------------------------------------------------------

/** Replace the platform's head tags with the shop's own. */
export function brandHtml(html, b, host, { stampSlug }) {
  const origin = `https://${host}`;
  const v = b.version;
  const title = b.tagline ? `${b.name} · ${b.tagline}` : b.name;
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+(name|property)="(description|author|theme-color|apple-mobile-web-app-title|og:[^"]+|twitter:[^"]+)"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="(apple-touch-icon|icon|shortcut icon|manifest)"[^>]*>\s*/gi, "")
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/i, "");
  const data = JSON.stringify({ slug: b.slug, name: b.name, title, color: b.colors.solid, v });
  const head = [
    stampSlug ? `<meta name="jmsurf-shop" content="${esc(b.slug)}">` : "",
    `<meta name="jmsurf-brand" content="${esc(data)}">`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(b.description)}">`,
    `<meta name="theme-color" content="${b.colors.solid}">`,
    `<meta name="apple-mobile-web-app-title" content="${esc(clip(b.name, 30))}">`,
    `<link rel="icon" type="image/png" sizes="64x64" href="/shop-brand/icon-64.png?v=${v}-s3">`,
    `<link rel="apple-touch-icon" href="/shop-brand/icon-192.png?v=${v}-s3">`,
    `<link rel="manifest" href="/shop-brand/manifest.webmanifest?v=${v}">`,
    `<meta property="og:site_name" content="${esc(b.name)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${origin}/">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(b.description)}">`,
    `<meta property="og:image" content="${origin}/shop-brand/og.png?v=${v}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:alt" content="${esc(b.name)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(b.description)}">`,
    `<meta name="twitter:image" content="${origin}/shop-brand/og.png?v=${v}">`,
  ].filter(Boolean).join("\n    ");
  out = out.replace(/<head>/i, `<head>\n    ${head}`);
  // Loading screen (index.html #boot): the shop's own logo and colour, never the DASH mark.
  out = out
    .replace(/<div id="boot"([^>]*?) style="--boot-c:[^"]*"/, `<div id="boot"$1 style="--boot-c:${b.colors.solid}"`)
    .replace(/<img id="boot-logo"[^>]*>/, `<img id="boot-logo" src="/shop-brand/icon-192.png?v=${v}-s3" alt="${esc(b.name)}" width="48" height="48" />`);
  return out;
}

/**
 * Serves /shop-brand/* and /favicon.ico for a shop's address.
 * Returns true when it answered.
 */
export function serveBrandAsset(pathname, b, host, res) {
  const send = (type, body) => {
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(body);
    return true;
  };
  // The company's own favicon when it uploaded one; otherwise the JMSURF Garage mark.
  if (b.favicon && (pathname === "/favicon.ico" || /^\/shop-brand\/icon-(64|192|512)\.png$/.test(pathname))) return send(b.favicon.type, b.favicon.buf);
  if (pathname === "/favicon.ico") { const sys = systemIcon(64); if (sys) return send("image/png", sys); }
  const icon = pathname.match(/^\/shop-brand\/icon-(64|192|512)\.png$/);
  if (icon) {
    const sys = systemIcon(Number(icon[1]));
    if (sys) return send("image/png", sys);
  }
  if (pathname === "/shop-brand/og.png") return send("image/png", png(`${b.slug}:${b.version}:og:${host}`, ogSvg(b, host), 1200));
  if (pathname === "/shop-brand/manifest.webmanifest") {
    return send("application/manifest+json; charset=utf-8", JSON.stringify({
      name: b.name, short_name: clip(b.name, 24), description: b.description,
      theme_color: b.colors.solid, background_color: "#ffffff", display: "standalone", scope: "/", start_url: "/",
      icons: [
        { src: `/shop-brand/icon-192.png?v=${b.version}-s3`, sizes: "192x192", type: "image/png" },
        { src: `/shop-brand/icon-512.png?v=${b.version}-s3`, sizes: "512x512", type: "image/png" },
        { src: `/shop-brand/icon-512.png?v=${b.version}-s3`, sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    }));
  }
  return false;
}
