// Writes the public website snapshots after `vite build` (see src/seo/pages.ts):
//   seo-pages/<name>.html + seo-pages/routes.json   served by server.js on garage.jmsurf.co.ke
//   dist/sitemap.xml, dist/llms.txt, dist/llms-full.txt
// Each snapshot is dist/index.html with the page's own head tags and structured data,
// and the page's text inside <div id="root"> (the app replaces it when it starts).
// Fails the build if the page template no longer has a tag it must replace.
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const outDir = path.join(root, "seo-pages");
const bundle = path.join(root, "node_modules", ".cache", "seo", "pages.mjs");

// "@/x" → src/x, like the app's own alias.
const atAlias = {
  name: "at-alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => b.resolve(`./${args.path.slice(2)}`, { resolveDir: path.join(root, "src"), kind: args.kind }));
  },
};

await build({
  entryPoints: [path.join(root, "src", "seo", "pages.ts")],
  bundle: true, platform: "node", format: "esm", target: "node20",
  packages: "external", outfile: bundle, logLevel: "warning", plugins: [atAlias],
});
const seo = await import(pathToFileURL(bundle).href);
const { buildSeoPages, sitemapXml, llmsTxt, llmsFullTxt, esc } = seo;
const { canonicalUrl, OG_IMAGE } = seo;

const template = await fs.readFile(path.join(distDir, "index.html"), "utf8");

function replaceOnce(html, re, value, what) {
  const hits = html.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`));
  if (!hits || hits.length !== 1) throw new Error(`prerender: expected one ${what} in dist/index.html, found ${hits ? hits.length : 0}`);
  return html.replace(re, value);
}

function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+content="[^"]*"\\s*/?>`, "i");
  const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`;
  return re.test(html) ? html.replace(re, tag) : html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
}

function render(pg) {
  const url = canonicalUrl(pg.path);
  const ogTitle = pg.ogTitle || pg.title, ogDesc = pg.ogDescription || pg.description;
  let html = template;
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/i, `<title>${esc(pg.title)}</title>`, "<title>");
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${url}" />`, "canonical link");
  html = setMeta(html, "name", "description", pg.description);
  html = setMeta(html, "name", "robots", pg.noindex ? "noindex, follow" : "index, follow, max-image-preview:large");
  html = setMeta(html, "property", "og:type", "website");
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "property", "og:title", ogTitle);
  html = setMeta(html, "property", "og:description", ogDesc);
  html = setMeta(html, "property", "og:image", OG_IMAGE);
  html = setMeta(html, "name", "twitter:card", "summary_large_image");
  html = setMeta(html, "name", "twitter:title", ogTitle);
  html = setMeta(html, "name", "twitter:description", ogDesc);
  html = setMeta(html, "name", "twitter:image", OG_IMAGE);
  const graph = JSON.stringify({ "@context": "https://schema.org", "@graph": pg.jsonld }).replace(/</g, "\\u003c");
  html = replaceOnce(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/i, `<script type="application/ld+json">${graph}</script>`, "JSON-LD block");
  // The page text is for crawlers without JavaScript. Visitors never see it flash before the app
  // paints: boot-guard.js adds class "js" to <html>; it shows only if the app files fail to load twice.
  html = replaceOnce(html, /<\/head>/i, `    <style>.js .seo-pre{display:none}</style>\n  </head>`, "</head>");
  html = replaceOnce(html, /<div id="root"><\/div>/, `<div id="root"><div class="seo-pre">${pg.body}</div></div>`, "empty #root");
  return html;
}

const pages = buildSeoPages();
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
const routes = {};
for (const pg of pages) {
  const name = pg.path === "/" ? "home" : pg.path.slice(1).replace(/[^a-z0-9_-]+/gi, "-");
  await fs.writeFile(path.join(outDir, `${name}.html`), render(pg));
  for (const p of [pg.path, ...(pg.aliases || [])]) routes[p] = { file: `${name}.html`, noindex: !!pg.noindex };
}
await fs.writeFile(path.join(outDir, "routes.json"), JSON.stringify(routes, null, 1));

const today = new Date().toISOString().slice(0, 10);
await fs.writeFile(path.join(distDir, "sitemap.xml"), sitemapXml(pages, today));
await fs.writeFile(path.join(distDir, "llms.txt"), llmsTxt());
await fs.writeFile(path.join(distDir, "llms-full.txt"), llmsFullTxt(pages));
console.log(`prerender: ${pages.length} pages, ${Object.keys(routes).length} routes, sitemap ${pages.filter((p) => p.inSitemap).length} URLs`);
