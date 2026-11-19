import { describe, expect, it } from "vitest";
import { lockState, subscriptionEndMs } from "./subscriptionLock";

const NOW = Date.parse("2026-10-04T09:00:00Z");

describe("lockState", () => {
  it("stays open with no subscription or no end date", () => {
    expect(lockState(null, NOW)).toBe("open");
    expect(lockState({ status: "active" }, NOW)).toBe("open");
  });

  it("locks the moment a paid period ends, even while still marked active", () => {
    const sub = { status: "active", current_period_end: "2026-10-04T09:00:00Z" };
    expect(lockState(sub, NOW - 1)).toBe("open");
    expect(lockState(sub, NOW)).toBe("expired");
  });

  it("uses the trial end for trials", () => {
    const sub = { status: "trialing", trial_ends_at: "2026-10-03T00:00:00Z", current_period_end: "2026-10-09T00:00:00Z" };
    expect(lockState(sub, NOW)).toBe("expired");
    expect(subscriptionEndMs(sub)).toBe(Date.parse("2026-10-03T00:00:00Z"));
  });

  it("falls back to the period end for a trial without a trial date", () => {
    expect(lockState({ status: "trialing", current_period_end: "2026-10-12T20:59:59Z" }, NOW)).toBe("open");
  });

  it("treats expired, suspended and paused statuses as locked", () => {
    expect(lockState({ status: "expired", current_period_end: "2099-01-01T00:00:00Z" }, NOW)).toBe("expired");
    expect(lockState({ status: "suspended" }, NOW)).toBe("suspended");
    expect(lockState({ status: "paused" }, NOW)).toBe("suspended");
  });

  it("unlocks after renewal pushes the end date forward", () => {
    expect(lockState({ status: "active", current_period_end: "2026-11-04T09:00:00Z" }, NOW)).toBe("open");
  });
});
