/**
 * Build-time snapshots of the public website (garage.jmsurf.co.ke).
 *
 * Search engines, AI assistants and link previews do not run JavaScript, so
 * scripts/prerender.mjs writes one HTML file per public page: the page's own head
 * tags and structured data, plus a plain, semantic copy of the same text the page
 * shows, inside <div id="root">. The app replaces it as soon as it starts, so every
 * visitor (person or crawler) gets the same page. The home and pricing words come
 * from src/seo/homeContent.ts, which the live pages render too; module pages come
 * from src/lib/modules.ts (src/seo/pages.test.ts checks they stay in step).
 *
 * Also builds sitemap.xml, llms.txt and llms-full.txt from the same data.
 */
import { MODULE_BY_KEY, MODULE_CATEGORIES, PUBLIC_MODULES, type ModuleDef } from "@/lib/modules";
import { BUNDLE_MODULES, DEFAULT_CATALOGUE, EXTRA_BRANCH_PRICE, bundleListPrice } from "@/lib/garagePlans";
import { JMSURF_FAMILY, PUBLIC_PLANS, SITE_ORIGIN, SUITE_AUDIENCE, suiteFaqs, suiteShort } from "@/lib/siteFacts";
import { UPDATED, privacySections, termsSections, type Section } from "@/pages/legalText";
import { HOME, HOME_HEADINGS } from "./homeContent";
import {
  HOME_META, LOGIN_META, OG_IMAGE, PRICING_META, PRIVACY_META, REGISTER_META, SOLUTIONS_META, TERMS_META,
  canonicalUrl, suiteMeta, type PageMeta,
} from "./meta";

export { HOME, HOME_HEADINGS };

export interface SeoPage extends PageMeta {
  /** Extra paths that show the same page (canonical stays `path`). */
  aliases?: string[];
  /** Social preview title/description (defaults to title/description). */
  ogTitle?: string;
  ogDescription?: string;
  /** JSON-LD objects for this page (inside one @graph). */
  jsonld: object[];
  /** Semantic HTML of the page's content (goes inside #root). */
  body: string;
  /** Plain text of the page, for llms-full.txt. */
  text: string;
  /** Listed in sitemap.xml. */
  inSitemap: boolean;
}

const MODS = PUBLIC_MODULES;
const PAID = MODS.filter((m) => !m.included);
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const SALE_PLANS = PUBLIC_PLANS;

export const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ------------------------------------------------------------------ structured data */

const ORG_ID = "https://jmsurf.co.ke/#organization";
const SITE_ID = `${SITE_ORIGIN}/#website`;
const APP_ID = `${SITE_ORIGIN}/#software`;

const organization = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "JMSURF TECHNOLOGIES LTD",
  alternateName: "JMSURF Technologies",
  url: "https://jmsurf.co.ke",
  logo: `${SITE_ORIGIN}/jm-icon-512.png`,
  address: { "@type": "PostalAddress", streetAddress: "Devan Plaza, 5th Floor, Westlands", addressLocality: "Nairobi", addressCountry: "KE" },
  sameAs: JMSURF_FAMILY.filter((f) => f.url !== "https://jmsurf.co.ke").map((f) => f.url).concat(SITE_ORIGIN),
};

const website = {
  "@type": "WebSite",
  "@id": SITE_ID,
  name: "JMSURF Garage",
  url: `${SITE_ORIGIN}/`,
  inLanguage: "en",
  publisher: { "@id": ORG_ID },
};

const software = {
  "@type": "SoftwareApplication",
  "@id": APP_ID,
  name: "JMSURF Garage",
  url: `${SITE_ORIGIN}/`,
  image: OG_IMAGE,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Garage management software",
  operatingSystem: "Web",
  description: "Garage management software for Kenya: job cards, customers and vehicles, estimates approved online, parts stock, M-Pesa payments, KRA eTIMS invoices and SMS updates, with modules for spares shops, imports, car yards, body shops, car washes, tyres, fleets, towing and car hire.",
  areaServed: ["KE"],
  publisher: { "@id": ORG_ID },
  offers: SALE_PLANS.filter((p) => !p.quoteOnly).map((p) => ({
    "@type": "Offer",
    name: `${p.name} (monthly, per garage)`,
    price: String(p.price),
    priceCurrency: "KES",
    description: `${p.blurb} Up to ${p.users} users. Prices exclude VAT. 14 days free.`,
    url: `${SITE_ORIGIN}/register`,
  })),
};

function breadcrumbs(items: [string, string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: canonicalUrl(path) })),
  };
}

function webPage(meta: PageMeta, extra: object = {}) {
  return {
    "@type": "WebPage",
    "@id": `${canonicalUrl(meta.path)}#webpage`,
    url: canonicalUrl(meta.path),
    name: meta.title,
    description: meta.description,
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en",
    ...extra,
  };
}

const faqPage = (qs: [string, string][]) => ({
  "@type": "FAQPage",
  mainEntity: qs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});

/* ------------------------------------------------------------------ shared chrome */

const linkCls = "font-semibold text-primary hover:underline";

function header(): string {
  return `<header class="border-b border-border bg-background"><div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 sm:px-6">`
    + `<a href="/" class="font-display text-lg font-extrabold tracking-tight text-foreground">JMSURF Garage</a>`
    + `<nav aria-label="Main" class="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-muted-foreground">`
    + `<a href="/#who">Who it is for</a><a href="/#how">How it works</a><a href="/solutions">Modules</a><a href="/pricing">Pricing</a>`
    + `<a href="/login">Sign in</a><a href="/register" class="text-primary">Start free</a></nav></div></header>`;
}

function footer(): string {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Modules", "/solutions"], ["Pricing", "/pricing"], ["How it works", "/#how"], ["Start free", "/register"], ["Sign in", "/login"]]],
    ["Modules", [["Garage Core", "/solutions/garage_core"], ["Workshop Pro", "/solutions/workshop_pro"], ["Parts & Stock", "/solutions/inventory"], ["Body & Paint", "/solutions/body_paint"], ["Car Wash", "/solutions/car_wash"], ["All modules", "/solutions"]]],
    ["Legal", [["Terms of service", "/terms"], ["Privacy policy", "/privacy"], ["System status", "/status"], ["Photo credits", "/photo-credits"]]],
  ];
  return `<footer class="border-t border-border bg-card px-4 py-12 text-sm text-muted-foreground sm:px-6"><div class="mx-auto max-w-7xl">`
    + `<p class="font-display font-bold text-foreground">JMSURF Garage</p><p class="mt-2 max-w-xs">Garage management software for Kenya, from the roadside fundi to the dealer.</p>`
    + `<div class="mt-8 grid gap-8 sm:grid-cols-3">`
    + cols.map(([t, links]) => `<div><p class="font-display font-bold text-foreground">${esc(t)}</p><ul class="mt-3 space-y-2">${links.map(([l, h]) => `<li><a href="${h}">${esc(l)}</a></li>`).join("")}</ul></div>`).join("")
    + `</div>${familyHtml()}`
    + `<p class="mt-8">JMSURF TECHNOLOGIES LTD is registered with the ODPC (Kenya) as a Data Controller and Data Processor, reg. no. 194-9812-26EB.</p>`
    + `<p class="mt-2">© ${new Date().getFullYear()} JMSURF Garage. All rights reserved. Powered by <a href="https://jmsurf.co.ke" class="font-bold text-foreground">JMSURF TECHNOLOGIES</a>.</p>`
    + `</div></footer>`;
}

/** The "More from JMSURF" list (same as the live footer). */
export function familyHtml(): string {
  return `<nav aria-label="More from JMSURF" class="mt-8 border-t border-border pt-6"><p class="font-display font-bold text-foreground">More from JMSURF</p>`
    + `<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-2">${JMSURF_FAMILY.map((f) => `<li><a href="${f.url}">${esc(f.name)}</a></li>`).join("")}</ul></nav>`;
}

const wrap = (main: string) =>
  `<div class="min-h-screen bg-background font-body text-foreground">${header()}<main class="mx-auto max-w-5xl px-4 py-12 leading-relaxed sm:px-6">${main}</main>${footer()}</div>`;

const h2 = (t: string) => `<h2 class="mt-12 font-display text-2xl font-extrabold tracking-tight">${esc(t)}</h2>`;
const h3 = (t: string) => `<h3 class="mt-6 font-display text-lg font-bold">${esc(t)}</h3>`;
const p = (t: string) => `<p class="mt-3 text-muted-foreground">${esc(t)}</p>`;
const ul = (items: string[]) => `<ul class="mt-3 list-disc space-y-1 pl-5">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
const cards = (items: { t: string; d: string }[]) => items.map((c) => `${h3(c.t)}${p(c.d)}`).join("");
const cta = (label = "Start free for 14 days", href = "/register") => `<p class="mt-6"><a href="${href}" class="${linkCls}">${esc(label)}</a></p>`;
const faqHtml = (qs: [string, string][]) => qs.map(([q, a]) => `<details class="mt-3" open><summary class="font-display font-bold">${esc(q)}</summary>${p(a)}</details>`).join("");

/* ------------------------------------------------------------------ plans */

const planIncludes = (code: string) => {
  const pl = SALE_PLANS.find((x) => x.code === code)!;
  const mods = pl.includes.map((k) => MODULE_BY_KEY[k]?.name).filter(Boolean) as string[];
  return ["Garage Core: job cards, estimates, M-Pesa, eTIMS invoices, SMS", ...mods];
};

function planHtml(): string {
  return `<div class="mt-6 grid gap-6 sm:grid-cols-2">` + SALE_PLANS.map((pl) => `<div>${h3(pl.name)}${p(pl.blurb)}`
    + `<p class="mt-2 font-display text-xl font-extrabold">${pl.quoteOnly ? "Priced for you" : `${kes(pl.price)} / month`}`
    + (pl.quoteOnly ? "" : ` <span class="text-sm font-normal text-muted-foreground">or ${kes(pl.priceYear)} / year</span>`) + `</p>`
    + `<p class="text-xs text-muted-foreground">${pl.users >= 999999 ? "Any number of users" : `Up to ${pl.users} users`} · ${pl.branches >= 999 ? "many branches" : `${pl.branches} branch${pl.branches === 1 ? "" : "es"}`}</p>`
    + ul(pl.bundle ? ["Pro plus every garage module", `Normally ${kes(bundleListPrice(DEFAULT_CATALOGUE))} a month`] : planIncludes(pl.code))
    + `</div>`).join("") + `</div>`;
}

function modulePriceHtml(): string {
  return MODULE_CATEGORIES.map((c) => {
    const list = PAID.filter((m) => m.category === c);
    if (!list.length) return "";
    return h3(c) + `<ul class="mt-3 space-y-1">${list.map((m) => {
      const inc = (m.includedIn || []).map((k) => SALE_PLANS.find((x) => x.code === k)?.name).filter(Boolean);
      return `<li><a href="/solutions/${m.key}" class="${linkCls}">${esc(m.name)}</a>: ${kes(m.price)} / month${inc.length ? ` (included in ${esc(inc.join(" and "))})` : ""}. ${esc(m.tagline)}</li>`;
    }).join("")}</ul>`;
  }).join("");
}

/* ------------------------------------------------------------------ home (mirrors Landing.tsx) */

function homeBody(): string {
  return wrap(
    `<section><h1 class="font-display text-4xl font-extrabold tracking-tight sm:text-6xl"><span class="lx-eyebrow">${esc(HOME.eyebrow)}</span> <span class="mt-4 block">${esc(HOME.headline)}</span></h1>`
    + p(HOME.lead)
    + `<p class="mt-6 flex flex-wrap gap-4"><a href="/register" class="${linkCls}">Start free for 14 days</a><a href="/pricing" class="${linkCls}">See prices</a></p>`
    + `<ul class="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">${HOME.stats.map((s) => `<li>${esc(s.v)} ${esc(s.l)}</li>`).join("")}</ul></section>`
    + `<section id="who">${h2(HOME_HEADINGS.who)}${p("One system that grows with you: start small, add modules as you grow.")}${cards(HOME.who)}</section>`
    + `<section id="how">${h2(HOME_HEADINGS.flow)}${p("Garage Core follows every car through your gate, the same way every time.")}`
    + `<ol class="mt-2">${HOME.flow.map((s, i) => `<li><p class="mt-6 text-xs font-bold uppercase tracking-widest text-primary">Step ${i + 1}</p>${h3(s.t)}${p(s.d)}</li>`).join("")}</ol></section>`
    + `<section>${h2(HOME_HEADINGS.kenya)}${cards(HOME.kenya)}</section>`
    + `<section id="modules">${h2(HOME_HEADINGS.modules)}${p("Garage Core is in every plan. Add a module for each thing your business does, each free for 14 days.")}`
    + `<ul class="mt-4 space-y-2">${MODS.map((m) => `<li><a href="/solutions/${m.key}" class="${linkCls}">${esc(m.name)}</a>: ${esc(m.tagline)}</li>`).join("")}</ul>`
    + `<p class="mt-4"><a href="/solutions" class="${linkCls}">See every module</a></p></section>`
    + `<section id="pricing">${h2(HOME_HEADINGS.pricing)}${p("Choose a plan by the size of your garage, then add modules. Every plan starts with 14 days free; pay yearly and get 2 months free.")}`
    + planHtml() + `<p class="mt-4"><a href="/pricing" class="${linkCls}">Module prices and the price calculator</a></p></section>`
    + `<section>${h2(HOME_HEADINGS.security)}${cards(HOME.security)}</section>`
    + `<section id="faq">${h2(HOME_HEADINGS.faq)}${faqHtml(HOME.faq)}</section>`
    + `<section>${h2(HOME_HEADINGS.final)}${p("Set up in a few minutes. Free for 14 days, no card needed.")}`
    + `<p class="mt-4 flex flex-wrap gap-4"><a href="/register" class="${linkCls}">Start free for 14 days</a><a href="/login" class="${linkCls}">Sign in</a></p></section>`,
  );
}

/* ------------------------------------------------------------------ pricing (mirrors Pricing.tsx) */

function pricingBody(): string {
  return wrap(
    `<p class="text-xs font-bold uppercase tracking-widest text-primary">Pricing</p>`
    + `<h1 class="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">Pay for your size. Add what you do.</h1>`
    + p("Every plan includes Garage Core. Prices are per garage per month in Kenya shillings, VAT excluded. Pay yearly and get 2 months free. Everything is free for 14 days.")
    + `<section>${h2("Plans")}${planHtml()}</section>`
    + `<section>${h2("Modules")}${p("Turn modules on or off any time in System → Modules & billing. A module you turn on is billed from that day; one you turn off runs to the end of the period you paid for.")}${modulePriceHtml()}</section>`
    + `<section>${h2("Extras")}${ul([`Extra branch: ${kes(EXTRA_BRANCH_PRICE)} a month each`, "SMS: bought in bundles from inside your workspace", `All modules bundle: ${BUNDLE_MODULES.length} modules with Pro for ${kes(SALE_PLANS.find((x) => x.bundle)?.price || 0)} a month`])}</section>`
    + `<section>${h2("Billing questions")}${faqHtml(HOME.pricingFaq)}</section>`
    + cta(),
  );
}

/* ------------------------------------------------------------------ modules (mirrors Solutions.tsx / Solution.tsx) */

function solutionsBody(): string {
  return wrap(
    `<p class="text-xs font-bold uppercase tracking-widest text-primary">${MODS.length} modules · one login</p>`
    + `<h1 class="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">Every module your garage needs.</h1>`
    + p("Garage Core is in every plan. Switch on any other module from inside your workspace, each free for 14 days, and it shares your customers, vehicles, parts and invoices from the first minute.")
    + MODS.map((m) => `<section><h2 class="mt-10 font-display text-2xl font-extrabold tracking-tight"><a href="/solutions/${m.key}">${esc(suiteShort(m.name))}</a></h2>`
      + `<p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">${m.included ? "In every plan" : esc(m.category)}</p>`
      + p(m.tagline) + ul(m.features.slice(0, 3)) + `</section>`).join("")
    + cta(),
  );
}

function related(m: ModuleDef): ModuleDef[] {
  const same = MODS.filter((x) => x.key !== m.key && x.category === m.category);
  const base = MODS.filter((x) => ["garage_core", "workshop_pro", "inventory", "accounting"].includes(x.key) && x.key !== m.key && !same.includes(x));
  return [...same, ...base].slice(0, 4);
}

function suiteBody(m: ModuleDef): string {
  const short = suiteShort(m.name);
  const idx = MODS.findIndex((x) => x.key === m.key);
  const prev = MODS[(idx - 1 + MODS.length) % MODS.length], next = MODS[(idx + 1) % MODS.length];
  return wrap(
    `<nav aria-label="Breadcrumb" class="text-xs font-bold uppercase tracking-widest text-muted-foreground"><a href="/">Home</a> / <a href="/solutions">All modules</a> / ${esc(m.name)}</nav>`
    + `<p class="mt-6 text-xs font-bold uppercase tracking-widest text-primary">${esc(m.category)}</p>`
    + `<h1 class="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">${esc(m.name)}</h1>`
    + `<p class="mt-4 text-lg font-medium">${esc(m.tagline)}</p>` + p(m.description)
    + `<p class="mt-6 flex flex-wrap gap-4"><a href="/register" class="${linkCls}">Start free for 14 days</a><a href="/pricing" class="${linkCls}">See prices</a></p>`
    + `<section>${h2("What is inside.")}${cards(m.apps.map((x) => ({ t: x.name, d: x.desc })))}</section>`
    + `<section>${h2("What you get.")}${ul(m.features)}</section>`
    + `<section>${h2(`${short} works with everything else.`)}${cards([
      { t: "One customer and vehicle list", d: "Every job, sale and payment lands on the same customer and car." },
      { t: "M-Pesa and SMS built in", d: "Collect payments and send updates without extra tools." },
      { t: "KRA eTIMS invoices", d: "Every invoice signed for KRA, with VAT worked out." },
      { t: "Roles and history", d: "Each person sees only what they should; every change is recorded." },
    ])}<ul class="mt-6 space-y-2">${related(m).map((r) => `<li><a href="/solutions/${r.key}" class="${linkCls}">${esc(r.name)}</a>: ${esc(r.tagline)}</li>`).join("")}</ul></section>`
    + `<section>${h2("Made for businesses like yours.")}${ul(SUITE_AUDIENCE[m.category])}</section>`
    + `<section>${h2("Questions")}${faqHtml(suiteFaqs(m))}</section>`
    + `<nav aria-label="More modules" class="mt-12 flex flex-wrap justify-between gap-4"><a href="/solutions/${prev.key}" class="${linkCls}">Previous module: ${esc(prev.name)}</a><a href="/solutions/${next.key}" class="${linkCls}">Next module: ${esc(next.name)}</a></nav>`
    + `<section>${h2(HOME_HEADINGS.final)}${p("Set up in a few minutes. Free for 14 days, no card needed.")}${cta()}</section>`,
  );
}

/* ------------------------------------------------------------------ sign-up, sign-in, legal */

function registerBody(): string {
  return wrap(
    `<h1 class="font-display text-3xl font-bold tracking-tight">Start your free trial</h1>`
    + p("14 days free. No card required.")
    + ul(["Tell us your garage's size and what you do", "See your monthly price before you start", "Every module you choose is free for 14 days"])
    + h2("Your garage")
    + p("Enter your garage name, your name, email and phone, and choose your address. Then pick your size, tick what your business does, check the price and set your password.")
    + `<p class="mt-6">Already have an account? <a href="/login" class="${linkCls}">Sign in</a></p>`,
  );
}

function loginBody(): string {
  return wrap(
    `<h1 class="font-display text-3xl font-bold tracking-tight">Sign in</h1>`
    + p("Staff sign in at app.garage.jmsurf.co.ke with their email and password and land in their garage. One login works for every garage you run.")
    + `<p class="mt-6">New to JMSURF Garage? <a href="/register" class="${linkCls}">Start free</a> · <a href="/reset-password" class="${linkCls}">Forgot password?</a></p>`,
  );
}

const LEGAL_EMAIL = "info@jmsurf.co.ke";

function legalBody(title: string, sections: Section[]): string {
  return wrap(
    `<p class="text-sm font-semibold uppercase tracking-widest text-primary">Legal</p>`
    + `<h1 class="mt-2 font-display text-4xl font-bold tracking-tight">${esc(title)}</h1>`
    + `<p class="mt-2 text-sm text-muted-foreground">Last updated ${esc(UPDATED)}</p>`
    + sections.map((s) => `<section>${h2(s.h)}${s.p.map((para) => Array.isArray(para) ? ul(para) : p(para)).join("")}</section>`).join(""),
  );
}

/* ------------------------------------------------------------------ all pages */

/** Visible text of a snapshot (tags removed), for llms-full.txt and the tests. */
export function textOf(html: string): string {
  return html
    .replace(/<(h[1-6]|p|li|summary|section|nav|div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n\s*/g, "\n").trim();
}

function page(meta: PageMeta, body: string, jsonld: object[], opts: Partial<SeoPage> = {}): SeoPage {
  const main = /<main[^>]*>([\s\S]*)<\/main>/.exec(body)?.[1] ?? body;
  return { ...meta, body, jsonld, text: textOf(main), inSitemap: !meta.noindex, ...opts };
}

export function buildSeoPages(): SeoPage[] {
  const home = page(HOME_META, homeBody(), [organization, website, software, webPage(HOME_META, { about: { "@id": APP_ID } }), faqPage(HOME.faq)], {
    aliases: ["/features"],
    ogTitle: "JMSURF Garage | Run your garage from your phone",
    ogDescription: "Job cards, estimates customers approve online, parts, M-Pesa and KRA eTIMS invoices for every garage in Kenya, from the roadside fundi to the dealer.",
  });
  const pricing = page(PRICING_META, pricingBody(), [organization, website, software, webPage(PRICING_META, { about: { "@id": APP_ID } }),
    breadcrumbs([["Home", "/"], ["Pricing", "/pricing"]]), faqPage(HOME.pricingFaq)]);
  const solutions = page(SOLUTIONS_META, solutionsBody(), [organization, website, software,
    webPage(SOLUTIONS_META, { "@type": "CollectionPage" }), breadcrumbs([["Home", "/"], ["All modules", "/solutions"]])]);
  const suites = MODS.map((m) => {
    const meta = suiteMeta(m.key)!;
    return page(meta, suiteBody(m), [organization, website, software, webPage(meta, { about: { "@id": APP_ID } }),
      breadcrumbs([["Home", "/"], ["All modules", "/solutions"], [m.name, meta.path]]), faqPage(suiteFaqs(m)),
    ], { ogTitle: `${m.name} · JMSURF Garage`, ogDescription: meta.description });
  });
  return [
    home, pricing, solutions, ...suites,
    page(REGISTER_META, registerBody(), [organization, website, software, webPage(REGISTER_META), breadcrumbs([["Home", "/"], ["Start free", "/register"]])],
      { aliases: ["/signup"] }),
    page(LOGIN_META, loginBody(), [organization, website], { aliases: ["/staff-login"] }),
    page(TERMS_META, legalBody("Terms of Service", termsSections(LEGAL_EMAIL)), [organization, website, webPage(TERMS_META), breadcrumbs([["Home", "/"], ["Terms of Service", "/terms"]])]),
    page(PRIVACY_META, legalBody("Privacy Policy", privacySections(LEGAL_EMAIL)), [organization, website, webPage(PRIVACY_META), breadcrumbs([["Home", "/"], ["Privacy Policy", "/privacy"]])]),
  ];
}

/* ------------------------------------------------------------------ sitemap + llms.txt */

export function sitemapXml(pages: SeoPage[], lastmod: string): string {
  const urls = pages.filter((pg) => pg.inSitemap).map((pg) =>
    `  <url><loc>${canonicalUrl(pg.path)}</loc><lastmod>${lastmod}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function llmsTxt(): string {
  const plans = SALE_PLANS.map((pl) => pl.quoteOnly
    ? `- ${pl.name}: priced on request. ${pl.blurb}`
    : `- ${pl.name}: ${kes(pl.price)} per month or ${kes(pl.priceYear)} per year, up to ${pl.users} users, ${pl.branches} branch${pl.branches === 1 ? "" : "es"}. ${pl.blurb}`);
  const mods = PAID.map((m) => `- ${m.name}: ${kes(m.price)} per month${(m.includedIn || []).length ? ` (included in ${(m.includedIn || []).map((k) => SALE_PLANS.find((x) => x.code === k)?.name).join(" and ")})` : ""}`);
  return [
    "# JMSURF Garage",
    "",
    "> JMSURF Garage (https://garage.jmsurf.co.ke) is garage management software for Kenya, for every kind of motor business from the roadside fundi to the dealer. "
    + "Garage Core (in every plan) covers job cards, customers and vehicles, estimates that customers approve online, M-Pesa payments, KRA eTIMS invoices, SMS updates, basic stock and the owner's dashboard. "
    + "Modules add workshop inspections and a bay board, parts stock and purchasing, accounting, payroll, insurance claims, a spares POS, an online parts shop, imports and landed cost, a vehicle yard, body and paint, car wash, tyres, fleet contracts, towing, car hire and a WhatsApp inbox. "
    + "Staff work at app.garage.jmsurf.co.ke; each garage also gets its own address (yourgarage.garage.jmsurf.co.ke) or custom domain for its customers. 14 days free, no card. Made by JMSURF TECHNOLOGIES LTD, Nairobi, Kenya.",
    "",
    "## Key pages",
    `- [Home](${SITE_ORIGIN}/): who it is for, how a car moves through the garage, M-Pesa and eTIMS, modules, plans and questions`,
    `- [Pricing](${SITE_ORIGIN}/pricing): plans, module prices, extra branches and the All modules bundle`,
    `- [All modules](${SITE_ORIGIN}/solutions): every module with what it does`,
    ...MODS.map((m) => `- [${m.name}](${SITE_ORIGIN}/solutions/${m.key}): ${m.tagline}`),
    `- [Start free](${SITE_ORIGIN}/register): set up a garage, 14 days free with no card`,
    `- [Terms of Service](${SITE_ORIGIN}/terms) and [Privacy Policy](${SITE_ORIGIN}/privacy)`,
    "",
    "## Pricing",
    `KES per garage per month, VAT excluded. Every plan includes Garage Core and starts with 14 days free; yearly payment is 10 times the monthly price (2 months free). Extra branches are ${kes(EXTRA_BRANCH_PRICE)} a month each; SMS are bought in bundles.`,
    ...plans,
    "",
    "Modules:",
    ...mods,
    "",
    "## Contact",
    `- Website: ${SITE_ORIGIN}/ (WhatsApp and phone details are on the website)`,
    `- Sign up: ${SITE_ORIGIN}/register`,
    "- Sign in: https://app.garage.jmsurf.co.ke/login",
    "",
    "## Other JMSURF products",
    ...JMSURF_FAMILY.map((f) => `- [${f.name}](${f.url}): ${f.what}`),
    "",
  ].join("\n");
}

export function llmsFullTxt(pages: SeoPage[]): string {
  return [llmsTxt(), "", "## Full website text", "",
    ...pages.filter((pg) => pg.inSitemap).map((pg) => `### ${pg.title}\n${canonicalUrl(pg.path)}\n\n${pg.text}\n`)].join("\n");
}

/** Kept here so the page list and the module list cannot drift apart. */
export const SUITE_KEYS = MODS.map((m) => m.key);

export { canonicalUrl, OG_IMAGE } from "./meta";
