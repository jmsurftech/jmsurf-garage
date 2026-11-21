// Platform owner (super admin) access.
//
// The platform owner is whoever is listed in platform_admins, and the super
// admin powers apply ONLY to requests made from the super admin address
// (admin.<root>, or the hub's sys-garage.jmsurfsys.co.ke). On a company address the same person is just that company's
// admin. Nothing is switched in the database, so a company tab and the super
// admin tab can be open side by side without undoing each other.
//
//   Database (PostgREST): the browser on admin.<root> sends x-dash-context:
//   platform; has_role(uid, 'super_admin') checks it (see migration
//   20261012090000_dash_platform_context.sql).
//   App server: every request runs inside requestStore, so any route can ask
//   isPlatformAdmin(userId) without having the request object at hand.
import { AsyncLocalStorage } from "node:async_hooks";

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.JMSURF_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const requestStore = new AsyncLocalStorage();

/** True when the current request comes from the super admin address. */
export function platformRequest(req = requestStore.getStore()?.req) {
  if (!req) return false;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase().split(":")[0];
  // admin.jmsurfgarage.co.ke, or the JMSURF SYSTEMS hub's framing proxy for this console
  // (sys-garage.jmsurfsys.co.ke) when it passes its own host through.
  return host.startsWith("admin.") || host === HUB_PLATFORM_HOST ||
    (String(req.headers["x-dash-context"] || "") === "platform" && host.startsWith("localhost"));
}
/** Same address as src/lib/host.ts HUB_PLATFORM_HOST. */
export const HUB_PLATFORM_HOST = "sys-garage.jmsurfsys.co.ke";

const cache = new Map();
/** Is this user a platform owner AND working from the super admin address? */
export async function isPlatformAdmin(userId, req) {
  if (!userId || !platformRequest(req)) return false;
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.yes;
  let yes = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(8000),
    });
    yes = r.ok && (await r.json()).length > 0;
  } catch { yes = false; }
  cache.set(userId, { yes, until: Date.now() + 60_000 });
  return yes;
}

/** Adds "super_admin" to a role list when the caller is the platform owner on the super admin address. */
export async function withPlatformRole(roles, userId, req) {
  const list = Array.isArray(roles) ? roles.filter((r) => r !== "super_admin") : [];
  if (await isPlatformAdmin(userId, req)) list.push("super_admin");
  return list;
}
