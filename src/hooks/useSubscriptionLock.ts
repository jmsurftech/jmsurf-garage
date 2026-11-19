import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { lockState, subscriptionEndMs, type LockState } from "@/lib/subscriptionLock";

const MAX_TIMEOUT = 2_147_000_000; // setTimeout's 32-bit limit (~24.8 days)

/**
 * The shop's lock state, re-checked the moment the package ends (and every
 * minute, in case the device slept). A renewal arrives through the live
 * subscription row in useAuth, so the lock lifts without a reload.
 */
export function useSubscriptionLock(): LockState {
  const { subscription } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  const end = subscriptionEndMs(subscription);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    let atEnd: ReturnType<typeof setTimeout> | undefined;
    if (end !== null && end > Date.now()) {
      atEnd = setTimeout(() => setNow(Date.now()), Math.min(end - Date.now() + 250, MAX_TIMEOUT));
    }
    return () => { clearInterval(tick); if (atEnd) clearTimeout(atEnd); };
  }, [end]);

  return lockState(subscription, Math.max(now, Date.now()));
}
