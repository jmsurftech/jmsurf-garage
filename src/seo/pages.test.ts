import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/modules";
import { buildSeoPages, HOME, HOME_HEADINGS, llmsTxt, sitemapXml, textOf } from "./pages";

const pages = buildSeoPages();
const src = (f: string) => readFileSync(path.join(process.cwd(), "src", "pages", f), "utf8");
/** Page source as visible text: JSX tags removed, entities decoded, spaces collapsed. */
const visible = (s: string) => s.replace(/<\/?[A-Za-z][^<>]*>|<>|<\/>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("website snapshots", () => {
  it("covers the home page, every suite and the public pages", () => {
    const paths = pages.map((p) => p.path);
    for (const p of ["/", "/solutions", "/register", "/login", "/terms", "/privacy"]) expect(paths).toContain(p);
    for (const m of MODULES) expect(paths).toContain(`/solutions/${m.key}`);
  });

  it.each(pages.map((p) => [p.path, p] as const))("%s has one h1, good head tags and valid structured data", (_, p) => {
    expect(p.body.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(p.title.length).toBeGreaterThanOrEqual(50);
    expect(p.title.length).toBeLessThanOrEqual(60);
    expect(p.description.length).toBeGreaterThanOrEqual(140);
    expect(p.description.length).toBeLessThanOrEqual(160);
    expect(() => JSON.parse(JSON.stringify(p.jsonld))).not.toThrow();
    expect(p.jsonld.some((x: any) => x["@type"] === "Organization" && x.name === "JMSURF TECHNOLOGIES LTD")).toBe(true);
    expect(p.body).toContain("More from JMSURF");
    expect(p.body).toContain("Powered by");
  });

  it("home page names the product and has real text", () => {
    const home = pages.find((p) => p.path === "/")!;
    expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(home.body)![1]).toContain("JMSURF Garage");
    expect(home.text.split(/\s+/).length).toBeGreaterThan(600);
    expect(home.body.match(/<h2[\s>]/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it("home snapshot text is still what the live home page shows", () => {
    const raw = src("Landing.tsx");
    const landing = visible(raw);
    for (const h of Object.values(HOME_HEADINGS)) expect(landing, h).toContain(h);
    expect(landing).toContain(HOME.eyebrow);
    expect(landing).toContain(visible(HOME.lead));
    for (const c of [...HOME.oneLogin, ...HOME.africa, ...HOME.workflows, ...HOME.migrateSteps, ...HOME.security]) {
      expect(raw, c.t).toContain(`"${c.t}"`);
      expect(raw, c.d).toContain(`"${c.d}"`);
    }
    for (const x of [...HOME.payments, ...HOME.migrateWhat]) expect(raw, x).toContain(`"${x}"`);
    expect(visible(src("Solutions.tsx"))).toMatch(/Every suite\.\s*One login\./);
    expect(src("Register.tsx")).toContain("Start your free trial");
  });

  it("sitemap lists only indexable pages; llms.txt has the required sections", () => {
    const xml = sitemapXml(pages, "2026-11-05");
    expect(xml).not.toContain("/login");
    expect(xml.match(/<loc>/g)!.length).toBe(pages.filter((p) => !p.noindex).length);
    const llms = llmsTxt();
    for (const h of ["# JMSURF Garage", "\n> ", "## Key pages", "## Pricing", "## Contact", "## Other JMSURF products"]) expect(llms).toContain(h);
    expect(llms).not.toContain("jmsurftech@gmail.com");
  });

  it("text extraction keeps words apart", () => {
    expect(textOf("<h2>One</h2><p>Two &amp; three</p>")).toBe("One\nTwo & three");
  });
});
