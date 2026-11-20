import { useCallback, useState, type SetStateAction } from "react";

/**
 * State that survives leaving and reopening a page in the same tab (sticky state).
 * A page reopens showing its last list at once, then refreshes it quietly, instead of a
 * blank "Loading" on every visit. Kept in memory only (never on the device) and cleared on
 * sign-out, so nothing carries over to the next person. Keys must name the company (and the
 * scope) when the same screen can show different data, e.g. `audit:${tenantId}:${role}`.
 * Lists read through react-query already behave like this; use it for pages that load into
 * their own useState.
 */
const store = new Map<string, unknown>();

export const hasCached = (key: string) => store.has(key);

/** Forget every page's remembered state (called on sign-out). */
export function clearCachedState() {
  store.clear();
}

/** Like useState, but the last value is still there when the page is opened again. */
export function useCachedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback((next: SetStateAction<T>) => {
    setValue((prev) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      store.set(key, v);
      return v;
    });
  }, [key]);
  return [value, set] as const;
}

/**
 * A page's "loading" flag: true only until its first load finishes. On later visits it stays
 * false while the page refreshes, so the last list stays on screen.
 */
export function useStickyLoading(key: string) {
  const k = `loaded:${key}`;
  const [value, setValue] = useState<boolean>(() => !store.has(k));
  const set = useCallback((next: SetStateAction<boolean>) => {
    setValue((cur) => {
      const v = typeof next === "function" ? (next as (c: boolean) => boolean)(cur) : next;
      if (!v) { store.set(k, true); return false; }
      return !store.has(k);
    });
  }, [k]);
  return [value, set] as const;
}
