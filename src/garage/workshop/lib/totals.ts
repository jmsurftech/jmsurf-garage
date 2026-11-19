/**
 * Money on a job card: line amounts, totals, what the customer approved, and how the
 * job splits into invoices per payer (customer, insurer, fleet). Same rounding as the
 * database (garage_job_totals) and the sales invoice lines.
 */
export type LineKind = "labour" | "part" | "sublet" | "consumable";
export type Payer = "customer" | "insurer" | "fleet";

export interface MoneyLine {
  id?: string;
  kind: LineKind;
  description: string;
  qty: number;
  rate: number;
  discount?: number;
  tax_rate?: number;
  approved?: boolean | null;
  status?: string;
  payer?: Payer;
  item_id?: string | null;
  invoice_id?: string | null;
  priority?: "must" | "advised" | "optional";
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (d: number | undefined) => Math.min(100, Math.max(0, Number(d) || 0));

/** Line amount before tax, after discount. */
export function lineNet(l: MoneyLine): number {
  return r2((Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - pct(l.discount) / 100));
}
export function lineTax(l: MoneyLine): number {
  return r2(lineNet(l) * (Number(l.tax_rate) || 0) / 100);
}
export function lineGross(l: MoneyLine): number {
  return r2(lineNet(l) + lineTax(l));
}

export interface Totals { subtotal: number; tax: number; total: number; labour: number; parts: number; other: number; count: number }

/** Totals of live lines (cancelled left out). `onlyApproved` keeps lines the customer said yes to. */
export function jobTotals(lines: MoneyLine[], opts: { onlyApproved?: boolean } = {}): Totals {
  const live = lines.filter((l) => l.status !== "cancelled" && (!opts.onlyApproved || l.approved === true));
  const t: Totals = { subtotal: 0, tax: 0, total: 0, labour: 0, parts: 0, other: 0, count: live.length };
  for (const l of live) {
    const n = lineNet(l);
    t.subtotal += n;
    t.tax += lineTax(l);
    if (l.kind === "labour") t.labour += n;
    else if (l.kind === "part") t.parts += n;
    else t.other += n;
  }
  t.subtotal = r2(t.subtotal); t.tax = r2(t.tax); t.total = r2(t.subtotal + t.tax);
  t.labour = r2(t.labour); t.parts = r2(t.parts); t.other = r2(t.other);
  return t;
}

/**
 * Lines grouped per payer, ready to become one invoice each. Only approved lines that are
 * not cancelled and not on an invoice yet. A payer with nothing to bill is left out.
 */
export function splitByPayer(lines: MoneyLine[]): { payer: Payer; lines: MoneyLine[]; totals: Totals }[] {
  const order: Payer[] = ["customer", "insurer", "fleet"];
  const out: { payer: Payer; lines: MoneyLine[]; totals: Totals }[] = [];
  for (const payer of order) {
    const ls = lines.filter((l) => (l.payer || "customer") === payer && l.approved === true && l.status !== "cancelled" && !l.invoice_id);
    if (ls.length) out.push({ payer, lines: ls, totals: jobTotals(ls) });
  }
  return out;
}

/**
 * Splits one amount between payers by percentage (e.g. insurer 80, customer 20, or an excess).
 * The last payer takes the rounding so the parts always add up to the whole.
 */
export function splitAmount(total: number, shares: { payer: Payer; percent?: number; fixed?: number }[]): { payer: Payer; amount: number }[] {
  const whole = r2(total);
  const out: { payer: Payer; amount: number }[] = [];
  let left = whole;
  shares.forEach((s, i) => {
    const last = i === shares.length - 1;
    let a = s.fixed !== undefined ? r2(Math.min(s.fixed, left)) : r2(whole * (Number(s.percent) || 0) / 100);
    if (last) a = r2(left);
    a = Math.max(0, Math.min(a, left));
    out.push({ payer: s.payer, amount: r2(a) });
    left = r2(left - a);
  });
  return out;
}

/** Invoice line shape the sales invoices use (items jsonb), from a job line. */
export function toInvoiceItem(l: MoneyLine) {
  return {
    item_id: l.kind === "part" || l.kind === "consumable" ? l.item_id ?? null : null,
    type: l.kind === "part" || l.kind === "consumable" ? (l.item_id ? "product" : "service") : "service",
    name: l.description || (l.kind === "labour" ? "Labour" : "Part"),
    description: "",
    unit: null,
    quantity: Number(l.qty) || 0,
    rate: Number(l.rate) || 0,
    price: Number(l.rate) || 0,
    discount: pct(l.discount),
    tax_rate: Number(l.tax_rate) || 0,
    amount: lineNet(l),
  };
}

/** Estimate summary for the approval page: must-do, advised, and what the customer said yes to. */
export function estimateSummary(lines: (MoneyLine & { decision?: "approved" | "declined" | null })[]) {
  const must = lines.filter((l) => (l.priority || "must") === "must");
  const advised = lines.filter((l) => l.priority === "advised" || l.priority === "optional");
  const yes = lines.filter((l) => l.decision === "approved");
  return {
    must: jobTotals(must).total,
    advised: jobTotals(advised).total,
    all: jobTotals(lines).total,
    approved: jobTotals(yes).total,
    decided: lines.every((l) => l.decision === "approved" || l.decision === "declined"),
  };
}
