// Maps JMSURF Garage records (quotations, invoices, POS sales, payments …) into
// the shared DocModel that lib/doc-pdf.ts draws as a PDF and
// components/print/doc-paper.tsx shows on screen. classic accounting layouts.
import { customPdfMeta } from "@/lib/customFields";
import { supabase } from "@/integrations/supabase/client";
import { buildDocPdf, type DocItem, type DocModel, type DocSignedBy, fmtDate } from "@/lib/doc-pdf";
import { loadDocSettings, type DocKindKey, docContactRows } from "@/lib/doc-settings";
import { currencyCode } from "@/lib/format";

const sb: any = supabase;
export type DocumentKind = DocKindKey;

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

/** A line as stored on quotes, invoices and sales (old and new shapes). */
export interface LineItem {
  item_id?: string | null;
  product_id?: string | null;
  type?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number;
  qty?: number;
  unit?: string | null;
  rate?: number;
  price?: number;
  unit_price?: number;
  discount?: number; // percent
  tax_rate?: number;
  vat_rate?: number;
  amount?: number;
  /** Batches sold / received on this line: [{batch, expiry, qty}]. */
  lots?: { batch?: string | null; expiry?: string | null; qty?: number }[] | null;
  /** Serial numbers sold / received on this line. */
  serials?: string[] | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

/** "Batch B1 · Exp 24/06/2029 · Qty 40" lines and the serial numbers of a line, for printing. */
export function traceText(l: LineItem): string {
  const lots = (Array.isArray(l.lots) && l.lots.length ? l.lots : l.batch_number ? [{ batch: l.batch_number, expiry: l.expiry_date, qty: undefined }] : [])
    .filter((x) => x && (x.batch || x.expiry));
  const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const out = lots.map((x) => [x.batch ? `Batch ${x.batch}` : "", x.expiry ? `Exp ${fmtDate(x.expiry)}` : "", lots.length > 1 && x.qty ? `Qty ${qtyFmt(num(x.qty))}` : ""].filter(Boolean).join(" · "));
  const serials = Array.isArray(l.serials) ? l.serials.filter(Boolean) : [];
  if (serials.length) out.push(`S/N: ${serials.join(", ")}`);
  return out.join("\n");
}

/** Puts the batches an invoice actually took (invoices.lots_applied) on its lines, in line order. */
export function withAppliedLots<T extends LineItem>(lines: T[], applied: unknown): T[] {
  const pool = (Array.isArray(applied) ? applied : []).map((x: any) => ({ pid: String(x.product_id || ""), batch: x.batch ?? null, expiry: x.expiry ?? null, qty: num(x.qty) }));
  if (!pool.length) return lines;
  return lines.map((l) => {
    const pid = String(l.item_id || l.product_id || "");
    let need = num(l.quantity ?? l.qty);
    if (!pid || need <= 0) return l;
    const got: { batch: string | null; expiry: string | null; qty: number }[] = [];
    for (const p of pool) {
      if (need <= 0) break;
      if (p.pid !== pid || p.qty <= 0) continue;
      const take = Math.min(need, p.qty);
      const same = got.find((g) => g.batch === p.batch && g.expiry === p.expiry);
      if (same) same.qty += take; else got.push({ batch: p.batch, expiry: p.expiry, qty: take });
      p.qty -= take; need -= take;
    }
    return got.some((g) => g.batch || g.expiry) ? { ...l, lots: got } : l;
  });
}

/** Line → document row. Amounts exclude VAT; VAT is shown per line and in the totals. */
export function lineToDocItem(l: LineItem): DocItem {
  const qty = num(l.quantity ?? l.qty ?? 1);
  const rate = num(l.rate ?? l.unit_price ?? l.price);
  const disc = Math.min(100, Math.max(0, num(l.discount)));
  const amount = l.amount !== undefined && l.rate === undefined && l.price === undefined ? num(l.amount) : qty * rate * (1 - disc / 100);
  return {
    name: str(l.name) || "Item",
    description: [str(l.description), traceText(l), disc ? `Discount ${disc}%` : ""].filter(Boolean).join("\n") || null,
    qty,
    unit_price: rate,
    tax_rate: num(l.tax_rate ?? 0),
    amount: Math.round(amount * 100) / 100,
    unit: str(l.unit) || null,
  };
}

/** Totals for a set of lines (VAT on top of each line). */
export function lineTotals(lines: LineItem[], extra: { adjustment?: number; shipping?: number; discount?: number } = {}) {
  const items = lines.map(lineToDocItem);
  const subtotal = items.reduce((a, i) => a + i.amount, 0);
  const tax = items.reduce((a, i) => a + (i.tax_rate > 0 ? (i.amount * i.tax_rate) / 100 : 0), 0);
  const total = subtotal + tax - num(extra.discount) + num(extra.shipping) + num(extra.adjustment);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { items, subtotal: r(subtotal), tax: r(tax), total: r(total) };
}

type Company = DocModel["company"];
let companyCache: { at: number; tenantId: string; company: Company; biz: any } | null = null;

async function logoBytes(url: string | null | undefined): Promise<Company["logo"]> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").includes("png") || /\.png($|\?)/i.test(url) ? "png" : "jpg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, type };
  } catch {
    return null;
  }
}

const signatureUrl_ = async (path: string | null | undefined, db: any = supabase) => (path ? (await db.storage.from("documents").createSignedUrl(path, 600)).data?.signedUrl || null : null);

/** "20260930122812", an ISO time or KRA's "30/09/2026 12:28:12" → "30/09/2026 12:28:12". */
const scuDate = (v: unknown) => {
  const s = str(v as any); if (!s) return "";
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s;
  const c = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (c) return `${c[3]}/${c[2]}/${c[1]} ${c[4]}:${c[5]}:${c[6]}`;
  const d = new Date(s); if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
/** KRA prints signatures and internal data in groups of four: G5AG-YN6Q-UZL3-KFOG. */
const groups4 = (v: unknown) => { const s = str(v as any); return !s || s.includes("-") ? s : (s.match(/.{1,4}/g) || []).join("-"); };

/** The official KRA logo (public/brand/kra-logo.png) when it is in the app; otherwise the documents draw a plain mark. */
let kraLogoCache: Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> | null = null;
const kraLogo = () => (kraLogoCache ??= (async () => {
  try {
    const r = await fetch("/brand/kra-logo.png", { cache: "force-cache" });
    if (!r.ok || !/image\/(png|jpe?g)/.test(r.headers.get("content-type") || "")) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), type: (r.headers.get("content-type") || "").includes("png") ? "png" : "jpg" };
  } catch { return null; }
})());

/** KRA eTIMS block for a signed invoice: the receipt QR code and the control unit details. */
export async function kraBlock(d: any): Promise<DocModel["kra"]> {
  if (d?.etims_status !== "signed") return null;
  const rows: [string, string][] = ([
    ["Date By SCU", scuDate(d.etims_signed_at)],
    ["Control Unit Number", str(d.etims_sdc_id)],
    ["Control Unit Invoice No.", d.etims_sdc_id && d.etims_invc_no ? `${d.etims_sdc_id} / ${d.etims_invc_no}` : str(d.etims_invc_no)],
    ["Internal Data", groups4(d.etims_internal_data)],
    ["Receipt Signature", groups4(d.etims_signature)],
  ] as [string, string][]).filter(([, v]) => v);
  let qr: { bytes: Uint8Array; type: "png" } | null = null; let qrDataUrl: string | null = null;
  if (d.etims_qr_url) {
    try {
      const QR = (await import("qrcode")).default;
      qrDataUrl = await QR.toDataURL(String(d.etims_qr_url), { margin: 1, width: 256, errorCorrectionLevel: "M" });
      const bin = atob(qrDataUrl.split(",")[1]); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      qr = { bytes, type: "png" };
    } catch { /* QR library unavailable: the details still print */ }
  }
  return { qr, qrDataUrl, url: d.etims_qr_url || null, rows, logo: await kraLogo() };
}

/** Sign & Stamp: the signer's name, title, signature and stamp when this document was signed. */
async function loadSignedBy(type: string, docId: string, db: any = sb): Promise<DocSignedBy | null> {
  const { data: req } = await db.from("signature_requests").select("signed_by,signed_by_name,signed_at").eq("doc_type", type).eq("doc_id", docId).eq("status", "signed").order("signed_at", { ascending: false }).limit(1).maybeSingle();
  if (!req?.signed_by) return null;
  const { data: us } = await db.from("user_signatures").select("full_name,title,signature_path,stamp_path").eq("user_id", req.signed_by).maybeSingle();
  const [signatureUrl, stampUrl] = await Promise.all([signatureUrl_(us?.signature_path, db), signatureUrl_(us?.stamp_path, db)]);
  const [signature, stamp] = await Promise.all([logoBytes(signatureUrl), logoBytes(stampUrl)]);
  return { name: us?.full_name || req.signed_by_name || "Authorised signatory", title: us?.title || null, at: req.signed_at, signature, stamp, signatureUrl, stampUrl };
}

/** The shop's own details for the document header (cached for a minute). */
export async function loadCompany(tenantId: string, db: any = sb): Promise<{ company: Company; biz: any }> {
  if (db === sb && companyCache && companyCache.tenantId === tenantId && Date.now() - companyCache.at < 60_000) return companyCache;
  const [{ data: biz }, { data: tenant }] = await Promise.all([
    db.from("business_settings_safe").select("*").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("business_name, logo_url").eq("id", tenantId).maybeSingle(),
  ]);
  const company: Company = {
    name: str(biz?.business_name) || str(tenant?.business_name) || "JMSURF Garage",
    lines: [],
    fields: {
      address: biz?.business_address || null,
      postal: biz?.postal_address || null,
      phone: biz?.business_phone || null,
      email: biz?.business_email || null,
      website: biz?.business_website || null,
      kraPin: biz?.tax_pin || null,
      vatNumber: biz?.vat_number || null,
    },
    kra_pin: biz?.tax_pin || null,
    vat_number: biz?.vat_number || null,
    fieldOrder: biz?.doc_contact ? docContactRows(biz.doc_contact).map((r) => ({ key: r.key, show: r.show })) : null,
    logoUrl: tenant?.logo_url || null,
    logo: await logoBytes(tenant?.logo_url),
  };
  // Values typed for documents replace the business profile's.
  if (biz?.doc_contact && company.fields) for (const r of docContactRows(biz.doc_contact)) if (r.value?.trim()) (company.fields as any)[r.key] = r.value.trim();
  const out = { at: Date.now(), tenantId, company, biz };
  if (db === sb) companyCache = out;
  return out;
}

/** How to pay this shop, shown on invoices and quotes. */
function paymentBlock(biz: any): { title: string; lines: string[] }[] {
  const lines: string[] = [];
  if (biz?.mpesa_till_number) lines.push(`M-Pesa Buy Goods Till: ${biz.mpesa_till_number}`);
  else if (biz?.mpesa_shortcode) lines.push(`M-Pesa Paybill: ${biz.mpesa_shortcode}${biz.mpesa_account_reference ? `  Account: ${biz.mpesa_account_reference}` : ""}`);
  for (const l of str(biz?.bank_details).split(/\r?\n/)) if (l.trim()) lines.push(l.trim());
  return lines.length ? [{ title: "Payment Details", lines }] : [];
}

async function customerParty(id: string | null | undefined, fallback: { name?: string | null; phone?: string | null; email?: string | null }, label = "Bill To", db: any = sb) {
  let c: any = null;
  if (id) ({ data: c } = await db.from("customers").select("name, phone, alt_phone, email, address, area, building, company_name, kra_pin").eq("id", id).maybeSingle());
  const address = [c?.address, c?.building, c?.area].map(str).filter(Boolean).join(", ");
  return {
    label,
    name: str(c?.name) || str(fallback.name) || "Walk-in customer",
    lines: [],
    fields: { companyName: str(c?.company_name) && str(c?.company_name) !== str(c?.name) ? str(c?.company_name) : null, address: address || null, phone: str(c?.phone) || str(fallback.phone) || null, altPhone: str(c?.alt_phone) || null, email: str(c?.email) || str(fallback.email) || null, kraPin: str(c?.kra_pin) || null },
  };
}

const STATUS_LABEL: Record<string, string> = { partially_paid: "partial" };

/** Where loadDocModel reads from, when not the signed-in staff database (the customer portal). */
export type DocSource = { db: any; currency?: string };

/**
 * A read-only stand-in for the database built from rows the server already checked (customer portal:
 * portal.js docData). Supports the calls the document loaders make: from().select().eq()…maybeSingle(),
 * awaited lists, and storage signed links handed over by the server.
 */
export function memoryDocClient(tables: Record<string, any[]>, signed: Record<string, string | null> = {}) {
  const query = (all: any[]) => {
    let rows = all.slice();
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, gte: () => q, lte: () => q,
      // A filter on a column the row does not carry is ignored (the server already filtered it).
      eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === undefined || String(r[k]) === String(v)); return q; },
      in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => r[k] === undefined || vs.map(String).includes(String(r[k]))); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => (rows[0] ? { data: rows[0], error: null } : { data: null, error: new Error("Not found") }),
      then: (ok: (v: any) => any, bad?: (e: any) => any) => Promise.resolve({ data: rows, error: null }).then(ok, bad),
    };
    return q;
  };
  return {
    from: (table: string) => query(tables[table] || []),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: signed[path] || null }, error: null }) }) },
  };
}

/** Loads one document and returns its model and a file name. */
export async function loadDocModel(kind: DocumentKind, id: string, src?: DocSource): Promise<{ model: DocModel; filename: string }> {
  // src: the customer portal hands over the rows it was allowed to read (memoryDocClient); staff read live.
  const db: any = src?.db || sb;
  const ccy = src?.currency || currencyCode() || "KES";
  if (kind === "quote" || kind === "invoice" || kind === "sales_order") {
    const table = kind === "invoice" ? "invoices" : kind === "sales_order" ? "sales_orders" : "quotes";
    const { data: d, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
    if (error || !d) throw new Error(`That ${kind === "quote" ? "quotation" : kind === "sales_order" ? "sales order" : "invoice"} was not found`);
    const { company, biz } = await loadCompany(d.tenant_id, db);
    const settings = await loadDocSettings(db, kind, d.tenant_id);
    const lines: LineItem[] = withAppliedLots(Array.isArray(d.items) ? d.items : [], d.lots_applied);
    const t = lineTotals(lines, { discount: d.discount, adjustment: d.adjustment, shipping: d.shipping });
    const extra: { label: string; value: string }[] = [];
    if (num(d.discount)) extra.push({ label: "Discount", value: `(-) ${ccy} ${num(d.discount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    if (num(d.shipping)) extra.push({ label: "Shipping", value: `${ccy} ${num(d.shipping).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    if (num(d.adjustment)) extra.push({ label: "Adjustment", value: `${ccy} ${num(d.adjustment).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    const total = num(d.total) || t.total;
    const meta = kind !== "invoice"
      ? [
          { label: kind === "sales_order" ? "Order Date" : "Quote Date", value: fmtDate(d.issue_date || d.created_at) },
          ...(kind === "sales_order" && d.expected_shipment_date ? [{ label: "Expected Shipment", value: fmtDate(d.expected_shipment_date) }] : []),
          ...(kind === "quote" && d.valid_until ? [{ label: "Expiry Date", value: fmtDate(d.valid_until) }] : []),
          ...(d.reference ? [{ label: "Reference#", value: d.reference }] : []),
          ...(d.salesperson_name ? [{ label: "Salesperson", value: d.salesperson_name }] : []),
        ]
      : [
          { label: "Invoice Date", value: fmtDate(d.issue_date || d.created_at) },
          ...(d.payment_terms ? [{ label: "Terms", value: d.payment_terms }] : []),
          ...(d.due_date ? [{ label: "Due Date", value: fmtDate(d.due_date) }] : []),
          ...(d.reference ? [{ label: "Reference#", value: d.reference }] : []),
          ...(d.salesperson_name ? [{ label: "Salesperson", value: d.salesperson_name }] : []),
        ];
    const number = kind === "invoice" ? d.invoice_number : d.quote_number;
    meta.push(...await customPdfMeta(d.tenant_id, kind === "invoice" ? "invoice" : kind === "sales_order" ? "sales_order" : "quote", d.custom, db));
    const model: DocModel = {
      title: kind === "quote" ? "Quotation" : kind === "sales_order" ? "Sales Order" : "Invoice",
      number,
      status: STATUS_LABEL[d.status] || d.status,
      company,
      party: await customerParty(d.customer_id, { name: d.customer_name, phone: d.customer_phone, email: d.customer_email }, "Bill To", db),
      meta,
      currency: ccy,
      items: t.items,
      totals: { subtotal: d.prices_include_tax ? num(d.subtotal) || t.subtotal : t.subtotal, tax: num(d.tax) || t.tax, total, paid: kind === "invoice" ? num(d.amount_paid) : null, extra, inclusive: !!d.prices_include_tax },
      highlight: kind === "invoice" ? { label: "Balance Due", value: total - num(d.amount_paid) } : null,
      intro: d.subject || null,
      sections: [
        { title: "Notes", text: str(d.customer_notes) || str(d.notes) },
        { title: "Terms & Conditions", text: str(d.terms) },
      ],
      payment: paymentBlock(biz),
      signedBy: await loadSignedBy(kind, d.id, db),
      kra: kind === "invoice" ? await kraBlock(d) : null,
      settings,
    };
    return { model, filename: `${number || kind}.pdf` };
  }

  if (kind === "credit_note") {
    // Same layout as the invoice (as in Zoho Books): Credit Date / Invoice# / Invoice Date, item table,
    // totals and "Credits Remaining", plus the KRA eTIMS block once it is signed.
    const { data: d, error } = await db.from("credit_notes").select("*").eq("id", id).maybeSingle();
    if (error || !d) throw new Error("That credit note was not found");
    const { company } = await loadCompany(d.tenant_id, db);
    const settings = await loadDocSettings(db, "credit_note", d.tenant_id);
    const lines: LineItem[] = Array.isArray(d.items) ? d.items : [];
    const t = lineTotals(lines, { discount: d.discount, adjustment: d.adjustment });
    const extra: { label: string; value: string }[] = [];
    if (num(d.discount)) extra.push({ label: "Discount", value: `(-) ${ccy} ${num(d.discount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    if (num(d.adjustment)) extra.push({ label: "Adjustment", value: `${ccy} ${num(d.adjustment).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    const total = num(d.total) || t.total;
    const { data: inv } = d.invoice_id
      ? await db.from("invoices").select("invoice_number,issue_date,etims_sdc_id,etims_invc_no").eq("id", d.invoice_id).maybeSingle()
      : { data: null as any };
    const meta = [
      { label: "Credit Date", value: fmtDate(d.issue_date || d.created_at) },
      ...(inv?.invoice_number ? [{ label: "Invoice#", value: inv.invoice_number }] : []),
      ...(inv?.issue_date ? [{ label: "Invoice Date", value: fmtDate(inv.issue_date) }] : []),
      ...(inv?.etims_sdc_id && inv?.etims_invc_no ? [{ label: "Original CU Invoice No.", value: `${inv.etims_sdc_id} / ${inv.etims_invc_no}` }] : []),
      ...(d.reason ? [{ label: "Reason", value: str(d.reason) }] : []),
      ...(d.reference ? [{ label: "Reference#", value: d.reference }] : []),
    ];
    const model: DocModel = {
      title: "Credit Note",
      number: d.credit_note_number,
      status: STATUS_LABEL[d.status] || d.status,
      company,
      party: await customerParty(d.customer_id, { name: d.customer_name, email: d.customer_email }, "Bill To", db),
      meta,
      currency: ccy,
      items: t.items,
      totals: { subtotal: d.prices_include_tax ? num(d.subtotal) || t.subtotal : t.subtotal, tax: num(d.tax) || t.tax, total, paid: null, extra, inclusive: !!d.prices_include_tax },
      highlight: { label: "Credits Remaining", value: Math.max(0, total - num(d.amount_applied) - num(d.amount_refunded)) },
      intro: null,
      sections: [{ title: "Notes", text: str(d.notes) }],
      payment: [],
      signedBy: await loadSignedBy("credit_note", d.id, db),
      kra: await kraBlock(d),
      settings,
    };
    return { model, filename: `${d.credit_note_number || "credit-note"}.pdf` };
  }

  if ((kind as string) === "delivery_note" || (kind as string) === "packing_list") {
    // Built from an invoice: what is being delivered / packed, without prices.
    const packing = (kind as string) === "packing_list";
    const { data: d, error } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
    if (error || !d) throw new Error("That invoice was not found");
    const { company } = await loadCompany(d.tenant_id);
    const settings = await loadDocSettings(sb, "delivery_note", d.tenant_id);
    const lines: LineItem[] = Array.isArray(d.items) ? d.items : [];
    // Batches the invoice took out of stock (earliest expiry first), with their expiry dates.
    const { data: moves } = await sb.from("stock_adjustments").select("product_id,batch_number").eq("ref_type", "invoice").eq("ref_id", d.id).not("batch_number", "is", null);
    const batchKeys = ((moves || []) as any[]);
    const { data: lots } = batchKeys.length
      ? await sb.from("product_batches").select("product_id,batch_number,expiry_date").in("product_id", [...new Set(batchKeys.map((m) => m.product_id))]).in("batch_number", [...new Set(batchKeys.map((m) => m.batch_number))])
      : { data: [] };
    const lotText = (pid: string) => [...new Set(batchKeys.filter((m) => m.product_id === pid).map((m) => m.batch_number))]
      .map((b) => { const e = ((lots || []) as any[]).find((x) => x.product_id === pid && x.batch_number === b)?.expiry_date; return `Batch ${b}${e ? ` · Expiry ${fmtDate(e)}` : ""}`; }).join("; ");
    const traced = withAppliedLots(lines, d.lots_applied);
    const items = traced.map((l: any) => {
      const lot = traceText(l) || lotText(l.item_id || l.product_id || "");
      return { name: str(l.name), description: [str(l.description), lot].filter(Boolean).join("\n"), qty: num(l.quantity ?? l.qty ?? 1), unit_price: 0, tax_rate: 0, amount: 0, unit: l.unit };
    });
    const count = items.reduce((a, i) => a + num(i.qty), 0);
    const number = `${packing ? "PL" : "DN"}-${String(d.invoice_number || "").replace(/^INV-/, "")}`;
    const model: DocModel = {
      title: packing ? "Packing List" : "Delivery Note",
      number,
      status: null,
      company,
      party: await customerParty(d.customer_id, { name: d.customer_name, phone: d.customer_phone, email: d.customer_email }, packing ? "Pack for" : "Deliver To"),
      meta: [
        { label: "Invoice#", value: d.invoice_number },
        { label: packing ? "Packing Date" : "Delivery Date", value: fmtDate(new Date().toISOString()) },
        { label: "Items", value: String(count) },
        ...(d.reference ? [{ label: "Reference#", value: d.reference }] : []),
      ],
      currency: ccy,
      items: items as any,
      totals: { subtotal: 0, tax: 0, total: 0 },
      intro: packing ? "Check each item and quantity before packing." : "Please check the goods on delivery and sign below.",
      sections: [{ title: "Notes", text: str(d.customer_notes) }],
      signatures: packing ? ["Packed by", "Checked by"] : ["Delivered by", "Received by (name, signature, date)"],
      // A delivery note from a signed invoice carries the invoice's signature and stamp.
      signedBy: packing ? null : await loadSignedBy("invoice", d.id),
      settings: { ...settings, table: { ...settings.table, showRate: false, showTax: false, showAmount: false } as any, totals: { ...settings.totals, showSubTotal: false, showTaxDetails: false, showAmountInWords: false, showBalanceDue: false, showPaymentMade: false }, other: { ...settings.other, showBankDetails: false } },
    };
    return { model, filename: `${number}.pdf` };
  }

  if (kind === "receipt") {
    const { data: tx, error } = await sb.from("transactions").select("*").eq("id", id).maybeSingle();
    if (error || !tx) throw new Error("That sale was not found");
    const { company, biz } = await loadCompany(tx.tenant_id);
    const settings = await loadDocSettings(sb, "receipt", tx.tenant_id);
    const lines: LineItem[] = (Array.isArray(tx.items) ? tx.items : []).map((i: any) => ({
      name: i.name, quantity: i.quantity ?? i.qty, rate: num(i.price ?? i.unit_price), tax_rate: 0,
    }));
    const t = lineTotals(lines);
    const method = str(tx.payment_method).replace(/_/g, " ");
    const model: DocModel = {
      title: "Sales Receipt",
      number: `SR-${String(tx.id).slice(0, 8).toUpperCase()}`,
      status: tx.status === "completed" ? "paid" : tx.status,
      company,
      party: await customerParty(tx.customer_id, { name: tx.customer_name }, "Customer"),
      meta: [
        { label: "Receipt Date", value: fmtDate(tx.created_at) },
        { label: "Payment Mode", value: method ? method[0].toUpperCase() + method.slice(1) : "—" },
        ...(tx.mpesa_ref ? [{ label: "Reference#", value: String(tx.mpesa_ref).replace(/^jmsurf:/, "") }] : []),
        ...(tx.cashier_name ? [{ label: "Served by", value: tx.cashier_name }] : []),
      ],
      currency: ccy,
      items: t.items,
      totals: {
        subtotal: num(tx.subtotal) || t.subtotal, tax: num(tx.tax), total: num(tx.total),
        paid: tx.status === "completed" ? num(tx.total) : null,
        extra: num(tx.discount) ? [{ label: "Discount", value: `(-) ${ccy} ${num(tx.discount).toFixed(2)}` }] : [],
      },
      sections: [{ title: "Notes", text: str(biz?.receipt_footer) }, { title: "Terms & Conditions", text: str(biz?.receipt_terms) }],
      settings,
    };
    return { model, filename: `${model.number}.pdf` };
  }

  if (kind === "payment") {
    const { data: p, error } = await db.from("payments_received").select("*, payment_allocations(amount, invoices(invoice_number, issue_date, total))").eq("id", id).maybeSingle();
    if (error || !p) throw new Error("That payment was not found");
    const { company } = await loadCompany(p.tenant_id, db);
    const settings = await loadDocSettings(db, "payment", p.tenant_id);
    const allocs = (p.payment_allocations || []) as any[];
    const items: DocItem[] = allocs.map((a) => ({
      name: a.invoices?.invoice_number || "Invoice",
      description: a.invoices?.issue_date ? `Invoice date ${fmtDate(a.invoices.issue_date)} · Invoice amount ${ccy} ${num(a.invoices.total).toFixed(2)}` : null,
      qty: 1, unit_price: num(a.amount), tax_rate: 0, amount: num(a.amount),
    }));
    const applied = allocs.reduce((s, a) => s + num(a.amount), 0);
    if (num(p.amount) - applied > 0.005) items.push({ name: "Unapplied credit", description: "Held on the customer's account", qty: 1, unit_price: num(p.amount) - applied, tax_rate: 0, amount: num(p.amount) - applied });
    const model: DocModel = {
      title: "Payment Receipt",
      number: p.payment_number,
      status: "paid",
      company,
      party: await customerParty(p.customer_id, { name: p.customer_name }, "Received From", db),
      meta: [
        { label: "Payment Date", value: fmtDate(p.payment_date) },
        { label: "Payment Mode", value: str(p.method).replace(/_/g, " ") },
        ...(p.reference ? [{ label: "Reference#", value: p.reference }] : []),
      ],
      currency: ccy,
      items,
      totals: { subtotal: num(p.amount), tax: 0, total: num(p.amount) },
      highlight: { label: "Amount Received", value: num(p.amount) },
      sections: [{ title: "Notes", text: str(p.notes) }],
      settings: { ...settings, table: { ...settings.table, showQuantity: false, showRate: false, showTax: false, itemLabel: "Invoice", amountLabel: "Payment" }, totals: { ...settings.totals, showTaxDetails: false } },
    };
    return { model, filename: `${p.payment_number || "payment"}.pdf` };
  }

  if (kind === "requisition") {
    const { data: r, error } = await sb.from("requisitions").select("*, requisition_items(*)").eq("id", id).maybeSingle();
    if (error || !r) throw new Error("That requisition was not found");
    const { company } = await loadCompany(r.tenant_id);
    const settings = await loadDocSettings(sb, "requisition", r.tenant_id);
    let sup: any = null;
    if (r.supplier_id) ({ data: sup } = await sb.from("suppliers").select("name, phone, email, address").eq("id", r.supplier_id).maybeSingle());
    const lines = ((r.requisition_items || []) as any[]).sort((a, b) => a.sort - b.sort).filter((l) => Number(l.qty_approved ?? l.qty_requested) > 0);
    const items: DocItem[] = lines.map((l) => {
      const q = Number(l.qty_approved ?? l.qty_requested);
      return { name: l.name, description: [l.unit ? `Unit: ${l.unit}` : "", l.notes || ""].filter(Boolean).join("\n") || null, qty: q, unit_price: num(l.est_unit_cost), tax_rate: 0, amount: q * num(l.est_unit_cost) };
    });
    const total = items.reduce((a, i) => a + i.amount, 0);
    const model: DocModel = {
      title: "Requisition",
      number: r.number,
      status: r.status === "pending_approval" ? "pending" : r.status,
      company,
      party: { label: "Supplier", name: sup?.name || r.supplier_name || "Supplier", lines: [], fields: { address: sup?.address || null, phone: sup?.phone || null, email: sup?.email || null, kraPin: null } },
      meta: [
        { label: "Date", value: fmtDate(r.created_at) },
        ...(r.needed_by ? [{ label: "Needed By", value: fmtDate(r.needed_by) }] : []),
        { label: "Requested By", value: r.requested_by_name || "—" },
        ...(r.approved_by_name ? [{ label: "Approved By", value: r.approved_by_name }] : []),
      ],
      currency: ccy,
      items,
      totals: { subtotal: total, tax: 0, total },
      intro: "Please supply the following items. Kindly confirm availability, price and delivery date.",
      sections: [{ title: "Notes", text: [str(r.notes), str(r.manager_notes)].filter(Boolean).join("\n") }],
      signatures: ["Requested by", "Approved by"],
      settings: { ...settings, table: { ...settings.table, showTax: false, rateLabel: "Est. Cost" }, totals: { ...settings.totals, showTaxDetails: false, showAmountInWords: false } },
    };
    return { model, filename: `${r.number || "requisition"}.pdf` };
  }

  if (kind === "po" || kind === "bill" || kind === "purchase_receive" || kind === "vendor_credit") return purchaseDoc(kind, id, ccy);

  if (kind === "statement") {
    // id = "<customerId>|<from>|<to>"
    const [customerId, from, to] = id.split("|");
    const { data: c } = await sb.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (!c) throw new Error("That customer was not found");
    const { company, biz } = await loadCompany(c.tenant_id);
    const settings = await loadDocSettings(sb, "statement", c.tenant_id);
    const [inv, pay] = await Promise.all([
      sb.from("invoices").select("invoice_number, issue_date, due_date, total, status").eq("customer_id", customerId).not("status", "in", "(draft,void)"),
      sb.from("payments_received").select("payment_number, payment_date, amount, method, reference").eq("customer_id", customerId),
    ]);
    type L = { date: string; name: string; detail: string; debit: number; credit: number };
    const all: L[] = [
      ...((inv.data || []) as any[]).map((i) => ({ date: i.issue_date, name: `Invoice ${i.invoice_number}`, detail: i.due_date ? `Due ${fmtDate(i.due_date)}` : "", debit: num(i.total), credit: 0 })),
      ...((pay.data || []) as any[]).map((p) => ({ date: p.payment_date, name: `Payment ${p.payment_number}`, detail: `${str(p.method).replace(/_/g, " ")}${p.reference ? ` · ${p.reference}` : ""}`, debit: 0, credit: num(p.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const opening = all.filter((l) => l.date < from).reduce((s, l) => s + l.debit - l.credit, 0);
    const period = all.filter((l) => l.date >= from && l.date <= to);
    let running = opening;
    const items: DocItem[] = period.map((l) => {
      running += l.debit - l.credit;
      return {
        name: `${fmtDate(l.date)}  ·  ${l.name}`,
        description: [l.detail, `Balance ${ccy} ${running.toLocaleString("en-US", { minimumFractionDigits: 2 })}`].filter(Boolean).join("\n"),
        qty: 1, unit_price: l.debit || -l.credit, tax_rate: 0, amount: l.debit || -l.credit,
      };
    });
    const invoiced = period.reduce((s, l) => s + l.debit, 0);
    const paid = period.reduce((s, l) => s + l.credit, 0);
    const closing = opening + invoiced - paid;
    const model: DocModel = {
      title: "Statement of Accounts",
      number: `${fmtDate(from)} to ${fmtDate(to)}`,
      status: null,
      company,
      party: await customerParty(customerId, { name: c.name }, "To"),
      meta: [{ label: "Opening Balance", value: `${ccy} ${opening.toFixed(2)}` }, { label: "Invoiced Amount", value: `${ccy} ${invoiced.toFixed(2)}` }, { label: "Amount Paid", value: `${ccy} ${paid.toFixed(2)}` }],
      currency: ccy,
      items,
      totals: { subtotal: invoiced - paid, tax: 0, total: closing, extra: [{ label: "Opening Balance", value: `${ccy} ${opening.toFixed(2)}` }] },
      highlight: { label: "Balance Due", value: closing },
      sections: [{ title: "Notes", text: "Please contact us if any entry on this statement is not correct." }],
      payment: paymentBlock(biz),
      settings: { ...settings, table: { ...settings.table, showQuantity: false, showRate: false, showTax: false, itemLabel: "Date · Transaction", amountLabel: "Amount" }, totals: { ...settings.totals, showTaxDetails: false, showSubTotal: false, showAmountInWords: false } },
    };
    return { model, filename: `Statement-${str(c.name).replace(/\s+/g, "-")}-${to}.pdf` };
  }

  throw new Error("This document type is not available yet");
}

/** Builds the PDF and saves it. */
export async function downloadDocumentPdf(kind: DocumentKind, id: string, src?: DocSource) {
  const { model, filename } = await loadDocModel(kind, id, src);
  const bytes = await buildDocPdf(model);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** The supplier block on purchase documents. */
async function supplierParty(supplierId: string | null, fallbackName: string | null, label = "Vendor Address") {
  let sup: any = null;
  if (supplierId) ({ data: sup } = await sb.from("suppliers").select("name, contact_person, phone, email, address, kra_pin").eq("id", supplierId).maybeSingle());
  return {
    label,
    name: sup?.name || fallbackName || "Supplier",
    lines: sup?.contact_person ? [`Attn: ${sup.contact_person}`] : [],
    fields: { address: sup?.address || null, phone: sup?.phone || null, email: sup?.email || null, kraPin: sup?.kra_pin || null },
  };
}

const money2 = (n: number, ccy: string) => `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Purchase order, bill, purchase receive (goods received note) and vendor credit. */
async function purchaseDoc(kind: "po" | "bill" | "purchase_receive" | "vendor_credit", id: string, ccy: string): Promise<{ model: DocModel; filename: string }> {
  if (kind === "po") {
    const { data: p, error } = await sb.from("purchases").select("*, purchase_items(*, products(name, sku, unit)), locations(name, street, building, city)").eq("id", id).maybeSingle();
    if (error || !p) throw new Error("That purchase order was not found");
    const { company } = await loadCompany(p.tenant_id);
    const settings = await loadDocSettings(sb, "po", p.tenant_id);
    const items: DocItem[] = ((p.purchase_items || []) as any[]).map((i) => ({
      name: i.products?.name || "Item", description: [i.products?.sku ? `SKU: ${i.products.sku}` : "", i.products?.unit ? `Unit: ${i.products.unit}` : ""].filter(Boolean).join(" · ") || null,
      qty: num(i.quantity), unit_price: num(i.unit_cost), tax_rate: 0, amount: num(i.total) || num(i.quantity) * num(i.unit_cost),
    }));
    const total = items.reduce((a, i) => a + i.amount, 0);
    const loc = p.locations;
    const model: DocModel = {
      title: "Purchase Order", number: p.po_number, status: STATUS_LABEL[p.status] || p.status, company,
      party: await supplierParty(p.supplier_id, p.supplier_name),
      meta: [
        { label: "Order Date", value: fmtDate(p.order_date || p.created_at) },
        ...(p.expected_date ? [{ label: "Expected Delivery", value: fmtDate(p.expected_date) }] : []),
        ...(p.reference ? [{ label: "Reference#", value: p.reference }] : []),
        ...(loc ? [{ label: "Deliver To", value: [loc.name, loc.building, loc.street, loc.city].filter(Boolean).join(", ") }] : []),
        ...await customPdfMeta(p.tenant_id, "purchase_order", p.custom),
      ],
      currency: ccy, items, totals: { subtotal: total, tax: 0, total },
      intro: "Please supply the items below and send your invoice quoting this order number.",
      sections: [{ title: "Notes", text: str(p.notes) }, { title: "Terms & Conditions", text: str(p.terms) }],
      signatures: ["Authorised signature"],
      signedBy: await loadSignedBy("purchase_order", p.id),
      settings: { ...settings, table: { ...settings.table, showTax: false }, totals: { ...settings.totals, showTaxDetails: false } },
    };
    return { model, filename: `${p.po_number || "purchase-order"}.pdf` };
  }

  if (kind === "bill") {
    const { data: b, error } = await sb.from("bills").select("*, purchases(po_number)").eq("id", id).maybeSingle();
    if (error || !b) throw new Error("That bill was not found");
    const { company } = await loadCompany(b.tenant_id);
    const settings = await loadDocSettings(sb, "bill", b.tenant_id);
    const lines: any[] = Array.isArray(b.items) ? b.items : [];
    const items: DocItem[] = lines.length ? lines.map((l) => ({ name: str(l.name) || "Item", description: str(l.description) || null, qty: num(l.quantity ?? 1), unit_price: num(l.rate ?? l.unit_cost), tax_rate: num(l.tax_rate), amount: num(l.amount) || num(l.quantity ?? 1) * num(l.rate ?? l.unit_cost) }))
      : [{ name: str(b.name) || "Bill", description: str(b.category) || null, qty: 1, unit_price: num(b.amount), tax_rate: 0, amount: num(b.amount) }];
    const subtotal = num(b.subtotal) || items.reduce((a, i) => a + i.amount, 0);
    const model: DocModel = {
      title: "Bill", number: b.bill_number || b.name, status: STATUS_LABEL[b.status] || b.status, company,
      party: await supplierParty(b.supplier_id, null, "Bill From"),
      meta: [
        { label: "Bill Date", value: fmtDate(b.bill_date || b.created_at) },
        ...(b.due_date ? [{ label: "Due Date", value: fmtDate(b.due_date) }] : []),
        ...(b.payment_terms ? [{ label: "Terms", value: b.payment_terms }] : []),
        ...(b.reference ? [{ label: "Vendor Invoice#", value: b.reference }] : []),
        ...(b.purchases?.po_number ? [{ label: "Order Number", value: b.purchases.po_number }] : []),
        ...await customPdfMeta(b.tenant_id, "bill", b.custom),
      ],
      currency: ccy, items, totals: { subtotal, tax: num(b.tax), total: num(b.amount), paid: num(b.amount_paid) },
      highlight: { label: "Balance Due", value: num(b.amount) - num(b.amount_paid) },
      sections: [{ title: "Notes", text: str(b.notes) }],
      signedBy: await loadSignedBy("bill", b.id),
      settings,
    };
    return { model, filename: `${b.bill_number || "bill"}.pdf` };
  }

  if (kind === "purchase_receive") {
    const { data: r, error } = await sb.from("purchase_receives").select("*, purchases(po_number, order_date, location_id)").eq("id", id).maybeSingle();
    if (error || !r) throw new Error("That purchase receive was not found");
    const { company } = await loadCompany(r.tenant_id);
    const settings = await loadDocSettings(sb, "purchase_receive", r.tenant_id);
    const got = ((r.items || []) as any[]).map((i) => ({ name: str(i.name) || "Item", description: [`Ordered ${num(i.ordered)} · received now ${num(i.quantity)}`, traceText(i)].filter(Boolean).join("\n"), qty: num(i.quantity), unit_price: 0, tax_rate: 0, amount: 0 }));
    const short = ((r.shortfall || []) as any[]);
    const shortText = short.map((x) => `• ${x.name}: ${num(x.quantity)} ${x.action === "later" ? "to be delivered later" : x.action === "damaged" ? "damaged / rejected" : "not available"}${x.reason ? ` (${x.reason})` : ""}`).join("\n");
    const model: DocModel = {
      title: "Purchase Receive", number: r.receive_number, status: short.length ? "Partially received" : "Received", company,
      party: await supplierParty(r.supplier_id, r.supplier_name, "Vendor"),
      meta: [
        { label: "Receive Date", value: fmtDate(r.received_date || r.created_at) },
        ...(r.purchases?.po_number ? [{ label: "Purchase Order#", value: r.purchases.po_number }] : []),
        { label: "Received By", value: r.created_by_name || "—" },
        ...(r.expected_rest_on ? [{ label: "Balance Expected", value: fmtDate(r.expected_rest_on) }] : []),
      ],
      currency: ccy, items: got as any, totals: { subtotal: 0, tax: 0, total: 0 },
      intro: "Goods received against the purchase order.",
      sections: [{ title: "Not delivered", text: shortText }, { title: "Notes", text: str(r.notes) }],
      signatures: ["Delivered by", "Received by (name, signature, date)"],
      settings: { ...settings, table: { ...settings.table, showRate: false, showTax: false, showAmount: false } as any, totals: { ...settings.totals, showSubTotal: false, showTaxDetails: false, showAmountInWords: false, showBalanceDue: false, showPaymentMade: false }, other: { ...settings.other, showBankDetails: false } },
    };
    return { model, filename: `${r.receive_number || "purchase-receive"}.pdf` };
  }

  const { data: c, error } = await sb.from("vendor_credits").select("*, bills(bill_number), purchases(po_number)").eq("id", id).maybeSingle();
  if (error || !c) throw new Error("That vendor credit was not found");
  const { company } = await loadCompany(c.tenant_id);
  const settings = await loadDocSettings(sb, "vendor_credit", c.tenant_id);
  const items: DocItem[] = ((c.items || []) as any[]).length ? (c.items as any[]).map((l) => ({ name: str(l.name) || "Item", description: str(l.reason) || null, qty: num(l.quantity ?? 1), unit_price: num(l.unit_cost ?? l.rate), tax_rate: 0, amount: num(l.amount) || num(l.quantity ?? 1) * num(l.unit_cost ?? l.rate) }))
    : [{ name: str(c.reason) || "Credit", description: null, qty: 1, unit_price: num(c.amount), tax_rate: 0, amount: num(c.amount) }];
  const left = num(c.amount) - num(c.amount_applied) - num(c.amount_refunded);
  const model: DocModel = {
    title: "Vendor Credit", number: c.credit_number, status: STATUS_LABEL[c.status] || c.status, company,
    party: await supplierParty(c.supplier_id, c.supplier_name, "Vendor"),
    meta: [
      { label: "Credit Date", value: fmtDate(c.credit_date) },
      ...(c.bills?.bill_number ? [{ label: "Bill#", value: c.bills.bill_number }] : []),
      ...(c.purchases?.po_number ? [{ label: "Purchase Order#", value: c.purchases.po_number }] : []),
      ...(c.reason ? [{ label: "Reason", value: c.reason }] : []),
    ],
    currency: ccy, items, totals: { subtotal: num(c.amount), tax: 0, total: num(c.amount), extra: [{ label: "Credits Used", value: money2(num(c.amount_applied) + num(c.amount_refunded), ccy) }] },
    highlight: { label: "Credits Remaining", value: left },
    intro: "Credit for goods not delivered, damaged or returned.",
    sections: [{ title: "Notes", text: str(c.notes) }],
    settings: { ...settings, table: { ...settings.table, showTax: false }, totals: { ...settings.totals, showTaxDetails: false } },
  };
  return { model, filename: `${c.credit_number || "vendor-credit"}.pdf` };
}

/* ── Stock documents: packing slips, delivery notes, sample notes, transfers, RFQs ──
   Items, quantities, batches and expiry dates; never prices. */
export type StockDocKind = "package" | "shipment" | "sample" | "transfer" | "rfq";

const lotLine = (l: any): DocItem => ({
  name: str(l.name) || "Item",
  description: [l.sku ? `SKU ${l.sku}` : "", l.batch_number || l.batch ? `Batch ${l.batch_number || l.batch}` : "", l.expiry_date || l.expiry ? `Expiry ${fmtDate(l.expiry_date || l.expiry)}` : "", l.bin_code ? `Bin ${l.bin_code}` : "", l.note || ""].filter(Boolean).join(" · ") || null,
  qty: num(l.quantity ?? l.qty ?? 0), unit_price: 0, tax_rate: 0, amount: 0, unit: l.unit || undefined,
} as any);

const noPrices = (settings: any) => ({
  ...settings,
  table: { ...settings.table, showRate: false, showTax: false, showAmount: false },
  totals: { ...settings.totals, showSubTotal: false, showTaxDetails: false, showAmountInWords: false, showBalanceDue: false, showPaymentMade: false },
  other: { ...settings.other, showBankDetails: false },
});

/** Expands each line into one row per batch (packing slips, transfers). */
const withLots = (lines: any[]) => lines.flatMap((l) => (Array.isArray(l.lots) && l.lots.length ? l.lots.map((x: any) => ({ ...l, batch_number: x.batch, expiry_date: x.expiry, quantity: x.qty })) : [l]));

export async function loadStockDocModel(kind: StockDocKind, id: string): Promise<{ model: DocModel; filename: string }> {
  const ccy = currencyCode() || "KES";
  const blank = { subtotal: 0, tax: 0, total: 0 };
  if (kind === "package" || kind === "shipment") {
    let pkg: any = null; let dn: any = null;
    if (kind === "shipment") {
      ({ data: dn } = await sb.from("delivery_notes").select("*").eq("id", id).maybeSingle());
      if (!dn) throw new Error("That delivery note was not found");
      if (dn.package_id) ({ data: pkg } = await sb.from("wh_packages").select("*").eq("id", dn.package_id).maybeSingle());
    } else {
      ({ data: pkg } = await sb.from("wh_packages").select("*").eq("id", id).maybeSingle());
      if (!pkg) throw new Error("That package was not found");
    }
    const src = pkg || dn;
    const { company } = await loadCompany(src.tenant_id);
    const settings = await loadDocSettings(sb, "delivery_note", src.tenant_id);
    const lines = withLots(Array.isArray(pkg?.lines) ? pkg.lines : Array.isArray(dn?.items) ? dn.items : []);
    const count = lines.reduce((a: number, l: any) => a + num(l.quantity ?? l.qty), 0);
    const ship = kind === "shipment";
    const number = ship ? str(dn.delivery_number) : str(pkg.number);
    const model: DocModel = {
      title: ship ? "Delivery Note" : "Packing Slip", number, status: null, company,
      party: await customerParty(src.customer_id, { name: src.customer_name, phone: dn?.customer_phone }, ship ? "Deliver To" : "Ship To"),
      meta: [
        ...(ship ? [{ label: "Ship Date", value: fmtDate(dn.ship_date || dn.created_at) }] : [{ label: "Package Date", value: fmtDate(pkg.created_at) }]),
        ...(pkg?.source_number || dn?.source_number ? [{ label: pkg?.source_type === "sales_order" ? "Sales Order#" : "Invoice#", value: pkg?.source_number || dn?.source_number }] : []),
        ...(ship && pkg?.number ? [{ label: "Package#", value: pkg.number }] : []),
        ...(ship && dn.carrier ? [{ label: "Carrier", value: dn.carrier }] : []),
        ...(ship && dn.tracking_number ? [{ label: "Tracking#", value: dn.tracking_number }] : []),
        ...(ship && dn.rider_name ? [{ label: "Driver / rider", value: dn.rider_name }] : []),
        { label: "Total quantity", value: String(count) },
        ...(pkg?.weight_kg ? [{ label: "Weight", value: `${pkg.weight_kg} kg` }] : []),
      ],
      currency: ccy, items: lines.map(lotLine), totals: blank,
      intro: ship ? "Please check the goods, batches and expiry dates on delivery and sign below." : "Check each item, batch and quantity before sealing the package.",
      sections: [{ title: "Notes", text: str(src.notes) }],
      signatures: ship ? ["Delivered by", "Received by (name, signature, date)"] : ["Packed by", "Checked by"],
      settings: noPrices(settings),
    };
    return { model, filename: `${number || kind}.pdf` };
  }
  if (kind === "sample") {
    const { data: s } = await sb.from("sample_issues").select("*").eq("id", id).maybeSingle();
    if (!s) throw new Error("That sample was not found");
    const { company } = await loadCompany(s.tenant_id);
    const settings = await loadDocSettings(sb, "delivery_note", s.tenant_id);
    const model: DocModel = {
      title: "Sample Issue Note", number: s.number || "Draft", status: s.status === "issued" ? "No charge" : s.status, company,
      party: await customerParty(s.customer_id, { name: s.customer_name }, "Issued To"),
      meta: [{ label: "Issue Date", value: fmtDate(s.issue_date) }, ...(s.salesperson_name ? [{ label: "Salesperson", value: s.salesperson_name }] : []), ...(s.purpose ? [{ label: "Purpose", value: s.purpose }] : []), ...(s.follow_up_on ? [{ label: "Follow up", value: fmtDate(s.follow_up_on) }] : [])],
      currency: ccy, items: (s.lines || []).map(lotLine), totals: blank,
      intro: "Samples supplied free of charge. Value: zero.",
      sections: [{ title: "Notes", text: str(s.notes) }],
      signatures: ["Issued by", "Received by (name, signature, date)"],
      settings: noPrices(settings),
    };
    return { model, filename: `${s.number || "sample"}.pdf` };
  }
  if (kind === "transfer") {
    const { data: t } = await sb.from("wh_transfers").select("*").eq("id", id).maybeSingle();
    if (!t) throw new Error("That transfer was not found");
    const { data: locs } = await sb.from("locations").select("id,name").in("id", [t.from_location_id, t.to_location_id]);
    const nm = (x: string) => (locs || []).find((l: any) => l.id === x)?.name || "";
    const { company } = await loadCompany(t.tenant_id);
    const settings = await loadDocSettings(sb, "delivery_note", t.tenant_id);
    const model: DocModel = {
      title: "Transfer Order", number: t.number || "Draft", status: String(t.status).replace("_", " "), company,
      party: { label: "To", name: nm(t.to_location_id) || "Destination", lines: [`From: ${nm(t.from_location_id)}`], fields: {} } as any,
      meta: [{ label: "Date", value: fmtDate(t.shipped_at || t.created_at) }, ...(t.received_at ? [{ label: "Received", value: fmtDate(t.received_at) }] : [])],
      currency: ccy, items: withLots(t.lines || []).map(lotLine), totals: blank,
      intro: "Stock moving between locations.", sections: [{ title: "Notes", text: str(t.notes) }],
      signatures: ["Dispatched by", "Received by"],
      settings: noPrices(settings),
    };
    return { model, filename: `${t.number || "transfer"}.pdf` };
  }
  const { data: r } = await sb.from("rfqs").select("*").eq("id", id).maybeSingle();
  if (!r) throw new Error("That RFQ was not found");
  const { company } = await loadCompany(r.tenant_id);
  const settings = await loadDocSettings(sb, "po", r.tenant_id);
  const model: DocModel = {
    title: "Request for Quotation", number: r.number || "Draft", status: null, company,
    party: { label: "To", name: "All interested vendors", lines: ["Quote your best unit prices, lead time and delivery terms"], fields: {} } as any,
    meta: [{ label: "Date", value: fmtDate(r.created_at) }, ...(r.needed_by ? [{ label: "Needed by", value: fmtDate(r.needed_by) }] : []), ...(r.title ? [{ label: "Subject", value: str(r.title) }] : [])],
    currency: ccy, items: (r.lines || []).map(lotLine), totals: blank,
    intro: "Please quote your best unit price, lead time and delivery terms for the items below.",
    sections: [{ title: "Notes", text: str(r.notes) }],
    settings: noPrices(settings),
  };
  return { model, filename: `${r.number || "rfq"}.pdf` };
}

/** Opens a stock document in the in-app viewer. */
export async function openStockDocument(kind: StockDocKind, id: string) {
  const { model, filename } = await loadStockDocModel(kind, id);
  const bytes = await buildDocPdf(model);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const { viewDocument } = await import("@/components/DocViewer");
  viewDocument({ url, name: filename, mime: "application/pdf" });
}
