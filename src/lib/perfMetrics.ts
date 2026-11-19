/**
 * Lightweight in-memory performance metrics collector.
 * Tracks Supabase query timings, refetch counts, and route load timings.
 * Survives in-memory only — resets on full reload, which is appropriate
 * for an in-app diagnostics view.
 */

export interface QuerySample {
  key: string;
  ms: number;
  at: number;
  ok: boolean;
}

export interface RouteSample {
  path: string;
  ms: number;
  at: number;
}

const MAX = 200;

const queries: QuerySample[] = [];
const routes: RouteSample[] = [];
const refetchCounts = new Map<string, number>();

export function recordQuery(s: QuerySample) {
  queries.unshift(s);
  if (queries.length > MAX) queries.length = MAX;
  refetchCounts.set(s.key, (refetchCounts.get(s.key) || 0) + 1);
}

export function recordRoute(s: RouteSample) {
  routes.unshift(s);
  if (routes.length > MAX) routes.length = MAX;
}

export function getMetrics() {
  return {
    queries: [...queries],
    routes: [...routes],
    refetches: Array.from(refetchCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function clearMetrics() {
  queries.length = 0;
  routes.length = 0;
  refetchCounts.clear();
}

/** Wrap a thenable Supabase query and record its timing. */
export async function timed<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    recordQuery({ key, ms: performance.now() - t0, at: Date.now(), ok });
  }
}
