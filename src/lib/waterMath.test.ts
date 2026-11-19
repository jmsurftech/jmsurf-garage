import { describe, expect, it } from "vitest";
import { litresByTank, sizeCost, sizePrice, tankLevel, tankPercent, weightedCostPerLitre } from "./waterMath";
import { formatLitres } from "./businessType";

describe("weightedCostPerLitre", () => {
  it("uses the purchase price for an empty tank", () => {
    expect(weightedCostPerLitre(0, 0, 5000, 1.2)).toBe(1.2);
  });
  it("averages old and new water", () => {
    // 1000 L at 1.00 + 3000 L at 2.00 = 7000 / 4000
    expect(weightedCostPerLitre(1000, 1, 3000, 2)).toBe(1.75);
  });
  it("ignores negative levels", () => {
    expect(weightedCostPerLitre(-5, 3, 100, 1)).toBe(1);
  });
});

describe("prices", () => {
  it("prices a size from the price per litre", () => {
    expect(sizePrice(20, 7.5)).toBe(150);
    expect(sizePrice(0.5, 7.5)).toBe(3.75);
  });
  it("costs a size from the buying price", () => {
    expect(sizeCost(10, 1.333)).toBe(13.33);
  });
});

describe("litresByTank", () => {
  it("adds up litres per tank and skips non-water lines", () => {
    expect(litresByTank([
      { tank_id: "a", litres: 20, quantity: 2 },
      { tank_id: "a", litres: 0.5, quantity: 3 },
      { tank_id: "b", litres: 5, quantity: 1 },
      { tank_id: null, litres: null, quantity: 4 },
    ])).toEqual({ a: 41.5, b: 5 });
  });
});

describe("tank level", () => {
  it("flags low and empty", () => {
    expect(tankLevel(600, 500)).toBe("ok");
    expect(tankLevel(500, 500)).toBe("low");
    expect(tankLevel(0, 500)).toBe("empty");
  });
  it("clamps the gauge", () => {
    expect(tankPercent(2500, 5000)).toBe(50);
    expect(tankPercent(6000, 5000)).toBe(100);
    expect(tankPercent(10, 0)).toBe(0);
  });
});

describe("formatLitres", () => {
  it("labels sizes", () => {
    expect(formatLitres(0.5)).toBe("500ml");
    expect(formatLitres(1)).toBe("1L");
    expect(formatLitres(20)).toBe("20L");
  });
});
