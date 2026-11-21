import { callServer } from "@/lib/serverStaff";

/**
 * Admin → Companies and Users: calls to the app server (platformadmin.js). Platform owner only;
 * the server keeps the backend key and records every change in the company's activity.
 */
export async function adminCall<T = any>(path: `companies/${string}` | `users/${string}`, body: Record<string, unknown> = {}): Promise<T> {
  const r = await callServer<T>(`/api/admin/${path}`, body);
  if (r.unavailable) throw new Error("Could not reach the server. Check your connection and try again.");
  if (r.error) throw new Error(r.error);
  return r.data as T;
}

export const COMPANY_ROLES: [string, string][] = [
  ["admin", "Administrator"], ["manager", "Manager"], ["finance", "Finance"], ["cashier", "Cashier"],
  ["sales_person", "Sales person"], ["stock_manager", "Stock manager"], ["customer_service", "Customer service"],
  ["rider", "Rider"], ["packaging", "Packaging"],
];
export const roleLabel = (r?: string | null) => COMPANY_ROLES.find(([v]) => v === r)?.[1] || String(r || "—").replace(/_/g, " ");

/** Admin action keys → plain words, for the Activity tab and the audit log. */
export const ACTION_LABELS: Record<string, string> = {
  company_details: "Changed company details",
  subscription_changed: "Changed the plan",
  trial_set: "Set the trial end",
  trial_ended: "Ended the trial",
  plan_free: "Gave the plan free",
  plan_free_ended: "Ended the free plan",
  module_comped: "Gave a module free",
  module_trial: "Started a module trial",
  module_active: "Switched a module on",
  module_cancelled: "Switched a module off",
  module_price: "Changed a module price",
  company_suspended: "Suspended the company",
  company_reactivated: "Reactivated the company",
  company_archived: "Archived the company",
  company_restored: "Restored the company",
  payment_recorded: "Recorded a payment",
  sms_added: "Added SMS credit",
  sms_removed: "Took off SMS credit",
  note_added: "Added a note",
  note_deleted: "Deleted a note",
  user_added: "Added a user",
  user_attached: "Gave an existing login access",
  user_role: "Changed a role",
  user_removed: "Removed a user",
  owner_transferred: "Transferred ownership",
  login_enabled: "Allowed sign-in",
  login_disabled: "Blocked sign-in",
  password_reset_sent: "Sent a password reset link",
  mfa_reset: "Reset two-step sign-in",
  signed_out_everywhere: "Signed a user out everywhere",
  email_confirmed: "Confirmed an email",
  one_time_password_set: "Set a one-time password",
  login_deleted: "Deleted a login",
  set_role: "Changed a role",
  reset_mfa: "Reset two-step sign-in",
  sign_out_everywhere: "Signed a user out everywhere",
  tenants_update: "Edited the company",
  tenants_insert: "Created the company",
  subscriptions_update: "Edited the subscription",
  subscriptions_insert: "Created the subscription",
  tenant_modules_update: "Edited a module",
  tenant_modules_insert: "Added a module",
  tenant_modules_delete: "Removed a module",
  tenant_feature_overrides_update: "Edited the custom deal",
  tenant_feature_overrides_insert: "Edited the custom deal",
  tenant_feature_overrides_delete: "Edited the custom deal",
};
export const actionLabel = (a: string) => ACTION_LABELS[a] || a.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Today as YYYY-MM-DD (for date inputs). */
export const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const plusDays = (n: number, from?: string | null) => {
  const base = from && Date.parse(from) > Date.now() ? new Date(from) : new Date();
  base.setDate(base.getDate() + n);
  return base.toISOString().slice(0, 10);
};
