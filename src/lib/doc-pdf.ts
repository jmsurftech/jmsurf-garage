// One document renderer for every business document (invoice, quote, credit
// note, bill, purchase order, vendor credit …). Runs in the browser and on the
// server (pdf-lib only, no DOM). Callers map their records into DocModel.
//
// Layout follows classic accounting templates (Standard, Spreadsheet, Minimalist,
// Professional) and is driven by the per-document settings in
// lib/doc-settings.ts: colours (orange/teal by default), font size,
// labels and show/hide switches for every section.
// <DocPaper> (components/print/doc-paper.tsx) renders the same DocModel as HTML
// for the on-screen preview, so keep the two in step.
import { PDFDocument, StandardFonts, rgb, degrees, PageSizes, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  COMPANY_FIELDS, FONT_SCALE, LOGO_HEIGHT, PARTY_FIELDS, hexToRgb01, orderedDetailLines, resolveDocSettings,
  type CompanyFieldKey, type DocSettings, type PartyFieldKey,
} from "@/lib/doc-settings";

export type DocParty = {
  label: string;
  name: string;
  lines: string[];
  /** Raw detail values; when present they are printed in the order set in Settings → Documents. */
  fields?: Partial<Record<PartyFieldKey, string | null>>;
};
export type DocItem = {
  name?: string | null;
  description?: string | null;
  qty: number;
  unit_price: number;
  tax_rate: number;
  amount: number; // excluding VAT
  /** Unit printed under the quantity (pcs, box …). */
  unit?: string | null;
};
export type DocSignedBy = {
  name: string;
  title?: string | null;
  /** When it was signed (ISO). */
  at: string;
  signature?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  stamp?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  /** Used by the HTML preview only. */
  signatureUrl?: string | null;
  stampUrl?: string | null;
};

/** "17 Oct 2026, 14:32" (fixed format, same in the browser and on the server). */
export const fmtSignedAt = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return fmtDate(iso);
  return `${fmtDate(iso)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export type DocModel = {
  title: string;
  number: string | null;
  status?: string | null;
  brand?: [number, number, number];
  company: {
    name: string;
    lines: string[]; // address, phone · email, website
    kra_pin?: string | null;
    vat_number?: string | null;
    logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
    /** Raw detail values (address, phone, email …) printed in the configured order. */
    fields?: Partial<Record<CompanyFieldKey, string | null>>;
    /** Used by the HTML preview only. */
    logoUrl?: string | null;
    /** Order and on/off from Business settings → Contact details for documents (wins over the per-document list). */
    fieldOrder?: { key: CompanyFieldKey; show: boolean }[] | null;
  };
  party: DocParty;
  secondParty?: DocParty | null; // e.g. "Deliver to"
  meta: { label: string; value: string }[];
  currency: string;
  items: DocItem[];
  totals: {
    subtotal: number;
    tax: number;
    total: number;
    paid?: number | null;
    /** Line amounts include VAT ("Sub Total (VAT Inclusive)", VAT taken out of them). */
    inclusive?: boolean;
    extra?: { label: string; value: string }[];
  };
  highlight?: { label: string; value: number } | null; // amount due under the title
  intro?: string | null;
  sections: { title: string; text: string }[];
  payment?: { title: string; lines: string[] }[];
  signatures?: string[]; // e.g. ["Prepared by", "Approved by"]
  /** KRA eTIMS: the receipt QR code and the control unit details. */
  kra?: { qr?: { bytes: Uint8Array; type: "png" | "jpg" } | null; qrDataUrl?: string | null; url?: string | null; rows: [string, string][]; logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null } | null;
  /** Sign & Stamp: who signed it, when, with their signature and stamp (drawn in the first signature place). */
  signedBy?: DocSignedBy | null;
  footerNote?: string | null;
  /** Saved document settings (Settings → Documents); defaults apply when absent. */
  settings?: Partial<DocSettings> | DocSettings | null;
};

const num = (n: unknown) => Number(n ?? 0) || 0;
export const fmtMoney = (n: unknown) =>
  num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  // fixed format (locale data differs between browsers and Node, e.g. "Sep" vs "Sept")
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

// ---------------------------------------------------------------- words
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words999(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? "-" + ONES[r % 10] : ""}`);
  return parts.join(" and ");
}
const CURRENCY_WORDS: Record<string, [string, string]> = {
  KES: ["Kenya Shillings", "Cents"], USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds Sterling", "Pence"],
  UGX: ["Uganda Shillings", "Cents"], TZS: ["Tanzania Shillings", "Cents"], RWF: ["Rwanda Francs", "Centimes"],
};
export function amountInWords(amount: number, currency = "KES"): string {
  const [major, minor] = CURRENCY_WORDS[currency.toUpperCase()] ?? [currency.toUpperCase(), "Cents"];
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  const scales = [["Billion", 1e9], ["Million", 1e6], ["Thousand", 1e3]] as const;
  let rest = whole; const parts: string[] = [];
  for (const [name, v] of scales) { const q = Math.floor(rest / v); if (q) { parts.push(`${words999(q)} ${name}`); rest %= v; } }
  if (rest) parts.push(words999(rest));
  const text = `${major} ${parts.join(" ") || "Zero"}${cents ? ` and ${words999(cents)} ${minor}` : ""} Only`;
  return text.replace(/\s+/g, " ");
}

// ---------------------------------------------------------------- shared presentation rules
/** VAT column text: "16%", "0%", or "Exempt" (rate stored as -1). */
export const vatLabel = (rate: unknown) => (num(rate) < 0 ? "Exempt" : `${num(rate).toFixed(num(rate) % 1 ? 1 : 0)}%`);
/** "KES 1,200.00", negatives as "(-) KES 1,200.00" as on the Payment Made row. */
export const docMoney = (n: unknown, ccy: string) =>
  num(n) < 0 ? `(-) ${ccy} ${fmtMoney(-num(n))}` : `${ccy} ${fmtMoney(n)}`;

/** Status shown on the corner ribbon (internal states such as "sent" stay hidden on some docs). */
export const RIBBON_COLORS: Record<string, [number, number, number]> = {
  paid: [0.13, 0.59, 0.33], accepted: [0.13, 0.59, 0.33], approved: [0.13, 0.59, 0.33], received: [0.13, 0.59, 0.33],
  applied: [0.13, 0.59, 0.33], closed: [0.13, 0.59, 0.33], invoiced: [0.13, 0.59, 0.33],
  overdue: [0.86, 0.2, 0.2], rejected: [0.86, 0.2, 0.2], declined: [0.86, 0.2, 0.2],
  cancelled: [0.55, 0.57, 0.6], void: [0.55, 0.57, 0.6], expired: [0.55, 0.57, 0.6],
  partial: [0.93, 0.55, 0.1], partially_paid: [0.93, 0.55, 0.1],
  sent: [0.16, 0.45, 0.85], open: [0.16, 0.45, 0.85], issued: [0.16, 0.45, 0.85], pending: [0.93, 0.55, 0.1],
};
export function ribbonFor(status: string | null | undefined): { label: string; color: [number, number, number] } | null {
  if (!status) return null;
  const k = status.toLowerCase();
  const color = RIBBON_COLORS[k];
  if (!color) return null;
  const label = (k === "partial" ? "partially paid" : k).replace(/_/g, " ").toUpperCase();
  return { label, color };
}

export type DocTotalRow = { label: string; value: number | string; kind?: "total" | "paid" | "due" };
/** Totals rows, honouring the Total-section switches of the document settings. */
export function docTotalRows(m: DocModel): DocTotalRow[] {
  const s = resolveDocSettings(m.settings);
  const taxByRate = new Map<number, number>();
  for (const it of m.items) {
    const r = num(it.tax_rate); if (r <= 0) continue;
    taxByRate.set(r, (taxByRate.get(r) ?? 0) + (m.totals.inclusive ? num(it.amount) * r / (100 + r) : num(it.amount) * r / 100));
  }
  const rows: DocTotalRow[] = [];
  // Delivery notes and packing lists carry no money.
  if ((s.table as any).showAmount === false) return rows;
  if (s.totals.showSubTotal) rows.push({ label: m.totals.inclusive ? "Sub Total (VAT Inclusive)" : "Sub Total", value: m.totals.subtotal });
  const sumTax = [...taxByRate.values()].reduce((a, v) => a + v, 0);
  if (s.totals.showTaxDetails && taxByRate.size && Math.abs(sumTax - num(m.totals.tax)) < 1) {
    for (const [r, v] of [...taxByRate.entries()].sort((a, c) => c[0] - a[0])) rows.push({ label: `VAT ${r}%`, value: v });
  } else if (num(m.totals.tax)) rows.push({ label: "VAT", value: m.totals.tax });
  for (const e of m.totals.extra ?? []) rows.push({ label: e.label, value: e.value });
  rows.push({ label: "Total", value: m.totals.total, kind: "total" });
  const paid = m.totals.paid != null ? num(m.totals.paid) : 0;
  if (paid > 0 && s.totals.showPaymentMade) rows.push({ label: "Payment Made", value: -paid, kind: "paid" });
  if (s.totals.showBalanceDue) {
    // Like the other system: a Balance Due row only once something has been paid.
    if (paid > 0) rows.push({ label: "Balance Due", value: num(m.totals.total) - paid, kind: "due" });
  }
  return rows;
}

/** Item name (from Products & Services) with its description underneath. */
export function docItemText(it: DocItem, showDescription = true): { name: string; description: string | null } {
  const name = String(it.name || it.description || "").trim();
  const desc = it.name && showDescription ? String(it.description ?? "").trim() || null : null;
  return { name, description: desc };
}

/** Organization detail lines under the company name (each field on its own line). */
export function docCompanyLines(m: DocModel, s: DocSettings): string[] {
  if (m.company.fields) return s.header.showCompanyAddress ? orderedDetailLines(m.company.fields, m.company.fieldOrder || s.header.companyFields, COMPANY_FIELDS) : [];
  // legacy models: pre-built lines + tax ids
  const ids = [m.company.kra_pin ? `KRA PIN: ${m.company.kra_pin}` : "", m.company.vat_number ? `VAT No: ${m.company.vat_number}` : ""].filter(Boolean);
  return [...(s.header.showCompanyAddress ? m.company.lines.filter(Boolean) : []), ...(s.header.showTaxIds ? ids : [])];
}

/** Customer / vendor detail lines under the name. */
export function docPartyLines(p: DocParty, s: DocSettings): string[] {
  return p.fields ? orderedDetailLines(p.fields, s.details.customerFields, PARTY_FIELDS) : p.lines.filter(Boolean);
}

/** Columns of the item table for these settings. */
export function docColumns(s: DocSettings, items?: DocItem[]) {
  const anyTax = !items || items.some((it) => num(it.tax_rate) > 0);
  const cols: { key: "n" | "item" | "qty" | "rate" | "tax" | "amount"; label: string; w: number; right: boolean }[] = [];
  if (s.table.showLineNumber) cols.push({ key: "n", label: "#", w: 26, right: false });
  cols.push({ key: "item", label: s.table.itemLabel, w: 0, right: false });
  if (s.table.showQuantity) cols.push({ key: "qty", label: s.table.qtyLabel, w: 52, right: true });
  if (s.table.showRate) cols.push({ key: "rate", label: s.table.rateLabel, w: 86, right: true });
  if (s.table.showTax && anyTax) cols.push({ key: "tax", label: s.table.taxLabel, w: 52, right: true });
  if ((s.table as any).showAmount !== false) cols.push({ key: "amount", label: s.table.amountLabel, w: 100, right: true });
  return cols;
}

// ---------------------------------------------------------------- layout helpers
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const p of String(text ?? "").split(/\r?\n/)) {
    if (!p.trim()) { out.push(""); continue; }
    let line = "";
    for (const w of p.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= maxWidth) { line = t; continue; }
      if (line) out.push(line);
      let chunk = w;
      while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
        let cut = chunk.length;
        while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) cut--;
        out.push(chunk.slice(0, cut)); chunk = chunk.slice(cut);
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out;
}
// Helvetica (WinAnsi) cannot encode some characters; swap the common ones
const SWAP: Record<number, string> = {
  0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"', 0x2013: "-", 0x2014: "-", 0x2026: "...", 0x00a0: " ",
};
const safe = (s: unknown) => {
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    if (SWAP[c] !== undefined) out += SWAP[c];
    else if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) out += ch;
  }
  return out;
};


export async function buildDocPdf(m: DocModel): Promise<Uint8Array> {
  const s = resolveDocSettings(m.settings);
  const k = FONT_SCALE[s.fontSize];
  const doc = await PDFDocument.create();
  doc.setTitle(`${m.title} ${m.number ?? ""}`.trim());
  doc.setProducer("JMSURF Garage ERP");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const SIZE = s.paper === "Letter" ? PageSizes.Letter : PageSizes.A4;
  const [W, H] = SIZE;
  const M = 40;
  const CW = W - M * 2;
  const T = s.template;
  const c = (hex: string, fb: [number, number, number]) => rgb(...hexToRgb01(hex, fb));
  const ink = c(s.colors.text, [0.13, 0.13, 0.13]);
  const muted = c(s.colors.label, [0.37, 0.39, 0.41]);
  const accent = c(s.colors.accent, [0.42, 0.09, 0.28]);
  const thRgb = hexToRgb01(s.colors.tableHeader, [0.79, 0.24, 0.55]);
  const th = rgb(...thRgb);
  const thText = c(s.colors.tableHeaderText, [1, 1, 1]);
  const tint = (a: number) => rgb(1 - (1 - thRgb[0]) * a, 1 - (1 - thRgb[1]) * a, 1 - (1 - thRgb[2]) * a);
  const balanceBg = c(s.colors.balanceBg, [0.98, 0.92, 0.95]);
  const line = rgb(0.85, 0.85, 0.87), white = rgb(1, 1, 1);
  const red = rgb(0.84, 0.18, 0.18);
  const ccy = (m.currency || "KES").toUpperCase();
  const money = (n: unknown) => docMoney(n, ccy);
  // Sizes match the other system's standard documents (body about 8.5pt).
  const fs = { body: 8.5 * k, small: 8 * k, label: 8.5 * k, name: 10.5 * k, title: 24 * k, head: 8.5 * k, strong: 9 * k };
  const LH = (size: number) => size * 1.35;

  let page: PDFPage = doc.addPage(SIZE);
  let y = H - M;
  const pages: PDFPage[] = [page];

  type O = { size?: number; f?: PDFFont; c?: RGB };
  const text = (str: string, x: number, yy: number, o: O = {}) =>
    page.drawText(safe(str), { x, y: yy, size: o.size ?? fs.body, font: o.f ?? font, color: o.c ?? ink });
  const right = (str: string, xr: number, yy: number, o: O = {}) => {
    const f = o.f ?? font; const v = safe(str); const size = o.size ?? fs.body;
    page.drawText(v, { x: xr - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color: o.c ?? ink });
  };
  const newPage = () => { page = doc.addPage(SIZE); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const embed = async (img: { bytes: Uint8Array; type: "png" | "jpg" }) => {
    try { return img.type === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes); } catch { return null; }
  };
  /** Signature sitting on the line, the stamp overlapping its right end (slightly turned, the signing date across it), name, title and date beneath. */
  const drawSigned = async (sb: DocSignedBy, lx: number, lx2: number, ly: number) => {
    const span = lx2 - lx;
    const stamp = sb.stamp ? await embed(sb.stamp) : null;
    if (stamp) {
      const side = 74, r = Math.min(side / stamp.width, side / stamp.height);
      const w = stamp.width * r, h = stamp.height * r;
      const th = (-8 * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
      const cx = lx2 - w / 2 + 6, cy = ly + 14;
      page.drawImage(stamp, { x: cx - (w / 2) * cos + (h / 2) * sin, y: cy - (w / 2) * sin - (h / 2) * cos, width: w, height: h, rotate: degrees(-8), opacity: 0.88 });
      const dt = fmtDate(sb.at).toUpperCase(), ds = 6.5, tw = bold.widthOfTextAtSize(dt, ds);
      page.drawText(dt, { x: cx - (tw / 2) * cos + (ds * 0.35) * sin, y: cy - (tw / 2) * sin - (ds * 0.35) * cos, size: ds, font: bold, color: rgb(0.11, 0.2, 0.55), rotate: degrees(-8) });
    }
    const sig = sb.signature ? await embed(sb.signature) : null;
    if (sig) {
      const r = Math.min((span * 0.62) / sig.width, 42 / sig.height);
      page.drawImage(sig, { x: lx + 6, y: ly - 3, width: sig.width * r, height: sig.height * r });
    }
    text(sb.name, lx, ly - 11, { size: fs.small, f: bold });
    text([sb.title, `Signed ${fmtSignedAt(sb.at)}`].filter(Boolean).join("  ·  "), lx, ly - 21, { size: fs.small - 0.5, c: muted });
  };
  const title = s.details.title.trim() || m.title;

  // ---- professional: brand band across the top carrying the title
  if (T === "professional") {
    const bandH = 80;
    page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: th });
    right(title, W - M, H - 42, { size: fs.title, f: bold, c: thText });
    right(`# ${m.number ?? "—"}`, W - M, H - 62, { size: fs.strong, f: bold, c: thText });
    y = H - bandH - 22;
  }

  // ---- corner ribbon
  const rib = s.header.showStatusRibbon && T !== "professional" ? ribbonFor(m.status) : null;
  if (rib) {
    page.drawSvgPath("M 0 56 L 56 0 L 88 0 L 0 88 Z", { x: 0, y: H, color: rgb(...rib.color) });
    const size = rib.label.length > 9 ? 7 : 8.5;
    const tw = bold.widthOfTextAtSize(rib.label, size);
    const cc = 36, kk = Math.SQRT1_2;
    page.drawText(rib.label, {
      x: cc - (tw / 2) * kk + size * 0.35 * kk, y: H - cc - (tw / 2) * kk - size * 0.35 * kk,
      size, font: bold, color: white, rotate: degrees(45),
    });
  }

  // ---- company block (left)
  const top = y;
  let ly = y;
  if (s.header.showLogo && m.company.logo) {
    try {
      const img = m.company.logo.type === "png" ? await doc.embedPng(m.company.logo.bytes) : await doc.embedJpg(m.company.logo.bytes);
      const r = Math.min(LOGO_HEIGHT[s.header.logoSize] / img.height, 210 / img.width);
      page.drawImage(img, { x: M + (rib ? 30 : 0), y: ly - img.height * r, width: img.width * r, height: img.height * r });
      ly -= img.height * r + 12;
    } catch { /* fall through to the name */ }
  }
  const leftW = CW * 0.42;
  if (s.header.showCompanyName) {
    for (const l of wrap(m.company.name, bold, fs.strong, leftW)) { text(l, M, ly - fs.strong, { size: fs.strong, f: bold }); ly -= LH(fs.strong); }
    ly -= 1;
  }
  for (const raw of docCompanyLines(m, s)) for (const l of wrap(raw, font, fs.small, leftW)) { text(l, M, ly - fs.small, { size: fs.small }); ly -= LH(fs.small); }

  // ---- title block (right)
  let ry = top;
  if (T !== "professional") {
    right(title, W - M, ry - fs.title, { size: fs.title, f: T === "spreadsheet" ? bold : font, c: accent }); ry -= fs.title + 16;
    right(`# ${m.number ?? "—"}`, W - M, ry, { size: fs.strong, f: bold }); ry -= 26;
  }
  if (m.highlight && s.totals.showBalanceDue) {
    right(m.highlight.label, W - M, ry, { size: fs.small, f: bold }); ry -= 15 * k;
    right(money(m.highlight.value), W - M, ry, { size: 11.5 * k, f: bold }); ry -= 10;
  }
  y = Math.min(ly, ry) - 24;

  // ---- Bill To (+ Ship To) left, details right
  const pTop = y;
  const metaW = 250;
  const pad = T === "spreadsheet" ? 10 : 0;
  const partyW = (m.secondParty ? (CW - metaW - 24) / 2 : CW - metaW - 24) - pad * 2;
  const partyBlock = (p: DocParty, x: number) => {
    let py = pTop - pad;
    text(p.label, x + pad, py - fs.body, { size: fs.body, f: bold }); py -= LH(fs.body) + 2;
    for (const l of wrap(p.name, bold, fs.small, partyW)) { text(l, x + pad, py - fs.small, { size: fs.small, f: bold }); py -= LH(fs.small); }
    for (const raw of docPartyLines(p, s)) for (const l of wrap(raw, font, fs.small, partyW)) { text(l, x + pad, py - fs.small, { size: fs.small }); py -= LH(fs.small); }
    return py - pad;
  };
  let lowest = partyBlock(m.party, M);
  if (m.secondParty) lowest = Math.min(lowest, partyBlock(m.secondParty, M + partyW + pad * 2 + 24));
  let my = pTop - pad - fs.body;
  const labelR = W - M - 122;
  for (const r of m.meta) {
    right(`${r.label} :`, labelR, my, { size: fs.body });
    const vLines = wrap(r.value, font, fs.small, 112);
    vLines.forEach((v, i) => right(v, W - M - pad, my - i * LH(fs.small), { size: fs.small }));
    my -= LH(fs.body) + 8 + (vLines.length - 1) * LH(fs.small);
  }
  my -= pad;
  if (T === "spreadsheet") {
    const bottom = Math.min(lowest, my);
    page.drawRectangle({ x: M, y: bottom, width: CW - metaW - 12, height: pTop - bottom, borderColor: line, borderWidth: 0.8 });
    page.drawRectangle({ x: W - M - metaW, y: bottom, width: metaW, height: pTop - bottom, borderColor: line, borderWidth: 0.8 });
  }
  y = Math.min(lowest, my) - 16;

  if (m.intro) {
    for (const l of wrap(m.intro, font, fs.small, CW)) { need(LH(fs.small)); text(l, M, y, { size: fs.small, c: muted }); y -= LH(fs.small); }
    y -= 8;
  }

  // ---- items table
  const cols = docColumns(s, m.items);
  const widths = cols.map((col) => col.w);
  const iItem = cols.findIndex((col) => col.key === "item");
  widths[iItem] = CW - widths.reduce((a, w) => a + w, 0);
  const headH = 26 * Math.max(1, k * 0.95);
  const filledHead = T === "standard" || T === "professional";
  const header = () => {
    need(headH + 4);
    if (T === "minimalist") {
      page.drawLine({ start: { x: M, y: y - headH }, end: { x: M + CW, y: y - headH }, thickness: 1.6, color: th });
    } else if (T === "spreadsheet") {
      page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: tint(0.14), borderColor: line, borderWidth: 0.8 });
    } else {
      page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: T === "professional" ? accent : th });
    }
    const hc = filledHead ? thText : accent;
    let x = M;
    cols.forEach((col, i) => {
      const ty = y - headH / 2 - fs.head / 2.8;
      const hf = T === "spreadsheet" || T === "minimalist" ? bold : font;
      if (col.right) right(col.label, x + widths[i] - 8, ty, { size: fs.head, f: hf, c: hc });
      else text(col.label, x + 8, ty, { size: fs.head, f: hf, c: hc });
      x += widths[i];
    });
    y -= headH;
  };
  header();
  m.items.forEach((it, idx) => {
    const { name, description } = docItemText(it, s.table.showDescription);
    const nameLines = wrap(name, font, fs.body, widths[iItem] - 16);
    const descLines = description ? wrap(description, font, fs.small, widths[iItem] - 16) : [];
    const rowH = Math.max((it.unit ? 38 : 30) * k, 16 + nameLines.length * LH(fs.body) + descLines.length * LH(fs.small));
    if (y - rowH < M + 30) { newPage(); header(); }
    if (s.table.stripedRows && idx % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: CW, height: rowH, color: tint(0.06) });
    const ty = y - 10 - fs.body;
    let x = M;
    cols.forEach((col, i) => {
      const xr = x + widths[i] - 8;
      if (col.key === "n") text(String(idx + 1), x + 8, ty, { c: muted });
      else if (col.key === "item") {
        let yy = ty;
        nameLines.forEach((l) => { text(l, x + 8, yy); yy -= LH(fs.body); });
        descLines.forEach((l) => { text(l, x + 8, yy, { size: fs.small, c: muted }); yy -= LH(fs.small); });
      } else if (col.key === "qty") {
        right(fmtMoney(it.qty), xr, ty);
        if (it.unit) right(String(it.unit), xr, ty - LH(fs.small), { size: fs.small - 1, c: muted });
      }
      else if (col.key === "rate") right(fmtMoney(it.unit_price), xr, ty);
      else if (col.key === "tax") right(vatLabel(it.tax_rate), xr, ty);
      else right(fmtMoney(it.amount), xr, ty);
      if (T === "spreadsheet" && i > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowH }, thickness: 0.6, color: line });
      x += widths[i];
    });
    if (T === "spreadsheet") {
      page.drawLine({ start: { x: M, y }, end: { x: M, y: y - rowH }, thickness: 0.6, color: line });
      page.drawLine({ start: { x: M + CW, y }, end: { x: M + CW, y: y - rowH }, thickness: 0.6, color: line });
    }
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.6, color: line });
  });
  if (!m.items.length) { text("No line items", M + 34, y - 18, { c: muted }); y -= 30; }
  y -= 12;

  // ---- totals (right) + total in words (left)
  const rows = docTotalRows(m);
  const tw = 270, tx = W - M - tw;
  const rH = LH(fs.body) + 10;
  need(rows.length * rH + 40);
  const startY = y;
  rows.forEach((r, ri) => {
    const strong = r.kind === "total" || r.kind === "due";
    const last = ri === rows.length - 1;
    if (r.kind === "total" && T === "standard") page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
    const v = typeof r.value === "number" ? money(r.value) : r.value;
    const size = strong ? fs.strong : fs.body;
    let fg = ink;
    if (last && strong && T !== "professional") page.drawRectangle({ x: tx - 50, y: y - rH, width: tw + 50, height: rH, color: balanceBg });
    if (r.kind === "total" && T === "professional") { page.drawRectangle({ x: tx, y: y - rH, width: tw, height: rH, color: th }); fg = thText; }
    if (r.kind === "total" && T === "minimalist") page.drawLine({ start: { x: tx, y }, end: { x: W - M, y }, thickness: 1.2, color: th });
    const ty = y - rH / 2 - size / 2.8;
    right(r.label, W - M - 126, ty, { size, f: bold, c: fg });
    right(v, W - M - 8, ty, { size, f: strong ? bold : font, c: r.kind === "paid" ? red : fg });
    y -= rH;
  });
  if (T === "spreadsheet") page.drawRectangle({ x: tx, y, width: tw, height: startY - y, borderColor: line, borderWidth: 0.8 });
  let wy = startY - fs.small - 4;
  if (s.totals.showAmountInWords) {
    const wordsW = tx - M - 24;
    text("Total In Words", M, wy, { size: fs.small, c: muted }); wy -= LH(fs.body) + 2;
    for (const l of wrap(amountInWords(num(m.totals.total), ccy), boldItalic, fs.body, wordsW)) { text(l, M, wy, { f: boldItalic }); wy -= LH(fs.body); }
  }
  y = Math.min(y, wy) - 22;

  // ---- notes, payment details, terms
  const section = (heading: string, lines: string[]) => {
    const body = lines.flatMap((l) => wrap(l, font, fs.small, CW));
    if (!body.some((l) => l.trim())) return;
    need(Math.min(LH(fs.label) + 3 + body.length * LH(fs.small) + 8, 220)); // keep short blocks together
    text(heading, M, y, { size: fs.body }); y -= LH(fs.body) + 4;
    for (const l of body) { need(LH(fs.small)); text(l, M, y, { size: fs.small }); y -= LH(fs.small); }
    y -= 14;
  };
  const notes = m.sections.filter((x) => x.text?.trim() && !/terms/i.test(x.title));
  const terms = m.sections.filter((x) => x.text?.trim() && /terms/i.test(x.title));
  if (s.other.showNotes) for (const x of notes) section(s.other.notesLabel || x.title, [x.text]);
  if (s.other.showBankDetails) for (const p of m.payment ?? []) section(p.title, p.lines.filter(Boolean));
  if (s.other.showTerms) for (const x of terms) section(s.other.termsLabel || x.title, [x.text]);

  // ---- KRA eTIMS: QR code with the control unit details beside it
  if (m.kra && (m.kra.qr || m.kra.rows.length)) {
    const size = 92;
    need(size + 60); y -= 18;
    // Kenya Revenue Authority wordmark, then "SCU INFORMATION".
    const serif = await doc.embedFont(StandardFonts.TimesRoman);
    const logo = m.kra.logo ? await embed(m.kra.logo) : null;
    // the official logo is the emblem with the "Kenya Revenue Authority" wordmark, so it replaces the drawn text
    if (logo) { const w = 128; page.drawImage(logo, { x: M, y: y - 26, width: w, height: w * (logo.height / logo.width) }); }
    else {
      page.drawCircle({ x: M + 14, y: y - 10, size: 14, color: rgb(0.82, 0.07, 0.11) });
      page.drawText("KRA", { x: M + 5.2, y: y - 13.4, size: 9.4, font: bold, color: white });
      page.drawText("KENYA REVENUE", { x: M + 33, y: y - 6, size: 13.5, font: serif, color: ink });
      page.drawText("AUTHORITY", { x: M + 33, y: y - 21, size: 13.5, font: serif, color: ink });
    }
    y -= 40;
    text("SCU INFORMATION", M, y, { size: fs.body, f: bold });
    y -= 8;
    const qr = m.kra.qr ? await embed(m.kra.qr) : null;
    if (qr) page.drawImage(qr, { x: M, y: y - size, width: size, height: size });
    const lx = M + (qr ? size + 8 : 0), vx = lx + 128;
    m.kra.rows.forEach(([l, v], i) => {
      const ry = y - 9 - i * 12;
      text(l, lx, ry, { size: fs.body });
      text(`: ${v}`, vx, ry, { size: fs.body });
    });
    text("Scan the QR code to connect with KRA and verify the document.", lx, y - 9 - m.kra.rows.length * 12 - 2, { size: fs.body, c: muted });
    y -= Math.max(qr ? size : 0, m.kra.rows.length * 12 + 18) + 14;
  }

  // ---- signatures
  if (s.other.showSignature || m.signedBy) {
    const sigs = m.signatures?.length ? m.signatures : [s.other.signatureLabel || "Authorized Signature"];
    need(56);
    y -= 28;
    const sw = Math.min(210, (CW - 30 * (sigs.length - 1)) / sigs.length);
    const sb = m.signedBy;
    if (sb) { need(96); y -= 48; } // room above the line for the signature and stamp
    for (const [i, sg] of sigs.entries()) {
      const sx = M + i * (sw + 30);
      const lx = sx + font.widthOfTextAtSize(sg, fs.body) + 6, lx2 = Math.min(sx + sw + 60, W - M);
      text(sg, sx, y, { size: fs.body });
      page.drawLine({ start: { x: lx, y: y - 1 }, end: { x: lx2, y: y - 1 }, thickness: 0.8, color: ink });
      if (i === 0 && sb) await drawSigned(sb, lx, lx2, y - 1);
    }
    y -= sb ? 34 : 22;
  }
  const footNote = m.footerNote || s.other.footerText;
  if (footNote) { need(16); text(footNote, M, y, { size: fs.small, c: muted }); y -= 16; }

  // ---- footer on every page
  pages.forEach((p, i) => {
    const sz = 8;
    if (s.other.showPageNumbers) {
      const pn = `Page ${i + 1} of ${pages.length}`;
      p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, sz), y: M - 18, size: sz, font, color: muted });
    }
    // Company name and page numbers: off unless switched on in Settings → Documents.
    if (s.other.showPageNumbers) {
      const foot = safe([m.company.name, m.company.kra_pin ? `KRA PIN ${m.company.kra_pin}` : ""].filter(Boolean).join("  ·  "));
      p.drawText(foot, { x: M, y: M - 18, size: sz, font, color: muted });
    }
  });

  return await doc.save();
}
