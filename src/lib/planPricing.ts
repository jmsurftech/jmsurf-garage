// Browser copy of /planPricing.js (the server uses that one) — change both together.
// A water refill shop pays at least KES 1,000 a month; other cycles scale the same way.

export const TYPE_MIN_MONTHLY: Record<string, number> = { water: 1000 };

const MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semi_annually: 6, annually: 12 };
export const cycleMonths = (cycle: string) => MONTHS[cycle] || 1;

const roundTo10 = (n: number) => Math.round(n / 10) * 10;

export interface PricedPlan { id?: string; price_monthly: number; price_quarterly?: number | null; price_semi_annually?: number | null; price_annually?: number | null }

export function planPrice(plan: PricedPlan, cycle: string, businessType?: string | null) {
  const monthly = Number(plan?.price_monthly || 0);
  const direct = Number(({
    monthly: plan?.price_monthly,
    quarterly: plan?.price_quarterly,
    semi_annually: plan?.price_semi_annually,
    annually: plan?.price_annually,
  } as Record<string, unknown>)[cycle]);
  const base = Number.isFinite(direct) && direct > 0 ? direct : monthly * cycleMonths(cycle);
  const floor = TYPE_MIN_MONTHLY[String(businessType || "")] || 0;
  if (!floor || monthly >= floor || monthly <= 0) return base;
  return roundTo10((base * floor) / monthly);
}

/** The shop's agreed monthly price, never below its type's minimum. */
export const shopMonthly = (price: number, businessType?: string | null) =>
  Math.max(price, TYPE_MIN_MONTHLY[String(businessType || "")] || 0);
