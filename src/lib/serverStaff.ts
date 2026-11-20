import { supabase } from "@/integrations/supabase/client";

/**
 * Staff accounts are managed by the app's own server, which ships with every
 * deploy. When that server is not reachable we fall back to the older backend function.
 */

type Result<T> = { data: T | null; error: string | null };

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Shop addresses cannot carry a POST body, so calls go to the main address. */
function serverUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const host = window.location.hostname;
  if (host === "garage.jmsurf.co.ke" || host === "garage.jmsurf.co.ke") return path;
  // Company subdomains are served by the same server: same-origin calls.
  return path;
}

export async function callServer<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<Result<T> & { unavailable?: boolean }> {
  const token = await accessToken();
  if (!token) return { data: null, error: "Please sign in again." };

  let response: Response;
  try {
    response = await fetch(serverUrl(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { data: null, error: null, unavailable: true };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { data: null, error: null, unavailable: true };
  }
  const payload = (await response.json().catch(() => null)) as any;
  if (!payload) return { data: null, error: null, unavailable: true };
  if (!response.ok || payload?.error) {
    return { data: payload as T, error: String(payload?.error || "That did not go through.") };
  }
  return { data: payload as T, error: null };
}

/**
 * The staff routes live in the app server only (the old backend functions
 * they used to fall back to were never deployed), so a missing server is
 * reported plainly instead of failing later with a vague error.
 */
async function withFallback<T>(
  path: string,
  _retired: string,
  body: Record<string, unknown>,
): Promise<Result<T>> {
  const server = await callServer<T>(path, body);
  if (server.unavailable) return { data: null, error: "Could not reach the server. Check your connection and try again." };
  return { data: server.data, error: server.error };
}

export function createStaffAccount(body: {
  email: string;
  password: string;
  display_name: string;
  phone?: string | null;
  role?: string;
  location_id?: string | null;
  tenant_id?: string | null;
  company_role_id?: string | null;
  location_ids?: string[];
  cost_per_hour?: number | string | null;
  address?: string;
  remarks?: string;
}) {
  return withFallback<{ success: boolean; user_id: string }>(
    "/api/staff/create",
    "admin-create-user",
    body,
  );
}

export function listStaffAccounts() {
  return withFallback<{ users: Array<{ id: string; email: string }> }>(
    "/api/staff/list",
    "admin-list-users",
    {},
  );
}

export function resetStaffPassword(userId: string) {
  return withFallback<{ success: boolean; message: string; password?: string }>(
    "/api/staff/reset-password",
    "admin-reset-password",
    { user_id: userId },
  );
}

/**
 * Removes a login for good. The app server does it first; if that server is
 * not reachable — or it has no admin key saved — the database removes the
 * account directly, so deleting never fails with a key error.
 */
export async function deleteStaffAccount(userId: string): Promise<Result<{ success: boolean }>> {
  const server = await callServer<{ success: boolean }>("/api/staff/delete", { user_id: userId });
  if (!server.unavailable && !server.error) return { data: server.data, error: null };

  const { data, error } = await supabase.rpc("delete_user_account" as any, { _user_id: userId });
  if (!error) return { data: data as { success: boolean }, error: null };
  // The database message says what really went wrong; the server one is usually
  // just a missing key on the container.
  return { data: null, error: error.message || server.error };
}

type VerifyResult = { ok: boolean; alreadyVerified?: boolean; email?: string; user_id?: string };

/**
 * Marks a login as verified. The app server handles it first; if that is not
 * reachable the database does it directly, so verification never depends on
 * the background functions.
 */
export async function verifyUserAccount(body: { user_id?: string; email?: string }) {
  const server = await callServer<VerifyResult>("/api/staff/verify", body);
  if (!server.unavailable && !server.error) return { data: server.data, error: null };

  // Straight to the database when the app server cannot do it.
  const { data, error } = await supabase.rpc("confirm_user_email" as any, {
    _user_id: body.user_id ?? null,
    _email: body.email ?? null,
  });
  if (!error) return { data: data as VerifyResult, error: null };
  return { data: null, error: server.error || error.message };
}

/** Changes a person: company role, active / inactive, branches and details (Settings → Users). */
export function updateStaffAccount(body: { user_id: string; company_role_id?: string | null; status?: "active" | "inactive"; location_ids?: string[]; display_name?: string; phone?: string; cost_per_hour?: number | string | null; address?: string; remarks?: string }) {
  return withFallback<{ success: boolean }>("/api/staff/update", "", body);
}
