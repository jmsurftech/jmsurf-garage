import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyPage, pagesInGroup, preloadPages, slowConnection } from "./lazyPage";

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as unknown as { connection?: unknown }).connection;
});

describe("preloadPages", () => {
  it("fetches only the platform console's pages without menu paths, never the website's", async () => {
    vi.useFakeTimers();
    const app = vi.fn(async () => ({ default: () => null }));
    const admin = vi.fn(async () => ({ default: () => null }));
    const site = vi.fn(async () => ({ default: () => null }));
    lazyPage(app);
    lazyPage(admin, "admin");
    lazyPage(site, "public");
    expect(pagesInGroup("admin")).toBeGreaterThan(0);

    preloadPages();
    expect(admin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(admin).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
    expect(site).not.toHaveBeenCalled();

    // Once per group.
    preloadPages();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(admin).toHaveBeenCalledTimes(1);
  });
});

describe("slowConnection", () => {
  it("is on for 2g/3g and data saver only", () => {
    const set = (c: unknown) => Object.defineProperty(navigator, "connection", { value: c, configurable: true });
    set({ effectiveType: "4g" });
    expect(slowConnection()).toBe(false);
    set({ effectiveType: "3g" });
    expect(slowConnection()).toBe(true);
    set({ effectiveType: "slow-2g" });
    expect(slowConnection()).toBe(true);
    set({ effectiveType: "4g", saveData: true });
    expect(slowConnection()).toBe(true);
  });
});
