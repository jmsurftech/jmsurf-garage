/**
 * Guarded service-worker registration.
 *
 * Offline support only runs on the real published shop domains. Lovable
 * previews, iframes and dev never register a worker, and `?sw=off`
 * removes an existing one.
 */
const SW_URL = "/sw.js";

function blocked(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return true;
  if (!import.meta.env.PROD) return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  const previewRoots = ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"];
  if (previewRoots.some((root) => host === root || host.endsWith(`.${root}`))) return true;
  if (new URLSearchParams(window.location.search).has("sw")
    && new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterApp() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => (r.active?.scriptURL || r.waiting?.scriptURL || "").endsWith(SW_URL))
      .map((r) => r.unregister())
  );
}

export function registerAppServiceWorker() {
  if (blocked()) {
    unregisterApp().catch(() => undefined);
    return;
  }
  // A new release takes over in the background (skipWaiting + clientsClaim). A page opened in the last
  // minute already came from the network as that release, so nothing is done (it used to reload, which
  // after every deploy showed the loading screen again). An older page asks, so a half-filled form is never lost.
  const hadController = !!navigator.serviceWorker.controller;
  const opened = Date.now();
  let handled = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || handled) return;
    handled = true;
    if (Date.now() - opened < 60_000) return;
    // lib/staleBuildReload is already reloading this tab onto the new release: no card in between.
    if ((window as unknown as { __garageBuildReload?: boolean }).__garageBuildReload) return;
    showUpdateCard();
    // Otherwise the next page change loads the new release (the page being left is done with).
    onNextNavigation(() => window.location.reload());
  });
  const go = () => {
    navigator.serviceWorker.register(SW_URL, { scope: "/" })
      .then((reg) => {
        // Look for a new release every 10 minutes, when the tab comes back into view, and on page changes
        // (at most every 2 minutes), so nobody works on an old release for long.
        let last = Date.now();
        const check = (minGap: number) => { if (Date.now() - last < minGap) return; last = Date.now(); reg.update().catch(() => undefined); };
        setInterval(() => check(0), 10 * 60_000);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(60_000); });
        onEveryNavigation(() => check(2 * 60_000));
      })
      .catch(() => undefined);
  };
  // The app can start after the page has already finished loading; register straight away then.
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** Page changes inside the app (links, back and forward). */
const navListeners = new Set<() => void>();
let navHooked = false;
function hookNavigation() {
  if (navHooked) return;
  navHooked = true;
  const fire = () => navListeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = history[m].bind(history);
    history[m] = ((...args: Parameters<History["pushState"]>) => {
      const before = location.pathname;
      const r = orig(...args);
      if (location.pathname !== before) setTimeout(fire, 0);
      return r;
    }) as History["pushState"];
  }
  window.addEventListener("popstate", () => setTimeout(fire, 0));
}
function onEveryNavigation(f: () => void) { hookNavigation(); navListeners.add(f); }
function onNextNavigation(f: () => void) {
  hookNavigation();
  const once = () => { navListeners.delete(once); f(); };
  navListeners.add(once);
}

/** "New version ready": a card at the top centre, in the app's colours, with Reload and Later. */
function showUpdateCard() {
  if (document.getElementById("jd-update")) return;
  const el = document.createElement("div");
  el.id = "jd-update";
  el.setAttribute("role", "alert");
  el.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;width:min(460px,calc(100vw - 24px));animation:jdIn .35s cubic-bezier(.2,.8,.2,1)";
  el.innerHTML = `
    <style>@keyframes jdIn{from{opacity:0;transform:translate(-50%,-14px) scale(.97)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
      #jd-update button{font:inherit;cursor:pointer;border:0;border-radius:12px;padding:9px 16px;font-weight:600;font-size:14px}</style>
    <div style="overflow:hidden;border-radius:20px;background:hsl(var(--card));color:hsl(var(--card-foreground));border:1px solid hsl(var(--border));box-shadow:0 24px 60px -16px rgba(0,0,0,.45)">
      <div style="height:5px;background:linear-gradient(90deg,hsl(var(--primary)),hsl(var(--primary)/.45))"></div>
      <div style="display:flex;gap:14px;padding:16px 16px 14px">
        <span style="flex:none;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;background:hsl(var(--primary));color:hsl(var(--primary-foreground))">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.4 7.2 17.9l.9-5.4L4.2 8.7l5.4-.8z"/></svg>
        </span>
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;font-size:15.5px;line-height:1.3">A new version is ready</div>
          <div style="margin-top:3px;font-size:13.5px;opacity:.75">Reload to get the latest improvements. Anything you are typing stays until you reload.</div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button id="jd-reload" style="background:hsl(var(--primary));color:hsl(var(--primary-foreground))">Reload now</button>
            <button id="jd-later" style="background:hsl(var(--muted));color:hsl(var(--foreground))">Later</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("#jd-reload")?.addEventListener("click", () => window.location.reload());
  el.querySelector("#jd-later")?.addEventListener("click", () => el.remove());
}
