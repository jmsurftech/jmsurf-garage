/**
 * Foreign-currency import orders: the order is booked at one exchange rate and each
 * payment (deposit, balance) goes out at its own rate. The difference is the
 * exchange gain (paid fewer shillings than booked) or loss (paid more).
 */

export interface FxPayment {
  /** Foreign currency amount sent. */
  amount_fc: number;
  /** Company currency per one unit of foreign currency on the day it was paid. */
  rate: number;
}

export interface FxSummary {
  /** Order total in company currency at the order rate. */
  bookedLocal: number;
  paidFc: number;
  /** Company currency actually spent on the payments. */
  paidLocal: number;
  /** The paid foreign amount valued at the order rate. */
  paidAtOrderRate: number;
  /** Positive = gain, negative = loss. */
  gainLoss: number;
  balanceFc: number;
  /** Balance still to pay, valued at the order rate. */
  balanceLocal: number;
  /** Weighted average rate of the payments made. */
  averageRate: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function fxSummary(orderFc: number, orderRate: number, payments: FxPayment[]): FxSummary {
  const total = n(orderFc), rate = n(orderRate);
  const paidFc = payments.reduce((a, p) => a + n(p.amount_fc), 0);
  const paidLocal = payments.reduce((a, p) => a + n(p.amount_fc) * n(p.rate || rate), 0);
  const paidAtOrderRate = paidFc * rate;
  const balanceFc = total - paidFc;
  return {
    bookedLocal: r2(total * rate),
    paidFc: r2(paidFc),
    paidLocal: r2(paidLocal),
    paidAtOrderRate: r2(paidAtOrderRate),
    gainLoss: r2(paidAtOrderRate - paidLocal),
    balanceFc: r2(balanceFc),
    balanceLocal: r2(balanceFc * rate),
    averageRate: paidFc > 0 ? Math.round((paidLocal / paidFc) * 10000) / 10000 : 0,
  };
}

/** Currencies import orders are usually placed in (any ISO code can still be typed). */
export const IMPORT_CURRENCIES = ["USD", "JPY", "GBP", "AED", "CNY", "EUR", "ZAR", "THB", "KES"];

export const IMPORT_COUNTRIES = ["Japan", "United Kingdom", "United Arab Emirates", "Thailand", "South Africa", "China", "Singapore", "Other"];
