// Sends browser crashes to the app server so the platform owner is alerted.
// At most 10 reports per page load, and each distinct error only once.

const sent = new Set<string>();
let count = 0;

const IGNORE = [
  /ResizeObserver loop/i,
  /Script error\.?$/i,              // cross-origin noise with no detail
  /Failed to fetch dynamically imported module/i, // handled by auto-reload after a deploy
  /Loading chunk \d+ failed/i,
  /NetworkError|Load failed|Failed to fetch/i, // offline; the app handles it
  /AbortError/i,
  /Failed to (update|register) a ServiceWorker/i, // the server was restarting during a deploy; the next load retries
];

function shopSlug(): string | null {
  const host = window.location.hostname;
  const parts = host.split(".");
  if (parts.length > 2 && !["www", "db", "admin"].includes(parts[0])) return parts[0];
  const m = window.location.pathname.match(/^\/([a-z0-9-]{3,})\//);
  return m ? m[1] : null;
}

function reportUrl(): string {
  // Every JMSURF Garage address is served by the same server: same-origin calls.
  return "/api/telemetry/error";
}

export function reportError(error: unknown, extra?: { componentStack?: string }) {
  try {
    const err = error instanceof Error ? error : new Error(String((error as any)?.message ?? error));
    const message = `${err.name && err.name !== "Error" ? err.name + ": " : ""}${err.message || "Unknown error"}`.slice(0, 500);
    if (!message || IGNORE.some((re) => re.test(message))) return;
    if (sent.has(message) || count >= 10) return;
    sent.add(message);
    count++;
    const body = JSON.stringify({
      message,
      stack: `${err.stack || ""}${extra?.componentStack ? `\n--- component ---${extra.componentStack}` : ""}`.slice(0, 4000),
      path: window.location.pathname,
      tenant_slug: shopSlug(),
    });
    // Shop addresses (afterhours.garage.jmsurf.co.ke…) cannot take a POST, so
    // reports go to the main address, as plain text (no cross-site preflight).
    const url = reportUrl();
    const sentOk = navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    if (!sentOk) void fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* never let reporting break the app */
  }
}

export function installErrorReporter() {
  if (!import.meta.env.PROD) return;
  window.addEventListener("error", (e) => reportError(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}
