import { useBusinessSettings } from "@/hooks/useData";

/** One VAT rate a company charges (System → Taxes). */
export type VatRate = { id: string; name: string; rate: number; active: boolean };

/** System → Taxes: VAT rates, VAT registration and withholding VAT (saved in business_settings.tax_settings). */
export type TaxSettings = {
  registered: boolean;
  regLabel: string;
  regNumber: string;
  registeredOn: string | null;
  firstReturnFrom: string | null;
  period: "monthly" | "quarterly" | "half_yearly" | "yearly";
  defaultRate: number;
  rates: VatRate[];
  withholding: { enabled: boolean; rate: number; appliesTo: "customers" | "vendors" | "both" };
  /** New documents start with prices that include VAT. */
  pricesIncludeTax: boolean;
};

/** Kenya's rates as the defaults: General 16%, Reduced 8%, Zero 0%, plus Exempt. */
export const DEFAULT_RATES: VatRate[] = [
  { id: "general", name: "General Rate", rate: 16, active: true },
  { id: "reduced", name: "Reduced Rate", rate: 8, active: true },
  { id: "zero", name: "Zero Rate", rate: 0, active: true },
];

export const DEFAULT_TAX: TaxSettings = {
  registered: true, regLabel: "PIN", regNumber: "", registeredOn: null, firstReturnFrom: null, period: "monthly",
  defaultRate: 16, rates: DEFAULT_RATES, withholding: { enabled: false, rate: 2, appliesTo: "customers" }, pricesIncludeTax: false,
};

/** Saved settings over the defaults (older companies: their default VAT rate and VAT number). */
export function resolveTax(saved: any, biz?: any): TaxSettings {
  const s = saved && typeof saved === "object" ? saved : {};
  const rates: VatRate[] = Array.isArray(s.rates) && s.rates.length
    ? s.rates.map((r: any, i: number) => ({ id: String(r.id || `r${i}`), name: String(r.name || `VAT ${r.rate}%`), rate: Number(r.rate) || 0, active: r.active !== false }))
    : DEFAULT_RATES;
  return {
    ...DEFAULT_TAX, ...s,
    regNumber: s.regNumber ?? biz?.vat_number ?? biz?.tax_pin ?? "",
    defaultRate: Number(s.defaultRate ?? biz?.default_vat_rate ?? 16),
    rates,
    withholding: { ...DEFAULT_TAX.withholding, ...(s.withholding || {}) },
  };
}

/** The choices for a line's VAT: "Non-taxable" plus every active rate (only "Non-taxable" when not VAT-registered). */
export function vatChoices(t: TaxSettings): { v: number; label: string }[] {
  const out: { v: number; label: string }[] = [{ v: 0, label: "Non-taxable (0%)" }];
  if (!t.registered) return out;
  for (const r of t.rates) if (r.active && r.rate > 0 && !out.some((x) => x.v === r.rate)) out.push({ v: r.rate, label: `${r.name} [${r.rate}%]` });
  return out;
}

/** The company's tax settings, for forms and documents. */
export function useTaxSettings(): TaxSettings {
  const { data: biz } = useBusinessSettings();
  return resolveTax((biz as any)?.tax_settings, biz);
}
