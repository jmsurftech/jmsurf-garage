/**
 * Pages open from the last copy kept on this device, then refresh quietly (speed: every request to the
 * server costs ~300 ms or more from Kenya). The copy lives in IndexedDB (room for lists, unlike
 * localStorage), lasts 24 hours and is wiped on sign-out. Pay, payroll and HR pay data are never kept.
 */
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";
import { getMeta, setMeta } from "@/lib/offlineDb";

export const QUERY_CACHE_META = "query-cache-v2";

/** Never kept on the device: pay and anything sensitive or bulky. */
// Never kept: money and secrets, and sign-in checks (a support pass or the platform owner check must be asked fresh).
const NEVER = /pay|salar|payslip|payroll|p9|bank|secret|token|migrat|staff-accounts|logo-palette|audit|hr-registr|support-pass|is-platform-admin/i;

export function keepOnDevice(q: Query): boolean {
  if (q.state.status !== "success" || q.state.data === undefined) return false;
  const key = q.queryKey.map((k) => (typeof k === "string" ? k : "")).join(" ");
  if (NEVER.test(key)) return false;
  const d: any = q.state.data;
  // Very long lists are fetched again rather than kept (they slow saving down on small phones).
  if (Array.isArray(d) && d.length > 2000) return false;
  if (d && Array.isArray(d.rows) && d.rows.length > 2000) return false;
  return true;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistedClient | null = null;

export const devicePersister: Persister = {
  persistClient: async (client) => {
    // Saved at most every 5 seconds: many quick changes are written once.
    pending = client;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const c = pending; pending = null;
      if (c) void setMeta(QUERY_CACHE_META, c).catch(() => undefined);
    }, 5000);
  },
  restoreClient: async () => {
    try { return ((await getMeta(QUERY_CACHE_META)) as PersistedClient) || undefined; } catch { return undefined; }
  },
  removeClient: async () => {
    if (timer) { clearTimeout(timer); timer = null; } pending = null;
    try { await setMeta(QUERY_CACHE_META, null); } catch { /* storage off */ }
  },
};

/**
 * Whose data the saved copy holds ("<user>|<company>"). The database's row rules (RLS) already stop one company
 * reading another's rows, but the copy kept on this device is shown before any request: it must belong to the
 * person and company now signed in. Another person, or another company (app. switches company on the same
 * address), starts from an empty copy.
 */
const OWNER_KEY = "garage.cache-owner";

function readOwner(): string {
  try { return localStorage.getItem(OWNER_KEY) || ""; } catch { return ""; }
}

/**
 * Call when the signed-in person is known (and again once their company is). Returns true when the saved copy
 * belonged to someone else or another company and was dropped: the caller then resets the queries in memory.
 */
export function checkCacheOwner(userId: string, tenantId?: string | null): boolean {
  if (!userId) return false;
  const prev = readOwner();
  const [prevUser, prevTenant = ""] = prev.split("|");
  const changed = !!prev && (prevUser !== userId || (!!tenantId && !!prevTenant && prevTenant !== tenantId));
  const next = `${userId}|${tenantId || (prevUser === userId && !changed ? prevTenant : "")}`;
  try { localStorage.setItem(OWNER_KEY, next); } catch { /* storage off */ }
  if (changed) void devicePersister.removeClient();
  return changed;
}

/** Sign-out or a company switch: nothing of this company's stays on the device. */
export async function clearDeviceCache() {
  try { localStorage.removeItem(OWNER_KEY); } catch { /* storage off */ }
  await devicePersister.removeClient();
}
