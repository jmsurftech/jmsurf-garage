/**
 * Vehicle import duty from the KRA current retail selling price (CRSP).
 *
 * Every rate here is a company setting (Imports → Settings). The defaults are only
 * starting values for the form: confirm each one with KRA or your clearing agent
 * before relying on the result. Nothing in this file is a statement of the law.
 */

export interface ExciseBand {
  /** Up to and including this engine size (cc); null = any size above the previous band. */
  maxCc: number | null;
  pct: number;
}

export interface DepreciationBand {
  /** Up to and including this age in years. */
  maxAgeYears: number;
  pct: number;
}

export interface DutyRates {
  importDutyPct: number;
  excise: ExciseBand[];
  vatPct: number;
  idfPct: number;
  rdlPct: number;
  /** Depreciation off the CRSP by vehicle age. */
  depreciation: DepreciationBand[];
  /** The CRSP is a retail price that already contains duty, excise and VAT (back them out to find the customs value). */
  crspIncludesTaxes: boolean;
  /** Oldest model year allowed = this year minus this number of years (+1). */
  ageLimitYears: number;
}

/** Starting values only. Edit them in Imports → Settings and confirm with KRA. */
export const DEFAULT_DUTY_RATES: DutyRates = {
  importDutyPct: 25,
  excise: [
    { maxCc: 1500, pct: 20 },
    { maxCc: 3000, pct: 25 },
    { maxCc: null, pct: 35 },
  ],
  vatPct: 16,
  idfPct: 3.5,
  rdlPct: 2,
  depreciation: [
    { maxAgeYears: 1, pct: 5 },
    { maxAgeYears: 2, pct: 20 },
    { maxAgeYears: 3, pct: 30 },
    { maxAgeYears: 4, pct: 40 },
    { maxAgeYears: 5, pct: 50 },
    { maxAgeYears: 6, pct: 55 },
    { maxAgeYears: 7, pct: 60 },
    { maxAgeYears: 8, pct: 65 },
  ],
  crspIncludesTaxes: true,
  ageLimitYears: 8,
};

export const DUTY_NOTE = "Rates are your own settings, not official figures. Confirm every rate with KRA or your clearing agent before quoting a customer.";

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function excisePct(rates: DutyRates, engineCc: number): number {
  const bands = [...(rates.excise || [])].sort((a, b) => (a.maxCc ?? Infinity) - (b.maxCc ?? Infinity));
  for (const b of bands) if (b.maxCc === null || engineCc <= b.maxCc) return n(b.pct);
  return n(bands[bands.length - 1]?.pct);
}

export function depreciationPct(rates: DutyRates, ageYears: number): number {
  const bands = [...(rates.depreciation || [])].sort((a, b) => a.maxAgeYears - b.maxAgeYears);
  if (!bands.length) return 0;
  for (const b of bands) if (ageYears <= b.maxAgeYears) return n(b.pct);
  return n(bands[bands.length - 1].pct);
}

/** Age in whole years from the year (and month) of manufacture to the date of import. */
export function vehicleAge(year: number, month = 1, at: Date = new Date()): number {
  const months = (at.getFullYear() - n(year)) * 12 + (at.getMonth() + 1 - Math.min(12, Math.max(1, n(month) || 1)));
  return Math.max(0, Math.floor(months / 12));
}

export interface DutyResult {
  crsp: number;
  depreciationPct: number;
  depreciatedValue: number;
  customsValue: number;
  importDuty: number;
  excisePct: number;
  excise: number;
  vat: number;
  idf: number;
  rdl: number;
  total: number;
}

export function computeDuty(input: { crsp: number; ageYears: number; engineCc: number; rates: DutyRates }): DutyResult {
  const { rates } = input;
  const crsp = Math.max(0, n(input.crsp));
  const dep = depreciationPct(rates, Math.max(0, n(input.ageYears)));
  const depreciatedValue = crsp * (1 - dep / 100);
  const id = n(rates.importDutyPct) / 100;
  const exPct = excisePct(rates, n(input.engineCc));
  const ex = exPct / 100;
  const vat = n(rates.vatPct) / 100;
  const customsValue = rates.crspIncludesTaxes ? depreciatedValue / ((1 + id) * (1 + ex) * (1 + vat)) : depreciatedValue;
  const importDuty = customsValue * id;
  const excise = (customsValue + importDuty) * ex;
  const vatAmt = (customsValue + importDuty + excise) * vat;
  const idf = customsValue * (n(rates.idfPct) / 100);
  const rdl = customsValue * (n(rates.rdlPct) / 100);
  return {
    crsp: r2(crsp), depreciationPct: dep, depreciatedValue: r2(depreciatedValue), customsValue: r2(customsValue),
    importDuty: r2(importDuty), excisePct: exPct, excise: r2(excise), vat: r2(vatAmt), idf: r2(idf), rdl: r2(rdl),
    total: r2(importDuty + excise + vatAmt + idf + rdl),
  };
}

/** Used-vehicle age rule: the oldest model year allowed in the given year. */
export function ageRule(modelYear: number, rates: Pick<DutyRates, "ageLimitYears">, at: Date = new Date()): { allowed: boolean; oldestYear: number } {
  const oldestYear = at.getFullYear() - Math.max(0, n(rates.ageLimitYears)) + 1;
  return { allowed: n(modelYear) >= oldestYear, oldestYear };
}

/** Merges saved settings over the defaults (keeps arrays the company saved). */
export function withDutyDefaults(saved: Partial<DutyRates> | null | undefined): DutyRates {
  const s = saved || {};
  return {
    ...DEFAULT_DUTY_RATES,
    ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined && v !== "")),
    excise: Array.isArray(s.excise) && s.excise.length ? s.excise : DEFAULT_DUTY_RATES.excise,
    depreciation: Array.isArray(s.depreciation) && s.depreciation.length ? s.depreciation : DEFAULT_DUTY_RATES.depreciation,
  } as DutyRates;
}
