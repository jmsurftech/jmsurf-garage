// Package prices per shop type. Some shop types start higher than the
// package's own price: a water refill shop pays at least KES 1,000 a month.
// The other billing cycles scale by the same factor, so the package's
// quarter / year discounts are kept. Mirrored for the browser in
// src/lib/planPricing.ts — change both together.

export const TYPE_MIN_MONTHLY = { water: 1000 };

const MONTHS = { monthly: 1, quarterly: 3, semi_annually: 6, annually: 12 };
export const cycleMonths = (cycle) => MONTHS[cycle] || 1;

const roundTo10 = (n) => Math.round(n / 10) * 10;

/** Price of one billing cycle of `plan` for a shop of `businessType`. */
export function planPrice(plan, cycle, businessType) {
  const monthly = Number(plan?.price_monthly || 0);
  const direct = Number({
    monthly: plan?.price_monthly,
    quarterly: plan?.price_quarterly,
    semi_annually: plan?.price_semi_annually,
    annually: plan?.price_annually,
  }[cycle]);
  const base = Number.isFinite(direct) && direct > 0 ? direct : monthly * cycleMonths(cycle);
  const floor = TYPE_MIN_MONTHLY[businessType] || 0;
  if (!floor || monthly >= floor || monthly <= 0) return base;
  return roundTo10((base * floor) / monthly);
}

/**
 * What the shop pays for a cycle: its own agreed monthly price on its current
 * package (never below its type's minimum), else the package price.
 */
export function shopCyclePrice(plan, cycle, businessType, subscription) {
  const custom = subscription?.plan_id === plan?.id ? Number(subscription?.price) : NaN;
  // A stored price equal to the package price is not a special deal.
  if (Number.isFinite(custom) && custom > 0 && custom !== Number(plan?.price_monthly)) {
    return Math.max(custom, TYPE_MIN_MONTHLY[businessType] || 0) * cycleMonths(cycle);
  }
  return planPrice(plan, cycle, businessType);
}
