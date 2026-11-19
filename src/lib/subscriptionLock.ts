// When a shop's package or trial runs out, the shop is locked the same second:
// owners and managers are kept on Billing until they pay, other staff are
// signed out. Paying updates the subscription row and the lock lifts by itself.

export interface SubscriptionLike {
  status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

export type LockState = "open" | "expired" | "suspended";

/** Roles that may stay signed in on Billing to renew a locked shop. */
export const RENEWAL_ROLES = ["admin", "manager"];

export const EXPIRED_SIGNIN_MESSAGE =
  "This shop's system subscription has expired. Ask the shop owner to renew it on the Billing page, then sign in again.";

const TRIAL = ["trial", "trialing"];

/** End of the paid period or trial, in ms; null when it never ends. */
export function subscriptionEndMs(sub: SubscriptionLike | null | undefined): number | null {
  if (!sub) return null;
  const status = String(sub.status || "").toLowerCase();
  const raw = TRIAL.includes(status)
    ? sub.trial_ends_at || sub.current_period_end
    : sub.current_period_end || sub.trial_ends_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function lockState(sub: SubscriptionLike | null | undefined, now = Date.now()): LockState {
  if (!sub) return "open";
  const status = String(sub.status || "").toLowerCase();
  if (status === "suspended" || status === "paused") return "suspended";
  if (status === "expired" || status === "cancelled" || status === "canceled") return "expired";
  const end = subscriptionEndMs(sub);
  return end !== null && now >= end ? "expired" : "open";
}
