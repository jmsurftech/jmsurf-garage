import { getAuthUser } from "@/lib/authUser";
import { supabase } from "@/integrations/supabase/client";
import { addToSyncQueue } from "@/lib/offlineDb";

/**
 * Lightweight tenant-scoped activity logger.
 * Fire-and-forget: never blocks the caller, never throws.
 *
 * - Online: inserts directly into user_activity_log.
 * - Offline (or insert failure): queues to the offline sync queue
 *   so it gets flushed by useOfflineSync the next time we reconnect.
 *
 * Deduplication: every event carries a client-generated `event_id`.
 * The DB has a unique index on (tenant_id, event_id), so retries from the
 * sync queue after a reconnect can NEVER produce duplicate audit rows.
 */
export interface ActivityInput {
  action: string; // "create" | "update" | "delete" | "login" | "sale" | etc
  description: string;
  entity_type?: string;
  entity_id?: string;
  tenant_id?: string;
  metadata?: Record<string, unknown>;
  /** Optional caller-supplied event id (otherwise auto-generated). */
  event_id?: string;
}

/* ------------------------------------------------------------------ */
/* Login/logout enrichment: device, browser, session, best-effort IP. */
/* ------------------------------------------------------------------ */

const SESSION_ID_KEY = "audit:session_id";

function ensureSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_ID_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_ID_KEY, sid);
    }
    return sid;
  } catch {
    return crypto.randomUUID();
  }
}

function detectBrowser(ua: string) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Unknown";
}

function detectOS(ua: string) {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/(iPhone|iPad|iPod)/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

function detectDeviceType(ua: string) {
  if (/Mobi|Android.*Mobile|iPhone|iPod/.test(ua)) return "mobile";
  if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) return "tablet";
  return "desktop";
}

/**
 * The site's security policy blocks third-party lookups such as api.ipify.org,
 * so the browser can't learn its public IP (each try only logged an error).
 */
async function getClientIp(): Promise<string | null> {
  return null;
}

/**
 * Build a metadata bundle to attach to login/logout events so security
 * reviews can trace where/how a session was started or ended.
 */
export async function buildAuthEventMetadata(extra?: Record<string, unknown>) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const session_id = ensureSessionId();
  const ip = await getClientIp();
  return {
    ...(extra || {}),
    session_id,
    ip,
    device: detectDeviceType(ua),
    os: detectOS(ua),
    browser: detectBrowser(ua),
    user_agent: ua,
    occurred_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Core logger                                                         */
/* ------------------------------------------------------------------ */

async function buildPayload(input: ActivityInput) {
  const { data: { user } } = await getAuthUser();
  if (!user) return null;

  let tenantId = input.tenant_id;
  let displayName: string | null = null;

  if (!tenantId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    tenantId = profile?.tenant_id || undefined;
    displayName = profile?.display_name || null;
  }
  if (!tenantId) return null;

  return {
    tenant_id: tenantId,
    user_id: user.id,
    user_email: user.email ?? null,
    user_display_name: displayName,
    action: input.action,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    description: input.description,
    metadata: input.metadata ?? null,
    event_id: input.event_id || crypto.randomUUID(),
  };
}

export function logActivity(input: ActivityInput) {
  void (async () => {
    try {
      const payload = await buildPayload(input);
      if (!payload) return;

      // Offline-first: if we're offline, queue immediately (tenant-scoped).
      if (!navigator.onLine) {
        await addToSyncQueue({
          table: "user_activity_log",
          action: "insert",
          payload,
          tenant_id: payload.tenant_id,
        });
        return;
      }

      // An expired sign-in would be refused (401); keep the entry for the next sync instead.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || (session.expires_at && session.expires_at * 1000 < Date.now())) {
        await addToSyncQueue({ table: "user_activity_log", action: "insert", payload, tenant_id: payload.tenant_id });
        return;
      }
      const { error } = await (supabase as any).from("user_activity_log").insert(payload);
      if (error) {
        // Unique-violation on (tenant_id, event_id) means it was already saved — ignore.
        if (String(error.code) === "23505") return;
        // Network/permission failure → queue so we don't lose the event
        await addToSyncQueue({
          table: "user_activity_log",
          action: "insert",
          payload,
          tenant_id: payload.tenant_id,
        });
      }
    } catch (e) {
      console.warn("[auditLog] failed:", e);
    }
  })();
}
