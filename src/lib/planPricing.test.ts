import { describe, expect, it } from "vitest";
import { planPrice, shopMonthly } from "./planPricing";
import * as server from "../../planPricing.js";

const basic = { id: "b", price_monthly: 750, price_quarterly: 2025, price_annually: 7200 };
const standard = { id: "s", price_monthly: 1500, price_quarterly: 4050, price_annually: 14400 };

describe("plan pricing by shop type", () => {
  it("leaves other shop types alone", () => {
    expect(planPrice(basic, "monthly", "general")).toBe(750);
    expect(planPrice(basic, "annually", "liquor")).toBe(7200);
  });
  it("starts water shops at 1,000 a month, keeping the cycle discounts", () => {
    expect(planPrice(basic, "monthly", "water")).toBe(1000);
    expect(planPrice(basic, "quarterly", "water")).toBe(2700);
    expect(planPrice(basic, "semi_annually", "water")).toBe(6000);
    expect(planPrice(basic, "annually", "water")).toBe(9600);
  });
  it("does not change packages already above the minimum", () => {
    expect(planPrice(standard, "monthly", "water")).toBe(1500);
    expect(planPrice(standard, "quarterly", "water")).toBe(4050);
  });
  it("raises an agreed price below the minimum", () => {
    expect(shopMonthly(750, "water")).toBe(1000);
    expect(shopMonthly(1200, "water")).toBe(1200);
    expect(shopMonthly(750, "general")).toBe(750);
  });
  it("server and browser agree", () => {
    for (const cycle of ["monthly", "quarterly", "semi_annually", "annually"]) {
      for (const t of ["water", "general"]) {
        expect(server.planPrice(basic, cycle, t)).toBe(planPrice(basic, cycle, t));
      }
    }
    expect(server.shopCyclePrice(basic, "quarterly", "water", { plan_id: "b", price: 750 })).toBe(2700);
    expect(server.shopCyclePrice(basic, "quarterly", "water", { plan_id: "b", price: 900 })).toBe(3000);
    expect(server.shopCyclePrice(basic, "quarterly", "general", { plan_id: "b", price: 600 })).toBe(1800);
  });
});
