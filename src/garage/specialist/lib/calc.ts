/**
 * Small pure calculations used across the specialist modules: towing prices,
 * wash loyalty, claim aging, fleet fuel and contract prices, tyres, car hire,
 * claim estimates and body-shop costing. Kept free of React and the database
 * so they are unit tested.
 */

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ───────────────────────────── distance + towing ───────────────────────────── */

export interface LatLng { lat: number; lng: number }

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TowRates {
  /** Call-out / hook-up fee. */
  base: number;
  perKm: number;
  /** Kilometres covered by the base fee. */
  includedKm: number;
  /** Extra percent at night (e.g. 22:00–06:00) or on public holidays. */
  nightPct: number;
  minimum: number;
  /** Road distance is longer than the straight line; multiply by this (e.g. 1.3). */
  roadFactor: number;
}

export const DEFAULT_TOW_RATES: TowRates = { base: 0, perKm: 0, includedKm: 0, nightPct: 0, minimum: 0, roadFactor: 1.3 };

/** Price for a tow or call-out from the chargeable distance. */
export function towPrice(km: number, rates: TowRates, opts: { night?: boolean } = {}): { km: number; chargeableKm: number; distance: number; base: number; surcharge: number; total: number } {
  const dist = Math.max(0, n(km));
  const chargeableKm = Math.max(0, dist - n(rates.includedKm));
  const distance = chargeableKm * n(rates.perKm);
  const base = n(rates.base);
  const surcharge = opts.night ? (base + distance) * (n(rates.nightPct) / 100) : 0;
  const total = Math.max(n(rates.minimum), base + distance + surcharge);
  return { km: r2(dist), chargeableKm: r2(chargeableKm), distance: r2(distance), base: r2(base), surcharge: r2(surcharge), total: Math.ceil(r2(total)) };
}

/** Road km estimate from two map points. */
export function roadKm(a: LatLng | null | undefined, b: LatLng | null | undefined, roadFactor = 1.3): number {
  if (!a || !b) return 0;
  return Math.round(haversineKm(a, b) * Math.max(1, n(roadFactor) || 1) * 10) / 10;
}

/* ───────────────────────────── wash loyalty + commission ───────────────────────────── */

/**
 * Loyalty stamps: every Nth wash is free. `history` is the customer's washes, oldest
 * first, each marked free or paid. Stamps count paid washes since the last free one.
 */
export function loyaltyStatus(history: { free?: boolean }[], everyN: number): { stamps: number; needed: number; freeNow: boolean; toGo: number } {
  const N = Math.max(0, Math.floor(n(everyN)));
  if (N < 2) return { stamps: 0, needed: 0, freeNow: false, toGo: 0 };
  let stamps = 0;
  for (const w of history) stamps = w.free ? 0 : stamps + 1;
  // Long histories (no free wash taken) keep counting in cycles.
  const needed = N - 1;
  const freeNow = stamps >= needed;
  return { stamps: Math.min(stamps, needed), needed, freeNow, toGo: freeNow ? 0 : needed - stamps };
}

/** Washer commission: a percent of the wash price, a fixed amount per wash, or both. */
export function commission(price: number, rule: { percent?: number | null; fixed?: number | null }): number {
  return r2(n(price) * (n(rule.percent) / 100) + n(rule.fixed));
}

/* ───────────────────────────── aging ───────────────────────────── */

export const AGING_BUCKETS = ["0–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / 86400000);
}

export function agingBucket(days: number): number {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

/** Sums open balances into 0–30 / 31–60 / 61–90 / 90+ day buckets by invoice date. */
export function agingTotals(rows: { date: string; balance: number }[], asOf: string | Date = new Date()): number[] {
  const out = [0, 0, 0, 0];
  for (const r of rows) {
    const bal = n(r.balance);
    if (bal <= 0.005) continue;
    out[agingBucket(daysBetween(r.date, asOf))] += bal;
  }
  return out.map(r2);
}

/* ───────────────────────────── fleet ───────────────────────────── */

export interface FuelEntry { date?: string; odometer?: number | null; litres?: number | null; amount?: number | null }

/** Kilometres, fuel spend and cost per km from a vehicle's fuel log (and other running costs). */
export function costPerKm(entries: FuelEntry[], otherCost = 0): { km: number; litres: number; fuel: number; kmPerLitre: number; costPerKm: number } {
  const odo = entries.map((e) => n(e.odometer)).filter((x) => x > 0);
  const km = odo.length >= 2 ? Math.max(...odo) - Math.min(...odo) : 0;
  // The first fill only sets the starting point when odometers are known.
  const sorted = [...entries].filter((e) => n(e.odometer) > 0).sort((a, b) => n(a.odometer) - n(b.odometer));
  const counted = sorted.length >= 2 ? sorted.slice(1) : entries;
  const litres = counted.reduce((a, e) => a + n(e.litres), 0);
  const fuel = entries.reduce((a, e) => a + n(e.amount), 0);
  return {
    km, litres: r2(litres), fuel: r2(fuel),
    kmPerLitre: km > 0 && litres > 0 ? r2(km / litres) : 0,
    costPerKm: km > 0 ? r2((fuel + n(otherCost)) / km) : 0,
  };
}

/** Splits one CSV line, honouring quotes. */
export function csvSplit(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const FUEL_COLS: Record<string, string[]> = {
  date: ["date", "transaction date", "trans date", "txn date", "time"],
  plate: ["plate", "registration", "reg", "reg no", "vehicle", "vehicle reg", "number plate"],
  litres: ["litres", "liters", "quantity", "qty", "volume", "ltrs"],
  amount: ["amount", "value", "total", "cost", "kes", "amount (kes)"],
  odometer: ["odometer", "mileage", "odo", "km", "kms"],
  station: ["station", "site", "location", "merchant"],
  card: ["card", "card no", "card number", "fuel card"],
  product: ["product", "fuel", "fuel type", "grade"],
};

export interface FuelCsvRow { date: string; plate: string; litres: number; amount: number; odometer: number; station: string; card: string; product: string }

/** Reads a fuel card statement exported as CSV. Column names are matched loosely. */
export function parseFuelCsv(text: string): { rows: FuelCsvRow[]; missing: string[] } {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], missing: ["date", "plate", "amount"] };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const head = csvSplit(lines[0], sep).map((h) => h.toLowerCase().replace(/[_.]+/g, " ").trim());
  const idx: Record<string, number> = {};
  for (const [key, names] of Object.entries(FUEL_COLS)) idx[key] = head.findIndex((h) => names.includes(h));
  const missing = ["date", "plate", "amount"].filter((k) => idx[k] < 0);
  const num = (s: string) => Number(String(s || "").replace(/[^0-9.-]/g, "")) || 0;
  const rows = lines.slice(1).map((l) => {
    const c = csvSplit(l, sep);
    const get = (k: string) => (idx[k] >= 0 ? c[idx[k]] || "" : "");
    return {
      date: get("date"), plate: normalisePlate(get("plate")), litres: num(get("litres")), amount: num(get("amount")),
      odometer: num(get("odometer")), station: get("station"), card: get("card"), product: get("product"),
    };
  }).filter((r) => r.plate || r.amount);
  return { rows, missing };
}

/** Upper case, no spaces or dashes (same rule as the workshop's vehicle list). */
export function normalisePlate(p: string | null | undefined): string {
  return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Price of a job line under a fleet contract: own labour rate, parts at cost plus markup. */
export function contractPrice(line: { kind: string; rate: number; cost?: number | null }, contract: { labour_rate?: number | null; parts_markup?: number | null }): number {
  if (line.kind === "labour" && n(contract.labour_rate) > 0) return r2(n(contract.labour_rate));
  if (line.kind === "part" && contract.parts_markup !== null && contract.parts_markup !== undefined && n(line.cost) > 0) return r2(n(line.cost) * (1 + n(contract.parts_markup) / 100));
  return r2(n(line.rate));
}

/** Withholding VAT a government or appointed agent keeps back (rate is a company setting). */
export function withholdingVat(taxableAmount: number, ratePct: number): number {
  return r2(n(taxableAmount) * (n(ratePct) / 100));
}

/** Whether a fleet vehicle is due for service by km or by date. */
export function serviceDue(v: { last_km?: number | null; last_date?: string | null; every_km?: number | null; every_months?: number | null; current_km?: number | null }, at: Date = new Date()): { due: boolean; byKm: boolean; byDate: boolean; kmLeft: number | null; daysLeft: number | null } {
  let kmLeft: number | null = null, daysLeft: number | null = null;
  if (n(v.every_km) > 0 && n(v.current_km) > 0) kmLeft = n(v.last_km) + n(v.every_km) - n(v.current_km);
  if (n(v.every_months) > 0 && v.last_date) {
    const d = new Date(v.last_date);
    if (!isNaN(d.getTime())) { d.setMonth(d.getMonth() + n(v.every_months)); daysLeft = daysBetween(at, d); }
  }
  const byKm = kmLeft !== null && kmLeft <= 500;
  const byDate = daysLeft !== null && daysLeft <= 14;
  return { due: byKm || byDate, byKm, byDate, kmLeft, daysLeft };
}

/* ───────────────────────────── tyres + batteries ───────────────────────────── */

/** Reads the tyre's DOT date code: the last four digits are week and year (e.g. 2319 = week 23 of 2019). */
export function parseDot(code: string, at: Date = new Date()): { week: number; year: number; ageMonths: number } | null {
  const digits = String(code || "").replace(/\D/g, "");
  const m = digits.match(/(\d{2})(\d{2})$/);
  if (!m) return null;
  const week = Number(m[1]), yy = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const year = 2000 + yy;
  if (year > at.getFullYear() + 1) return null;
  const made = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const ageMonths = Math.max(0, (at.getFullYear() - made.getUTCFullYear()) * 12 + at.getMonth() - made.getUTCMonth());
  return { week, year, ageMonths };
}

/** "195/65 R15 91H" → width 195, profile 65, rim 15, "195/65R15". */
export function parseTyreSize(s: string): { width: number; profile: number; rim: number; size: string } | null {
  const m = String(s || "").toUpperCase().replace(/\s+/g, "").match(/(\d{3})\/?(\d{2})Z?R?F?(\d{2}(?:\.\d)?)/);
  if (!m) return null;
  const width = Number(m[1]), profile = Number(m[2]), rim = Number(m[3]);
  return { width, profile, rim, size: `${width}/${profile}R${m[3]}` };
}

/** Battery warranty left from the sale date. */
export function warrantyLeft(soldOn: string, months: number, at: Date = new Date()): { expires: string; daysLeft: number; valid: boolean } {
  const d = new Date(soldOn);
  if (isNaN(d.getTime())) return { expires: "", daysLeft: 0, valid: false };
  d.setMonth(d.getMonth() + Math.max(0, n(months)));
  const daysLeft = daysBetween(at, d);
  return { expires: d.toISOString().slice(0, 10), daysLeft, valid: daysLeft >= 0 };
}

/* ───────────────────────────── car hire ───────────────────────────── */

/** Hire days: each started 24 hours counts (with a grace period in minutes), at least one. */
export function hireDays(start: string | Date, end: string | Date, graceMinutes = 60): number {
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  const mins = (b - a) / 60000;
  return Math.max(1, Math.ceil((mins - Math.max(0, graceMinutes)) / 1440));
}

export interface HireCharges { days: number; rental: number; km: number; allowedKm: number; extraKm: number; extraKmCharge: number; fuelShort: number; fuelCharge: number; damage: number; total: number }

/**
 * Charges at return: days × daily rate, kilometres above the allowance, missing fuel
 * (in eighths of a tank × price per eighth) and any damage amount.
 */
export function hireCharges(i: { days: number; dailyRate: number; kmOut: number; kmIn: number; kmPerDay: number; extraKmRate: number; fuelOut: number; fuelIn: number; fuelPerEighth: number; damage?: number }): HireCharges {
  const days = Math.max(1, n(i.days));
  const rental = days * n(i.dailyRate);
  const km = Math.max(0, n(i.kmIn) - n(i.kmOut));
  const allowedKm = n(i.kmPerDay) > 0 ? days * n(i.kmPerDay) : Infinity;
  const extraKm = Number.isFinite(allowedKm) ? Math.max(0, km - allowedKm) : 0;
  const extraKmCharge = extraKm * n(i.extraKmRate);
  const fuelShort = Math.max(0, n(i.fuelOut) - n(i.fuelIn));
  const fuelCharge = fuelShort * n(i.fuelPerEighth);
  const damage = n(i.damage);
  return {
    days, rental: r2(rental), km, allowedKm: Number.isFinite(allowedKm) ? allowedKm : 0, extraKm, extraKmCharge: r2(extraKmCharge),
    fuelShort, fuelCharge: r2(fuelCharge), damage: r2(damage), total: r2(rental + extraKmCharge + fuelCharge + damage),
  };
}

/** Whether two date ranges overlap (bookings for the same car). */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = new Date(aStart).getTime(), ae = new Date(aEnd || aStart).getTime();
  const bs = new Date(bStart).getTime(), be = new Date(bEnd || bStart).getTime();
  return as < be && bs < ae;
}

/* ───────────────────────────── insurance claims ───────────────────────────── */

export interface EstimateLine {
  section: string;
  description: string;
  qty: number;
  rate: number;
  /** Assessor-approved amount for the line (null = not assessed yet). */
  approved?: number | null;
  /** 0 = first estimate, 1… = supplementary estimates after strip-down. */
  supp?: number;
  /** Not approved by the insurer but the customer agreed to pay (betterment, extras). */
  customer?: boolean;
}

export const ESTIMATE_SECTIONS = ["Parts", "Labour", "Paint & materials", "Sublet", "Other"];

export const lineAmount = (l: Pick<EstimateLine, "qty" | "rate">) => r2(n(l.qty) * n(l.rate));

export function estimateTotals(lines: EstimateLine[], supp?: number): { estimate: number; approved: number; assessed: number; customerExtras: number; bySection: Record<string, { estimate: number; approved: number }> } {
  const use = supp === undefined ? lines : lines.filter((l) => n(l.supp) === supp);
  const bySection: Record<string, { estimate: number; approved: number }> = {};
  let estimate = 0, approved = 0, assessed = 0, customerExtras = 0;
  for (const l of use) {
    const amt = lineAmount(l);
    estimate += amt;
    const s = (bySection[l.section || "Other"] ||= { estimate: 0, approved: 0 });
    s.estimate += amt;
    if (l.approved !== null && l.approved !== undefined && String(l.approved) !== "") {
      approved += n(l.approved); s.approved += n(l.approved); assessed++;
    }
    if (l.customer) customerExtras += Math.max(0, amt - n(l.approved));
  }
  for (const k of Object.keys(bySection)) bySection[k] = { estimate: r2(bySection[k].estimate), approved: r2(bySection[k].approved) };
  return { estimate: r2(estimate), approved: r2(approved), assessed, customerExtras: r2(customerExtras), bySection };
}

/** Who pays what: the customer pays the excess (and agreed extras), the insurer the rest of the approved amount. */
export function claimSplit(approved: number, excess: number, customerExtras = 0): { insurer: number; customer: number; excess: number } {
  const ap = Math.max(0, n(approved));
  const ex = Math.min(ap, Math.max(0, n(excess)));
  return { insurer: r2(ap - ex), excess: r2(ex), customer: r2(ex + Math.max(0, n(customerExtras))) };
}

/* ───────────────────────────── port demurrage ───────────────────────────── */

/** Free days at the port from arrival, then a daily charge. */
export function demurrage(arrived: string | null | undefined, freeDays: number, ratePerDay: number, at: Date = new Date()): { freeUntil: string | null; daysLeft: number | null; daysOver: number; accrued: number } {
  if (!arrived) return { freeUntil: null, daysLeft: null, daysOver: 0, accrued: 0 };
  const a = new Date(arrived);
  if (isNaN(a.getTime())) return { freeUntil: null, daysLeft: null, daysOver: 0, accrued: 0 };
  const until = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + Math.max(0, n(freeDays))));
  const daysLeft = daysBetween(at, until.toISOString().slice(0, 10));
  const daysOver = Math.max(0, -daysLeft);
  return { freeUntil: until.toISOString().slice(0, 10), daysLeft, daysOver, accrued: r2(daysOver * n(ratePerDay)) };
}

/* ───────────────────────────── body + paint ───────────────────────────── */

export interface PanelLine { panel: string; operation: string; labour_hours: number; paint_cost: number; parts_cost: number }

export function panelTotals(panels: PanelLine[], labourRate: number): { hours: number; labour: number; paint: number; parts: number; total: number } {
  const hours = panels.reduce((a, p) => a + n(p.labour_hours), 0);
  const paint = panels.reduce((a, p) => a + n(p.paint_cost), 0);
  const parts = panels.reduce((a, p) => a + n(p.parts_cost), 0);
  const labour = hours * n(labourRate);
  return { hours: r2(hours), labour: r2(labour), paint: r2(paint), parts: r2(parts), total: r2(labour + paint + parts) };
}

/** Paint mix: each component's quantity (g or ml) × cost per unit, plus consumables. */
export function mixCost(mix: { qty: number; unit_cost: number }[], consumables = 0): number {
  return r2(mix.reduce((a, m) => a + n(m.qty) * n(m.unit_cost), 0) + n(consumables));
}
