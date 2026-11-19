import { createElement, lazy, useState, type ComponentType } from "react";

type Loader<T> = () => Promise<{ default: T }>;

const preloaders: Array<() => Promise<unknown>> = [];

/**
 * Like React.lazy, but once the page's code has arrived (opened before, or
 * fetched in the background by preloadPages) it renders straight away instead
 * of suspending, so a sidebar click swaps only the page, with no loader.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: Loader<T>) {
  let loaded: T | null = null;
  let pending: Promise<{ default: T }> | null = null;
  const fetch = () => {
    if (!pending) {
      // A page file that failed to arrive (e.g. mid-deploy) rejects, so the page shows "Try again" instead of crashing.
      pending = load().then((m) => { if (!m?.default) throw new Error("This page did not load. Try again."); loaded = m.default; return m; });
      pending.catch(() => { pending = null; });
    }
    return pending;
  };
  const Lazy = lazy(fetch);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Page = (props: any) => {
    // Chosen once per mount, so a page opened while loading is never remounted when its code arrives.
    const [C] = useState(() => loaded ?? Lazy);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createElement(C as ComponentType<any>, props);
  };
  preloaders.push(fetch);
  (Page as unknown as { preload: () => Promise<unknown> }).preload = fetch;
  return Page as unknown as T;
}

// Each route's page code, so the menu can load exactly the pages this person can open.
const routeLoaders: { parts: string[]; load: () => Promise<unknown> }[] = [];

/** Takes the route table ({ path, element: <Wrapper><Page /></Wrapper> }) and remembers each page's loader. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRoutes(routes: { path?: string; element?: any }[]) {
  for (const r of routes) {
    const load = r.element?.props?.children?.type?.preload ?? r.element?.type?.preload;
    if (r.path && load) routeLoaders.push({ parts: r.path.split("/"), load });
  }
}

function loaderFor(path: string) {
  const want = path.replace(/^\//, "").split("?")[0].split("/");
  const fits = (parts: string[]) => parts.length === want.length && parts.every((p, i) => p.startsWith(":") || p === want[i]);
  return (routeLoaders.find((r) => !r.parts.some((p) => p.startsWith(":")) && fits(r.parts)) ?? routeLoaders.find((r) => fits(r.parts)))?.load;
}

/** Loads one page's code now (the pointer is on its menu item). */
export function preloadRoute(path: string) {
  return loaderFor(path)?.() ?? Promise.resolve();
}

let started = false;

/**
 * Fetches pages' code in the background so a menu click swaps only the page, with no loader. It waits for the
 * open page to settle, takes two files at a time and stays off on a slow or data-saving connection: fetching
 * every page after each deploy competed with the page's own data. Pass the paths this person can open;
 * without paths it takes every page (platform admins).
 */
export function preloadPages(paths?: string[]) {
  if (started || typeof window === "undefined") return;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /2g|3g/.test(conn?.effectiveType ?? "")) return;
  started = true;
  const wanted = paths ? paths.map(loaderFor).filter((l): l is () => Promise<unknown> => !!l) : preloaders;
  const queue = [...new Set(wanted)];
  const next = () => {
    const batch = queue.splice(0, 4);
    if (!batch.length) return;
    Promise.allSettled(batch.map((f) => f())).then(() => idle(next));
  };
  window.setTimeout(() => idle(next), 1500);
}

function idle(fn: () => void) {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 2000 }); else window.setTimeout(fn, 200);
}
