// ---------------------------------------------------------------------------
// One classic document design for the whole system (invoices, quotes,
// purchase orders, statements, delivery notes, reports). Every document
// takes the shop's own theme colour, logo and details.
//
//   openDocument(spec)      -> opens it on screen with Print / Save as PDF
//   downloadDocument(spec)  -> saves a PDF file with the same layout
// ---------------------------------------------------------------------------
import { formatKES, currencyCode } from "@/lib/format";

export type DocBusiness = {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  taxPin?: string | null;
  logoUrl?: string | null;
  footer?: string | null;
  /** How to pay, e.g. "M-Pesa Paybill 400200, Account 1205565". */
  payment?: string | null;
};

export type DocColumn = { label: string; align?: "left" | "right" | "center"; width?: number };

export type DocSpec = {
  /** e.g. "Invoice", "Quotation", "Purchase Order". */
  title: string;
  number?: string;
  status?: string;
  business: DocBusiness;
  /** Right-hand details: [["Date", "12 Oct 2026"], ["Due", "…"]]. */
  meta?: [string, string][];
  /** Boxes such as "Bill to" / "Supplier" / "Deliver to". */
  parties?: { label: string; lines: (string | null | undefined)[] }[];
  columns: DocColumn[];
  rows: (string | number)[][];
  /** Totals: [label, value, emphasised?]. */
  totals?: [string, string, boolean?][];
  /** Grand total in words (optional). */
  amountInWords?: number;
  notes?: string | null;
  /** Extra titled blocks, e.g. terms. */
  sections?: { title: string; body: string }[];
  signatures?: string[];
  filename?: string;
};

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The shop's theme colour, read live from the page (falls back to a deep green). */
export function themeHex(): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    const m = raw.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    if (!m) return "#1f7a4a";
    const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return "#" + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  } catch {
    return "#1f7a4a";
  }
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** "One thousand two hundred and fifty" for the totals line. */
export function amountWords(n: number): string {
  const whole = Math.floor(Math.abs(n)), cents = Math.round((Math.abs(n) - whole) * 100);
  const a = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const b = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const chunk = (x: number): string => {
    const h = Math.floor(x / 100), r = x % 100;
    const t = r < 20 ? a[r] : `${b[Math.floor(r / 10)]}${r % 10 ? "-" + a[r % 10] : ""}`;
    return [h ? `${a[h]} hundred` : "", t].filter(Boolean).join(h && t ? " and " : "");
  };
  if (whole === 0) return `Zero${cents ? ` and ${cents}/100` : ""}`;
  const parts: string[] = [];
  [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"], [1, ""]].forEach(([v, w]) => {
    const c = Math.floor(whole / (v as number)) % 1000;
    if (c) parts.push(`${chunk(c)}${w ? ` ${w}` : ""}`);
  });
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${cents ? ` and ${cents}/100` : ""} only`;
}

/** Business details from business settings + tenant. */
export function businessFrom(biz: any, tenant?: any): DocBusiness {
  const code = biz?.mpesa_till_number ? `M-Pesa Till ${biz.mpesa_till_number}`
    : biz?.mpesa_shortcode ? `M-Pesa Paybill ${biz.mpesa_shortcode}${biz.mpesa_account_reference ? `, Account ${biz.mpesa_account_reference}` : ""}` : "";
  return {
    name: biz?.business_name || tenant?.business_name || "Our shop",
    address: biz?.business_address, phone: biz?.business_phone, email: biz?.business_email,
    taxPin: biz?.tax_pin, logoUrl: tenant?.logo_url || null, footer: biz?.receipt_footer, payment: code || null,
  };
}

// ------------------------------------------------------------------ HTML

export function documentHtml(spec: DocSpec, opts: { toolbar?: boolean } = {}): string {
  const c = themeHex();
  const b = spec.business;
  const cols = spec.columns;
  const al = (i: number) => cols[i]?.align || "left";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.title)}${spec.number ? ` ${esc(spec.number)}` : ""} · ${esc(b.name)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #eef0f2; color: #1d2329; font: 13px/1.55 Georgia, "Times New Roman", serif; }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #1d2329; }
  .bar button { font: 600 13px system-ui, sans-serif; border: 0; border-radius: 8px; padding: 8px 16px; cursor: pointer; background: #fff; color: #1d2329; }
  .bar button.main { background: ${c}; color: #fff; }
  .page { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 16mm 15mm; background: #fff; box-shadow: 0 6px 30px rgba(0,0,0,.12); position: relative; }
  .top { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 3px double ${c}; }
  .brand { display: flex; gap: 14px; align-items: flex-start; }
  .brand img { width: 64px; height: 64px; object-fit: contain; }
  .brand h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .5px; color: ${c}; font-weight: 700; }
  .brand p { margin: 0; font: 12px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; color: #4a545e; }
  .title { text-align: right; }
  .title h2 { margin: 0; font-size: 26px; letter-spacing: 6px; text-transform: uppercase; color: #1d2329; font-weight: 400; }
  .title .no { margin-top: 4px; font: 600 13px system-ui, sans-serif; color: ${c}; }
  .status { display: inline-block; margin-top: 6px; padding: 2px 10px; border: 1px solid ${c}; color: ${c}; border-radius: 99px; font: 600 10px system-ui, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; }
  .row2 { display: flex; justify-content: space-between; gap: 18px; margin: 18px 0 16px; }
  .party { flex: 1; border: 1px solid #d8dde2; border-top: 3px solid ${c}; padding: 10px 12px; font: 12.5px/1.55 system-ui, sans-serif; }
  .party h4, .meta h4 { margin: 0 0 4px; font: 700 10px system-ui, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: ${c}; }
  .party .main { font-weight: 700; font-size: 13.5px; color: #1d2329; }
  .meta { min-width: 210px; font: 12.5px system-ui, sans-serif; }
  .meta table { width: 100%; border-collapse: collapse; }
  .meta td { padding: 3px 0; border-bottom: 1px dotted #cfd5da; }
  .meta td:last-child { text-align: right; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; font: 12.5px system-ui, sans-serif; }
  table.items thead th { background: ${c}; color: #fff; padding: 8px 10px; font-weight: 600; letter-spacing: .3px; }
  table.items tbody td { padding: 7px 10px; border-bottom: 1px solid #e3e7ea; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #f7f8f9; }
  .sum { display: flex; justify-content: space-between; gap: 24px; margin-top: 14px; }
  .words { flex: 1; font-style: italic; color: #4a545e; padding-top: 6px; }
  .words b { font-style: normal; color: #1d2329; display: block; font: 700 10px system-ui, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 2px; color: ${c}; }
  table.totals { min-width: 260px; border-collapse: collapse; font: 13px system-ui, sans-serif; }
  table.totals td { padding: 5px 10px; }
  table.totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  table.totals tr.strong td { border-top: 2px solid ${c}; border-bottom: 3px double ${c}; font-weight: 800; font-size: 15px; color: ${c}; }
  .block { margin-top: 18px; font: 12.5px/1.6 system-ui, sans-serif; }
  .block h4 { margin: 0 0 4px; font: 700 10px system-ui, sans-serif; letter-spacing: 1.5px; text-transform: uppercase; color: ${c}; }
  .pay { border: 1px dashed ${c}; padding: 8px 12px; display: inline-block; }
  .sign { display: flex; gap: 40px; margin-top: 44px; font: 11.5px system-ui, sans-serif; color: #4a545e; }
  .sign div { flex: 1; border-top: 1px solid #1d2329; padding-top: 4px; }
  .foot { margin-top: 30px; padding-top: 10px; border-top: 1px solid #d8dde2; text-align: center; font: 11px system-ui, sans-serif; color: #6a737c; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  @media print { body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; width: auto; min-height: 0; padding: 0; } }
  @media (max-width: 820px) { .page { width: auto; margin: 8px; padding: 18px; } .top, .row2, .sum { flex-direction: column; } .title { text-align: left; } }
</style></head><body>
${opts.toolbar ? `<div class="bar"><button class="main" onclick="window.print()">Print</button><button onclick="window.print()">Save as PDF</button><button onclick="window.close()">Close</button></div>` : ""}
<div class="page">
  <div class="top">
    <div class="brand">
      ${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="">` : ""}
      <div>
        <h1>${esc(b.name)}</h1>
        <p>${[b.address, [b.phone, b.email].filter(Boolean).join(" · "), b.taxPin ? `Tax PIN: ${b.taxPin}` : ""].filter(Boolean).map(esc).join("<br>")}</p>
      </div>
    </div>
    <div class="title">
      <h2>${esc(spec.title)}</h2>
      ${spec.number ? `<div class="no">No. ${esc(spec.number)}</div>` : ""}
      ${spec.status ? `<div class="status">${esc(spec.status)}</div>` : ""}
    </div>
  </div>
  ${(spec.parties?.length || spec.meta?.length) ? `<div class="row2">
    ${(spec.parties || []).map((p) => `<div class="party"><h4>${esc(p.label)}</h4>${p.lines.filter(Boolean).map((l, i) => `<div${i === 0 ? ' class="main"' : ""}>${esc(l)}</div>`).join("")}</div>`).join("")}
    ${spec.meta?.length ? `<div class="meta"><h4>Details</h4><table>${spec.meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></div>` : ""}
  </div>` : `<div style="height:16px"></div>`}
  <table class="items">
    <thead><tr>${cols.map((col, i) => `<th style="text-align:${al(i)}${col.width ? `;width:${col.width}%` : ""}">${esc(col.label)}</th>`).join("")}</tr></thead>
    <tbody>${spec.rows.length ? spec.rows.map((r) => `<tr>${r.map((cell, i) => `<td style="text-align:${al(i)}"${al(i) === "right" ? ' class="num"' : ""}>${esc(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" style="text-align:center;color:#8a939b;padding:18px">Nothing to show</td></tr>`}</tbody>
  </table>
  ${spec.totals?.length || spec.amountInWords !== undefined ? `<div class="sum">
    <div class="words">${spec.amountInWords !== undefined ? `<b>Amount in words</b>${esc(currencyCode())} ${esc(amountWords(spec.amountInWords))}` : ""}</div>
    ${spec.totals?.length ? `<table class="totals">${spec.totals.map(([k, v, s]) => `<tr${s ? ' class="strong"' : ""}><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
  </div>` : ""}
  ${spec.notes ? `<div class="block"><h4>Notes</h4>${esc(spec.notes).replace(/\n/g, "<br>")}</div>` : ""}
  ${(spec.sections || []).map((s) => `<div class="block"><h4>${esc(s.title)}</h4>${esc(s.body).replace(/\n/g, "<br>")}</div>`).join("")}
  ${b.payment ? `<div class="block"><h4>How to pay</h4><div class="pay">${esc(b.payment)}</div></div>` : ""}
  ${spec.signatures?.length ? `<div class="sign">${spec.signatures.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}
  <div class="foot">${esc(b.footer || "Thank you for your business.")}<br>${esc(b.name)}${b.phone ? ` · ${esc(b.phone)}` : ""} · Generated ${esc(new Date().toLocaleString())}</div>
</div></body></html>`;
}

/** Opens the document on screen (new tab) with Print and Save as PDF buttons. */
export function openDocument(spec: DocSpec) {
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups for this site to view documents."); return; }
  w.document.open();
  w.document.write(documentHtml(spec, { toolbar: true }));
  w.document.close();
}

// ------------------------------------------------------------------ PDF

async function imageData(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

/** Saves the same classic layout as a PDF file. */
export async function downloadDocument(spec: DocSpec) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const [r, g, bl] = hexRgb(themeHex());
  const W = doc.internal.pageSize.getWidth();
  const b = spec.business;
  let x = 14;
  if (b.logoUrl) {
    const img = await imageData(b.logoUrl);
    if (img) { try { doc.addImage(img, 14, 12, 18, 18); x = 36; } catch { /* unsupported image */ } }
  }
  doc.setFont("times", "bold"); doc.setFontSize(18); doc.setTextColor(r, g, bl);
  doc.text(b.name, x, 19);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(80);
  [b.address, [b.phone, b.email].filter(Boolean).join(" · "), b.taxPin ? `Tax PIN: ${b.taxPin}` : ""].filter(Boolean)
    .forEach((l, i) => doc.text(String(l), x, 24 + i * 4));
  doc.setFont("times", "normal"); doc.setFontSize(20); doc.setTextColor(30);
  doc.text(spec.title.toUpperCase(), W - 14, 19, { align: "right", charSpace: 1.5 });
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(r, g, bl);
  if (spec.number) doc.text(`No. ${spec.number}`, W - 14, 25, { align: "right" });
  if (spec.status) { doc.setFontSize(8); doc.text(spec.status.toUpperCase(), W - 14, 30, { align: "right" }); }
  doc.setDrawColor(r, g, bl); doc.setLineWidth(0.8); doc.line(14, 36, W - 14, 36); doc.setLineWidth(0.25); doc.line(14, 37.3, W - 14, 37.3);

  let y = 44;
  const parties = spec.parties || [];
  const boxW = parties.length ? (W - 28 - (spec.meta?.length ? 68 : 0) - (parties.length - 1) * 5) / parties.length : 0;
  let maxH = 0;
  parties.forEach((p, i) => {
    const px = 14 + i * (boxW + 5);
    const lines = p.lines.filter(Boolean) as string[];
    const h = 9 + lines.length * 4.6;
    maxH = Math.max(maxH, h);
    doc.setDrawColor(210); doc.rect(px, y, boxW, h); doc.setFillColor(r, g, bl); doc.rect(px, y, boxW, 1.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(r, g, bl); doc.text(p.label.toUpperCase(), px + 3, y + 5.5);
    lines.forEach((l, j) => { doc.setFont("helvetica", j === 0 ? "bold" : "normal"); doc.setFontSize(j === 0 ? 10 : 9); doc.setTextColor(35); doc.text(String(l), px + 3, y + 10.5 + j * 4.6); });
  });
  if (spec.meta?.length) {
    const mx = W - 14 - 64;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(r, g, bl); doc.text("DETAILS", mx, y + 4);
    spec.meta.forEach(([k, v], i) => {
      const yy = y + 9.5 + i * 5.2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80); doc.text(k, mx, yy);
      doc.setFont("helvetica", "bold"); doc.setTextColor(35); doc.text(String(v), W - 14, yy, { align: "right" });
      doc.setDrawColor(215); doc.setLineDashPattern([0.5, 0.8], 0); doc.line(mx, yy + 1.4, W - 14, yy + 1.4); doc.setLineDashPattern([], 0);
    });
    maxH = Math.max(maxH, 10 + spec.meta.length * 5.2);
  }
  y += maxH + 6;

  autoTable(doc, {
    startY: y,
    head: [spec.columns.map((c) => c.label)],
    body: spec.rows.map((row) => row.map(String)),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.4, lineColor: [225, 229, 232], lineWidth: 0.15, textColor: 35 },
    headStyles: { fillColor: [r, g, bl], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 249] },
    columnStyles: Object.fromEntries(spec.columns.map((c, i) => [i, { halign: c.align || "left", ...(c.width ? { cellWidth: (W - 28) * (c.width / 100) } : {}) }])),
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  if (spec.totals?.length) {
    const tx = W - 14 - 78;
    spec.totals.forEach(([k, v, strong]) => {
      if (y > 275) { doc.addPage(); y = 20; }
      if (strong) { doc.setDrawColor(r, g, bl); doc.setLineWidth(0.5); doc.line(tx, y - 3.8, W - 14, y - 3.8); }
      doc.setFont("helvetica", strong ? "bold" : "normal"); doc.setFontSize(strong ? 11 : 9.5); doc.setTextColor(strong ? r : 50, strong ? g : 50, strong ? bl : 50);
      doc.text(k, tx + 2, y); doc.text(v, W - 16, y, { align: "right" });
      if (strong) { doc.line(tx, y + 2, W - 14, y + 2); doc.line(tx, y + 2.8, W - 14, y + 2.8); doc.setLineWidth(0.25); }
      y += strong ? 8 : 5.5;
    });
  }
  if (spec.amountInWords !== undefined) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(r, g, bl); doc.text("AMOUNT IN WORDS", 14, y);
    doc.setFont("times", "italic"); doc.setFontSize(10); doc.setTextColor(70);
    const words = doc.splitTextToSize(`${currencyCode()} ${amountWords(spec.amountInWords)}`, W - 28); doc.text(words, 14, y + 5); y += 6 + words.length * 4.5;
  }
  const block = (title: string, body: string) => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(r, g, bl); doc.text(title.toUpperCase(), 14, y + 4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(50);
    const t = doc.splitTextToSize(body, W - 28); doc.text(t, 14, y + 9); y += 10 + t.length * 4.3;
  };
  if (spec.notes) block("Notes", spec.notes);
  (spec.sections || []).forEach((s) => block(s.title, s.body));
  if (b.payment) block("How to pay", b.payment);
  if (spec.signatures?.length) {
    y = Math.max(y + 14, y);
    if (y > 268) { doc.addPage(); y = 30; }
    const sw = (W - 28 - (spec.signatures.length - 1) * 12) / spec.signatures.length;
    spec.signatures.forEach((s, i) => { const sx = 14 + i * (sw + 12); doc.setDrawColor(40); doc.line(sx, y, sx + sw, y); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(s, sx, y + 4); });
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`${b.footer || "Thank you for your business."}  ·  ${b.name}  ·  Page ${i} of ${pages}`, W / 2, 289, { align: "center" });
  }
  doc.save(spec.filename || `${spec.title.replace(/\s+/g, "-")}${spec.number ? `-${spec.number}` : ""}.pdf`);
}

export const money = (n: number) => formatKES(Number(n) || 0);
