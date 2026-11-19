import { describe, expect, it } from "vitest";
import { subscriptionLines, linesTotal, chargeMonths, planCharge } from "../../../payments.js";

const plan = { id: "p1", name: "Workshop", price_monthly: 3000, price_annually: 36000 };
const mods = [
  { module_key: "whatsapp", price_monthly: 500 },
  { module_key: "extra_branch", price_monthly: 1000 },
  { module_key: "prorata", price_monthly: 250 },
  { module_key: "sms", price_monthly: 200 },
  { module_key: "free_thing", price_monthly: 0 },
];

describe("subscription charge", () => {
  it("a year is 10 x monthly for the package and every module", () => {
    expect(chargeMonths("annually")).toBe(10);
    expect(chargeMonths("quarterly")).toBe(3);
    expect(planCharge(plan, "annually", "general", null)).toBe(30000);
    const lines = subscriptionLines({ plan, cycle: "annually", businessType: "general", subscription: null, mods });
    expect(lines.map((l) => l.amount)).toEqual([30000, 5000, 10000, 2500, 2000]);
    expect(linesTotal(lines)).toBe(49500);
  });
  it("lists package, modules, extra branches, pro-rata and SMS as separate lines", () => {
    const lines = subscriptionLines({ plan, cycle: "monthly", businessType: "general", subscription: null, mods });
    expect(lines.map((l) => l.name)).toEqual([
      "Workshop package (1 month)", "Whatsapp (1 month)", "Extra branch (1 month)", "Pro-rata charge (1 month)", "SMS (1 month)",
    ]);
    expect(linesTotal(lines)).toBe(4950);
  });
  it("keeps an agreed monthly price", () => {
    expect(planCharge(plan, "annually", "general", { plan_id: "p1", price: 2500 })).toBe(25000);
  });
});
