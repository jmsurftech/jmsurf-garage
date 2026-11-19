import { DEFAULT_DUTY_RATES, withDutyDefaults, type DutyRates } from "../lib/duty";
import { useModuleSettings } from "../shared/db";

export interface ImportSettings extends DutyRates {
  /** Target margin on the selling price for suggested prices. */
  targetMarginPct: number;
  /** Round suggested car prices up to this amount. */
  priceRoundTo: number;
  /** Warn this many days before free days at the port run out. */
  demurrageWarnDays: number;
}

export const IMPORT_DEFAULTS: ImportSettings = { ...DEFAULT_DUTY_RATES, targetMarginPct: 15, priceRoundTo: 1000, demurrageWarnDays: 2 };

export function useImportSettings() {
  const s = useModuleSettings<ImportSettings>("imports", IMPORT_DEFAULTS);
  return { ...s, value: { ...s.value, ...withDutyDefaults(s.value) } as ImportSettings };
}

export const COST_TYPES = [
  "Freight", "Marine insurance", "Import duty", "Excise duty", "VAT on import", "IDF fee", "RDL", "Port charges", "Storage / demurrage",
  "Clearing agency fee", "Transport upcountry", "Pre-export inspection", "Other",
];

export const CLEARING_STEPS: [string, string][] = [
  ["idf", "Import Declaration Form (IDF)"],
  ["kebs", "KEBS / pre-export inspection certificate"],
  ["entry", "KRA customs entry lodged"],
  ["duty", "Duty and taxes paid"],
  ["release", "Port release / delivery order"],
  ["transport", "Transport upcountry"],
  ["ntsa", "NTSA registration"],
];

export const SHIPMENT_DOCS = ["Bill of lading", "Commercial invoice", "Packing list", "Pre-export inspection certificate", "IDF", "Customs entry", "Duty payment slip", "Port release / delivery order", "Export certificate"];
export const ORDER_DOCS = ["Proforma invoice", "Swift / TT copy", "Auction sheet", "Purchase agreement", "Export certificate"];

export { demurrage } from "../lib/calc";
