import { ZERO_DECIMAL } from "./currencies";

// The shop's trading currency. Set once its settings load (and remembered on
// this device so the first screen already shows the right currency).
const CURRENCY_KEY = "shop-currency";
let currency = (() => {
  try { return localStorage.getItem(CURRENCY_KEY) || "KES"; } catch { return "KES"; }
})();

export const currencyCode = (): string => currency;
export const setCurrency = (code?: string | null) => {
  const next = /^[A-Z]{3}$/.test(String(code || "")) ? String(code) : "KES";
  if (next === currency) return;
  currency = next;
  try { localStorage.setItem(CURRENCY_KEY, next); } catch { /* per-device convenience only */ }
};

/** Money in the shop's currency, e.g. "KES 1,250.00" or "UGX 45,000". */
export const formatKES = (amount: number): string => {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return `${currency} ${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
export const formatMoney = formatKES;

/** Whole amount for tight spaces such as product cards. */
export const formatKESWhole = (amount: number): string => {
  return `${currency} ${Math.round(Number(amount || 0)).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

export const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
};

export const validateKenyanPhone = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, '');
  return /^(254|0)(7|1)\d{8}$/.test(cleaned);
};

export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('254')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+254${cleaned.slice(1)}`;
  return phone;
};
