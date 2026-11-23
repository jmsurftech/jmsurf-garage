import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_MODULES } from "@/lib/modules";
import { DEFAULT_CATALOGUE, bundleListPrice, modulesForKinds, priceBox } from "@/lib/garagePlans";
import { buildSeoPages, COMPANY_SOCIALS, HOME, HOME_HEADINGS, llmsTxt, sitemapXml, textOf } from "./pages";
import { CONTENT_PAGES, FAQ_ALL } from "./content";

const pages = buildSeoPages();
const src = (f: string) => readFileSync(path.join(process.cwd(), "src", "pages", f), "utf8");

describe("website snapshots", () => {
  it("covers the home page, pricing, every module and the public pages", () => {
    const paths = pages.map((p) => p.path);
    for (const p of ["/", "/pricing", "/solutions", "/register", "/login", "/terms", "/privacy"]) expect(paths).toContain(p);
    for (const m of PUBLIC_MODULES) expect(paths).toContain(`/solutions/${m.key}`);
  });

  it.each(pages.map((p) => [p.path, p] as const))("%s has one h1, good head tags and valid structured data", (_, p) => {
    expect(p.body.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(p.title.length).toBeGreaterThanOrEqual(50);
    expect(p.title.length).toBeLessThanOrEqual(60);
    expect(p.description.length).toBeGreaterThanOrEqual(140);
    expect(p.description.length).toBeLessThanOrEqual(160);
    expect(() => JSON.parse(JSON.stringify(p.jsonld))).not.toThrow();
    expect(p.jsonld.some((x: any) => x["@type"] === "Organization" && x.name === "JMSURF Technologies" && x.sameAs === COMPANY_SOCIALS && x.contactPoint)).toBe(true);
    expect(p.body).toContain("More from JMSURF");
    expect(p.body).toContain("Powered by");
    expect(p.body).toContain("ODPC");
  });

  it("home page names the product and has real text", () => {
    const home = pages.find((p) => p.path === "/")!;
    expect(home.text).toContain("JMSURF Garage");
    expect(home.text.split(/\s+/).length).toBeGreaterThan(600);
    expect(home.body.match(/<h2[\s>]/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it("the live pages render the same words as the snapshots", () => {
    const landing = src("Landing.tsx");
    expect(landing).toContain('from "@/seo/homeContent"');
    for (const k of Object.keys(HOME_HEADINGS)) expect(landing, k).toContain(`HOME_HEADINGS.${k}`);
    for (const k of ["who", "flow", "kenya", "security", "faq"]) expect(landing, k).toContain(`HOME.${k}`);
    expect(src("Pricing.tsx")).toContain("HOME.pricingFaq");
    expect(src("Register.tsx")).toContain("Start your free trial");
    expect(HOME.headline.length).toBeGreaterThan(10);
  });

  it("sitemap lists only indexable pages; llms.txt has the required sections", () => {
    const xml = sitemapXml(pages, "2026-11-20");
    expect(xml).not.toContain("/login");
    expect(xml.match(/<loc>/g)!.length).toBe(pages.filter((p) => !p.noindex).length);
    const llms = llmsTxt();
    for (const h of ["# JMSURF Garage", "\n> ", "## Key pages", "## Pricing", "## Contact", "## Other JMSURF products"]) expect(llms).toContain(h);
    expect(llms).not.toMatch(/@gmail\.com/);
  });

  it.each(CONTENT_PAGES.map((c) => [c.path, c] as const))("guide page %s: real length, breadcrumbs, links and a call to action", (_, c) => {
    const pg = pages.find((x) => x.path === c.path)!;
    expect(pg).toBeTruthy();
    const words = pg.text.split(/\s+/).length;
    expect(words, `${c.path} words`).toBeGreaterThanOrEqual(c.group === "faq" ? 600 : 500);
    expect(words, `${c.path} words`).toBeLessThanOrEqual(1700);
    expect(pg.jsonld.some((x: any) => x["@type"] === "BreadcrumbList")).toBe(true);
    const internal = new Set([...pg.body.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]).filter((h) => h !== "/" && h !== "/register" && h !== c.path));
    expect(internal.size).toBeGreaterThanOrEqual(8);
    expect(pg.body).toContain('href="/register"');
    expect(pg.body).toContain("https://wa.me/254712504593");
    expect(pg.body).not.toMatch(/John Doe|example\.com|0712345678/);
  });

  it("guide pages: unique titles and descriptions; the questions page has 15-30 questions", () => {
    const titles = pages.map((p) => p.title), descs = pages.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descs).size).toBe(descs.length);
    expect(FAQ_ALL.length).toBeGreaterThanOrEqual(15);
    expect(FAQ_ALL.length).toBeLessThanOrEqual(30);
    expect(pages.find((p) => p.path === "/faq")!.jsonld.some((x: any) => x["@type"] === "FAQPage" && x.mainEntity.length === FAQ_ALL.length)).toBe(true);
    expect(src("ContentPage.tsx")).toContain('from "@/seo/content"');
  });

  it("text extraction keeps words apart", () => {
    expect(textOf("<h2>One</h2><p>Two &amp; three</p>")).toBe("One\nTwo & three");
  });
});

describe("garage plans and the price box", () => {
  it("the All modules bundle is Pro plus every module (normally KES 29,800)", () => {
    expect(bundleListPrice(DEFAULT_CATALOGUE)).toBe(29800);
  });

  it("business kinds tick their modules", () => {
    expect(modulesForKinds(["spares", "body_paint"])).toEqual(expect.arrayContaining(["inventory", "commerce", "body_paint", "insurance"]));
    expect(modulesForKinds([])).toEqual([]);
  });

  it("modules in the plan cost nothing extra; others add their price", () => {
    const box = priceBox(DEFAULT_CATALOGUE, "business", ["workshop_pro", "car_wash"]);
    expect(box.total).toBe(5000 + 1000);
    expect(box.lines.find((l) => l.key === "workshop_pro")?.amount).toBe(0);
    const year = priceBox(DEFAULT_CATALOGUE, "fundi", ["tyres"], { cycle: "year" });
    expect(year.total).toBe(5000 + 8000);
  });

  it("suggests the bundle when it is cheaper", () => {
    const all = priceBox(DEFAULT_CATALOGUE, "pro", ["commerce", "website", "imports", "vehicle_yard", "body_paint", "car_wash", "tyres", "fleet_contracts", "towing", "car_hire", "whatsapp"]);
    expect(all.total).toBe(29800);
    expect(all.bundleSaves).toBe(4800);
  });
});
