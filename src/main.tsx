import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import ErrorBoundary from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./index.css";
import { initTheme } from "./hooks/useTheme";
import { startReveal } from "./lib/reveal";
import { initFreshAppCache } from "./lib/cacheControl";
import { registerAppServiceWorker } from "./lib/registerSW";
import { installStaleBuildReload } from "./lib/staleBuildReload";
import { installErrorReporter } from "./lib/errorReporter";
import { installResponsiveTables } from "./lib/responsiveTables";
import { installTableFit } from "./lib/tableFit";
import { installActiveTabInView } from "./lib/activeTabInView";
import { startBootCover } from "./lib/bootScreen";
import { installShopSlugHeader } from "./lib/host";

// A company's pages on app.jmsurfgarage.co.ke/<slug>/ tell the server which company their API calls are for.
installShopSlugHeader();
installErrorReporter();
installResponsiveTables();
installTableFit();
installActiveTabInView();

initTheme();
startReveal();
initFreshAppCache();
registerAppServiceWorker();
// Open tabs move to a new release within ~20 s of a deploy, at a quiet moment (never on the till).
installStaleBuildReload();

// The browser offers installation once, usually before the sidebar exists.
// Keep the offer so the "Install app" button can use it whenever it appears.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  (window as any).__installPrompt = event;
  window.dispatchEvent(new Event("jmsurf:install-available"));
});
window.addEventListener("appinstalled", () => {
  (window as any).__installPrompt = null;
  window.dispatchEvent(new Event("jmsurf:install-available"));
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </ErrorBoundary>
);
// boot-guard.js keeps the crawler text (.seo-pre) hidden and shows the loading screen until this is set.
(window as any).__appMounted = true;
startBootCover();
document.documentElement.classList.remove("boot-slow", "boot-failed");
