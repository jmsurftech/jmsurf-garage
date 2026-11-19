import { describe, expect, it } from "vitest";
import { formatPlate, isKenyanPlate, normalisePlate, plateKind, suggestTypeFromPlate } from "./plate";
import { canMove, moveProblem, nextStatuses, primaryNext, stageMinutes, humanMinutes } from "./status";
import { jobTotals, lineGross, lineNet, splitAmount, splitByPayer, toInvoiceItem, estimateSummary, type MoneyLine } from "./totals";
import { DEFAULT_REMINDERS, MEASURE_VARS, bookingDue, dueItems, kmPerDay, render, reminderSettings, smsInfo, estimatedMileage } from "./reminders";
import { ragCounts, linesFromInspection, STARTER_TEMPLATES } from "./checklists";

describe("inspections", () => {
  it("counts colours and turns red / amber into estimate lines", () => {
    const res = [
      { section: "Brakes", label: "Front pads", status: "red" as const, note: "2 mm left" },
      { section: "Brakes", label: "Rear shoes", status: "amber" as const },
      { section: "Tyres", label: "Spare", status: "green" as const },
      { section: "Tyres", label: "Front left", status: null },
    ];
    expect(ragCounts(res)).toEqual({ green: 1, amber: 1, red: 1, na: 0, open: 1 });
    expect(linesFromInspection(res)).toEqual([
      { kind: "labour", description: "Front pads (2 mm left)", priority: "must" },
      { kind: "labour", description: "Rear shoes", priority: "advised" },
    ]);
    expect(STARTER_TEMPLATES.map((t) => t.kind)).toEqual(["multi_point", "pre_purchase", "ntsa"]);
  });
});

describe("number plates", () => {
  it("normalises spacing, case and dashes", () => {
    expect(normalisePlate(" kca 123a ")).toBe("KCA123A");
    expect(normalisePlate("KDG-456-B")).toBe("KDG456B");
    expect(normalisePlate(null)).toBe("");
  });
  it("knows Kenyan formats", () => {
    expect(plateKind("KCA 123A")).toBe("private");
    expect(plateKind("KDx 001z")).toBe("private");
    expect(plateKind("KMEA 123B")).toBe("motorbike");
    expect(plateKind("GK 123A")).toBe("government");
    expect(plateKind("GKB 1234")).toBe("government");
    expect(plateKind("ZD 1234")).toBe("trailer");
    expect(plateKind("KAA 123")).toBe("old");
    expect(plateKind("19 CD 45")).toBe("diplomatic");
    expect(plateKind("ABC")).toBe("other");
    expect(isKenyanPlate("KBZ 999X")).toBe(true);
    expect(isKenyanPlate("T 123 ABC")).toBe(false);
  });
  it("formats for display", () => {
    expect(formatPlate("kca123a")).toBe("KCA 123A");
    expect(formatPlate("KMEA123B")).toBe("KMEA 123B");
    expect(formatPlate("19CD45")).toBe("19 CD 45");
    expect(formatPlate("")).toBe("");
  });
  it("suggests a vehicle type", () => {
    expect(suggestTypeFromPlate("KMFB 001A")).toBe("motorbike");
    expect(suggestTypeFromPlate("KCA 123A")).toBeNull();
  });
});

describe("job status flow", () => {
  it("allows the normal flow", () => {
    expect(canMove("checked_in", "diagnosing")).toBe(true);
    expect(canMove("in_progress", "quality_check")).toBe(true);
    expect(canMove("quality_check", "ready")).toBe(true);
    expect(canMove("ready", "collected")).toBe(true);
  });
  it("refuses skipping the quality check or reopening a collected job", () => {
    expect(canMove("in_progress", "ready")).toBe(false);
    expect(canMove("collected", "in_progress")).toBe(false);
    expect(nextStatuses("collected")).toEqual([]);
    expect(nextStatuses("in_progress")).toContain("cancelled");
  });
  it("needs the gate pass and a passed quality check", () => {
    expect(moveProblem("ready", "collected", {})).toMatch(/gate/);
    expect(moveProblem("ready", "collected", { gate_released_at: "2026-11-19T10:00:00Z" })).toBeNull();
    expect(moveProblem("quality_check", "ready", { qc: { passed: false } })).toMatch(/quality/);
    expect(moveProblem("quality_check", "ready", { qc: { passed: true } })).toBeNull();
  });
  it("has a main next step", () => {
    expect(primaryNext("checked_in")).toBe("diagnosing");
    expect(primaryNext("collected")).toBeNull();
  });
  it("counts time in the current stage", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const m = stageMinutes({ status: "waiting_parts", stage_minutes: { waiting_parts: 30 }, stage_entered_at: "2026-11-19T11:00:00Z" }, now);
    expect(Math.round(m.waiting_parts)).toBe(90);
    expect(humanMinutes(90)).toBe("1h 30m");
    expect(humanMinutes(60 * 26)).toBe("1d 2h");
    expect(humanMinutes(5)).toBe("5m");
  });
});

describe("job money", () => {
  const lines: MoneyLine[] = [
    { kind: "labour", description: "Full service", qty: 1, rate: 3000, tax_rate: 16, approved: true, payer: "customer" },
    { kind: "part", description: "Oil filter", qty: 2, rate: 650, discount: 10, tax_rate: 16, approved: true, payer: "insurer", item_id: "i1" },
    { kind: "part", description: "Brake pads", qty: 1, rate: 4500, approved: false, payer: "customer", item_id: "i2" },
    { kind: "sublet", description: "Machining", qty: 1, rate: 1500, approved: true, status: "cancelled" },
  ];
  it("works out line amounts", () => {
    expect(lineNet(lines[1])).toBe(1170);
    expect(lineGross(lines[1])).toBe(1357.2);
  });
  it("totals live lines and approved lines", () => {
    const all = jobTotals(lines);
    expect(all.subtotal).toBe(8670);
    expect(all.labour).toBe(3000);
    expect(all.parts).toBe(5670);
    const ok = jobTotals(lines, { onlyApproved: true });
    expect(ok.subtotal).toBe(4170);
    expect(ok.tax).toBe(667.2);
    expect(ok.total).toBe(4837.2);
  });
  it("splits approved, uninvoiced lines per payer", () => {
    const s = splitByPayer(lines);
    expect(s.map((x) => x.payer)).toEqual(["customer", "insurer"]);
    expect(s[0].totals.total).toBe(3480);
    expect(splitByPayer([{ ...lines[0], invoice_id: "x" }])).toEqual([]);
  });
  it("splits an amount so the parts add up", () => {
    const parts = splitAmount(1000.01, [{ payer: "insurer", percent: 80 }, { payer: "customer", percent: 20 }]);
    expect(parts[0].amount).toBe(800.01);
    expect(parts[0].amount + parts[1].amount).toBeCloseTo(1000.01, 2);
    const excess = splitAmount(50000, [{ payer: "customer", fixed: 15000 }, { payer: "insurer" }]);
    expect(excess).toEqual([{ payer: "customer", amount: 15000 }, { payer: "insurer", amount: 35000 }]);
  });
  it("turns lines into invoice items", () => {
    expect(toInvoiceItem(lines[0])).toMatchObject({ type: "service", item_id: null, amount: 3000 });
    expect(toInvoiceItem(lines[1])).toMatchObject({ type: "product", item_id: "i1", quantity: 2, amount: 1170 });
  });
  it("summarises an estimate", () => {
    const s = estimateSummary([
      { kind: "labour", description: "a", qty: 1, rate: 100, priority: "must", decision: "approved" },
      { kind: "part", description: "b", qty: 1, rate: 50, priority: "advised", decision: "declined" },
    ]);
    expect(s).toMatchObject({ must: 100, advised: 50, all: 150, approved: 100, decided: true });
  });
});

describe("reminders", () => {
  const cfg = reminderSettings({ enabled: true });
  const now = Date.parse("2026-11-19T07:00:00Z"); // 10:00 in Nairobi

  it("fires the service reminder inside the lead days, once per due date", () => {
    const items = dueItems({ id: "v1", next_service_date: "2026-11-24" }, cfg, now);
    expect(items).toEqual([{ kind: "service", due: "2026-11-24", key: "service:v1:2026-11-24" }]);
    expect(dueItems({ id: "v1", next_service_date: "2026-12-24" }, cfg, now)).toEqual([]);
    expect(dueItems({ id: "v1", next_service_date: "2026-10-01" }, cfg, now)).toEqual([]);
  });
  it("fires the service reminder by mileage", () => {
    const items = dueItems({ id: "v2", mileage: 49600, next_service_km: 50000 }, cfg, now);
    expect(items[0]).toMatchObject({ kind: "service", key: "service:v2:km50000" });
    expect(dueItems({ id: "v2", mileage: 40000, next_service_km: 50000 }, cfg, now)).toEqual([]);
  });
  it("estimates mileage from km per day", () => {
    expect(estimatedMileage({ id: "x", mileage: 10000, km_per_day: 50, mileage_at: "2026-11-09T07:00:00Z" }, now)).toBe(10500);
    expect(kmPerDay([{ mileage: 1000, at: "2026-01-01" }, { mileage: 4000, at: "2026-03-02" }])).toBe(50);
    expect(kmPerDay([{ mileage: 1000, at: "2026-01-01" }])).toBeNull();
  });
  it("fires document expiries and respects switched-off kinds", () => {
    const v = { id: "v3", insurance_expiry: "2026-11-30", psv_expiry: "2026-11-25", speed_governor_expiry: "2027-06-01" };
    const kinds = dueItems(v, cfg, now).map((x) => x.kind);
    expect(kinds).toContain("insurance");
    expect(kinds).not.toContain("psv"); // off by default
    expect(kinds).not.toContain("speed_governor");
  });
  it("sends win-back after 6 months only when switched on", () => {
    const v = { id: "v4", last_service_at: "2026-05-15T08:00:00Z" };
    expect(dueItems(v, cfg, now)).toEqual([]);
    const on = reminderSettings({ kinds: { winback: { on: true } } });
    expect(dueItems(v, on, now).map((x) => x.key)).toEqual(["winback6:v4:2026-05-15"]);
  });
  it("reminds bookings the day before after the send hour", () => {
    expect(bookingDue("2026-11-20T06:00:00Z", cfg, now)).toBe(true);
    expect(bookingDue("2026-11-19T12:00:00Z", cfg, now)).toBe(false);
    expect(bookingDue("2026-11-20T06:00:00Z", cfg, Date.parse("2026-11-19T04:00:00Z"))).toBe(false);
  });
  it("renders texts and every default text fits one SMS", () => {
    expect(render("Hi {name}, {plate}{missing}.", { name: "A", plate: "KCA 123A" })).toBe("Hi A, KCA 123A.");
    for (const [kind, k] of Object.entries(DEFAULT_REMINDERS.kinds)) {
      for (const t of [k.text_en, k.text_sw]) {
        const info = smsInfo(render(t, MEASURE_VARS));
        expect(info.parts, `${kind}: ${t}`).toBe(1);
      }
    }
    expect(smsInfo("x".repeat(161)).parts).toBe(2);
    expect(smsInfo("hello 🚗").unicode).toBe(true);
  });
});
