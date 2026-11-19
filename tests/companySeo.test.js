import { test } from "node:test";
import assert from "node:assert/strict";
import { companyRobots, indexableHtml, noindexHtml, companyRobotsTxt, companySitemap, isPublicSitePath } from "../companySeo.js";

const page = '<head><meta name="robots" content="index, follow" />\n<link rel="canonical" href="https://garage.jmsurf.co.ke/" />\n<meta property="og:url" content="https://shop.garage.jmsurf.co.ke/"></head>';

test("public website pages are indexed only when the website is on", () => {
  for (const p of ["/", "/shop", "/shop/p/abc", "/services", "/about/", "/contact", "/book", "/events", "/learn"]) {
    assert.equal(isPublicSitePath(p), true, p);
    assert.equal(companyRobots(p, true), null, p);
    assert.equal(companyRobots(p, false), "noindex, nofollow", p);
  }
  for (const p of ["/login", "/dashboard", "/account", "/account/orders", "/cart", "/checkout", "/order/1", "/portal", "/sales/invoices", "/pos"]) {
    assert.equal(companyRobots(p, true), "noindex, nofollow", p);
  }
});

test("indexable page canonical points at itself; noindex page loses it", () => {
  const out = indexableHtml(page, "https://shop.garage.jmsurf.co.ke", "/shop/");
  assert.match(out, /<link rel="canonical" href="https:\/\/shop\.garage\.jmsurf\.co\.ke\/shop" \/>/);
  assert.match(out, /name="robots" content="index, follow, max-image-preview:large"/);
  assert.match(out, /og:url" content="https:\/\/shop\.garage\.jmsurf\.co\.ke\/shop"/);
  const no = noindexHtml(page, "noindex, nofollow");
  assert.doesNotMatch(no, /canonical/);
  assert.match(no, /content="noindex, nofollow"/);
});

test("company robots.txt and sitemap", () => {
  const on = companyRobotsTxt("https://shop.garage.jmsurf.co.ke", true);
  assert.match(on, /Allow: \//);
  assert.match(on, /Disallow: \/checkout/);
  assert.match(on, /Sitemap: https:\/\/shop\.garage\.jmsurf\.co\.ke\/sitemap\.xml/);
  assert.doesNotMatch(companyRobotsTxt("https://x", false), /Sitemap/);
  const xml = companySitemap("https://shop.garage.jmsurf.co.ke", "2026-11-05");
  assert.match(xml, /<loc>https:\/\/shop\.garage\.jmsurf\.co\.ke\/shop<\/loc>/);
  assert.doesNotMatch(xml, /login|cart|checkout/);
});
