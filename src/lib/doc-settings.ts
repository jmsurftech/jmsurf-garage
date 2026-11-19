// Print settings for business documents (Settings → Documents). Modelled on
// The template editor: a template per document type plus colours,
// font size, labels and show/hide switches. Stored per document kind in
// public.document_templates (one row per shop and kind); anything missing falls back to
// DEFAULT_DOC_SETTINGS, so old rows keep working when new options are added.

export type DocTemplateId = "standard" | "spreadsheet" | "minimalist" | "professional";
export type DocKindKey =
  | "quote" | "sales_order" | "invoice" | "receipt" | "payment" | "credit_note" | "delivery_note"
  | "po" | "bill" | "requisition" | "statement" | "purchase_receive" | "vendor_credit";

export const DOC_TEMPLATES: { id: DocTemplateId; name: string; description: string }[] = [
  { id: "standard", name: "Standard", description: "Logo and company details on the left, title and balance on the right, coloured item table." },
  { id: "spreadsheet", name: "Spreadsheet", description: "Boxed layout with ruled rows and columns — easy to read long item lists." },
  { id: "minimalist", name: "Minimalist", description: "Clean, light layout with thin rules and no filled blocks." },
  { id: "professional", name: "Professional", description: "Brand-coloured header band with the title, accented totals." },
];

export const DOC_KINDS: { key: DocKindKey; label: string; title: string }[] = [
  { key: "quote", label: "Quotations", title: "Quotation" },
  { key: "sales_order", label: "Sales Orders", title: "Sales Order" },
  { key: "invoice", label: "Invoices", title: "Invoice" },
  { key: "receipt", label: "Sales Receipts", title: "Sales Receipt" },
  { key: "payment", label: "Payment Receipts", title: "Payment Receipt" },
  { key: "credit_note", label: "Credit Notes", title: "Credit Note" },
  { key: "delivery_note", label: "Delivery Notes", title: "Delivery Note" },
  { key: "po", label: "Purchase Orders", title: "Purchase Order" },
  { key: "bill", label: "Bills", title: "Bill" },
  { key: "requisition", label: "Requisitions", title: "Requisition" },
  { key: "purchase_receive", label: "Purchase Receives", title: "Purchase Receive" },
  { key: "vendor_credit", label: "Vendor Credits", title: "Vendor Credit" },
  { key: "statement", label: "Customer Statements", title: "Statement" },
];

/** Organization / customer detail lines that can be shown, hidden and reordered. */
export type CompanyFieldKey = "address" | "postal" | "phone" | "email" | "website" | "kraPin" | "vatNumber" | "extra";
export type PartyFieldKey = "companyName" | "address" | "kraPin" | "email" | "phone" | "altPhone";
export type FieldToggle<K extends string> = { key: K; show: boolean };

export const COMPANY_FIELDS: { key: CompanyFieldKey; label: string; prefix?: string }[] = [
  { key: "address", label: "Location" },
  { key: "postal", label: "Postal address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "kraPin", label: "KRA PIN", prefix: "KRA PIN: " },
  { key: "vatNumber", label: "VAT number", prefix: "VAT No: " },
  { key: "extra", label: "Other line" },
];

/** One company detail as set in Business settings → Contact details for documents. */
export type DocContactRow = { key: CompanyFieldKey; show: boolean; value: string | null };
/** The saved list, in order, with every known detail present (new ones appended, off for "Other line"). */
export function docContactRows(saved: unknown): DocContactRow[] {
  const list = Array.isArray((saved as any)?.fields) ? (saved as any).fields : [];
  const known = new Set(COMPANY_FIELDS.map((f) => f.key));
  const out: DocContactRow[] = [];
  for (const f of list) {
    if (known.has(f?.key) && !out.some((x) => x.key === f.key)) out.push({ key: f.key, show: f.show !== false, value: typeof f.value === "string" ? f.value : null });
  }
  for (const f of COMPANY_FIELDS) if (!out.some((x) => x.key === f.key)) out.push({ key: f.key, show: f.key !== "extra", value: null });
  return out;
}
export const PARTY_FIELDS: { key: PartyFieldKey; label: string; prefix?: string }[] = [
  { key: "companyName", label: "Company name" },
  { key: "address", label: "Billing address" },
  { key: "kraPin", label: "KRA PIN", prefix: "PIN: " },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "altPhone", label: "Other phone" },
];

/** Keep only known keys, no duplicates, and append any field missing from a saved list. */
function normalizeFields<K extends string>(saved: unknown, all: { key: K }[]): FieldToggle<K>[] {
  const known = new Set(all.map((f) => f.key));
  const out: FieldToggle<K>[] = [];
  if (Array.isArray(saved)) {
    for (const f of saved) {
      const key = (f as any)?.key as K;
      if (known.has(key) && !out.some((x) => x.key === key)) out.push({ key, show: (f as any)?.show !== false });
    }
  }
  for (const f of all) if (!out.some((x) => x.key === f.key)) out.push({ key: f.key, show: true });
  return out;
}

/** Print lines for a set of detail values in the configured order (multi-line values split). */
export function orderedDetailLines<K extends string>(
  values: Partial<Record<K, string | null | undefined>>,
  order: FieldToggle<K>[],
  defs: { key: K; prefix?: string }[],
): string[] {
  const lines: string[] = [];
  for (const f of order) {
    if (!f.show) continue;
    const v = String(values[f.key] ?? "").trim();
    if (!v) continue;
    const prefix = defs.find((d) => d.key === f.key)?.prefix ?? "";
    for (const part of v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) lines.push(prefix && !part.startsWith(prefix.trim()) ? prefix + part : part);
  }
  return lines;
}

export type DocSettings = {
  template: DocTemplateId;
  paper: "A4" | "Letter";
  fontSize: "small" | "medium" | "large";
  colors: {
    accent: string;      // title, labels, ribbons-free highlights
    tableHeader: string; // item table header background
    tableHeaderText: string;
    text: string;        // body text
    label: string;       // muted labels
    balanceBg: string;   // Balance Due row background
  };
  header: {
    showLogo: boolean;
    logoSize: "small" | "medium" | "large";
    showCompanyName: boolean;
    showCompanyAddress: boolean;
    showTaxIds: boolean;
    showStatusRibbon: boolean;
    /** Organization lines under the name, in print order (each on its own line). */
    companyFields: FieldToggle<CompanyFieldKey>[];
  };
  details: {
    title: string; // blank = automatic (e.g. INVOICE, QUOTE)
    billToLabel: string;
    /** Customer / vendor lines under the name, in print order. */
    customerFields: FieldToggle<PartyFieldKey>[];
    showReference: boolean;
    showProject: boolean;
    showPaymentTerms: boolean;
    showDueDate: boolean;
  };
  table: {
    showLineNumber: boolean;
    showQuantity: boolean;
    showRate: boolean;
    showTax: boolean;
    /** Off for delivery notes, packing slips and sample notes: no prices at all. */
    showAmount: boolean;
    showDescription: boolean;
    stripedRows: boolean;
    itemLabel: string;
    qtyLabel: string;
    rateLabel: string;
    taxLabel: string;
    amountLabel: string;
  };
  totals: {
    showSubTotal: boolean;
    showTaxDetails: boolean;
    showAmountInWords: boolean;
    showPaymentMade: boolean;
    showBalanceDue: boolean;
  };
  other: {
    showNotes: boolean;
    notesLabel: string;
    showTerms: boolean;
    termsLabel: string;
    showBankDetails: boolean;
    showSignature: boolean;
    signatureLabel: string;
    showPageNumbers: boolean;
    footerText: string;
  };
};

/** JMSURF Garage brand: crimson and charcoal. */
export const BRAND_ORANGE = "#A8121B";
export const BRAND_TEAL = "#15171C";
/** Default table header: neutral charcoal, so documents are not red unless the company chooses a colour. */
export const DOC_CHARCOAL = "#3C3D3A";

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  template: "standard",
  paper: "A4",
  fontSize: "medium",
  colors: {
    accent: BRAND_TEAL,
    tableHeader: DOC_CHARCOAL,
    tableHeaderText: "#FDFBEE",
    text: "#222222",
    label: "#5F6368",
    balanceBg: "#F5F4F3",
  },
  header: {
    showLogo: true, logoSize: "medium", showCompanyName: true, showCompanyAddress: true, showTaxIds: true, showStatusRibbon: true,
    companyFields: COMPANY_FIELDS.map((f) => ({ key: f.key, show: true })),
  },
  details: {
    title: "", billToLabel: "Bill To", showReference: true, showProject: true, showPaymentTerms: true, showDueDate: true,
    customerFields: PARTY_FIELDS.map((f) => ({ key: f.key, show: true })),
  },
  table: {
    showLineNumber: true, showQuantity: true, showRate: true, showTax: true, showAmount: true, showDescription: true, stripedRows: false,
    itemLabel: "Item & Description", qtyLabel: "Qty", rateLabel: "Rate", taxLabel: "VAT", amountLabel: "Amount",
  },
  totals: { showSubTotal: true, showTaxDetails: true, showAmountInWords: false, showPaymentMade: true, showBalanceDue: true },
  other: {
    showNotes: true, notesLabel: "Notes", showTerms: true, termsLabel: "Terms & Conditions",
    showBankDetails: true, showSignature: false, signatureLabel: "Authorized Signature", showPageNumbers: false, footerText: "",
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge saved settings over the defaults (unknown keys ignored, wrong types dropped). */
export function resolveDocSettings(saved?: unknown, template?: string | null): DocSettings {
  const merge = (base: any, over: any): any => {
    if (!isObj(over)) return base;
    const out: any = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(base)) {
      const b = base[k], o = over[k];
      if (o === undefined || o === null) continue;
      if (isObj(b)) out[k] = merge(b, o);
      else if (typeof o === typeof b) out[k] = o;
    }
    return out;
  };
  const s = merge(DEFAULT_DOC_SETTINGS, saved) as DocSettings;
  const raw = isObj(saved) ? (saved as any) : {};
  s.header.companyFields = normalizeFields(raw.header?.companyFields, COMPANY_FIELDS);
  s.details.customerFields = normalizeFields(raw.details?.customerFields, PARTY_FIELDS);
  // older saved settings switched tax ids off as a block
  if (raw.header?.showTaxIds === false && !Array.isArray(raw.header?.companyFields)) {
    s.header.companyFields = s.header.companyFields.map((f) => (f.key === "kraPin" || f.key === "vatNumber" ? { ...f, show: false } : f));
  }
  if (template && DOC_TEMPLATES.some((t) => t.id === template)) s.template = template as DocTemplateId;
  return s;
}

/** "#C93D8B" → [0.79, 0.24, 0.55] (pdf-lib rgb). Bad input → fallback. */
export function hexToRgb01(hex: string, fallback: [number, number, number] = [0.2, 0.2, 0.2]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Base font size in PDF points / CSS px for the chosen size. */
export const FONT_SCALE: Record<DocSettings["fontSize"], number> = { small: 0.92, medium: 1.06, large: 1.2 };
export const LOGO_HEIGHT: Record<DocSettings["header"]["logoSize"], number> = { small: 44, medium: 62, large: 82 };

/** Map a DocumentKind used by the viewers to its settings row key. */
export const kindKey = (kind: string): DocKindKey => kind.replace(/-/g, "_") as DocKindKey;

/** Settings row key for a document title used by the builders ("Quote", "Credit Note" …). */
export function kindFromTitle(title: string | undefined): DocKindKey {
  const t = String(title ?? "Quote").toLowerCase();
  if (t.includes("credit")) return "credit_note";
  if (t.includes("purchase")) return "po";
  if (t === "bill") return "bill";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("payment")) return "payment";
  if (t.includes("receipt")) return "receipt";
  if (t.includes("delivery")) return "delivery_note";
  if (t.includes("requisition")) return "requisition";
  if (t.includes("statement")) return "statement";
  return "quote";
}

/** Mixes a hex colour with white (amount 0..1 of white). */
function tintHex(hex: string, white: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * white).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`.toUpperCase();
}

/** Where the colours were left at the JMSURF Garage defaults, use the company's own colour. */
export function withCompanyColor(s: DocSettings, hex?: string | null): DocSettings {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return s;
  const c = { ...s.colors };
  // The defaults (charcoal now, crimson before) follow the company colour; a colour picked in Settings → Documents stays.
  if ([DOC_CHARCOAL, BRAND_ORANGE].includes(String(c.tableHeader).toUpperCase())) c.tableHeader = hex.toUpperCase();
  if (String(c.accent).toUpperCase() === BRAND_TEAL) c.accent = hex.toUpperCase();
  if (String(c.balanceBg).toUpperCase() === "#FBEDE6") c.balanceBg = "#F5F4F3";
  return { ...s, colors: c };
}

/** Load the saved settings for one document kind with any Supabase client. */
export async function loadDocSettings(db: any, kind: DocKindKey, tenantId?: string | null): Promise<DocSettings> {
  let themeHex: string | null = null;
  try {
    let tq = db.from("business_settings_safe").select("theme");
    if (tenantId) tq = tq.eq("tenant_id", tenantId);
    const { data: biz } = await tq.limit(1).maybeSingle();
    const { companyThemeHex } = await import("@/lib/companyTheme");
    themeHex = companyThemeHex(biz?.theme);
  } catch { /* no company colour: brand defaults */ }
  try {
    let q = db.from("document_templates").select("template, settings").eq("kind", kind);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q.maybeSingle();
    return withCompanyColor(resolveDocSettings(data?.settings, data?.template), themeHex);
  } catch {
    return withCompanyColor(resolveDocSettings(null), themeHex);
  }
}
