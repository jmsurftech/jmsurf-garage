declare const __APP_BUILD_ID__: string | undefined;

const APP_BUILD_ID = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "dev";
const BUILD_STORAGE_KEY = "jmsurf_app_build_id";

function isPreviewOrIframe() {
  let inIframe = false;
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  return inIframe;
}

async function clearAppCaches(forceAll: boolean) {
  if (!("caches" in window)) return;
  const staleNames = forceAll ? ["workbox", "precache", "api-cache", "runtime", "offline", "assets"] : ["runtime", "assets"];
  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      const shouldDelete = forceAll || staleNames.some((name) => key.toLowerCase().includes(name));
      return shouldDelete ? caches.delete(key) : Promise.resolve(false);
    })
  );
}

async function unregisterServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

export function initFreshAppCache() {
  if (typeof window === "undefined") return;

  // A new version was deployed and an old page file is gone: load the new
  // version once (at most once a minute, so it can never loop).
  window.addEventListener("vite:preloadError", (e) => {
    let last = 0; try { last = Number(sessionStorage.getItem("dash-reloaded-at") || 0); } catch { /* private mode */ }
    if (Date.now() - last < 60_000) return;
    try { sessionStorage.setItem("dash-reloaded-at", String(Date.now())); } catch { /* private mode */ }
    window.location.reload();
  });

  const previousBuild = localStorage.getItem(BUILD_STORAGE_KEY);
  const buildChanged = !!previousBuild && previousBuild !== APP_BUILD_ID;

  if (!previousBuild || buildChanged) {
    localStorage.setItem(BUILD_STORAGE_KEY, APP_BUILD_ID);
  }

  // Previews and iframes never keep a worker or caches around.
  if (isPreviewOrIframe()) {
    Promise.all([unregisterServiceWorkers(), clearAppCaches(true)])
      .catch((error) => console.warn("Fresh cache reset failed:", error));
    return;
  }

  // On a new release drop stale asset caches, but keep the offline worker so
  // shops can still sell without a connection. No reload: the page always comes
  // from the network (no navigateFallback), so this code already is the new release
  // (reloading here was one of the repeated loads after every deploy).
  if (buildChanged) {
    clearAppCaches(false).catch((error) => console.warn("Fresh cache reset failed:", error));
    return;
  }

  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.update());
  }).catch(() => undefined);
}