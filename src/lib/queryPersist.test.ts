import { beforeEach, describe, expect, it, vi } from "vitest";

const meta = new Map<string, unknown>();
vi.mock("@/lib/offlineDb", () => ({
  getMeta: async (k: string) => meta.get(k) ?? null,
  setMeta: async (k: string, v: unknown) => { meta.set(k, v); },
}));

import { checkCacheOwner, clearDeviceCache, QUERY_CACHE_META } from "./queryPersist";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  meta.clear();
});

describe("checkCacheOwner", () => {
  it("keeps the copy for the same person and company", async () => {
    meta.set(QUERY_CACHE_META, { saved: true });
    expect(checkCacheOwner("u1")).toBe(false);
    expect(checkCacheOwner("u1", "t1")).toBe(false);
    expect(checkCacheOwner("u1")).toBe(false);
    expect(checkCacheOwner("u1", "t1")).toBe(false);
    await flush();
    expect(meta.get(QUERY_CACHE_META)).toEqual({ saved: true });
  });

  it("drops the copy when another person signs in", async () => {
    checkCacheOwner("u1", "t1");
    meta.set(QUERY_CACHE_META, { saved: true });
    expect(checkCacheOwner("u2")).toBe(true);
    await flush();
    expect(meta.get(QUERY_CACHE_META)).toBeNull();
  });

  it("drops the copy when the same person opens another company", async () => {
    checkCacheOwner("u1", "t1");
    meta.set(QUERY_CACHE_META, { saved: true });
    expect(checkCacheOwner("u1", "t2")).toBe(true);
    await flush();
    expect(meta.get(QUERY_CACHE_META)).toBeNull();
    expect(checkCacheOwner("u1", "t2")).toBe(false);
  });

  it("sign-out forgets the owner as well as the copy", async () => {
    checkCacheOwner("u1", "t1");
    meta.set(QUERY_CACHE_META, { saved: true });
    await clearDeviceCache();
    expect(meta.get(QUERY_CACHE_META)).toBeNull();
    expect(checkCacheOwner("u2", "t9")).toBe(false);
  });
});
