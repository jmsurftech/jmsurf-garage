import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenantLoginPath } from "@/hooks/useTenant";
import { useToast } from "@/hooks/use-toast";

interface SessionConfig {
  idle_timeout_minutes: number;
  daily_logout_time: string;       // "HH:MM"
  session_warning_seconds: number;
}

const DEFAULTS: SessionConfig = {
  idle_timeout_minutes: 60,
  daily_logout_time: "04:00",
  session_warning_seconds: 60,
};

/** Activity events that reset the idle timer */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"] as const;

/**
 * Loads session config: tenant-level overrides platform default.
 * Returns DEFAULTS while loading or if user is not signed in.
 */
function useSessionConfig(adminVariant: boolean): SessionConfig {
  const { user, profile } = useAuth();
  const [cfg, setCfg] = useState<SessionConfig>(DEFAULTS);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Always read the platform default first
      const { data: platform } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "session")
        .maybeSingle();
      const platformVal = (platform?.value as Partial<SessionConfig>) || {};

      let tenantVal: Partial<SessionConfig> = {};
      if (!adminVariant && profile?.tenant_id) {
        const { data: biz } = await supabase
          .from("business_settings")
          .select("idle_timeout_minutes, daily_logout_time, session_warning_seconds")
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle();
        if (biz) tenantVal = biz as any;
      }

      if (cancelled) return;
      setCfg({
        idle_timeout_minutes:
          tenantVal.idle_timeout_minutes ?? platformVal.idle_timeout_minutes ?? DEFAULTS.idle_timeout_minutes,
        daily_logout_time:
          tenantVal.daily_logout_time ?? platformVal.daily_logout_time ?? DEFAULTS.daily_logout_time,
        session_warning_seconds:
          tenantVal.session_warning_seconds ?? platformVal.session_warning_seconds ?? DEFAULTS.session_warning_seconds,
      });
    })();
    return () => { cancelled = true; };
  }, [user, profile?.tenant_id, adminVariant]);

  return cfg;
}

/** Compute ms until the next occurrence of HH:MM in local time. */
function msUntilDailyCutoff(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 24 * 60 * 60 * 1000;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

interface Props {
  variant?: "tenant" | "admin";
}

/**
 * Manages idle-based and daily-cutoff sign-outs.
 * Renders a warning modal 60s (configurable) before the idle sign-out.
 */
export function SessionTimeoutManager({ variant = "tenant" }: Props) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const loginPath = useTenantLoginPath();
  const { toast } = useToast();
  const cfg = useSessionConfig(variant === "admin");
  // The admin portal signs out after a short 5-second countdown with no way to stay.
  const warnSecs = variant === "admin" ? 5 : cfg.session_warning_seconds;

  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(warnSecs);
  const warningRef = useRef(false);
  const signingOutRef = useRef(false);
  // Last activity, shared by every tab of this portal so a busy tab keeps the others alive.
  const storageKey = `jmsurf:last-activity:${variant}`;
  const lastActivityRef = useRef<number>(Date.now());

  const performSignOut = useCallback(async (reason: "idle" | "daily") => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    warningRef.current = false;
    setWarningOpen(false);
    try { await signOut(); } catch { /* local session is cleared either way */ }
    toast({
      title: reason === "idle" ? "Signed out due to inactivity" : "Daily session reset",
      description: reason === "idle"
        ? "Please sign in again to continue."
        : "All sessions end at the configured daily cutoff time.",
    });
    navigate(variant === "admin" ? "/admin" : loginPath);
  }, [signOut, navigate, loginPath, variant, toast]);

  // Reset when a new session starts.
  useEffect(() => {
    if (!user) return;
    signingOutRef.current = false;
    lastActivityRef.current = Date.now();
    try { localStorage.setItem(storageKey, String(lastActivityRef.current)); } catch { /* private mode */ }
  }, [user, storageKey]);

  // Record activity. Once the admin countdown has started it cannot be stopped.
  useEffect(() => {
    if (!user) return;
    let lastWrite = 0;
    const onActivity = () => {
      if (warningRef.current) return;
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastWrite > 5000) {
        lastWrite = now;
        try { localStorage.setItem(storageKey, String(now)); } catch { /* private mode */ }
      }
    };
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity));
  }, [user, storageKey]);

  // One clock, measured in real time, so sleeping laptops and background tabs
  // (where timers are paused or slowed) still sign out on time.
  useEffect(() => {
    if (!user) return;
    const idleMs = cfg.idle_timeout_minutes * 60 * 1000;
    const check = () => {
      if (signingOutRef.current) return;
      let last = lastActivityRef.current;
      try { last = Math.max(last, Number(localStorage.getItem(storageKey)) || 0); } catch { /* private mode */ }
      if (!warningRef.current) lastActivityRef.current = last;
      const left = Math.ceil((last + idleMs - Date.now()) / 1000);
      if (left <= 0) { performSignOut("idle"); return; }
      if (left <= warnSecs) {
        warningRef.current = true;
        setWarningOpen(true);
        setSecondsLeft(left);
      } else if (warningRef.current && variant !== "admin") {
        // Another tab was used: the shop warning closes by itself.
        warningRef.current = false;
        setWarningOpen(false);
      }
    };
    check();
    const t = window.setInterval(check, 1000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user, cfg.idle_timeout_minutes, warnSecs, variant, storageKey, performSignOut]);

  // Daily cutoff
  const dailyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!user) return;
    if (dailyTimerRef.current) window.clearTimeout(dailyTimerRef.current);
    // "off": no daily sign-out (only the idle timeout applies).
    if (!cfg.daily_logout_time || cfg.daily_logout_time === "off") return;
    dailyTimerRef.current = window.setTimeout(() => {
      performSignOut("daily");
    }, msUntilDailyCutoff(cfg.daily_logout_time));
    return () => {
      if (dailyTimerRef.current) window.clearTimeout(dailyTimerRef.current);
    };
  }, [user, cfg.daily_logout_time, performSignOut]);

  const stayActive = () => {
    warningRef.current = false;
    setWarningOpen(false);
    lastActivityRef.current = Date.now();
    try { localStorage.setItem(storageKey, String(lastActivityRef.current)); } catch { /* private mode */ }
  };

  if (!user || !warningOpen) return null;

  const isAdmin = variant === "admin";

  if (isAdmin) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="alertdialog" aria-live="assertive">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center text-foreground shadow-2xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary/25">
            <span className="font-display text-4xl font-bold tabular-nums text-primary">{Math.max(0, secondsLeft)}</span>
          </div>
          <h2 className="mt-5 text-lg font-bold">Signing you out</h2>
          <p className="mt-1 text-sm text-muted-foreground">The admin portal was idle, so it is locking for safety.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`w-full max-w-md rounded-2xl shadow-2xl border ${"bg-card border-border text-foreground"} p-6`}>
        <h2 className="text-lg font-bold mb-2">Are you still there?</h2>
        <p className={`text-sm mb-4 ${"text-muted-foreground"}`}>
          You've been idle for a while. You'll be signed out in
          <span className={`mx-1 font-bold tabular-nums ${"text-primary"}`}>
            {secondsLeft}s
          </span>
          if there's no activity.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => performSignOut("idle")}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${"bg-muted hover:bg-muted/80 text-foreground"}`}
          >
            Sign out now
          </button>
          <button
            onClick={stayActive}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${"bg-primary hover:bg-primary/90 text-primary-foreground"}`}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
