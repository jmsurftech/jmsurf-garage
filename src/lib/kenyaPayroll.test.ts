import { describe, expect, it } from "vitest";
import { computePayslip, payeGross, DEFAULT_RATES, workingDays, nssfSplit } from "./kenyaPayroll";

const base = { allowances: [], deductions: [], loanDeduction: 0 };

describe("Kenyan payroll", () => {
  it("taxes a KES 50,000 salary with NSSF, SHIF and Housing Levy deducted before PAYE", () => {
    const p = computePayslip({ ...base, basic: 50000 });
    expect(p.nssf).toBe(3000); // 6% of 9,000 + 6% of 41,000
    expect(p.shif).toBe(1375);
    expect(p.housing_levy).toBe(750);
    expect(p.taxable_pay).toBe(44875);
    expect(p.paye).toBeCloseTo(5845.85, 2);
    expect(p.net_pay).toBeCloseTo(50000 - 3000 - 1375 - 750 - 5845.85, 2);
    expect(p.employer_cost).toBeCloseTo(50000 + 3000 + 750 + 50, 2);
  });

  it("caps NSSF at the upper earnings limit and applies the SHIF minimum", () => {
    expect(computePayslip({ ...base, basic: 300000 }).nssf).toBe(6480);
    expect(computePayslip({ ...base, basic: 8000 }).shif).toBe(300);
  });

  it("owes no PAYE below the personal relief threshold", () => {
    expect(computePayslip({ ...base, basic: 20000 }).paye).toBe(0);
  });

  it("works out band tax", () => {
    expect(payeGross(24000, DEFAULT_RATES.paye_bands)).toBe(2400);
    expect(payeGross(32333, DEFAULT_RATES.paye_bands)).toBeCloseTo(4483.25, 2);
  });

  it("counts working days without Sundays or holidays", () => {
    expect(workingDays("2026-10-19", "2026-10-25", new Set(["2026-10-20"]))).toBe(5);
  });

  it("gives PRMF relief up to the cap and deducts it from pay", () => {
    const a = computePayslip({ ...base, basic: 100000 });
    const b = computePayslip({ ...base, basic: 100000, prmf: 20000 });
    expect(b.prmf).toBe(20000);
    expect(b.taxable_pay).toBeCloseTo(a.taxable_pay - 15000, 2);
    expect(b.net_pay).toBeCloseTo(a.net_pay + (a.paye - b.paye) - 20000, 2);
  });

  it("taxes non-cash benefits only above the exempt amount and never pays them", () => {
    const a = computePayslip({ ...base, basic: 60000, nonCashBenefits: 4000 });
    const b = computePayslip({ ...base, basic: 60000, nonCashBenefits: 8000 });
    expect(a.gross).toBe(60000);
    expect(a.benefits_taxed).toBe(0);
    expect(b.gross).toBe(60000);
    expect(b.taxable_pay).toBeCloseTo(a.taxable_pay + 8000, 2);
  });

  it("rounds net pay to the shilling and records the difference", () => {
    const p = computePayslip({ ...base, basic: 50000, roundNet: true });
    expect(Number.isInteger(p.net_pay)).toBe(true);
    expect(p.net_rounding).toBeCloseTo(p.net_pay - (50000 - p.total_deductions), 2);
  });
  it("takes the insurance premium off net pay and gives 15% relief up to 5,000", () => {
    const without = computePayslip({ ...base, basic: 50000 });
    const p = computePayslip({ ...base, basic: 50000, insurancePremium: 3000 });
    expect(p.insurance_relief).toBe(450);
    expect(p.paye).toBeCloseTo(without.paye - 450, 2);
    expect(p.insurance).toBe(3000);
    expect(p.net_pay).toBeCloseTo(without.net_pay + 450 - 3000, 2);
    expect(computePayslip({ ...base, basic: 300000, insurancePremium: 50000 }).insurance_relief).toBe(5000);
  });

  it("splits NSSF Tier II between NSSF and a private scheme without changing the deduction", () => {
    const a = computePayslip({ ...base, basic: 50000 });
    const b = computePayslip({ ...base, basic: 50000, nssfSchemePct: 100 });
    expect(b.nssf).toBe(a.nssf);
    expect(b.paye).toBe(a.paye);
    expect(b.net_pay).toBe(a.net_pay);
    expect(b.nssf_tier1).toBe(540);
    expect(b.nssf_tier2).toBe(2460);
    expect(b.nssf_scheme).toBe(2460);
    expect(b.employer_nssf_scheme).toBe(2460);
    expect(a.nssf_scheme).toBe(0);
  });

  it("sends only the chosen share of Tier II to the scheme, and the parts add up", () => {
    const s = nssfSplit(540, 2460, 50);
    expect(s.scheme).toBe(1230);
    expect(s.tier2_nssf).toBe(1230);
    expect(s.to_nssf).toBe(1770);
    const odd = nssfSplit(540, 1234.57, 33);
    expect(odd.scheme).toBe(407.41);
    expect(odd.to_nssf + odd.scheme).toBeCloseTo(540 + 1234.57, 2);
  });

  it("keeps Tier I with NSSF and clamps the share to 0–100", () => {
    expect(nssfSplit(540, 0, 100).scheme).toBe(0);
    expect(nssfSplit(540, 0, 100).to_nssf).toBe(540);
    expect(nssfSplit(540, 2460, 150).scheme).toBe(2460);
    expect(nssfSplit(540, 2460, -5).scheme).toBe(0);
    expect(computePayslip({ ...base, basic: 8000, nssfSchemePct: 100 }).nssf_scheme).toBe(0);
  });
});
