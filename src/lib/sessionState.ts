import { useState } from "react";

const store = new Map<string, unknown>();

/** useState that remembers its value for the session: going back to a page shows its last data at once while it refreshes. */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  return [v, (next: T) => { store.set(key, next); setV(next); }];
}
