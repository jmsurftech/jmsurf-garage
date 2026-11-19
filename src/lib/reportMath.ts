/**
 * Discount actually given on a sale. On an exchange sale the "discount" field
 * also holds the value of the goods returned (split_payments exchange_credit),
 * which is not a price cut and is left out here.
 */
export function realDiscount(t: { discount?: unknown; split_payments?: unknown }): number {
  const discount = Number(t?.discount || 0);
  const credit = (Array.isArray(t?.split_payments) ? t.split_payments : [])
    .filter((p: any) => p?.method === "exchange_credit")
    .reduce((s: number, p: any) => s + Number(p?.amount || 0), 0);
  return Math.max(0, discount - credit);
}
