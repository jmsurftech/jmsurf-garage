/**
 * Build-time snapshots of the public website (garage.jmsurf.co.ke).
 *
 * Search engines, AI assistants and link previews do not run JavaScript, so
 * scripts/prerender.mjs writes one HTML file per public page: the page's own head
 * tags and structured data, plus a plain, semantic copy of the same text the page
 * shows, inside <div id="root">. The app replaces it as soon as it starts, so every
 * visitor (person or crawler) gets the same page. Text here mirrors Landing.tsx,
 * Solutions.tsx, Solution.tsx, Register.tsx, Login.tsx and Legal.tsx; keep them in step
 * (src/seo/pages.test.ts checks the headings still exist in those pages).
 *
 * Also builds sitemap.xml, llms.txt and llms-full.txt from the same data.
 */
import { MODULES, MODULE_BY_KEY, moduleName, type ModuleDef } from "@/lib/modules";
import { JMSURF_FAMILY, PUBLIC_PLANS, SITE_ORIGIN, SUITE_AUDIENCE, suiteFaqs, suiteShort } from "@/lib/siteFacts";
import { UPDATED, privacySections, termsSections, type Section } from "@/pages/legalText";
import {
  HOME_META, LOGIN_META, OG_IMAGE, PRIVACY_META, REGISTER_META, SOLUTIONS_META, TERMS_META,
  canonicalUrl, suiteMeta, type PageMeta,
} from "./meta";

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

const SUITES = MODULES.length;
const APPS = MODULES.reduce((a, m) => a + m.apps.length, 0);
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

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
  applicationSubCategory: "ERP and business management",
  operatingSystem: "Web",
  description: "All-in-one cloud business management (ERP) for businesses worldwide: accounting, invoicing, inventory, CRM, HR and Kenyan payroll, projects, manufacturing, POS and a call centre in one login, with M-Pesa and KRA eTIMS built in.",
  areaServed: ["KE", "Worldwide"],
  publisher: { "@id": ORG_ID },
  offers: PUBLIC_PLANS.map((p) => ({
    "@type": "Offer",
    name: `${p.name} (monthly, per company)`,
    price: String(p.price_monthly),
    priceCurrency: "KES",
    description: `${p.description} Up to ${p.max_users} users. Prices exclude VAT. 14 days free.`,
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

/* ------------------------------------------------------------------ shared chrome */

const linkCls = "font-semibold text-primary hover:underline";

function header(): string {
  return `<header class="border-b border-border bg-background"><div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 sm:px-6">`
    + `<a href="/" class="font-display text-lg font-extrabold tracking-tight text-foreground">JMSURF Garage</a>`
    + `<nav aria-label="Main" class="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-muted-foreground">`
    + `<a href="/solutions">Suites</a><a href="/#worldwide">Built for the world</a><a href="/#migrate">Move in</a><a href="/#pricing">Pricing</a>`
    + `<a href="/api/demo/start">Live demo</a><a href="/login">Sign in</a><a href="/register" class="text-primary">Start free</a></nav></div></header>`;
}

function footer(): string {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Suites", "/solutions"], ["Pricing", "/#pricing"], ["Garage AI", "/solutions/ai"], ["Move in", "/#migrate"], ["Start free", "/register"]]],
    ["Suites", [["JMSURF BOOKS", "/solutions/books"], ["JMSURF CRM", "/solutions/crm"], ["JMSURF COMMERCE", "/solutions/commerce"], ["JMSURF HRM", "/solutions/hrm"], ["JMSURF CALL CENTRE", "/solutions/callcentre"], ["All suites", "/solutions"]]],
    ["Legal", [["Terms of service", "/terms"], ["Privacy policy", "/privacy"], ["System status", "/status"]]],
  ];
  return `<footer class="border-t border-border bg-card px-4 py-12 text-sm text-muted-foreground sm:px-6"><div class="mx-auto max-w-7xl">`
    + `<p class="font-display font-bold text-foreground">JMSURF Garage</p><p class="mt-2 max-w-xs">The all-in-one business management system for businesses around the world.</p>`
    + `<div class="mt-8 grid gap-8 sm:grid-cols-3">`
    + cols.map(([t, links]) => `<div><p class="font-display font-bold text-foreground">${esc(t)}</p><ul class="mt-3 space-y-2">${links.map(([l, h]) => `<li><a href="${h}">${esc(l)}</a></li>`).join("")}</ul></div>`).join("")
    + `</div>${familyHtml()}`
    + `<p class="mt-8">© ${new Date().getFullYear()} JMSURF Garage. All rights reserved. Powered by <a href="https://jmsurf.co.ke" class="font-bold text-foreground">JMSURF TECHNOLOGIES</a>. Made in Kenya for the world.</p>`
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

/* ------------------------------------------------------------------ home (mirrors Landing.tsx) */

export const HOME = {
  eyebrow: "JMSURF Garage · Business software for the world",
  headline: "Your whole business, one dashboard.",
  lead: "Accounting, stock, sales, CRM, HR & payroll, projects, a till and a call centre sharing one login, one customer list and one set of books. M-Pesa and KRA eTIMS built in.",
  countries: ["Kenya", "Uganda", "Tanzania", "Rwanda", "Burundi", "South Sudan", "Ethiopia", "Somalia", "DR Congo", "Nigeria", "Ghana", "South Africa", "Zambia", "Malawi", "Zimbabwe", "Botswana", "Namibia", "Mozambique", "Cameroon", "Senegal", "Côte d'Ivoire", "Egypt", "Morocco", "Djibouti", "UAE", "Saudi Arabia", "Qatar", "United Kingdom", "United States", "Canada", "Germany", "India"],
  statement: "Most businesses run on a dozen tools that never talk to each other. JMSURF Garage puts your money, stock, sales, people and customers in one place: one login, one ledger, one truth.",
  oneLogin: [
    { t: "Every suite, one login", d: "Accounting, stock, CRM, HR, projects, the till and the call centre sit in one sidebar. No second password, no switching apps." },
    { t: "Your own address", d: "yourcompany.garage.jmsurf.co.ke on day one, your own domain whenever you like." },
    { t: "Every company, one login", d: "Run several companies and switch in one click. Accountants manage every client the same way." },
    { t: "Every suite shares the same data", d: "A sale at the till, a deal in CRM, a call and a timesheet all land on the same customer and in the same books." },
    { t: "Made for the phone in your pocket", d: "Installs like an app on any phone, fast on 3G, and the till keeps selling when the internet drops." },
  ],
  africa: [
    { t: "Tax & compliance", d: "VAT and withholding tax, KRA eTIMS e-invoicing, PAYE, NSSF, SHIF, Housing Levy and NITA. Tax rules per country." },
    { t: "Every currency", d: "Bill in KES, UGX, TZS, NGN, ZAR, USD, EUR, GBP, AED, INR and every other currency, with the exchange rate on each document." },
    { t: "SMS & WhatsApp", d: "Invoices, statements, payslips and reminders by SMS and WhatsApp, because that is where your customers are." },
    { t: "Works on low data", d: "Fast on 3G, installs like an app on any phone, and the point of sale keeps selling when the internet drops." },
    { t: "Local support", d: "Real people in Nairobi on phone and WhatsApp who understand mobile money, local tax and how growing businesses run." },
    { t: "Pay your way", d: "Pay your subscription by M-Pesa in Kenya, or in USD from anywhere else. No pricing surprises." },
  ],
  payments: ["M-Pesa STK, Till & Paybill", "Airtel Money", "MTN MoMo", "EVC Plus · Zaad · Sahal", "Bank transfer & EFT", "Visa & Mastercard", "Flutterwave", "Paystack", "Pesapal", "Kopo Kopo", "IntaSend", "Chapa", "Stripe", "PayPal"],
  workflows: [
    { t: "Approvals", d: "Purchases, expenses, discounts and leave go to the right manager, approved from a phone." },
    { t: "Recurring everything", d: "Invoices, bills, expenses, subscriptions and journals that create themselves on schedule." },
    { t: "Smart reminders", d: "Overdue invoices, low stock, expiring contracts and certificates trigger SMS, email and in-app alerts." },
    { t: "Payroll in minutes", d: "Attendance and leave flow into payroll; payslips go out by email and SMS; bank and M-Pesa files ready." },
    { t: "Automations", d: "When a deal is won, create the project, the invoice and the welcome SMS without lifting a finger." },
    { t: "Reports & dashboards", d: "Profit and loss, balance sheet, cash flow, ageing, stock, sales, HR and project reports, to Excel or PDF." },
  ],
  migrateWhat: ["Customers and vendors", "Items and stock", "Chart of accounts", "Quotes and sales orders", "Invoices and credit notes", "Payments received", "Bills and expenses", "Payments made", "Manual journals", "CRM leads and employees"],
  migrateSteps: [
    { t: "Connect or export", d: "Connect your previous cloud accounting system by API in a few clicks, or upload its standard export files." },
    { t: "Everything comes across", d: "Contacts, items, accounts, documents and payments are mapped automatically, in the right order, with no retyping." },
    { t: "Check and go live", d: "Trial balance, receivables and stock match before you switch over. Our team helps you all the way." },
  ],
  security: [
    { t: "Encrypted everywhere", d: "TLS on every connection; secrets encrypted at rest." },
    { t: "Two-step sign-in", d: "Authenticator-app MFA for staff and customers." },
    { t: "Roles & permissions", d: "Every person sees only what their role allows." },
    { t: "Company isolation", d: "Database-level separation: one company can never see another's data." },
    { t: "Backups & standby", d: "Automatic backups and a live standby server in another country." },
    { t: "Full audit trail", d: "Every change recorded: who, what and when." },
  ],
};

/** The section headings on the home page, as shown (highlighted words joined in). */
export const HOME_HEADINGS = {
  countries: "Ready for business wherever you trade.",
  suites: "Every app a business needs. Switch on what you use.",
  oneLogin: "Not a bundle of apps. One system.",
  africa: "Built in Nairobi. Ready for the world.",
  workflows: "The busywork runs itself.",
  migrate: "Switching systems? Bring your history.",
  pricing: "Simple plans. No surprises.",
  security: "Bank-grade protection, by default.",
  final: "Run it all from one dashboard.",
};

function planHtml(): string {
  return `<div class="mt-6 grid gap-6 sm:grid-cols-2">` + PUBLIC_PLANS.map((pl) => {
    const incl = pl.all_modules ? [`All ${SUITES} suites, including Garage AI and the Call Centre`] : pl.included_modules.map(moduleName);
    return `<div>${h3(pl.name)}${p(pl.description || "")}`
      + `<p class="mt-2 font-display text-xl font-extrabold">${kes(pl.price_monthly)} / month <span class="text-sm font-normal text-muted-foreground">or ${kes(pl.price_annually || pl.price_monthly * 10)} / year</span></p>`
      + `<p class="text-xs text-muted-foreground">Up to ${pl.max_users} users · per company</p>`
      + ul(["JMSURF BOOKS (accounting, sales, purchases, banking)", ...incl, "Customer portal, documents, approvals", "Your own address and custom domain"])
      + `</div>`;
  }).join("") + `</div>`;
}

function homeBody(): string {
  return wrap(
    `<section><h1 class="font-display text-4xl font-extrabold tracking-tight sm:text-6xl"><span class="lx-eyebrow">${esc(HOME.eyebrow)}</span> <span class="mt-4 block">${esc(HOME.headline)}</span></h1>`
    + p(HOME.lead)
    + `<p class="mt-6 flex flex-wrap gap-4"><a href="/register" class="${linkCls}">Start free for 14 days</a><a href="/api/demo/start" class="${linkCls}">Try the live demo</a></p>`
    + `<ul class="mt-6 flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold"><li>${SUITES} suites</li><li>${APPS}+ apps</li><li>14 days free</li><li>1 login</li></ul></section>`
    + `<section aria-label="Countries">${h2(HOME_HEADINGS.countries)}${p("Local currencies, local tax and mobile money wherever you trade, with billing in shillings or USD.")}<p class="mt-3 text-sm">${HOME.countries.map(esc).join(" · ")}</p></section>`
    + `<section>${p(HOME.statement)}</section>`
    + `<section id="suites">${h2(HOME_HEADINGS.suites)}${p("JMSURF BOOKS is your base. Add suites from inside your workspace whenever you need them, each free for 14 days.")}`
    + `<ul class="mt-4 space-y-2">${MODULES.map((m) => `<li><a href="/solutions/${m.key}" class="${linkCls}">${esc(m.name)}</a>: ${esc(m.tagline)}</li>`).join("")}</ul>`
    + `<p class="mt-4"><a href="/solutions" class="${linkCls}">See every suite</a></p></section>`
    + `<section>${h2(HOME_HEADINGS.oneLogin)}${p("Most business suites give you a different link, login and screen for every product. JMSURF Garage opens everything from one place: same sidebar, same search, same customer, same numbers.")}${cards(HOME.oneLogin)}`
    + ul(["Android and iPhone", "Tablets at the counter", "Any laptop or desktop", "Receipt printers and scanners"]) + `</section>`
    + `<section id="worldwide">${h2(HOME_HEADINGS.africa)}${p("Wherever you trade, JMSURF Garage works the way you do: local payments, local tax, every currency and real people on support.")}`
    + `<ol class="mt-2">${HOME.africa.map((c) => `<li>${h3(c.t)}${p(c.d)}</li>`).join("")}</ol>`
    + h3("Payment methods") + `<p class="mt-3 text-sm">${HOME.payments.map(esc).join(" · ")}</p></section>`
    + `<section>${h2(HOME_HEADINGS.workflows)}${p("Every workflow a growing business needs, connected across every suite.")}${cards(HOME.workflows)}</section>`
    + `<section id="migrate">${h2(HOME_HEADINGS.migrate)}${p("Built for companies moving from other accounting and business software, or from spreadsheets. Your history, balances and documents come across, so nothing is lost.")}`
    + h3("What moves across") + ul(HOME.migrateWhat)
    + `<ol class="mt-2">${HOME.migrateSteps.map((s, i) => `<li><p class="mt-6 text-xs font-bold uppercase tracking-widest text-primary">Step ${i + 1}</p>${h3(s.t)}${p(s.d)}</li>`).join("")}</ol></section>`
    + `<section id="pricing">${h2(HOME_HEADINGS.pricing)}${p("Start with JMSURF BOOKS and add suites from inside your workspace as you grow, or take everything with All-in-One. Every plan starts with 14 days free.")}`
    + planHtml() + p("More suites can be added any time from System → Modules in your workspace. Prices exclude VAT. Yearly: 2 months free.") + `</section>`
    + `<section>${h2(HOME_HEADINGS.security)}${p("Your books, your staff and your customers' details are guarded the way a bank guards accounts, on every plan.")}${cards(HOME.security)}</section>`
    + `<section>${h2(HOME_HEADINGS.final)}${p("Join the businesses moving to JMSURF Garage. Free for 14 days, set up in a minute.")}`
    + `<p class="mt-4 flex flex-wrap gap-4"><a href="/register" class="${linkCls}">Start free for 14 days</a><a href="/login" class="${linkCls}">Sign in</a></p></section>`,
  );
}

/* ------------------------------------------------------------------ suites (mirrors Solutions.tsx / Solution.tsx) */

function solutionsBody(): string {
  return wrap(
    `<p class="text-xs font-bold uppercase tracking-widest text-primary">${SUITES} suites · ${APPS}+ apps</p>`
    + `<h1 class="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">Every suite. One login.</h1>`
    + p("JMSURF BOOKS is your base. Switch on any other suite from inside your workspace, each free for 14 days, and it shares your customers, stock and books from the first minute.")
    + MODULES.map((m) => `<section><h2 class="mt-10 font-display text-2xl font-extrabold tracking-tight"><a href="/solutions/${m.key}">${esc(suiteShort(m.name))}</a></h2>`
      + `<p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">${m.included ? "Included" : esc(m.category)} · ${m.apps.length} apps</p>`
      + p(m.tagline) + ul(m.features.slice(0, 3)) + `</section>`).join("")
    + cta(),
  );
}

function related(m: ModuleDef): ModuleDef[] {
  const same = MODULES.filter((x) => x.key !== m.key && x.category === m.category);
  const base = MODULES.filter((x) => ["books", "ai", "crm", "inventory"].includes(x.key) && x.key !== m.key && !same.includes(x));
  return [...same, ...base].slice(0, 4);
}

function suiteBody(m: ModuleDef): string {
  const short = suiteShort(m.name);
  const idx = MODULES.findIndex((x) => x.key === m.key);
  const prev = MODULES[(idx - 1 + MODULES.length) % MODULES.length], next = MODULES[(idx + 1) % MODULES.length];
  return wrap(
    `<nav aria-label="Breadcrumb" class="text-xs font-bold uppercase tracking-widest text-muted-foreground"><a href="/">Home</a> / <a href="/solutions">All suites</a> / ${esc(m.name)}</nav>`
    + `<p class="mt-6 text-xs font-bold uppercase tracking-widest text-primary">${esc(m.category)}</p>`
    + `<h1 class="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">JMSURF ${esc(short)}</h1>`
    + `<p class="mt-4 text-lg font-medium">${esc(m.tagline)}</p>` + p(m.description)
    + `<p class="mt-6 flex flex-wrap gap-4"><a href="${m.included ? "/register" : `/register?app=${m.key}`}" class="${linkCls}">${m.included ? "Start free for 14 days" : `Start with ${esc(short)} free`}</a><a href="/api/demo/start" class="${linkCls}">See it in the live demo</a></p>`
    + `<p class="mt-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">14 days free · No card · ${m.apps.length} apps</p>`
    + `<section>${h2(`${m.apps.length} apps, one suite.`)}${p(`Switch on ${m.name} and all of these appear in your menu together.`)}${cards(m.apps.map((x) => ({ t: x.name, d: x.desc })))}</section>`
    + `<section>${h2("Everything you expect, and the local bits.")}${ul(m.features)}</section>`
    + `<section>${h2(`${short} works with everything else.`)}${cards([
      { t: "One set of books", d: "Every sale, cost and payment lands in the same ledger, ready for reports." },
      { t: "M-Pesa & SMS built in", d: "Collect payments and send messages without extra tools." },
      { t: "Garage AI included", d: "Ask questions about your data and let it draft the work." },
      { t: "Roles & audit trail", d: "Each person sees only what they should; every change is recorded." },
    ])}<ul class="mt-6 space-y-2">${related(m).map((r) => `<li><a href="/solutions/${r.key}" class="${linkCls}">${esc(r.name)}</a>: ${esc(r.tagline)}</li>`).join("")}</ul></section>`
    + `<section>${h2("Made for businesses like yours.")}${ul(SUITE_AUDIENCE[m.category])}</section>`
    + `<section>${h2("Questions")}${suiteFaqs(m).map(([q, a]) => `<details class="mt-3" open><summary class="font-display font-bold">${esc(q)}</summary>${p(a)}</details>`).join("")}</section>`
    + `<nav aria-label="More suites" class="mt-12 flex flex-wrap justify-between gap-4"><a href="/solutions/${prev.key}" class="${linkCls}">Previous suite: ${esc(prev.name)}</a><a href="/solutions/${next.key}" class="${linkCls}">Next suite: ${esc(next.name)}</a></nav>`
    + `<section>${h2(HOME_HEADINGS.final)}${p("Join the businesses moving to JMSURF Garage. Free for 14 days, set up in a minute.")}${cta()}</section>`,
  );
}

/* ------------------------------------------------------------------ sign-up, sign-in, legal */

function registerBody(): string {
  return wrap(
    `<h1 class="font-display text-3xl font-bold tracking-tight">Start your free trial</h1>`
    + p("14 days free. No card required.")
    + ul(["Your company is ready in about a minute", "Books, inventory, CRM, HR, projects and 50+ apps", "Bring your data from your old system or Excel"])
    + h2("Business and contact details")
    + p("Enter your business name, your name, email, phone, country and currency, and choose your JMSURF Garage address (yourcompany.garage.jmsurf.co.ke). Then pick the apps you want and set your password.")
    + `<p class="mt-6">Already have an account? <a href="/login" class="${linkCls}">Sign in</a></p>`,
  );
}

function loginBody(): string {
  return wrap(
    `<h1 class="font-display text-3xl font-bold tracking-tight">Sign in</h1>`
    + p("One login for every company you run. Sign in with your email and password, or go straight to your company address (yourcompany.garage.jmsurf.co.ke).")
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
  const home = page(HOME_META, homeBody(), [organization, website, software, webPage(HOME_META, { about: { "@id": APP_ID } })], {
    aliases: ["/pricing", "/features"],
    ogTitle: "JMSURF Garage | Your whole business. One dashboard.",
    ogDescription: "The all-in-one business management system, made in Kenya for the world: books, stock, CRM, HR and payroll, POS and more in one login. M-Pesa and KRA eTIMS built in.",
  });
  const solutions = page(SOLUTIONS_META, solutionsBody(), [organization, website, software,
    webPage(SOLUTIONS_META, { "@type": "CollectionPage" }), breadcrumbs([["Home", "/"], ["All suites", "/solutions"]])]);
  const suites = MODULES.map((m) => {
    const meta = suiteMeta(m.key)!;
    return page(meta, suiteBody(m), [organization, website, software, webPage(meta, { about: { "@id": APP_ID } }),
      breadcrumbs([["Home", "/"], ["All suites", "/solutions"], [m.name, meta.path]]),
      { "@type": "FAQPage", mainEntity: suiteFaqs(m).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ], { ogTitle: `${m.name} · JMSURF Garage`, ogDescription: meta.description });
  });
  return [
    home, solutions, ...suites,
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
  const plans = PUBLIC_PLANS.map((pl) => `- ${pl.name}: ${kes(pl.price_monthly)} per month or ${kes(pl.price_annually || pl.price_monthly * 10)} per year, up to ${pl.max_users} users. ${pl.description}`);
  return [
    "# JMSURF Garage",
    "",
    "> JMSURF Garage (https://garage.jmsurf.co.ke) is an all-in-one cloud business management system (ERP) for businesses in Kenya and around the world. "
    + `Accounting, invoicing, inventory, CRM, HR and Kenyan payroll (PAYE, NSSF, SHIF, Housing Levy), projects, manufacturing, marketing, point of sale, e-commerce and a call centre share one login and one set of books, in ${SUITES} suites with ${APPS}+ apps. `
    + "Customers pay by M-Pesa (STK push, Till, Paybill), Airtel Money, card or bank; KRA eTIMS e-invoicing is built in; each company gets its own address (yourcompany.garage.jmsurf.co.ke) or custom domain. 14 days free, no card. Made by JMSURF TECHNOLOGIES LTD, Nairobi, Kenya.",
    "",
    "## Key pages",
    `- [Home](${SITE_ORIGIN}/): what JMSURF Garage does, built-for-the-world features, moving in from other systems, pricing and security`,
    `- [All suites](${SITE_ORIGIN}/solutions): every suite with its apps and main features`,
    ...MODULES.map((m) => `- [${m.name}](${SITE_ORIGIN}/solutions/${m.key}): ${m.tagline}`),
    `- [Start free](${SITE_ORIGIN}/register): create a company, 14 days free with no card`,
    `- [Live demo](${SITE_ORIGIN}/api/demo/start): open a ready-made demo company`,
    `- [Terms of Service](${SITE_ORIGIN}/terms) and [Privacy Policy](${SITE_ORIGIN}/privacy)`,
    "",
    "## Pricing",
    "KES per company, VAT excluded. Every plan includes JMSURF BOOKS and starts with 14 days free; yearly billing gives 2 months free. Other suites can be switched on from inside the workspace.",
    ...plans,
    "",
    "## Contact",
    `- Website: ${SITE_ORIGIN}/ (WhatsApp and phone details are on the website)`,
    `- Sign up: ${SITE_ORIGIN}/register`,
    `- Sign in: ${SITE_ORIGIN}/login`,
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

/** Kept here so the page list and the suite list cannot drift apart. */
export const SUITE_KEYS = Object.keys(MODULE_BY_KEY);

export { canonicalUrl, OG_IMAGE } from "./meta";
