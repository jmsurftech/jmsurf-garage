import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const BEAT_MS = 2 * 60_000;

const device = () => {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
};

/**
 * Tells the platform this person is using the system: a beat every two minutes while the
 * tab is visible (online now, and minutes used per day for the platform owner's usage page).
 */
export function usePresence(enabled: boolean) {
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    const beat = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void (supabase as any).rpc("touch_presence", { p_path: path.current, p_agent: device() }).then(() => undefined, () => undefined);
    };
    beat();
    const t = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", beat); };
  }, [enabled]);
}
