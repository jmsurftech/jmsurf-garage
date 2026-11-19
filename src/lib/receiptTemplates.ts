// Printed receipt layouts a shop can pick in Settings › Business › Receipt templates.
// Every template prints on 80 mm thermal paper and ends with the shop footer, the
// shop's terms (when set) as the last block. No platform branding (JMSURF Garage owns the system).

export type ReceiptTemplateId =
  | "classic" | "modern" | "compact" | "bold" | "elegant"
  | "typewriter" | "minimal" | "boxed" | "table" | "branded";

export interface ReceiptTemplate {
  id: ReceiptTemplateId;
  name: string;
  description: string;
}

export const RECEIPT_TEMPLATES: ReceiptTemplate[] = [
  { id: "classic", name: "Classic", description: "The standard receipt. Bold and clear on any printer." },
  { id: "modern", name: "Modern", description: "Clean lines with the total in a dark band." },
  { id: "compact", name: "Compact", description: "One line per item. Saves paper on long sales." },
  { id: "bold", name: "Bold", description: "Big shop name and a very large total." },
  { id: "elegant", name: "Elegant", description: "Serif type and double rules for boutiques and salons." },
  { id: "typewriter", name: "Typewriter", description: "Old-school monospaced till slip." },
  { id: "minimal", name: "Minimal", description: "Light, airy and simple. No dashed lines." },
  { id: "boxed", name: "Boxed", description: "Everything inside a frame, shop name on a black banner." },
  { id: "table", name: "Table", description: "Items in Qty / Item / Amount columns." },
  { id: "branded", name: "Branded", description: "Your logo on top, centred and spacious." },
];

export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplateId = "classic";

export function receiptTemplateId(v: unknown): ReceiptTemplateId {
  return RECEIPT_TEMPLATES.some((t) => t.id === v) ? (v as ReceiptTemplateId) : DEFAULT_RECEIPT_TEMPLATE;
}

export interface ReceiptPaperItem {
  name: string;
  quantity: number;
  price: number;
  wholesale?: boolean;
}

export interface ReceiptPaperData {
  businessName: string;
  payLine?: string;
  address?: string;
  phone?: string;
  logoUrl?: string | null;
  date: string;
  time: string;
  cashier: string;
  customer: string;
  receiptNo: string;
  items: ReceiptPaperItem[];
  subtotal: string;
  vat?: string | null;
  discount?: string | null;
  total: string;
  payment: string;
  mpesaRef?: string | null;
  tendered?: string | null;
  change?: string | null;
  footer?: string;
  terms?: string;
  money: (n: number) => string;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Shared base: this is the original Classic receipt, unchanged.
const BASE_CSS = `
  @page { size: 80mm auto; margin: 0; }
  @media print { html, body { width: 80mm; margin: 0 !important; padding: 0 !important; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 15px; line-height: 1.4;
    width: 76mm; margin: 0 auto; padding: 2mm 2mm 4mm; font-weight: 700;
    -webkit-font-smoothing: none; text-rendering: geometricPrecision;
  }
  .receipt-wrap { page-break-inside: avoid; break-inside: avoid; width: 100%; }
  img.shop-logo { display: block; max-width: 68mm; max-height: 30mm; width: auto; height: auto; margin: 0 auto 4px; }
  .head { text-align: center; }
  .bold { font-weight: 900; }
  .business-name { font-size: 24px; font-weight: 900; text-align: center; margin: 3px 0; letter-spacing: 0.6px; }
  .biz-meta { font-size: 13px; font-weight: 700; text-align: center; margin: 1px 0; }
  .biz-meta.pay { font-weight: 800; }
  .line { border-top: 2px dashed #000; margin: 6px 0; }
  .meta { font-size: 14px; line-height: 1.45; font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; }
  .items .item { font-size: 15px; margin-bottom: 5px; }
  .item-row { display: flex; justify-content: space-between; gap: 8px; }
  .item-row, .item-row *, .item-qty { font-weight: normal; }
  .item-name { flex: 1; padding-right: 6px; }
  .item-qty { font-size: 13px; padding-left: 4px; }
  .w { margin-left: 4px; font-size: 12px; }
  .items-table { display: none; }
  .sums { font-size: 15px; font-weight: 800; }
  .total-row { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 8px; font-size: 22px; font-weight: 900; padding: 5px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 5px 0; }
  .total-row span { white-space: nowrap; }
  .total-row span:last-child { margin-left: auto; }
  .pay { font-size: 15px; margin-top: 4px; font-weight: 800; }
  .upper { text-transform: uppercase; }
  .footer { text-align: center; font-size: 13px; font-weight: 700; margin-top: 6px; }
  .terms { font-size: 11px; font-weight: 400; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #000; white-space: pre-line; text-align: left; line-height: 1.35; }
  .terms-title { font-weight: 800; text-align: center; margin-bottom: 2px; letter-spacing: 0.5px; }
  .powered { text-align: center; font-size: 11px; font-weight: 700; margin-top: 8px; }
`;

const TEMPLATE_CSS: Record<ReceiptTemplateId, string> = {
  classic: "",
  modern: `
    .business-name { font-size: 22px; letter-spacing: 0; }
    .line { border-top: 1px solid #000; margin: 8px 0; }
    .meta { font-weight: 400; font-size: 13px; }
    .meta .row { font-weight: 400; }
    .sums { font-weight: 700; }
    .total-row { background: #000; color: #fff !important; border: 0; padding: 7px 8px; border-radius: 4px; }
    .total-row * { color: #fff !important; }
  `,
  compact: `
    body { font-size: 12px; line-height: 1.25; padding: 1mm 1.5mm 3mm; }
    .business-name { font-size: 18px; margin: 1px 0; }
    .biz-meta { font-size: 11px; }
    .line { margin: 3px 0; border-top-width: 1px; }
    .meta { font-size: 11px; line-height: 1.25; }
    .meta .row { display: inline-flex; gap: 4px; margin-right: 8px; }
    .items .item { font-size: 12px; margin-bottom: 1px; }
    .item-qty { display: none; }
    .item-name::before { content: attr(data-qty) " x "; }
    .sums, .pay { font-size: 12px; }
    .total-row { font-size: 16px; padding: 2px 0; margin: 3px 0; border-width: 1px; }
    .footer { font-size: 11px; margin-top: 3px; }
    .terms { font-size: 10px; margin-top: 4px; padding-top: 3px; }
    .powered { font-size: 10px; margin-top: 4px; }
  `,
  bold: `
    body { font-size: 16px; }
    .business-name { font-size: 30px; text-transform: uppercase; letter-spacing: 1px; }
    .line { border-top: 3px solid #000; }
    .meta .row span:first-child { text-transform: uppercase; }
    .items .item { font-size: 16px; }
    .item-row, .item-row * { font-weight: 700; }
    .total-row { font-size: 25px; border-top: 4px solid #000; border-bottom: 4px solid #000; padding: 8px 0; }
    .footer { font-size: 15px; text-transform: uppercase; }
  `,
  elegant: `
    body { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; }
    .business-name { font-size: 26px; font-weight: 700; font-style: italic; letter-spacing: 0.5px; }
    .biz-meta { font-weight: 400; font-style: italic; }
    .line { border-top: 3px double #000; margin: 8px 0; }
    .meta, .meta .row, .sums, .pay, .row { font-weight: 400; }
    .total-row { font-weight: 700; border-top: 3px double #000; border-bottom: 3px double #000; }
    .footer { font-style: italic; font-weight: 400; font-size: 14px; }
    .terms-title { font-variant: small-caps; font-weight: 700; }
  `,
  typewriter: `
    body { font-family: 'Courier New', Courier, monospace; font-size: 14px; font-weight: 700; }
    .business-name { font-size: 20px; text-transform: uppercase; letter-spacing: 2px; }
    .line { border: 0; margin: 4px 0; height: 1em; overflow: hidden; }
    .line::before { content: "========================================"; display: block; white-space: nowrap; }
    .meta, .meta .row { text-transform: uppercase; font-size: 13px; }
    .items .item { font-size: 14px; }
    .item-name { text-transform: uppercase; }
    .total-row { border-top: 2px dashed #000; border-bottom: 2px dashed #000; font-size: 20px; text-transform: uppercase; }
    .footer { text-transform: uppercase; }
    .terms { border-top: 0; }
  `,
  minimal: `
    body { font-weight: 400; padding: 4mm 3mm 6mm; }
    .business-name { font-size: 20px; font-weight: 700; letter-spacing: 1.5px; margin-bottom: 4px; }
    .biz-meta { font-weight: 400; }
    .line { border: 0; margin: 10px 0; }
    .meta, .meta .row, .row, .sums, .pay { font-weight: 400; }
    .items .item { margin-bottom: 7px; }
    .total-row { border: 0; font-weight: 700; font-size: 20px; padding: 2px 0; }
    .footer { font-weight: 400; margin-top: 12px; }
    .terms { border-top: 0; margin-top: 12px; }
    .powered { font-weight: 400; }
  `,
  boxed: `
    .receipt-wrap { border: 2px solid #000; padding: 0 3mm 3mm; }
    .head { margin: 0 -3mm; }
    .business-name { background: #000; color: #fff !important; margin: 0 0 4px; padding: 6px 4px; }
    .line { border-top: 1px solid #000; }
    .total-row { border: 2px solid #000; padding: 5px 6px; }
  `,
  table: `
    .items .item { display: none; }
    .items-table { display: table; width: 100%; border-collapse: collapse; font-size: 14px; }
    .items-table th { text-align: left; font-size: 12px; font-weight: 800; border-bottom: 1px solid #000; padding: 2px 0; }
    .items-table td { font-weight: 400; padding: 3px 0; vertical-align: top; }
    .items-table .q { width: 9mm; }
    .items-table .a { text-align: right; white-space: nowrap; padding-left: 4px; }
    .line { border-top: 1px solid #000; }
  `,
  branded: `
    img.shop-logo { max-height: 34mm; margin: 2mm auto 4px; }
    .business-name { font-size: 22px; letter-spacing: 1px; }
    .line { border-top: 1px dashed #000; margin: 9px 0; }
    .meta { font-weight: 400; }
    .meta .row { font-weight: 400; }
    .total-row { border-top: 2px solid #000; border-bottom: 0; }
    .footer { font-size: 15px; margin-top: 10px; }
  `,
};

/** The receipt body (no <html> wrapper) for a template. */
export function receiptBodyHtml(d: ReceiptPaperData, template: ReceiptTemplateId): string {
  const t = receiptTemplateId(template);
  const showLogo = t === "branded" && !!d.logoUrl;
  const row = (k: string, v: string, cls = "") => `<div class="row"><span>${esc(k)}</span><span class="${cls}">${esc(v)}</span></div>`;
  const items = d.items.map((i) => `
    <div class="item">
      <div class="item-row"><span class="item-name" data-qty="${esc(i.quantity)}">${esc(i.name)}${i.wholesale ? '<span class="w">[W]</span>' : ""}</span><span>${esc(d.money(i.price * i.quantity))}</span></div>
      <div class="item-qty">${esc(i.quantity)} × ${esc(d.money(i.price))}</div>
    </div>`).join("");
  const table = `<table class="items-table"><thead><tr><th class="q">Qty</th><th>Item</th><th class="a">Amount</th></tr></thead><tbody>${
    d.items.map((i) => `<tr><td class="q">${esc(i.quantity)}</td><td>${esc(i.name)}${i.wholesale ? " [W]" : ""}<br/><small>@ ${esc(d.money(i.price))}</small></td><td class="a">${esc(d.money(i.price * i.quantity))}</td></tr>`).join("")
  }</tbody></table>`;
  const terms = (d.terms || "").trim();
  return `
    <div class="head">
      ${showLogo ? `<img class="shop-logo" src="${esc(d.logoUrl)}" alt="" />` : ""}
      <div class="business-name">${esc(d.businessName)}</div>
      ${d.payLine ? `<div class="biz-meta pay">${esc(d.payLine)}</div>` : ""}
      ${d.address ? `<div class="biz-meta">${esc(d.address)}</div>` : ""}
      ${d.phone ? `<div class="biz-meta">Tel: ${esc(d.phone)}</div>` : ""}
      <div class="line"></div>
    </div>
    <div class="meta">
      ${row("Date:", d.date)}${row("Time:", d.time)}${row("Cashier:", d.cashier)}${row("Customer:", d.customer)}${row("Receipt #:", d.receiptNo, "bold")}
    </div>
    <div class="line"></div>
    <div class="items">${items}${table}</div>
    <div class="line"></div>
    <div class="sums">
      ${row("Subtotal", d.subtotal)}
      ${d.vat ? row("VAT (incl.)", d.vat) : ""}
      ${d.discount ? row("Discount", `-${d.discount}`) : ""}
    </div>
    <div class="total-row"><span>TOTAL</span><span>${esc(d.total)}</span></div>
    <div class="pay">
      ${row("Payment:", d.payment, "upper")}
      ${d.mpesaRef ? row("M-Pesa Ref:", d.mpesaRef) : ""}
      ${d.tendered ? row("Cash Tendered:", d.tendered) + row("Change:", d.change || "") : ""}
    </div>
    <div class="line"></div>
    ${d.footer ? `<div class="footer">${esc(d.footer)}</div>` : ""}
    ${terms ? `<div class="terms"><div class="terms-title">TERMS &amp; CONDITIONS</div>${esc(terms)}</div>` : ""}
    `;
}

/** A complete printable HTML document for the receipt. */
export function receiptDocumentHtml(d: ReceiptPaperData, template: ReceiptTemplateId, extraCss = ""): string {
  const t = receiptTemplateId(template);
  return `<!DOCTYPE html><html><head><title>Receipt</title><meta charset="utf-8" />
<style>${BASE_CSS}${TEMPLATE_CSS[t]}${extraCss}</style></head>
<body class="t-${t}"><div class="receipt-wrap">${receiptBodyHtml(d, t)}</div></body></html>`;
}

/** Made-up sale used for the template previews in Settings. */
export function sampleReceipt(over: Partial<ReceiptPaperData> & { money: (n: number) => string }): ReceiptPaperData {
  const m = over.money;
  const items = [
    { name: "Milk 500ml", quantity: 2, price: 65 },
    { name: "Bread Loaf 400g", quantity: 1, price: 70 },
    { name: "Sugar 1kg", quantity: 1, price: 180 },
  ];
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    businessName: "Your Shop",
    date: "04/10/2026", time: "10:24 AM", cashier: "Cashier", customer: "Walk-in",
    receiptNo: "A1B2C3D4", items, subtotal: m(total), total: m(total),
    payment: "cash", tendered: m(500), change: m(500 - total),
    footer: "Thank you for shopping with us!",
    ...over,
  };
}
