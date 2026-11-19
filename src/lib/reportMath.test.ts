import { describe, expect, it } from "vitest";
import { realDiscount } from "./reportMath";

describe("realDiscount", () => {
  it("returns the plain discount of a normal sale", () => {
    expect(realDiscount({ discount: 50 })).toBe(50);
    expect(realDiscount({ discount: null })).toBe(0);
    expect(realDiscount({})).toBe(0);
  });
  it("leaves out exchange credit", () => {
    expect(realDiscount({ discount: 350, split_payments: [{ method: "exchange_credit", amount: 350 }] })).toBe(0);
    expect(realDiscount({ discount: 400, split_payments: [{ method: "exchange_credit", amount: 350 }] })).toBe(50);
  });
  it("ignores other split payments and never goes negative", () => {
    expect(realDiscount({ discount: 20, split_payments: [{ method: "cash", amount: 500 }] })).toBe(20);
    expect(realDiscount({ discount: 0, split_payments: [{ method: "exchange_credit", amount: 99 }] })).toBe(0);
  });
});
