import { describe, it, expect } from "vitest";
import { allocate, landedCosts, suggestedPrice, profitOf } from "./landedCost";
import { computeDuty, DEFAULT_DUTY_RATES, ageRule, excisePct, depreciationPct, vehicleAge, withDutyDefaults, type DutyRates } from "./duty";
import { fxSummary } from "./fx";
import {
  towPrice, haversineKm, roadKm, loyaltyStatus, commission, agingTotals, daysBetween, costPerKm, parseFuelCsv, csvSplit,
  normalisePlate, contractPrice, withholdingVat, serviceDue, parseDot, parseTyreSize, warrantyLeft, hireDays, hireCharges,
  overlaps, estimateTotals, claimSplit, panelTotals, mixCost, demurrage,
} from "./calc";

const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

describe("landed cost allocation", () => {
  const items = [
    { id: "a", value: 100000, weight: 1200, volume: 10, qty: 1 },
    { id: "b", value: 300000, weight: 1800, volume: 14, qty: 1 },
    { id: "c", value: 600000, weight: 1000, volume: 16, qty: 2 },
  ];
  it("splits by value in proportion", () => {
    expect(allocate(1000, items, "value")).toEqual([100, 300, 600]);
  });
  it("splits by weight, volume and count", () => {
    expect(allocate(4000, items, "weight")).toEqual([1200, 1800, 1000]);
    expect(allocate(400, items, "volume")).toEqual([100, 140, 160]);
    expect(allocate(400, items, "count")).toEqual([100, 100, 200]);
  });
  it("always adds up to the cent", () => {
    const parts = allocate(100, [{ id: "1", value: 1 }, { id: "2", value: 1 }, { id: "3", value: 1 }], "value");
    expect(sum(parts)).toBe(100);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });
  it("falls back to count when the basis is missing", () => {
    expect(allocate(90, [{ id: "1", value: 5 }, { id: "2", value: 7 }, { id: "3", value: 9 }], "weight")).toEqual([30, 30, 30]);
  });
  it("gives landed totals and unit cost with per-cost methods", () => {
    const out = landedCosts(items, [{ name: "Freight", amount: 400, method: "volume" }, { name: "Duty", amount: 1000 }], "value");
    expect(out[0].shares).toEqual({ Freight: 100, Duty: 100 });
    expect(out[2].extra).toBe(760);
    expect(out[2].landed).toBe(600760);
    expect(out[2].unit).toBe(300380);
    expect(sum(out.map((o) => o.extra))).toBe(1400);
  });
  it("suggests a price at a target margin or markup", () => {
    expect(suggestedPrice(800000, 20, "margin")).toBe(1000000);
    expect(suggestedPrice(800000, 25, "markup")).toBe(1000000);
    expect(suggestedPrice(812345, 20, "margin", 1000)).toBe(1016000);
    expect(profitOf(1000000, 800000)).toEqual({ profit: 200000, marginPct: 20 });
  });
});

describe("vehicle duty calculator", () => {
  const plain: DutyRates = { ...DEFAULT_DUTY_RATES, importDutyPct: 25, vatPct: 16, idfPct: 3.5, rdlPct: 2, excise: [{ maxCc: null, pct: 20 }], depreciation: [{ maxAgeYears: 99, pct: 0 }], crspIncludesTaxes: false };
  it("chains duty, excise and VAT on the customs value", () => {
    const r = computeDuty({ crsp: 1000000, ageYears: 3, engineCc: 1500, rates: plain });
    expect(r.customsValue).toBe(1000000);
    expect(r.importDuty).toBe(250000);
    expect(r.excise).toBe(250000);
    expect(r.vat).toBe(240000);
    expect(r.idf).toBe(35000);
    expect(r.rdl).toBe(20000);
    expect(r.total).toBe(795000);
  });
  it("backs taxes out of a tax-inclusive CRSP after depreciation", () => {
    const rates = { ...plain, crspIncludesTaxes: true, depreciation: [{ maxAgeYears: 5, pct: 50 }] };
    const r = computeDuty({ crsp: 3480000, ageYears: 4, engineCc: 1500, rates });
    expect(r.depreciatedValue).toBe(1740000);
    expect(r.customsValue).toBe(1000000);
  });
  it("picks excise and depreciation bands from settings", () => {
    expect(excisePct(DEFAULT_DUTY_RATES, 1490)).toBe(DEFAULT_DUTY_RATES.excise[0].pct);
    expect(excisePct(DEFAULT_DUTY_RATES, 5000)).toBe(DEFAULT_DUTY_RATES.excise[2].pct);
    expect(depreciationPct(DEFAULT_DUTY_RATES, 0)).toBe(DEFAULT_DUTY_RATES.depreciation[0].pct);
    expect(depreciationPct(DEFAULT_DUTY_RATES, 40)).toBe(DEFAULT_DUTY_RATES.depreciation[DEFAULT_DUTY_RATES.depreciation.length - 1].pct);
  });
  it("checks the used-vehicle age rule against the setting", () => {
    const at = new Date("2026-06-01");
    expect(ageRule(2019, { ageLimitYears: 8 }, at)).toEqual({ allowed: true, oldestYear: 2019 });
    expect(ageRule(2018, { ageLimitYears: 8 }, at).allowed).toBe(false);
    expect(ageRule(2018, { ageLimitYears: 10 }, at).allowed).toBe(true);
  });
  it("counts vehicle age in whole years", () => {
    expect(vehicleAge(2020, 7, new Date("2026-06-15"))).toBe(5);
    expect(vehicleAge(2020, 6, new Date("2026-06-15"))).toBe(6);
  });
  it("keeps saved settings over defaults", () => {
    const m = withDutyDefaults({ vatPct: 14, excise: [] as any });
    expect(m.vatPct).toBe(14);
    expect(m.excise.length).toBe(DEFAULT_DUTY_RATES.excise.length);
  });
});

describe("exchange gain and loss", () => {
  it("books a loss when the shilling weakens before payment", () => {
    const s = fxSummary(10000, 130, [{ amount_fc: 3000, rate: 130 }, { amount_fc: 7000, rate: 132 }]);
    expect(s.bookedLocal).toBe(1300000);
    expect(s.paidLocal).toBe(1314000);
    expect(s.gainLoss).toBe(-14000);
    expect(s.balanceFc).toBe(0);
    expect(s.averageRate).toBe(131.4);
  });
  it("books a gain and shows the open balance", () => {
    const s = fxSummary(1000000, 0.9, [{ amount_fc: 400000, rate: 0.85 }]);
    expect(s.gainLoss).toBe(20000);
    expect(s.balanceFc).toBe(600000);
    expect(s.balanceLocal).toBe(540000);
  });
});

describe("towing distance pricing", () => {
  const rates = { base: 3000, perKm: 150, includedKm: 10, nightPct: 20, minimum: 4000, roadFactor: 1.3 };
  it("charges the base plus kilometres beyond the included distance", () => {
    expect(towPrice(30, rates).total).toBe(6000);
    expect(towPrice(30, rates).chargeableKm).toBe(20);
  });
  it("applies the minimum and the night surcharge", () => {
    expect(towPrice(5, rates).total).toBe(4000);
    expect(towPrice(30, rates, { night: true }).total).toBe(7200);
  });
  it("measures map distance", () => {
    const d = haversineKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.3192, lng: 36.9278 });
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(13.5);
    expect(roadKm({ lat: 0, lng: 0 }, null)).toBe(0);
  });
});

describe("wash loyalty and commission", () => {
  it("makes every 6th wash free", () => {
    const paid = (k: number) => Array.from({ length: k }, () => ({ free: false }));
    expect(loyaltyStatus(paid(4), 6)).toEqual({ stamps: 4, needed: 5, freeNow: false, toGo: 1 });
    expect(loyaltyStatus(paid(5), 6).freeNow).toBe(true);
    expect(loyaltyStatus([...paid(5), { free: true }, ...paid(2)], 6)).toEqual({ stamps: 2, needed: 5, freeNow: false, toGo: 3 });
    expect(loyaltyStatus(paid(9), 0).freeNow).toBe(false);
  });
  it("pays washers a percent and or a fixed amount", () => {
    expect(commission(500, { percent: 10 })).toBe(50);
    expect(commission(500, { fixed: 40 })).toBe(40);
    expect(commission(500, { percent: 10, fixed: 20 })).toBe(70);
  });
});

describe("aging", () => {
  it("buckets balances by age", () => {
    const at = "2026-11-19";
    expect(daysBetween("2026-10-20", at)).toBe(30);
    expect(agingTotals([{ date: "2026-11-01", balance: 100 }, { date: "2026-09-25", balance: 50 }, { date: "2026-08-31", balance: 25 }, { date: "2026-01-01", balance: 10 }, { date: "2026-11-10", balance: 0 }], at)).toEqual([100, 50, 25, 10]);
  });
});

describe("fleet", () => {
  it("works out cost per km from the fuel log", () => {
    const r = costPerKm([{ odometer: 10000, litres: 40, amount: 7000 }, { odometer: 10400, litres: 40, amount: 7000 }, { odometer: 10800, litres: 40, amount: 7000 }], 1000);
    expect(r.km).toBe(800);
    expect(r.litres).toBe(80);
    expect(r.kmPerLitre).toBe(10);
    expect(r.costPerKm).toBe(27.5);
  });
  it("reads a fuel card CSV with loose headings", () => {
    const csv = "Transaction Date;Vehicle Reg;Litres;Amount (KES);Odometer;Site\n2026-11-01;\"kda 123a\";40.5;\"7,290.00\";10450;Station A";
    const { rows, missing } = parseFuelCsv(csv);
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ date: "2026-11-01", plate: "KDA123A", litres: 40.5, amount: 7290, odometer: 10450, station: "Station A" });
    expect(csvSplit('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
    expect(normalisePlate(" kcb-001 x")).toBe("KCB001X");
  });
  it("prices lines under the contract and computes withholding VAT", () => {
    expect(contractPrice({ kind: "labour", rate: 2500 }, { labour_rate: 2000 })).toBe(2000);
    expect(contractPrice({ kind: "part", rate: 1500, cost: 1000 }, { parts_markup: 15 })).toBe(1150);
    expect(contractPrice({ kind: "part", rate: 1500 }, { parts_markup: 15 })).toBe(1500);
    expect(withholdingVat(100000, 2)).toBe(2000);
  });
  it("flags service due by km or date", () => {
    const at = new Date("2026-11-19");
    expect(serviceDue({ last_km: 50000, every_km: 5000, current_km: 54700 }, at)).toMatchObject({ due: true, byKm: true, kmLeft: 300 });
    expect(serviceDue({ last_date: "2026-06-01", every_months: 6, current_km: 0 }, at)).toMatchObject({ due: true, byDate: true });
    expect(serviceDue({ last_km: 50000, every_km: 5000, current_km: 51000 }, at).due).toBe(false);
  });
});

describe("tyres and batteries", () => {
  it("reads DOT dates", () => {
    expect(parseDot("DOT 4B XY 2319", new Date("2026-11-19"))).toMatchObject({ week: 23, year: 2019 });
    expect(parseDot("5719")).toBeNull();
    expect(parseDot("abc")).toBeNull();
  });
  it("normalises tyre sizes", () => {
    expect(parseTyreSize("195/65 R15 91H")).toEqual({ width: 195, profile: 65, rim: 15, size: "195/65R15" });
    expect(parseTyreSize("2656517")?.size).toBe("265/65R17");
    expect(parseTyreSize("tyre")).toBeNull();
  });
  it("counts battery warranty", () => {
    expect(warrantyLeft("2026-01-15", 12, new Date("2026-11-19"))).toMatchObject({ expires: "2027-01-15", valid: true });
    expect(warrantyLeft("2025-01-15", 6, new Date("2026-11-19")).valid).toBe(false);
  });
});

describe("car hire", () => {
  it("counts started days with a grace period", () => {
    expect(hireDays("2026-11-01T09:00", "2026-11-03T09:30")).toBe(2);
    expect(hireDays("2026-11-01T09:00", "2026-11-03T11:00")).toBe(3);
    expect(hireDays("2026-11-01T09:00", "2026-11-01T10:00")).toBe(1);
  });
  it("charges extra km, missing fuel and damage", () => {
    const c = hireCharges({ days: 2, dailyRate: 5000, kmOut: 1000, kmIn: 1500, kmPerDay: 200, extraKmRate: 30, fuelOut: 8, fuelIn: 6, fuelPerEighth: 900, damage: 2500 });
    expect(c).toMatchObject({ rental: 10000, km: 500, allowedKm: 400, extraKm: 100, extraKmCharge: 3000, fuelShort: 2, fuelCharge: 1800, total: 17300 });
  });
  it("detects overlapping bookings", () => {
    expect(overlaps("2026-11-01", "2026-11-05", "2026-11-04", "2026-11-08")).toBe(true);
    expect(overlaps("2026-11-01", "2026-11-05", "2026-11-05", "2026-11-08")).toBe(false);
  });
});

describe("insurance claims", () => {
  const lines = [
    { section: "Parts", description: "Bumper", qty: 1, rate: 20000, approved: 18000 },
    { section: "Labour", description: "Fit bumper", qty: 2, rate: 2500, approved: 5000 },
    { section: "Paint & materials", description: "Paint bumper", qty: 1, rate: 8000, approved: null, supp: 1 },
    { section: "Parts", description: "Chrome trim", qty: 1, rate: 6000, approved: 0, customer: true },
  ];
  it("totals the estimate and the assessor-approved amounts", () => {
    const t = estimateTotals(lines);
    expect(t.estimate).toBe(39000);
    expect(t.approved).toBe(23000);
    expect(t.assessed).toBe(3);
    expect(t.customerExtras).toBe(6000);
    expect(t.bySection.Parts).toEqual({ estimate: 26000, approved: 18000 });
    expect(estimateTotals(lines, 1).estimate).toBe(8000);
  });
  it("splits excess and insurer amounts", () => {
    expect(claimSplit(23000, 5000)).toEqual({ insurer: 18000, excess: 5000, customer: 5000 });
    expect(claimSplit(23000, 5000, 6000).customer).toBe(11000);
    expect(claimSplit(3000, 5000)).toEqual({ insurer: 0, excess: 3000, customer: 3000 });
  });
});

describe("port demurrage", () => {
  it("counts free days from arrival and charges each day over", () => {
    expect(demurrage("2026-11-01", 4, 1000, new Date("2026-11-08"))).toEqual({ freeUntil: "2026-11-05", daysLeft: -3, daysOver: 3, accrued: 3000 });
    expect(demurrage("2026-11-01", 10, 1000, new Date("2026-11-08"))).toMatchObject({ daysLeft: 3, daysOver: 0, accrued: 0 });
    expect(demurrage(null, 4, 1000).freeUntil).toBeNull();
  });
});

describe("body and paint costing", () => {
  it("totals panels and paint mixes", () => {
    const t = panelTotals([{ panel: "Front bumper", operation: "Repair", labour_hours: 3, paint_cost: 4000, parts_cost: 0 }, { panel: "Bonnet", operation: "Paint", labour_hours: 2, paint_cost: 5000, parts_cost: 1500 }], 1500);
    expect(t).toEqual({ hours: 5, labour: 7500, paint: 9000, parts: 1500, total: 18000 });
    expect(mixCost([{ qty: 250, unit_cost: 12 }, { qty: 100, unit_cost: 8.5 }], 600)).toBe(4450);
  });
});
