/**
 * Title and description of every public website page. The build-time snapshots
 * (scripts/prerender.mjs) write these into the raw HTML for search engines, AI
 * assistants and link previews; the pages set the same values when they open.
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
  title: "JMSURF Garage: All-in-One Business Software for the World",
  description: "Accounting, invoicing, stock, CRM, HR and payroll, projects, POS and a call centre in one login. M-Pesa and KRA eTIMS built in. Start free for 14 days.",
};

export const SOLUTIONS_META: PageMeta = {
  path: "/solutions",
  title: "JMSURF Garage Suites: Accounting, CRM, Stock, HR and POS",
  description: "Every JMSURF Garage suite in one login: books, inventory, CRM, HR and payroll, projects, manufacturing, marketing, POS and a call centre for firms everywhere.",
};

export const REGISTER_META: PageMeta = {
  path: "/register",
  title: "Start Your Free JMSURF Garage Trial: 14 Days, No Card",
  description: "Create your JMSURF Garage company in about a minute: books, inventory, CRM, HR, projects and 50+ apps, free for 14 days with no card. Made in Kenya for the world.",
};

export const LOGIN_META: PageMeta = {
  path: "/login",
  title: "Sign in to JMSURF Garage | Business Software for the World",
  description: "Sign in to JMSURF Garage: your books, inventory, CRM, HR and every company you run, in one place. One login for every company, with two-step sign-in support.",
  noindex: true,
};

export const TERMS_META: PageMeta = {
  path: "/terms",
  title: "Terms of Service | JMSURF Garage Business Software, Kenya",
  description: "The terms for using JMSURF Garage, the cloud business management service from JMSURF Technologies in Nairobi, Kenya: trials, packages, payments and your data.",
};

export const PRIVACY_META: PageMeta = {
  path: "/privacy",
  title: "Privacy Policy | JMSURF Garage Business Software, Kenya",
  description: "How JMSURF Garage collects, uses and protects personal data under the Kenya Data Protection Act, 2019: what we keep, who we share it with and your rights.",
};

/** Suite pages (/solutions/<key>). */
const SUITE_META: Record<string, [string, string]> = {
  books: ["JMSURF BOOKS: Accounting & Invoicing Software for Kenya",
    "Double-entry accounting, invoices, bills, banking and 50+ reports in JMSURF Garage. M-Pesa payment links, KRA eTIMS and VAT built in. Free for 14 days."],
  finance_plus: ["JMSURF FINANCE+: Fixed Assets & Subscription Billing",
    "Fixed asset register with monthly depreciation, recurring subscription billing, ESG reporting and practice tools for accountants, in JMSURF Garage."],
  expense: ["JMSURF EXPENSE: Expense Claims with M-Pesa Refunds",
    "Expense claims, trips, mileage and advances submitted from the phone, approved in one tap and reimbursed by M-Pesa. Part of JMSURF Garage, free for 14 days."],
  crm: ["JMSURF CRM: Sales Pipeline & Lead Software for Kenya",
    "Capture leads from your website, WhatsApp and calls, move deals through a pipeline and turn them into quotes and invoices without retyping. Part of JMSURF Garage."],
  marketing: ["JMSURF MARKETING: Email, SMS & WhatsApp Campaign Tool",
    "Email, bulk SMS, WhatsApp and social media campaigns, automation journeys, events and surveys built on your CRM data. Part of JMSURF Garage, worldwide."],
  commerce: ["JMSURF COMMERCE: POS & Online Store Software, Kenya",
    "Point of sale, online store, rentals and loyalty on one stock list and one set of books. M-Pesa, card and cash, and the till sells offline. Part of JMSURF Garage."],
  inventory: ["JMSURF INVENTORY: Stock & Warehouse Software for Kenya",
    "Track stock across warehouses and branches: transfers, batches and expiry, serial numbers, stock-takes, kits, deliveries and fleet. Part of JMSURF Garage."],
  manufacturing: ["JMSURF MANUFACTURING: Production Software for Factories",
    "Bills of materials, routings and production orders that put finished goods into stock at true cost, plus quality, maintenance and IoT. Part of JMSURF Garage."],
  hrm: ["JMSURF HRM: HR & Payroll Software for Kenya (PAYE, SHIF)",
    "Employee files, attendance, leave, recruitment, appraisals, shifts and Kenyan payroll with PAYE, NSSF, SHIF and Housing Levy. Payslips by email and SMS."],
  projects: ["JMSURF PROJECTS: Project, Task & Timesheet Software",
    "Projects, tasks, milestones and timesheets on boards, lists or calendars, with costs tracked and billable hours turned into invoices. Part of JMSURF Garage."],
  service: ["JMSURF SERVICE: Helpdesk, Live Chat & Field Service",
    "Helpdesk tickets from email with SLAs, live chat on your website, field service jobs and online appointment booking, linked to every customer in JMSURF Garage."],
  contracts: ["JMSURF SIGN & CONTRACTS: Electronic Signatures, Kenya",
    "Draft contracts from templates, route them for approval, collect legally binding electronic signatures from any phone and track renewals. Part of JMSURF Garage."],
  callcentre: ["JMSURF CALL CENTRE in DASH: Cloud Call Centre for Kenya",
    "Cloud call centre with IVR, queues, browser phones and call recording, every call linked to the customer record. Works inside JMSURF Garage for Kenyan businesses."],
  website: ["JMSURF SITES: Website, Blog & eLearning on Your Domain",
    "Publish your company website, blog, community forum and online courses on your own domain, with contact forms flowing into the CRM. Part of JMSURF Garage."],
  workplace: ["JMSURF WORKPLACE: Company Knowledge Base & Spreadsheets",
    "A searchable knowledge base for procedures, policies and guides, plus working spreadsheets next to the data they describe. Part of JMSURF Garage."],
  ai: ["Garage AI: AI Business Assistant for Your Company Data",
    "Ask about your business in plain language by typing or speaking: who owes you, what is selling, how profit changed. Garage AI reads your JMSURF Garage data."],
  studio: ["JMSURF STUDIO: Build Your Own Business Apps, No Code",
    "Build your own apps, record types, fields, statuses and views without code, with the same permissions, history and search as the rest of JMSURF Garage."],
};

export function suiteMeta(key: string): PageMeta | null {
  const m = SUITE_META[key];
  return m ? { path: `/solutions/${key}`, title: m[0], description: m[1] } : null;
}

export const SUITE_META_KEYS = Object.keys(SUITE_META);
