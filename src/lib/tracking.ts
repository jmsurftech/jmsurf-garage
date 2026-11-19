/**
 * Marketing analytics (Meta Pixel and Google Analytics). The scripts are only
 * on the page when the platform owner set their IDs (super admin → Settings →
 * Tracking); the server injects them. These helpers do nothing otherwise.
 */
type Fbq = (cmd: string, event: string, params?: Record<string, unknown>) => void;
type Gtag = (cmd: string, event: string, params?: Record<string, unknown>) => void;

const w = () => (typeof window === "undefined" ? null : (window as unknown as { fbq?: Fbq; gtag?: Gtag }));

/** Standard events: Lead, CompleteRegistration, StartTrial, Contact, ViewContent, Subscribe, Purchase. */
export function track(event: string, params: Record<string, unknown> = {}) {
  try {
    w()?.fbq?.("track", event, params);
    w()?.gtag?.("event", event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), params);
  } catch { /* analytics must never break the page */ }
}

/** Single-page navigation: count each screen as a page view. */
export function trackPageView() {
  try { w()?.fbq?.("track", "PageView"); } catch { /* ignore */ }
}
