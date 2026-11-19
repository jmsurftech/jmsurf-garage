// Prints small documents (shift summaries and similar) on the same 80mm
// thermal printers as sale receipts, through a hidden iframe so pop-up
// blockers never interfere.
import { formatKES } from "@/lib/format";

const THERMAL_STYLES = `
  @page { size: 80mm auto; margin: 0; }
  @media print { html, body { width: 80mm; margin: 0 !important; padding: 0 !important; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 14px; line-height: 1.4;
    width: 76mm; margin: 0 auto; padding: 2mm 2mm 4mm; font-weight: 700; }
  .center { text-align: center; }
  .title { font-size: 20px; font-weight: 900; text-align: center; margin: 2px 0; }
  .sub { font-size: 13px; text-align: center; margin: 1px 0; }
  .line { border-top: 2px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .muted { font-weight: normal; }
  .total { display: flex; justify-content: space-between; font-size: 20px; font-weight: 900; padding: 4px 0;
    border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 5px 0; }
  .section { font-weight: 900; margin-top: 4px; }
  .footer { text-align: center; font-size: 12px; margin-top: 6px; }
`;

const esc = (value: unknown) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printThermal(title: string, bodyHtml: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const html = `<!DOCTYPE html><html><head><title>${esc(title)}</title><meta charset="utf-8" />
      <style>${THERMAL_STYLES}</style></head><body>${bodyHtml}</body></html>`;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
    document.body.appendChild(frame);
    const cleanup = () => setTimeout(() => { try { document.body.removeChild(frame); } catch { /* already gone */ } }, 1000);
    frame.onload = () => {
      const fw = frame.contentWindow;
      if (!fw) { cleanup(); reject(new Error("Could not open the printer")); return; }
      setTimeout(() => {
        try {
          fw.focus();
          fw.print();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      }, 250);
    };
    frame.srcdoc = html;
  });
}

export type ShiftSummary = {
  shopName: string;
  cashierName: string;
  startedAt: string;
  endedAt: string;
  totalSales: number;
  transactions: number;
  byMethod: { method: string; count: number; amount: number }[];
  topItems: { name: string; quantity: number; amount: number }[];
  itemsSold: number;
  discounts: number;
  cashExpected?: number | null;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", mpesa: "M-Pesa", card: "Card", split: "Split", credit: "Credit",
  mobile_money: "Mobile money", loyalty_points: "Loyalty points",
};

function duration(from: string, to: string) {
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function shiftSummaryHtml(s: ShiftSummary) {
  const methods = s.byMethod
    .map((m) => `<div class="row"><span>${esc(METHOD_LABELS[m.method] || m.method)} (${m.count})</span><span>${esc(formatKES(m.amount))}</span></div>`)
    .join("");
  const items = s.topItems
    .map((i) => `<div class="row muted"><span>${esc(i.name)} x${esc(i.quantity)}</span><span>${esc(formatKES(i.amount))}</span></div>`)
    .join("");
  return `
    <div class="title">${esc(s.shopName)}</div>
    <div class="sub">SHIFT SALES SUMMARY</div>
    <div class="line"></div>
    <div class="row"><span>Cashier</span><span>${esc(s.cashierName)}</span></div>
    <div class="row"><span>Started</span><span>${esc(when(s.startedAt))}</span></div>
    <div class="row"><span>Ended</span><span>${esc(when(s.endedAt))}</span></div>
    <div class="row"><span>Duration</span><span>${esc(duration(s.startedAt, s.endedAt))}</span></div>
    <div class="line"></div>
    <div class="section">Payments</div>
    ${methods || '<div class="muted">No sales</div>'}
    ${s.discounts > 0 ? `<div class="row muted"><span>Discounts given</span><span>${esc(formatKES(s.discounts))}</span></div>` : ""}
    <div class="total"><span>TOTAL</span><span>${esc(formatKES(s.totalSales))}</span></div>
    <div class="row"><span>Sales</span><span>${esc(s.transactions)}</span></div>
    <div class="row"><span>Items sold</span><span>${esc(s.itemsSold)}</span></div>
    ${s.cashExpected != null ? `<div class="row"><span>Cash in drawer (expected)</span><span>${esc(formatKES(s.cashExpected))}</span></div>` : ""}
    ${items ? `<div class="line"></div><div class="section">Top items</div>${items}` : ""}
    <div class="line"></div>
    <div class="footer">Printed ${esc(when(new Date().toISOString()))}</div>
  `;
}

/** Builds the summary numbers for a cashier's completed sales in a shift. */
export function summarizeShiftSales(sales: any[]) {
  const byMethod = new Map<string, { method: string; count: number; amount: number }>();
  const items = new Map<string, { name: string; quantity: number; amount: number }>();
  let total = 0;
  let discounts = 0;
  let itemsSold = 0;
  for (const tx of sales) {
    const amount = Number(tx.total || 0);
    total += amount;
    discounts += Number(tx.discount || 0);
    const method = String(tx.payment_method || "cash");
    const m = byMethod.get(method) || { method, count: 0, amount: 0 };
    m.count += 1;
    m.amount += amount;
    byMethod.set(method, m);
    for (const line of Array.isArray(tx.items) ? tx.items : []) {
      const qty = Number(line.quantity || 0);
      itemsSold += qty;
      const key = String(line.name || line.id || "Item");
      const it = items.get(key) || { name: key, quantity: 0, amount: 0 };
      it.quantity += qty;
      it.amount += qty * Number(line.price || 0);
      items.set(key, it);
    }
  }
  return {
    totalSales: total,
    transactions: sales.length,
    discounts,
    itemsSold,
    byMethod: Array.from(byMethod.values()).sort((a, b) => b.amount - a.amount),
    topItems: Array.from(items.values()).sort((a, b) => b.amount - a.amount).slice(0, 10),
  };
}
