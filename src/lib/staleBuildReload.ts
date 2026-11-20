/**
 * Open tabs move to a new release by themselves, within about 20 seconds of the deploy.
 *
 * While the tab is in view it asks every 20 s for /build.json (a few bytes, never cached; written by the vite
 * plugin in vite.config.ts) and compares the id with its own build. /build.json and not the entry script:
 * Cloudflare keeps /assets/* for a year, so an old script file keeps answering. When a newer build is live the
 * tab reloads at the first quiet moment: straight away when it is out of sight, on the next page change, or after
 * 8 s without a touch. Never on the till (POS screen) or while a pop-up or a half-typed field is open: those wait.
 * With the offline service worker the reload waits for the new worker to take over first, so the tab opens the
 * new files, not the old cached copy. At most 3 tries in 2 minutes, so a deploy still switching over cannot loop.
 */
declare const __APP_BUILD_ID__: string | undefined;

const BUILD_ID = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "dev";
const CHECK_MS = 20_000;
const IDLE_MS = 8_000;
const TRIES_KEY = "garage-new-build-tries";
const MAX_TRIES = 3;
const TRY_WINDOW_MS = 120_000;

let tillBusy = false;
let newBuild = false;
let lastTouch = Date.now();
let idleTimer: number | null = null;
let reloading = false;

/** A screen with a sale in progress can hold reloads off (the till route always does). */
export function setTillBusy(busy: boolean) {
  tillBusy = busy;
  if (!busy && newBuild) reloadWhenQuiet();
}

/** The till and its customer display: a reload there could drop a cart or a payment being waited on. */
export function onTill(pathname = typeof location !== "undefined" ? location.pathname : ""): boolean {
  return /^(\/[^/]+)?\/pos(\/|$)/.test(pathname);
}

/** A text field with something typed in it has focus. */
export function typing(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !!el.value && !/^(checkbox|radio|button|submit|reset|range|color|hidden)$/i.test(el.type || "");
}

/** Nothing would be lost by reloading now. */
export function quiet(): boolean {
  if (tillBusy || onTill()) return false;
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return false;
  return !typing();
}

/** Records one reload try; false when 3 were already made in the last 2 minutes. */
export function takeReloadTry(now = Date.now()): boolean {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(TRIES_KEY) || "[]");
    const tries = (Array.isArray(saved) ? saved : []).filter((t): t is number => typeof t === "number" && now - t < TRY_WINDOW_MS);
    if (tries.length >= MAX_TRIES) return false;
    sessionStorage.setItem(TRIES_KEY, JSON.stringify([...tries, now]));
  } catch { /* storage blocked: still reload */ }
  return true;
}

/** Asks /build.json whether a newer release is live. */
export async function checkForNewBuild(): Promise<boolean> {
  if (newBuild) return true;
  if (BUILD_ID === "dev" || navigator.onLine === false) return false;
  try {
    const res = await fetch(`/build.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const { id } = (await res.json()) as { id?: string };
    if (id && id !== BUILD_ID) { newBuild = true; reloadWhenQuiet(); }
  } catch { /* no answer: try again later */ }
  return newBuild;
}

/**
 * With the offline worker in charge, asks it to fetch the new release and waits (up to 30 s) for it to take
 * over, so the reload opens the new files. Returns at once when there is no worker or nothing new to install.
 */
async function newWorkerReady(): Promise<void> {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw?.controller) return;
  try {
    const reg = await sw.getRegistration();
    if (!reg) return;
    await new Promise<void>((resolve) => {
      let t = 0;
      const done = () => { sw.removeEventListener("controllerchange", done); window.clearTimeout(t); resolve(); };
      t = window.setTimeout(done, 30_000);
      sw.addEventListener("controllerchange", done);
      reg.update().then(() => { if (!reg.installing && !reg.waiting) done(); }, done);
    });
  } catch { /* reload anyway */ }
}

async function reloadNow() {
  if (reloading) return;
  if (!takeReloadTry()) return;
  reloading = true;
  // registerSW shows a "new version" card on the worker change; this reload already is that update.
  (window as unknown as { __garageBuildReload?: boolean }).__garageBuildReload = true;
  await newWorkerReady();
  if (!quiet()) { reloading = false; reloadWhenQuiet(); return; }
  window.location.reload();
}

function reloadWhenQuiet() {
  if (idleTimer) window.clearTimeout(idleTimer);
  if (document.hidden && quiet()) { void reloadNow(); return; }
  const wait = Math.max(1_000, IDLE_MS - (Date.now() - lastTouch));
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (Date.now() - lastTouch >= IDLE_MS - 50 && quiet()) void reloadNow();
    else reloadWhenQuiet();
  }, wait);
}


/** Call on an in-app page change: once a newer build is live the next page opens on it. */
export function reloadIfNewBuild() {
  if (newBuild && quiet()) void reloadNow();
}

export function installStaleBuildReload() {
  if (typeof window === "undefined" || BUILD_ID === "dev") return;
  const w = window as unknown as { __garageBuildWatch?: boolean };
  if (w.__garageBuildWatch) return;
  w.__garageBuildWatch = true;
  for (const e of ["pointerdown", "keydown", "touchstart", "wheel"]) {
    window.addEventListener(e, () => { lastTouch = Date.now(); }, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (newBuild) reloadWhenQuiet();
    else if (!document.hidden) void checkForNewBuild();
  });
  window.addEventListener("online", () => void checkForNewBuild());
  // Only while the tab is in view: a hidden tab checks when it is looked at again.
  window.setInterval(() => { if (!document.hidden) void checkForNewBuild(); }, CHECK_MS);
}

/** Tests only. */
export function __resetForTests() {
  tillBusy = false; newBuild = false; reloading = false; lastTouch = Date.now();
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = null;
}
