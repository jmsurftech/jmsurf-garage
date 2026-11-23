/**
 * Facts the public website shows in more than one place: the JMSURF product family
 * (footer "More from JMSURF", llms.txt, structured data), the published plans and
 * module pages' "who it is for". Plain data only, so the build-time page snapshots
 * (src/seo/pages.ts) can use it too.
 */
import { DEFAULT_PLANS, YEAR_MONTHS, type GaragePlan } from "@/lib/garagePlans";
import type { ModuleCategory } from "@/lib/modules";

export const SITE_ORIGIN = "https://jmsurfgarage.co.ke";

/** JMSURF's contacts, as on jmsurf.co.ke: website, legal pages, footers and emails. */
export const CONTACT = {
  email: "info@jmsurf.co.ke",
  phone: "+254 712 504 593",
  /** WhatsApp number (same line). */
  wa: "254712504593",
  address: "Devan Plaza, 5th Floor, Crossway Road, Westlands, Nairobi, Kenya",
};

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

/** The plans as published (same as the live plans table, KES per garage, VAT excluded). */
export const PUBLIC_PLANS: GaragePlan[] = DEFAULT_PLANS;
export { YEAR_MONTHS };

/** "Who it's for" on each module page, by module category. */
export const SUITE_AUDIENCE: Record<ModuleCategory, string[]> = {
  "Workshop": ["Roadside fundis and one-man garages", "Neighbourhood garages with a few mechanics", "Busy workshops with many bays", "Dealers' service centres"],
  "Parts & sales": ["Spares shops and parts counters", "Parts wholesalers and importers", "Garages that sell parts over the counter", "Dealers with a parts department"],
  "Specialist": ["Body shops and accident repair centres", "Car washes and detailers", "Tyre, alignment and battery centres", "Fleet, towing and car hire businesses"],
  "Finance & people": ["Garages with staff on payroll", "Owners who want proper books", "Businesses registered for VAT", "Groups with several branches"],
  "Customers & marketing": ["Garages that want repeat customers", "Front desks answering calls and WhatsApp", "Workshops with fleet and trade customers", "Dealers running service reminders"],
  "Extras": ["Workshops doing rebuilds and refits", "Garages with service agreements", "Owners who want answers fast", "Teams that write down how they work"],
};

/** Short module name without the brand prefix ("JMSURF Call Centre" → "Call Centre"). */
export const suiteShort = (name: string) => name.replace(/^(JMSURF|DASH) /i, "");

/** The questions and answers on a module page. */
export function suiteFaqs(m: { name: string; included?: boolean; includedIn?: string[] }): [string, string][] {
  const short = suiteShort(m.name);
  const plans = (m.includedIn || []).map((c) => DEFAULT_PLANS.find((p) => p.code === c)?.name).filter(Boolean);
  return [
    m.included ? [`Is ${m.name} included?`, `Yes. ${m.name} is in every JMSURF Garage plan, from Fundi up, so every garage has it from day one.`]
      : [`Can I try ${m.name} before paying?`, `Yes. Tick it when you sign up, or switch it on later in System → Modules & billing, and use it free for 14 days. Your records stay if you switch it off.`],
    m.included ? ["What does it cost?", `Nothing extra: it comes with the base plan, from KES ${DEFAULT_PLANS[0].price.toLocaleString("en-KE")} a month for the Fundi plan.`]
      : ["What does it cost?", `See the monthly price on the pricing page.${plans.length ? ` It is included free in the ${plans.join(" and ")} plan${plans.length > 1 ? "s" : ""}.` : ""} Yearly payment gives 2 months free.`],
    [`Does ${short} work with the rest of JMSURF Garage?`, "Fully. It uses the same login, the same customers, vehicles, parts and staff, and the same invoices and payments, so nothing is typed twice."],
    ["Does it work with M-Pesa, KRA and SMS?", "Yes. M-Pesa payments, KRA eTIMS invoices and SMS updates are built into JMSURF Garage and work in every module."],
    ["Can my mechanics use it on their phones?", "Yes. JMSURF Garage works in any browser and installs like an app on Android and iPhone, with a phone layout for every screen."],
  ];
}

/** Yearly price of a monthly amount (2 months free). */
export const yearly = (monthly: number) => monthly * YEAR_MONTHS;
