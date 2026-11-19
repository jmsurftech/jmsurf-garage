import { formatMoney } from "@/lib/format";

/** Money in the company's currency. */
export const fmtMoney = (n: number) => formatMoney(Number.isFinite(n) ? n : 0);
