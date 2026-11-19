/**
 * Facts the public website shows in more than one place: the JMSURF product family
 * (footer "More from JMSURF", llms.txt, structured data) and the published packages.
 * Plain data only, so the build-time page snapshots (src/seo/pages.ts) can use it too.
 */

export const SITE_ORIGIN = "https://garage.jmsurf.co.ke";

/** The other launched JMSURF products (owner 2026-11-07: launched systems only; names and addresses as the company publishes them). */
export const JMSURF_FAMILY: { name: string; url: string; what: string }[] = [
  { name: "JMSURF SYSTEMS", url: "https://jmsurfsys.co.ke", what: "every JMSURF product in one place" },
  { name: "JMSURF POS", url: "https://www.jmsurfpos.co.ke", what: "point of sale and stock software" },
  { name: "JMSURF PAY", url: "https://jmsurfpay.co.ke", what: "M-Pesa payment integration" },
  { name: "JMSURF SMS", url: "https://jmsurfsms.co.ke", what: "bulk SMS and SMS API" },
  { name: "JMSURF ISP", url: "https://jmsurfisp.co.ke", what: "ISP billing, hotspot and PPPoE" },
  { name: "JMSURF CALL CENTRE", url: "https://jmsurfcallcentre.co.ke", what: "cloud call centre" },
  { name: "JMSURFHOST", url: "https://jmsurfhost.co.ke", what: "domains, hosting and VPS" },
  { name: "JMSURF Mail", url: "https://jmsurfmail.co.ke", what: "transactional email API" },
];

export interface PublicPlan {
  id: string; name: string; price_monthly: number; price_annually: number | null; max_users: number;
  description: string | null; all_modules: boolean; included_modules: string[]; sort: number;
}

/**
 * The packages as published (same as the live plans table, KES per company, VAT excluded).
 * The pricing section reads the live table and only falls back to this list.
 */
export const PUBLIC_PLANS: PublicPlan[] = [
  { id: "s", name: "Starter", price_monthly: 1000, price_annually: 10000, max_users: 2, description: "JMSURF BOOKS for a small business: invoicing, expenses, banking and reports.", all_modules: false, included_modules: [], sort: 1 },
  { id: "t", name: "Standard", price_monthly: 2500, price_annually: 25000, max_users: 5, description: "Books plus JMSURF INVENTORY for growing teams.", all_modules: false, included_modules: ["inventory"], sort: 2 },
  { id: "p", name: "Professional", price_monthly: 5000, price_annually: 50000, max_users: 15, description: "Books, Inventory, CRM, Projects and Expense for established companies.", all_modules: false, included_modules: ["inventory", "crm", "projects", "expense"], sort: 3 },
  { id: "a", name: "All-in-One", price_monthly: 15000, price_annually: 150000, max_users: 50, description: "Every JMSURF Garage suite for one price.", all_modules: true, included_modules: [], sort: 4 },
];

type Category = "Finance" | "Sales & Marketing" | "Operations" | "People" | "Services" | "Digital" | "Productivity";

/** "Who it's for" on each suite page, by suite category. */
export const SUITE_AUDIENCE: Record<Category, string[]> = {
  "Finance": ["Owner-run shops and SMEs", "Accountants managing several clients", "NGOs and schools with donor reporting", "Growing companies with VAT and eTIMS"],
  "Sales & Marketing": ["Sales teams chasing a pipeline", "Retailers and distributors", "Agencies running client campaigns", "Hospitality and events"],
  "Operations": ["Wholesalers and distributors", "Manufacturers and processors", "Construction and hardware", "Logistics and fleets"],
  "People": ["Companies with 5 to 500 staff", "Schools, hospitals and hotels", "Firms with shift and field teams", "HR and payroll bureaus"],
  "Services": ["Consultancies and agencies", "Repair and installation businesses", "Clinics, salons and practices", "IT and support teams"],
  "Digital": ["Brands selling online", "Training providers and schools", "Communities and associations", "Companies that want their own website"],
  "Productivity": ["Teams that live in documents", "Managers who want answers fast", "Businesses building their own apps", "Everyone who hates retyping"],
};

/** Short suite name without the brand prefix ("JMSURF BOOKS" → "BOOKS"). */
export const suiteShort = (name: string) => name.replace(/^(JMSURF|DASH) /, "");

/** The questions and answers on a suite page. */
export function suiteFaqs(m: { name: string; included?: boolean }): [string, string][] {
  const short = suiteShort(m.name);
  return [
    m.included ? [`Is ${m.name} included?`, `Yes. ${m.name} is the base of every JMSURF Garage package, so every company has it from day one.`]
      : [`Can I try ${m.name} before paying?`, `Yes. Switch it on from System → Modules in your workspace and use it free for 14 days. Your records stay if you switch it off.`],
    [`Can I use only ${short}?`, m.included ? "JMSURF BOOKS is the foundation; add any other suite when you need it." : `Yes. Sign up for ${short} on its own and your menu shows only its apps. Add the rest of JMSURF Garage whenever you are ready.`],
    [`Does ${short} work with the rest of JMSURF Garage?`, `Fully. It uses the same login, the same customers, items and staff, and posts to the same books, so nothing is typed twice.`],
    ["Does it work with M-Pesa, KRA and SMS?", "Yes. M-Pesa payments, KRA eTIMS invoices, SMS and WhatsApp messages are built into JMSURF Garage and available to every suite."],
    ["Can my team use it on their phones?", "Yes. JMSURF Garage works in any browser and installs like an app on Android and iPhone, with a phone layout for every screen."],
  ];
}
