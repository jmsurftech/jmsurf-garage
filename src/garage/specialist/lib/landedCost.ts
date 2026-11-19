/**
 * Landed cost: spreads shipment costs (freight, insurance, duty and taxes, port,
 * clearing, transport, inspection…) over the shipment's items by value, weight,
 * volume or count. Amounts are rounded to cents and always add up to the cost.
 */

export type AllocMethod = "value" | "weight" | "volume" | "count";

export const ALLOC_METHODS: { value: AllocMethod; label: string }[] = [
  { value: "value", label: "By value" },
  { value: "weight", label: "By weight" },
  { value: "volume", label: "By volume (CBM)" },
  { value: "count", label: "By count (units)" },
];

export interface AllocItem {
  id: string;
  /** Purchase value of the line in company currency (all units). */
  value: number;
  weight?: number;
  volume?: number;
  /** Units on the line (cars: 1). */
  qty?: number;
}

export interface CostLine {
  name: string;
  /** Company currency. */
  amount: number;
  /** Overrides the shipment's method for this cost (e.g. freight by volume, duty by value). */
  method?: AllocMethod | null;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cents = (v: number) => Math.round(v * 100);

function basis(it: AllocItem, method: AllocMethod): number {
  if (method === "value") return Math.max(0, n(it.value));
  if (method === "weight") return Math.max(0, n(it.weight));
  if (method === "volume") return Math.max(0, n(it.volume));
  return Math.max(0, it.qty === undefined ? 1 : n(it.qty));
}

/**
 * Splits `total` over the items in proportion to the method's basis. When no item has a
 * basis (e.g. weights not entered) it falls back to count. Largest-remainder rounding keeps
 * the sum exact to the cent.
 */
export function allocate(total: number, items: AllocItem[], method: AllocMethod): number[] {
  if (!items.length) return [];
  let weights = items.map((it) => basis(it, method));
  if (weights.reduce((a, b) => a + b, 0) <= 0) weights = items.map((it) => basis(it, "count"));
  if (weights.reduce((a, b) => a + b, 0) <= 0) weights = items.map(() => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const totalC = cents(n(total));
  const raw = weights.map((w) => (totalC * w) / sum);
  const floor = raw.map((r) => Math.floor(r));
  let left = totalC - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) floor[order[k].i] += 1;
  // Negative totals (credits) round the other way.
  for (let k = 0; left < 0 && k < order.length; k++, left++) floor[order[order.length - 1 - k].i] -= 1;
  return floor.map((c) => c / 100);
}

export interface LandedLine {
  id: string;
  value: number;
  qty: number;
  /** Cost name → amount allocated to this line. */
  shares: Record<string, number>;
  extra: number;
  landed: number;
  /** Landed cost per unit. */
  unit: number;
}

/** Allocates every cost line and returns each item's landed total and unit cost. */
export function landedCosts(items: AllocItem[], costs: CostLine[], method: AllocMethod): LandedLine[] {
  const out: LandedLine[] = items.map((it) => ({ id: it.id, value: n(it.value), qty: Math.max(1, n(it.qty ?? 1)), shares: {}, extra: 0, landed: 0, unit: 0 }));
  costs.forEach((c, ci) => {
    const amount = n(c.amount);
    if (!amount) return;
    const parts = allocate(amount, items, c.method || method);
    const key = c.name?.trim() || `Cost ${ci + 1}`;
    parts.forEach((p, i) => { out[i].shares[key] = Math.round(((out[i].shares[key] || 0) + p) * 100) / 100; out[i].extra += p; });
  });
  for (const l of out) {
    l.extra = Math.round(l.extra * 100) / 100;
    l.landed = Math.round((l.value + l.extra) * 100) / 100;
    l.unit = Math.round((l.landed / l.qty) * 100) / 100;
  }
  return out;
}

/**
 * Selling price for a target margin on the selling price (margin) or on cost (markup),
 * rounded up to `roundTo` (e.g. 1000 for cars).
 */
export function suggestedPrice(cost: number, pct: number, mode: "margin" | "markup" = "margin", roundTo = 1): number {
  const c = Math.max(0, n(cost));
  const p = n(pct) / 100;
  let price = mode === "margin" ? (p >= 1 ? c : c / (1 - p)) : c * (1 + p);
  const step = Math.max(0.01, n(roundTo) || 1);
  price = Math.ceil(Math.round(price * 100) / 100 / step) * step;
  return Math.round(price * 100) / 100;
}

/** Profit and margin on the selling price. */
export function profitOf(sale: number, cost: number): { profit: number; marginPct: number } {
  const s = n(sale), c = n(cost);
  const profit = Math.round((s - c) * 100) / 100;
  return { profit, marginPct: s > 0 ? Math.round((profit / s) * 10000) / 100 : 0 };
}
