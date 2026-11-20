import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearCachedState, hasCached, useCachedState, useStickyLoading } from "./memoryCache";

describe("useCachedState", () => {
  it("gives a reopened page its last value, until sign-out clears it", () => {
    const first = renderHook(() => useCachedState<string[]>("list:t1", []));
    act(() => first.result.current[1](["Brake pads"]));
    first.unmount();

    const again = renderHook(() => useCachedState<string[]>("list:t1", []));
    expect(again.result.current[0]).toEqual(["Brake pads"]);
    // Another company's key starts empty.
    expect(renderHook(() => useCachedState<string[]>("list:t2", [])).result.current[0]).toEqual([]);

    clearCachedState();
    expect(hasCached("list:t1")).toBe(false);
    expect(renderHook(() => useCachedState<string[]>("list:t1", [])).result.current[0]).toEqual([]);
  });

  it("accepts an updater function", () => {
    const h = renderHook(() => useCachedState("count", 1));
    act(() => h.result.current[1]((n) => n + 1));
    expect(h.result.current[0]).toBe(2);
    clearCachedState();
  });
});

describe("useStickyLoading", () => {
  it("is true only until the first load finishes", () => {
    const first = renderHook(() => useStickyLoading("jobs"));
    expect(first.result.current[0]).toBe(true);
    act(() => first.result.current[1](false));
    expect(first.result.current[0]).toBe(false);
    first.unmount();

    const again = renderHook(() => useStickyLoading("jobs"));
    expect(again.result.current[0]).toBe(false);
    // A refresh on a later visit keeps the last list on screen.
    act(() => again.result.current[1](true));
    expect(again.result.current[0]).toBe(false);

    clearCachedState();
    expect(renderHook(() => useStickyLoading("jobs")).result.current[0]).toBe(true);
  });
});
