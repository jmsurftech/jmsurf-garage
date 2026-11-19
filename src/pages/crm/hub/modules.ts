import { Building2, Contact, Handshake, Magnet, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const sb: any = supabase;

/**
 * The CRM's four record modules (leads, contacts, accounts, deals), described once: the list,
 * the board, the form and the record page are all drawn from these definitions.
 */
export type FieldType = "text" | "email" | "phone" | "url" | "number" | "money" | "percent" | "date" | "select" | "textarea" | "bool" | "owner" | "account" | "contact";
export type FieldDef = {
  key: string; label: string; type: FieldType; options?: string[]; section: string;
  required?: boolean; list?: boolean; readOnly?: boolean; full?: boolean;
};
export type RelatedType = "lead" | "contact" | "account" | "deal";
export type ModuleKey = "leads" | "contacts" | "accounts" | "deals";
export type ModuleDef = {
  key: ModuleKey; related: RelatedType; table: string; singular: string; plural: string; icon: LucideIcon; tone: string;
  fields: FieldDef[];
  /** Columns searched by the search box. */
  search: string[];
  /** Restricts the table to this module's rows. */
  scope?: (q: any) => any;
  title: (r: any) => string;
  subtitle: (r: any) => string;
  /** Board view: the field whose values are the columns. */
  board?: { field: string; columns: { value: string; label: string }[]; amount?: string };
  /** Values written on save besides the fields (e.g. a lead's display name). */
  derive?: (r: any) => Record<string, any>;
  sortDefault: { key: string; asc: boolean };
};

export const LEAD_SOURCES = ["Advertisement", "Cold call", "Referral", "Website", "Social media", "Trade show", "Partner", "Email campaign", "Walk-in", "Tender", "Other"];
export const LEAD_STATUSES = ["New", "Contacted", "Follow up later", "Qualified", "Not qualified", "Junk", "Lost", "Converted"];
export const RATINGS = ["Hot", "Warm", "Cold"];
export const INDUSTRIES = ["Healthcare & pharmacy", "Hospital / clinic", "Retail & wholesale", "Manufacturing", "Agriculture", "Construction", "Education", "Financial services", "Government", "Hospitality", "ICT & telecoms", "Logistics & transport", "NGO / non-profit", "Professional services", "Real estate", "Energy", "Other"];
export const ACCOUNT_TYPES = ["Customer", "Prospect", "Partner", "Reseller", "Distributor", "Supplier", "Competitor", "Investor", "Other"];
export const DEAL_TYPES = ["New business", "Existing business", "Renewal", "Tender"];
export const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."];

/** Deal stages (key, label, default probability). Won and lost close the deal. */
export const STAGES = [
  { key: "qualification", label: "Qualification", p: 10 },
  { key: "needs_analysis", label: "Needs analysis", p: 20 },
  { key: "value_proposition", label: "Value proposition", p: 40 },
  { key: "decision_makers", label: "Decision makers", p: 60 },
  { key: "proposal", label: "Proposal / quote", p: 75 },
  { key: "negotiation", label: "Negotiation", p: 90 },
  { key: "won", label: "Won", p: 100 },
  { key: "lost", label: "Lost", p: 0 },
];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label || k || "—";
export const isClosedStage = (k: string) => k === "won" || k === "lost";

const fullName = (r: any) => [r.salutation, r.first_name, r.last_name].filter(Boolean).join(" ").trim();

export const MODULES: Record<ModuleKey, ModuleDef> = {
  leads: {
    key: "leads", related: "lead", table: "crm_leads", singular: "Lead", plural: "Leads", icon: Magnet, tone: "#d97706",
    scope: (q) => q.eq("type", "lead"),
    search: ["name", "first_name", "last_name", "partner_name", "email", "phone", "mobile"],
    title: (r) => [r.first_name, r.last_name].filter(Boolean).join(" ") || r.contact_name || r.name || "Lead",
    subtitle: (r) => [r.title, r.partner_name].filter(Boolean).join(" · "),
    derive: (r) => {
      const person = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
      return { type: "lead", name: r.partner_name?.trim() || person || "Lead", contact_name: person || null };
    },
    board: { field: "lead_status", columns: LEAD_STATUSES.filter((s) => s !== "Converted").map((s) => ({ value: s, label: s })), amount: "expected_revenue" },
    sortDefault: { key: "created_at", asc: false },
    fields: [
      { key: "first_name", label: "First name", type: "text", section: "Lead information", list: true },
      { key: "last_name", label: "Last name", type: "text", section: "Lead information", required: true, list: true },
      { key: "partner_name", label: "Company", type: "text", section: "Lead information", list: true },
      { key: "title", label: "Job title", type: "text", section: "Lead information" },
      { key: "email", label: "Email", type: "email", section: "Lead information", list: true },
      { key: "phone", label: "Phone", type: "phone", section: "Lead information", list: true },
      { key: "mobile", label: "Mobile", type: "phone", section: "Lead information" },
      { key: "website", label: "Website", type: "url", section: "Lead information" },
      { key: "salesperson_id", label: "Lead owner", type: "owner", section: "Lead information", list: true },
      { key: "source", label: "Lead source", type: "select", options: LEAD_SOURCES, section: "Lead information", list: true },
      { key: "lead_status", label: "Lead status", type: "select", options: LEAD_STATUSES, section: "Lead information", list: true },
      { key: "rating", label: "Rating", type: "select", options: RATINGS, section: "Lead information" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES, section: "Company" },
      { key: "annual_revenue", label: "Annual revenue", type: "money", section: "Company" },
      { key: "employees", label: "Number of employees", type: "number", section: "Company" },
      { key: "expected_revenue", label: "Expected deal value", type: "money", section: "Company" },
      { key: "street", label: "Street", type: "text", section: "Address" },
      { key: "city", label: "City", type: "text", section: "Address", list: true },
      { key: "country", label: "Country", type: "text", section: "Address" },
      { key: "email_opt_out", label: "No marketing email", type: "bool", section: "Other" },
      { key: "description", label: "Description", type: "textarea", section: "Other", full: true },
      { key: "created_at", label: "Created", type: "date", section: "Other", readOnly: true, list: true },
    ],
  },
  contacts: {
    key: "contacts", related: "contact", table: "crm_contacts", singular: "Contact", plural: "Contacts", icon: Contact, tone: "#0891b2",
    search: ["first_name", "last_name", "email", "phone", "mobile", "title"],
    title: (r) => fullName(r) || "Contact",
    subtitle: (r) => [r.title, r._account_name].filter(Boolean).join(" · "),
    sortDefault: { key: "last_name", asc: true },
    fields: [
      { key: "salutation", label: "Salutation", type: "select", options: SALUTATIONS, section: "Contact information" },
      { key: "first_name", label: "First name", type: "text", section: "Contact information", list: true },
      { key: "last_name", label: "Last name", type: "text", section: "Contact information", required: true, list: true },
      { key: "account_id", label: "Account", type: "account", section: "Contact information", list: true },
      { key: "title", label: "Job title", type: "text", section: "Contact information", list: true },
      { key: "department", label: "Department", type: "text", section: "Contact information" },
      { key: "email", label: "Email", type: "email", section: "Contact information", list: true },
      { key: "secondary_email", label: "Other email", type: "email", section: "Contact information" },
      { key: "phone", label: "Phone", type: "phone", section: "Contact information", list: true },
      { key: "mobile", label: "Mobile", type: "phone", section: "Contact information" },
      { key: "owner_id", label: "Contact owner", type: "owner", section: "Contact information", list: true },
      { key: "lead_source", label: "Lead source", type: "select", options: LEAD_SOURCES, section: "Contact information" },
      { key: "date_of_birth", label: "Date of birth", type: "date", section: "Contact information" },
      { key: "assistant", label: "Assistant", type: "text", section: "Contact information" },
      { key: "mailing_street", label: "Street", type: "text", section: "Address" },
      { key: "mailing_city", label: "City", type: "text", section: "Address" },
      { key: "mailing_state", label: "County / state", type: "text", section: "Address" },
      { key: "mailing_country", label: "Country", type: "text", section: "Address" },
      { key: "mailing_code", label: "Postal code", type: "text", section: "Address" },
      { key: "email_opt_out", label: "No marketing email", type: "bool", section: "Other" },
      { key: "description", label: "Description", type: "textarea", section: "Other", full: true },
      { key: "created_at", label: "Created", type: "date", section: "Other", readOnly: true },
    ],
  },
  accounts: {
    key: "accounts", related: "account", table: "customers", singular: "Account", plural: "Accounts", icon: Building2, tone: "#4f46e5",
    search: ["name", "company_name", "email", "phone", "kra_pin"],
    title: (r) => r.name || "Account",
    subtitle: (r) => [r.account_type, r.industry].filter(Boolean).join(" · "),
    derive: (r) => ({ phone: r.phone ?? "" }),
    sortDefault: { key: "name", asc: true },
    fields: [
      { key: "name", label: "Account name", type: "text", section: "Account information", required: true, list: true },
      { key: "phone", label: "Phone", type: "phone", section: "Account information", list: true },
      { key: "alt_phone", label: "Other phone", type: "phone", section: "Account information" },
      { key: "email", label: "Email", type: "email", section: "Account information", list: true },
      { key: "website", label: "Website", type: "url", section: "Account information", list: true },
      { key: "salesperson_id", label: "Account owner", type: "owner", section: "Account information", list: true },
      { key: "account_type", label: "Account type", type: "select", options: ACCOUNT_TYPES, section: "Account information", list: true },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES, section: "Account information", list: true },
      { key: "annual_revenue", label: "Annual revenue", type: "money", section: "Account information" },
      { key: "employees", label: "Employees", type: "number", section: "Account information" },
      { key: "kra_pin", label: "KRA PIN", type: "text", section: "Account information" },
      { key: "address", label: "Address", type: "text", section: "Address", full: true },
      { key: "area", label: "County / area", type: "text", section: "Address" },
      { key: "building", label: "Building", type: "text", section: "Address" },
      { key: "description", label: "Description", type: "textarea", section: "Other", full: true },
      { key: "balance", label: "Balance due", type: "money", section: "Other", readOnly: true, list: true },
      { key: "created_at", label: "Created", type: "date", section: "Other", readOnly: true },
    ],
  },
  deals: {
    key: "deals", related: "deal", table: "crm_deals", singular: "Deal", plural: "Deals", icon: Handshake, tone: "#059669",
    search: ["name", "account_name", "contact_name", "deal_number"],
    title: (r) => r.name || "Deal",
    subtitle: (r) => [r.account_name, r.deal_number].filter(Boolean).join(" · "),
    derive: (r) => ({ probability: r.probability ?? STAGES.find((s) => s.key === r.stage)?.p ?? 10, closed_at: isClosedStage(r.stage) ? (r.closed_at || new Date().toISOString()) : null }),
    board: { field: "stage", columns: STAGES.map((s) => ({ value: s.key, label: s.label })), amount: "amount" },
    sortDefault: { key: "closing_date", asc: true },
    fields: [
      { key: "name", label: "Deal name", type: "text", section: "Deal information", required: true, list: true },
      { key: "customer_id", label: "Account", type: "account", section: "Deal information", list: true },
      { key: "contact_id", label: "Contact", type: "contact", section: "Deal information" },
      { key: "amount", label: "Amount", type: "money", section: "Deal information", list: true },
      { key: "stage", label: "Stage", type: "select", options: STAGES.map((s) => s.key), section: "Deal information", list: true },
      { key: "probability", label: "Probability (%)", type: "percent", section: "Deal information", list: true },
      { key: "closing_date", label: "Closing date", type: "date", section: "Deal information", list: true },
      { key: "owner_id", label: "Deal owner", type: "owner", section: "Deal information", list: true },
      { key: "deal_type", label: "Type", type: "select", options: DEAL_TYPES, section: "Deal information" },
      { key: "source", label: "Lead source", type: "select", options: LEAD_SOURCES, section: "Deal information" },
      { key: "campaign", label: "Campaign", type: "text", section: "Deal information" },
      { key: "next_step", label: "Next step", type: "text", section: "Deal information" },
      { key: "deal_number", label: "Deal number", type: "text", section: "Other", readOnly: true },
      { key: "description", label: "Description", type: "textarea", section: "Other", full: true },
      { key: "created_at", label: "Created", type: "date", section: "Other", readOnly: true },
    ],
  },
};

export const MODULE_OF: Record<RelatedType, ModuleDef> = { lead: MODULES.leads, contact: MODULES.contacts, account: MODULES.accounts, deal: MODULES.deals };
export const ownerKey = (m: ModuleDef) => m.fields.find((f) => f.type === "owner")?.key || "owner_id";
export const optionLabel = (f: FieldDef, v: string) => (f.key === "stage" ? stageLabel(v) : v);

/** Records of a module for this company (the whole module: CRM lists are filtered and paged on the device). */
export async function loadModule(m: ModuleDef, tenantId: string) {
  const out: any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = sb.from(m.table).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(from, from + 999);
    if (m.scope) q = m.scope(q);
    if (m.key === "leads") q = q.or("active.eq.true,converted_contact_id.not.is.null");
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
