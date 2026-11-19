/**
 * Water refill shop arithmetic shared by the tank page, product form and till.
 * The database (water_tank_purchase / water_set_price) does the same sums;
 * these keep the screens showing what the server will store.
 */

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Buying price after a purchase: weighted average of what's in the tank and what was bought. */
export function weightedCostPerLitre(currentL: number, currentCost: number, boughtL: number, boughtCost: number) {
  const total = Math.max(0, currentL) + Math.max(0, boughtL);
  if (total <= 0) return round(boughtCost, 4);
  return round((Math.max(0, currentL) * currentCost + Math.max(0, boughtL) * boughtCost) / total, 4);
}

/** Selling price of a refill size on automatic pricing. */
export function sizePrice(litres: number, pricePerLitre: number) {
  return round(litres * pricePerLitre, 2);
}

/** Cost of one refill, for profit figures. */
export function sizeCost(litres: number, costPerLitre: number) {
  return round(litres * costPerLitre, 2);
}

/** Litres a cart takes out of each tank. */
export function litresByTank(lines: { tank_id?: string | null; litres?: number | null; quantity: number }[]) {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (!l.tank_id || !l.litres || l.quantity <= 0) continue;
    out[l.tank_id] = round((out[l.tank_id] || 0) + l.litres * l.quantity, 3);
  }
  return out;
}

export type TankLevel = "ok" | "low" | "empty";

export function tankLevel(currentL: number, alertL: number): TankLevel {
  if (currentL <= 0) return "empty";
  if (currentL <= alertL) return "low";
  return "ok";
}

/** Fill percentage for the gauge, 0–100. */
export function tankPercent(currentL: number, capacityL: number) {
  if (capacityL <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((currentL / capacityL) * 100)));
}
