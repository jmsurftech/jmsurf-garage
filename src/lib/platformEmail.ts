// Email helpers that talk to the mail service built into the app server
// (server.js). It ships in the same container as the site, so every deploy
// updates it automatically. When the app runs somewhere without that server,
// the caller can fall back to the backend function instead.
import { supabase } from "@/integrations/supabase/client";

export type PlatformEmailResult = {
  ok: boolean;
  stage?: string;
  server?: string;
  from?: string;
  to?: string;
  response?: string;
  error?: string;
  /** True when this app build has no built-in mail service to call. */
  unavailable?: boolean;
};

/** The app server's email routes (same origin on every address). */
function emailApiUrl(route: string): string {
  const path = `/api/email/${route}`;
  // Every JMSURF Garage address (app., a company's own domain) is served by the same server: same-origin calls.
  return path;
}

async function callEmailApi(
  route: string,
  body: Record<string, unknown>,
  options: { requireSession?: boolean } = {},
): Promise<PlatformEmailResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!token && options.requireSession) return { ok: false, error: "Sign in again and retry" };

  let response: Response;
  try {
    response = await fetch(emailApiUrl(route), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    return { ok: false, unavailable: true, error: (networkError as Error).message };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    // The route is not served here (dev preview serves index.html instead).
    return { ok: false, unavailable: true, error: "The built-in mail service is not running on this address" };
  }

  const payload = (await response.json()) as PlatformEmailResult;
  return payload;
}

/** Sends a real test message and reports exactly what the mail server said. */
export function sendSmtpTest(to: string, smtp?: Record<string, unknown>) {
  return callEmailApi("test", { to, smtp }, { requireSession: true });
}

/** Sends a transactional message through the saved mail server. */
export function sendPlatformEmail(input: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
}) {
  return callEmailApi("send", input as unknown as Record<string, unknown>, { requireSession: true });
}

/** Emails a fresh account confirmation link to someone who has not verified yet. */
export function sendVerificationEmail(email: string, redirectTo: string) {
  return callEmailApi("verify", { email, redirectTo });
}

/** Emails a one-time password reset link. */
export function requestPasswordReset(email: string) {
  return callEmailApi("password-reset", { email });
}

/** Frees an email whose old login has no shop left behind it, so sign-up can reuse it. */
export function releaseOrphanLogin(email: string) {
  return callEmailApi("release-orphan", { email }) as Promise<PlatformEmailResult & { released?: boolean }>;
}

/** Looks up the account email for a phone number; needs the right password. */
export function resolveLoginEmail(phone: string, password: string) {
  return callEmailApi("resolve-login", { phone, password }) as Promise<PlatformEmailResult & { email?: string }>;
}

/** Emails a newly registered shop owner their login address. */
export function sendWelcomeEmail(input: { email: string; name?: string; loginUrl: string }) {
  return callEmailApi("welcome", input as unknown as Record<string, unknown>);
}

/** Tells the platform owner that a new shop registered. */
export function sendSignupAlert(input: Record<string, unknown>) {
  return callEmailApi("signup-alert", input);
}

/** Emails a sale receipt to a customer. */
export function sendReceiptEmail(input: {
  email: string;
  shopName?: string;
  receipt: Record<string, unknown>;
}) {
  return callEmailApi("receipt", input as unknown as Record<string, unknown>, { requireSession: true });
}

