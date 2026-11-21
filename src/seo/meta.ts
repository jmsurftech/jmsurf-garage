/**
 * Title and description of every public website page. The build-time snapshots
 * (scripts/prerender.mjs) write these into the raw HTML for search engines, AI
 * assistants and link previews; the pages set the same values when they open.
 * Titles 50-60 characters, descriptions 140-160 (src/seo/pages.test.ts checks).
 */
import { SITE_ORIGIN } from "@/lib/siteFacts";

export interface PageMeta {
  /** Path as served (no trailing slash except the home page). */
  path: string;
  /** 50-60 characters. */
  title: string;
  /** 140-160 characters. */
  description: string;
  /** Kept out of search results (still has a title and a heading). */
  noindex?: boolean;
}

export const OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;
export const canonicalUrl = (path: string) => `${SITE_ORIGIN}${path === "/" ? "/" : path}`;

export const HOME_META: PageMeta = {
  path: "/",
  title: "JMSURF Garage: Garage Management Software for Kenya",
  description: "Job cards, estimates customers approve online, parts stock, M-Pesa and KRA eTIMS invoices for every garage in Kenya. From KES 500 a month, 14 days free.",
};

export const PRICING_META: PageMeta = {
  path: "/pricing",
  title: "JMSURF Garage Pricing: Plans from KES 500 a Month, Kenya",
  description: "Garage plans by size from KES 500 a month, module prices, extra branches and the All modules bundle. Pay yearly and get 2 months free. 14 days free to start.",
};

export const SOLUTIONS_META: PageMeta = {
  path: "/solutions",
  title: "JMSURF Garage Modules: Workshop, Parts, Body Shop and More",
  description: "Every JMSURF Garage module: workshop, parts and spares, imports, car yard, body and paint, car wash, tyres, fleet, towing, car hire, payroll and accounting.",
};

export const REGISTER_META: PageMeta = {
  path: "/register",
  title: "Start Your Free JMSURF Garage Trial: 14 Days, No Card",
  description: "Set up your garage in a few minutes: choose your size and what you do, see the monthly price, and use every module you chose free for 14 days. No card needed.",
};

export const LOGIN_META: PageMeta = {
  path: "/login",
  title: "Sign in to JMSURF Garage | Garage Management Software",
  description: "Sign in to JMSURF Garage at app.jmsurfgarage.co.ke: job cards, customers, vehicles, parts and every garage you run, in one place, with two-step sign-in.",
  noindex: true,
};

export const TERMS_META: PageMeta = {
  path: "/terms",
  title: "Terms of Service | JMSURF Garage Software, Nairobi, Kenya",
  description: "The terms for using JMSURF Garage, the garage management service from JMSURF Technologies in Nairobi, Kenya: trials, plans, modules, payments and your data.",
};

export const PRIVACY_META: PageMeta = {
  path: "/privacy",
  title: "Privacy Policy | JMSURF Garage Software, Nairobi, Kenya",
  description: "How JMSURF Garage collects, uses and protects personal data under the Kenya Data Protection Act, 2019: what we keep, who we share it with and your rights.",
};

/** Module pages (/solutions/<key>). */
const SUITE_META: Record<string, [string, string]> = {
  garage_core: ["Garage Core: Job Cards, Estimates, M-Pesa and eTIMS",
    "Job cards, customers and vehicles, estimates approved online, M-Pesa payments, KRA eTIMS invoices and SMS updates. In every JMSURF Garage plan from KES 500."],
  workshop_pro: ["Workshop Pro: Inspections, Bay Board and Mechanic App",
    "Digital inspections with photos, a live bay board for the workshop TV and a phone app where mechanics see jobs and clock time. Part of JMSURF Garage, Kenya."],
  inventory: ["Parts & Stock: Garage Parts Inventory Software, Kenya",
    "Parts stock across stores and branches: purchase orders, receiving, transfers, serial numbers and stock-takes, with parts on jobs taken off stock by itself."],
  commerce: ["Spares POS & Wholesale: Spare Parts Shop Software, Kenya",
    "A fast spares counter till that works offline, with M-Pesa, card and cash, wholesale price lists, trade credit limits and loyalty points. Part of JMSURF Garage."],
  website: ["Online Parts Shop & Garage Website on Your Own Domain",
    "A fast garage website on your own domain with services, opening hours and online booking, plus an online parts shop with live stock and M-Pesa checkout."],
  imports: ["Imports & Landed Cost: Car and Parts Import Software",
    "Follow parts and vehicle imports from order to arrival: shipments, containers, freight, duty and clearing, with the true landed cost of every item. Kenya."],
  insurance: ["Insurance Claims Software for Garages and Body Shops",
    "Accident repair claims with photos, assessor and approval steps, excess billed to the customer and statements for every insurer. Part of JMSURF Garage."],
  vehicle_yard: ["Vehicle Yard & Car Sales Software for Car Dealers, Kenya",
    "Cars for sale with photos, costs and reconditioning, deposits and part payments, logbook transfer steps and the real profit on every car sold. JMSURF Garage."],
  body_paint: ["Body & Paint: Panel Beating and Spray Shop Software",
    "Track body work from strip-down to polish: stages per car, before and after photos, and paint and materials booked to each job. Works with insurance claims."],
  car_wash: ["Car Wash & Detailing Software with M-Pesa for Kenya",
    "A wash queue by number plate, packages and add-ons, attendants' commission, prepaid wash cards and M-Pesa payments at the bay. Part of JMSURF Garage, Kenya."],
  tyres: ["Tyres, Alignment & Batteries: Tyre Shop Software Kenya",
    "Find tyres by size, record wheel alignment and balancing, test batteries and keep the warranty for every tyre and battery sold. Part of JMSURF Garage, Kenya."],
  fleet_contracts: ["Fleet Contracts & Fleet Portal for Garages in Kenya",
    "Service contracts for companies with many vehicles: contract rates, service due reminders, monthly fleet statements and a portal for each fleet manager."],
  towing: ["Towing & Mobile Mechanic Software: Dispatch and Billing",
    "Answer tow and roadside calls, dispatch the nearest truck or mechanic, charge by distance and turn each call-out into a job card at the garage. JMSURF Garage."],
  car_hire: ["Car Hire Software: Bookings, Deposits and Returns, Kenya",
    "Rent out cars with a booking calendar per car, deposits by M-Pesa, hand-over and return checks with photos, and late or damage charges on the bill. Kenya."],
  accounting: ["Accounting for Garages: Books, Banking and VAT Returns",
    "Chart of accounts, journals, bank and M-Pesa statement matching, profit and loss, balance sheet, VAT return and budgets for your garage. Part of JMSURF Garage."],
  hrm: ["Payroll & HR for Garages: PAYE, NSSF, SHIF, Housing Levy",
    "Staff files, attendance, leave and Kenyan payroll with PAYE, NSSF, SHIF, Housing Levy and NITA worked out, payslips by SMS and email, casual workers included."],
  expense: ["Expense Claims for Garage Staff with M-Pesa Refunds",
    "Staff claim fuel, parts runs and trips from the phone with a receipt photo; the owner approves in one tap and the refund goes by M-Pesa. Part of JMSURF Garage."],
  whatsapp: ["WhatsApp Inbox for Garages: One Shared Business Inbox",
    "One shared WhatsApp inbox for your garage team, linked to customers and jobs, with estimates, invoices and car-ready messages sent on WhatsApp. JMSURF Garage."],
  crm: ["CRM for Garages: Leads and Follow-ups for Fleet Customers",
    "Follow up every enquiry from calls, WhatsApp and your website, with reminders and deals that turn into estimates and invoices without retyping. JMSURF Garage."],
  marketing: ["Garage Marketing: Service Reminders, SMS and Campaigns",
    "Bring customers back with service reminders by mileage or date, SMS, WhatsApp and email campaigns, and feedback after every job. Part of JMSURF Garage, Kenya."],
  service: ["Helpdesk & Online Service Bookings for Garages, Kenya",
    "Complaint and warranty tickets with someone responsible, a chat bubble on your website and online appointment booking with SMS confirmations. JMSURF Garage."],
  callcentre: ["JMSURF Call Centre for Garages: Calls Linked to Customers",
    "Phone lines with a menu, queues and call recording, answered in the browser with the caller's vehicles, jobs and balance on screen. Works in JMSURF Garage."],
  projects: ["Projects for Garages: Rebuilds and Refits with Costs",
    "Plan long jobs such as engine rebuilds and fleet refits with tasks and milestones, log time and costs as they happen, and bill when ready. JMSURF Garage."],
  contracts: ["Contracts & e-Sign for Garages: Signed on Any Phone, Kenya",
    "Draft service agreements from templates, send them for electronic signature on any phone and keep the signed copy on the customer. Part of JMSURF Garage."],
  workplace: ["Knowledge & Sheets: Garage Procedures and Checklists",
    "Write down how your garage works: procedures, checklists and how-to guides your team can search, plus spreadsheets next to your data. Part of JMSURF Garage."],
  ai: ["Garage AI: Ask About Your Garage in Plain Words, Kenya",
    "Ask by typing or speaking who owes you, which jobs pay best and which parts are slow. Garage AI reads your JMSURF Garage data and acts only when you confirm."],
};

export function suiteMeta(key: string): PageMeta | null {
  const m = SUITE_META[key];
  return m ? { path: `/solutions/${key}`, title: m[0], description: m[1] } : null;
}

export const SUITE_META_KEYS = Object.keys(SUITE_META);
