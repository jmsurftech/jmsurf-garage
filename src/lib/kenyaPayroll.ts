/**
 * Kenyan payroll: PAYE, NSSF, SHIF, Affordable Housing Levy, NITA and reliefs.
 *
 * Defaults follow the law as of October 2026 (owners can change every rate in
 * System → HRM configuration when KRA, NSSF or SHA change them):
 *  - PAYE monthly bands 10% / 25% / 30% / 32.5% / 35%, personal relief 2,400.
 *  - NSSF Act 2013, year 4 (from Feb 2026): 6% employee + 6% employer of pay
 *    between nothing and the upper earnings limit (Tier I up to the lower limit).
 *  - SHIF 2.75% of gross, at least 300. Housing Levy 1.5% + 1.5% employer.
 *  - NSSF, SHIF and the Housing Levy are deducted before PAYE (Tax Laws
 *    (Amendment) Act 2024), as are pension (with NSSF, up to 30,000) and
 *    mortgage interest (up to 30,000). Insurance relief 15% up to 5,000; the premium itself comes off net pay.
 *  - Registered disability: the first 150,000 a month is tax free.
 *  - NITA: 50 a month per employee, paid by the employer.
 *  - Contracted out of NSSF Tier II: the employee and employer Tier II (or part
 *    of it) go to a private pension scheme instead of NSSF. The deduction and
 *    the tax are the same; only where the money is sent changes.
 *  - Post-retirement medical fund (PRMF) contributions are tax free up to
 *    15,000 a month. Non-cash benefits are taxed only above 5,000 a month and
 *    are not paid out.
 */
export interface PayrollRates {
  paye_bands: { upto: number | null; rate: number }[];
  personal_relief: number;
  insurance_relief_rate: number;
  insurance_relief_cap: number;
  nssf_rate: number;
  nssf_lower_limit: number;
  nssf_upper_limit: number;
  shif_rate: number;
  shif_min: number;
  housing_rate: number;
  housing_employer_rate: number;
  nita: number;
  pension_cap: number;
  mortgage_cap: number;
  disability_exemption: number;
  overtime_rate: number;
  working_days: number;
  prmf_cap: number;
  benefit_exempt: number;
}

export const DEFAULT_RATES: PayrollRates = {
  paye_bands: [
    { upto: 24000, rate: 10 }, { upto: 32333, rate: 25 }, { upto: 500000, rate: 30 }, { upto: 800000, rate: 32.5 }, { upto: null, rate: 35 },
  ],
  personal_relief: 2400,
  insurance_relief_rate: 15,
  insurance_relief_cap: 5000,
  nssf_rate: 6,
  nssf_lower_limit: 9000,
  nssf_upper_limit: 108000,
  shif_rate: 2.75,
  shif_min: 300,
  housing_rate: 1.5,
  housing_employer_rate: 1.5,
  nita: 50,
  pension_cap: 30000,
  mortgage_cap: 30000,
  disability_exemption: 150000,
  overtime_rate: 1.5,
  working_days: 26,
  prmf_cap: 15000,
  benefit_exempt: 5000,
};

export function mergeRates(saved: unknown): PayrollRates {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<PayrollRates>;
  const out = { ...DEFAULT_RATES, ...s };
  if (!Array.isArray(out.paye_bands) || !out.paye_bands.length) out.paye_bands = DEFAULT_RATES.paye_bands;
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** PAYE before reliefs for a monthly taxable pay. */
export function payeGross(taxable: number, bands: PayrollRates["paye_bands"]) {
  let tax = 0, lower = 0;
  for (const b of bands) {
    const top = b.upto ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, top) - lower) * (b.rate / 100);
    lower = top;
    if (taxable <= top) break;
  }
  return tax;
}

export interface PayInput {
  basic: number;
  allowances: { name: string; amount: number; taxable: boolean }[];
  deductions: { name: string; amount: number }[];
  loanDeduction: number;
  overtimePay?: number;
  unpaidLeaveDeduction?: number;
  pension?: number;
  mortgageInterest?: number;
  insurancePremium?: number;
  helb?: number;
  disability?: boolean;
  /** Post-retirement medical fund contribution deducted from pay. */
  prmf?: number;
  /** Non-cash benefits (car, housing, meals …): taxed above the exempt amount, never paid out. */
  nonCashBenefits?: number;
  /** Pay net to the whole shilling (statutory lines stay exact). */
  roundNet?: boolean;
  /** Share of NSSF Tier II (0–100) sent to a private pension scheme instead of NSSF. */
  nssfSchemePct?: number;
}

export interface Payslip {
  basic: number;
  allowances: { name: string; amount: number; taxable: boolean }[];
  overtime: number;
  unpaid_leave: number;
  gross: number;
  nssf: number;
  nssf_tier1: number;
  nssf_tier2: number;
  /** Part of the employee's Tier II sent to the private scheme (inside nssf, not on top of it). */
  nssf_scheme: number;
  /** Part of the employer's Tier II sent to the private scheme (inside employer_nssf). */
  employer_nssf_scheme: number;
  nssf_scheme_pct: number;
  shif: number;
  housing_levy: number;
  pension: number;
  mortgage: number;
  prmf: number;
  benefits_noncash: number;
  benefits_taxed: number;
  net_rounding: number;
  taxable_pay: number;
  tax_before_relief: number;
  personal_relief: number;
  insurance_relief: number;
  paye: number;
  /** Life/health insurance premium the employer pays over for the employee: taken from net pay (it also earns the relief). */
  insurance: number;
  helb: number;
  loan_deductions: number;
  other_deductions: { name: string; amount: number }[];
  total_deductions: number;
  net_pay: number;
  employer_nssf: number;
  employer_housing: number;
  nita: number;
  employer_cost: number;
}

export function computePayslip(input: PayInput, rates: PayrollRates = DEFAULT_RATES): Payslip {
  const overtime = Math.max(0, input.overtimePay || 0);
  const unpaid = Math.max(0, input.unpaidLeaveDeduction || 0);
  const allowTotal = input.allowances.reduce((a, x) => a + Math.max(0, x.amount), 0);
  const nonTaxable = input.allowances.filter((x) => !x.taxable).reduce((a, x) => a + Math.max(0, x.amount), 0);
  const gross = Math.max(0, input.basic + allowTotal + overtime - unpaid);
  const taxableGross = Math.max(0, gross - nonTaxable);

  const pensionable = Math.min(gross, rates.nssf_upper_limit);
  const tier1 = Math.min(pensionable, rates.nssf_lower_limit) * (rates.nssf_rate / 100);
  const tier2 = Math.max(0, pensionable - rates.nssf_lower_limit) * (rates.nssf_rate / 100);
  const nssf = r2(tier1 + tier2);
  const split = nssfSplit(tier1, tier2, input.nssfSchemePct || 0);
  const shif = gross > 0 ? r2(Math.max(rates.shif_min, gross * (rates.shif_rate / 100))) : 0;
  const housing = r2(gross * (rates.housing_rate / 100));
  const pension = Math.max(0, Math.min(input.pension || 0, Math.max(0, rates.pension_cap - nssf)));
  const mortgage = Math.max(0, Math.min(input.mortgageInterest || 0, rates.mortgage_cap));
  const prmfPaid = Math.max(0, input.prmf || 0);
  const prmfRelief = Math.min(prmfPaid, rates.prmf_cap ?? 15000);
  const benefits = Math.max(0, input.nonCashBenefits || 0);
  const benefitsTaxed = benefits > (rates.benefit_exempt ?? 5000) ? benefits : 0;

  let taxable = Math.max(0, taxableGross + benefitsTaxed - nssf - shif - housing - pension - mortgage - prmfRelief);
  if (input.disability) taxable = Math.max(0, taxable - rates.disability_exemption);
  const before = payeGross(taxable, rates.paye_bands);
  const insRelief = Math.min((input.insurancePremium || 0) * (rates.insurance_relief_rate / 100), rates.insurance_relief_cap);
  const paye = r2(Math.max(0, before - rates.personal_relief - insRelief));
  const others = input.deductions.filter((d) => d.amount > 0);
  const helb = Math.max(0, input.helb || 0);
  const insurance = Math.max(0, input.insurancePremium || 0);
  const totalDed = r2(nssf + shif + housing + paye + pension + prmfPaid + insurance + helb + input.loanDeduction + others.reduce((a, d) => a + d.amount, 0));
  const exactNet = r2(gross - totalDed);
  const net = input.roundNet ? Math.round(exactNet) : exactNet;
  const employerNssf = nssf;
  const employerHousing = r2(gross * (rates.housing_employer_rate / 100));
  return {
    basic: input.basic, allowances: input.allowances, overtime: r2(overtime), unpaid_leave: r2(unpaid), gross: r2(gross),
    nssf, nssf_tier1: r2(tier1), nssf_tier2: r2(tier2), nssf_scheme: split.scheme, employer_nssf_scheme: split.scheme, nssf_scheme_pct: split.pct, shif, housing_levy: housing, pension: r2(pension), mortgage: r2(mortgage),
    prmf: r2(prmfPaid), benefits_noncash: r2(benefits), benefits_taxed: r2(benefitsTaxed), net_rounding: r2(net - exactNet),
    taxable_pay: r2(taxable), tax_before_relief: r2(before), personal_relief: rates.personal_relief, insurance_relief: r2(insRelief), paye,
    insurance: r2(insurance), helb, loan_deductions: r2(input.loanDeduction), other_deductions: others, total_deductions: totalDed,
    net_pay: r2(net), employer_nssf: employerNssf, employer_housing: employerHousing, nita: gross > 0 ? rates.nita : 0,
    employer_cost: r2(gross + employerNssf + employerHousing + (gross > 0 ? rates.nita : 0)),
  };
}

/**
 * Where one side's NSSF (employee or employer, they are equal) goes when part of Tier II is
 * contracted out: Tier I always to NSSF, `pct` % of Tier II to the private scheme, the rest of
 * Tier II to NSSF. The two parts always add up to the full contribution.
 */
export function nssfSplit(tier1: number, tier2: number, pct: number) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const t1 = r2(tier1), t2 = r2(tier2);
  const scheme = r2((t2 * p) / 100);
  return { pct: p, tier1: t1, tier2_nssf: r2(t2 - scheme), scheme, to_nssf: r2(t1 + t2 - scheme) };
}

/** Working days (Mon–Sat by default) between two dates, skipping public holidays. */
export function workingDays(from: string, to: string, holidays: Set<string>, sixDayWeek = true) {
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (wd === 0 || (!sixDayWeek && wd === 6) || holidays.has(iso)) continue;
    n++;
  }
  return n;
}
