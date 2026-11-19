import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;

/**
 * "Install app": puts the shop on the desktop, taskbar or phone home screen.
 * Uses the browser's own install prompt when it is available (Chrome, Edge,
 * Android); otherwise shows the two-step instructions for that device.
 * Hidden once the app is already running installed.
 */
export default function InstallAppButton({ className }: { className?: string }) {
  const [prompt, setPrompt] = useState<any>(() => (window as any).__installPrompt || null);
  const [installed, setInstalled] = useState(isStandalone);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setPrompt((window as any).__installPrompt || null);
      setInstalled(isStandalone());
    };
    window.addEventListener("jmsurf:install-available", refresh);
    return () => window.removeEventListener("jmsurf:install-available", refresh);
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) {
      setHelp(true);
      return;
    }
    prompt.prompt();
    try {
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") setInstalled(true);
    } catch { /* dismissed */ }
    (window as any).__installPrompt = null;
    setPrompt(null);
  };

  const platform = detectPlatform();
  const steps =
    platform === "ios"
      ? ["Open this page in Safari.", "Tap the Share button, then “Add to Home Screen”."]
      : platform === "android"
        ? ["Open the browser menu (⋮).", "Tap “Install app” or “Add to Home screen”."]
        : ["Click the install icon at the right end of the address bar,", "or open the browser menu (⋮) → “Install JMSURF Garage” / “Apps → Install this site as an app”."];

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={className || "flex items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-xs font-medium text-sidebar-foreground/80 hover:text-sidebar-primary-foreground"}
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
      {help && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card text-card-foreground border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="font-display font-semibold">Install on this {platform === "desktop" ? "computer" : "phone"}</h3>
              <button onClick={() => setHelp(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
              {steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">The app then opens from its own icon, full screen, like any installed program.</p>
          </div>
        </div>
      )}
    </>
  );
}
